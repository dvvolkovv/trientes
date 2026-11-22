import Link from "next/link";
import { ADMIN_COLUMN } from "@/lib/admin-ui";

/**
 * Оболочка раздела личного кабинета: та же колонка и тот же порядок частей, что
 * у экранов админки и кабинета предприятия. Своей копии не заводим — иначе
 * двенадцать разделов разъехались бы по виду через месяц.
 */
export function CabinetSectionShell({
  locale,
  kicker,
  title,
  backLabel,
  children,
}: {
  locale: string;
  kicker: string;
  title: string;
  backLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${ADMIN_COLUMN} py-10 md:py-14`}>
      <Link
        href={`/${locale}/cabinet`}
        className="mb-6 inline-flex h-11 items-center rounded-full border border-hairline px-4 text-[13px] font-semibold uppercase tracking-wider text-muted transition-colors hover:border-accent/60 hover:text-foreground"
      >
        ← {backLabel}
      </Link>
      <header className="mb-6">
        <div className="num mb-2 text-[11px] uppercase tracking-[0.3em] text-muted">{kicker}</div>
        <h1 className="text-[28px] font-bold tracking-[-0.03em] sm:text-[36px]">{title}</h1>
      </header>
      {children}
    </div>
  );
}
