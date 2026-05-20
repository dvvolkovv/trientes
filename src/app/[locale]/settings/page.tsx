import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SettingsForm } from "@/components/settings-form";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) redirect(`/${locale}/login`);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) redirect(`/${locale}/login`);

  return (
    <main className="max-w-2xl mx-auto px-6 py-10 md:py-16">
      <div className="num text-[11px] uppercase tracking-[0.3em] text-muted mb-2">
        Section · Settings
      </div>
      <h1 className="text-[28px] sm:text-[36px] md:text-[48px] font-bold tracking-[-0.03em] mb-2">
        Settings
      </h1>
      <p className="text-muted mb-8">Manage your language, currency, and theme preferences.</p>
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <SettingsForm
          initialLocale={user.preferredLocale}
          initialCurrency={user.preferredCurrency}
          initialTheme={user.preferredTheme}
        />
      </div>
    </main>
  );
}
