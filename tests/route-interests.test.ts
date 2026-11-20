import { describe, it, expect } from "vitest";
import {
  INTEREST_KEYS,
  interestOf,
  activeInterests,
  parseCorridor,
  parseAlert,
  CORRIDOR_DEFAULT,
  ALERT_DEFAULT,
} from "@/lib/interests";
import {
  sampleLine,
  routeChunks,
  projectOnRoute,
  rankStops,
  routeLength,
  MAX_CHUNKS,
  MAX_STOPS,
  MIN_ROUTE_METERS,
} from "@/lib/route-corridor";
import { StopVoiceLog, stopCue } from "@/lib/route-stop-cue";

// Прага: линия примерно на восток, шаг около 700 м по широте 50°.
function line(n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => [14.4 + i * 0.01, 50.08] as [number, number]);
}

describe("ось интересов", () => {
  it("знает заправку и зарядную станцию по категории, а не по слою", () => {
    expect(interestOf({ layer: "merchant", category: "Fuel" })).toBe("fuel");
    expect(interestOf({ layer: "merchant", category: "Charging Station" })).toBe("fuel");
  });

  it("опознаёт еду и ночлег", () => {
    expect(interestOf({ layer: "merchant", category: "Restaurant" })).toBe("food");
    expect(interestOf({ layer: "merchant", category: "Cafe" })).toBe("food");
    expect(interestOf({ layer: "merchant", category: "Hotel" })).toBe("lodging");
    expect(interestOf({ layer: "merchant", category: "Guest House" })).toBe("lodging");
  });

  it("незнакомую категорию слоя «магазин» считает магазином, а не теряет", () => {
    expect(interestOf({ layer: "merchant", category: "Hairdresser" })).toBe("shop");
    expect(interestOf({ layer: "merchant", category: null })).toBe("shop");
  });

  it("наличные — это банкоматы, банки и финтех", () => {
    expect(interestOf({ layer: "atm", category: "Crypto ATM" })).toBe("cash");
    expect(interestOf({ layer: "financial", category: "Bank" })).toBe("cash");
    expect(interestOf({ layer: "fintech", category: "Fintech" })).toBe("cash");
  });

  it("у каждого ключа оси есть правило опознания", () => {
    expect(INTEREST_KEYS).toEqual(["fuel", "food", "lodging", "shop", "cash"]);
  });
});

describe("отметки «нравится / не нравится»", () => {
  it("молчание значит все пять, а не ни одного", () => {
    expect(activeInterests([])).toEqual(INTEREST_KEYS);
  });

  it("любой «нравится» сужает набор до отмеченных", () => {
    expect(activeInterests([{ key: "fuel", verdict: "LIKE" }])).toEqual(["fuel"]);
  });

  it("«не нравится» вычитается и из полного набора", () => {
    expect(activeInterests([{ key: "cash", verdict: "DISLIKE" }])).toEqual([
      "fuel",
      "food",
      "lodging",
      "shop",
    ]);
  });

  it("«не нравится» сильнее «нравится» у того же ключа", () => {
    expect(
      activeInterests([
        { key: "fuel", verdict: "LIKE" },
        { key: "fuel", verdict: "DISLIKE" },
      ]),
    ).toEqual([]);
  });
});

describe("два числа человека", () => {
  it("пустое поле возвращает умолчание, а не ноль", () => {
    expect(parseCorridor("")).toEqual({ ok: true, value: CORRIDOR_DEFAULT });
    expect(parseAlert("")).toEqual({ ok: true, value: ALERT_DEFAULT });
  });

  it("за пределами вилки отвергает вслух", () => {
    expect(parseCorridor("50")).toEqual({ ok: false, reason: "corridor_invalid" });
    expect(parseCorridor("20000")).toEqual({ ok: false, reason: "corridor_invalid" });
    expect(parseAlert("100")).toEqual({ ok: false, reason: "alert_invalid" });
    expect(parseAlert("9000")).toEqual({ ok: false, reason: "alert_invalid" });
  });

  it("годное число принимает целым", () => {
    expect(parseCorridor("2500")).toEqual({ ok: true, value: 2500 });
    expect(parseAlert("2000")).toEqual({ ok: true, value: 2000 });
  });
});

