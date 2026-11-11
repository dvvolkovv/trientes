import { beforeEach, describe, expect, it, vi } from "vitest";

// Граница слайса: витрина «свой листинг» переводит подпись карточки только из
// кеша. Промах там обязан отдать оригинал молча — вызов модели на каждую
// карточку списка стоил бы страницы, а не подписи.

const store = new Map<string, string>();
const translateStrings = vi.fn();
const detectSourceLocale = vi.fn();

vi.mock("@/lib/redis", () => ({
  redis: {
    status: "ready",
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    },
    connect: async () => undefined,
  },
}));

vi.mock("@/lib/translate", () => ({
  translateStrings: (...args: unknown[]) => translateStrings(...args),
  detectSourceLocale: (...args: unknown[]) => detectSourceLocale(...args),
  proseLanguageName: (locale: string) => (locale === "xx" ? null : locale.toUpperCase()),
}));

const { localizedProse } = await import("@/lib/localized-prose");
const { proseHash } = await import("@/lib/prose-fields");

const FIELDS = { tagline: "Открытый блокчейн", description: null };

beforeEach(() => {
  store.clear();
  translateStrings.mockReset();
  detectSourceLocale.mockReset();
});

describe("localizedProse cacheOnly", () => {
  it("промах мимо кеша отдаёт оригинал и не зовёт модель", async () => {
    const res = await localizedProse({
      ns: "card", id: "c1", locale: "en", sourceLocale: "ru",
      fields: FIELDS, cacheOnly: true,
    });
    expect(res.translated).toBe(false);
    expect(res.fields.tagline).toBe("Открытый блокчейн");
    expect(translateStrings).not.toHaveBeenCalled();
  });

  it("не определяет язык источника моделью, когда он неизвестен", async () => {
    const res = await localizedProse({
      ns: "card", id: "c1", locale: "en", sourceLocale: null,
      fields: FIELDS, cacheOnly: true,
    });
    expect(res.translated).toBe(false);
    expect(detectSourceLocale).not.toHaveBeenCalled();
  });

  it("берёт готовый перевод под тем же ключом, что и страница карточки", async () => {
    const key = `i18nprose:card:c1:en:${proseHash({ tagline: "Открытый блокчейн" })}`;
    store.set(key, JSON.stringify({ tagline: "Open blockchain" }));
    const res = await localizedProse({
      ns: "card", id: "c1", locale: "en", sourceLocale: "ru",
      fields: FIELDS, cacheOnly: true,
    });
    expect(res.translated).toBe(true);
    expect(res.fields.tagline).toBe("Open blockchain");
    expect(translateStrings).not.toHaveBeenCalled();
  });

  it("без cacheOnly промах по-прежнему переводит", async () => {
    translateStrings.mockResolvedValue({ tagline: "Open blockchain" });
    const res = await localizedProse({
      ns: "card", id: "c1", locale: "en", sourceLocale: "ru", fields: FIELDS,
    });
    expect(res.translated).toBe(true);
    expect(translateStrings).toHaveBeenCalledOnce();
  });
});
