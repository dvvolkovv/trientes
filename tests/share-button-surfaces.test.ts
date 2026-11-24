import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import en from "../messages/en.json";
import { SHARE_TARGETS } from "@/lib/share-targets";

/**
 * Ссылку приглашения показывают три экрана. Кнопка «Поделиться», забытая в
 * одном из них, видна только тому, кто туда зайдёт, — поэтому граница здесь, а
 * не в живом прогоне (тот же приём, что `cabinet-back-button.test.ts`).
 */
const SURFACES = [
  "src/components/business/invite-links.tsx",
  "src/components/coin-card-manage/invite-links.tsx",
  "src/components/admin/staff-invite-form.tsx",
];

describe("ссылка приглашения отдаётся «Поделиться»", () => {
  for (const file of SURFACES) {
    it(file, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain('from "@/components/share-button"');
      expect(src).toContain("<ShareButton");
    });
  }

  it("у кнопки есть слова, и у каждой цели своё название", () => {
    const share = (en as Record<string, any>).common.share;
    for (const key of ["share", "via", "close"]) expect(share[key].length).toBeGreaterThan(1);
    for (const target of SHARE_TARGETS) {
      expect(share.target[target.key].length).toBeGreaterThan(1);
    }
    // Слов для исчезнувшей цели быть не должно: подпись без цели однажды
    // окажется на кнопке, которой нет.
    expect(Object.keys(share.target).sort()).toEqual(SHARE_TARGETS.map((t) => t.key).sort());
  });

  it("каждому экрану есть что сказать в приглашении", () => {
    const m = en as Record<string, any>;
    for (const node of [
      m.business.members.invites,
      m.coinCard.team.invites,
      m.admin.staff.invite,
    ]) {
      expect(node.shareTitle.length).toBeGreaterThan(5);
      expect(node.shareText.length).toBeGreaterThan(20);
    }
  });
});
