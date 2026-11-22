import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOGO_FIT,
  DEFAULT_LOGO_SHAPE,
  companyLogoExtension,
  companyLogoFilePath,
  logoBoxClass,
  logoImageClass,
  logoFitOf,
  logoShapeOf,
} from "@/lib/company-logo";
import { companyDocExtension, companyDocFilePath, isCompanyDocKind } from "@/lib/company-docs";
import {
  defaultPublicFields,
  parsePublicFields,
  publicFieldOn,
  toPublicFieldsJson,
} from "@/lib/company-public-fields";
import { validateCompanyProfile, validateCompanyPoint } from "@/lib/company";
import { companyFieldLabelKey } from "@/lib/company-edit";

/**
 * Слайс BU. Проверяем ровно то, что иначе разошлось бы молча: правило вида
 * логотипа (одно на кабинет, витрину и каталог), опознание файла по байтам,
 * умолчания публичности и отказы проверки ввода.
 */

describe("логотип предприятия", () => {
  it("неизвестная форма и вписывание читаются как умолчание, а не как ошибка", () => {
    expect(logoShapeOf(null)).toBe(DEFAULT_LOGO_SHAPE);
    expect(logoShapeOf("octagon")).toBe(DEFAULT_LOGO_SHAPE);
    expect(logoFitOf(undefined)).toBe(DEFAULT_LOGO_FIT);
    expect(logoFitOf("stretch")).toBe(DEFAULT_LOGO_FIT);
  });

  it("окно центрирует картинку при любой форме", () => {
    for (const shape of [null, "square", "rounded", "circle"]) {
      expect(logoBoxClass(shape)).toContain("place-items-center");
    }
    expect(logoBoxClass("circle")).toContain("rounded-full");
    expect(logoBoxClass("square")).toContain("rounded-none");
  });

  it("вписывание различает «целиком» и «заполнить»", () => {
    expect(logoImageClass("contain")).toContain("object-contain");
    expect(logoImageClass("cover")).toContain("object-cover");
  });

  it("тип картинки читается по первым байтам, а svg не принимается", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const webp = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")]);
    const svg = new Uint8Array(Buffer.from("<svg xmlns="));
    expect(companyLogoExtension(png)).toBe("png");
    expect(companyLogoExtension(jpg)).toBe("jpg");
    expect(companyLogoExtension(webp)).toBe("webp");
    expect(companyLogoExtension(svg)).toBeNull();
  });

  it("стирается только наш файл этого предприятия", () => {
    const name = "a".repeat(24);
    expect(companyLogoFilePath(`/uploads/companies/c1/${name}.png`, "c1")).toContain(`${name}.png`);
    // Чужое предприятие, чужой хост и выход из каталога — не наши файлы.
    expect(companyLogoFilePath(`/uploads/companies/c2/${name}.png`, "c1")).toBeNull();
    expect(companyLogoFilePath("https://example.org/logo.png", "c1")).toBeNull();
    expect(companyLogoFilePath("/uploads/companies/c1/../../../etc/passwd", "c1")).toBeNull();
  });
});

describe("публичные документы", () => {
  it("прейскуранта в реестре нет намеренно", () => {
    expect(isCompanyDocKind("returnPolicy")).toBe(true);
    expect(isCompanyDocKind("priceList")).toBe(false);
    expect(isCompanyDocKind("")).toBe(false);
  });

  it("pdf опознаётся, svg — нет", () => {
    expect(companyDocExtension(new Uint8Array(Buffer.from("%PDF-1.7")))).toBe("pdf");
    expect(companyDocExtension(new Uint8Array(Buffer.from("<svg>")))).toBeNull();
  });

  it("путь файла собирается только под нашим корнем", () => {
    const name = "b".repeat(24);
    expect(companyDocFilePath(`/uploads/company-docs/c1/${name}.pdf`, "c1")).toContain(`${name}.pdf`);
    expect(companyDocFilePath(`/uploads/company-docs/c1/${name}.svg`, "c1")).toBeNull();
    expect(companyDocFilePath("https://example.org/policy.pdf", "c1")).toBeNull();
  });
});

describe("что показывать на витрине", () => {
  it("умолчание — показывать, кроме точного адреса у предприятия без точек", () => {
    expect(defaultPublicFields({ hasPhysicalPoints: true }).preciseAddress).toBe(true);
    expect(defaultPublicFields({ hasPhysicalPoints: false }).preciseAddress).toBe(false);
    expect(defaultPublicFields({ hasPhysicalPoints: false }).phone).toBe(true);
  });

  it("негодная запись читается как умолчание, а не роняет витрину", () => {
    const ctx = { hasPhysicalPoints: true };
    expect(parsePublicFields(null, ctx)).toEqual(defaultPublicFields(ctx));
    expect(parsePublicFields("shown", ctx)).toEqual(defaultPublicFields(ctx));
    expect(parsePublicFields({ phone: "yes" }, ctx).phone).toBe(true);
    expect(parsePublicFields({ phone: false }, ctx).phone).toBe(false);
  });

  it("набор для записи содержит все ключи — умолчание потом не переедет само", () => {
    const json = toPublicFieldsJson({ phone: false }, { hasPhysicalPoints: true });
    expect(Object.keys(json).sort()).toEqual(
      ["description", "documents", "email", "hours", "phone", "preciseAddress", "returnPolicy"],
    );
    expect(json.phone).toBe(false);
    expect(json.email).toBe(true);
  });

  // Решение владельца 22 ноября: политика возврата выключается, как телефон и
  // почта. Умолчание — показывать, поэтому у нынешних предприятий не меняется
  // ничего, а строку «продавец не указал» можно убрать.
  it("политика возврата показывается по умолчанию и выключается", () => {
    const ctx = { hasPhysicalPoints: true };
    expect(defaultPublicFields(ctx).returnPolicy).toBe(true);
    expect(parsePublicFields({ returnPolicy: false }, ctx).returnPolicy).toBe(false);
    expect(publicFieldOn(null, "returnPolicy")).toBe(true);
    expect(publicFieldOn({ returnPolicy: false }, "returnPolicy")).toBe(false);
    // Негодная запись — умолчание, а не исключение: иначе одно поле ронало бы
    // паспорт товара, где этот выключатель читается в одиночку.
    expect(publicFieldOn({ returnPolicy: "no" }, "returnPolicy")).toBe(true);
    expect(publicFieldOn("broken", "returnPolicy")).toBe(true);
  });
});

