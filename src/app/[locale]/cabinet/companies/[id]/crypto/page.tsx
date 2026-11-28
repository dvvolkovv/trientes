import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { getViewerCompanyById, canEditSection, canSeeSection } from "@/lib/business";
import { CabinetBackButton } from "@/components/cabinet/back-button";
import { AddressPanel, type AddressRow } from "@/components/crypto/address-panel";
import { OpPanel, type OpRow } from "@/components/crypto/op-panel";
import { aggregateLedger } from "@/lib/crypto-ledger/aggregate";
import { addressKey } from "@/lib/crypto-ledger/address";
import {
  readCoinPrices,
  readCryptoAddresses,
  readLedgerOps,
  readLedgerReceipts,
  readSanctionHits,
  readUsdPerUnit,
  priceFor,
} from "@/lib/crypto-ledger/read";
import { compareRate, RATE_TOLERANCE_PCT } from "@/lib/crypto-ledger/rate-check";
import { OFFER_CURRENCIES } from "@/lib/products/offers-rules";
import { REPORT_RANGES, resolvePeriod, type ReportRange } from "@/lib/reports/period";
import { reportTimezone } from "@/lib/reports/read";
import { ADMIN_BUTTON_SECONDARY } from "@/lib/admin-ui";

export const dynamic = "force-dynamic";

/**
 * Криптоучёт предприятия (слайс CR, ТЗ 6.8). Книга в монете и фиате одновременно:
 * приходы из кассы, свои операции, остатки, средний курс получения, курсовая разница,
 * адреса и сверка с санкционным списком.
 *
 * Чего на экране нет и почему: **баланса в сети** (он считается по адресам в цепи, а не
 * по заявлениям — здесь он честно назван «по вашим записям»), **проверки хеша** (частичный
 * разбор отверг бы верную транзакцию) и **исторического курса фиата** (мы его не храним,
 * и сверка курса говорит это прямо).
 */
