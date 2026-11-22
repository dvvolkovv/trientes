import { describe, expect, it } from "vitest";
import { inheritedCoins, inheritedHours } from "@/lib/company-inherit";

const WORKWEEK = {
  mon: { kind: "open", spans: [["09:00", "18:00"]] },
  tue: { kind: "open", spans: [["09:00", "18:00"]] },
  sat: { kind: "closed" },
};
const LATE = { mon: { kind: "open", spans: [["12:00", "23:00"]] } };
const ALL_CLOSED = {
  mon: { kind: "closed" },
  tue: { kind: "closed" },
  wed: { kind: "closed" },
  thu: { kind: "closed" },
  fri: { kind: "closed" },
  sat: { kind: "closed" },
  sun: { kind: "closed" },
};

describe("часы: точка наследует предприятие", () => {
  it("свои часы точки сильнее часов предприятия", () => {
    const r = inheritedHours(
      { hours: LATE, timezone: "Europe/Prague" },
      { hours: WORKWEEK, timezone: "Europe/Zurich" },
    );
    expect(r.from).toBe("point");
    expect(r.timezone).toBe("Europe/Prague");
    expect(r.hours?.mon).toEqual({ kind: "open", spans: [["12:00", "23:00"]] });
  });

  it("пустые часы точки дают часы предприятия вместе с его поясом", () => {
    // Живой случай Arcon: часы у предприятия, у точки пусто. Пояс обязан приехать
    // тот же — иначе швейцарское расписание считалось бы по чужому времени.
    const r = inheritedHours(
      { hours: null, timezone: null },
      { hours: WORKWEEK, timezone: "Europe/Zurich" },
    );
    expect(r.from).toBe("company");
    expect(r.timezone).toBe("Europe/Zurich");
    expect(r.hours?.mon).toEqual({ kind: "open", spans: [["09:00", "18:00"]] });
  });

  it("пояс точки не прилипает к часам предприятия", () => {
    const r = inheritedHours(
      { hours: null, timezone: "Asia/Tokyo" },
      { hours: WORKWEEK, timezone: "Europe/Zurich" },
    );
    expect(r.timezone).toBe("Europe/Zurich");
  });

  it("неделя из семи «закрыто» считается пустой и наследование продолжается", () => {
    const r = inheritedHours(
      { hours: ALL_CLOSED, timezone: "Europe/Prague" },
      { hours: WORKWEEK, timezone: "Europe/Zurich" },
    );
    expect(r.from).toBe("company");
  });

  it("пусто у обоих — часов нет, и это не ошибка", () => {
    const r = inheritedHours({ hours: null, timezone: null }, { hours: null, timezone: null });
    expect(r).toEqual({ hours: null, timezone: null, from: null });
  });

  it("негодная запись в базе читается как пустота, а не роняет карточку", () => {
    const r = inheritedHours({ hours: "вчера", timezone: null }, { hours: WORKWEEK, timezone: "Europe/Zurich" });
    expect(r.from).toBe("company");
  });
});

describe("монеты: точка наследует предприятие", () => {
  it("свой набор точки сильнее", () => {
    expect(inheritedCoins(["bitcoin"], ["ethereum", "solana"])).toEqual(["bitcoin"]);
  });

  it("пустой набор точки означает «как у предприятия»", () => {
    expect(inheritedCoins([], ["ethereum", "solana"])).toEqual(["ethereum", "solana"]);
  });

  it("пусто у обоих — пусто", () => {
    expect(inheritedCoins(null, undefined)).toEqual([]);
  });

  it("мусор в списке выбрасывается, а не доезжает до карточки", () => {
    expect(inheritedCoins(["", "bitcoin"], [])).toEqual(["bitcoin"]);
  });
});
