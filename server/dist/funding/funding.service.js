"use strict";
// server/src/funding/funding.service.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFundingScreener = getFundingScreener;
const http_1 = require("./http");
const binance_adapter_1 = require("./binance.adapter");
const bybit_adapter_1 = require("./bybit.adapter");
const BYBIT_REST = process.env.BYBIT_REST || "https://api.bybit.com";
const COINGECKO_REST = process.env.COINGECKO_REST || "https://api.coingecko.com/api/v3";
const REQ_TIMEOUT = Number(process.env.HTTP_TIMEOUT ?? "15") * 1000;
const USER_AGENT = process.env.USER_AGENT || "neg-funding-tracker-ts/1.0";
function buildUsdtPerpUniverse(instruments) {
    const allowed = new Set();
    const symbolToBase = new Map();
    for (const it of instruments) {
        const sym = String(it?.symbol ?? "").trim();
        const base = String(it?.baseCoin ?? "").trim();
        const quote = String(it?.quoteCoin ?? "").trim().toUpperCase();
        const ctype = String(it?.contractType ?? "").trim();
        const status = String(it?.status ?? "").trim().toLowerCase();
        if (!sym || !base)
            continue;
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
async function bybitGetAllLinearInstruments() {
    const out = [];
    let cursor;
    while (true) {
        const params = { category: "linear", limit: 1000 };
        if (cursor)
            params.cursor = cursor;
        const data = await (0, http_1.httpGet)(`${BYBIT_REST}/v5/market/instruments-info`, params, { "User-Agent": USER_AGENT }, REQ_TIMEOUT);
        const list = data?.result?.list ?? [];
        out.push(...list);
        cursor = data?.result?.nextPageCursor || undefined;
        if (!cursor)
            break;
    }
    return out;
}
async function bybitGetAllLinearTickers() {
    const out = [];
    let cursor;
    while (true) {
        const params = { category: "linear", limit: 1000 };
        if (cursor)
            params.cursor = cursor;
        const data = await (0, http_1.httpGet)(`${BYBIT_REST}/v5/market/tickers`, params, { "User-Agent": USER_AGENT }, REQ_TIMEOUT);
        const list = data?.result?.list ?? [];
        out.push(...list);
        cursor = data?.result?.nextPageCursor || undefined;
        if (!cursor)
            break;
    }
    return out;
}
const cgCache = new Map();
function cgGet(key) {
    const e = cgCache.get(key);
    if (!e)
        return null;
    if (Date.now() > e.exp) {
        cgCache.delete(key);
        return null;
    }
    return e.value;
}
function cgSet(key, value, ttlMs) {
    cgCache.set(key, { exp: Date.now() + ttlMs, value });
}
async function coingeckoBuildSymbolIndex(pages = 3, perPage = 250) {
    const cacheKey = `cg:symbolIndex:${pages}:${perPage}`;
    const cached = cgGet(cacheKey);
    if (cached)
        return cached;
    const idx = new Map();
    for (let page = 1; page <= pages; page++) {
        const params = {
            vs_currency: "usd",
            order: "market_cap_desc",
            per_page: perPage,
            page,
            sparkline: "false",
        };
        const data = await (0, http_1.httpGet)(`${COINGECKO_REST}/coins/markets`, params, { "User-Agent": USER_AGENT }, REQ_TIMEOUT);
        if (!Array.isArray(data))
            continue;
        for (const c of data) {
            const sym = String(c?.symbol ?? "").toUpperCase().trim();
            const name = String(c?.name ?? "").trim();
            const mc = Number(c?.market_cap);
            if (!sym || !name || !Number.isFinite(mc))
                continue;
            if (!idx.has(sym))
                idx.set(sym, { name, marketCap: Math.trunc(mc) });
        }
    }
    // кеш 2 хв
    cgSet(cacheKey, idx, 120000);
    return idx;
}
// ----------------------------
// Shared helpers
// ----------------------------
function fundingPassesDirection(fr, filters) {
    if (filters.direction === "negative") {
        if (fr >= 0)
            return false;
        return fr <= filters.fundingCut;
    }
    else {
        if (fr <= 0)
            return false;
        return fr >= filters.fundingCut;
    }
}
function sortRowsByDirection(rows, filters) {
    rows.sort((a, b) => (filters.direction === "negative" ? a.funding - b.funding : b.funding - a.funding));
}
async function enrichOpenInterestBinance(rows) {
    // Тут concurrency не потрібен — adapter вже тротлить.
    for (const r of rows) {
        const oi = await (0, binance_adapter_1.binanceGetOpenInterest)(r.symbol);
        r.open_interest = oi;
        if (oi !== null && r.mark_price !== null)
            r.oi_value_usd = oi * r.mark_price;
        else
            r.oi_value_usd = null;
    }
}
async function enrichOpenInterestBybit(rows, concurrency = 4) {
    let i = 0;
    async function worker() {
        while (true) {
            const idx = i++;
            if (idx >= rows.length)
                return;
            const r = rows[idx];
            try {
                const oi = await (0, bybit_adapter_1.bybitGetOpenInterestLatest)(r.symbol);
                r.open_interest = oi;
                if (oi !== null && r.mark_price !== null)
                    r.oi_value_usd = oi * r.mark_price;
                else
                    r.oi_value_usd = null;
            }
            catch {
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
async function getFundingScreener(filters) {
    const cgIdx = await coingeckoBuildSymbolIndex(3, 250);
    const rows = [];
    // ----------------------------
    // BINANCE
    // ----------------------------
    if (filters.exchange === "binance") {
        const { allowed, symbolToBase } = await (0, binance_adapter_1.binanceGetUsdtPerpUniverse)();
        const premMap = await (0, binance_adapter_1.binanceGetPremiumIndexMap)();
        const t24Map = await (0, binance_adapter_1.binanceGetTicker24hMap)();
        for (const sym of allowed) {
            const p = premMap.get(sym);
            if (!p)
                continue;
            const { fundingRate, nextFundingIso, markPrice } = (0, binance_adapter_1.binanceParseFundingFields)(p);
            if (fundingRate === null)
                continue;
            if (!fundingPassesDirection(fundingRate, filters))
                continue;
            const turnover24h = (0, binance_adapter_1.binanceParseTurnoverUsd)(t24Map.get(sym));
            if (turnover24h === null || turnover24h < filters.minTurnover24hUsd)
                continue;
            const base = symbolToBase.get(sym) || "";
            const baseU = base ? base.toUpperCase() : "";
            const cg = baseU ? cgIdx.get(baseU) : undefined;
            const marketCap = cg?.marketCap ?? null;
            const name = cg?.name ?? "-";
            if (marketCap === null || marketCap < filters.minMarketCapUsd)
                continue;
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
        // ✅ рівно LIMIT, і тільки для них тягнемо OI
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
        if (!sym)
            continue;
        if (!allowed.has(sym))
            continue;
        const fr = (0, http_1.safeFloat)(t?.fundingRate);
        if (fr === null)
            continue;
        if (!fundingPassesDirection(fr, filters))
            continue;
        const turnover24h = (0, http_1.safeFloat)(t?.turnover24h);
        if (turnover24h === null || turnover24h < filters.minTurnover24hUsd)
            continue;
        const base = symbolToBase.get(sym) || "";
        const baseU = base ? base.toUpperCase() : "";
        const cg = baseU ? cgIdx.get(baseU) : undefined;
        const marketCap = cg?.marketCap ?? null;
        const name = cg?.name ?? "-";
        if (marketCap === null || marketCap < filters.minMarketCapUsd)
            continue;
        const markPrice = (0, http_1.safeFloat)(t?.markPrice);
        const nextFunding = (0, http_1.isoFromMs)(t?.nextFundingTime);
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
    // ✅ як і для Binance: тягнемо OI тільки для LIMIT
    const limited = rows.slice(0, Math.max(1, filters.limit));
    await enrichOpenInterestBybit(limited, 4);
    return {
        updatedAtUtc: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
        filters,
        count: limited.length,
        rows: limited,
    };
}
//# sourceMappingURL=funding.service.js.map