import { describe, expect, it } from "vitest";
import { AUTOMATION_EVENTS, EVENT_VARS, eventVars } from "@/lib/automation/events";
import {
  MAX_RULES,
  TRIGGER_CONDITIONS,
  conditionsFor,
  dueFromDays,
  parseConditions,
  renderTemplate,
  ruleMatches,
  validateRule,
  type RuleRow,
} from "@/lib/automation/rules";
import { crossedThresholds } from "@/lib/automation/stock-events";
import {
  RETRY_MINUTES,
  deliveryVerdict,
  isPrivateAddress,
  nextAttemptAt,
  parseWebhookEvents,
  signPayload,
  verifySignature,
  webhookUrlReason,
} from "@/lib/automation/webhooks";

/**
 * Границы автоматизации (слайс CO). Правила чистые ровно затем, чтобы их можно было
 * проверить тестом: ошибка в условиях видна только через сутки живого прогона, а ошибка
 * в проверке адреса — это дверь в нашу собственную сеть.
 */

const RULE: RuleRow = {
  id: "r1",
  trigger: "SALE_RECORDED",
  conditions: {},
  action: "NOTIFY_MEMBER",
  params: { text: "x", userIds: [] },
  enabled: true,
};

describe("совпадение правила", () => {
  it("выключенное правило не срабатывает никогда", () => {
    expect(ruleMatches({ ...RULE, enabled: false }, "SALE_RECORDED", { total: 100 })).toBe(false);
  });

  it("чужой триггер не срабатывает", () => {
    expect(ruleMatches(RULE, "STOCK_OUT", {})).toBe(false);
  });

  it("порог суммы считается «не меньше»", () => {
    const rule = { ...RULE, conditions: { minTotal: 1000 } };
    expect(ruleMatches(rule, "SALE_RECORDED", { total: 1200 })).toBe(true);
    expect(ruleMatches(rule, "SALE_RECORDED", { total: 1000 })).toBe(true);
    expect(ruleMatches(rule, "SALE_RECORDED", { total: 900 })).toBe(false);
    // Нет суммы вовсе — условие не выполнено: ноль вместо неизвестного числа врал бы.
    expect(ruleMatches(rule, "SALE_RECORDED", {})).toBe(false);
  });

  it("условия складываются через И", () => {
    const rule = { ...RULE, conditions: { minTotal: 100, payment: "CASH" } };
    expect(ruleMatches(rule, "SALE_RECORDED", { total: 200, payment: "CASH" })).toBe(true);
    expect(ruleMatches(rule, "SALE_RECORDED", { total: 200, payment: "CARD" })).toBe(false);
  });

  it("товар у чека ищется и в строках", () => {
    const rule = { ...RULE, conditions: { productId: "p1" } };
    expect(
      ruleMatches(rule, "SALE_RECORDED", { lines: [{ productId: "p1", name: "чай", qty: 1 }] }),
    ).toBe(true);
    expect(
      ruleMatches(rule, "SALE_RECORDED", { lines: [{ productId: "p2", name: "кофе", qty: 1 }] }),
    ).toBe(false);
  });

  it("условие, которого триггер не читает, не отсекает события", () => {
    // Триггер сменили, а условие осталось в JSONB: молча считать его нельзя — оно
    // беззвучно отсекало бы все события.
    const rule = { ...RULE, trigger: "CUSTOMER_MESSAGE" as const, conditions: { minTotal: 1000 } };
    expect(ruleMatches(rule, "CUSTOMER_MESSAGE", {})).toBe(true);
    expect(conditionsFor("CUSTOMER_MESSAGE", { minTotal: 1000 })).toEqual({});
  });

  it("негодные условия из базы отбрасываются, а не считаются «чем-нибудь»", () => {
    expect(parseConditions({ minTotal: "много", pointId: "  ", nope: 1 })).toEqual({});
    expect(parseConditions({ minTotal: 10, pointId: " p1 " })).toEqual({ minTotal: 10, pointId: "p1" });
  });

  it("у каждого триггера есть свой набор условий и подстановок", () => {
    for (const kind of AUTOMATION_EVENTS) {
      expect(TRIGGER_CONDITIONS[kind], kind).toBeDefined();
      expect(EVENT_VARS[kind].length, kind).toBeGreaterThan(0);
    }
  });
});

describe("подстановки", () => {
  it("знакомое подставляется, незнакомое остаётся словом человека", () => {
    const vars = eventVars({ productName: "чай", warehouseName: "полка" });
    expect(renderTemplate("Пополнить {product} на {warehouse}", vars)).toBe("Пополнить чай на полка");
    expect(renderTemplate("Смотри {foo}", vars)).toBe("Смотри {foo}");
  });

  it("пустое поле даёт пустую строку, а не слово null", () => {
    expect(eventVars({}).product).toBe("");
    expect(eventVars({ number: 7 }).number).toBe("#7");
  });
});

