import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditSection } from "@/lib/coin-card-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const PUBLIC_ROOT =
  process.env.COIN_CARD_LOGO_ROOT ?? join(process.cwd(), "public", "uploads", "coin-cards");

export async function POST(req: Request) {
  const session = await auth();
  const user = session?.user as { id?: string; role?: string } | undefined;
  const userId = user?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });

  const cardId = String(form.get("cardId") ?? "");
  if (!cardId) return NextResponse.json({ error: "card_required" }, { status: 400 });

  const card = await prisma.coinCard.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      status: true,
      stewardUserId: true,
      members: { where: { userId }, select: { role: true, sections: true } },
    },
  });
  if (!card) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const isSiteAdmin = user?.role === "ADMIN";
  if (!isSiteAdmin && !canEditSection(card.members[0] ?? null, "IDENTITY")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
  // SVG is deliberately absent: an inline <script> in an SVG served from our
  // own origin is stored XSS. Raster only.
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  const id = randomBytes(12).toString("hex");
  const dir = join(PUBLIC_ROOT, card.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.${ext}`), Buffer.from(await file.arrayBuffer()));

  const url = `/uploads/coin-cards/${card.id}/${id}.${ext}`;
  // On a published card the new logo is only a candidate: the URL goes back to
  // the editor and reaches the card through a revision, like any other change.
  if (card.status !== "APPROVED" || isSiteAdmin) {
    await prisma.coinCard.update({ where: { id: card.id }, data: { logoUrl: url } });
  }
  return NextResponse.json({ ok: true, url });
}
