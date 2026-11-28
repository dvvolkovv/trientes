import { describe, expect, it } from "vitest";
import {
  addressKey,
  bech32Decode,
  base58CheckDecode,
  checkAddress,
  checkTxHash,
  familyForCoin,
  isEvmAddress,
} from "@/lib/crypto-ledger/address";
import { validateCryptoAddress, validateCryptoOp, cryptoRightsFor, DAILY_CRYPTO_OPS } from "@/lib/crypto-ledger/rules";
import { aggregateLedger, type LedgerOp, type LedgerReceipt } from "@/lib/crypto-ledger/aggregate";
import { compareRate, nearestPrice, RATE_TOLERANCE_PCT } from "@/lib/crypto-ledger/rate-check";
import { parseSdnXml } from "@/lib/sanctions/ofac";
import { cryptoOpsCsv, cryptoReceiptsCsv, cryptoFileName } from "@/lib/crypto-ledger/csv";

/**
 * Слайс CR — криптоучёт (ТЗ 6.8). Спека
 * `docs/superpowers/specs/2026-11-28-merchant-crypto-accounting-design.md`.
 *
 * Адреса в проверках настоящие и проверены живым разбором 28 ноября 2026.
 */

const BTC_LEGACY = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
const BTC_SEGWIT = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const BTC_TAPROOT = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";
const EVM_CHECKSUM = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";
const DOT_ADDRESS = "13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB";
const ALICE_42 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const COSMOS_ADDRESS = "cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu";

describe("адреса книги", () => {
  it("семья берётся из наших реестров, а токен её не называет", () => {
    expect(familyForCoin("BTC")?.family).toBe("BITCOIN");
    expect(familyForCoin("DOT")?.family).toBe("SUBSTRATE");
    expect(familyForCoin("ATOM")?.family).toBe("COSMOS");
    expect(familyForCoin("ETH")?.family).toBe("EVM");
    // Токен живёт в десяти цепях: по тикеру сеть не определяется, и угадывать нельзя.
    expect(familyForCoin("USDT")).toBeNull();
  });

  it("Bitcoin: контрольная сумма сходится у legacy, segwit и taproot", () => {
    for (const a of [BTC_LEGACY, BTC_SEGWIT, BTC_TAPROOT]) {
      const r = checkAddress(a, "BTC");
      expect(r.ok, a).toBe(true);
      if (r.ok) expect(r.family).toBe("BITCOIN");
    }
  });

  it("испорченная контрольная сумма отвергается", () => {
    // Последний знак другой — ровно та опечатка, из-за которой запись книги была бы
    // бессмысленной, а сверка с санкционным списком — пустой.
    expect(checkAddress(`${BTC_LEGACY.slice(0, -1)}b`, "BTC").ok).toBe(false);
    expect(base58CheckDecode(`${BTC_LEGACY.slice(0, -1)}b`)).toBeNull();
    expect(bech32Decode(`${BTC_SEGWIT.slice(0, -1)}q`)).toBeNull();
  });

  it("EVM: контрольная сумма EIP-55 проверяется только у смешанного регистра", () => {
    expect(isEvmAddress(EVM_CHECKSUM)).toBe(true);
    expect(isEvmAddress(EVM_CHECKSUM.toLowerCase())).toBe(true);
    // Подменённый регистр одной буквы — подделка контрольной суммы.
    expect(isEvmAddress(`${EVM_CHECKSUM.slice(0, -1)}E`)).toBe(false);
  });

  it("Substrate: префикс сети обязателен", () => {
    expect(checkAddress(DOT_ADDRESS, "DOT").ok).toBe(true);
    const wrong = checkAddress(ALICE_42, "DOT");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe("address_wrong_network");
  });

  it("Cosmos: hrp сверяется с префиксом сети", () => {
    expect(checkAddress(COSMOS_ADDRESS, "ATOM").ok).toBe(true);
    const wrong = checkAddress(COSMOS_ADDRESS, "OSMO");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe("address_wrong_network");
  });

  it("незнакомая семья принимается, но формат честно не проверен", () => {
    const r = checkAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", "TRX");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.family).toBeNull();
  });

  it("ключ сверки считается по виду адреса, а не по заявленной монете", () => {
    // Токен `USDT` на цепи EVM: семья неизвестна, но ключ обязан совпасть с записью
    // санкционного списка, где адрес лежит строчными буквами.
    expect(addressKey(EVM_CHECKSUM)).toBe(EVM_CHECKSUM.toLowerCase());
    expect(addressKey(BTC_SEGWIT.toUpperCase())).toBe(BTC_SEGWIT);
    // У base58 регистр значим — его не трогаем.
    expect(addressKey(BTC_LEGACY)).toBe(BTC_LEGACY);
  });

  it("хеш транзакции пуст или похож на себя", () => {
    expect(checkTxHash("")).toEqual({ ok: true, value: "" });
    expect(checkTxHash(" 0x" + "a".repeat(64) + " ").ok).toBe(true);
    expect(checkTxHash("нет").ok).toBe(false);
    expect(checkTxHash("a".repeat(200)).ok).toBe(false);
  });
});

