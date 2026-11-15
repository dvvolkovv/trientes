import { describe, expect, it } from "vitest";
import { handoffPlatform, handoffUrl } from "@/lib/nav-handoff";

const IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

describe("handoffPlatform", () => {
  it("айфон и айпад ведёт в Apple Maps", () => {
    expect(handoffPlatform(IOS)).toBe("apple");
    expect(handoffPlatform("Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)")).toBe("apple");
  });

  it("андроид — в Google Maps", () => {
    expect(handoffPlatform(ANDROID)).toBe("google");
  });

  it("настольный Mac — не айфон: там CarPlay не при чём", () => {
    expect(handoffPlatform(MAC)).toBe("web");
    expect(handoffPlatform("")).toBe("web");
  });
});

describe("handoffUrl", () => {
  const dest = { lat: 50.0875, lon: 14.4213, name: "Náprstkova 10" };

  it("Apple Maps получает точку и режим", () => {
    expect(handoffUrl("apple", dest, "car")).toBe("maps://?daddr=50.0875,14.4213&dirflg=d");
    expect(handoffUrl("apple", dest, "walk")).toBe("maps://?daddr=50.0875,14.4213&dirflg=w");
    expect(handoffUrl("apple", dest, "transit")).toBe("maps://?daddr=50.0875,14.4213&dirflg=r");
  });

  it("на андроиде машина и ноги идут схемой навигации", () => {
    expect(handoffUrl("google", dest, "car")).toBe("google.navigation:q=50.0875,14.4213&mode=d");
    expect(handoffUrl("google", dest, "walk")).toBe("google.navigation:q=50.0875,14.4213&mode=w");
  });

  it("у транспорта схемы навигации нет — уходим универсальной ссылкой", () => {
    expect(handoffUrl("google", dest, "transit")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=50.0875%2C14.4213&travelmode=transit",
    );
  });

  it("всё прочее открывает Google Maps в браузере", () => {
    expect(handoffUrl("web", dest, "car")).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=50.0875%2C14.4213&travelmode=driving",
    );
  });

  it("координаты не теряют знаков — точка в другом полушарии остаётся собой", () => {
    expect(handoffUrl("apple", { lat: -33.8688, lon: 151.2093, name: "" }, "car")).toContain(
      "daddr=-33.8688,151.2093",
    );
  });
});
