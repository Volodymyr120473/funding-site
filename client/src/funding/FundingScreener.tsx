// client/src/funding/FundingScreener.tsx

import { useEffect, useMemo, useState } from "react";
import type { ExchangeId, FundingDirection, FundingResponse, FundingRow } from "./types";
import { fetchFundingScreener } from "./funding.api";
import "./FundingScreener.css";

type SortKey =
    | "symbol"
    | "name"
    | "funding"
    | "market_cap"
    | "turnover_24h"
    | "next_funding"
    | "mark_price"
    | "open_interest"
    | "oi_value_usd"
    | "alert";

type SortDir = "asc" | "desc";

type UiState = {
    exchange: ExchangeId;
    direction: FundingDirection;
    fundingCut: string;
    minTurnover24hUsd: string;
    minMarketCapUsd: string;
    limit: string;
    sortKey: SortKey;
    sortDir: SortDir;
    autoLoad: boolean;
};

const STORAGE_KEY = "fundingScreener.ui.v1";

function fmtNum(n: number | null | undefined, digits = 2): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return "-";
    return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtFunding(fr: number): string {
    const pct = fr * 100;
    return `${pct.toFixed(4)}%`;
}

function cmpMaybeNumber(a: number | null | undefined, b: number | null | undefined) {
    const aa = a ?? null;
    const bb = b ?? null;
    if (aa === null && bb === null) return 0;
    if (aa === null) return 1; // null вниз
    if (bb === null) return -1;
    return aa - bb;
}

function cmpMaybeString(a: string | null | undefined, b: string | null | undefined) {
    const aa = (a ?? "").toString();
    const bb = (b ?? "").toString();
    return aa.localeCompare(bb);
}

function getDefaultFundingCut(direction: FundingDirection) {
    // UI-дефолти. Сервер все одно має свої дефолти через .env якщо параметр не передати.
    return direction === "negative" ? "-0.0001" : "0.00005";
}

function getDefaultSort(direction: FundingDirection): { key: SortKey; dir: SortDir } {
    return direction === "negative" ? { key: "funding", dir: "asc" } : { key: "funding", dir: "desc" };
}

function safeParseStored(): Partial<UiState> | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return null;
        return obj as Partial<UiState>;
    } catch {
        return null;
    }
}

function downloadTextFile(filename: string, content: string, mime = "text/plain") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function toCsv(rows: FundingRow[]) {
    // мінімальний CSV (RFC4180-ish)
    const header = [
        "symbol",
        "name",
        "ticker",
        "funding",
        "market_cap",
        "turnover_24h",
        "next_funding",
        "mark_price",
        "open_interest",
        "oi_value_usd",
        "alert",
    ];

    const esc = (v: any) => {
        const s = v === null || v === undefined ? "" : String(v);
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };

    const lines = [header.join(",")];

    for (const r of rows) {
        lines.push(
            [
                r.symbol,
                r.name,
                r.ticker,
                r.funding,
                r.market_cap ?? "",
                r.turnover_24h ?? "",
                r.next_funding,
                r.mark_price ?? "",
                r.open_interest ?? "",
                r.oi_value_usd ?? "",
                r.alert ?? "",
            ].map(esc).join(",")
        );
    }

    return lines.join("\n");
}

