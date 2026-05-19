import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("common");
  return (
    <footer className="border-t mt-12">
      <div className="container mx-auto px-4 py-6 text-sm text-muted-foreground">
        © {new Date().getFullYear()} {t("appName")}
      </div>
    </footer>
  );
}
