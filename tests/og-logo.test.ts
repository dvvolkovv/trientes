import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ogLogoSource } from "@/lib/og-logo";

/**
 * Картинка превью для соцсетей собирается не в браузере, а в `ImageResponse`
 * (satori), и он **не умеет** относительный адрес: `/uploads/...` обрывает
 * отрисовку целиком, то есть ссылка на страницу, пересланная в мессенджер,
 * остаётся вовсе без картинки. Живой случай 27.11.2026: превью карточки
 * предприятия с нашим логотипом отвечало 502 («Image source must be an
 * absolute URL»).
 *
 * Поэтому наш файл читается **с диска** и уходит в разметку как data URI:
 * абсолютный адрес заставил бы веб спрашивать себя же через nginx — лишняя
 * точка отказа ровно в том месте, где картинку и так ждёт чужой паук.
 */
describe("ogLogoSource", () => {
  it("пустого адреса не выдумывает", async () => {
    expect(await ogLogoSource(null)).toBeNull();
    expect(await ogLogoSource("")).toBeNull();
    expect(await ogLogoSource(undefined)).toBeNull();
  });

  it("чужой абсолютный адрес отдаёт как есть", async () => {
    const url = "https://assets.coingecko.com/coins/images/1/large/bitcoin.png";
    expect(await ogLogoSource(url)).toBe(url);
  });

  it("наш файл читает с диска и отдаёт data URI", async () => {
    const root = mkdtempSync(join(tmpdir(), "og-logo-"));
    mkdirSync(join(root, "c1"), { recursive: true });
    // Настоящая подпись PNG: тип читается по первым байтам, а не по расширению.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    writeFileSync(join(root, "c1", "logo.jpg"), png);
    const out = await ogLogoSource("/uploads/companies/c1/logo.jpg", { companies: root });
    expect(out).toBe(`data:image/png;base64,${png.toString("base64")}`);
  });

  it("выход из каталога и чужой корень не читает", async () => {
    const root = mkdtempSync(join(tmpdir(), "og-logo-"));
    expect(await ogLogoSource("/uploads/companies/../../etc/passwd", { companies: root })).toBeNull();
    // Приватные корни в карту не входят: по адресу их не отдают и здесь не читают.
    expect(await ogLogoSource("/uploads/kyb/c1/charter.pdf", { companies: root })).toBeNull();
    expect(await ogLogoSource("/etc/passwd", { companies: root })).toBeNull();
  });

  it("пропавший файл и не-картинка превью не роняют", async () => {
    const root = mkdtempSync(join(tmpdir(), "og-logo-"));
    expect(await ogLogoSource("/uploads/companies/c1/missing.png", { companies: root })).toBeNull();
    mkdirSync(join(root, "c2"), { recursive: true });
    writeFileSync(join(root, "c2", "fake.png"), Buffer.from("<svg/>"));
    expect(await ogLogoSource("/uploads/companies/c2/fake.png", { companies: root })).toBeNull();
  });
});
