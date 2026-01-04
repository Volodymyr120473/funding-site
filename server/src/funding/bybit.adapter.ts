import { httpGet, safeFloat } from "./http";

const BYBIT_REST = process.env.BYBIT_REST || "https://api.bybit.com";
const REQ_TIMEOUT = Number(process.env.HTTP_TIMEOUT ?? "15") * 1000;
const USER_AGENT = process.env.USER_AGENT || "neg-funding-tracker-ts/1.0";

type BybitOpenInterestResp = {
  result?: {
    list?: Array<{
      openInterest?: string | number;
      // деякі ринки можуть повертати openInterestValue, але не покладайся
      openInterestValue?: string | number;
    }>;
  };
};

export async function bybitGetOpenInterestLatest(symbol: string): Promise<number | null> {
  // /v5/market/open-interest вимагає intervalTime, візьмемо 1h і limit=1
  const data = await httpGet<BybitOpenInterestResp>(
    `${BYBIT_REST}/v5/market/open-interest`,
    {
      category: "linear",
      symbol,
      intervalTime: "1h",
      limit: 1,
    },
    { "User-Agent": USER_AGENT },
    REQ_TIMEOUT
  );

  const item = data?.result?.list?.[0];
  return safeFloat(item?.openInterest);
}
