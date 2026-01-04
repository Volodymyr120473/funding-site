// server/src/funding/funding.router.ts

import { Router } from "express";
import { getFundingScreenerHandler, getNegativeFundingHandler } from "./funding.controller";

const router = Router();

// console.log("typeof getFundingScreenerHandler =", typeof getFundingScreenerHandler);

// ✅ ВАЖЛИВО: без дужок! (не викликати функцію)
router.get("/screener", getFundingScreenerHandler);

// optional legacy
router.get("/negative", getNegativeFundingHandler);

export default router;
