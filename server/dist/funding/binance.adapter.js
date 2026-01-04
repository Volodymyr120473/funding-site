"use strict";
// server/src/funding/binance.adapter.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.binanceGetUsdtPerpUniverse = binanceGetUsdtPerpUniverse;
exports.binanceGetPremiumIndexMap = binanceGetPremiumIndexMap;
exports.binanceGetTicker24hMap = binanceGetTicker24hMap;
exports.binanceGetOpenInterest = binanceGetOpenInterest;
exports.binanceParseFundingFields = binanceParseFundingFields;
exports.binanceParseTurnoverUsd = binanceParseTurnoverUsd;
const http_1 = require("./http");
const BINANCE_FAPI = process.env.BINANCE_FAPI || "https://fapi.binance.com";
const REQ_TIMEOUT = Number(process.env.HTTP_TIMEOUT ?? "15") * 1000;
const USER_AGENT = process.env.USER_AGENT || "neg-funding-tracker-ts/1.0";
async function binanceGetUsdtPerpUniverse() {
    const data = await (0, http_1.httpGet)(`${BINANCE_FAPI}/fapi/v1/exchangeInfo`, {}, { "User-Agent": USER_AGENT }, REQ_TIMEOUT);
    const allowed = new Set();
    const symbolToBase = new Map();
    const symbols = data?.symbols ?? [];
    for (const s of symbols) {
        const sym = String(s?.symbol ?? "").trim();
        const base = String(s?.baseAsset ?? "").trim();
        const quote = String(s?.quoteAsset ?? "").trim().toUpperCase();
        const ctype = String(s?.contractType ?? "").trim().toUpperCase();
        const status = String(s?.status ?? "").trim().toUpperCase();
        if (!sym || !base)
            continue;
        if (quote !== "USDT")
            continue;
        if (ctype !== "PERPETUAL")
            continue;
        if (status !== "TRADING")
            continue;
        allowed.add(sym);
        symbolToBase.set(sym, base);
    }
    return { allowed, symbolToBase };
}
async function binanceGetPremiumIndexMap() {
    // /fapi/v1/premiumIndex повертає list
    const data = await (0, http_1.httpGet)(`${BINANCE_FAPI}/fapi/v1/premiumIndex`, {}, { "User-Agent": USER_AGENT }, REQ_TIMEOUT);
    const out = new Map();
    if (Array.isArray(data)) {
        for (const it of data) {
            const sym = String(it?.symbol ?? "").trim();
            if (sym)
                out.set(sym, it);
        }
    }
    return out;
}
async function binanceGetTicker24hMap() {
    const data = await (0, http_1.httpGet)(`${BINANCE_FAPI}/fapi/v1/ticker/24hr`, {}, { "User-Agent": USER_AGENT }, REQ_TIMEOUT);
    const out = new Map();
    if (Array.isArray(data)) {
        for (const it of data) {
            const sym = String(it?.symbol ?? "").trim();
            if (sym)
                out.set(sym, it);
        }
    }
    return out;
}
async function binanceGetOpenInterest(symbol) {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const data = await (0, http_1.httpGet)(`${BINANCE_FAPI}/fapi/v1/openInterest`, { symbol }, { "User-Agent": USER_AGENT }, REQ_TIMEOUT);
            return (0, http_1.safeFloat)(data?.openInterest);
        }
        catch (e) {
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
function binanceParseFundingFields(p) {
    const fr = (0, http_1.safeFloat)(p?.lastFundingRate);
    const nextFundingIso = (0, http_1.isoFromMs)(p?.nextFundingTime);
    const markPrice = (0, http_1.safeFloat)(p?.markPrice);
    return { fundingRate: fr, nextFundingIso, markPrice };
}
function binanceParseTurnoverUsd(t24) {
    // На ф'ючерсах Binance quoteVolume по USDT-парам фактично в USDT (тобто USD-еквівалент)
    return (0, http_1.safeFloat)(t24?.quoteVolume);
}
//# sourceMappingURL=binance.adapter.js.map