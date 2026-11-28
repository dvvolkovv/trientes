/**
 * Свёртка книги криптоучёта — чистая функция над чеками кассы и строками операций
 * (слайс CR, раздел 5.1 спеки).
 *
 * Почему функция, а не `groupBy` в базе: одно правило счёта служит экрану, выгрузке и
 * тесту — тот же разбор, что у сводки продаж в CL.
 *
 * Три решения, которые нельзя трогать:
 * - **монеты складываются, фиат — нет.** Монета это монета в любой валюте чека, а суммы
 *   разных валют сложить нельзя: курса между ними на момент сделки мы не наблюдали
 *   (дословно CK и CL). Поэтому остаток монеты один, а фиатная сторона — по валютам.
 * - **приход из кассы берётся из чека, а не из строки операции.** У числа один автор
 *   (правило BI): вторая запись о том же приходе разошлась бы с первой в день отмены чека.
 * - **отменённый чек приходом не считается**, но назван отдельным числом: молчание
 *   читалось бы как «столько и получено» (правило CN о чеках без привязки).
 */

export type LedgerReceipt = {
  saleId: string;
  number: number;
  at: Date;
  currency: string;
  /** Фиатный итог чека — он и есть фиатная сторона прихода. */
  total: number;
  coin: string;
  rate: number | null;
  coinAmount: number | null;
  address: string | null;
  txHash: string | null;
  cancelled: boolean;
};

export type LedgerOp = {
  id: string;
  kind: "RECEIPT" | "CONVERSION" | "WITHDRAWAL";
  coin: string;
  amount: number;
  rate: number | null;
  currency: string;
  fiatAmount: number | null;
  happenedAt: Date;
  address: string | null;
  txHash: string | null;
  note: string | null;
};

export type CurrencyLeg = {
  currency: string;
  receivedFiat: number;
  convertedFiat: number;
  withdrawnFiat: number;
  /** Средневзвешенный курс получения: Σ(фиат прихода) / Σ(монет прихода). */
  avgRate: number | null;
  /** Курсовая разница по конвертациям и выводам с известным курсом. */
  fxDiff: number | null;
  /** По скольким операциям разница посчитана: ноль означает «считать было нечем». */
  fxOps: number;
};

export type CoinLedger = {
  coin: string;
  receivedCoins: number;
  convertedCoins: number;
  withdrawnCoins: number;
  balanceCoins: number;
  /** Остаток ушёл в минус — по книге выведено больше, чем записано прихода. */
  negative: boolean;
  receiptCount: number;
  cancelledCount: number;
  opCount: number;
  byCurrency: CurrencyLeg[];
};

export type AddressTotal = {
  address: string;
  coin: string;
  receivedCoins: number;
  entries: number;
  lastAt: Date;
  /** Заведён ли адрес в книге адресов: незаведённый — повод спросить себя, чей он. */
  known: boolean;
  sanctioned: boolean;
};

export type LedgerSummary = {
  coins: CoinLedger[];
  addresses: AddressTotal[];
  /** Усечение выборки названо вслух, а не выдано за полную картину (правило BK). */
  truncated: boolean;
};

