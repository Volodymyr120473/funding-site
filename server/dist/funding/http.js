"use strict";
// server/src/funding/http.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeFloat = safeFloat;
exports.isoFromMs = isoFromMs;
exports.httpGet = httpGet;
const axios_1 = __importDefault(require("axios"));
function safeFloat(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
}
function isoFromMs(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n))
        return "-";
    const d = new Date(n);
    if (Number.isNaN(d.getTime()))
        return "-";
    return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
async function httpGet(url, params, headers, timeoutMs = 15000) {
    const res = await axios_1.default.get(url, {
        params: params ?? {},
        headers: headers ?? {},
        timeout: timeoutMs,
    });
    return res.data;
}
//# sourceMappingURL=http.js.map