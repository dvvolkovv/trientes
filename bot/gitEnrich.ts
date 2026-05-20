import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileP = promisify(execFile);

export interface HeadInfo {
  sha: string;
  shortSha: string;
  subject: string;
  files: string[];
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd });
  return stdout.trim();
}

export async function collectHeadInfo(cwd: string): Promise<HeadInfo> {
  const sha = await git(cwd, ["rev-parse", "HEAD"]);
  const subject = await git(cwd, ["log", "-1", "--pretty=%s"]);
  let files: string[] = [];
  try {
    const out = await git(cwd, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      "HEAD",
    ]);
    files = out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    files = [];
  }
  return { sha, shortSha: sha.slice(0, 7), subject, files };
}
