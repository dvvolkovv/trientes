"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { Poi, RouteMode } from "@/lib/crypto-map";
import {
  DEFAULT_POI_PAGE,
  SWIPE_EDGE_PX,
  claimsSwipe,
  dragOffset,
  pageLabelKey,
  pagesFor,
  settlePage,
  type PoiPage,
} from "@/lib/poi-pager";
import { PoiPaneCard } from "@/components/coin-detail/poi-pane-card";
import { PoiPaneMap } from "@/components/coin-detail/poi-pane-map";
import { PoiPaneShowcase } from "@/components/coin-detail/poi-pane-showcase";
import {
  LAYER_DOT,
  MODE_ICON,
  formatDistance,
  type SheetRoute,
} from "@/components/coin-detail/poi-sheet-ui";
import type { StepTranslator } from "@/components/coin-detail/route-steps-panel";

export { MODE_ICON };
export type { SheetRoute };

/**
 * Карточка точки — листалка. На телефоне три страницы: «Карта» (прозрачное
 * окно в живое полотно MapLibre), «Карточка» (наши проверенные факты) и
 * «Витрина» (рассказ заведения о себе); открывается середина, потому что
 * нажатие на точку — это вопрос «что это за место». На десктопе страниц две:
 * карта и так видна рядом с панелью, окно в неё там ничего не покупает.
 *
 * Пристыкованного полустояния (55vh) здесь больше нет: его работу — показать
 * линию маршрута, не закрывая её карточкой, — делает страница «Карта».
 *
 * Страницу выбирает только человек: закладка, жест или открытие карточки.
 * Ответ маршрутизатора её не трогает — прежде он швырял человека с «Места»
 * обратно на карту через секунду после нажатия «Маршрут сюда».
 */
