import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI, { AuthenticationError, InternalServerError } from "openai";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeBuffer } from "../voice";

// voice.test.ts mocks the OpenAI client, so it cannot notice when an SDK
// upgrade changes what actually goes over the wire. Here a real OpenAI SDK 6
// client talks to a local HTTP server that plays the transcription endpoint.

type CapturedRequest = {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: Buffer;
};
type Reply = { status: number; body: unknown };

const OK: Reply = { status: 200, body: { text: "привет" } };

// Bytes that would break a naive multipart encoder: NUL, 0xff, CRLF and "--".
const AUDIO = Buffer.concat([
  Buffer.from("OggS", "latin1"),
  Buffer.from([0x00, 0x02, 0xff, 0xfe, 0x0d, 0x0a, 0x2d, 0x2d, 0x00]),
  Buffer.from("\r\n--boundary--\r\n", "latin1"),
  Buffer.from([0x80, 0x81, 0xc0, 0xff]),
]);

let server: Server;
let baseURL: string;
let requests: CapturedRequest[] = [];
let reply: Reply = OK;

function client(): OpenAI {
  return new OpenAI({ apiKey: "test-key", baseURL, maxRetries: 0, timeout: 5000 });
}

async function parseMultipart(request: CapturedRequest): Promise<FormData> {
  return new Request("http://127.0.0.1/parse", {
    method: "POST",
    headers: { "content-type": String(request.headers["content-type"]) },
    body: new Uint8Array(request.body),
  }).formData();
}

beforeAll(async () => {
  // No real key, endpoint, org or project may leak in from the environment:
  // clear every OPENAI_* variable, then plant decoys that must lose to the
  // explicit client options.
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("OPENAI_")) vi.stubEnv(name, undefined);
  }
  vi.stubEnv("OPENAI_API_KEY", "env-key-must-not-be-sent");
  vi.stubEnv("OPENAI_BASE_URL", "http://127.0.0.1:9/env-base-url-must-not-be-used");

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      const routed = req.method === "POST" && req.url === "/v1/audio/transcriptions";
      const { status, body } = routed
        ? reply
        : { status: 404, body: { error: { message: `unexpected ${req.method} ${req.url}`, type: "not_found" } } };
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseURL = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  vi.unstubAllEnvs();
});

beforeEach(() => {
  requests = [];
  reply = OK;
});

describe("transcribeBuffer over HTTP with the real OpenAI SDK", () => {
  it("posts a Whisper multipart request and returns the transcript", async () => {
    await expect(transcribeBuffer(AUDIO, "voice.ogg", client())).resolves.toBe("привет");

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/v1/audio/transcriptions");
    expect(request.headers.authorization).toBe("Bearer test-key");
    expect(request.headers["openai-organization"]).toBeUndefined();
    expect(request.headers["openai-project"]).toBeUndefined();
    expect(request.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);

    const form = await parseMultipart(request);
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("language")).toBe("ru");
    const file = form.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("voice.ogg");
    expect(Buffer.from(await (file as File).arrayBuffer()).equals(AUDIO)).toBe(true);
    expect([...form.keys()].sort()).toEqual(["file", "language", "model"]);
  });

  it("rejects on a 401 JSON error without retrying", async () => {
    reply = {
      status: 401,
      body: { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } },
    };

    const error = await transcribeBuffer(AUDIO, "voice.ogg", client()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).status).toBe(401);
    expect((error as AuthenticationError).message).toContain("Incorrect API key provided");
    expect(requests).toHaveLength(1);
  });

  it("rejects on a 500 JSON error without retrying", async () => {
    reply = { status: 500, body: { error: { message: "The server had an error", type: "server_error" } } };

    const error = await transcribeBuffer(AUDIO, "voice.ogg", client()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InternalServerError);
    expect((error as InternalServerError).status).toBe(500);
    expect(requests).toHaveLength(1);
  });
});