describe("проверка карточки предприятия", () => {
  const base = { legalName: "Acme s.r.o.", displayName: "Acme" };

  it("отрасль — только из реестра", () => {
    expect(validateCompanyProfile({ ...base, industry: "construction" }).ok).toBe(true);
    const bad = validateCompanyProfile({ ...base, industry: "nuclear-cafes" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("industry_invalid");
  });

  it("ссылка в своей рубрике отвергается вслух", () => {
    const bad = validateCompanyProfile({ ...base, industryCustom: "см. acme.org" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("industry_custom_has_link");
    const ok = validateCompanyProfile({ ...base, industryCustom: "ремонт лодок" });
    expect(ok.ok).toBe(true);
  });

  it("семь закрытых дней — отказ, а не «закрыто навсегда»", () => {
    const empty = {
      mon: { kind: "closed" }, tue: { kind: "closed" }, wed: { kind: "closed" },
      thu: { kind: "closed" }, fri: { kind: "closed" }, sat: { kind: "closed" },
      sun: { kind: "closed" },
    };
    const bad = validateCompanyProfile({ ...base, hours: empty });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("hours_empty");
  });

  it("часы конторы принимаются с поясом, выдуманный пояс — нет", () => {
    const hours = { mon: { kind: "open", spans: [["09:00", "13:00"], ["14:00", "18:00"]] } };
    const ok = validateCompanyProfile({ ...base, hours, timezone: "Europe/Prague" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.data.hours?.mon).toEqual({ kind: "open", spans: [["09:00", "13:00"], ["14:00", "18:00"]] });
    const bad = validateCompanyProfile({ ...base, hours, timezone: "Europe/Atlantis" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("timezone_invalid");
  });

  it("подпись поля не метит в объект названий значений", () => {
    // `t("category")` попал бы в `business.category.*` — на экране стоял бы путь
    // ключа вместо подписи. Своя подпись у вида и у отрасли.
    expect(companyFieldLabelKey("category")).toBe("categoryLabel");
    expect(companyFieldLabelKey("industry")).toBe("industryLabel");
    expect(companyFieldLabelKey("industryCustom")).toBe("industryCustom");
    expect(companyFieldLabelKey("phone")).toBe("phone");
  });
});

describe("адрес логотипа", () => {
  const base = { legalName: "Acme s.r.o.", displayName: "Acme" };

  // Поймано живым прогоном: загрузка пишет в поле наш путь, а проверка требовала
  // схему или домен — сохранить карточку после загрузки было нельзя.
  it("наш загруженный файл принимается как есть", () => {
    const url = `/uploads/companies/c1/${"a".repeat(24)}.png`;
    const res = validateCompanyProfile({ ...base, logoUrl: url });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.logoUrl).toBe(url);
  });

  it("чужая ссылка по-прежнему приводится к https", () => {
    const res = validateCompanyProfile({ ...base, logoUrl: "example.org/logo.png" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.logoUrl).toBe("https://example.org/logo.png");
  });

  it("подделанный наш путь отвергается", () => {
    for (const bad of [
      "/uploads/companies/c1/../../etc/passwd",
      "/uploads/kyb/c1/" + "a".repeat(24) + ".pdf",
      "/uploads/companies/c1/evil.svg",
    ]) {
      const res = validateCompanyProfile({ ...base, logoUrl: bad });
      expect(res.ok, bad).toBe(false);
      if (!res.ok) expect(res.reason).toBe("logo_invalid");
    }
  });
});

describe("часы онлайн-точки", () => {
  const base = { type: "ONLINE", name: "Онлайн-магазин" };
  const hours = { mon: { kind: "open", spans: [["09:00", "18:00"]] } };

  // Поймано живым прогоном: редактор у онлайн-точки появился, а проверка ввода
  // молча обнуляла и расписание, и пояс — сохранение уходило в пустоту.
  it("расписание и пояс сохраняются", () => {
    const res = validateCompanyPoint({ ...base, hours, timezone: "Europe/Prague" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.hours?.mon).toEqual({ kind: "open", spans: [["09:00", "18:00"]] });
      expect(res.data.timezone).toBe("Europe/Prague");
    }
  });

  it("семь закрытых дней отвергаются и у онлайна", () => {
    const closed = Object.fromEntries(
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { kind: "closed" }]),
    );
    const res = validateCompanyPoint({ ...base, hours: closed });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("hours_empty");
  });
});
