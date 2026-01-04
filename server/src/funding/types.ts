// server/src/funding/types.ts

export type FundingDirection = "negative" | "positive";
export type ExchangeId = "bybit" | "binance";

export type FundingFilters = {
  exchange: ExchangeId;
  direction: FundingDirection;

  fundingCut: number;
  minMarketCapUsd: number;
  minTurnover24hUsd: number;
  limit: number;

  alertFundingCut: number;
  alertTurnover24hUsd: number;
};

export type FundingRow = {
  symbol: string;
  name: string;
  ticker: string;

  funding: number;

  df_8h: number | null;
  df_16h: number | null;

  open_interest: number | null;
  oi_value_usd: number | null;
  oi_chg_8h: number | null;

  market_cap: number | null;
  next_funding: string;
  mark_price: number | null;
  turnover_24h: number | null;

  alert: string;
};

export type FundingResponse = {
  updatedAtUtc: string;
  filters: FundingFilters;
  count: number;
  rows: FundingRow[];
};
