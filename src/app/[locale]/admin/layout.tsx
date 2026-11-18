import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { checkAdmin } from "@/lib/is-admin";
import { adminRedirectFor } from "@/lib/authz/map";

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
  // A signed-in non-admin sent to /login would just bounce back here; the
  // cabinet is the honest destination for them. Сотрудник без второго фактора
  // идёт его заводить, с заведённым — вводить код: «включу потом» означает
  // «не включу», поэтому это дверь, а не настройка.
  if (!admin.ok) redirect(adminRedirectFor(admin.reason, locale));

  return (
    <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-12">
      {children}
    </div>
  );
}
