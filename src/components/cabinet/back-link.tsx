import Link from "next/link";

/**
 * Кнопка возврата — одна на кабинет человека и на кабинет предприятия.
 *
 * Своей копии не заводим: вид кнопки уже разъехался бы по двадцати экранам (та же
 * болезнь, что со списком локалей в уборке AU). Высота 44 px — палец, а не
 * подчёркнутое слово (правило AN).
 */
export function CabinetBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex h-11 items-center rounded-full border border-hairline px-4 text-[13px] font-semibold uppercase tracking-wider text-muted transition-colors hover:border-accent/60 hover:text-foreground"
    >
      ← {label}
    </Link>
  );
}
