import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canWrite, editorCompany } from "@/lib/products/editor-company";
import { logCompanyAction } from "@/lib/company-team/journal";
import {
  AD_VOICE_DEFAULT, AD_VOICE_PER_DAY, AD_VOICE_STYLE_DEFAULT, adTextHash, isAdVoice, isAdVoiceStyle,
} from "@/lib/ads/rules";
import { synthesizeAdVoice } from "@/lib/ads/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Озвучка материала нашим синтезом (слайс BZ).
 *
 * Запись кладётся тем же файлом в тот же корень, что кадр и ролик: дальше её отдаёт
 * nginx, и ни один показ страницы в чужую службу не ходит.
 *
 * Суточный потолок считается по журналу предприятия (`AD_VOICED`) — он уже есть и
 * неизменяем; своей таблицы под один счётчик не заводим. Счёт идёт **до** работы
 * (приём BC): счёт после записи ограничивает только следующего.
 */
const ROOT = process.env.AD_MEDIA_ROOT ?? join(process.cwd(), "public", "uploads", "ads");

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { companyId?: string; title?: string; body?: string; voice?: string; style?: string; language?: string }
    | null;
  if (!body?.companyId) return NextResponse.json({ error: "company_required" }, { status: 400 });

  const gate = await editorCompany(body.companyId, userId);
  if (!canWrite(gate, "promos")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const used = await prisma.companyActionLog.count({
    where: { companyId: body.companyId, action: "AD_VOICED", createdAt: { gte: since } },
  });
  if (used >= AD_VOICE_PER_DAY) return NextResponse.json({ error: "voice_daily_limit" }, { status: 429 });

  const voice = isAdVoice(body.voice) ? body.voice : AD_VOICE_DEFAULT;
  const style = isAdVoiceStyle(body.style) ? body.style : AD_VOICE_STYLE_DEFAULT;
  const result = await synthesizeAdVoice({
    title,
    body: body.body ?? "",
    voice,
    style,
    language: (body.language ?? "en").slice(0, 8),
  });
  if (!result.ok) {
    // Причина называется словами: «не настроено», «слишком длинно» и «служба молчит» —
    // три разные беды, и человеку надо знать, что делать (правило BG о погасшей кнопке).
    const status = result.reason === "too_long" ? 400 : result.reason === "not_configured" ? 503 : 502;
    return NextResponse.json({ error: `voice_${result.reason}` }, { status });
  }

  const id = randomBytes(16).toString("hex");
  const dir = join(ROOT, body.companyId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.mp3`), result.bytes);

  await logCompanyAction({
    companyId: body.companyId, actorUserId: userId, action: "AD_VOICED", subject: title,
  });

  return NextResponse.json({
    ok: true,
    url: `/uploads/ads/${body.companyId}/${id}.mp3`,
    voice,
    style,
    textHash: adTextHash(title, body.body ?? ""),
    size: result.bytes.length,
    remaining: Math.max(0, AD_VOICE_PER_DAY - used - 1),
  });
}
