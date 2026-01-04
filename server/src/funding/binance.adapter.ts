// server/src/funding/binance.adapter.ts

import { httpGet, isoFromMs, safeFloat } from "./http";

const BINANCE_FAPI = process.env.BINANCE_FAPI || "https://fapi.binance.com";
const REQ_TIMEOUT = Number(process.env.HTTP_TIMEOUT ?? "15") * 1000;
const USER_AGENT = process.env.USER_AGENT || "neg-funding-tracker-ts/1.0";

type ExchangeInfoResp = {
  symbols?: Array<{
    symbol?: string;
    baseAsset?: string;
    quoteAsset?: string;
    contractType?: string;
    status?: string;
  }>;
};

type PremiumIndexItem = {
  symbol?: string;
  lastFundingRate?: string | number;
  nextFundingTime?: string | number;
  markPrice?: string | number;
};

type Ticker24hItem = {
  symbol?: string;
  quoteVolume?: string | number; // USDT обсяг за 24h
};

export async function binanceGetUsdtPerpUniverse(): Promise<{
  allowed: Set<string>;
  symbolToBase: Map<string, string>;
}> {
  const data = await httpGet<ExchangeInfoResp>(
    `${BINANCE_FAPI}/fapi/v1/exchangeInfo`,
    {},
    { "User-Agent": USER_AGENT },
    REQ_TIMEOUT
  );

  const allowed = new Set<string>();
  const symbolToBase = new Map<string, string>();

  const symbols = data?.symbols ?? [];
  for (const s of symbols) {
    const sym = String(s?.symbol ?? "").trim();
    const base = String(s?.baseAsset ?? "").trim();
    const quote = String(s?.quoteAsset ?? "").trim().toUpperCase();
    const ctype = String(s?.contractType ?? "").trim().toUpperCase();
    const status = String(s?.status ?? "").trim().toUpperCase();

    if (!sym || !base) continue;
    if (quote !== "USDT") continue;
    if (ctype !== "PERPETUAL") continue;
    if (status !== "TRADING") continue;

    allowed.add(sym);
    symbolToBase.set(sym, base);
  }

  return { allowed, symbolToBase };
}

export async function binanceGetPremiumIndexMap(): Promise<Map<string, PremiumIndexItem>> {
  // /fapi/v1/premiumIndex повертає list
  const data = await httpGet<PremiumIndexItem[]>(
    `${BINANCE_FAPI}/fapi/v1/premiumIndex`,
    {},
    { "User-Agent": USER_AGENT },
    REQ_TIMEOUT
  );

  const out = new Map<string, PremiumIndexItem>();
  if (Array.isArray(data)) {
    for (const it of data) {
      const sym = String(it?.symbol ?? "").trim();
      if (sym) out.set(sym, it);
    }
  }
  return out;
}

export async function binanceGetTicker24hMap(): Promise<Map<string, Ticker24hItem>> {
  const data = await httpGet<Ticker24hItem[]>(
    `${BINANCE_FAPI}/fapi/v1/ticker/24hr`,
    {},
    { "User-Agent": USER_AGENT },
    REQ_TIMEOUT
  );

  const out = new Map<string, Ticker24hItem>();
  if (Array.isArray(data)) {
    for (const it of data) {
      const sym = String(it?.symbol ?? "").trim();
      if (sym) out.set(sym, it);
    }
  }
  return out;
}

export async function binanceGetOpenInterest(symbol: string): Promise<number | null> {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const data = await httpGet<{ openInterest?: string | number }>(
        `${BINANCE_FAPI}/fapi/v1/openInterest`,
        { symbol },
        { "User-Agent": USER_AGENT },
        REQ_TIMEOUT
      );
      return safeFloat(data?.openInterest);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 429 && attempt < maxAttempts) {
        // backoff: 500ms, 1000ms
        const delayMs = 500 * attempt;
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return null;
    }
  }

  return null;
}


/**
 * Перетворює PremiumIndexItem у "уніфіковані" поля
 */
export function binanceParseFundingFields(p: PremiumIndexItem): {
  fundingRate: number | null;
  nextFundingIso: string;
  markPrice: number | null;
} {
  const fr = safeFloat(p?.lastFundingRate);
  const nextFundingIso = isoFromMs(p?.nextFundingTime);
  const markPrice = safeFloat(p?.markPrice);
  return { fundingRate: fr, nextFundingIso, markPrice };
}

export function binanceParseTurnoverUsd(t24: Ticker24hItem | undefined): number | null {
  // На ф'ючерсах Binance quoteVolume по USDT-парам фактично в USDT (тобто USD-еквівалент)
  return safeFloat(t24?.quoteVolume);
}
