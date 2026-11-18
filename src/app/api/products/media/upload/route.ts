import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { MAX_DOC_BYTES, MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, isMp4 } from "@/lib/products/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Загрузка медиа паспорта товара. Файлы лежат в `/var/www/trientes-uploads/products` и
 * отдаются nginx: записанное в `public/` после сборки отдаётся как 404 (эта болезнь уже
 * съедала логотипы карточек и фото точек).
 *
 * Имя файла придумываем мы (16 hex + расширение) — это и единственная защита пути
 * склейки. Расширение берётся из белого списка, а не из имени загружающего.
 */
const ROOT = process.env.PRODUCT_MEDIA_ROOT ?? join(process.cwd(), "public", "uploads", "products");

const IMAGE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

type Slot = "photo" | "video" | "document";

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });

  const companyId = String(form.get("companyId") ?? "");
  if (!companyId) return NextResponse.json({ error: "company_required" }, { status: 400 });
  const slot = String(form.get("slot") ?? "photo") as Slot;
  if (slot !== "photo" && slot !== "video" && slot !== "document") {
    return NextResponse.json({ error: "bad_slot" }, { status: 400 });
  }

  // Та же калитка, что у правки паспорта: залистованное предприятие и роль не VIEWER.
  const [company, member] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { status: true, suspendedAt: true, deletedAt: true },
    }),
    prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: { role: true },
    }),
  ]);
  if (!company || company.status !== "APPROVED" || company.suspendedAt || company.deletedAt) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (member?.role !== "OWNER" && member?.role !== "EDITOR") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  let ext: string | null = null;

  if (slot === "photo") {
    if (bytes.length > MAX_PHOTO_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
    ext = IMAGE[file.type] ?? null;
  } else if (slot === "video") {
    // Длительность не проверяем: `ffprobe` на сервере нет, и выдумывать проверку,
    // которой не делаем, нельзя. Предел честно в байтах.
    if (bytes.length > MAX_VIDEO_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
    // Содержимое, а не заявленный тип: файл потом отдаёт nginx.
    if (!isMp4(bytes.subarray(0, 16))) return NextResponse.json({ error: "bad_type" }, { status: 400 });
    ext = "mp4";
  } else {
    if (bytes.length > MAX_DOC_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
    // svg в белый список не входит: это исполняемая разметка.
    ext = file.type === "application/pdf" ? "pdf" : (IMAGE[file.type] ?? null);
    if (ext === "pdf" && bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return NextResponse.json({ error: "bad_type" }, { status: 400 });
    }
  }

  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  const id = randomBytes(16).toString("hex");
  const dir = join(ROOT, companyId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.${ext}`), bytes);

  return NextResponse.json({
    ok: true,
    url: `/uploads/products/${companyId}/${id}.${ext}`,
    size: bytes.length,
    filename: file.name,
  });
}