describe("коридор маршрута", () => {
  it("прореживание оставляет концы линии на месте", () => {
    const coords = line(40);
    const s = sampleLine(coords, 2000);
    expect(s.length).toBeGreaterThan(1);
    expect(s[0]).toEqual(coords[0]);
    expect(s[s.length - 1]).toEqual(coords[coords.length - 1]);
    expect(s.length).toBeLessThan(coords.length);
  });

  it("длина линии считается по земле, а не по градусам", () => {
    // Десять шагов по 0,01° долготы на широте 50° — около 7,2 км.
    const m = routeLength(line(11));
    expect(m).toBeGreaterThan(6500);
    expect(m).toBeLessThan(7700);
  });

  it("куски несут прямоугольники, расширенные на коридор", () => {
    const chunks = routeChunks(line(80), 1500);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS);
    for (const c of chunks) {
      expect(c.maxLat).toBeGreaterThan(c.minLat);
      expect(c.maxLon).toBeGreaterThan(c.minLon);
    }
    // Запас на коридор: 1,5 км по широте — это больше 0,013°.
    expect(chunks[0].maxLat - 50.08).toBeGreaterThan(0.013);
  });

  it("длинный маршрут не плодит куски без предела", () => {
    const chunks = routeChunks(line(4000), 1500);
    expect(chunks.length).toBeLessThanOrEqual(MAX_CHUNKS);
  });

  it("проекция даёт и место по пути, и отступ в сторону", () => {
    const sampled = sampleLine(line(21), 300);
    const near = projectOnRoute(sampled, { lat: 50.085, lon: 14.45 });
    expect(near).not.toBeNull();
    expect(near!.offsetMeters).toBeGreaterThan(400);
    expect(near!.offsetMeters).toBeLessThan(700);
    expect(near!.alongMeters).toBeGreaterThan(3000);
    expect(near!.alongMeters).toBeLessThan(4200);
  });

  it("порядок — по расстоянию вдоль маршрута, и потолок назван вслух", () => {
    const stops = Array.from({ length: MAX_STOPS + 5 }, (_, i) => ({
      alongMeters: (MAX_STOPS + 5 - i) * 100,
      offsetMeters: 10,
    }));
    const { shown, hidden } = rankStops(stops);
    expect(shown.length).toBe(MAX_STOPS);
    expect(hidden).toBe(5);
    expect(shown[0].alongMeters).toBeLessThan(shown[1].alongMeters);
  });

  it("слишком короткий маршрут остановок по пути не имеет", () => {
    expect(MIN_ROUTE_METERS).toBe(500);
  });
});

describe("подсказка о приближении", () => {
  const stops = [
    { id: "a", name: "Shell", alongMeters: 5000, offsetMeters: 300 },
    { id: "b", name: "Hotel", alongMeters: 40000, offsetMeters: 1200 },
  ];

  it("молчит, пока до точки далеко", () => {
    const log = new StopVoiceLog();
    expect(stopCue({ travelled: 0, stops, alertMeters: 1500, speedMps: 0, log })).toBeNull();
  });

  it("говорит один раз на подходе", () => {
    const log = new StopVoiceLog();
    const cue = stopCue({ travelled: 4000, stops, alertMeters: 1500, speedMps: 0, log });
    expect(cue).toMatchObject({ id: "a", name: "Shell", distanceMeters: 1000, offsetMeters: 300 });
    expect(stopCue({ travelled: 4200, stops, alertMeters: 1500, speedMps: 0, log })).toBeNull();
  });

  it("на скорости порог шире метров: фраза должна успеть прозвучать", () => {
    const log = new StopVoiceLog();
    // 30 м/с × 60 с = 1800 м — дальше, чем полтора километра настройки.
    const cue = stopCue({ travelled: 3300, stops, alertMeters: 1500, speedMps: 30, log });
    expect(cue?.id).toBe("a");
  });

  it("проехал мимо — догонять поздно, фраза снимается молча", () => {
    const log = new StopVoiceLog();
    expect(stopCue({ travelled: 5100, stops, alertMeters: 1500, speedMps: 0, log })).toBeNull();
  });

  it("о неотмеченных точках не говорит вовсе", () => {
    const log = new StopVoiceLog();
    expect(stopCue({ travelled: 4000, stops: [], alertMeters: 1500, speedMps: 0, log })).toBeNull();
  });

  it("ближайшая впереди важнее дальней", () => {
    const log = new StopVoiceLog();
    const cue = stopCue({ travelled: 39000, stops, alertMeters: 1500, speedMps: 0, log });
    expect(cue?.id).toBe("b");
  });
});
