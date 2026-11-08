import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const modules = [
  {
    relativePath: "src/components/business/point-form.tsx",
    requiredNamedImports: ["Marker", "setWorkerUrl"],
  },
  {
    relativePath: "src/components/coin-detail/crypto-navigator.tsx",
    requiredNamedImports: ["LngLatBounds", "setWorkerUrl"],
  },
] as const;

function parseModule(relativePath: string) {
  return ts.createSourceFile(
    relativePath,
    readFileSync(path.join(root, relativePath), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function findMapLibreImport(source: ts.SourceFile) {
  return source.statements.find(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "maplibre-gl",
  );
}

describe("MapLibre 6 migration", () => {
  it.each(modules)(
    "uses named MapLibre imports in $relativePath",
    ({ relativePath, requiredNamedImports }) => {
      const declaration = findMapLibreImport(parseModule(relativePath));
      expect(declaration, "maplibre-gl import must exist").toBeDefined();
      expect(
        declaration?.importClause?.name,
        "MapLibre 6 has no default export",
      ).toBeUndefined();

      const bindings = declaration?.importClause?.namedBindings;
      expect(bindings && ts.isNamedImports(bindings)).toBe(true);
      const elements = ts.isNamedImports(bindings!) ? bindings!.elements : [];
      const importedNames = elements.map((element) => element.name.text);
      expect(importedNames).toEqual(
        expect.arrayContaining([...requiredNamedImports]),
      );
      expect(
        elements.some(
          (element) =>
            element.propertyName?.text === "Map" &&
            element.name.text === "MlMap",
        ),
        "Map must be imported as MlMap",
      ).toBe(true);
    },
  );

  it.each(modules)(
    "configures the local worker at module level in $relativePath",
    ({ relativePath }) => {
      const source = parseModule(relativePath);
      const hasWorkerConfiguration = source.statements.some((statement) => {
        if (!ts.isExpressionStatement(statement)) return false;
        const call = statement.expression;
        return (
          ts.isCallExpression(call) &&
          ts.isIdentifier(call.expression) &&
          call.expression.text === "setWorkerUrl" &&
          call.arguments.length === 1 &&
          ts.isStringLiteral(call.arguments[0]) &&
          call.arguments[0].text === "/maplibre/maplibre-gl-worker.mjs"
        );
      });
      expect(hasWorkerConfiguration).toBe(true);
    },
  );

  it.each(modules)(
    "disables remote attribution and installs the static override in $relativePath",
    ({ relativePath }) => {
      const source = parseModule(relativePath);
      const helperImport = source.statements.find(
        (statement): statement is ts.ImportDeclaration =>
          ts.isImportDeclaration(statement) &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === "@/lib/maplibre-attribution",
      );
      expect(
        helperImport,
        "the shared attribution override must be imported",
      ).toBeDefined();

      const bindings = helperImport?.importClause?.namedBindings;
      const importedNames =
        bindings && ts.isNamedImports(bindings)
          ? bindings.elements.map((element) => element.name.text)
          : [];
      expect(importedNames).toEqual(
        expect.arrayContaining([
          "MAPLIBRE_ATTRIBUTION_OPTIONS",
          "addStaticMapAttribution",
        ]),
      );

      const text = source.getFullText();
      expect(text).toContain("...MAPLIBRE_ATTRIBUTION_OPTIONS");
      expect(text).toContain("addStaticMapAttribution(map)");
      expect(text).not.toMatch(/attributionControl:\s*\{/);
    },
  );

  it.each(["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])(
    "ships the complete local %s asset",
    (asset) => {
      const publicAsset = path.join(root, "public/maplibre", asset);
      const distributionAsset = path.join(
        root,
        "node_modules/maplibre-gl/dist",
        asset,
      );
      expect(existsSync(publicAsset), `${asset} must be public`).toBe(true);
      expect(readFileSync(publicAsset).equals(readFileSync(distributionAsset))).toBe(
        true,
      );
    },
  );

  it("copies workers before development and production builds", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    expect(packageJson.scripts?.predev).toBe(
      "node scripts/copy-maplibre-worker.mjs",
    );
    expect(packageJson.scripts?.prebuild).toBe(
      "node scripts/copy-maplibre-worker.mjs",
    );
    expect(existsSync(path.join(root, "scripts/copy-maplibre-worker.mjs"))).toBe(
      true,
    );
  });
});