describe("правила ввода", () => {
  const now = new Date("2026-11-28T10:00:00Z");

  it("адрес заводится с меткой и приведённым ключом", () => {
    const r = validateCryptoAddress(
      { coin: "btc", address: ` ${BTC_SEGWIT} `, label: "Касса" },
      { addressCount: 0 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.coin).toBe("BTC");
      expect(r.value.address).toBe(BTC_SEGWIT);
      expect(r.value.addressKey).toBe(BTC_SEGWIT);
      expect(r.value.family).toBe("BITCOIN");
    }
  });

  it("потолок адресов отвергается вслух", () => {
    const r = validateCryptoAddress({ coin: "BTC", address: BTC_SEGWIT, label: "" }, { addressCount: 50 });
    expect(r).toEqual({ ok: false, reason: "too_many_addresses" });
  });

  it("операция: фиатная сумма выводится из курса, а не набирается рядом", () => {
    const r = validateCryptoOp(
      {
        kind: "CONVERSION",
        coin: "btc",
        amount: "0,5",
        rate: "90000",
        currency: "EUR",
        happenedAt: "2026-11-20",
        address: "",
        txHash: "",
        note: "",
      },
      { opsToday: 0, now },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.coin).toBe("BTC");
      expect(r.value.amount).toBe(0.5);
      expect(r.value.fiatAmount).toBe(45000);
    }
  });

  it("без курса фиатной суммы нет вовсе", () => {
    const r = validateCryptoOp(
      {
        kind: "WITHDRAWAL",
        coin: "BTC",
        amount: "0.1",
        rate: "",
        currency: "EUR",
        happenedAt: "2026-11-20",
        address: "",
        txHash: "",
        note: "",
      },
      { opsToday: 0, now },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.rate).toBeNull();
      expect(r.value.fiatAmount).toBeNull();
    }
  });

  it("дата в будущем, негодное число и чужая валюта отвергаются своими словами", () => {
    const base = {
      kind: "RECEIPT",
      coin: "BTC",
      amount: "1",
      rate: "",
      currency: "EUR",
      happenedAt: "2026-11-20",
      address: "",
      txHash: "",
      note: "",
    };
    expect(validateCryptoOp({ ...base, happenedAt: "2027-01-01" }, { opsToday: 0, now })).toEqual({
      ok: false,
      reason: "date_future",
    });
    expect(validateCryptoOp({ ...base, amount: "0" }, { opsToday: 0, now })).toEqual({
      ok: false,
      reason: "amount_invalid",
    });
    expect(validateCryptoOp({ ...base, currency: "XYZ" }, { opsToday: 0, now })).toEqual({
      ok: false,
      reason: "currency_unknown",
    });
    expect(validateCryptoOp(base, { opsToday: DAILY_CRYPTO_OPS, now })).toEqual({
      ok: false,
      reason: "daily_limit",
    });
  });

  it("право — `reports`, снятое надзором предприятие только читается", () => {
    expect(cryptoRightsFor({ suspendedAt: null, deletedAt: null, permissions: { reports: "EDIT" } })).toEqual({
      see: true,
      write: true,
    });
    expect(cryptoRightsFor({ suspendedAt: null, deletedAt: null, permissions: { reports: "VIEW" } })).toEqual({
      see: true,
      write: false,
    });
    expect(cryptoRightsFor({ suspendedAt: new Date(), deletedAt: null, permissions: { reports: "EDIT" } })).toEqual({
      see: true,
      write: false,
    });
    expect(cryptoRightsFor({ suspendedAt: null, deletedAt: null, permissions: { sales: "EDIT" } })).toEqual({
      see: false,
      write: false,
    });
  });
});

