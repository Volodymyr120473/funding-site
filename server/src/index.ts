// server/src/index.ts

import path from "path";
import express from "express";
import cors from "cors";
import "dotenv/config";

import fundingRouter from "./funding/funding.router";

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// API
// ----------------------
app.use("/funding", fundingRouter);

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

// ----------------------
// Static client (Vite build)
// ----------------------
// В dist це буде: __dirname = .../server/dist
// а client build лежить: .../client/dist
const clientDist = path.resolve(__dirname, "../../client/dist");

// 1) віддаємо статичні файли (assets, index.html)
app.use(express.static(clientDist));

// 2) SPA fallback
// Express 5: щоб не ловити PathError на "*", робимо fallback через app.use
app.use((req, res, next) => {
  // Не чіпаємо API/health (на всяк випадок)
  if (req.path.startsWith("/funding") || req.path === "/health") return next();
  return res.sendFile(path.join(clientDist, "index.html"));
});

// ----------------------
// Listen (важливо: після роутів + static)
// ----------------------
const port = Number(process.env.PORT || 4666);
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${port}`);
});
