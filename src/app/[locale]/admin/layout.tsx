import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { checkAdmin } from "@/lib/is-admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const admin = await checkAdmin();
  if (!admin.ok) redirect(`/${locale}/login`);

  return <div className="container mx-auto px-4 py-8">{children}</div>;
}