describe("свёртка книги", () => {
  const at = (day: string) => new Date(`2026-11-${day}T12:00:00Z`);

  const receipts: LedgerReceipt[] = [
    {
      saleId: "s1",
      number: 1,
      at: at("10"),
      currency: "EUR",
      total: 900,
      coin: "BTC",
      rate: 90000,
      coinAmount: 0.01,
      address: BTC_SEGWIT,
      txHash: null,
      cancelled: false,
    },
    {
      saleId: "s2",
      number: 2,
      at: at("11"),
      currency: "EUR",
      total: 1100,
      coin: "BTC",
      rate: 110000,
      coinAmount: 0.01,
      address: BTC_SEGWIT,
      txHash: null,
      cancelled: false,
    },
    // Отменённый приходом не считается, но назван своим числом.
    {
      saleId: "s3",
      number: 3,
      at: at("12"),
      currency: "EUR",
      total: 500,
      coin: "BTC",
      rate: 100000,
      coinAmount: 0.005,
      address: BTC_SEGWIT,
      txHash: null,
      cancelled: true,
    },
  ];

  it("монеты складываются, фиат идёт по валютам, средний курс взвешен", () => {
    const sum = aggregateLedger(receipts, [], { keyOf: addressKey, knownAddresses: [BTC_SEGWIT] });
    const btc = sum.coins.find((c) => c.coin === "BTC")!;
    expect(btc.receivedCoins).toBe(0.02);
    expect(btc.receiptCount).toBe(2);
    expect(btc.cancelledCount).toBe(1);
    expect(btc.balanceCoins).toBe(0.02);
    const eur = btc.byCurrency.find((l) => l.currency === "EUR")!;
    expect(eur.receivedFiat).toBe(2000);
    expect(eur.avgRate).toBe(100000);
    // Конвертаций не было — разницы нет вовсе, а не ноль.
    expect(eur.fxDiff).toBeNull();
  });

  it("курсовая разница считается от среднего курса получения", () => {
    const ops: LedgerOp[] = [
      {
        id: "o1",
        kind: "CONVERSION",
        coin: "BTC",
        amount: 0.01,
        rate: 120000,
        currency: "EUR",
        fiatAmount: 1200,
        happenedAt: at("20"),
        address: null,
        txHash: null,
        note: null,
      },
    ];
    const sum = aggregateLedger(receipts, ops, { keyOf: addressKey });
    const eur = sum.coins[0].byCurrency[0];
    // Средний курс получения 100 000, продали по 120 000 на 0,01 монеты.
    expect(eur.fxDiff).toBe(200);
    expect(eur.fxOps).toBe(1);
    expect(sum.coins[0].balanceCoins).toBe(0.01);
  });

  it("вывод без курса пустой валютной ноги не создаёт", () => {
    // Живой прогон 28 ноября: вывод между своими кошельками печатал строку
    // «Поступило, USD 0,00 $» — сообщение о том, чего не было.
    const ops: LedgerOp[] = [
      {
        id: "o3",
        kind: "WITHDRAWAL",
        coin: "BTC",
        amount: 0.01,
        rate: null,
        currency: "USD",
        fiatAmount: null,
        happenedAt: at("21"),
        address: null,
        txHash: null,
        note: null,
      },
    ];
    const sum = aggregateLedger(receipts, ops, { keyOf: addressKey });
    expect(sum.coins[0].byCurrency.map((l) => l.currency)).toEqual(["EUR"]);
    expect(sum.coins[0].withdrawnCoins).toBe(0.01);
  });

  it("остаток в минусе назван минусом, а не спрятан", () => {
    const ops: LedgerOp[] = [
      {
        id: "o2",
        kind: "WITHDRAWAL",
        coin: "BTC",
        amount: 0.5,
        rate: null,
        currency: "EUR",
        fiatAmount: null,
        happenedAt: at("21"),
        address: null,
        txHash: null,
        note: null,
      },
    ];
    const sum = aggregateLedger(receipts, ops, { keyOf: addressKey });
    expect(sum.coins[0].balanceCoins).toBeLessThan(0);
    expect(sum.coins[0].negative).toBe(true);
  });

  it("суммы по адресам считаются, незаведённый адрес отмечен, санкционный помечен", () => {
    const sum = aggregateLedger(receipts, [], {
      keyOf: addressKey,
      knownAddresses: [],
      sanctionedKeys: new Set([addressKey(BTC_SEGWIT)]),
    });
    expect(sum.addresses).toHaveLength(1);
    expect(sum.addresses[0].receivedCoins).toBe(0.02);
    expect(sum.addresses[0].entries).toBe(2);
    expect(sum.addresses[0].known).toBe(false);
    expect(sum.addresses[0].sanctioned).toBe(true);
  });
});

