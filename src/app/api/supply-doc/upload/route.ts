import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { can, parsePermissions, permissionsFor } from "@/lib/company-team/permissions";
import { DOC_MAX_BYTES, extForMime } from "@/lib/supply/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.env.SUPPLY_DOCS_ROOT ?? join(process.cwd(), ".private-uploads", "supply");

/** Вправе ли человек вести поставки этого предприятия. Право читается из базы на каждом
 *  запросе: снятое право перестаёт грузить файлы тем же сеансом. */
async function manages(companyId: string, userId: string): Promise<boolean> {
  const [company, member] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { suspendedAt: true, deletedAt: true } }),
    prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId, userId } },
      select: { role: true, teamRole: { select: { permissions: true } } },
    }),
  ]);
  if (!company || company.suspendedAt || company.deletedAt || !member) return false;
  const perms = permissionsFor({
    role: member.role,
    rolePermissions: member.teamRole ? parsePermissions(member.teamRole.permissions) : null,
  });
  return can(perms, "supply", "EDIT");
}

/**
 * Загрузка накладной. Файл приватный: его отдаёт наш маршрут с проверкой прав, а не
 * nginx — в заказах ходят коммерческие документы двух предприятий (правило AO).
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });

  const orderId = String(form.get("orderId") ?? "");
  if (!orderId) return NextResponse.json({ error: "order_required" }, { status: 400 });

  const order = await prisma.supplyOrder.findUnique({
    where: { id: orderId },
    select: { companyId: true, status: true, supplier: { select: { supplierCompanyId: true } } },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const buyerOk = await manages(order.companyId, userId);
  // Черновик адресату не виден — значит и грузить в него он не может.
  const supplierOk =
    !buyerOk &&
    order.status !== "DRAFT" &&
    Boolean(order.supplier.supplierCompanyId) &&
    (await manages(order.supplier.supplierCompanyId!, userId));
  if (!buyerOk && !supplierOk) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > DOC_MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });
  const ext = extForMime(file.type);
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  // Имя придумываем мы: 24 hex — ровно то, что пропускает isSafeAttachmentName, и
  // единственная защита склейки пути.
  const name = `${randomBytes(12).toString("hex")}.${ext}`;
  const dir = join(ROOT, orderId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({ ok: true, name, filename: file.name, size: file.size, mime: file.type });
}
