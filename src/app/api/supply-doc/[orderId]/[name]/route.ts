import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isSafeAttachmentName } from "@/lib/supply/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.env.SUPPLY_DOCS_ROOT ?? join(process.cwd(), ".private-uploads", "supply");

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Приватная отдача накладной: файл видят только члены двух предприятий сделки — того,
 * кто заказал, и того, кому заказали. Для чтения достаточно права `supply: VIEW`:
 * кладовщик вправе посмотреть бумагу на привезённый товар, но не вести заказ.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ orderId: string; name: string }> },
) {
  const { orderId, name } = await params;
  if (!isSafeAttachmentName(name)) return NextResponse.json({ error: "bad_name" }, { status: 400 });

  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const order = await prisma.supplyOrder.findUnique({
    where: { id: orderId },
    select: { companyId: true, status: true, supplier: { select: { supplierCompanyId: true } } },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const sides = [order.companyId];
  // Черновик адресату не виден вовсе — ни заказ, ни его бумаги.
  if (order.supplier.supplierCompanyId && order.status !== "DRAFT") sides.push(order.supplier.supplierCompanyId);

  const member = await prisma.companyMember.findFirst({
    where: { userId, companyId: { in: sides } },
    select: { id: true },
  });
  if (!member) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const bytes = await readFile(join(ROOT, orderId, name)).catch(() => null);
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
