import { describe, expect, it } from "vitest";
import type { RouteStep } from "@/lib/crypto-map";
import { announcementBand, cumulativeEnds, activeStep } from "@/lib/route-steps";
import { VoiceLog, departureAnnouncement, nextAnnouncement } from "@/lib/nav-voice";

const step = (p: Partial<RouteStep> & { distance: number }): RouteStep => ({
  type: "turn",
  modifier: "right",
  name: null,
  exit: null,
  location: [14.4, 50.0],
  ...p,
});

describe("announcementBand — пороги растут со скоростью", () => {
  it("стоящему на месте порог остаётся метровым", () => {
    expect(announcementBand(151, "car", 0)).toBe("far");
    expect(announcementBand(31, "car", 0)).toBe("near");
    expect(announcementBand(30, "car", 0)).toBe("now");
    expect(announcementBand(1201, "car", 0)).toBeNull();
    expect(announcementBand(1200, "car", 0)).toBe("continue");
  });

  it("на 90 км/ч «сейчас» приходит за сто метров, а не за тридцать", () => {
    const mps = 25; // 90 км/ч
    expect(announcementBand(100, "car", mps)).toBe("now");
    expect(announcementBand(101, "car", mps)).toBe("near");
  });

  it("пешеходу скорость порогов почти не двигает", () => {
    expect(announcementBand(16, "walk", 1.4)).toBe("near");
    expect(announcementBand(15, "walk", 1.4)).toBe("now");
  });

  it("транспорт считается как пешком — манёвров у него нет", () => {
    expect(announcementBand(120, "transit", 0)).toBe("far");
  });
});

describe("VoiceLog — одна полоса шага произносится один раз", () => {
  it("вторую попытку той же полосы отклоняет", () => {
    const log = new VoiceLog();
    expect(log.claim(2, "far")).toBe(true);
    expect(log.claim(2, "far")).toBe(false);
  });

  it("следующая полоса того же шага проходит", () => {
    const log = new VoiceLog();
    log.claim(2, "far");
    expect(log.claim(2, "near")).toBe(true);
  });

  it("смена шага открывает полосы заново", () => {
    const log = new VoiceLog();
    log.claim(2, "now");
    expect(log.claim(3, "now")).toBe(true);
  });

  it("возврат на прежний шаг не переигрывает сказанное", () => {
    const log = new VoiceLog();
    log.claim(2, "far");
    log.claim(3, "far");
    // GPS дёрнулся назад: шаг 2 уже пройден, повторять его нечего.
    expect(log.claim(2, "far")).toBe(false);
  });

  it("сброс нужен пересчёту: новый маршрут — новые манёвры", () => {
    const log = new VoiceLog();
    log.claim(2, "far");
    log.reset();
    expect(log.claim(2, "far")).toBe(true);
  });
});

describe("nextAnnouncement", () => {
  const steps = [step({ distance: 2000, type: "depart" }), step({ distance: 500 }), step({ distance: 0, type: "arrive" })];
  const ends = cumulativeEnds(steps);

  it("молчит, пока манёвр дальше самой широкой полосы", () => {
    const log = new VoiceLog();
    expect(nextAnnouncement({ travelled: 0, ends, steps, mode: "car", speedMps: 0, log })).toBeNull();
  });

  it("на длинном перегоне напоминает «продолжайте движение»", () => {
    const log = new VoiceLog();
    const a = nextAnnouncement({ travelled: 900, ends, steps, mode: "car", speedMps: 0, log });
    expect(a?.band).toBe("continue");
  });

  it("на подходе называет манёвр и расстояние", () => {
    const log = new VoiceLog();
    const a = nextAnnouncement({ travelled: 1700, ends, steps, mode: "car", speedMps: 0, log });
    expect(a).toEqual({ band: "far", stepIndex: 0, step: steps[1], distanceMeters: 300 });
  });

  it("повторно ту же полосу не отдаёт", () => {
    const log = new VoiceLog();
    nextAnnouncement({ travelled: 1700, ends, steps, mode: "car", speedMps: 0, log });
    expect(nextAnnouncement({ travelled: 1710, ends, steps, mode: "car", speedMps: 0, log })).toBeNull();
  });

  it("подъезд к цели объявляется — это тоже манёвр", () => {
    const log = new VoiceLog();
    expect(nextAnnouncement({ travelled: 2490, ends, steps, mode: "car", speedMps: 0, log })?.step.type).toBe(
      "arrive",
    );
  });

  it("у последнего шага манёвра впереди нет — молчим", () => {
    const log = new VoiceLog();
    expect(nextAnnouncement({ travelled: 2500, ends, steps, mode: "car", speedMps: 0, log })).toBeNull();
  });

  it("без шагов не падает", () => {
    const log = new VoiceLog();
    expect(nextAnnouncement({ travelled: 10, ends: [], steps: [], mode: "car", speedMps: 0, log })).toBeNull();
  });
});

describe("departureAnnouncement", () => {
  const steps = [step({ distance: 1000, type: "depart" }), step({ distance: 500 }), step({ distance: 0, type: "arrive" })];

  it("отправление называет первый манёвр с расстоянием до него", () => {
    expect(departureAnnouncement(steps, new VoiceLog())).toEqual({
      step: steps[1],
      distanceMeters: 1000,
    });
  });

  it("маршрут без манёвров отправления не имеет", () => {
    expect(departureAnnouncement([steps[0]], new VoiceLog())).toBeNull();
    expect(departureAnnouncement([], new VoiceLog())).toBeNull();
  });

  it("за отправлением не идёт «продолжайте движение» о том же перегоне", () => {
    const log = new VoiceLog();
    const ends = cumulativeEnds(steps);
    departureAnnouncement(steps, log);
    expect(nextAnnouncement({ travelled: 1, ends, steps, mode: "car", speedMps: 0, log })).toBeNull();
    // Полоса «далеко» того же шага при этом остаётся впереди.
    expect(nextAnnouncement({ travelled: 700, ends, steps, mode: "car", speedMps: 0, log })?.band).toBe("far");
  });
});

describe("activeStep остаётся прежним", () => {
  it("возвращает шаг, который человек проезжает", () => {
    expect(activeStep(700, [1000, 1500, 1500])).toEqual({ index: 0, distanceToManeuver: 300 });
  });
});
