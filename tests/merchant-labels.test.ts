import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { TEAM_SECTIONS, ROLE_TEMPLATES } from "@/lib/company-team/permissions";
import type { CompanyAction } from "@/lib/company-team/journal";
import { COMPANY_TILES, COMPANY_GROUPS } from "@/lib/cabinet/company-nav";

/**
 * Код без слов выходит на экран кодом. Живой прогон BF поймал ровно это:
 * журнал предприятия показывал `TASK_CREATED` вместо фразы. Тест держит границу
 * «новому коду положены слова» для разделов прав, шаблонов ролей и журнала.
 */

// Список читается из типа `CompanyAction` руками: тип в рантайме не существует, а
// сверять коды с базой нельзя — журнал неизменяем и старый код обязан остаться читаемым.
const ACTIONS: CompanyAction[] = [
  "PROFILE_SAVED", "PROFILE_CHANGES_SUBMITTED", "POINT_SUBMITTED", "POINT_UPDATED", "POINT_CLAIMED",
  "PRODUCT_CREATED", "PRODUCT_UPDATED", "PRODUCT_EDIT_REVERTED", "PRODUCT_CLAIM_SUBMITTED",
  "PRODUCT_REVISION_DECIDED", "PRODUCT_REVISION_WITHDRAWN",
  "OFFER_SAVED", "OFFER_STATUS_SET", "OFFER_DELETED",
  "CASHBACK_BASE_SET", "CASHBACK_CATEGORY_SET",
  "WAREHOUSE_CREATED", "WAREHOUSE_RENAMED", "WAREHOUSE_ARCHIVED", "WAREHOUSE_RESTORED",
  "MOVEMENT_RECORDED", "MOVEMENT_RECEIVED", "MOVEMENT_CANCELLED",
  "MEMBER_ADDED", "MEMBER_ROLE_SET", "MEMBER_POINTS_SET", "MEMBER_REMOVED",
  "TEAM_ROLE_SAVED", "TEAM_ROLE_DELETED",
  "INVITE_CREATED", "INVITE_REVOKED", "INVITE_ACCEPTED",
  "TASK_CREATED", "TASK_UPDATED", "TASK_STATUS_SET", "TASK_CANCELLED", "TASK_COMMENTED",
  "PROMO_CREATED", "PROMO_UPDATED", "PROMO_ARCHIVED", "PROMO_SENT", "PROMO_RESTORED",
  "SUPPLIER_SAVED", "SUPPLIER_ARCHIVED", "SUPPLIER_RESTORED",
  "ORDER_CREATED", "ORDER_SENT", "ORDER_CONFIRMED", "ORDER_DECLINED", "ORDER_SHIPPED",
  "ORDER_RECEIVED", "ORDER_CLOSED", "ORDER_CANCELLED", "ORDER_DOC_ADDED",
  "REORDER_RULE_SAVED", "REORDER_RULE_DELETED",
];

describe("подписи разделов и журнала", () => {
  it("у каждого раздела прав есть название в переводах", () => {
    const labels = (en as Record<string, any>).cabinetTeam.roles.sections as Record<string, string>;
    for (const section of TEAM_SECTIONS) expect(labels[section], section).toBeTruthy();
  });

  it("у каждого раздела прав есть плитка в кабинете", () => {
    // Раздел, который человеку видно, но до которого в кабинете не добраться, —
    // право без двери. Карта плиток (слайс BM) и есть эта проверка: `card` своей
    // плитки не имеет намеренно — он живёт самой страницей предприятия.
    const covered = new Set<string>(COMPANY_TILES.map((t) => t.section));
    covered.add("card");
    for (const section of TEAM_SECTIONS) expect(covered.has(section), section).toBe(true);
  });

  it("у каждой плитки есть подпись, единица и знакомая группа", () => {
    const business = (en as Record<string, any>).business as Record<string, any>;
    const groups = new Set<string>(COMPANY_GROUPS);
    for (const tile of COMPANY_TILES) {
      expect(business.tiles[tile.key], `tiles.${tile.key}`).toBeTruthy();
      expect(business.tileUnit[tile.key], `tileUnit.${tile.key}`).toBeTruthy();
      expect(groups.has(tile.group), tile.group).toBe(true);
    }
  });

  it("у каждой группы есть название и пояснение", () => {
    const business = (en as Record<string, any>).business as Record<string, any>;
    for (const group of COMPANY_GROUPS) {
      expect(business.groups[group], `groups.${group}`).toBeTruthy();
      expect(business.groupHint[group], `groupHint.${group}`).toBeTruthy();
    }
  });

  it("в переводах нет подписей для плиток, которых в коде больше нет", () => {
    const business = (en as Record<string, any>).business as Record<string, any>;
    const keys = new Set<string>(COMPANY_TILES.map((t) => t.key));
    expect(Object.keys(business.tiles).filter((k) => !keys.has(k))).toEqual([]);
    expect(Object.keys(business.tileUnit).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("у каждого шаблона роли есть название и только знакомые разделы", () => {
    const names = (en as Record<string, any>).cabinetTeam.roles.templates as Record<string, string>;
    const known = new Set<string>(TEAM_SECTIONS);
    for (const template of ROLE_TEMPLATES) {
      expect(names[template.key], template.key).toBeTruthy();
      for (const section of Object.keys(template.permissions)) expect(known.has(section), section).toBe(true);
    }
  });

  it("у каждого кода журнала есть фраза", () => {
    const labels = (en as Record<string, any>).cabinetJournal.actions as Record<string, string>;
    for (const action of ACTIONS) expect(labels[action], action).toBeTruthy();
  });

  it("в переводах нет фраз для кодов, которых в коде больше нет", () => {
    const labels = (en as Record<string, any>).cabinetJournal.actions as Record<string, string>;
    expect(Object.keys(labels).filter((k) => !ACTIONS.includes(k as CompanyAction))).toEqual([]);
  });
});