describe("сверка курса", () => {
  it("в пределах допуска — согласие, за ним — расхождение", () => {
    const ok = compareRate({ rate: 90000, usdPerUnit: 1.08, ourUsd: 95000 });
    expect(ok.state).toBe("ok");
    const off = compareRate({ rate: 9000, usdPerUnit: 1.08, ourUsd: 95000 });
    expect(off.state).toBe("off");
    if (off.state === "off") expect(Math.abs(off.deltaPct)).toBeGreaterThan(RATE_TOLERANCE_PCT);
  });

  it("нет курса, нет цены, нет фиата — «не сверено», а не «расходится»", () => {
    expect(compareRate({ rate: null, usdPerUnit: 1, ourUsd: 1 })).toEqual({
      state: "unchecked",
      reason: "no_rate",
    });
    expect(compareRate({ rate: 1, usdPerUnit: null, ourUsd: 1 })).toEqual({
      state: "unchecked",
      reason: "no_fx",
    });
    expect(compareRate({ rate: 1, usdPerUnit: 1, ourUsd: null, priceReason: "ticker_ambiguous" })).toEqual({
      state: "unchecked",
      reason: "ticker_ambiguous",
    });
  });

  it("цена вне окна опорой не считается", () => {
    const now = new Date("2026-11-28T12:00:00Z");
    const near = [{ at: new Date("2026-11-28T09:00:00Z"), usd: 100 }];
    const far = [{ at: new Date("2026-11-27T12:00:00Z"), usd: 100 }];
    expect(nearestPrice(near, now)).toBe(100);
    expect(nearestPrice(far, now)).toBeNull();
  });
});

