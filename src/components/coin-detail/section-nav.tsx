import { useTranslations } from "next-intl";

// Quick-jump chips on a coin page: smooth-scroll anchors to the page's sections.
// Pure anchors (no JS) — global `scroll-behavior: smooth` + each target's
// `scroll-mt` handle the motion and the offset under the top nav.
const CHIP =
  "num text-[12px] uppercase tracking-wider px-3.5 py-1.5 rounded-md font-medium border border-hairline text-muted hover:text-foreground hover:border-foreground/40 transition-all";

export function SectionNav({ hasNews }: { hasNews: boolean }) {
  const t = useTranslations("detail");
  return (
    <nav className="flex flex-wrap items-center gap-2">
      <a href="#navigator" className={CHIP}>
        🗺 {t("jumpNavigator")}
      </a>
      <a href="#exchanges" className={CHIP}>
        🏦 {t("jumpExchanges")}
      </a>
      {hasNews && (
        <a href="#news" className={CHIP}>
          📰 {t("jumpNews")}
        </a>
      )}
    </nav>
  );
}