export default function FundingScreener() {
    // ----------------------------
    // 1) init state from localStorage (if exists)
    // ----------------------------
    const stored = useMemo(() => (typeof window !== "undefined" ? safeParseStored() : null), []);

    const initialDirection: FundingDirection = (stored?.direction as any) === "positive" ? "positive" : "negative";
    const initialSort = getDefaultSort(initialDirection);

    const [exchange, setExchange] = useState<ExchangeId>((stored?.exchange as any) === "bybit" ? "bybit" : "binance");
    const [direction, setDirection] = useState<FundingDirection>(initialDirection);

    const [fundingCut, setFundingCut] = useState<string>(
        typeof stored?.fundingCut === "string" ? stored.fundingCut : getDefaultFundingCut(initialDirection)
    );
    const [minTurnover24hUsd, setMinTurnover24hUsd] = useState<string>(
        typeof stored?.minTurnover24hUsd === "string" ? stored.minTurnover24hUsd : "2000000"
    );
    const [minMarketCapUsd, setMinMarketCapUsd] = useState<string>(
        typeof stored?.minMarketCapUsd === "string" ? stored.minMarketCapUsd : "100000000"
    );
    const [limit, setLimit] = useState<string>(typeof stored?.limit === "string" ? stored.limit : "30");

    const [sortKey, setSortKey] = useState<SortKey>((stored?.sortKey as any) ?? initialSort.key);
    const [sortDir, setSortDir] = useState<SortDir>((stored?.sortDir as any) ?? initialSort.dir);

    const [autoLoad, setAutoLoad] = useState<boolean>(stored?.autoLoad ?? true);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string>("");
    const [data, setData] = useState<FundingResponse | null>(null);

    // ----------------------------
    // 2) persist UI state
    // ----------------------------
    useEffect(() => {
        const s: UiState = {
            exchange,
            direction,
            fundingCut,
            minTurnover24hUsd,
            minMarketCapUsd,
            limit,
            sortKey,
            sortDir,
            autoLoad,
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        } catch {
            // ignore
        }
    }, [exchange, direction, fundingCut, minTurnover24hUsd, minMarketCapUsd, limit, sortKey, sortDir, autoLoad]);

    // ----------------------------
    // 3) when direction changes: update fundingCut & default sort (optional)
    // ----------------------------
    useEffect(() => {
        // якщо юзер міняє direction — підставимо дефолт fundingCut лише якщо він був "дефолтним"
        // (простий варіант: завжди ставимо дефолт)
        setFundingCut(getDefaultFundingCut(direction));

        const def = getDefaultSort(direction);
        setSortKey(def.key);
        setSortDir(def.dir);
    }, [direction]);

    const defaultsHint = useMemo(() => {
        if (direction === "negative") return "negative: напр. -0.0001 (=-0.01%)";
        return "positive: напр. 0.00005 (=0.005%)";
    }, [direction]);

    async function load() {
        setError("");
        setLoading(true);
        try {
            const resp = await fetchFundingScreener({
                exchange,
                direction,
                fundingCut: Number(fundingCut),
                minTurnover24hUsd: Number(minTurnover24hUsd),
                minMarketCapUsd: Number(minMarketCapUsd),
                limit: Number(limit),
            });
            setData(resp);
        } catch (e: any) {
            setError(String(e?.message ?? e));
            setData(null);
        } finally {
            setLoading(false);
        }
    }

    // ----------------------------
    // 4) autoLoad on first mount
    // ----------------------------
    useEffect(() => {
        if (!autoLoad) return;
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function onSort(k: SortKey) {
        if (sortKey === k) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(k);
            setSortDir("asc");
        }
    }

    function sortArrow(k: SortKey) {
        if (sortKey !== k) return "";
        return sortDir === "asc" ? " ▲" : " ▼";
    }

    const sortedRows = useMemo(() => {
        const rows = data?.rows ? [...data.rows] : [];
        rows.sort((ra, rb) => {
            let c = 0;

            switch (sortKey) {
                case "symbol":
                    c = cmpMaybeString(ra.symbol, rb.symbol);
                    break;
                case "name":
                    c = cmpMaybeString(ra.name, rb.name);
                    break;
                case "funding":
                    c = ra.funding - rb.funding;
                    break;
                case "market_cap":
                    c = cmpMaybeNumber(ra.market_cap, rb.market_cap);
                    break;
                case "turnover_24h":
                    c = cmpMaybeNumber(ra.turnover_24h, rb.turnover_24h);
                    break;
                case "next_funding":
                    c = cmpMaybeString(ra.next_funding, rb.next_funding);
                    break;
                case "mark_price":
                    c = cmpMaybeNumber(ra.mark_price, rb.mark_price);
                    break;
                case "open_interest":
                    c = cmpMaybeNumber(ra.open_interest, rb.open_interest);
                    break;
                case "oi_value_usd":
                    c = cmpMaybeNumber(ra.oi_value_usd, rb.oi_value_usd);
                    break;
                case "alert":
                    c = cmpMaybeString(ra.alert, rb.alert);
                    break;
                default:
                    c = 0;
            }

            return sortDir === "asc" ? c : -c;
        });

        return rows;
    }, [data?.rows, sortKey, sortDir]);

    function resetToDefaults() {
        setExchange("binance");
        setDirection("negative");
        setFundingCut(getDefaultFundingCut("negative"));
        setMinTurnover24hUsd("2000000");
        setMinMarketCapUsd("100000000");
        setLimit("30");

        const def = getDefaultSort("negative");
        setSortKey(def.key);
        setSortDir(def.dir);
    }

    function exportCsv() {
        if (!sortedRows.length) return;
        const csv = toCsv(sortedRows);
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        downloadTextFile(`funding_screener_${exchange}_${direction}_${ts}.csv`, csv, "text/csv");
    }

    function onKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter") load();
    }

    return (
        <div style={{ padding: 16, fontFamily: "Arial, sans-serif" }} onKeyDown={onKeyDown}>
            <h2 className="funding-title">Funding Screener 2</h2>


            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>Exchange</div>
                    <select value={exchange} onChange={(e) => setExchange(e.target.value as ExchangeId)}>
                        <option value="binance">binance</option>
                        <option value="bybit">bybit</option>
                    </select>
                </div>

                <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>Direction</div>
                    <select value={direction} onChange={(e) => setDirection(e.target.value as FundingDirection)}>
                        <option value="negative">negative</option>
                        <option value="positive">positive</option>
                    </select>
                </div>

                <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>fundingCut</div>
                    <input
                        value={fundingCut}
                        onChange={(e) => setFundingCut(e.target.value)}
                        style={{ width: 160 }}
                        placeholder={defaultsHint}
                    />
                </div>

                <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>minTurnover24hUsd</div>
                    <input value={minTurnover24hUsd} onChange={(e) => setMinTurnover24hUsd(e.target.value)} style={{ width: 170 }} />
                </div>

                <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>minMarketCapUsd</div>
                    <input value={minMarketCapUsd} onChange={(e) => setMinMarketCapUsd(e.target.value)} style={{ width: 170 }} />
                </div>

                <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>limit</div>
                    <input value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 90 }} />
                </div>

                <button onClick={load} disabled={loading} style={{ padding: "6px 12px" }}>
                    {loading ? "Loading..." : "Load"}
                </button>

                <button onClick={resetToDefaults} disabled={loading} style={{ padding: "6px 12px" }}>
                    Reset
                </button>

                <button onClick={exportCsv} disabled={loading || !sortedRows.length} style={{ padding: "6px 12px" }}>
                    Export CSV
                </button>

                <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8, fontSize: 12 }}>
                    <input type="checkbox" checked={autoLoad} onChange={(e) => setAutoLoad(e.target.checked)} />
                    autoLoad
                </label>
            </div>

            {error && <div style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>{error}</div>}

            {data && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, marginBottom: 8, opacity: 0.8 }}>
                        updatedAtUtc: {data.updatedAtUtc} • count: {data.count} • sort: {sortKey} {sortDir}
                    </div>

                    <div className="funding-table-wrapper">
                        <table className="funding-table">
                            <thead >
                                <tr>
                                    <th style={th} onClick={() => onSort("symbol")}>Symbol{sortArrow("symbol")}</th>
                                    <th style={th} onClick={() => onSort("name")}>Name{sortArrow("name")}</th>
                                    <th style={th} onClick={() => onSort("funding")}>Funding{sortArrow("funding")}</th>
                                    <th style={th} onClick={() => onSort("market_cap")}>MarketCap{sortArrow("market_cap")}</th>
                                    <th style={th} onClick={() => onSort("turnover_24h")}>Turnover24h{sortArrow("turnover_24h")}</th>
                                    <th style={th} onClick={() => onSort("next_funding")}>NextFunding{sortArrow("next_funding")}</th>
                                    <th style={th} onClick={() => onSort("mark_price")}>MarkPrice{sortArrow("mark_price")}</th>
                                    <th style={th} onClick={() => onSort("open_interest")}>OpenInterest{sortArrow("open_interest")}</th>
                                    <th style={th} onClick={() => onSort("oi_value_usd")}>OI Value USD{sortArrow("oi_value_usd")}</th>
                                    <th style={th} onClick={() => onSort("alert")}>Alert{sortArrow("alert")}</th>
                                </tr>
                            </thead>

                            <tbody>
                                {sortedRows.map((r) => (
                                    <tr key={r.symbol}>
                                        <td style={td}>{r.symbol}</td>
                                        <td style={td}>{r.name}</td>
                                        <td style={td}>{fmtFunding(r.funding)}</td>
                                        <td style={td}>{fmtNum(r.market_cap, 0)}</td>
                                        <td style={td}>{fmtNum(r.turnover_24h, 0)}</td>
                                        <td style={td}>{r.next_funding}</td>
                                        <td style={td}>{fmtNum(r.mark_price, 8)}</td>
                                        <td style={td}>{fmtNum(r.open_interest, 2)}</td>
                                        <td style={td}>{fmtNum(r.oi_value_usd, 0)}</td>
                                        <td style={td}>{r.alert || ""}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
                        Tips: Enter = Load • Export CSV exports current sorted table • Settings saved in localStorage
                    </div>
                </div>
            )}
        </div>
    );
}

const th: React.CSSProperties = {
    textAlign: "left",
    padding: 8,
    borderBottom: "1px solid #ddd",
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
    padding: 8,
    borderBottom: "1px solid #f0f0f0",
    whiteSpace: "nowrap",
};