describe("санкционный список", () => {
  const xml = `<?xml version="1.0"?>
<sdnList>
  <publshInformation><Publish_Date>11/23/2026</Publish_Date></publshInformation>
  <sdnEntry>
    <uid>1</uid>
    <lastName>SOME BANK</lastName>
    <programList><program>IRAN</program><program>SDGT</program></programList>
    <idList>
      <id><uid>9</uid><idType>Digital Currency Address - XBT</idType><idNumber>${BTC_LEGACY}</idNumber></id>
      <id><uid>10</uid><idType>Passport</idType><idNumber>X12345</idNumber></id>
    </idList>
  </sdnEntry>
  <sdnEntry>
    <uid>2</uid>
    <firstName>IVAN</firstName><lastName>IVANOV</lastName>
    <programList><program>CYBER2</program></programList>
    <idList>
      <id><uid>11</uid><idType>Digital Currency Address - ETH</idType><idNumber>${EVM_CHECKSUM}</idNumber></id>
      <id><uid>12</uid><idType>Digital Currency Address - XBT</idType><idNumber>${BTC_LEGACY}</idNumber></id>
    </idList>
  </sdnEntry>
  <sdnEntry><uid>3</uid><lastName>NO ADDRESSES</lastName></sdnEntry>
</sdnList>`;

  it("берутся только криптоадреса, с именем и программами", () => {
    const parsed = parseSdnXml(xml);
    expect(parsed.publishedAt?.toISOString().slice(0, 10)).toBe("2026-11-23");
    expect(parsed.rows).toHaveLength(2);
    const btc = parsed.rows.find((r) => r.asset === "XBT")!;
    expect(btc.address).toBe(BTC_LEGACY);
    expect(btc.listedName).toBe("SOME BANK");
    expect(btc.programs).toBe("IRAN, SDGT");
    // Паспорт адресом не является и в список не попадает.
    expect(parsed.rows.some((r) => r.address === "X12345")).toBe(false);
  });

  it("ключ адреса приведён, повтор у второго лица второй строки не даёт", () => {
    const parsed = parseSdnXml(xml);
    const eth = parsed.rows.find((r) => r.asset === "ETH")!;
    expect(eth.addressKey).toBe(EVM_CHECKSUM.toLowerCase());
    expect(parsed.rows.filter((r) => r.addressKey === addressKey(BTC_LEGACY))).toHaveLength(1);
  });

  it("пустой разбор виден как пустой — вызывающий обязан не затирать список", () => {
    expect(parseSdnXml("<sdnList></sdnList>").rows).toEqual([]);
  });
});

describe("выгрузка книги", () => {
  it("столбцы по-английски, BOM на месте, отменённый чек остаётся со своим статусом", () => {
    const ops = cryptoOpsCsv([
      {
        id: "o1",
        kind: "CONVERSION",
        coin: "BTC",
        amount: 0.01,
        rate: 90000,
        currency: "EUR",
        fiatAmount: 900,
        happenedAt: new Date("2026-11-20T12:00:00Z"),
        address: null,
        txHash: null,
        note: 'с запятой, и "кавычкой"',
      },
    ]);
    expect(ops.startsWith("﻿")).toBe(true);
    expect(ops).toContain("kind,happened_at,coin,amount,rate,currency,fiat_amount,address,tx_hash,note");
    expect(ops).toContain('"с запятой, и ""кавычкой"""');

    const receipts = cryptoReceiptsCsv([
      {
        saleId: "s1",
        number: 7,
        at: new Date("2026-11-20T12:00:00Z"),
        currency: "EUR",
        total: 100,
        coin: "BTC",
        rate: null,
        coinAmount: null,
        address: null,
        txHash: null,
        cancelled: true,
      },
    ]);
    expect(receipts).toContain("CANCELLED");

    // Кириллица в имени предприятия в имя файла не попадает (то же правило, что в CL):
    // имя несёт человек по чужим системам, и латиница с дефисами переживает их все.
    expect(cryptoFileName("Крам & Co", "operations", "2026-11-01", "2026-11-28")).toBe(
      "trientes-co-crypto-operations-2026-11-01-2026-11-28.csv",
    );
    expect(cryptoFileName("", "receipts", "2026-11-01", "2026-11-28")).toBe(
      "trientes-company-crypto-receipts-2026-11-01-2026-11-28.csv",
    );
  });
});
