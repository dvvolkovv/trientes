import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { ATTACHMENT_MAX_BYTES, extForMime } from "@/lib/cases/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.env.CASE_ATTACHMENTS_ROOT ?? join(process.cwd(), ".private-uploads", "cases");

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });

  const caseId = String(form.get("caseId") ?? "");
  if (!caseId) return NextResponse.json({ error: "case_required" }, { status: 400 });

  const c = await prisma.complianceCase.findUnique({
    where: { id: caseId },
    select: { applicantUserId: true },
  });
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (c.applicantUserId !== userId) {
    const admin = await checkAdmin();
    if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > ATTACHMENT_MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
  const ext = extForMime(file.type);
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  // Имя придумываем мы: 24 hex — ровно то, что пропускает isSafeAttachmentName.
  const name = `${randomBytes(12).toString("hex")}.${ext}`;
  const dir = join(ROOT, caseId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({
    ok: true,
    name,
    filename: file.name,
    size: file.size,
    mime: file.type,
  });
}
