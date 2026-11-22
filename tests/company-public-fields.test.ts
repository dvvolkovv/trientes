import { describe, expect, it } from "vitest";
import {
  PUBLIC_FIELD_KEYS,
  defaultPublicFields,
  parsePublicFields,
  publicFieldOn,
  toPublicFieldsJson,
} from "@/lib/company-public-fields";

const WITH_POINTS = { hasPhysicalPoints: true };
const NO_POINTS = { hasPhysicalPoints: false };

describe("набор публичных полей", () => {
  it("запись без новых ключей читается как «показывать»", () => {
    // Живой случай: у предприятий, заведённых до слайса BX, в базе лежит набор из
    // семи ключей. Новые модули обязаны включиться сами, иначе выкладка слайса
    // погасила бы монеты и фотографии у всех разом.
    const saved = {
      phone: true,
      email: true,
      hours: true,
      documents: true,
      description: true,
      returnPolicy: false,
      preciseAddress: true,
    };
    const parsed = parsePublicFields(saved, WITH_POINTS);
    expect(parsed.coins).toBe(true);
    expect(parsed.photos).toBe(true);
    expect(parsed.products).toBe(true);
    // А то, что продавец выключил, выключенным и остаётся.
    expect(parsed.returnPolicy).toBe(false);
  });

  it("выключенный модуль гасит только себя", () => {
    const parsed = parsePublicFields({ coins: false }, WITH_POINTS);
    expect(parsed.coins).toBe(false);
    expect(parsed.photos).toBe(true);
    expect(parsed.phone).toBe(true);
  });

  it("негодная запись читается как умолчание, а не роняет витрину", () => {
    for (const raw of [null, undefined, "", 42, ["coins"]]) {
      expect(parsePublicFields(raw, NO_POINTS)).toEqual(defaultPublicFields(NO_POINTS));
    }
  });

  it("точный адрес у предприятия без точек по умолчанию скрыт", () => {
    expect(defaultPublicFields(NO_POINTS).preciseAddress).toBe(false);
    expect(defaultPublicFields(WITH_POINTS).preciseAddress).toBe(true);
  });

  it("одиночный выключатель без контекста читает те же умолчания", () => {
    expect(publicFieldOn(null, "coins")).toBe(true);
    expect(publicFieldOn({ coins: false }, "coins")).toBe(false);
    expect(publicFieldOn({ coins: "нет" }, "coins")).toBe(true);
  });

  it("для записи пишутся все ключи, чтобы умолчание потом не «переехало»", () => {
    const json = toPublicFieldsJson({ coins: false }, WITH_POINTS);
    expect(Object.keys(json).sort()).toEqual([...PUBLIC_FIELD_KEYS].sort());
    expect(json.coins).toBe(false);
    expect(json.products).toBe(true);
  });
});
