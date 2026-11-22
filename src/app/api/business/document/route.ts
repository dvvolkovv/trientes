import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { auth } from "@/auth";
import { editorCompany } from "@/lib/products/editor-company";
import {
  COMPANY_DOC_MAX_BYTES,
  companyDocExtension,
  companyDocUrl,
  companyDocsRoot,
} from "@/lib/company-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Загрузка **публичного** документа предприятия (слайс BU).
 *
 * Корень публичный и это сознательно: политику возврата, гарантию и лицензию
 * должен читать покупатель, а не проверяющий. Приватный корень дел (AO) и
 * KYB-документы к этому маршруту отношения не имеют — там паспорта, здесь бумаги
 * для витрины, и форма в кабинете говорит это вслух.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "bad_form" }, { status: 400 });
  const companyId = String(form.get("companyId") ?? "");
  if (!companyId) return NextResponse.json({ error: "company_required" }, { status: 400 });

  const gate = await editorCompany(companyId, userId);
  if (!gate || gate.permissions.card !== "EDIT") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > COMPANY_DOC_MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = companyDocExtension(bytes.subarray(0, 16));
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  const name = `${randomBytes(12).toString("hex")}.${ext}`;
  const dir = join(companyDocsRoot(), companyId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), bytes);

  return NextResponse.json({ ok: true, url: companyDocUrl(companyId, name), filename: file.name });
}
