import { describe, expect, it } from "vitest";
import { SPEECH_LANG, SUPPORTED_LOCALES, speechLang } from "@/lib/locales";
import { pickSpeechVoice } from "@/lib/speech";

type V = { lang: string; localService: boolean; name: string };
const voice = (lang: string, localService = true, name = lang): V => ({ lang, localService, name });

describe("speechLang", () => {
  it("у каждого языка интерфейса есть голос: немой навигатор — не язык", () => {
    for (const l of SUPPORTED_LOCALES) {
      expect(SPEECH_LANG[l], l).toBeTruthy();
      expect(SPEECH_LANG[l], l).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it("различает бразильский португальский и европейский", () => {
    expect(speechLang("pt-BR")).toBe("pt-BR");
    expect(speechLang("es")).toBe("es-ES");
  });

  it("незнакомую локаль отдаёт как есть — пусть решает браузер", () => {
    expect(speechLang("it")).toBe("it");
  });
});

describe("pickSpeechVoice", () => {
  it("точный тег важнее семьи языка", () => {
    const voices = [voice("pt-PT"), voice("pt-BR")];
    expect(pickSpeechVoice(voices, "pt-BR")?.lang).toBe("pt-BR");
  });

  it("при разном написании тега совпадение всё равно находится", () => {
    expect(pickSpeechVoice([{ lang: "pt_BR", localService: true, name: "x" }], "pt-BR")?.lang).toBe("pt_BR");
  });

  it("нет точного — берёт любой голос той же семьи", () => {
    expect(pickSpeechVoice([voice("de-AT")], "de-DE")?.lang).toBe("de-AT");
  });

  it("встроенный голос предпочтительнее сетевого: в дороге связь пропадает", () => {
    const voices = [voice("ru-RU", false, "сетевой"), voice("ru-RU", true, "встроенный")];
    expect(pickSpeechVoice(voices, "ru-RU")?.name).toBe("встроенный");
  });

  it("чужого языка не подсовывает — лучше молчание, чем турецкий вместо хорватского", () => {
    expect(pickSpeechVoice([voice("tr-TR")], "hr-HR")).toBeNull();
  });

  it("пустой список голосов — не повод падать", () => {
    expect(pickSpeechVoice([], "ru-RU")).toBeNull();
  });
});
