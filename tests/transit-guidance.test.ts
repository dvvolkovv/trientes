import { describe, expect, it } from "vitest";
import type { TransitLeg } from "@/lib/crypto-map";
import { VoiceLog } from "@/lib/nav-voice";
import {
  SpokenPhrases,
  activeLeg,
  departureCue,
  legSpans,
  nextTransitCue,
  stopOffsets,
  transitCue,
  vehicleKey,
} from "@/lib/transit-guidance";

// Линия вдоль одной широты: градус долготы здесь ≈ 71,7 км, так что метры
// считаются одной формулой и в тесте, и в коде — числа сравниваются с допуском.
const LAT = 50.09;

function leg(i: Partial<TransitLeg> & { coordinates: [number, number][] }): TransitLeg {
  return {
    mode: "WALK",
    line: null,
    from: null,
    to: null,
    duration: 0,
    dashed: true,
    color: "#8a8f98",
    meters: 0,
    headsign: null,
    agency: null,
    fromPoint: null,
    toPoint: null,
    fromTrack: null,
    toTrack: null,
    startTime: null,
    endTime: null,
    realTime: false,
    stops: [],
    walkSteps: [],
    ...i,
  };
}

/**
 * Точка в `m` метрах к востоку от нулевой долготы на широте LAT. Радиус тот
 * же, которым меряет `haversineMeters` — иначе метры теста и метры кода
 * расходятся на процент, а на километре это уже пятнадцать метров.
 */
function east(m: number): [number, number] {
  const mPerDeg = ((Math.PI / 180) * 6_371_000 * Math.cos((LAT * Math.PI) / 180));
  return [m / mPerDeg, LAT];
}

// Пеший подход 300 м → метро три остановки (900 м) → пешком 200 м до цели.
function itinerary(): TransitLeg[] {
  return [
    leg({
      mode: "WALK",
      coordinates: [east(0), east(300)],
      meters: 300,
      to: "Staroměstská",
      walkSteps: [{ direction: "CONTINUE", streetName: "Kaprova", distance: 300, level: null }],
    }),
    leg({
      mode: "SUBWAY",
      dashed: false,
      line: "A",
      from: "Staroměstská",
      to: "Dejvická",
      fromTrack: "2",
      headsign: "Nemocnice Motol",
      coordinates: [east(300), east(600), east(900), east(1200)],
      meters: 900,
      stops: [
        { name: "Malostranská", lat: LAT, lon: east(600)[0], arrival: null },
        { name: "Hradčanská", lat: LAT, lon: east(900)[0], arrival: null },
      ],
    }),
    leg({
      mode: "WALK",
      coordinates: [east(1200), east(1400)],
      meters: 200,
      from: "Dejvická",
    }),
  ];
}

describe("legSpans", () => {
  it("lays legs out along the stitched line", () => {
    const spans = legSpans(itinerary());
    expect(spans).toHaveLength(3);
    expect(spans[0].start).toBe(0);
    expect(spans[0].end).toBeCloseTo(300, 0);
    expect(spans[1].end).toBeCloseTo(1200, 0);
    expect(spans[2].end).toBeCloseTo(1400, 0);
  });

  it("counts the gap when two legs do not share an endpoint", () => {
    const spans = legSpans([
      leg({ coordinates: [east(0), east(100)] }),
      leg({ coordinates: [east(150), east(250)] }),
    ]);
    // Разрыв 50 м принадлежит сшитой линии, иначе продвижение уехало бы вперёд.
    expect(spans[1].start).toBeCloseTo(150, 0);
    expect(spans[1].end).toBeCloseTo(250, 0);
  });
});

describe("activeLeg", () => {
  const spans = legSpans(itinerary());

  it("names the leg being travelled and the distance to its end", () => {
    const a = activeLeg(100, spans)!;
    expect(a.index).toBe(0);
    expect(a.metersToEnd).toBeCloseTo(200, 0);
    expect(activeLeg(700, spans)!.index).toBe(1);
    expect(activeLeg(1300, spans)!.index).toBe(2);
  });

  it("clamps past the end instead of returning nothing", () => {
    const a = activeLeg(99_999, spans)!;
    expect(a.index).toBe(2);
    expect(a.metersToEnd).toBe(0);
  });
});

describe("stopOffsets", () => {
  it("places intermediate stops along the leg geometry", () => {
    const offsets = stopOffsets(itinerary()[1]);
    expect(offsets).toHaveLength(2);
    expect(offsets[0]).toBeCloseTo(300, 0);
    expect(offsets[1]).toBeCloseTo(600, 0);
  });

  it("is empty for a walking connector", () => {
    expect(stopOffsets(itinerary()[0])).toEqual([]);
  });
});

