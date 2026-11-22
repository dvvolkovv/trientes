import { ADMIN_TAB, ADMIN_TAB_STRIP, adminTabLook } from "@/lib/admin-ui";

export type FilterTab = {
  key: string;
  href: string;
  label: string;
  active: boolean;
  /** Цвет смысла (состояние заявки). Фильтр без смысла цвета не получает. */
  colorHex?: string | null;
};

/**
 * Ряд фильтров внутри экрана админки — те же кнопки 44 px, что в полосе
 * разделов. До этого фильтры были надписями высотой 28 px: один экран говорил
 * двумя разными языками, и это читалось как разброс.
 *
 * `groups` — потому что у `/admin/business` в одном ряду два смысла (что
 * показываем и в каком состоянии): на широком экране второй уезжает вправо, на
 * телефоне идёт следом. Две строки по 44 px съели бы высоту, которой на
 * телефоне нет.
 */
export function AdminFilterTabs({ groups }: { groups: FilterTab[][] }) {
  const shown = groups.filter((g) => g.length > 0);
  return (
    <div className="mb-6 -mx-4 md:mx-0">
      <div className={ADMIN_TAB_STRIP}>
        {shown.map((group, i) => (
          <div
            key={group[0].key}
            className={`flex shrink-0 gap-2 ${i > 0 && i === shown.length - 1 ? "md:ml-auto" : ""}`}
          >
            {group.map((tab) => {
              const look = adminTabLook(tab.colorHex, tab.active);
              return (
                <a
                  key={tab.key}
                  href={tab.href}
                  aria-current={tab.active ? "page" : undefined}
                  style={look.style}
                  className={`${ADMIN_TAB} ${look.className}`}
                >
                  {tab.label}
                </a>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
