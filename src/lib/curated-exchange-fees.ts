// Standard spot maker / taker fees for the top exchanges, curated by hand from
// each exchange's published fee schedule (URL stored alongside). VIP, BNB-discount
// and high-volume tiers reduce fees further — captured in `note`. Percent values,
// e.g. 0.10 = 0.10%.
export type ExchangeFee = {
  id: string;          // CoinGecko exchange id
  makerFeePercent: number;
  takerFeePercent: number;
  feesNote: string;
  feesUrl: string;
};

export const CURATED_EXCHANGE_FEES: ExchangeFee[] = [
  { id: "binance", makerFeePercent: 0.10, takerFeePercent: 0.10, feesNote: "Standard spot. VIP tiers and BNB discount reduce further.", feesUrl: "https://www.binance.com/en/fee/schedule" },
  { id: "gdax", makerFeePercent: 0.40, takerFeePercent: 0.60, feesNote: "Advanced Trade. Retail/Simple buy/sell uses spread+fee.", feesUrl: "https://www.coinbase.com/advanced-fees" },
  { id: "kraken", makerFeePercent: 0.25, takerFeePercent: 0.40, feesNote: "Pro spot. Lower with 30d volume tiers.", feesUrl: "https://www.kraken.com/features/fee-schedule" },
  { id: "bybit_spot", makerFeePercent: 0.10, takerFeePercent: 0.10, feesNote: "Standard spot. VIP tiers reduce further.", feesUrl: "https://www.bybit.com/en/help-center/article/Trading-Fee-Structure" },
  { id: "okex", makerFeePercent: 0.08, takerFeePercent: 0.10, feesNote: "Lv1 retail spot. Drops with VIP/asset tiers.", feesUrl: "https://www.okx.com/fees" },
  { id: "kucoin", makerFeePercent: 0.10, takerFeePercent: 0.10, feesNote: "Class A spot. KCS discount −20%.", feesUrl: "https://www.kucoin.com/vip/level" },
  { id: "gate", makerFeePercent: 0.20, takerFeePercent: 0.20, feesNote: "VIP0 spot. GT discount reduces further.", feesUrl: "https://www.gate.io/fee" },
  { id: "mxc", makerFeePercent: 0.00, takerFeePercent: 0.05, feesNote: "Spot promo: 0/0.05% for most pairs. Subject to change.", feesUrl: "https://www.mexc.com/fee" },
  { id: "huobi", makerFeePercent: 0.20, takerFeePercent: 0.20, feesNote: "Standard professional spot. HT discount available.", feesUrl: "https://www.htx.com/en-us/support/fee-introduction" },
  { id: "bitstamp", makerFeePercent: 0.30, takerFeePercent: 0.40, feesNote: "30-day volume tiers reduce fees down to 0%.", feesUrl: "https://www.bitstamp.net/fee-schedule/" },
  { id: "gemini", makerFeePercent: 0.20, takerFeePercent: 0.40, feesNote: "ActiveTrader fees. Web/mobile is 1.49% + spread.", feesUrl: "https://www.gemini.com/fees/active-trader-fee-schedule" },
  { id: "crypto_com", makerFeePercent: 0.075, takerFeePercent: 0.075, feesNote: "Level 1 with CRO stake. Up to 0.40/0.40 without CRO.", feesUrl: "https://crypto.com/exchange/document/fees-limits" },
  { id: "bitget", makerFeePercent: 0.10, takerFeePercent: 0.10, feesNote: "Lv1 spot. BGB discount available.", feesUrl: "https://www.bitget.com/support/articles/12560603807106" },
  { id: "bingx", makerFeePercent: 0.10, takerFeePercent: 0.10, feesNote: "Standard spot. VIP tiers and BGB discounts reduce further.", feesUrl: "https://bingx.com/en/support/articles/360033981853" },
  { id: "bitfinex", makerFeePercent: 0.10, takerFeePercent: 0.20, feesNote: "Standard spot. 30d-volume tiers reduce further.", feesUrl: "https://www.bitfinex.com/fees" },
  { id: "coinex", makerFeePercent: 0.20, takerFeePercent: 0.20, feesNote: "VIP0 spot. CET discount reduces further.", feesUrl: "https://www.coinex.com/fees" },
  { id: "upbit", makerFeePercent: 0.05, takerFeePercent: 0.05, feesNote: "KRW market base fee.", feesUrl: "https://upbit.com/service_center/guide" },
  { id: "bithumb", makerFeePercent: 0.04, takerFeePercent: 0.04, feesNote: "KRW market base fee.", feesUrl: "https://www.bithumb.com/customer_support/info_fee" },
  { id: "digifinex", makerFeePercent: 0.20, takerFeePercent: 0.20, feesNote: "Standard spot.", feesUrl: "https://www.digifinex.com/en-ww/fee" },
  { id: "bingo", makerFeePercent: 0.10, takerFeePercent: 0.10, feesNote: "Standard spot.", feesUrl: "https://bingx.com/en/support/articles/360033981853" },
];
