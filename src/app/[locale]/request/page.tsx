import { setRequestLocale } from "next-intl/server";

export default async function RequestPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="container mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold">Request a coin</h1>
      <p className="text-muted-foreground mt-2">Phase 5.</p>
    </main>
  );
}
