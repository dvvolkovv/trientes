import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { CabinetSectionShell } from "@/components/cabinet/section-shell";
import { ReauthForm } from "@/components/cabinet/reauth-form";
import { reauthMethod } from "@/app/actions/reauth";
import { csrfToken } from "@/lib/csrf";
import { safeNext } from "@/lib/safe-next";

export const dynamic = "force-dynamic";

/**
 * «Подтвердите, что это вы» (слайс CP): свежий вход для действий, меняющих получателя
 * денег. Адрес возврата чистится `safeNext` — тем же правилом, что после входа:
 * `//evil.com` и `/\evil.com` отбрасываются.
 */
export default async function ReauthPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("reauth");
  const tc = await getTranslations("cabinet");
  const method = await reauthMethod();
  if (method === "unauth") redirect(`/${locale}/login`);
  const csrf = await csrfToken();
  const back = safeNext(next, locale);

  return (
    <CabinetSectionShell
      locale={locale}
      kicker={t("kicker")}
      title={t("title")}
      backLabel={tc("hub.back")}
    >
      <ReauthForm method={method} csrf={csrf ?? ""} next={back} />
    </CabinetSectionShell>
  );
}
