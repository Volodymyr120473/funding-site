"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bybitGetOpenInterestLatest = bybitGetOpenInterestLatest;
const http_1 = require("./http");
const BYBIT_REST = process.env.BYBIT_REST || "https://api.bybit.com";
const REQ_TIMEOUT = Number(process.env.HTTP_TIMEOUT ?? "15") * 1000;
const USER_AGENT = process.env.USER_AGENT || "neg-funding-tracker-ts/1.0";
async function bybitGetOpenInterestLatest(symbol) {
    // /v5/market/open-interest вимагає intervalTime, візьмемо 1h і limit=1
    const data = await (0, http_1.httpGet)(`${BYBIT_REST}/v5/market/open-interest`, {
        category: "linear",
        symbol,
        intervalTime: "1h",
        limit: 1,
    }, { "User-Agent": USER_AGENT }, REQ_TIMEOUT);
    const item = data?.result?.list?.[0];
    return (0, http_1.safeFloat)(item?.openInterest);
}
//# sourceMappingURL=bybit.adapter.js.map