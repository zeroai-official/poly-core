import { GAMMA_API_URL, DATA_API_URL, DEFAULT_CLOB_API_URL } from "./constants.js";
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

export type PolymarketMarketDetails = {
  id: string;
  question?: string | null;
  conditionId?: string;
  slug?: string | null;
  endDate?: string | null;
  startDate?: string | null;
  category?: string | null;
  liquidity?: string | null;
  volume?: string | null;
  active?: boolean | null;
  closed?: boolean | null;
  clobTokenIds?: string | null;
  outcomePrices?: string | null;
  acceptingOrders?: boolean | null;
  enableOrderBook?: boolean | null;
  orderPriceMinTickSize?: number | null;
  orderMinSize?: number | null;
  marketMakerAddress?: string;
  events?: any[] | null;
  tags?: any[] | null;
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

export type PositionsSortBy =
  | "CURRENT"
  | "INITIAL"
  | "TOKENS"
  | "CASHPNL"
  | "PERCENTPNL"
  | "TITLE"
  | "RESOLVING"
  | "PRICE"
  | "AVGPRICE";

export type PositionsSortDirection = "ASC" | "DESC";

export type GetPositionsParams = {
  /**
   * User Profile Address (0x-prefixed, 40 hex chars)
   */
  user: string;
  /**
   * Comma-separated list of condition IDs. Mutually exclusive with eventId.
   */
  market?: string[];
  /**
   * Comma-separated list of event IDs. Mutually exclusive with market.
   */
  eventId?: number[];
  /**
   * Default: 1
   */
  sizeThreshold?: number;
  /**
   * Default: false
   */
  redeemable?: boolean;
  /**
   * Default: false
   */
  mergeable?: boolean;
  /**
   * Default: 100. Range: 0..500
   */
  limit?: number;
  /**
   * Default: 0. Range: 0..10000
   */
  offset?: number;
  /**
   * Default: TOKENS
   */
  sortBy?: PositionsSortBy;
  /**
   * Default: DESC
   */
  sortDirection?: PositionsSortDirection;
  /**
   * Max length: 100
   */
  title?: string;
};

export type PolymarketEvent = {
  id: string;
  ticker?: string | null;
  slug?: string | null;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  resolutionSource?: string | null;
  startDate?: string | null;
  creationDate?: string | null;
  endDate?: string | null;
  image?: string | null;
  icon?: string | null;
  active?: boolean | null;
  closed?: boolean | null;
  archived?: boolean | null;
  new?: boolean | null;
  featured?: boolean | null;
  restricted?: boolean | null;
  liquidity?: number | null;
  volume?: number | null;
  openInterest?: number | null;
  category?: string | null;
  subcategory?: string | null;
  negRisk?: boolean | null;
  negRiskMarketID?: string | null;
  negRiskFeeBips?: number | null;
  commentCount?: number | null;
  enableOrderBook?: boolean | null;
  markets?: any[] | null;
  tags?: any[] | null;
  chats?: any[] | null;
  templates?: any[] | null;
  [key: string]: any;
};

export type OrderBookSummaryRequestItem = {
  token_id: string;
};

export type OrderBookSummaryLevel = {
  price: string;
  size: string;
};

export type OrderBookSummary = {
  market: string;
  asset_id: string;
  timestamp: string;
  hash: string;
  bids: OrderBookSummaryLevel[];
  asks: OrderBookSummaryLevel[];
  min_order_size: string;
  tick_size: string;
  neg_risk: boolean;
};

export class PolymarketDataClient {
  private readonly fetchFn: typeof fetch;
  private readonly clobApiUrl: string;

  constructor(cfg: Pick<PolyCoreConfig, "fetchFn" | "clobApiUrl">) {
    const fetchImpl = cfg.fetchFn ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new MissingDependencyError(
        "fetch is not available. Provide config.fetchFn."
      );
    }
    this.fetchFn = fetchImpl;
    this.clobApiUrl = cfg.clobApiUrl ?? DEFAULT_CLOB_API_URL;
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

  async getMarketBySlug(
    slug: string,
    options?: { includeTag?: boolean }
  ): Promise<PolymarketMarketDetails> {
    const safeSlug = String(slug).trim();
    if (!safeSlug) {
      throw new Error("slug is required");
    }

    const params = new URLSearchParams();
    if (options?.includeTag !== undefined) {
      params.set("include_tag", String(options.includeTag));
    }
    const qs = params.toString();

    const res = await this.fetchFn(
      `${GAMMA_API_URL}/markets/slug/${encodeURIComponent(safeSlug)}${
        qs ? `?${qs}` : ""
      }`,
      { headers: { "Content-Type": "application/json" } }
    );

    if (!res.ok) {
      throw new Error(`Gamma API error: ${res.status}`);
    }

    const json = (await res.json()) as unknown;
    if (!json || typeof json !== "object") {
      throw new Error("Invalid Gamma API response");
    }

    return json as PolymarketMarketDetails;
  }

  async getPositions(user: string): Promise<PolymarketPosition[]>;
  async getPositions(params: GetPositionsParams): Promise<PolymarketPosition[]>;
  async getPositions(arg: string | GetPositionsParams): Promise<PolymarketPosition[]> {
    const p: GetPositionsParams =
      typeof arg === "string"
        ? {
            // Backward-compatible defaults (do not change existing behavior).
            user: arg,
            sizeThreshold: 0.01,
            limit: 500,
          }
        : arg;

    const user = String(p.user).trim();
    if (!user) {
      throw new Error("user is required");
    }

    if (p.market?.length && p.eventId?.length) {
      throw new Error("market and eventId are mutually exclusive");
    }

    const qp = new URLSearchParams();
    qp.set("user", user);

    if (p.market?.length) {
      qp.set("market", p.market.map((x) => String(x).trim()).filter(Boolean).join(","));
    }
    if (p.eventId?.length) {
      qp.set(
        "eventId",
        p.eventId.map((x) => String(Math.floor(x))).filter(Boolean).join(",")
      );
    }

    // Doc defaults (only applied for object-style usage).
    const applyDocDefaults = typeof arg !== "string";

    const sizeThreshold =
      p.sizeThreshold !== undefined
        ? p.sizeThreshold
        : applyDocDefaults
          ? 1
          : undefined;
    if (sizeThreshold !== undefined) {
      qp.set("sizeThreshold", String(sizeThreshold));
    }

    const redeemable =
      p.redeemable !== undefined
        ? p.redeemable
        : applyDocDefaults
          ? false
          : undefined;
    if (redeemable !== undefined) {
      qp.set("redeemable", String(redeemable));
    }

    const mergeable =
      p.mergeable !== undefined
        ? p.mergeable
        : applyDocDefaults
          ? false
          : undefined;
    if (mergeable !== undefined) {
      qp.set("mergeable", String(mergeable));
    }

    const limit =
      p.limit !== undefined
        ? p.limit
        : applyDocDefaults
          ? 100
          : undefined;
    if (limit !== undefined) {
      qp.set("limit", String(limit));
    }

    const offset =
      p.offset !== undefined
        ? p.offset
        : applyDocDefaults
          ? 0
          : undefined;
    if (offset !== undefined) {
      qp.set("offset", String(offset));
    }

    const sortBy =
      p.sortBy !== undefined
        ? p.sortBy
        : applyDocDefaults
          ? "TOKENS"
          : undefined;
    if (sortBy !== undefined) {
      qp.set("sortBy", sortBy);
    }

    const sortDirection =
      p.sortDirection !== undefined
        ? p.sortDirection
        : applyDocDefaults
          ? "DESC"
          : undefined;
    if (sortDirection !== undefined) {
      qp.set("sortDirection", sortDirection);
    }

    if (p.title !== undefined) {
      qp.set("title", String(p.title));
    }

    const res = await this.fetchFn(`${DATA_API_URL}/positions?${qp}`, {
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Polymarket API error: ${res.status}`);
    }

    return (await res.json()) as PolymarketPosition[];
  }

  async getEventBySlug(
    slug: string,
    options?: { includeChat?: boolean; includeTemplate?: boolean }
  ): Promise<PolymarketEvent> {
    const safeSlug = String(slug).trim();
    if (!safeSlug) {
      throw new Error("slug is required");
    }

    const params = new URLSearchParams();
    if (options?.includeChat !== undefined) {
      params.set("include_chat", String(options.includeChat));
    }
    if (options?.includeTemplate !== undefined) {
      params.set("include_template", String(options.includeTemplate));
    }
    const qs = params.toString();

    const res = await this.fetchFn(
      `${GAMMA_API_URL}/events/slug/${encodeURIComponent(safeSlug)}${
        qs ? `?${qs}` : ""
      }`,
      { headers: { "Content-Type": "application/json" } }
    );

    if (!res.ok) {
      throw new Error(`Gamma API error: ${res.status}`);
    }

    const json = (await res.json()) as unknown;
    if (!json || typeof json !== "object") {
      throw new Error("Invalid Gamma API response");
    }

    return json as PolymarketEvent;
  }

  /**
   * Get multiple order book summaries by token IDs via CLOB POST /books.
   */
  async getOrderBookSummaries(tokenIds: string[]): Promise<OrderBookSummary[]> {
    const uniqueTokenIds = Array.from(
      new Set(tokenIds.map((t) => String(t).trim()).filter(Boolean))
    );
    if (uniqueTokenIds.length === 0) return [];

    const body: OrderBookSummaryRequestItem[] = uniqueTokenIds.map((tokenId) => ({
      token_id: tokenId,
    }));

    const res = await this.fetchFn(`${this.clobApiUrl}/books`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`CLOB API error: ${res.status}`);
    }

    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) {
      throw new Error("Invalid CLOB API response");
    }

    return json as OrderBookSummary[];
  }
}
