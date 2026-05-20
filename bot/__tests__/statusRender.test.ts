import { describe, it, expect } from "vitest";
import { renderToolStatus } from "../statusRender";

describe("renderToolStatus", () => {
  it("Read shows filename", () => {
    expect(
      renderToolStatus("Read", { file_path: "/home/dv/trientes/src/x.ts" }),
    ).toBe("📖 читаю src/x.ts");
  });

  it("Edit shows filename", () => {
    expect(
      renderToolStatus("Edit", { file_path: "src/components/Header.tsx" }),
    ).toBe("✏️ правлю src/components/Header.tsx");
  });

  it("Write shows filename", () => {
    expect(renderToolStatus("Write", { file_path: "a.md" })).toBe("📝 пишу a.md");
  });

  it("git commit detected", () => {
    expect(
      renderToolStatus("Bash", { command: 'git commit -m "x"' }),
    ).toBe("💾 коммичу");
  });

  it("git push detected", () => {
    expect(renderToolStatus("Bash", { command: "git push origin main" })).toBe(
      "🚀 пушу",
    );
  });

  it("pm2 reload detected", () => {
    expect(
      renderToolStatus("Bash", { command: "pm2 reload trientes-web" }),
    ).toBe("♻️ рестарт prod");
  });

  it("npm/vitest detected", () => {
    expect(renderToolStatus("Bash", { command: "npm test" })).toBe(
      "🧪 запускаю тесты",
    );
  });

  it("generic Bash falls back to command preview", () => {
    expect(renderToolStatus("Bash", { command: "ls -la" })).toBe(
      "⚙️ bash: ls -la",
    );
  });

  it("Grep shows pattern", () => {
    expect(renderToolStatus("Grep", { pattern: "TODO" })).toBe("🔎 ищу TODO");
  });

  it("unknown tool shows tool name", () => {
    expect(renderToolStatus("MysteryTool", {})).toBe("🔧 MysteryTool");
  });
});
