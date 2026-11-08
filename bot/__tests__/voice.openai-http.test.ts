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
const SERVER_ERROR: Reply = { status: 500, body: { error: { message: "The server had an error", type: "server_error" } } };

// Decoys for the variables SDK 6 reads as `organization` / `project` defaults.
const ENV_ORG = "org-env-decoy";
const ENV_PROJECT = "proj_env_decoy";

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
/** Replies for the next transcription requests, in order; the last one repeats. */
let replies: Reply[] = [OK];

/** Test client: no retries, a timeout well under the test's, nothing from OPENAI_* env. */
function client(): OpenAI {
  // SDK 6 reads OPENAI_ORG_ID / OPENAI_PROJECT_ID only as defaults for
  // `undefined` options; an explicit null opts out of them.
  return new OpenAI({ apiKey: "test-key", baseURL, maxRetries: 0, timeout: 2000, organization: null, project: null });
}

/**
 * Configured like bot/index.ts (`new OpenAI({ apiKey })`): SDK defaults for
 * retries, timeout, organization and project. Only baseURL is set, to reach
 * the local server.
 */
function productionClient(): OpenAI {
  return new OpenAI({ apiKey: "test-key", baseURL });
}

async function parseMultipart(request: CapturedRequest): Promise<FormData> {
  return new Request("http://127.0.0.1/parse", {
    method: "POST",
    headers: { "content-type": String(request.headers["content-type"]) },
    body: new Uint8Array(request.body),
  }).formData();
}

async function uploadedAudio(request: CapturedRequest): Promise<Buffer> {
  const file = (await parseMultipart(request)).get("file");
  expect(file).toBeInstanceOf(File);
  return Buffer.from(await (file as File).arrayBuffer());
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
  vi.stubEnv("OPENAI_ORG_ID", ENV_ORG);
  vi.stubEnv("OPENAI_PROJECT_ID", ENV_PROJECT);

  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      const routed = req.method === "POST" && req.url === "/v1/audio/transcriptions";
      const { status, body } = routed
        ? replies.length > 1
          ? replies.shift()!
          : replies[0]
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
  replies = [OK];
});

describe("transcribeBuffer over HTTP with the real OpenAI SDK", () => {
  it("posts a Whisper multipart request and returns the transcript", async () => {
    await expect(transcribeBuffer(AUDIO, "voice.ogg", client())).resolves.toBe("привет");

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/v1/audio/transcriptions");
    expect(request.headers.authorization).toBe("Bearer test-key");
    // OPENAI_ORG_ID / OPENAI_PROJECT_ID decoys are set; the client opts out with null.
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

  it("a client configured like the bot sends OPENAI_ORG_ID / OPENAI_PROJECT_ID from the environment", async () => {
    // Positive control for the undefined checks above: the decoys do reach the
    // SDK, so only the explicit null keeps them off the wire. It also pins what
    // production does: whatever org/project the bot process has goes to OpenAI.
    await expect(transcribeBuffer(AUDIO, "voice.ogg", productionClient())).resolves.toBe("привет");

    expect(requests).toHaveLength(1);
    expect(requests[0].headers.authorization).toBe("Bearer test-key");
    expect(requests[0].headers["openai-organization"]).toBe(ENV_ORG);
    expect(requests[0].headers["openai-project"]).toBe(ENV_PROJECT);
  });

  // The SDK's default backoff (about 0.5 s, then 1 s) has to fit in.
  it("a client configured like the bot retries 5xx twice and then succeeds", { timeout: 10_000 }, async () => {
    replies = [SERVER_ERROR, SERVER_ERROR, OK];

    await expect(transcribeBuffer(AUDIO, "voice.ogg", productionClient())).resolves.toBe("привет");

    expect(requests).toHaveLength(3);
    expect(requests.map((request) => request.headers["x-stainless-retry-count"])).toEqual(["0", "1", "2"]);
    // Every attempt re-sends the whole file, not a consumed stream.
    for (const request of requests) {
      expect((await uploadedAudio(request)).equals(AUDIO)).toBe(true);
    }
  });

  it("rejects on a 401 JSON error without retrying, even with the SDK's default retries", async () => {
    replies = [
      {
        status: 401,
        body: { error: { message: "Incorrect API key provided", type: "invalid_request_error", code: "invalid_api_key" } },
      },
    ];

    const error = await transcribeBuffer(AUDIO, "voice.ogg", productionClient()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).status).toBe(401);
    expect((error as AuthenticationError).message).toContain("Incorrect API key provided");
    expect(requests).toHaveLength(1);
  });

  it("maps a 500 JSON error to InternalServerError when retries are off", async () => {
    replies = [SERVER_ERROR];

    const error = await transcribeBuffer(AUDIO, "voice.ogg", client()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InternalServerError);
    expect((error as InternalServerError).status).toBe(500);
    expect(requests).toHaveLength(1);
  });
});
