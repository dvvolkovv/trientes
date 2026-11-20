import { describe, expect, it } from "vitest";
import {
  WEEK_DAYS,
  openStateAt,
  parseWeekHours,
  isEmptyWeek,
  type WeekHours,
} from "@/lib/opening-hours";

const nineToSix: WeekHours = {
  mon: { kind: "open", spans: [["09:00", "13:00"], ["14:00", "18:00"]] },
  tue: { kind: "open", spans: [["09:00", "18:00"]] },
  wed: { kind: "open", spans: [["09:00", "18:00"]] },
  thu: { kind: "open", spans: [["09:00", "18:00"]] },
  fri: { kind: "open", spans: [["09:00", "18:00"]] },
  sat: { kind: "allday" },
  sun: { kind: "closed" },
};

// 2026-11-23 — понедельник. Пояс Праги: зимой UTC+1.
const mondayNoonUtc = new Date("2026-11-23T11:00:00Z"); // 12:00 в Праге
const mondayLunchUtc = new Date("2026-11-23T12:30:00Z"); // 13:30 в Праге
const sundayUtc = new Date("2026-11-22T11:00:00Z"); // воскресенье 12:00 в Праге

describe("часы работы", () => {
  it("внутри промежутка — открыто и видно, до какого часа", () => {
    const s = openStateAt(nineToSix, "Europe/Prague", mondayNoonUtc);
    expect(s).toMatchObject({ known: true, open: true, until: "13:00" });
  });

  it("обед — закрыто и видно, когда откроется", () => {
    const s = openStateAt(nineToSix, "Europe/Prague", mondayLunchUtc);
    expect(s).toMatchObject({ known: true, open: false, opensAt: "14:00" });
    expect(s.opensDay).toBe("mon"); // откроется сегодня же
  });

  it("закрытый день отправляет к следующему открытому", () => {
    const s = openStateAt(nineToSix, "Europe/Prague", sundayUtc);
    expect(s).toMatchObject({ known: true, open: false, opensAt: "09:00", opensDay: "mon" });
  });

  it("круглосуточно — открыто в любой час", () => {
    const saturdayNight = new Date("2026-11-21T02:00:00Z");
    const s = openStateAt(nineToSix, "Europe/Prague", saturdayNight);
    expect(s).toMatchObject({ known: true, open: true });
    expect(s.until).toBeUndefined(); // круглосуточно не закрывается
  });

  it("промежуток через полночь держит открытым после полуночи", () => {
    const bar: WeekHours = {
      mon: { kind: "open", spans: [["22:00", "02:00"]] },
      tue: { kind: "closed" },
      wed: { kind: "closed" },
      thu: { kind: "closed" },
      fri: { kind: "closed" },
      sat: { kind: "closed" },
      sun: { kind: "closed" },
    };
    // вторник 01:00 в Праге — это ночь понедельника
    const s = openStateAt(bar, "Europe/Prague", new Date("2026-11-24T00:00:00Z"));
    expect(s).toMatchObject({ known: true, open: true, until: "02:00" });
  });

  it("без пояса состояние не считается, а расписание остаётся", () => {
    const s = openStateAt(nineToSix, null, mondayNoonUtc);
    expect(s.known).toBe(false);
    expect(s.open).toBeUndefined();
  });

  it("негодный пояс — то же «не знаю», а не падение", () => {
    const s = openStateAt(nineToSix, "Nowhere/Nothing", mondayNoonUtc);
    expect(s.known).toBe(false);
  });

  // Семь закрытых дней — это не «закрыто навсегда», а расписание, из которого
  // ничего не следует: точка стоит на карте, и постоянное «закрыто» было бы либо
  // ложью, либо бессмыслицей. Такое расписание не принимается при вводе
  // (`hours_empty`), а если оно всё же в базе — состояние не показывается.
  it("закрытая всю неделю точка состояния не показывает", () => {
    const never: WeekHours = Object.fromEntries(
      WEEK_DAYS.map((d) => [d, { kind: "closed" as const }]),
    ) as WeekHours;
    expect(openStateAt(never, "Europe/Prague", mondayNoonUtc).known).toBe(false);
    expect(isEmptyWeek(never)).toBe(true);
  });

  it("пустое расписание — состояния нет вовсе", () => {
    expect(openStateAt(null, "Europe/Prague", mondayNoonUtc).known).toBe(false);
    expect(isEmptyWeek(null)).toBe(true);
    expect(isEmptyWeek(nineToSix)).toBe(false);
  });
});

describe("разбор сохранённого расписания", () => {
  it("читает своё же представление", () => {
    expect(parseWeekHours(JSON.parse(JSON.stringify(nineToSix)))).toEqual(nineToSix);
  });

  it("мусор даёт пусто, а не падение", () => {
    expect(parseWeekHours(null)).toBeNull();
    expect(parseWeekHours("09:00-18:00")).toBeNull();
    expect(parseWeekHours({ mon: { kind: "open", spans: [["99:99", "x"]] } })).toBeNull();
  });

  it("день без промежутков считается закрытым, а не открытым навсегда", () => {
    expect(parseWeekHours({ mon: { kind: "open", spans: [] } })).toEqual({
      mon: { kind: "closed" },
    });
  });

  it("перевёрнутый промежуток внутри суток не теряется — это ночь", () => {
    const parsed = parseWeekHours({ fri: { kind: "open", spans: [["22:00", "02:00"]] } });
    expect(parsed).toEqual({ fri: { kind: "open", spans: [["22:00", "02:00"]] } });
  });

  it("одинаковые концы промежутка отбрасываются", () => {
    expect(parseWeekHours({ fri: { kind: "open", spans: [["10:00", "10:00"]] } })).toEqual({
      fri: { kind: "closed" },
    });
  });
});
