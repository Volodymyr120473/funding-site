"use strict";
// server/src/funding/funding.router.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const funding_controller_1 = require("./funding.controller");
const router = (0, express_1.Router)();
// console.log("typeof getFundingScreenerHandler =", typeof getFundingScreenerHandler);
// ✅ ВАЖЛИВО: без дужок! (не викликати функцію)
router.get("/screener", funding_controller_1.getFundingScreenerHandler);
// optional legacy
router.get("/negative", funding_controller_1.getNegativeFundingHandler);
exports.default = router;
//# sourceMappingURL=funding.router.js.map