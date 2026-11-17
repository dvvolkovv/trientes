import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { checkAdmin } from "@/lib/is-admin";
import { isSafeAttachmentName } from "@/lib/cases/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.env.CASE_ATTACHMENTS_ROOT ?? join(process.cwd(), ".private-uploads", "cases");

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Приватная отдача: nginx этот путь не знает, файл проходит через проверку прав.
 * Так вложение по делу ведёт себя как KYB-документ, а не как логотип монеты.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ caseId: string; name: string }> },
) {
  const { caseId, name } = await params;
  if (!isSafeAttachmentName(name)) return NextResponse.json({ error: "bad_name" }, { status: 400 });

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const c = await prisma.complianceCase.findUnique({
    where: { id: caseId },
    select: { applicantUserId: true },
  });
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (c.applicantUserId !== userId) {
    const admin = await checkAdmin();
    if (!admin.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const bytes = await readFile(join(ROOT, caseId, name)).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "gone" }, { status: 404 });

  const ext = name.split(".").pop() ?? "";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "content-disposition": "inline",
      // Приватный файл не должен оседать в общих кэшах.
      "cache-control": "private, no-store",
    },
  });
}
