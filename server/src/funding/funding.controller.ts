// server/src/funding/funding.controller.ts

import { Request, Response } from "express";
import { getFundingScreener } from "./funding.service";
import { ExchangeId, FundingDirection, FundingFilters } from "./types";

// -------------------------------
// Helpers
// -------------------------------
function num(q: any, def: number): number {
  const n = Number(q);
  return Number.isFinite(n) ? n : def;
}

function envNum(key: string, def: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : def;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function directionFromQuery(q: any): FundingDirection {
  const v = String(q ?? "").toLowerCase().trim();
  return v === "positive" ? "positive" : "negative";
}

function exchangeFromQuery(q: any): ExchangeId {
  const v = String(q ?? "").toLowerCase().trim();
  return v === "binance" ? "binance" : "bybit";
}

function defaultsByDirection(direction: FundingDirection): { fundingCut: number; alertFundingCut: number } {
  const fundingCut =
    direction === "positive"
      ? envNum("FUNDING_CUT_POS", 0.00005)
      : envNum("FUNDING_CUT_NEG", -0.0001);

  const alertFundingCut =
    direction === "positive"
      ? envNum("ALERT_FUNDING_CUT_POS", 0.002)
      : envNum("ALERT_FUNDING_CUT_NEG", -0.01);

  return { fundingCut, alertFundingCut };
}

// -------------------------------
// Handlers
// -------------------------------

/**
 * Универсальний скринер:
 * GET /funding/screener?exchange=bybit|binance&direction=negative|positive
 * + optional filters:
 * fundingCut, minMarketCapUsd, minTurnover24hUsd, limit,
 * alertFundingCut, alertTurnover24hUsd
 */
export async function getFundingScreenerHandler(req: Request, res: Response) {
  try {
    const exchange = exchangeFromQuery(req.query.exchange);
    const direction = directionFromQuery(req.query.direction);

    const { fundingCut: defCut, alertFundingCut: defAlertCut } = defaultsByDirection(direction);

    const defMarketCap = envNum("MIN_MARKET_CAP_USD", 100000000);
    const defTurnover = envNum("MIN_TURNOVER_24H_USD", 2000000);
    const defLimit = Math.trunc(envNum("LIMIT", 30));
    const defAlertTurnover = envNum("ALERT_TURNOVER_24H_USD", 10000000);

    const filters: FundingFilters = {
      exchange,
      direction,

      // fundingCut залишаємо як є (може бути і від’ємний і додатній залежно від direction)
      fundingCut: num(req.query.fundingCut, defCut),

      // ✅ мінімальні фільтри не можуть бути < 0
      minMarketCapUsd: Math.max(0, num(req.query.minMarketCapUsd, defMarketCap)),
      minTurnover24hUsd: Math.max(0, num(req.query.minTurnover24hUsd, defTurnover)),

      // ✅ захист від великих значень
      limit: clamp(Math.trunc(num(req.query.limit, defLimit)), 1, 50),

      alertFundingCut: num(req.query.alertFundingCut, defAlertCut),
      alertTurnover24hUsd: Math.max(0, num(req.query.alertTurnover24hUsd, defAlertTurnover)),
    };

    const data = await getFundingScreener(filters);
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
}

/**
 * Legacy endpoint (якщо ти хочеш залишити /funding/negative):
 * GET /funding/negative
 * Працює як direction=negative.
 */
export async function getNegativeFundingHandler(req: Request, res: Response) {
  try {
    const direction: FundingDirection = "negative";
    const exchange: ExchangeId = "bybit";

    const { fundingCut: defCut, alertFundingCut: defAlertCut } = defaultsByDirection(direction);

    const defMarketCap = envNum("MIN_MARKET_CAP_USD", 100000000);
    const defTurnover = envNum("MIN_TURNOVER_24H_USD", 2000000);
    const defLimit = Math.trunc(envNum("LIMIT", 30));
    const defAlertTurnover = envNum("ALERT_TURNOVER_24H_USD", 10000000);

    const filters: FundingFilters = {
      exchange,
      direction,

      fundingCut: num(req.query.fundingCut, defCut),
      minMarketCapUsd: Math.max(0, num(req.query.minMarketCapUsd, defMarketCap)),
      minTurnover24hUsd: Math.max(0, num(req.query.minTurnover24hUsd, defTurnover)),
      limit: clamp(Math.trunc(num(req.query.limit, defLimit)), 1, 50),

      alertFundingCut: num(req.query.alertFundingCut, defAlertCut),
      alertTurnover24hUsd: Math.max(0, num(req.query.alertTurnover24hUsd, defAlertTurnover)),
    };

    const data = await getFundingScreener(filters);
    res.json(data);
  } catch (e: any) {
    console.error("[funding/screener] error:", e?.response?.status, e?.response?.data ?? e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }

}