export default async function CompanyCryptoPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, id } = await params;
  const query = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations("cabinetCrypto");
  const { userId, company, permissions } = await getViewerCompanyById(id);
  if (!userId) redirect(`/${locale}/login`);
  if (!company) notFound();
  if (!canSeeSection(permissions, "reports")) notFound();
  const canWrite = canEditSection(permissions, "reports") && !company.suspendedAt && !company.deletedAt;

  const one = (key: string) => (Array.isArray(query[key]) ? query[key]?.[0] : query[key]) ?? null;
  const { tz } = await reportTimezone(company.id);
  const period = resolvePeriod({
    range: one("range") ?? "month",
    from: one("from"),
    to: one("to"),
    tz,
  });

  const [{ receipts, truncated: rTrunc }, { ops, truncated: oTrunc }, addresses] = await Promise.all([
    readLedgerReceipts(company.id, { from: period.from, to: period.to }),
    readLedgerOps(company.id, { from: period.from, to: period.to }),
    readCryptoAddresses(company.id),
  ]);

  // Санкционная сверка идёт по всем адресам, что у нас есть: своим из книги, адресам
  // чеков и адресам операций. Адресов плательщика у нас нет вовсе — кошелька платформы
  // не существует, и это сказано строкой внизу экрана.
  const allAddresses = [
    ...addresses.map((a) => a.address),
    ...receipts.map((r) => r.address).filter((a): a is string => Boolean(a)),
    ...ops.map((o) => o.address).filter((a): a is string => Boolean(a)),
  ];
  const sanctionHits = await readSanctionHits(allAddresses);
  const sanctionedKeys = new Set([...sanctionHits.keys()].map(addressKey));

  const summary = aggregateLedger(receipts, ops, {
    knownAddresses: addresses.filter((a) => !a.archivedAt).map((a) => a.address),
    sanctionedKeys,
    keyOf: addressKey,
    truncated: rTrunc || oTrunc,
  });

  // Сверка курса: наши цены того часа и сегодняшний курс фиата. Оба могут отсутствовать,
  // и тогда строка говорит «не сверено», а не «расходится».
  const [prices, usdPerUnit] = await Promise.all([
    readCoinPrices(
      [...receipts.map((r) => r.coin), ...ops.map((o) => o.coin)],
      { from: period.from, to: period.to },
    ),
    readUsdPerUnit([...receipts.map((r) => r.currency), ...ops.map((o) => o.currency)]),
  ]);

  const num = (value: number, digits = 8) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);

  function rateNoteFor(input: { rate: number | null; currency: string; coin: string; at: Date }) {
    const price = priceFor(prices, input.coin, input.at);
    const verdict = compareRate({
      rate: input.rate,
      usdPerUnit: usdPerUnit.get(input.currency) ?? null,
      ourUsd: price.usd,
      priceReason: price.reason ?? undefined,
    });
    if (verdict.state === "unchecked") {
      // «Нет курса» молчит: курс не обязателен, и строка про его отсутствие стояла бы у
      // каждой второй операции (правило AA — отчёт на двадцать одинаковых строк не читают).
      if (verdict.reason === "no_rate") return { note: null, off: false };
      return { note: t(`rate.unchecked.${verdict.reason}` as never), off: false };
    }
    const delta = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Math.abs(verdict.deltaPct));
    const ours = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(verdict.ourUsd);
    return verdict.state === "off"
      ? { note: t("rate.off", { delta, ours }), off: true }
      : { note: t("rate.ok", { delta, ours }), off: false };
  }

  const addressRows: AddressRow[] = addresses.map((a) => {
    const total = summary.addresses.find((row) => addressKey(row.address) === a.addressKey);
    return {
      id: a.id,
      coin: a.coin,
      address: a.address,
      label: a.label,
      family: a.family,
      archived: Boolean(a.archivedAt),
      receivedText: num(total?.receivedCoins ?? 0),
      sanctioned: sanctionedKeys.has(a.addressKey),
    };
  });

  const opRows: OpRow[] = ops.map((o) => {
    const check = rateNoteFor({ rate: o.rate, currency: o.currency, coin: o.coin, at: o.happenedAt });
    return {
      id: o.id,
      kind: o.kind,
      coin: o.coin,
      amountText: num(o.amount),
      fiatText: o.fiatAmount === null ? null : money(o.fiatAmount, o.currency),
      rateText: o.rate === null ? null : money(o.rate, o.currency),
      currency: o.currency,
      day: o.happenedAt.toISOString().slice(0, 10),
      address: o.address,
      txHash: o.txHash,
      note: o.note,
      authorName: o.authorName,
      rateNote: check.note,
      rateOff: check.off,
      sanctioned: Boolean(o.address && sanctionedKeys.has(addressKey(o.address))),
    };
  });

  const hits = [...sanctionHits.entries()];
  const unknownAddresses = summary.addresses.filter((a) => !a.known);
  const exportHref = (kind: "operations" | "receipts") =>
    `/api/company-crypto/${company.id}/export?kind=${kind}&range=custom&from=${period.fromDay}&to=${period.toDay}`;
  const rangeHref = (range: ReportRange) =>
    `/${locale}/cabinet/companies/${company.id}/crypto?range=${range}`;

  return (
    <main className="mx-auto w-full max-w-[900px] overflow-x-clip px-4 py-8 md:px-6">
      <div className="mb-4">
        <CabinetBackButton locale={locale} />
      </div>
      <nav className="mb-5 text-[12px] text-muted">
        <Link href={`/${locale}/cabinet/companies/${company.id}`} className="hover:text-foreground">
          {company.displayName}
        </Link>
        <span className="mx-2">/</span>
        <span>{t("title")}</span>
      </nav>

      <header className="mb-5">
        <h1 className="text-[26px] font-bold tracking-[-0.02em]">{t("title")}</h1>
        <p className="mt-1 text-[13px] leading-snug text-muted">{t("subtitle")}</p>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        {REPORT_RANGES.filter((r) => r !== "custom").map((r) => (
          <Link
            key={r}
            href={rangeHref(r)}
            className={`min-h-11 rounded-[12px] border px-3 text-[13px] font-medium flex items-center ${
              period.range === r ? "border-accent text-accent" : "border-hairline hover:border-accent"
            }`}
          >
            {t(`range.${r}` as never)}
          </Link>
        ))}
      </div>

      {hits.length > 0 ? (
        <section className="mb-5 rounded-[14px] border border-danger bg-danger/5 p-4">
          <h2 className="text-[15px] font-semibold text-danger">{t("sanctions.heading")}</h2>
          <p className="mt-1 text-[12.5px] leading-snug">{t("sanctions.body")}</p>
          <ul className="mt-2 space-y-1">
            {hits.map(([address, hit]) => (
              <li key={address} className="num break-all text-[12px] leading-snug">
                {address}
                <span className="text-muted">
                  {" — "}
                  {hit.listedName ?? t("sanctions.noName")}
                  {hit.programs ? ` · ${hit.programs}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-5 rounded-[14px] border border-hairline bg-card p-4">
        <h2 className="text-[15px] font-semibold">{t("coins.heading")}</h2>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">{t("coins.hint")}</p>
        {summary.coins.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted">{t("coins.empty")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {summary.coins.map((coin) => (
              <li key={coin.coin} className="rounded-[12px] border border-hairline p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15px] font-semibold">{coin.coin}</span>
                  <span className="num text-[15px] font-semibold">
                    {num(coin.balanceCoins)} {coin.coin}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-snug text-muted">{t("coins.balanceLabel")}</p>
                {coin.negative ? (
                  <p className="mt-2 text-[12.5px] font-semibold leading-snug text-danger">{t("coins.negative")}</p>
                ) : null}
                <dl className="mt-2 space-y-1 text-[12.5px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{t("coins.received")}</dt>
                    <dd className="num">{num(coin.receivedCoins)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{t("coins.converted")}</dt>
                    <dd className="num">{num(coin.convertedCoins)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{t("coins.withdrawn")}</dt>
                    <dd className="num">{num(coin.withdrawnCoins)}</dd>
                  </div>
                </dl>
                {coin.byCurrency.map((leg) => (
                  <div key={leg.currency} className="mt-2 border-t border-hairline pt-2 text-[12.5px]">
                    <div className="flex justify-between gap-3">
                      <span className="text-muted">{t("coins.receivedFiat", { currency: leg.currency })}</span>
                      <span className="num">{money(leg.receivedFiat, leg.currency)}</span>
                    </div>
                    {leg.avgRate !== null ? (
                      <div className="flex justify-between gap-3">
                        <span className="text-muted">{t("coins.avgRate")}</span>
                        <span className="num">{money(leg.avgRate, leg.currency)}</span>
                      </div>
                    ) : null}
                    {leg.fxDiff !== null ? (
                      <div className="flex justify-between gap-3">
                        <span className="text-muted">{t("coins.fxDiff", { count: leg.fxOps })}</span>
                        <span className={`num ${leg.fxDiff < 0 ? "text-danger" : ""}`}>
                          {leg.fxDiff > 0 ? "+" : ""}
                          {money(leg.fxDiff, leg.currency)}
                        </span>
                      </div>
                    ) : (
                      <p className="mt-1 text-[11.5px] leading-snug text-muted">{t("coins.fxUnknown")}</p>
                    )}
                  </div>
                ))}
                {coin.cancelledCount > 0 ? (
                  <p className="mt-2 text-[11.5px] leading-snug text-muted">
                    {t("coins.cancelled", { count: coin.cancelledCount })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11.5px] leading-snug text-muted">{t("coins.method")}</p>
        {summary.truncated ? (
          <p className="mt-1 text-[11.5px] leading-snug text-danger">{t("coins.truncated")}</p>
        ) : null}
      </section>

      <div className="mb-5">
        <AddressPanel companyId={company.id} rows={addressRows} canWrite={canWrite} />
        {unknownAddresses.length > 0 ? (
          <p className="mt-2 text-[12px] leading-snug text-muted">
            {t("addresses.unknownNote", { count: unknownAddresses.length })}
          </p>
        ) : null}
      </div>

      <div className="mb-5">
        <OpPanel
          companyId={company.id}
          rows={opRows}
          currencies={OFFER_CURRENCIES}
          defaultCurrency={receipts[0]?.currency ?? ops[0]?.currency ?? OFFER_CURRENCIES[0]}
          today={new Date().toISOString().slice(0, 10)}
          canWrite={canWrite}
        />
      </div>

      <section className="mb-5 rounded-[14px] border border-hairline bg-card p-4">
        <h2 className="text-[15px] font-semibold">{t("receipts.heading")}</h2>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">{t("receipts.hint")}</p>
        {receipts.length === 0 ? (
          <p className="mt-3 text-[13px] text-muted">{t("receipts.empty")}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {receipts.map((r) => {
              const check = rateNoteFor({ rate: r.rate, currency: r.currency, coin: r.coin, at: r.at });
              return (
                <li key={r.saleId} className="rounded-[12px] border border-hairline p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link
                      href={`/${locale}/cabinet/companies/${company.id}/sales/${r.saleId}`}
                      className="text-[13px] font-semibold hover:text-accent"
                    >
                      {t("receipts.number", { number: r.number })}
                    </Link>
                    <span className="num text-[12px] text-muted">{r.at.toISOString().slice(0, 10)}</span>
                  </div>
                  <p className="num mt-1 text-[13px]">
                    {r.coinAmount !== null ? `${num(r.coinAmount)} ${r.coin}` : r.coin}
                    {" · "}
                    {money(r.total, r.currency)}
                    {r.cancelled ? ` · ${t("receipts.cancelled")}` : ""}
                  </p>
                  {check.note ? (
                    <p className={`mt-1 text-[11.5px] leading-snug ${check.off ? "text-danger" : "text-muted"}`}>
                      {check.note}
                    </p>
                  ) : null}
                  {r.address ? <p className="num mt-1 break-all text-[11.5px] text-muted">{r.address}</p> : null}
                  {r.txHash ? <p className="num mt-1 break-all text-[11.5px] text-muted">{r.txHash}</p> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-[14px] border border-hairline bg-card p-4">
        <h2 className="text-[15px] font-semibold">{t("export.heading")}</h2>
        <p className="mt-1 text-[12.5px] leading-snug text-muted">{t("export.hint")}</p>
        {canWrite ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={exportHref("operations")} className={ADMIN_BUTTON_SECONDARY}>
              {t("export.operations")}
            </a>
            <a href={exportHref("receipts")} className={ADMIN_BUTTON_SECONDARY}>
              {t("export.receipts")}
            </a>
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] leading-snug text-muted">{t("export.needEdit")}</p>
        )}
        <p className="mt-3 text-[11.5px] leading-snug text-muted">{t("notes.noChainBalance")}</p>
        <p className="mt-1 text-[11.5px] leading-snug text-muted">{t("notes.noPayerAddress")}</p>
        <p className="mt-1 text-[11.5px] leading-snug text-muted">
          {t("notes.tolerance", { pct: RATE_TOLERANCE_PCT })}
        </p>
      </section>
    </main>
  );
}
