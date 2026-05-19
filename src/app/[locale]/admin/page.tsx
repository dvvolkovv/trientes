import { setRequestLocale } from "next-intl/server";

export default async function AdminHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold">Admin</h1>
      <p className="text-muted-foreground mt-2">
        Full admin panel arrives in Phase 6 (coins, requests, users).
      </p>
    </main>
  );
}
