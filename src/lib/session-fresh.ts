/**
 * Свежесть входа — «sudo-режим» для действий, которые меняют получателя денег
 * (задание, § 2.6: смена ссылки оплаты только при входе не старше 15 минут).
 *
 * У сеанса этого факта не было вовсе: `Session` знал только срок и показ второго
 * фактора. Появились `createdAt` (вход) и `reauthAt` (подтверждение личности внутри
 * сеанса — пароль или код на `/cabinet/reauth`). Показ второго фактора считается тоже:
 * человек только что доказал, что телефон у него.
 *
 * Выход и повторный вход годится как подтверждение сам по себе — он создаёт новый
 * сеанс, то есть новый `createdAt`.
 */
import { prisma } from "@/lib/prisma";
import { currentSessionToken } from "@/lib/csrf";

export type SessionStamps = { createdAt: Date; reauthAt: Date | null; mfaAt: Date | null };

/** Самое позднее доказательство личности в этом сеансе. */
export function freshLoginAt(s: SessionStamps | null): Date | null {
  if (!s) return null;
  const times = [s.createdAt.getTime(), s.reauthAt?.getTime() ?? 0, s.mfaAt?.getTime() ?? 0];
  return new Date(Math.max(...times));
}

/** Штампы сеанса этого запроса; `null` — сеанса нет. */
export async function currentSessionStamps(): Promise<SessionStamps | null> {
  const token = await currentSessionToken();
  if (!token) return null;
  const row = await prisma.session.findUnique({
    where: { sessionToken: token },
    select: { createdAt: true, reauthAt: true, mfaAt: true },
  });
  return row ?? null;
}

/** То же одной строкой: когда в этом сеансе последний раз подтверждали личность. */
export async function currentFreshLoginAt(): Promise<Date | null> {
  return freshLoginAt(await currentSessionStamps());
}

/** Отметить подтверждение личности в текущем сеансе. */
export async function stampReauth(): Promise<boolean> {
  const token = await currentSessionToken();
  if (!token) return false;
  const done = await prisma.session.updateMany({
    where: { sessionToken: token },
    data: { reauthAt: new Date() },
  });
  return done.count === 1;
}
