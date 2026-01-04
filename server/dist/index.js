"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
require("dotenv/config");
const funding_router_1 = __importDefault(require("./funding/funding.router"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use("/funding", funding_router_1.default);
app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});
const PORT = Number(process.env.PORT || 4666);
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
// 1) статичні файли Vite build
const clientDist = path_1.default.resolve(__dirname, "../../client/dist");
app.use(express_1.default.static(clientDist));
// 2) SPA fallback (щоб /funding, /anything працювало)
app.get(/.*/, (req, res) => {
    res.sendFile(path_1.default.join(clientDist, "index.html"));
});
//# sourceMappingURL=index.js.map