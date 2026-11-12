import { readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Иконки монет в списке на главной грузились прямо с чужого CDN
 * (`coin-images.coingecko.com`, за Cloudflare): наш сервер отдаёт страницу, а
 * 125 картинок браузер тянет со стороны. Если сеть посетителя до этого домена
 * не достаёт, часть кружков остаётся пустой — у нас при этом всё «работает».
 * Поэтому картинки идут через свой домен (`/_next/image`), и единственный
 * случай, когда оптимизатор пропускается, — путь не http(s): файл из
 * `/uploads/` лежит мимо `public/` и оптимизатору не виден.
 */

const ROOT = path.resolve(__dirname, "..");

const LIST_COMPONENTS = [
  "src/components/coin-row.tsx",
  "src/components/coin-card-mobile.tsx",
];

function imageAttributes(file: string): { name: string; shorthand: boolean }[][] {
  const source = ts.createSourceFile(
    file,
    readFileSync(path.join(ROOT, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: { name: string; shorthand: boolean }[][] = [];
  const visit = (node: ts.Node): void => {
    const opening = ts.isJsxSelfClosingElement(node)
      ? node
      : ts.isJsxElement(node)
        ? node.openingElement
        : null;
    if (opening && opening.tagName.getText() === "Image") {
      found.push(
        opening.attributes.properties.flatMap((p) =>
          ts.isJsxAttribute(p) ? [{ name: p.name.getText(), shorthand: p.initializer === undefined }] : [],
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("иконки монет в списке", () => {
  it.each(LIST_COMPONENTS)("%s не отключает оптимизатор безусловно", (file) => {
    const images = imageAttributes(file);
    expect(images.length).toBeGreaterThan(0);
    for (const attrs of images) {
      const unoptimized = attrs.find((a) => a.name === "unoptimized");
      // Голый `unoptimized` = ссылка на чужой CDN уходит в браузер как есть.
      expect(unoptimized?.shorthand ?? false).toBe(false);
    }
  });

  it("хост логотипов разрешён оптимизатору в next.config", () => {
    const config = readFileSync(path.join(ROOT, "next.config.ts"), "utf8");
    expect(config).toContain("coin-images.coingecko.com");
  });
});
