"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { ADMIN_BUTTON } from "@/lib/admin-ui";
import {
  cancelPayLinkChange,
  checkPayLink,
  issuePayLinkCode,
  removePayLink,
  savePayLink,
  type PayLinkPreview,
} from "@/app/actions/pay-link";

/**
 * Подключение приёма платежей (слайс CP) — четыре шага в одном экране.
 *
 * Поле и кнопки рисуются здесь, а решают всё серверные действия: права, код, свежесть
 * входа и задержка проверяются **на сервере** (§ 2.7), потому что действие вызывается
 * и прямым запросом. Экран ничего не решает — он объясняет.
 *
 * Готовый код виджета из кабинета оплаты в карточку как HTML не принимается вовсе
 * (§ 3): это хранимый XSS, а собрать кнопку сайт умеет сам.
 */
/** Отказы, у которых есть свои слова. Список один с переводами и накрыт тестом. */
export const KNOWN_ERRORS = new Set([
  "unauth", "not_found", "suspended", "csrf", "empty", "bad_link", "too_many_checks",
  "link_missing", "link_off", "link_later", "stale_login", "code_required",
  "contact_frozen", "no_channel", "same_link", "no_pending", "no_link",
]);

export function PayLinkSection({
  companyId,
  locale,
  csrf,
  cabinetHref,
  current,
  pending,
  loginFresh,
  reauthHref,
  frozenUntil,
  reachable,
}: {
  companyId: string;
  locale: string;
  csrf: string;
  cabinetHref: string;
  current: {
    linkId: string;
    merchantId: string;
    merchantName: string;
    title: string | null;
    amount: string | null;
    unit: string;
    coinSymbol: string | null;
    checkedAt: string;
    disabled: boolean;
    hidden: boolean;
    hiddenReason: string | null;
    payHref: string;
  } | null;
  pending: { linkId: string; merchantId: string; merchantName: string; effectiveAt: string } | null;
  loginFresh: boolean;
  reauthHref: string;
  frozenUntil: string | null;
  /** Есть ли куда писать владельцу. Нет — смена существующей ссылки запрещена. */
  reachable: boolean;
}) {
  const t = useTranslations("payLink");
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<PayLinkPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, start] = useTransition();

  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

  // Единица суммы: `$` при `usd`, символ монеты при `coin`. Пустая сумма — «сумму
  // выбирает покупатель»: это не ноль и не «любая», а выбор на стороне покупателя.
  const money = (amount: string | null, unit: string, symbol: string | null) => {
    if (amount === null) return t("amountFree");
    return unit === "usd" ? `$${amount}` : `${amount} ${symbol ?? ""}`.trim();
  };

  // Своих слов у отказа может и не быть (новый код из будущей правки) — тогда общая
  // фраза, а не путь ключа на экране: та же болезнь, что `TASK_CREATED` в живом
  // прогоне BF.
  const fail = (reason: string) =>
    setError(KNOWN_ERRORS.has(reason) ? t(`error.${reason}`) : t("error.generic"));

  const onCode = () =>
    start(async () => {
      setError(null);
      const r = await issuePayLinkCode(companyId, csrf);
      if (!r.ok) return fail(r.reason);
      setCode({ code: r.code, expiresAt: r.expiresAt });
    });

  const onCheck = () =>
    start(async () => {
      setError(null);
      setDone(null);
      setPreview(null);
      const r = await checkPayLink(companyId, raw, csrf);
      if (!r.ok) return fail(r.reason);
      setPreview(r);
      if (r.plan === "deny" && r.denyReason) fail(r.denyReason);
    });

  const onSave = () =>
    start(async () => {
      setError(null);
      const r = await savePayLink(companyId, raw, csrf);
      if (!r.ok) return fail(r.reason);
      setPreview(null);
      setRaw("");
      setCode(null);
      setDone(r.applied ? t("savedNow") : t("savedDelayed", { when: when(r.effectiveAt) }));
    });

  const onCancel = () =>
    start(async () => {
      setError(null);
      const r = await cancelPayLinkChange(companyId, csrf);
      if (!r.ok) return fail(r.reason);
      setDone(t("changeCancelled"));
    });

  const onRemove = () =>
    start(async () => {
      setError(null);
      const r = await removePayLink(companyId, csrf);
      if (!r.ok) return fail(r.reason);
      setConfirmRemove(false);
      setDone(t("removed"));
    });

  return (
    <div className="space-y-5">
      {current ? (
        <section className="rounded-[18px] border border-hairline bg-card p-4 space-y-2">
          <h2 className="text-[13px] uppercase tracking-[0.2em] text-muted">{t("currentTitle")}</h2>
          <div className="text-[15px] font-semibold">{current.merchantName}</div>
          <div className="num text-[12px] text-muted">{current.merchantId}</div>
          <dl className="grid gap-1 text-[13px]">
            <div className="flex flex-wrap gap-2">
              <dt className="text-muted">{t("field.link")}</dt>
              <dd className="num">{current.linkId}</dd>
            </div>
            {current.title ? (
              <div className="flex flex-wrap gap-2">
                <dt className="text-muted">{t("field.title")}</dt>
                <dd>{current.title}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <dt className="text-muted">{t("field.amount")}</dt>
              <dd className="num">{money(current.amount, current.unit, current.coinSymbol)}</dd>
            </div>
            <div className="flex flex-wrap gap-2">
              <dt className="text-muted">{t("field.checked")}</dt>
              <dd className="num">{when(current.checkedAt)}</dd>
            </div>
          </dl>
          {current.hidden ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] leading-snug text-red-300">
              {t(current.hiddenReason === "merchant_mismatch" ? "hiddenMismatch" : "hiddenMissing")}
            </p>
          ) : null}
          {current.disabled ? (
            <p className="rounded-xl bg-bg-tint px-3 py-2 text-[12.5px] leading-snug text-muted">
              {t("disabledNote")}
            </p>
          ) : null}
          {!current.hidden ? (
            <a
              href={current.payHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-[12.5px] text-accent underline"
            >
              {t("openPayPage")}
            </a>
          ) : null}
          {confirmRemove ? (
            <div className="space-y-2">
              <p className="text-[12.5px] leading-snug text-muted">{t("removeConfirm")}</p>
              <button type="button" onClick={onRemove} disabled={busy} className={ADMIN_BUTTON}>
                {t("removeYes")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              disabled={busy}
              className={`${ADMIN_BUTTON} text-muted`}
            >
              {t("remove")}
            </button>
          )}
        </section>
      ) : (
        <section className="rounded-[18px] border border-hairline bg-card p-4 space-y-3">
          <h2 className="text-[13px] uppercase tracking-[0.2em] text-muted">{t("step1Title")}</h2>
          <p className="text-[13px] leading-snug text-muted">{t("step1Body")}</p>
          <a
            href={cabinetHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="pay-connect"
            className={`${ADMIN_BUTTON} border-accent text-accent`}
          >
            {t("connect")}
          </a>
        </section>
      )}

      {pending ? (
        <section className="rounded-[18px] border border-up/40 bg-up/10 p-4 space-y-2">
          <h2 className="text-[13px] uppercase tracking-[0.2em] text-muted">{t("pendingTitle")}</h2>
          <p className="text-[13px] leading-snug">
            {t("pendingBody", {
              merchant: pending.merchantName,
              merchantId: pending.merchantId,
              when: when(pending.effectiveAt),
            })}
          </p>
          <p className="text-[12.5px] leading-snug text-muted">{t("pendingOldWorks")}</p>
          <button type="button" onClick={onCancel} disabled={busy} className={ADMIN_BUTTON}>
            {t("cancelChange")}
          </button>
        </section>
      ) : null}

      <section className="rounded-[18px] border border-hairline bg-card p-4 space-y-3">
        <h2 className="text-[13px] uppercase tracking-[0.2em] text-muted">{t("step2Title")}</h2>
        <p className="text-[13px] leading-snug text-muted">{t("step2Body")}</p>
        {/* Код вписывает только владелец и только в своём кабинете. Эта строка —
            из задания дословно: сотрудники Trientes код не спрашивают. */}
        <p className="rounded-xl bg-bg-tint px-3 py-2 text-[12.5px] leading-snug">{t("codeWarning")}</p>
        {code ? (
          <div className="space-y-1">
            <div className="num select-all rounded-xl border border-hairline bg-bg-tint px-3 py-2 text-[20px] font-bold tracking-[0.2em]">
              {code.code}
            </div>
            <p className="text-[12px] text-muted">{t("codeExpires", { when: when(code.expiresAt) })}</p>
          </div>
        ) : (
          <button type="button" onClick={onCode} disabled={busy} className={ADMIN_BUTTON}>
            {t("getCode")}
          </button>
        )}
      </section>

      <section className="rounded-[18px] border border-hairline bg-card p-4 space-y-3">
        <h2 className="text-[13px] uppercase tracking-[0.2em] text-muted">{t("step3Title")}</h2>
        <p className="text-[13px] leading-snug text-muted">{t("step3Body")}</p>
        {!loginFresh ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] leading-snug text-red-300">
            {t("error.stale_login")}{" "}
            <a href={reauthHref} className="underline">
              {t("reauth")}
            </a>
          </p>
        ) : null}
        {!reachable && current ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] leading-snug text-red-300">
            {t("noChannelHint")}
          </p>
        ) : null}
        {frozenUntil ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] leading-snug text-red-300">
            {t("frozenUntil", { when: when(frozenUntil) })}
          </p>
        ) : null}
        <label className="block space-y-1">
          <span className="text-[12.5px] text-muted">{t("field.linkInput")}</span>
          <input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="https://trientes.org/exchange/#/l/pl_..."
            data-testid="pay-link-input"
            className="w-full rounded-xl border border-hairline bg-bg-tint px-3 py-2.5"
          />
        </label>
        <button
          type="button"
          onClick={onCheck}
          disabled={busy || raw.trim() === ""}
          data-testid="pay-link-check"
          className={ADMIN_BUTTON}
        >
          {t("check")}
        </button>

        {error ? (
          <p
            data-testid="pay-link-error"
            className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] leading-snug text-red-300"
          >
            {error}
          </p>
        ) : null}
        {done ? (
          <p
            data-testid="pay-link-done"
            className="rounded-xl border border-up/40 bg-up/10 px-3 py-2 text-[12.5px] leading-snug"
          >
            {done}
          </p>
        ) : null}

        {preview && preview.plan !== "deny" ? (
          <div className="space-y-2 rounded-xl border border-hairline bg-bg-tint p-3">
            <p className="text-[13px] leading-snug">
              {t("confirmLine", {
                merchant: preview.merchant,
                merchantId: preview.merchantId,
                title: preview.title,
                amount: money(preview.amount, preview.unit, preview.coinSymbol),
              })}
            </p>
            {/* Имя задаёт владелец ссылки, и Trientes его не проверяет: защита — в
                номере магазина, коде и задержке, а не в имени (§ 2.4 и § 2.8). */}
            <p className="text-[12px] leading-snug text-muted">{t("confirmWarning")}</p>
            {preview.plan === "delayed" && preview.effectiveAt ? (
              <p className="text-[12.5px] leading-snug">
                {t("confirmDelayed", { when: when(preview.effectiveAt) })}
              </p>
            ) : null}
            <button
              type="button"
              onClick={onSave}
              disabled={busy}
              data-testid="pay-link-save"
              className={`${ADMIN_BUTTON} border-accent text-accent`}
            >
              {t("confirmYes")}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
