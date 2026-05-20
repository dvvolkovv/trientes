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

  return (
    <div className="max-w-[1600px] mx-auto px-6 md:px-12 xl:px-20 py-12">
      {children}
    </div>
  );
}
