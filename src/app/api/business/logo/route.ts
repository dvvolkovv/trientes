import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { editorCompany } from "@/lib/products/editor-company";
import {
  COMPANY_LOGO_MAX_BYTES,
  companyLogoExtension,
  companyLogoFilePath,
  companyLogoRoot,
  companyLogoUrl,
} from "@/lib/company-logo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Загрузка логотипа предприятия (слайс BU), по образцу аватара BT. Прежде логотип
 * задавался только ссылкой, а у заведения, у которого нет своего сайта, ссылки
 * просто нет — и окно логотипа оставалось пустым.
 *
 * Корень `COMPANY_LOGO_ROOT`, файл отдаёт nginx: всё, что записано в `public/`
 * после сборки, Next отдаёт как 404 (правило проекта о загрузках).
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });
  const companyId = String(form.get("companyId") ?? "");
  if (!companyId) return NextResponse.json({ error: "company_required" }, { status: 400 });

  // То же право, которым правится карточка (раздел `card`, слайс BE): логотип —
  // часть карточки, и второго права под него не заводим.
  const gate = await editorCompany(companyId, userId);
  if (!gate || gate.permissions.card !== "EDIT") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > COMPANY_LOGO_MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = companyLogoExtension(bytes.subarray(0, 16));
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  const name = `${randomBytes(12).toString("hex")}.${ext}`;
  const dir = join(companyLogoRoot(), companyId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), bytes);

  const previous = await prisma.company.findUnique({
    where: { id: companyId },
    select: { logoUrl: true },
  });
  const url = companyLogoUrl(companyId, name);
  await prisma.company.update({ where: { id: companyId }, data: { logoUrl: url } });
  // Прежний **наш** файл стираем: показывается всё равно один, а каталог иначе
  // растёт с каждой заменой. Чужой адрес (логотип с сайта заведения) не наш.
  const stale = companyLogoFilePath(previous?.logoUrl ?? null, companyId);
  if (stale) await unlink(stale).catch(() => {});

  return NextResponse.json({ ok: true, url });
}
