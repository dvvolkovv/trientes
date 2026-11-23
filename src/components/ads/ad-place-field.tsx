"use client";

import { useEffect, useRef, useState } from "react";
import { type Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "@/lib/maplibre-worker";
import { useTranslations } from "next-intl";
import { addStaticMapAttribution, MAPLIBRE_ATTRIBUTION_OPTIONS } from "@/lib/maplibre-attribution";
import { tryCreateMap } from "@/lib/maplibre-map";
import { basemapStyle } from "@/lib/basemap";
import { CoinPicker, type PickerCoin } from "@/components/business/coin-picker";
import { PAYMENT_METHODS } from "@/lib/payment-methods";
import { placeQueryOrder } from "@/lib/geocode-place";
import { hasCyrillic } from "@/lib/translit";

/**
 * Место рекламного материала (слайс BZ): «где это находится».
 *
 * Объект рекламы — **не точка приёма**, и на общую карту он не попадает: карта
 * навигатора обещает «здесь принимают монеты», а офис, площадка события или дом в
 * продаже такого не обещают. Поэтому место живёт полями материала, а не строкой
 * `CompanyPoint`, и показывается только в самом материале.
 *
 * Булавка ставится нажатием по карте и двигается перетаскиванием; адрес можно просто
 * набрать — его ищет тот же геокодер, что в форме точки. Что здесь принимают —
 * свободное поле, как часы и вид заведения (BN): фильтром карты оно не служит.
 */
const PRAGUE: [number, number] = [14.4212535, 50.0874654];

export type AdPlaceValue = {
  placeName: string;
  placeAddress: string;
  placeLat: number | null;
  placeLon: number | null;
  placeAcceptedCoinIds: string[];
  placeAcceptedCardIds: string[];
  placePaymentMethods: string[];
};

/** Подсказка геокодера: две строки, как в поиске навигатора. */
type Suggestion = { label: string; title?: string; subtitle?: string; lat: number; lon: number };

export function AdPlaceField({
  value,
  onChange,
  coins,
  cards,
  countryCode = null,
  open,
  onOpenChange,
}: {
  value: AdPlaceValue;
  onChange: (patch: Partial<AdPlaceValue>) => void;
  coins: PickerCoin[];
  cards: PickerCoin[];
  /**
   * Страна предприятия: геокодер с ней отвечает точнее, а кириллический адрес
   * без неё не переводится в латиницу вовсе (`geocodeQueryOrder`). Место
   * материала бывает и в другой стране — поэтому это подсказка, а не фильтр
   * ответа: не нашлось со страной — спрашиваем ещё раз без неё.
   */
  countryCode?: string | null;
  /** Раскрыт ли блок. Состояние держит форма: выбор «вести на место материала»
   *  в разделе действия обязан раскрывать этот блок, а не искать его глазами. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("cabinetAds");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;
  // Состояние поиска одно на обе двери — кнопку и поиск по ходу набора: «ничего
  // не происходит» было ровно тем, что человек видел, когда геокодер отвечал
  // пусто, а сказано об этом было серой строкой в 11 px.
  const [status, setStatus] = useState<"idle" | "searching" | "pinned" | "failed">("idle");
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  // Набранное руками ищется само; у открытой на правку записи адрес уже стоит, и
  // геокодер не должен немедленно сдвинуть булавку, поставленную человеком
  // (то же правило, что `addrTouchedRef` в форме точки).
  const typedRef = useRef(false);
  /** Запрос в полёте и отложенный поиск по набору: обе двери ведут одну работу. */
  const searchCtrlRef = useRef<AbortController | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const field = "w-full rounded-md border border-hairline bg-card px-3 py-2 text-sm";
  const label = "mb-1 block text-[11px] uppercase tracking-wider text-muted";
  const button =
    "inline-flex h-12 items-center justify-center rounded-md border border-hairline px-4 text-sm hover:border-accent disabled:opacity-50";

  /**
   * Булавка поставлена пальцем — подписываем её адресом. Набранное человеком не
   * перебиваем: он мог написать «площадка у озера», и адрес из реестра стёр бы
   * его слова.
   */
  async function fillAddressFromPin(lat: number, lon: number) {
    if (valueRef.current.placeAddress.trim()) return;
    try {
      const r = await fetch(`/api/crypto-map/geocode?lat=${lat}&lon=${lon}`, {
        signal: AbortSignal.timeout(8000),
      });
      const j = (await r.json()) as { result?: { label?: string; title?: string; subtitle?: string } | null };
      const found = j.result;
      if (!found) return;
      const address = [found.title, found.subtitle].filter(Boolean).join(", ") || (found.label ?? "");
      if (address && !valueRef.current.placeAddress.trim()) onChangeRef.current({ placeAddress: address });
    } catch {
      // Молчание геокодера булавку не отменяет: координата и есть место.
    }
  }

  function placeMarker(map: MlMap, lng: number, lat: number) {
    if (markerRef.current) markerRef.current.setLngLat([lng, lat]);
    else {
      const mk = new Marker({ color: "#FE5C04", draggable: true }).setLngLat([lng, lat]).addTo(map);
      mk.on("dragend", () => {
        const l = mk.getLngLat();
        onChangeRef.current({ placeLat: l.lat, placeLon: l.lng });
        void fillAddressFromPin(l.lat, l.lng);
      });
      markerRef.current = mk;
    }
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), duration: 500 });
  }

  useEffect(() => {
    if (!open || !containerRef.current) return;
    const map = tryCreateMap({
      container: containerRef.current,
      style: basemapStyle(),
      center: value.placeLon !== null && value.placeLat !== null ? [value.placeLon, value.placeLat] : PRAGUE,
      zoom: value.placeLat !== null ? 14 : 11,
      ...MAPLIBRE_ATTRIBUTION_OPTIONS,
    });
    if (!map) {
      // Нет WebGL2 — карты нет, но место остаётся: адрес ищется словами, булавку
      // ставит геокодер (тот же запасной путь, что в форме точки).
      setMapUnavailable(true);
      return;
    }
    addStaticMapAttribution(map);
    mapRef.current = map;
    map.on("click", (e) => {
      onChangeRef.current({ placeLat: e.lngLat.lat, placeLon: e.lngLat.lng });
      placeMarker(map, e.lngLat.lng, e.lngLat.lat);
      setSuggestions([]);
      void fillAddressFromPin(e.lngLat.lat, e.lngLat.lng);
    });
    map.once("load", () => {
      if (value.placeLat !== null && value.placeLon !== null) placeMarker(map, value.placeLon, value.placeLat);
    });
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Карта создаётся один раз на раскрытие: пересоздавать её на каждое движение
    // булавки означало бы терять масштаб, выбранный человеком.
  }, [open]);

  /** Берём подсказку: булавка, нормализованный адрес и закрытый список. */
  function takeSuggestion(s: Suggestion) {
    const address = [s.title, s.subtitle].filter(Boolean).join(", ") || s.label;
    typedRef.current = false;
    setSuggestions([]);
    setStatus("pinned");
    onChange({ placeAddress: address, placeLat: s.lat, placeLon: s.lon });
    const map = mapRef.current;
    if (map) placeMarker(map, s.lon, s.lat);
  }

  /**
   * Булавка по найденному — но набранный адрес остаётся как набран. Человек не
   * выбирал этот вариант, а геокодер нормализует по-своему («Brehmstraße,
   * 1110 Wien, Österreich» вместо дома с индексом): подменять его слова, пока он
   * не нажал на строку списка, нельзя — то же правило, что у подписи булавки.
   */
  function pinSuggestion(s: Suggestion) {
    onChangeRef.current({ placeLat: s.lat, placeLon: s.lon });
    const map = mapRef.current;
    if (map) placeMarker(map, s.lon, s.lat);
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /**
   * Спрашиваем геокодер по списку кандидатов до первого непустого ответа
   * (`placeQueryOrder`): название с адресом Nominatim знает только у знаменитых
   * мест, а один адрес — почти всегда. Пауза 1100 мс между запросами — предел
   * Nominatim, один запрос в секунду; тот же шаг, что в самом маршруте.
   *
   * Страна уходит в запрос только при кириллическом наборе: там она решает, по
   * каким правилам читать адрес (немецкие или общие). У латинского набора
   * страна — жёсткий фильтр ответа, и место в соседней стране она бы отрезала.
   */
  async function askGeocoder(signal?: AbortSignal): Promise<Suggestion[]> {
    const v = valueRef.current;
    const cc = countryCode && /^[a-z]{2}$/i.test(countryCode) ? countryCode.toUpperCase() : null;
    const urls: string[] = [];
    for (const q of placeQueryOrder(v.placeName, v.placeAddress)) {
      const base = `/api/crypto-map/geocode?q=${encodeURIComponent(q)}`;
      if (cc && hasCyrillic(q)) urls.push(`${base}&cc=${cc}`);
      urls.push(base);
    }
    for (let i = 0; i < Math.min(urls.length, 4); i += 1) {
      if (signal?.aborted) return [];
      if (i > 0) await sleep(1100);
      const r = await fetch(urls[i]!, { signal: signal ?? AbortSignal.timeout(9000) });
      const j = (await r.json()) as { results?: Suggestion[] };
      const list = (j.results ?? [])
        .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon))
        .slice(0, 5);
      if (list.length > 0) return list;
    }
    return [];
  }

  /**
   * Нашли — ставим булавку сразу на первое найденное: «автоматический поиск
   * кладёт булавку» и есть то, чего ждёт человек, нажавший «найти на карте».
   * Список при этом остаётся открытым, если найдено не одно: выбор уточняет
   * нажатием, а не остаётся без метки вовсе.
   */
  function applyFound(list: Suggestion[], movePin: boolean) {
    setSuggestions(list.length > 1 ? list : []);
    if (list.length === 0) {
      setStatus("failed");
      return;
    }
    if (movePin) pinSuggestion(list[0]!);
    setStatus("pinned");
  }

  /**
   * Поиск один на обе двери — кнопку и набор. Прежде они шли параллельно и
   * спрашивали геокодер по два раза подряд (живой прогон: шесть запросов на одно
   * нажатие), а у Nominatim предел один запрос в секунду.
   *
   * `if-empty` — поиск по ходу набора: он ставит метку только пока её нет.
   * Поставленную пальцем метку набор адреса дёргать не должен.
   */
  async function runSearch(pin: "always" | "if-empty") {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    searchCtrlRef.current?.abort();
    const ctrl = new AbortController();
    searchCtrlRef.current = ctrl;
    setStatus("searching");
    try {
      const list = await askGeocoder(ctrl.signal);
      if (ctrl.signal.aborted) return;
      const movePin =
        pin === "always" || valueRef.current.placeLat === null || valueRef.current.placeLon === null;
      applyFound(list, movePin);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setStatus("failed");
    }
  }

  // Адрес ищется по ходу набора: человек пишет улицу — мы показываем, что нашли.
  // Пауза 700 мс не из вкуса: у Nominatim предел один запрос в секунду, и запрос
  // на каждую букву вернулся бы отказом.
  useEffect(() => {
    if (!open || !typedRef.current) return;
    if (placeQueryOrder(value.placeName, value.placeAddress).length === 0) return;
    const tm = setTimeout(() => void runSearch("if-empty"), 700);
    autoTimerRef.current = tm;
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value.placeName, value.placeAddress]);

  // Ушли со страницы посреди запроса — запрос снимаем: отвечать уже некому.
  useEffect(() => () => searchCtrlRef.current?.abort(), []);

  function clearPlace() {
    markerRef.current?.remove();
    markerRef.current = null;
    onChange({
      placeName: "", placeAddress: "", placeLat: null, placeLon: null,
      placeAcceptedCoinIds: [], placeAcceptedCardIds: [], placePaymentMethods: [],
    });
    setSuggestions([]);
    setStatus("idle");
    typedRef.current = false;
    onOpenChange(false);
  }

  if (!open) {
    return (
      <div>
        <span className={label}>{t("placeTitle")}</span>
        <button type="button" className={button} onClick={() => onOpenChange(true)}>
          📍 {t("placeAdd")}
        </button>
        <p className="mt-1 text-[11px] text-muted">{t("placeHint")}</p>
      </div>
    );
  }

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  return (
    <div className="rounded-[14px] border border-hairline bg-card-alt/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className={`${label} mb-0`}>{t("placeTitle")}</span>
        <button type="button" className="text-[12px] text-muted underline" onClick={clearPlace}>
          {t("placeRemove")}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="ad-place-name">{t("placeName")}</label>
          <input id="ad-place-name" className={field} value={value.placeName}
            onChange={(e) => { typedRef.current = true; onChange({ placeName: e.target.value }); }} />
        </div>
        <div>
          <label className={label} htmlFor="ad-place-address">{t("placeAddress")}</label>
          <input id="ad-place-address" className={field} value={value.placeAddress}
            onChange={(e) => { typedRef.current = true; onChange({ placeAddress: e.target.value }); }} />
          <p className="mt-1 text-[11px] text-muted">{t("placeTypeHint")}</p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          onClick={() => void runSearch("always")}
          disabled={status === "searching"}
        >
          {status === "searching" ? "…" : t("placeFind")}
        </button>
        {value.placeLat !== null && value.placeLon !== null ? (
          <span className="num text-[11.5px] text-muted">
            {value.placeLat.toFixed(5)}, {value.placeLon.toFixed(5)}
          </span>
        ) : (
          <span className="text-[11.5px] text-muted">{t("placeNoPin")}</span>
        )}
      </div>
      {/* Исход поиска словами. Прежде он весь сводился к серой строке «не
          найдено» в 11,5 px, и нажатие кнопки выглядело как «ничего не
          происходит» — жалоба владельца 23 ноября. */}
      {status !== "idle" ? (
        <p
          className={`mt-1.5 text-[12.5px] font-semibold ${
            status === "failed" ? "text-accent" : "text-muted-strong"
          }`}
        >
          {status === "searching"
            ? t("placeSearching")
            : status === "failed"
              ? t("placeNotFound")
              : suggestions.length > 1
                ? t("placePinnedPickOther")
                : t("placePinned")}
        </p>
      ) : null}
      {suggestions.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {suggestions.map((s) => (
            <li key={`${s.lat},${s.lon},${s.label}`}>
              <button
                type="button"
                onClick={() => takeSuggestion(s)}
                className="flex min-h-[48px] w-full flex-col justify-center rounded-[12px] border border-hairline bg-card px-3 py-2 text-left hover:border-accent"
              >
                <span className="text-[13px] font-semibold leading-tight">{s.title ?? s.label}</span>
                {s.subtitle ? <span className="text-[11.5px] leading-tight text-muted">{s.subtitle}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!mapUnavailable ? (
        <div ref={containerRef} className="mt-2 h-[260px] w-full overflow-hidden rounded-[14px] border border-hairline" />
      ) : null}
      <p className="mt-1 text-[11px] text-muted">{t("placeMapHint")}</p>

      <div className="mt-3">
        <span className={label}>{t("placeAccepts")}</span>
        <div className="mb-2 flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => {
            const on = value.placePaymentMethods.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => onChange({ placePaymentMethods: toggle(value.placePaymentMethods, m.key) })}
                className={`h-11 rounded-[12px] border px-4 text-[13px] font-semibold ${
                  on ? "border-accent bg-accent/12 text-foreground" : "border-hairline bg-card text-muted"
                }`}
              >
                <span aria-hidden className="mr-1.5">{m.emoji}</span>
                {t(`payment.${m.key}`)}
              </button>
            );
          })}
        </div>
        <CoinPicker
          coins={[...cards, ...coins]}
          selected={[...value.placeAcceptedCardIds, ...value.placeAcceptedCoinIds]}
          onToggle={(id) => {
            const isCard = cards.some((c) => c.id === id);
            if (isCard) onChange({ placeAcceptedCardIds: toggle(value.placeAcceptedCardIds, id) });
            else onChange({ placeAcceptedCoinIds: toggle(value.placeAcceptedCoinIds, id) });
          }}
          searchLabel={t("placeCoinSearch")}
          emptyLabel={t("placeCoinEmpty")}
        />
      </div>
    </div>
  );
}
