import { getTranslations } from "next-intl/server";

type Trust = "UNVERIFIED" | "CONTRACT_VERIFIED" | "PROJECT_CLAIMED" | "FULLY_VERIFIED";

const TONE: Record<Trust, string> = {
  UNVERIFIED: "border-down/40 text-down",
  CONTRACT_VERIFIED: "border-hairline text-foreground",
  PROJECT_CLAIMED: "border-accent/40 text-accent",
  FULLY_VERIFIED: "border-up/40 text-up",
};

export async function TrustPlaque({ trust }: { trust: Trust }) {
  const t = await getTranslations("coinCard.trust");
  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${TONE[trust]}`}>
      <span className="font-semibold uppercase tracking-[0.12em] text-[12px] mr-2">
        {t(trust)}
      </span>
      <span className="text-muted">{t(`${trust}_note`)}</span>
    </div>
  );
}
