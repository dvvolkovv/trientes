import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 6 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const PUBLIC_ROOT = process.env.POINT_PHOTOS_ROOT ?? join(process.cwd(), "public", "uploads", "points");

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });

  const companyId = String(form.get("companyId") ?? "");
  if (!companyId) return NextResponse.json({ error: "company_required" }, { status: 400 });

  const member = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } },
    select: { role: true },
  });
  if (member?.role !== "OWNER" && member?.role !== "EDITOR") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  const id = randomBytes(12).toString("hex");
  const dir = join(PUBLIC_ROOT, companyId);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${id}.${ext}`);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, bytes);

  const url = `/uploads/points/${companyId}/${id}.${ext}`;
  return NextResponse.json({ ok: true, url, filename: file.name, size: file.size });
}
