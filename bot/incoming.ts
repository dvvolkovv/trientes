import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, extname } from "node:path";

// Where inbound files from Telegram land. Outside git (see .gitignore).
const INCOMING_DIR = resolve(process.cwd(), "incoming");

// Bot API getFile gives us a tmp file path on Telegram CDN; we re-download
// the bytes into our own incoming dir so the assistant can read them.
async function fetchFileBytes(
  fileId: string,
  botToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ bytes: Buffer; remoteName: string }> {
  const metaRes = await fetchFn(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`,
  );
  const meta = (await metaRes.json()) as {
    ok: boolean;
    result?: { file_path: string };
    description?: string;
  };
  if (!meta.ok || !meta.result) {
    throw new Error(
      `Telegram getFile failed: ${meta.description ?? "unknown"}`,
    );
  }
  const filePath = meta.result.file_path;
  const fileRes = await fetchFn(
    `https://api.telegram.org/file/bot${botToken}/${filePath}`,
  );
  if (!fileRes.ok) {
    throw new Error(`Telegram file download failed (${fileRes.status})`);
  }
  const ab = await fileRes.arrayBuffer();
  return {
    bytes: Buffer.from(ab),
    remoteName: filePath.split("/").pop() ?? "file",
  };
}

function sanitizeFilename(name: string): string {
  // Strip path separators + control chars; keep unicode letters/digits/dots/dashes/underscores.
  return name
    .replace(/[/\\\0\n\r]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120) || "file";
}

function tsPrefix(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export type SavedFile = {
  absPath: string;
  relPath: string;       // relative to project root, for display
  originalName: string;
  sizeBytes: number;
};

// Pull a Telegram file by id, save to /home/dv/trientes/incoming/<ts>-<name>.
// If `originalName` is null (e.g. compressed photo), derive from the remote
// path (which is something like "photos/file_42.jpg").
export async function saveTelegramFile(
  fileId: string,
  originalName: string | null,
  botToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<SavedFile> {
  const { bytes, remoteName } = await fetchFileBytes(fileId, botToken, fetchFn);
  await mkdir(INCOMING_DIR, { recursive: true });

  const baseName = sanitizeFilename(originalName ?? remoteName);
  // Make sure we have an extension — Telegram document.file_name usually does;
  // photo file_path always does too. Fall back to .bin if not.
  const hasExt = !!extname(baseName);
  const finalName = hasExt ? baseName : `${baseName}.bin`;
  const filename = `${tsPrefix()}-${finalName}`;
  const absPath = join(INCOMING_DIR, filename);
  await writeFile(absPath, bytes);
  return {
    absPath,
    relPath: join("incoming", filename),
    originalName: originalName ?? remoteName,
    sizeBytes: bytes.length,
  };
}