describe("проверка правила", () => {
  const base = { name: "Правило", trigger: "STOCK_OUT", action: "CREATE_TASK", conditions: {} };

  it("задача требует заголовка, уведомление — текста", () => {
    expect(validateRule({ ...base, params: { title: "" } }, { ruleCount: 0 })).toMatchObject({
      reason: "title_required",
    });
    expect(
      validateRule({ ...base, action: "NOTIFY_MEMBER", params: { text: "" } }, { ruleCount: 0 }),
    ).toMatchObject({ reason: "text_required" });
  });

  it("потолок правил считается до записи", () => {
    expect(validateRule({ ...base, params: { title: "ok" } }, { ruleCount: MAX_RULES })).toMatchObject({
      reason: "too_many_rules",
    });
  });

  it("срок — целое число дней", () => {
    expect(
      validateRule({ ...base, params: { title: "ok", dueDays: "1.5" } }, { ruleCount: 0 }),
    ).toMatchObject({ reason: "due_invalid" });
    const ok = validateRule({ ...base, params: { title: "ok", dueDays: "2" } }, { ruleCount: 0 });
    expect(ok.ok).toBe(true);
  });

  it("срок считается от конца дня", () => {
    const due = dueFromDays(1, new Date("2026-11-26T10:00:00Z"));
    expect(due?.toISOString()).toBe("2026-11-27T23:59:59.999Z");
    expect(dueFromDays(null, new Date())).toBeNull();
  });
});

describe("пересечение порога остатка", () => {
  it("событие рождается один раз — на пересечении", () => {
    const first = crossedThresholds([
      { warehouseId: "w", productId: "p", before: 1, after: 0, minQty: 0 },
    ]);
    expect(first).toHaveLength(1);
    expect(first[0]!.kind).toBe("STOCK_OUT");
    // Вторая продажа того же кончившегося товара события не даёт: иначе десять продаж
    // дают десять задач.
    expect(crossedThresholds([{ warehouseId: "w", productId: "p", before: 0, after: 0, minQty: 0 }])).toEqual([]);
  });

  it("«кончается» считается по порогу правила автозаказа", () => {
    const low = crossedThresholds([{ warehouseId: "w", productId: "p", before: 12, after: 9, minQty: 10 }]);
    expect(low[0]).toMatchObject({ kind: "STOCK_LOW", onHand: 9, minQty: 10 });
    // Порога нет — только «кончился».
    expect(crossedThresholds([{ warehouseId: "w", productId: "p", before: 12, after: 9, minQty: 0 }])).toEqual([]);
  });

  it("у кончившегося товара сообщается одно событие, а не два", () => {
    const out = crossedThresholds([{ warehouseId: "w", productId: "p", before: 12, after: 0, minQty: 10 }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("STOCK_OUT");
  });

  it("приход порога не пересекает", () => {
    expect(crossedThresholds([{ warehouseId: "w", productId: "p", before: 0, after: 40, minQty: 10 }])).toEqual([]);
  });
});

describe("адрес исходящих оповещений", () => {
  it("своя сеть отвергается", () => {
    for (const host of [
      "localhost",
      "redis.local",
      "db",
      "127.0.0.1",
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.7",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(host), host).toBe(true);
    }
  });

  it("чужой узел в интернете принимается", () => {
    for (const host of ["example.org", "hooks.example.com", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(host), host).toBe(false);
    }
  });

  it("только https и только наружу", () => {
    expect(webhookUrlReason("https://example.org/hook")).toBeNull();
    expect(webhookUrlReason("http://example.org/hook")).toBe("url_not_https");
    expect(webhookUrlReason("https://127.0.0.1/hook")).toBe("url_private");
    expect(webhookUrlReason("не адрес")).toBe("url_required");
    expect(webhookUrlReason(`https://example.org/${"x".repeat(400)}`)).toBe("url_too_long");
  });

  it("набор видов события читается строго, пустой остаётся пустым", () => {
    expect(parseWebhookEvents(["SALE_RECORDED", "NOPE", "SALE_RECORDED"])).toEqual(["SALE_RECORDED"]);
    expect(parseWebhookEvents(null)).toEqual([]);
  });
});

describe("подпись и повторы", () => {
  const body = JSON.stringify({ id: "e1", type: "SALE_RECORDED" });
  const secret = "whsec_test";

  it("подпись сходится у принимающей стороны", () => {
    const now = 1_764_100_000_000;
    const header = signPayload(body, secret, now);
    expect(verifySignature(header, body, secret, now)).toBe(true);
  });

  it("чужой секрет, чужое тело и старое время не проходят", () => {
    const now = 1_764_100_000_000;
    const header = signPayload(body, secret, now);
    expect(verifySignature(header, body, "whsec_other", now)).toBe(false);
    expect(verifySignature(header, `${body} `, secret, now)).toBe(false);
    // Повтор через сутки — это и есть то, от чего защищает время в подписи.
    expect(verifySignature(header, body, secret, now + 86_400_000)).toBe(false);
  });

  it("4xx — ответ службы, 5xx и обрыв — связь", () => {
    expect(deliveryVerdict(200)).toBe("delivered");
    expect(deliveryVerdict(204)).toBe("delivered");
    expect(deliveryVerdict(404)).toBe("dropped");
    expect(deliveryVerdict(403)).toBe("dropped");
    expect(deliveryVerdict(429)).toBe("retry");
    expect(deliveryVerdict(408)).toBe("retry");
    expect(deliveryVerdict(500)).toBe("retry");
    expect(deliveryVerdict(null)).toBe("retry");
  });

  it("повторы расходятся по времени и кончаются", () => {
    const now = new Date("2026-11-26T10:00:00Z");
    expect(nextAttemptAt(1, now)?.toISOString()).toBe("2026-11-26T10:01:00.000Z");
    expect(nextAttemptAt(RETRY_MINUTES.length, now)).not.toBeNull();
    expect(nextAttemptAt(RETRY_MINUTES.length + 1, now)).toBeNull();
  });
});