export function PoiSheet({
  poi,
  locale,
  route,
  mode,
  status,
  hasOrigin,
  near,
  voiceOn,
  voiceSupported,
  page,
  onPageChange,
  mapExpanded,
  onMapExpandedChange,
  mapTileRef,
  onClose,
  onMode,
  onBuildRoute,
  onGo,
  onClearRoute,
  onStreetView,
  onLocate,
  onToggleVoice,
  t,
}: {
  poi: Poi;
  locale: string;
  route: SheetRoute | null;
  mode: RouteMode;
  status: string | null;
  hasOrigin: boolean;
  near: boolean;
  voiceOn: boolean;
  voiceSupported: boolean;
  page: PoiPage;
  onPageChange: (next: PoiPage) => void;
  /** Окно карты раскрыто на весь экран, а не плиткой. */
  mapExpanded: boolean;
  onMapExpandedChange: (next: boolean) => void;
  mapTileRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onMode: (next: RouteMode) => void;
  onBuildRoute: () => void;
  onGo: () => void;
  onClearRoute: () => void;
  onStreetView: () => void;
  onLocate: () => void;
  onToggleVoice: () => void;
  t: StepTranslator;
}) {
  const phone = usePhone();
  const pages = useMemo(() => pagesFor(phone), [phone]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [deckWidth, setDeckWidth] = useState(0);
  const gesture = useRef<{ x: number; y: number; at: number; edge: boolean; claimed: boolean } | null>(null);

  // Страница «Карта» существует только на телефоне: если окно расширилось,
  // пока она открыта, листалку надо вернуть на существующую страницу.
  useEffect(() => {
    if (!pages.includes(page)) onPageChange(DEFAULT_POI_PAGE);
  }, [pages, page, onPageChange]);

  // Ширина дорожки нужна и для смещения, и для порога снапа. Меряется, а не
  // берётся из `window`: на десктопе карточка — панель 380 px внутри карты.
  useEffect(() => {
    const el = deckRef.current;
    if (!el) return;
    const measure = () => setDeckWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pages.length]);

  // Прокрутка страницы под карточкой на телефоне гасится так же, как под
  // бургер-меню: иначе палец листает страницу вместо карточки.
  useEffect(() => {
    if (!phone) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [phone]);

  // Клавиши — не украшение: листалка обязана работать и без жеста.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const next = pages[pages.indexOf(page) + (e.key === "ArrowRight" ? 1 : -1)];
      if (next) onPageChange(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages, page, onPageChange, onClose]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!phone || e.pointerType === "mouse") return;
      const box = rootRef.current?.getBoundingClientRect();
      const edge =
        !!box && (e.clientX - box.left < SWIPE_EDGE_PX || box.right - e.clientX < SWIPE_EDGE_PX);
      gesture.current = { x: e.clientX, y: e.clientY, at: e.timeStamp, edge, claimed: false };
    },
    [phone],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      if (!g.claimed) {
        if (!claimsSwipe({ page, dx, dy, fromEdge: g.edge, mapExpanded })) return;
        g.claimed = true;
        // Захват указателя — удобство, а не условие: палец, ушедший за край
        // листа, продолжает тянуть страницу. Браузер отказывает, если указателя
        // уже нет, и ронять из-за этого весь жест нельзя.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* указатель уже отпущен — жест дорабатывает без захвата */
        }
      }
      setDrag(dx);
    },
    [page, mapExpanded],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      gesture.current = null;
      setDrag(null);
      if (!g?.claimed) return;
      const dx = e.clientX - g.x;
      const ms = Math.max(1, e.timeStamp - g.at);
      const next = settlePage({
        pages,
        page,
        dx,
        width: deckWidth || 1,
        velocity: dx / ms,
      });
      if (next !== page) onPageChange(next);
    },
    [pages, page, deckWidth, onPageChange],
  );

  const index = Math.max(0, pages.indexOf(page));
  const offset =
    drag === null
      ? -index * deckWidth
      : dragOffset({ pages, page, dx: drag, width: deckWidth || 1 });
  const onMapPage = page === "map";

  const container = [
    "z-[60] flex flex-col overflow-hidden text-foreground",
    // На странице карты карточка — окно: фона и тени нет, палец идёт к карте.
    // Прозрачного фона для этого мало: элемент во весь экран ловит нажатия и
    // без фона, поэтому на этой странице корень событий не берёт вовсе, а
    // берут их только непрозрачные части вокруг окна.
    onMapPage
      ? "bg-transparent pointer-events-none"
      : "bg-card shadow-[0_-10px_40px_-12px_rgba(0,0,0,0.6)]",
    "fixed inset-0",
    "md:absolute md:inset-y-3 md:right-auto md:left-3 md:top-3 md:bottom-3 md:w-[380px] md:rounded-[18px] md:border md:border-hairline md:bg-card md:shadow-none md:pointer-events-auto",
  ].join(" ");

  // Шапка и закладки стоят в разметке раньше окна карты, а тень-заливка
  // вокруг окна красит всё, до чего дотянется, — без своего слоя она закрасила
  // бы их собой.
  const chrome = onMapPage ? "relative z-10 pointer-events-auto bg-card/90 backdrop-blur" : "";

  return (
    <div
      ref={rootRef}
      className={container}
      role="dialog"
      aria-label={poi.name}
      // Жест слушается со всего листа, а не только с дорожки страниц: шапка и
      // закладки — такая же часть карточки, и палец не обязан их обходить.
      // `pan-y` отдаёт браузеру только вертикаль: иначе он решает за нас, что
      // начавшийся наискось жест — это прокрутка, и забирает его себе.
      style={{ touchAction: "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className={`flex shrink-0 items-start gap-2 border-b border-hairline px-4 pb-2 pt-3 ${chrome}`}>
        {poi.logoUrl ? (
          // Знак заведения: он есть у точки компании, у финтеха и у куратской
          // точки. У точки зеркала BTC Map его нет — там остаётся кружок слоя.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poi.logoUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-9 w-9 shrink-0 rounded-[10px] border border-hairline bg-bg-tint object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="mt-[7px] inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: LAYER_DOT[poi.layer] ?? "#30B658" }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[16px] font-semibold leading-tight">{poi.name}</div>
          <div className="truncate text-[12px] text-muted">
            {poi.category}
            {poi.lightning ? " · ⚡ Lightning" : ""}
            {poi.coinSpecific ? " · ✓" : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[18px] text-muted hover:bg-bg-tint hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {/* Переключатель страниц — кнопки: листать можно и без жеста вовсе. */}
      <div
        role="tablist"
        aria-label={t("pageOf", { n: index + 1, total: pages.length })}
        className={`flex shrink-0 items-center gap-1 border-b border-hairline px-2 ${chrome}`}
      >
        {pages.map((p) => (
          <button
            key={p}
            role="tab"
            type="button"
            aria-selected={p === page}
            onClick={() => onPageChange(p)}
            className={
              "min-h-[44px] flex-1 px-2 text-[12px] font-medium transition-all " +
              (p === page
                ? "border-b-2 border-accent text-foreground"
                : "text-muted hover:text-foreground")
            }
          >
            {t(pageLabelKey(p))}
          </button>
        ))}
      </div>

      <div
        ref={deckRef}
        className={"relative min-h-0 flex-1 " + (onMapPage ? "pointer-events-none" : "overflow-hidden")}
      >
        <div
          className="flex h-full"
          style={{
            width: `${pages.length * 100}%`,
            transform: `translate3d(${offset}px, 0, 0)`,
            transition: drag === null ? "transform 220ms ease-out" : "none",
          }}
        >
          {pages.map((p) => (
            <div
              key={p}
              role="tabpanel"
              aria-hidden={p !== page}
              className={
                "h-full " +
                (p === "map"
                  ? "pointer-events-none overflow-hidden"
                  : "pointer-events-auto overflow-y-auto overscroll-contain")
              }
              style={{ width: `${100 / pages.length}%` }}
            >
              {p === "map" && (
                <PoiPaneMap
                  poi={poi}
                  route={route}
                  mode={mode}
                  status={status}
                  hasOrigin={hasOrigin}
                  voiceOn={voiceOn}
                  voiceSupported={voiceSupported}
                  tileRef={mapTileRef}
                  expanded={mapExpanded}
                  docked={false}
                  onExpandedChange={onMapExpandedChange}
                  onMode={onMode}
                  onBuildRoute={onBuildRoute}
                  onGo={onGo}
                  onClearRoute={onClearRoute}
                  onLocate={onLocate}
                  onToggleVoice={onToggleVoice}
                  t={t}
                />
              )}
              {p === "card" && (
                <PoiPaneCard
                  poi={poi}
                  locale={locale}
                  near={near}
                  routeSummary={
                    route
                      ? {
                          icon: MODE_ICON[route.mode],
                          text: `${t("etaMin", {
                            min: Math.max(1, Math.round(route.duration / 60)),
                          })} · ${formatDistance(route.distance)}`,
                        }
                      : null
                  }
                  onShowRoute={() => onPageChange("map")}
                  onStreetView={onStreetView}
                  t={t}
                />
              )}
              {p === "showcase" && <PoiPaneShowcase poi={poi} locale={locale} t={t} />}
            </div>
          ))}
        </div>
      </div>

      {/* На десктопе страницы карты нет, поэтому управление маршрутом стоит
          подвалом панели — ровно там, где его положил предыдущий слайс. */}
      {!phone && (
        <div className="shrink-0 border-t border-hairline">
          <PoiPaneMap
            poi={poi}
            route={route}
            mode={mode}
            status={status}
            hasOrigin={hasOrigin}
            voiceOn={voiceOn}
            voiceSupported={voiceSupported}
            tileRef={mapTileRef}
            expanded={false}
            docked
            onExpandedChange={onMapExpandedChange}
            onMode={onMode}
            onBuildRoute={onBuildRoute}
            onGo={onGo}
            onClearRoute={onClearRoute}
            onLocate={onLocate}
            onToggleVoice={onToggleVoice}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Тот же порог, которым карточка уже отличала телефон от десктопа. Читаем
 * медиазапрос как внешнее хранилище — тем же приёмом, что навигатор: на
 * сервере телефона нет, а состоянием в эффекте это был бы лишний прогон.
 */
const PHONE_QUERY = "(max-width: 767px)";
const subscribePhone = (onChange: () => void) => {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
};

function usePhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
