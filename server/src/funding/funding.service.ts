// server/src/funding/funding.service.ts

import { httpGet, isoFromMs, safeFloat } from "./http";
import { FundingFilters, FundingResponse, FundingRow } from "./types";
import {
  binanceGetOpenInterest,
  binanceGetPremiumIndexMap,
  binanceGetTicker24hMap,
  binanceGetUsdtPerpUniverse,
  binanceParseFundingFields,
  binanceParseTurnoverUsd,
} from "./binance.adapter";
import { bybitGetOpenInterestLatest } from "./bybit.adapter";

const BYBIT_REST = process.env.BYBIT_REST || "https://api.bybit.com";
const COINGECKO_REST = process.env.COINGECKO_REST || "https://api.coingecko.com/api/v3";

const REQ_TIMEOUT = Number(process.env.HTTP_TIMEOUT ?? "15") * 1000;
const USER_AGENT = process.env.USER_AGENT || "neg-funding-tracker-ts/1.0";

// ----------------------------
// Bybit
// ----------------------------
type BybitInstrumentsResp = { result?: { list?: any[]; nextPageCursor?: string } };
type BybitTickersResp = { result?: { list?: any[]; nextPageCursor?: string } };

function buildUsdtPerpUniverse(instruments: any[]) {
  const allowed = new Set<string>();
  const symbolToBase = new Map<string, string>();

  for (const it of instruments) {
    const sym = String(it?.symbol ?? "").trim();
    const base = String(it?.baseCoin ?? "").trim();
    const quote = String(it?.quoteCoin ?? "").trim().toUpperCase();
    const ctype = String(it?.contractType ?? "").trim();
    const status = String(it?.status ?? "").trim().toLowerCase();

    if (!sym || !base) continue;

    const isUsdt = quote === "USDT" || sym.endsWith("USDT");
    const isPerp = ctype === "LinearPerpetual" || ctype.toLowerCase().includes("perpetual");
    const isTrading = status === "" || status === "trading";

    if (isUsdt && isPerp && isTrading) {
      allowed.add(sym);
      symbolToBase.set(sym, base);
    }
  }

  return { allowed, symbolToBase };
}

async function bybitGetAllLinearInstruments(): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;

  while (true) {
    const params: any = { category: "linear", limit: 1000 };
    if (cursor) params.cursor = cursor;

    const data = await httpGet<BybitInstrumentsResp>(
      `${BYBIT_REST}/v5/market/instruments-info`,
      params,
      { "User-Agent": USER_AGENT },
      REQ_TIMEOUT
    );

    const list = data?.result?.list ?? [];
    out.push(...list);

    cursor = data?.result?.nextPageCursor || undefined;
    if (!cursor) break;
  }

  return out;
}

async function bybitGetAllLinearTickers(): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;

  while (true) {
    const params: any = { category: "linear", limit: 1000 };
    if (cursor) params.cursor = cursor;

    const data = await httpGet<BybitTickersResp>(
      `${BYBIT_REST}/v5/market/tickers`,
      params,
      { "User-Agent": USER_AGENT },
      REQ_TIMEOUT
    );

    const list = data?.result?.list ?? [];
    out.push(...list);

    cursor = data?.result?.nextPageCursor || undefined;
    if (!cursor) break;
  }

  return out;
}

// ----------------------------
// CoinGecko cache with "stale fallback"
// ----------------------------
type CacheEntry<T> = { exp: number; value: T };
const cgCache = new Map<string, CacheEntry<any>>();

function cgGetFresh<T>(key: string): T | null {
  const e = cgCache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) return null;
  return e.value as T;
}

function cgGetAny<T>(key: string): T | null {
  const e = cgCache.get(key);
  return e ? (e.value as T) : null;
}

function cgSet<T>(key: string, value: T, ttlMs: number) {
  cgCache.set(key, { exp: Date.now() + ttlMs, value });
}

async function coingeckoBuildSymbolIndex(pages = 1, perPage = 250) {
  const cacheKey = `cg:symbolIndex:${pages}:${perPage}`;

  // 1) fresh cache first
  const fresh = cgGetFresh<Map<string, { name: string; marketCap: number }>>(cacheKey);
  if (fresh) return fresh;

  const idx = new Map<string, { name: string; marketCap: number }>();

  try {
    for (let page = 1; page <= pages; page++) {
      const params = {
        vs_currency: "usd",
        order: "market_cap_desc",
        per_page: perPage,
        page,
        sparkline: "false",
      };

      const data = await httpGet<any[]>(
        `${COINGECKO_REST}/coins/markets`,
        params,
        { "User-Agent": USER_AGENT },
        REQ_TIMEOUT
      );

      if (!Array.isArray(data)) continue;

      for (const c of data) {
        const sym = String(c?.symbol ?? "").toUpperCase().trim();
        const name = String(c?.name ?? "").trim();
        const mc = Number(c?.market_cap);

        if (!sym || !name || !Number.isFinite(mc)) continue;
        if (!idx.has(sym)) idx.set(sym, { name, marketCap: Math.trunc(mc) });
      }
    }

    // TTL 30 min
    cgSet(cacheKey, idx, 30 * 60_000);
    return idx;
  } catch (e: any) {
    // 2) If CG rate-limited / unavailable - return any cached value (even stale)
    const any = cgGetAny<Map<string, { name: string; marketCap: number }>>(cacheKey);
    if (any) return any;

    // 3) No cache yet -> empty map (do not crash the whole endpoint)
    return new Map<string, { name: string; marketCap: number }>();
  }
}

