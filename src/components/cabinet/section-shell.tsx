import { ADMIN_COLUMN } from "@/lib/admin-ui";
import { CabinetBackLink } from "@/components/cabinet/back-link";

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
  backHref,
  children,
}: {
  locale: string;
  kicker: string;
  title: string;
  backLabel: string;
  /** Куда ведёт возврат. Пусто — хаб кабинета: он и есть умолчание раздела. */
  backHref?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${ADMIN_COLUMN} py-10 md:py-14`}>
      <div className="mb-6">
        <CabinetBackLink href={backHref ?? `/${locale}/cabinet`} label={backLabel} />
      </div>
      <header className="mb-6">
        <div className="num mb-2 text-[11px] uppercase tracking-[0.3em] text-muted">{kicker}</div>
        <h1 className="text-[28px] font-bold tracking-[-0.03em] sm:text-[36px]">{title}</h1>
      </header>
      {children}
    </div>
  );
}
