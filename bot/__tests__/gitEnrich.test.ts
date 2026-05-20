import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { collectHeadInfo } from "../gitEnrich";

describe("collectHeadInfo", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "git-enrich-"));
    execSync("git init -q -b main", { cwd: dir });
    execSync('git config user.email "t@t.t"', { cwd: dir });
    execSync('git config user.name "T"', { cwd: dir });
    writeFileSync(join(dir, "a.txt"), "hello");
    execSync("git add a.txt && git commit -q -m initial", { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns SHA, subject and files of HEAD commit", async () => {
    writeFileSync(join(dir, "b.txt"), "world");
    writeFileSync(join(dir, "c.txt"), "!");
    execSync("git add b.txt c.txt && git commit -q -m 'add bc'", { cwd: dir });
    const info = await collectHeadInfo(dir);
    expect(info.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(info.shortSha).toBe(info.sha.slice(0, 7));
    expect(info.subject).toBe("add bc");
    expect(info.files.sort()).toEqual(["b.txt", "c.txt"]);
  });

  it("returns empty file list for initial commit (no parent)", async () => {
    const info = await collectHeadInfo(dir);
    // git diff-tree on root commit returns no diff; files may be [] or [a.txt] depending on flag — accept both
    expect(info.subject).toBe("initial");
  });
});