function round8(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type Leg = {
  receivedFiat: number;
  convertedFiat: number;
  withdrawnFiat: number;
  recvCoins: number;
  recvFiatWithRate: number;
  recvCoinsWithRate: number;
  fxDiff: number;
  fxOps: number;
};

function emptyLeg(): Leg {
  return {
    receivedFiat: 0,
    convertedFiat: 0,
    withdrawnFiat: 0,
    recvCoins: 0,
    recvFiatWithRate: 0,
    recvCoinsWithRate: 0,
    fxDiff: 0,
    fxOps: 0,
  };
}

export function aggregateLedger(
  receipts: readonly LedgerReceipt[],
  ops: readonly LedgerOp[],
  ctx: {
    /** Адреса из книги — ими отмечается «известный» адрес прихода. */
    knownAddresses?: readonly string[];
    /** Адреса из санкционного списка, приведённые тем же ключом. */
    sanctionedKeys?: ReadonlySet<string>;
    /** Как считается ключ адреса — передаётся, чтобы модуль остался чистым. */
    keyOf?: (address: string) => string;
    truncated?: boolean;
  } = {},
): LedgerSummary {
  const keyOf = ctx.keyOf ?? ((a: string) => a);
  const known = new Set((ctx.knownAddresses ?? []).map(keyOf));
  const sanctioned = ctx.sanctionedKeys ?? new Set<string>();

  type CoinAcc = {
    coin: string;
    receivedCoins: number;
    convertedCoins: number;
    withdrawnCoins: number;
    receiptCount: number;
    cancelledCount: number;
    opCount: number;
    legs: Map<string, Leg>;
  };
  const byCoin = new Map<string, CoinAcc>();
  const coinAcc = (coin: string): CoinAcc => {
    let acc = byCoin.get(coin);
    if (!acc) {
      acc = {
        coin,
        receivedCoins: 0,
        convertedCoins: 0,
        withdrawnCoins: 0,
        receiptCount: 0,
        cancelledCount: 0,
        opCount: 0,
        legs: new Map(),
      };
      byCoin.set(coin, acc);
    }
    return acc;
  };
  const legAcc = (acc: CoinAcc, currency: string): Leg => {
    let leg = acc.legs.get(currency);
    if (!leg) {
      leg = emptyLeg();
      acc.legs.set(currency, leg);
    }
    return leg;
  };

  const addresses = new Map<string, AddressTotal>();
  const noteAddress = (address: string | null, coin: string, coins: number, at: Date) => {
    if (!address) return;
    const key = `${coin}:${keyOf(address)}`;
    const prev = addresses.get(key);
    if (prev) {
      prev.receivedCoins = round8(prev.receivedCoins + coins);
      prev.entries += 1;
      if (at.getTime() > prev.lastAt.getTime()) prev.lastAt = at;
      return;
    }
    addresses.set(key, {
      address,
      coin,
      receivedCoins: round8(coins),
      entries: 1,
      lastAt: at,
      known: known.has(keyOf(address)),
      sanctioned: sanctioned.has(keyOf(address)),
    });
  };

  for (const r of receipts) {
    const acc = coinAcc(r.coin);
    if (r.cancelled) {
      acc.cancelledCount += 1;
      continue;
    }
    acc.receiptCount += 1;
    const leg = legAcc(acc, r.currency);
    leg.receivedFiat = round2(leg.receivedFiat + r.total);
    const coins = r.coinAmount ?? (r.rate ? r.total / r.rate : 0);
    if (coins > 0) {
      acc.receivedCoins = round8(acc.receivedCoins + coins);
      leg.recvCoins = round8(leg.recvCoins + coins);
      // В средний курс идёт только то, у чего обе стороны известны: иначе «средний
      // курс» считался бы по монетам без фиата и наоборот.
      leg.recvFiatWithRate = round2(leg.recvFiatWithRate + r.total);
      leg.recvCoinsWithRate = round8(leg.recvCoinsWithRate + coins);
    }
    noteAddress(r.address, r.coin, coins, r.at);
  }

  for (const op of ops) {
    const acc = coinAcc(op.coin);
    acc.opCount += 1;
    const leg = legAcc(acc, op.currency);
    if (op.kind === "RECEIPT") {
      acc.receivedCoins = round8(acc.receivedCoins + op.amount);
      leg.recvCoins = round8(leg.recvCoins + op.amount);
      leg.receivedFiat = round2(leg.receivedFiat + (op.fiatAmount ?? 0));
      if (op.rate !== null && op.fiatAmount !== null) {
        leg.recvFiatWithRate = round2(leg.recvFiatWithRate + op.fiatAmount);
        leg.recvCoinsWithRate = round8(leg.recvCoinsWithRate + op.amount);
      }
      noteAddress(op.address, op.coin, op.amount, op.happenedAt);
      continue;
    }
    if (op.kind === "CONVERSION") {
      acc.convertedCoins = round8(acc.convertedCoins + op.amount);
      leg.convertedFiat = round2(leg.convertedFiat + (op.fiatAmount ?? 0));
    } else {
      acc.withdrawnCoins = round8(acc.withdrawnCoins + op.amount);
      leg.withdrawnFiat = round2(leg.withdrawnFiat + (op.fiatAmount ?? 0));
    }
  }

  // Курсовая разница считается **после** всех приходов: средний курс должен быть
  // известен целиком, иначе первая конвертация сравнивалась бы с частью истории.
  for (const op of ops) {
    if (op.kind === "RECEIPT" || op.rate === null) continue;
    const acc = byCoin.get(op.coin);
    if (!acc) continue;
    const leg = acc.legs.get(op.currency);
    if (!leg || leg.recvCoinsWithRate <= 0) continue;
    const avg = leg.recvFiatWithRate / leg.recvCoinsWithRate;
    leg.fxDiff = round2(leg.fxDiff + (op.rate - avg) * op.amount);
    leg.fxOps += 1;
  }

  const coins: CoinLedger[] = [...byCoin.values()]
    .map((acc) => {
      const balance = round8(acc.receivedCoins - acc.convertedCoins - acc.withdrawnCoins);
      return {
        coin: acc.coin,
        receivedCoins: acc.receivedCoins,
        convertedCoins: acc.convertedCoins,
        withdrawnCoins: acc.withdrawnCoins,
        balanceCoins: balance,
        negative: balance < 0,
        receiptCount: acc.receiptCount,
        cancelledCount: acc.cancelledCount,
        opCount: acc.opCount,
        byCurrency: [...acc.legs.entries()]
          // Нога без единого фиатного числа и без курса — выдумка: операция без курса
          // фиатной стороны не имеет вовсе, и строка «Поступило, USD 0,00 $» у вывода
          // между своими кошельками сообщала бы о том, чего не было (поймано живым
          // прогоном 28 ноября).
          .filter(
            ([, leg]) =>
              leg.receivedFiat !== 0 ||
              leg.convertedFiat !== 0 ||
              leg.withdrawnFiat !== 0 ||
              leg.recvCoinsWithRate > 0 ||
              leg.fxOps > 0,
          )
          .map(([currency, leg]) => ({
            currency,
            receivedFiat: leg.receivedFiat,
            convertedFiat: leg.convertedFiat,
            withdrawnFiat: leg.withdrawnFiat,
            avgRate:
              leg.recvCoinsWithRate > 0
                ? Math.round((leg.recvFiatWithRate / leg.recvCoinsWithRate) * 1e8) / 1e8
                : null,
            fxDiff: leg.fxOps > 0 ? leg.fxDiff : null,
            fxOps: leg.fxOps,
          }))
          .sort((a, b) => b.receivedFiat - a.receivedFiat || a.currency.localeCompare(b.currency)),
      };
    })
    .sort((a, b) => b.receivedCoins - a.receivedCoins || a.coin.localeCompare(b.coin));

  return {
    coins,
    addresses: [...addresses.values()].sort(
      (a, b) => b.receivedCoins - a.receivedCoins || a.address.localeCompare(b.address),
    ),
    truncated: ctx.truncated ?? false,
  };
}
