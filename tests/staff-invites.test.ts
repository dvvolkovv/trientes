import { describe, it, expect } from "vitest";
import {
  accessReviewAt,
  buildStaffInviteUrl,
  hashInviteToken,
  parseGrants,
} from "@/lib/staff/invites";

describe("приглашение сотрудника", () => {
  it("в базу идёт хэш, а не ссылка", () => {
    const h = hashInviteToken("abc");
    expect(h).toHaveLength(64);
    expect(h).not.toContain("abc");
    expect(hashInviteToken("abc")).toBe(h);
  });

  it("пакет прав отвергает чужую очередь и чужой уровень", () => {
    expect(parseGrants([{ queue: "coinCards", level: "APPROVE" }]).ok).toBe(true);
    expect(parseGrants([{ queue: "wat", level: "APPROVE" }]).ok).toBe(false);
    expect(parseGrants([{ queue: "coinCards", level: "GOD" }]).ok).toBe(false);
    expect(parseGrants([]).ok).toBe(false); // приглашение без прав бессмысленно
  });

  it("негодный срок права отвергается вслух", () => {
    const bad = parseGrants([{ queue: "kyb", level: "VIEW", expiresAt: "никогда" }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("bad_date");
  });

  it("одна очередь дважды — ошибка: уровень был бы неоднозначен", () => {
    const dup = parseGrants([
      { queue: "kyb", level: "VIEW" },
      { queue: "kyb", level: "APPROVE" },
    ]);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toBe("duplicate_queue");
  });

  it("ссылка ведёт на язык приглашающего и несёт сам токен", () => {
    expect(buildStaffInviteUrl("https://trientes.org/", "ru", "tok")).toBe(
      "https://trientes.org/ru/staff-invite/tok",
    );
  });

  it("пересмотр доступа назначается через полгода", () => {
    expect(accessReviewAt(new Date("2026-11-18T00:00:00Z")).toISOString()).toContain("2027-05-18");
  });
});
