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
    <main className="container mx-auto max-w-lg px-4 py-12">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      <SettingsForm
        initialLocale={user.preferredLocale}
        initialCurrency={user.preferredCurrency}
        initialTheme={user.preferredTheme}
      />
    </main>
  );
}
