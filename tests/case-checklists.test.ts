import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { CHECKLISTS, checklistFor, checklistProgress, noteRequired } from "@/lib/cases/checklists";

const LABELS = (en as unknown as { admin: { case: { checks: Record<string, string> } } }).admin.case
  .checks;

describe("CHECKLISTS", () => {
  it("у каждого типа заявки непустой лист", () => {
    for (const [subject, defs] of Object.entries(CHECKLISTS)) {
      expect(defs.length, subject).toBeGreaterThan(0);
    }
  });

  it("у каждого типа есть хотя бы один обязательный пункт", () => {
    for (const [subject, defs] of Object.entries(CHECKLISTS)) {
      expect(defs.some((d) => d.required), subject).toBe(true);
    }
  });

  it("ключи внутри листа не повторяются", () => {
    for (const [subject, defs] of Object.entries(CHECKLISTS)) {
      expect(new Set(defs.map((d) => d.key)).size, subject).toBe(defs.length);
    }
  });

  it("у каждого пункта есть подпись в messages/en.json", () => {
    // Пункт без подписи вышел бы на экран сырым ключом.
    for (const defs of Object.values(CHECKLISTS)) {
      for (const def of defs) expect(LABELS[def.key], def.key).toBeTruthy();
    }
  });

  it("в переводах нет подписей для несуществующих пунктов", () => {
    const known = new Set(Object.values(CHECKLISTS).flatMap((defs) => defs.map((d) => d.key)));
    for (const key of Object.keys(LABELS)) expect(known.has(key), key).toBe(true);
  });
});

describe("noteRequired", () => {
  it("FAIL и NA требуют примечания, OK — нет", () => {
    expect(noteRequired("FAIL")).toBe(true);
    expect(noteRequired("NA")).toBe(true);
    expect(noteRequired("OK")).toBe(false);
    expect(noteRequired("TODO")).toBe(false);
  });
});

describe("checklistProgress", () => {
  it("пустой лист — все обязательные пункты ждут ответа", () => {
    const p = checklistProgress("COIN_REQUEST", []);
    expect(p.total).toBe(3);
    expect(p.required).toBe(3);
    expect(p.answered).toBe(0);
    expect(p.requiredPending).toBe(3);
  });

  it("FAIL считается ответом: он не препятствие, а причина отказа", () => {
    const defs = checklistFor("COIN_REQUEST");
    const rows = defs.map((d) => ({ key: d.key, state: "FAIL" as const }));
    const p = checklistProgress("COIN_REQUEST", rows);
    expect(p.requiredPending).toBe(0);
    expect(p.failed).toBe(3);
  });

  it("необязательный пункт без ответа препятствием не считается", () => {
    const rows = checklistFor("POINT")
      .filter((d) => d.required)
      .map((d) => ({ key: d.key, state: "OK" as const }));
    const p = checklistProgress("POINT", rows);
    expect(p.requiredPending).toBe(0);
    expect(p.answered).toBeLessThan(p.total);
  });

  it("чужой ключ в строках ничего не закрывает", () => {
    const p = checklistProgress("POINT", [{ key: "websiteLive", state: "OK" }]);
    expect(p.requiredPending).toBe(checklistFor("POINT").filter((d) => d.required).length);
  });
});
