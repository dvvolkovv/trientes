import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { loadMfaGate } from "@/lib/authz/guard";
import {
  AVATAR_MAX_BYTES,
  avatarExtension,
  avatarFilePath,
  avatarRoot,
  avatarUrl,
} from "@/lib/avatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Загрузка аватара (слайс BT). Корень — `AVATAR_ROOT`, отдаёт файл nginx: всё,
 * что записано в `public/` после сборки, Next отдаёт как 404 (правило проекта о
 * загрузках).
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });
  // Та же калитка, что у действий над учётной записью: с заведённым фактором и
  // непоказанным кодом аватар не меняют.
  if ((await loadMfaGate()) === "verify") {
    return NextResponse.json({ error: "verify_first" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > AVATAR_MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = avatarExtension(bytes.subarray(0, 16));
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  const name = `${randomBytes(12).toString("hex")}.${ext}`;
  const dir = join(avatarRoot(), userId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), bytes);

  const previous = await prisma.user.findUnique({ where: { id: userId }, select: { image: true } });
  const url = avatarUrl(userId, name);
  await prisma.user.update({ where: { id: userId }, data: { image: url } });
  // Прежний наш файл стираем: иначе каталог человека растёт с каждой заменой, а
  // показывается всё равно один снимок.
  const stale = avatarFilePath(previous?.image ?? null, userId);
  if (stale) await unlink(stale).catch(() => {});

  return NextResponse.json({ ok: true, url });
}
