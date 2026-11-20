import { describe, expect, it } from "vitest";
import {
  SINGLE_ZONE_COUNTRIES,
  allTimezones,
  isKnownTimezone,
  timezoneForCountry,
} from "@/lib/timezones";

describe("часовые пояса", () => {
  it("список берётся у платформы и не пуст", () => {
    expect(allTimezones().length).toBeGreaterThan(100);
    expect(allTimezones()).toContain("Europe/Prague");
  });

  it("негодную зону платформа отвергает", () => {
    expect(isKnownTimezone("Europe/Prague")).toBe(true);
    expect(isKnownTimezone("Nowhere/Nothing")).toBe(false);
    expect(isKnownTimezone(null)).toBe(false);
    expect(isKnownTimezone("")).toBe(false);
  });

  it("однопоясная страна подставляется, многопоясная — нет", () => {
    expect(timezoneForCountry("CZ")).toBe("Europe/Prague");
    expect(timezoneForCountry("cz")).toBe("Europe/Prague");
    expect(timezoneForCountry("US")).toBeNull();
    expect(timezoneForCountry("RU")).toBeNull();
    expect(timezoneForCountry("PT")).toBeNull(); // Азорские острова — свой пояс
    expect(timezoneForCountry("ES")).toBeNull(); // Канарские — свой пояс
    expect(timezoneForCountry(null)).toBeNull();
    expect(timezoneForCountry("ZZ")).toBeNull();
  });

  // Граница: подставленное значение обязано существовать у платформы, иначе
  // «открыто сейчас» молча не посчитается у целой страны.
  it("каждый подставляемый пояс платформа знает и показывает в списке", () => {
    const known = new Set(allTimezones());
    for (const code of Object.keys(SINGLE_ZONE_COUNTRIES)) {
      const tz = timezoneForCountry(code)!;
      expect(isKnownTimezone(tz), `${code} → ${tz}`).toBe(true);
      expect(known.has(tz), `${code} → ${tz} отсутствует в списке платформы`).toBe(true);
    }
  });

  // У зоны бывает два имени (`Europe/Kyiv` и `Europe/Kiev`): подставляем то, которое
  // лежит в списке платформы, иначе выпадающий список покажет пустой выбор.
  it("подстановка приводит имя зоны к тому, которое знает платформа", () => {
    expect(allTimezones()).toContain(timezoneForCountry("UA"));
    expect(allTimezones()).toContain(timezoneForCountry("IN"));
  });
});