describe("transitCue", () => {
  const legs = itinerary();
  const spans = legSpans(legs);
  const cue = (travelled: number) => transitCue({ travelled, legs, spans })!;

  it("walks the first leg towards the boarding stop", () => {
    const c = cue(50);
    expect(c.kind).toBe("walk");
    expect(c.stopName).toBe("Staroměstská");
    expect(c.distanceMeters).toBeCloseTo(250, 0);
    expect(c.stopsLeft).toBeNull();
  });

  it("switches to boarding at the stop itself", () => {
    const c = cue(295);
    expect(c.kind).toBe("board");
    expect(c.nextLeg?.line).toBe("A");
    expect(c.nextLeg?.headsign).toBe("Nemocnice Motol");
    expect(c.stopName).toBe("Staroměstská");
  });

  it("counts stops to the exit while riding", () => {
    const riding = cue(350);
    expect(riding.kind).toBe("ride");
    expect(riding.stopName).toBe("Dejvická");
    expect(riding.stopsLeft).toBe(3);
    expect(cue(650).stopsLeft).toBe(2);
  });

  it("warns one stop ahead, then says to get off", () => {
    expect(cue(950).kind).toBe("alightNext");
    expect(cue(950).stopsLeft).toBe(1);
    expect(cue(1190).kind).toBe("alight");
  });

  it("walks the last leg to the destination, with no stop name", () => {
    const c = cue(1250);
    expect(c.kind).toBe("walk");
    expect(c.stopName).toBeNull();
    expect(c.distanceMeters).toBeCloseTo(150, 0);
  });

  it("returns nothing without legs", () => {
    expect(transitCue({ travelled: 0, legs: [], spans: [] })).toBeNull();
  });
});

describe("nextTransitCue", () => {
  const legs = itinerary();
  const spans = legSpans(legs);

  it("says each thing once per leg, however the GPS jitters", () => {
    const log = new VoiceLog();
    const said: string[] = [];
    for (const travelled of [10, 40, 60, 200, 260, 295, 298, 350, 400, 650, 950, 1000, 1190, 1250, 1390]) {
      const a = nextTransitCue({ travelled, legs, spans, speedMps: 1.4, log });
      if (a) said.push(`${a.cue.legIndex}:${a.cue.kind}`);
    }
    expect(said).toEqual([
      "0:walk", // «идите 290 м до Staroměstská» — полоса «далеко»
      "0:walk", // ближе — та же цель, другая полоса
      "0:walk",
      "0:board",
      "1:ride",
      "1:alightNext",
      "1:alight",
      "2:walk",
    ]);
  });

  it("lets the arrival phrase close the last leg alone", () => {
    const log = new VoiceLog();
    // Последняя нога объявляется издалека, а вплотную к цели молчит: ведение
    // само говорит «вы приехали» за двадцать пять метров, и вторая фраза
    // поверх неё была бы той же мыслью другими словами.
    expect(nextTransitCue({ travelled: 1250, legs, spans, speedMps: 1.4, log })).not.toBeNull();
    expect(nextTransitCue({ travelled: 1392, legs, spans, speedMps: 1.4, log })).toBeNull();
  });

  it("ignores a position that walked backwards", () => {
    const log = new VoiceLog();
    expect(nextTransitCue({ travelled: 700, legs, spans, speedMps: 8, log })).not.toBeNull();
    // Отсчёт вернулся в пешую ногу: прежде сказанное к ней не относится,
    // но и повторять его нельзя.
    expect(nextTransitCue({ travelled: 100, legs, spans, speedMps: 8, log })).toBeNull();
  });

  it("stays silent when the leg end is still far away", () => {
    const log = new VoiceLog();
    const long = [leg({ coordinates: [east(0), east(4000)], meters: 4000, to: "Far stop" })];
    expect(
      nextTransitCue({ travelled: 0, legs: long, spans: legSpans(long), speedMps: 1.4, log }),
    ).toBeNull();
  });
});

describe("departureCue", () => {
  it("speaks the first leg however long it is, and only once", () => {
    const legs = [leg({ coordinates: [east(0), east(4000)], meters: 4000, to: "Far stop" })];
    const spans = legSpans(legs);
    const log = new VoiceLog();
    const d = departureCue(legs, spans, log);
    expect(d?.kind).toBe("walk");
    expect(d?.stopName).toBe("Far stop");
    expect(nextTransitCue({ travelled: 5, legs, spans, speedMps: 1.4, log })).toBeNull();
  });
});

describe("vehicleKey", () => {
  it("names the vehicle a passenger would name", () => {
    expect(vehicleKey("SUBWAY")).toBe("metro");
    expect(vehicleKey("METRO")).toBe("metro");
    expect(vehicleKey("BUS")).toBe("bus");
    expect(vehicleKey("COACH")).toBe("bus");
    expect(vehicleKey("TRAM")).toBe("tram");
    expect(vehicleKey("REGIONAL_RAIL")).toBe("rail");
    expect(vehicleKey("FERRY")).toBe("ferry");
    expect(vehicleKey("WALK")).toBe("walk");
    expect(vehicleKey("CABLE_CAR")).toBe("transit");
  });
});

describe("SpokenPhrases", () => {
  it("does not say the same sentence twice in a row", () => {
    const log = new SpokenPhrases();
    expect(log.claim("Идите 20 м до Staroměstská")).toBe(true);
    expect(log.claim("Идите 20 м до Staroměstská")).toBe(false);
    expect(log.claim("Садитесь на метро A")).toBe(true);
    // Через другую фразу прежняя снова имеет смысл: это новая мысль.
    expect(log.claim("Идите 20 м до Staroměstská")).toBe(true);
  });

  it("forgets everything on a new route", () => {
    const log = new SpokenPhrases();
    log.claim("Идите 20 м");
    log.reset();
    expect(log.claim("Идите 20 м")).toBe(true);
  });
});
