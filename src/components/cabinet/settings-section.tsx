import { getTranslations } from "next-intl/server";
import { SettingsForm } from "@/components/settings-form";

export async function SettingsSection({
  initialLocale,
  initialCurrency,
  initialTheme,
}: {
  initialLocale: string;
  initialCurrency: string;
  initialTheme: string;
}) {
  const t = await getTranslations("cabinet.settings");
  return (
    <section id="settings" className="scroll-mt-24">
      <h2 className="text-[20px] md:text-[24px] font-bold tracking-[-0.02em] mb-4">
        {t("title")}
      </h2>
      <div className="bg-card border border-hairline rounded-[20px] p-6 md:p-8">
        <SettingsForm
          initialLocale={initialLocale}
          initialCurrency={initialCurrency}
          initialTheme={initialTheme}
        />
      </div>
    </section>
  );
}
