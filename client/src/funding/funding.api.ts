import type { FundingFilters, FundingResponse } from "./types";

export async function fetchFundingScreener(
  filters: Partial<FundingFilters>
): Promise<FundingResponse> {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      params.set(k, String(v));
    }
  });

  const res = await fetch(`/funding/screener?${params.toString()}`);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return res.json();
}
