import { describe, expect, it } from "vitest";
import {
  coinFromRegistry,
  MAX_FACTS_AGE_MS,
  MIN_AGE_MS,
  publishBlocker,
  type PublishCandidate,
} from "../src/lib/coin-card-listing-sweep";

const NOW = new Date("2026-11-20T12:00:00Z");
const DAY_AGO = new Date(NOW.getTime() - MIN_AGE_MS - 1000);

function card(over: Partial<PublishCandidate> = {}): PublishCandidate {
  return {
    status: "PENDING",
    nativeChain: "celestia",
    stewardUserId: null,
    companyId: null,
    createdAt: DAY_AGO,
    chainFacts: { checkError: null, mismatches: [], checkedAt: NOW },
    supply: { checkError: null },
    ...over,
  };
}

describe("publishBlocker", () => {
  it("чистая карточка старше суток открывается", () => {
    expect(publishBlocker(card(), NOW)).toBeNull();
  });

  it("карточка моложе суток ждёт: одного удачного чтения мало", () => {
    const young = card({ createdAt: new Date(NOW.getTime() - 60_000) });
    expect(publishBlocker(young, NOW)).toBe("too_young");
  });

  it("расхождение с реестром держит карточку скрытой и названо в причине", () => {
    const m = card({
      chainFacts: { checkError: null, mismatches: ["CHAIN_SYMBOL", "FEE_USD"], checkedAt: NOW },
    });
    expect(publishBlocker(m, NOW)).toBe("mismatch:CHAIN_SYMBOL,FEE_USD");
  });

  it("сбой чтения сети или выпуска держит карточку скрытой", () => {
    expect(
      publishBlocker(
        card({ chainFacts: { checkError: "rpc_failed", mismatches: [], checkedAt: NOW } }),
        NOW,
      ),
    ).toBe("facts_error:rpc_failed");
    expect(publishBlocker(card({ supply: { checkError: "supply_share" } }), NOW)).toBe(
      "supply_error:supply_share",
    );
  });

  it("нечитанная сеть или нечитанный выпуск — не повод открывать", () => {
    expect(publishBlocker(card({ chainFacts: null }), NOW)).toBe("no_facts");
    expect(publishBlocker(card({ supply: null }), NOW)).toBe("no_supply");
  });

  it("устаревшее чтение означает, что сеть перестала отвечать", () => {
    const stale = card({
      chainFacts: {
        checkError: null,
        mismatches: [],
        checkedAt: new Date(NOW.getTime() - MAX_FACTS_AGE_MS - 1000),
      },
    });
    expect(publishBlocker(stale, NOW)).toBe("facts_stale");
  });

  it("карточку с куратором или компанией прогон не открывает: это чужая заявка", () => {
    expect(publishBlocker(card({ stewardUserId: "u1" }), NOW)).toBe("has_owner");
    expect(publishBlocker(card({ companyId: "c1" }), NOW)).toBe("has_owner");
  });

  it("уже открытую и карточку без сети прогон не трогает", () => {
    expect(publishBlocker(card({ status: "APPROVED" }), NOW)).toBe("not_pending");
    expect(publishBlocker(card({ nativeChain: null }), NOW)).toBe("no_chain");
  });
});

describe("coinFromRegistry", () => {
  it("тикер и название берутся из реестра сети", () => {
    expect(coinFromRegistry("polkadot")).toEqual({ symbol: "DOT", name: "Polkadot" });
    expect(coinFromRegistry("cosmoshub")).toEqual({ symbol: "ATOM", name: "Cosmos Hub" });
  });

  it("незнакомая сеть монету не создаёт", () => {
    expect(coinFromRegistry("ethereum")).toBeNull();
    expect(coinFromRegistry("cosmos")).toBeNull();
  });
});

describe("семья Bitcoin в конвейере (слайс Y)", () => {
  it("выпуск, не читаемый по свойству семьи, карточку не держит", () => {
    const btc = card({
      nativeChain: "bitcoin",
      supply: { checkError: "supply_unsupported" },
    });
    expect(publishBlocker(btc, NOW)).toBeNull();
  });

  it("сбой чтения выпуска по-прежнему держит карточку закрытой", () => {
    const broken = card({ nativeChain: "bitcoin", supply: { checkError: "rpc_unreachable" } });
    expect(publishBlocker(broken, NOW)).toBe("supply_error:rpc_unreachable");
  });

  it("строки выпуска нет вовсе — это «ещё не читали», а не свойство семьи", () => {
    expect(publishBlocker(card({ nativeChain: "bitcoin", supply: null }), NOW)).toBe("no_supply");
  });

  it("монета заводится из третьего реестра", () => {
    expect(coinFromRegistry("dogecoin")).toEqual({ symbol: "DOGE", name: "Dogecoin" });
    expect(coinFromRegistry("bitcoin")).toEqual({ symbol: "BTC", name: "Bitcoin" });
  });
});
