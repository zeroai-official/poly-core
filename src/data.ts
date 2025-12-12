import { GAMMA_API_URL, DATA_API_URL } from "./constants.js";
import { MissingDependencyError } from "./errors.js";
import type { PolyCoreConfig } from "./types.js";

export type PolymarketMarket = {
  id: string;
  question: string;
  slug: string;
  active: boolean;
  closed: boolean;
  clobTokenIds?: string;
  outcomePrices?: string;
  liquidity?: string | number;
  volume?: string | number;
  volume24hr?: string | number;
  tags?: Array<{ slug: string }>;
  events?: any[];
  acceptingOrders?: boolean;
  [key: string]: any;
};

export type PolymarketPosition = {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  currentValue: number;
  redeemable: boolean;
  mergeable: boolean;
  title: string;
  slug: string;
  outcome: string;
  outcomeIndex: number;
  endDate: string;
  negativeRisk: boolean;
  [key: string]: any;
};

export class PolymarketDataClient {
  private readonly fetchFn: typeof fetch;

  constructor(cfg: Pick<PolyCoreConfig, "fetchFn">) {
    const fetchImpl = cfg.fetchFn ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new MissingDependencyError(
        "fetch is not available. Provide config.fetchFn."
      );
    }
    this.fetchFn = fetchImpl;
  }

  async listHighVolumeMarkets(limit: number): Promise<PolymarketMarket[]> {
    const fetchLimit = Math.max(1, Math.floor(limit)) * 5;

    const res = await this.fetchFn(
      `${GAMMA_API_URL}/markets?limit=${fetchLimit}&offset=0&active=true&closed=false&order=volume24hr&ascending=false`,
      { headers: { "Content-Type": "application/json" } }
    );

    if (!res.ok) {
      throw new Error(`Gamma API error: ${res.status}`);
    }

    const markets = (await res.json()) as unknown;
    if (!Array.isArray(markets)) {
      throw new Error("Invalid Gamma API response");
    }

    const evergreenTags = [
      "crypto",
      "politics",
      "sports",
      "technology",
      "business",
      "entertainment",
      "science",
      "ai",
      "pop-culture",
    ];

    const validMarkets = (markets as any[]).filter((market) => {
      if (market.events && market.events.length > 0) {
        const hasEndedEvent = market.events.some(
          (event: any) =>
            event.ended === true ||
            event.live === false ||
            event.finishedTimestamp
        );
        if (hasEndedEvent) return false;
      }

      if (market.acceptingOrders === false) return false;
      if (!market.clobTokenIds) return false;

      if (market.outcomePrices) {
        try {
          const prices = JSON.parse(market.outcomePrices);
          const hasTradeablePrice = prices.some((price: string) => {
            const p = parseFloat(price);
            return p >= 0.05 && p <= 0.95;
          });
          if (!hasTradeablePrice) return false;
        } catch {
          return false;
        }
      }

      const marketTags =
        market.tags?.map((t: any) => String(t.slug).toLowerCase()) || [];
      const hasEvergreenTag = evergreenTags.some((tag) => marketTags.includes(tag));

      const liquidity = parseFloat(market.liquidity || "0");
      if (!hasEvergreenTag && liquidity < 5000) return false;
      if (liquidity < 1000) return false;

      return true;
    });

    const sorted = validMarkets.sort((a, b) => {
      const aScore = parseFloat(a.liquidity || "0") + parseFloat(a.volume || "0");
      const bScore = parseFloat(b.liquidity || "0") + parseFloat(b.volume || "0");
      return bScore - aScore;
    });

    return sorted.slice(0, Math.max(0, Math.floor(limit))) as PolymarketMarket[];
  }

  async getMarketByTokenId(tokenId: string): Promise<PolymarketMarket> {
    const res = await this.fetchFn(
      `${GAMMA_API_URL}/markets?limit=100&offset=0&active=true&closed=false`,
      { headers: { "Content-Type": "application/json" } }
    );

    if (!res.ok) {
      throw new Error(`Gamma API error: ${res.status}`);
    }

    const markets = (await res.json()) as unknown;
    if (!Array.isArray(markets)) {
      throw new Error("Invalid Gamma API response");
    }

    const market = (markets as any[]).find((m) => {
      if (!m.clobTokenIds) return false;
      try {
        const tokenIds = JSON.parse(m.clobTokenIds);
        return tokenIds.includes(tokenId);
      } catch {
        return false;
      }
    });

    if (!market) {
      throw new Error("Market not found");
    }

    return market as PolymarketMarket;
  }

  async getPositions(user: string): Promise<PolymarketPosition[]> {
    const params = new URLSearchParams({
      user,
      sizeThreshold: "0.01",
      limit: "500",
    });

    const res = await this.fetchFn(`${DATA_API_URL}/positions?${params}`, {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Polymarket API error: ${res.status}`);
    }

    return (await res.json()) as PolymarketPosition[];
  }
}
