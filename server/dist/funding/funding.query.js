"use strict";
// server/src/funding/funding.query.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFundingQuery = parseFundingQuery;
function toLowerStr(x) {
    return String(x ?? "").trim().toLowerCase();
}
function parseNumber(x) {
    if (x === null || x === undefined)
        return null;
    const s = String(x).trim();
    if (!s)
        return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
function parseBool(x) {
    if (x === null || x === undefined)
        return null;
    const s = String(x).trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(s))
        return true;
    if (["0", "false", "no", "n", "off"].includes(s))
        return false;
    return null;
}
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
function envNum(key, fallback) {
    const v = Number(process.env[key] ?? "");
    return Number.isFinite(v) ? v : fallback;
}
function parseFundingQuery(q) {
    const exchangeRaw = toLowerStr(q?.exchange);
    const directionRaw = toLowerStr(q?.direction);
    const exchange = (exchangeRaw === "binance" || exchangeRaw === "bybit")
        ? exchangeRaw
        : "bybit";
    const direction = (directionRaw === "positive" || directionRaw === "negative")
        ? directionRaw
        : "negative";
    // дефолт fundingCut залежить від direction
    const defaultFundingCut = direction === "negative"
        ? envNum("FUNDING_CUT_NEG", -0.0001)
        : envNum("FUNDING_CUT_POS", 0.00005);
    const defaultAlertFundingCut = direction === "negative"
        ? envNum("ALERT_FUNDING_CUT_NEG", -0.01)
        : envNum("ALERT_FUNDING_CUT_POS", 0.002);
    const filters = {
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
//# sourceMappingURL=funding.query.js.map