// ----------------------------
// Shared helpers
// ----------------------------
function fundingPassesDirection(fr: number, filters: FundingFilters): boolean {
  if (filters.direction === "negative") {
    if (fr >= 0) return false;
    return fr <= filters.fundingCut;
  } else {
    if (fr <= 0) return false;
    return fr >= filters.fundingCut;
  }
}

function sortRowsByDirection(rows: FundingRow[], filters: FundingFilters) {
  rows.sort((a, b) => (filters.direction === "negative" ? a.funding - b.funding : b.funding - a.funding));
}

async function enrichOpenInterestBinance(rows: FundingRow[]): Promise<void> {
  for (const r of rows) {
    const oi = await binanceGetOpenInterest(r.symbol);
    r.open_interest = oi;

    if (oi !== null && r.mark_price !== null) r.oi_value_usd = oi * r.mark_price;
    else r.oi_value_usd = null;
  }
}

async function enrichOpenInterestBybit(rows: FundingRow[], concurrency = 4): Promise<void> {
  let i = 0;

  async function worker() {
    while (true) {
      const idx = i++;
      if (idx >= rows.length) return;

      const r = rows[idx];

      try {
        const oi = await bybitGetOpenInterestLatest(r.symbol);
        r.open_interest = oi;

        if (oi !== null && r.mark_price !== null) r.oi_value_usd = oi * r.mark_price;
        else r.oi_value_usd = null;
      } catch {
        r.open_interest = null;
        r.oi_value_usd = null;
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);
}

// ----------------------------
// Main screener
// ----------------------------
export async function getFundingScreener(filters: FundingFilters): Promise<FundingResponse> {
  // pages=1 to reduce 429 risk on Render
  const cgIdx = await coingeckoBuildSymbolIndex(1, 250);
  const rows: FundingRow[] = [];

  // ----------------------------
  // BINANCE
  // ----------------------------
  if (filters.exchange === "binance") {
    const { allowed, symbolToBase } = await binanceGetUsdtPerpUniverse();
    const premMap = await binanceGetPremiumIndexMap();
    const t24Map = await binanceGetTicker24hMap();

    for (const sym of allowed) {
      const p = premMap.get(sym);
      if (!p) continue;

      const { fundingRate, nextFundingIso, markPrice } = binanceParseFundingFields(p);
      if (fundingRate === null) continue;
      if (!fundingPassesDirection(fundingRate, filters)) continue;

      const turnover24h = binanceParseTurnoverUsd(t24Map.get(sym));
      if (turnover24h === null || turnover24h < filters.minTurnover24hUsd) continue;

      const base = symbolToBase.get(sym) || "";
      const baseU = base ? base.toUpperCase() : "";

      const cg = baseU ? cgIdx.get(baseU) : undefined;
      const marketCap = cg?.marketCap ?? null;
      const name = cg?.name ?? "-";
      if (marketCap === null || marketCap < filters.minMarketCapUsd) continue;

      rows.push({
        symbol: sym,
        name,
        ticker: baseU || sym,
        funding: fundingRate,

        df_8h: null,
        df_16h: null,

        open_interest: null,
        oi_value_usd: null,
        oi_chg_8h: null,

        market_cap: marketCap,
        next_funding: nextFundingIso,
        mark_price: markPrice,
        turnover_24h: turnover24h,
        alert: "",
      });
    }

    sortRowsByDirection(rows, filters);

    const limited = rows.slice(0, Math.max(1, filters.limit));
    await enrichOpenInterestBinance(limited);

    return {
      updatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      filters,
      count: limited.length,
      rows: limited,
    };
  }

  // ----------------------------
  // BYBIT
  // ----------------------------
  const instruments = await bybitGetAllLinearInstruments();
  const { allowed, symbolToBase } = buildUsdtPerpUniverse(instruments);
  const tickers = await bybitGetAllLinearTickers();

  for (const t of tickers) {
    const sym = String(t?.symbol ?? "").trim();
    if (!sym) continue;
    if (!allowed.has(sym)) continue;

    const fr = safeFloat(t?.fundingRate);
    if (fr === null) continue;
    if (!fundingPassesDirection(fr, filters)) continue;

    const turnover24h = safeFloat(t?.turnover24h);
    if (turnover24h === null || turnover24h < filters.minTurnover24hUsd) continue;

    const base = symbolToBase.get(sym) || "";
    const baseU = base ? base.toUpperCase() : "";

    const cg = baseU ? cgIdx.get(baseU) : undefined;
    const marketCap = cg?.marketCap ?? null;
    const name = cg?.name ?? "-";
    if (marketCap === null || marketCap < filters.minMarketCapUsd) continue;

    const markPrice = safeFloat(t?.markPrice);
    const nextFunding = isoFromMs(t?.nextFundingTime);

    rows.push({
      symbol: sym,
      name,
      ticker: baseU || sym,
      funding: fr,

      df_8h: null,
      df_16h: null,

      open_interest: null,
      oi_value_usd: null,
      oi_chg_8h: null,

      market_cap: marketCap,
      next_funding: nextFunding,
      mark_price: markPrice,
      turnover_24h: turnover24h,
      alert: "",
    });
  }

  sortRowsByDirection(rows, filters);

  const limited = rows.slice(0, Math.max(1, filters.limit));
  await enrichOpenInterestBybit(limited, 4);

  return {
    updatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    filters,
    count: limited.length,
    rows: limited,
  };
}
