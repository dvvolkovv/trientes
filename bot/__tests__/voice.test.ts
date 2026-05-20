import { describe, it, expect, vi, beforeEach } from "vitest";
import { transcribeBuffer } from "../voice";

describe("transcribeBuffer", () => {
  let openai: { audio: { transcriptions: { create: ReturnType<typeof vi.fn> } } };

  beforeEach(() => {
    openai = {
      audio: {
        transcriptions: {
          create: vi.fn(),
        },
      },
    };
  });

  it("calls openai with file + language=ru and returns text", async () => {
    openai.audio.transcriptions.create.mockResolvedValue({ text: "привет" });
    const result = await transcribeBuffer(
      Buffer.from("fake-ogg"),
      "voice.ogg",
      openai as never,
    );
    expect(result).toBe("привет");
    expect(openai.audio.transcriptions.create).toHaveBeenCalledTimes(1);
    const args = openai.audio.transcriptions.create.mock.calls[0][0];
    expect(args.model).toBe("whisper-1");
    expect(args.language).toBe("ru");
    expect(args.file).toBeDefined();
  });

  it("trims surrounding whitespace from response", async () => {
    openai.audio.transcriptions.create.mockResolvedValue({ text: "  hi  " });
    expect(await transcribeBuffer(Buffer.from("x"), "a.ogg", openai as never)).toBe(
      "hi",
    );
  });

  it("propagates errors from OpenAI", async () => {
    openai.audio.transcriptions.create.mockRejectedValue(new Error("429"));
    await expect(
      transcribeBuffer(Buffer.from("x"), "a.ogg", openai as never),
    ).rejects.toThrow("429");
  });
});
