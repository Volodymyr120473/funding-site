import type { FundingFilters, FundingResponse } from "./types";

export async function fetchFundingScreener(
  filters: Partial<FundingFilters>
): Promise<FundingResponse> {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      params.set(k, String(v));
    }
  });

  const url = `/funding/screener?${params.toString()}`;
  const res = await fetch(url);

  if (!res.ok) {
    // пробуємо витягти тіло відповіді (json або текст)
    const ct = res.headers.get("content-type") || "";
    let body = "";
    try {
      if (ct.includes("application/json")) {
        const j = await res.json();
        body = JSON.stringify(j, null, 2);
      } else {
        body = await res.text();
      }
    } catch {
      body = "(cannot read response body)";
    }

    throw new Error(`HTTP ${res.status} ${res.statusText}\n${body}`);
  }

  return res.json();
}
