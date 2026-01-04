// server/src/funding/funding.query.ts

import { FundingFilters } from "./types";

type Exchange = "bybit" | "binance";
type Direction = "negative" | "positive";

export type ParsedFundingQuery = {
  filters: FundingFilters;
  includeOi: boolean;
};

function toLowerStr(x: unknown): string {
  return String(x ?? "").trim().toLowerCase();
}

function parseNumber(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseBool(x: unknown): boolean | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function envNum(key: string, fallback: number): number {
  const v = Number(process.env[key] ?? "");
  return Number.isFinite(v) ? v : fallback;
}

export function parseFundingQuery(q: any): ParsedFundingQuery {
  const exchangeRaw = toLowerStr(q?.exchange);
  const directionRaw = toLowerStr(q?.direction);

  const exchange: Exchange = (exchangeRaw === "binance" || exchangeRaw === "bybit")
    ? (exchangeRaw as Exchange)
    : "bybit";

  const direction: Direction = (directionRaw === "positive" || directionRaw === "negative")
    ? (directionRaw as Direction)
    : "negative";

  // дефолт fundingCut залежить від direction
  const defaultFundingCut =
    direction === "negative"
      ? envNum("FUNDING_CUT_NEG", -0.0001)
      : envNum("FUNDING_CUT_POS", 0.00005);

  const defaultAlertFundingCut =
    direction === "negative"
      ? envNum("ALERT_FUNDING_CUT_NEG", -0.01)
      : envNum("ALERT_FUNDING_CUT_POS", 0.002);

  const filters: FundingFilters = {
    exchange,
    direction,

    fundingCut: parseNumber(q?.fundingCut) ?? defaultFundingCut,
    minMarketCapUsd: parseNumber(q?.minMarketCapUsd) ?? envNum("MIN_MARKET_CAP_USD", 100000000),
    minTurnover24hUsd: parseNumber(q?.minTurnover24hUsd) ?? envNum("MIN_TURNOVER_24H_USD", 2000000),
    limit: clamp(parseNumber(q?.limit) ?? envNum("LIMIT", 30), 1, 100),

    alertFundingCut: parseNumber(q?.alertFundingCut) ?? defaultAlertFundingCut,
    alertTurnover24hUsd: parseNumber(q?.alertTurnover24hUsd) ?? envNum("ALERT_TURNOVER_24H_USD", 10000000),
  };

  const includeOi = parseBool(q?.includeOi) ?? false;

  return { filters, includeOi };
}
