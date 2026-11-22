import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { canWrite, editorCompany } from "@/lib/products/editor-company";
import { MAX_AD_AUDIO_BYTES, MAX_AD_IMAGE_BYTES, MAX_AD_VIDEO_BYTES } from "@/lib/ads/rules";
import { isMp4 } from "@/lib/products/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Загрузка медиа рекламного материала (слайс BY). Файлы лежат в
 * `/var/www/trientes-uploads/ads` и отдаются nginx: записанное в `public/` после
 * сборки отдаётся как 404 (болезнь, уже съедавшая логотипы карточек и фото точек).
 *
 * **При переносе на другую машину каталог надо воссоздать**, как `trientes-uploads`.
 *
 * Имя файла придумываем мы (16 hex + расширение) — это и единственная защита пути
 * склейки. Тип читается по первым байтам, а не из заявленного `Content-Type`: файл
 * потом отдаёт nginx. `svg` в белый список не входит — это исполняемая разметка.
 */
const ROOT = process.env.AD_MEDIA_ROOT ?? join(process.cwd(), "public", "uploads", "ads");

const IMAGE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Звук: заявленный тип не проверяем содержимым — контейнеров много, а играет его сам браузер. */
const AUDIO: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
};

type Slot = "image" | "video" | "audio";

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });

  const companyId = String(form.get("companyId") ?? "");
  if (!companyId) return NextResponse.json({ error: "company_required" }, { status: 400 });
  const slot = String(form.get("slot") ?? "image") as Slot;
  if (slot !== "image" && slot !== "video" && slot !== "audio") {
    return NextResponse.json({ error: "bad_slot" }, { status: 400 });
  }

  // Та же калитка, что у самого материала: залистованное предприятие и право на
  // рекламу. Экран без проверки в двери не защита — действие вызывается запросом.
  const gate = await editorCompany(companyId, userId);
  if (!canWrite(gate, "promos")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  let ext: string | null = null;

  if (slot === "image") {
    if (bytes.length > MAX_AD_IMAGE_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
    ext = IMAGE[file.type] ?? null;
  } else if (slot === "video") {
    // Длительность не проверяем: `ffprobe` на машине нет, и выдумывать проверку,
    // которой не делаем, нельзя (правило BB). Предел честно в байтах.
    if (bytes.length > MAX_AD_VIDEO_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
    if (!isMp4(bytes.subarray(0, 16))) return NextResponse.json({ error: "bad_type" }, { status: 400 });
    ext = "mp4";
  } else {
    if (bytes.length > MAX_AD_AUDIO_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
    ext = AUDIO[file.type] ?? null;
  }

  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  const id = randomBytes(16).toString("hex");
  const dir = join(ROOT, companyId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.${ext}`), bytes);

  return NextResponse.json({
    ok: true,
    url: `/uploads/ads/${companyId}/${id}.${ext}`,
    size: bytes.length,
  });
}
