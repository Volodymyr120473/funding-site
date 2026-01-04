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

// CoinGecko: щоб менше 429 на Render
const CG_TTL_MS = Number(process.env.CG_TTL_MS ?? "600000"); // 10 хв
const CG_PAGES = Number(process.env.CG_PAGES ?? "3"); // 3 сторінки * 250 = топ 750
const CG_PER_PAGE = Number(process.env.CG_PER_PAGE ?? "250");
const CG_RETRIES = Number(process.env.CG_RETRIES ?? "3");
const CG_BACKOFF_MS = Number(process.env.CG_BACKOFF_MS ?? "1200");

// Якщо CG недоступний: дозволити показувати монети без market cap (інакше буде майже пусто)
const ALLOW_NO_MARKETCAP = String(process.env.ALLOW_NO_MARKETCAP ?? "1").toLowerCase() === "1";

// Опційно: якщо у тебе є ключ CG Pro, можна підставити (зменшить ліміти)
// CoinGecko Pro підтримує x-cg-pro-api-key. :contentReference[oaicite:0]{index=0}
const COINGECKO_PRO_API_KEY = process.env.COINGECKO_PRO_API_KEY || "";

// ----------------------------
// helpers
// ----------------------------
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isHttpStatus(err: any, code: number): boolean {
  const s = err?.response?.status;
  return s === code;
}

function errStatus(err: any): number | null {
  const s = err?.response?.status;
  return Number.isFinite(s) ? s : null;
}

function coingeckoHeaders(): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": USER_AGENT };
  if (COINGECKO_PRO_API_KEY) h["x-cg-pro-api-key"] = COINGECKO_PRO_API_KEY; // :contentReference[oaicite:1]{index=1}
  return h;
}

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
// CoinGecko cache
// ----------------------------
type CacheEntry<T> = { exp: number; value: T };
const cgCache = new Map<string, CacheEntry<any>>();

function cgGet<T>(key: string): T | null {
  const e = cgCache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) {
    cgCache.delete(key);
    return null;
  }
  return e.value as T;
}
function cgSet<T>(key: string, value: T, ttlMs: number) {
  cgCache.set(key, { exp: Date.now() + ttlMs, value });
}

async function coingeckoBuildSymbolIndex(pages = CG_PAGES, perPage = CG_PER_PAGE) {
  const cacheKey = `cg:symbolIndex:${pages}:${perPage}`;
  const cached = cgGet<Map<string, { name: string; marketCap: number }>>(cacheKey);
  if (cached) return cached;

  const idx = new Map<string, { name: string; marketCap: number }>();

  for (let page = 1; page <= pages; page++) {
    const params = {
      vs_currency: "usd",
      order: "market_cap_desc",
      per_page: perPage,
      page,
      sparkline: "false",
    };

    // retry/backoff на 429
    let ok = false;
    let lastErr: any = null;

    for (let attempt = 0; attempt <= CG_RETRIES; attempt++) {
      try {
        const data = await httpGet<any[]>(
          `${COINGECKO_REST}/coins/markets`,
          params,
          coingeckoHeaders(),
          REQ_TIMEOUT
        );

        if (Array.isArray(data)) {
          for (const c of data) {
            const sym = String(c?.symbol ?? "").toUpperCase().trim();
            const name = String(c?.name ?? "").trim();
            const mc = Number(c?.market_cap);

            if (!sym || !name || !Number.isFinite(mc)) continue;
            if (!idx.has(sym)) idx.set(sym, { name, marketCap: Math.trunc(mc) });
          }
        }

        ok = true;
        break;
      } catch (e: any) {
        lastErr = e;

        // 429 -> backoff і повтор
        if (isHttpStatus(e, 429) && attempt < CG_RETRIES) {
          await sleep(CG_BACKOFF_MS * (attempt + 1));
          continue;
        }

        // 403/інші -> виходимо
        break;
      }
    }

    if (!ok) {
      // Якщо CG впав на якійсь сторінці — просто зупиняємось (не валимо весь сервіс)
      // (індекс буде неповний, але краще ніж 500)
      // можна залогувати статус:
      // console.warn("CoinGecko failed page", page, "status", errStatus(lastErr));
      break;
    }
  }

  cgSet(cacheKey, idx, CG_TTL_MS);
  return idx;
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
  const rows: FundingRow[] = [];

  // 1) CoinGecko index (може впасти/бути неповним — це ок)
  const cgIdx = await coingeckoBuildSymbolIndex(CG_PAGES, CG_PER_PAGE);

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

      // якщо marketcap нема і ALLOW_NO_MARKETCAP=false -> відсікаємо
      if (marketCap === null) {
        if (!ALLOW_NO_MARKETCAP) continue;
      } else if (marketCap < filters.minMarketCapUsd) {
        continue;
      }

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
  // ВАЖЛИВО: якщо Render-регіон блочиться Bybit (403 CloudFront),
  // цей блок може падати. Тому обгортаємо в try/catch і повертаємо
  // нормальну відповідь (можливо порожню), а не 500.
  try {
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

      if (marketCap === null) {
        if (!ALLOW_NO_MARKETCAP) continue;
      } else if (marketCap < filters.minMarketCapUsd) {
        continue;
      }

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
  } catch (e: any) {
    const status = errStatus(e);
    // якщо Bybit/CloudFront блочить — повернемо порожню, але "живу" відповідь
    return {
      updatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      filters,
      count: 0,
      rows: [],
    };
  }
}
