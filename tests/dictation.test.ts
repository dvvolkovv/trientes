import { describe, it, expect } from "vitest";
import { appendDictated, dictationLang, isTerminalSpeechError, shouldRestart } from "@/lib/dictation";

describe("appendDictated", () => {
  it("adds the dictated chunk to the end of what is already written", () => {
    expect(appendDictated("Bottled still water", "half a litre")).toBe("Bottled still water half a litre");
  });

  it("starts a new sentence with a capital, but only after a finished one", () => {
    expect(appendDictated("Bottled still water.", "half a litre")).toBe("Bottled still water. Half a litre");
    expect(appendDictated("", "half a litre")).toBe("Half a litre");
  });

  it("does not invent punctuation — the words are the merchant's, not ours", () => {
    expect(appendDictated("water", "half a litre")).not.toContain(".");
  });

  it("keeps the merchant's own line breaks", () => {
    expect(appendDictated("Composition:\n", "water, sugar")).toBe("Composition:\nWater, sugar");
  });

  it("leaves scripts without capitals alone", () => {
    expect(appendDictated("", "ミネラルウォーター")).toBe("ミネラルウォーター");
  });

  it("ignores an empty or whitespace chunk", () => {
    expect(appendDictated("water", "   ")).toBe("water");
    expect(appendDictated("water", "")).toBe("water");
  });

  it("collapses the whitespace the recogniser leaves behind", () => {
    expect(appendDictated("", "  half   a litre ")).toBe("Half a litre");
  });
});

describe("dictationLang", () => {
  it("uses the language of the description, not of the page", () => {
    expect(dictationLang("ru")).toBe("ru-RU");
    expect(dictationLang("pt-BR")).toBe("pt-BR");
  });
});

describe("restart policy", () => {
  it("restarts after Safari cuts the recognition off mid-dictation", () => {
    expect(shouldRestart(true, null, 0)).toBe(true);
  });

  it("never restarts after the microphone was refused", () => {
    expect(isTerminalSpeechError("not-allowed")).toBe(true);
    expect(shouldRestart(true, "not-allowed", 0)).toBe(false);
  });

  it("stops restarting when nothing is being said", () => {
    expect(shouldRestart(true, "no-speech", 4)).toBe(false);
  });

  it("does not restart once the person pressed stop", () => {
    expect(shouldRestart(false, null, 0)).toBe(false);
  });
});
