import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { RelayClient } from "@polymarket/builder-relayer-client";
import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive.js";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config/index.js";
import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { createPublicClient, http } from "viem";
import { polygon } from "viem/chains";
import type { Signer } from "ethers";

import {
  DEFAULT_CHAIN_ID,
  DEFAULT_CLOB_API_URL,
  DEFAULT_RELAYER_URL,
} from "./constants.js";
import { InvalidConfigError } from "./errors.js";
import { checkAllApprovals, createAllApprovalTxs } from "./approvals.js";
import { createRedeemTx } from "./redeem.js";

import type {
  ApiCredentials,
  CreateLimitOrderRequest,
  CreateMarketOrderRequest,
  CreateOrderResult,
  EnsureApprovalsResult,
  HexAddress,
  PolyCoreConfig,
  ProgressEvent,
  TickSize,
  TradingSession,
} from "./types.js";
import { mapClobErrorMsgToCode } from "./clob-errors.js";

type TokenMeta = { tickSize: TickSize; negRisk: boolean; fetchedAtMs: number };

const DEFAULT_META_CACHE_TTL_MS = 60_000;

function getTickDecimals(tick: TickSize): number {
  const idx = tick.indexOf(".");
  if (idx < 0) return 0;
  return tick.length - idx - 1;
}

function alignPriceToTick(params: {
  price: number;
  tick: TickSize;
  rounding: "nearest" | "down" | "up";
}): number {
  const decimals = getTickDecimals(params.tick);
  const scale = 10 ** decimals;

  const priceInt = Math.round(params.price * scale);
  const tickInt = Math.round(Number(params.tick) * scale);
  if (tickInt <= 0) return params.price;

  const ratio = priceInt / tickInt;
  let steps: number;
  if (params.rounding === "down") steps = Math.floor(ratio);
  else if (params.rounding === "up") steps = Math.ceil(ratio);
  else steps = Math.round(ratio);

  const alignedInt = steps * tickInt;
  return alignedInt / scale;
}

export class PolymarketTradingKit {
  private readonly cfg: {
    chainId: number;
    rpcUrl: string;
    clobApiUrl: string;
    relayerUrl: string;
    remoteSigning: { url: string; token?: string };
    fetchFn?: typeof fetch;
  };

  private readonly eoaAddress: HexAddress;
  private readonly signer: Signer;
  private readonly tokenMetaCache = new Map<string, TokenMeta>();

  constructor(params: {
    config: PolyCoreConfig;
    eoaAddress: HexAddress;
    signer: Signer;
  }) {
    if (!params.config.rpcUrl) {
      throw new InvalidConfigError("rpcUrl is required");
    }
    if (!params.config.remoteSigning?.url) {
      throw new InvalidConfigError("remoteSigning.url is required");
    }

    this.cfg = {
      chainId: params.config.chainId ?? DEFAULT_CHAIN_ID,
      rpcUrl: params.config.rpcUrl,
      clobApiUrl: params.config.clobApiUrl ?? DEFAULT_CLOB_API_URL,
      relayerUrl: params.config.relayerUrl ?? DEFAULT_RELAYER_URL,
      remoteSigning: params.config.remoteSigning,
    };

    if (params.config.fetchFn) {
      this.cfg.fetchFn = params.config.fetchFn;
    }

    this.eoaAddress = params.eoaAddress;
    this.signer = params.signer;
  }

  createBuilderConfig(): BuilderConfig {
    const remoteBuilderConfig: any = {
      url: this.cfg.remoteSigning.url,
    };

    if (this.cfg.remoteSigning.token) {
      remoteBuilderConfig.token = this.cfg.remoteSigning.token;
    }

    return new BuilderConfig({
      remoteBuilderConfig,
    });
  }

  async createRelayClient(): Promise<RelayClient> {
    const builderConfig = this.createBuilderConfig();
    return new RelayClient(
      this.cfg.relayerUrl,
      this.cfg.chainId,
      this.signer as any,
      builderConfig
    );
  }

  deriveSafeAddress(): HexAddress {
    const config = getContractConfig(this.cfg.chainId);
    return deriveSafe(this.eoaAddress, config.SafeContracts.SafeFactory) as HexAddress;
  }

  async isSafeDeployed(safeAddress: HexAddress): Promise<boolean> {
    const publicClient = createPublicClient({
      chain: polygon,
      transport: http(this.cfg.rpcUrl),
    });

    const code = await publicClient.getBytecode({ address: safeAddress });
    return code !== undefined && code !== "0x" && code.length > 2;
  }

  async deploySafe(relayClient: RelayClient): Promise<HexAddress> {
    const response = await relayClient.deploy();
    const result = await response.wait();

    if (!result?.proxyAddress) {
      throw new Error("Safe deployment failed");
    }

    return result.proxyAddress as HexAddress;
  }

  async getOrCreateUserApiCredentials(): Promise<ApiCredentials> {
    const tempClient = new ClobClient(
      this.cfg.clobApiUrl,
      this.cfg.chainId,
      this.signer as any
    );

    const derived = await tempClient.deriveApiKey().catch(() => null);
    if (derived?.key && derived?.secret && derived?.passphrase) {
      return derived;
    }

    const created = await tempClient.createApiKey();
    return created;
  }

  createClobClient(params: {
    apiCredentials: ApiCredentials;
    safeAddress: HexAddress;
  }): ClobClient {
    const builderConfig = this.createBuilderConfig();

    return new ClobClient(
      this.cfg.clobApiUrl,
      this.cfg.chainId,
      this.signer as any,
      params.apiCredentials,
      2,
      params.safeAddress,
      undefined,
      false,
      builderConfig
    );
  }

  async checkApprovals(safeAddress: HexAddress) {
    return await checkAllApprovals({
      rpcUrl: this.cfg.rpcUrl,
      safeAddress,
    });
  }

  async ensureApprovals(relayClient: RelayClient, safeAddress: HexAddress): Promise<EnsureApprovalsResult> {
    const approvals = await this.checkApprovals(safeAddress);
    if (approvals.allApproved) {
      return { didSubmitTx: false, approvals };
    }

    const { txs } = createAllApprovalTxs();
    const response = await relayClient.execute(
      txs,
      "Set all token approvals for trading"
    );
    await response.wait();

    const after = await this.checkApprovals(safeAddress);
    return { didSubmitTx: true, approvals: after };
  }

  async initializeTradingSession(params?: {
    onProgress?: (evt: ProgressEvent) => void;
    /** If true, will attempt to deploy Safe when not deployed. */
    autoDeploySafe?: boolean;
  }): Promise<TradingSession> {
    const onProgress = params?.onProgress;
    const autoDeploySafe = params?.autoDeploySafe ?? true;

    onProgress?.({ step: "init_relay_client", message: "Initializing relay client" });
    const relayClient = await this.createRelayClient();

    onProgress?.({ step: "derive_safe", message: "Deriving Safe address" });
    const safeAddress = this.deriveSafeAddress();

    onProgress?.({ step: "check_safe_deployed", message: "Checking if Safe is deployed" });
    const deployed = await this.isSafeDeployed(safeAddress);

    if (!deployed) {
      if (!autoDeploySafe) {
        throw new Error("Safe is not deployed");
      }
      onProgress?.({ step: "deploy_safe", message: "Deploying Safe" });
      await this.deploySafe(relayClient);
    }

    onProgress?.({ step: "get_api_credentials", message: "Getting user API credentials" });
    const apiCredentials = await this.getOrCreateUserApiCredentials();

    onProgress?.({ step: "check_approvals", message: "Checking token approvals" });
    const approvalsBefore = await this.checkApprovals(safeAddress);

    let approvals = approvalsBefore;
    if (!approvalsBefore.allApproved) {
      onProgress?.({ step: "set_approvals", message: "Setting token approvals" });
      const ensured = await this.ensureApprovals(relayClient, safeAddress);
      approvals = ensured.approvals;
    }

    onProgress?.({ step: "complete", message: "Trading session is ready" });

    return {
      eoaAddress: this.eoaAddress,
      safeAddress,
      apiCredentials,
      approvals,
    };
  }

  private normalizeOrderResponse(res: any): CreateOrderResult {
    const rawSuccess = Boolean(res?.success ?? (res?.orderID || res?.orderId));
    const errorMsg =
      (res?.errorMsg as string | undefined) ?? (res?.error as string | undefined);
    const status = res?.status as string | undefined;
    const orderId =
      (res?.orderID as string | undefined) ??
      (res?.orderId as string | undefined) ??
      undefined;
    const txHashes =
      (res?.transactionsHashes as string[] | undefined) ??
      (res?.transactionHashes as string[] | undefined) ??
      (res?.orderHashes as string[] | undefined);

    const out: CreateOrderResult = {
      success: rawSuccess && (!errorMsg || errorMsg.length === 0),
    };

    if (orderId) out.orderId = orderId;
    if (status) out.status = status;
    if (errorMsg) {
      out.errorMsg = errorMsg;
      const code = mapClobErrorMsgToCode(errorMsg);
      if (code) out.errorCode = code;
    }
    if (txHashes && Array.isArray(txHashes)) out.transactionHashes = txHashes;
    out.raw = res;

    return out;
  }

  private async resolveTokenMeta(params: {
    clobClient: ClobClient;
    tokenId: string;
    mode: "auto" | "manual";
    tickSizeOverride?: TickSize;
    negRiskOverride?: boolean;
    needTickSize: boolean;
    needNegRisk: boolean;
  }): Promise<{ tickSize?: TickSize; negRisk?: boolean }> {
    if (params.mode === "manual") {
      const out: { tickSize?: TickSize; negRisk?: boolean } = {};
      if (params.tickSizeOverride) out.tickSize = params.tickSizeOverride;
      if (params.negRiskOverride !== undefined) out.negRisk = params.negRiskOverride;
      return out;
    }

    // If caller already provided everything needed, do not query.
    const hasTick = !params.needTickSize || !!params.tickSizeOverride;
    const hasNeg = !params.needNegRisk || params.negRiskOverride !== undefined;
    if (hasTick && hasNeg) {
      const out: { tickSize?: TickSize; negRisk?: boolean } = {};
      if (params.tickSizeOverride) out.tickSize = params.tickSizeOverride;
      if (params.negRiskOverride !== undefined) out.negRisk = params.negRiskOverride;
      return out;
    }

    const cached = this.tokenMetaCache.get(params.tokenId);
    const now = Date.now();
    if (cached && now - cached.fetchedAtMs <= DEFAULT_META_CACHE_TTL_MS) {
      const out: { tickSize?: TickSize; negRisk?: boolean } = {};
      out.tickSize = params.tickSizeOverride ?? cached.tickSize;
      out.negRisk = params.negRiskOverride ?? cached.negRisk;
      return out;
    }

    // Single call to get both tick size and neg risk.
    const ob = await (params.clobClient as any).getOrderBook(params.tokenId);
    const tickSize =
      (ob?.tick_size as TickSize | undefined) ?? params.tickSizeOverride;
    const negRisk =
      (ob?.neg_risk as boolean | undefined) ?? params.negRiskOverride;

    if (tickSize && typeof negRisk === "boolean") {
      this.tokenMetaCache.set(params.tokenId, { tickSize, negRisk, fetchedAtMs: now });
    }

    const out: { tickSize?: TickSize; negRisk?: boolean } = {};
    if (tickSize) out.tickSize = tickSize;
    if (negRisk !== undefined) out.negRisk = negRisk;
    return out;
  }

  /**
   * Limit orders (GTC/GTD). Also supports an aggressive orderbook mode via req.isMarketOrder=true.
   */
  async createLimitOrder(
    clobClient: ClobClient,
    req: CreateLimitOrderRequest
  ): Promise<CreateOrderResult> {
    const side = req.side === "BUY" ? Side.BUY : Side.SELL;

    const timeInForce = req.timeInForce ?? "GTC";
    const orderType = timeInForce === "GTD" ? OrderType.GTD : OrderType.GTC;
    const deferExec = req.deferExec ?? false;

    const tickSizeMode = req.tickSizeMode ?? "none";
    const tickRounding = req.tickRounding ?? "nearest";
    const mode = req.mode ?? "auto";

    const metaArgs: any = {
      clobClient,
      tokenId: req.tokenId,
      mode,
      needTickSize: tickSizeMode !== "none",
      needNegRisk: req.negRisk === undefined,
    };
    if (req.tickSize) metaArgs.tickSizeOverride = req.tickSize;
    if (req.negRisk !== undefined) metaArgs.negRiskOverride = req.negRisk;
    const meta = await this.resolveTokenMeta(metaArgs);

    const options: any = {};
    const negRiskResolved =
      req.negRisk !== undefined ? req.negRisk : meta.negRisk;
    if (negRiskResolved !== undefined) {
      options.negRisk = negRiskResolved;
    }

    const applyTick = async (price: number): Promise<number | CreateOrderResult> => {
      if (tickSizeMode === "none") return price;
      const tick = meta.tickSize ?? req.tickSize;
      if (!tick) {
        return {
          success: false,
          errorCode: "INVALID_ORDER_MIN_TICK_SIZE",
          errorMsg: "Missing tick size for token",
        };
      }
      const aligned = alignPriceToTick({ price, tick, rounding: tickRounding });
      if (tickSizeMode === "validate" && Math.abs(aligned - price) > 1e-12) {
        return {
          success: false,
          errorCode: "INVALID_ORDER_MIN_TICK_SIZE",
          errorMsg: "Price breaks minimum tick size rules",
        };
      }
      return aligned;
    };

    if (orderType === OrderType.GTD && !req.expirationUnixSeconds) {
      return {
        success: false,
        errorCode: "INVALID_ORDER_EXPIRATION",
        errorMsg: "invalid expiration",
      };
    }

    // "Aggressive limit" mode (pseudo market behavior).
    if (req.isMarketOrder) {
      let aggressivePrice: number;
      try {
        const priceFromOrderbook = await clobClient.getPrice(req.tokenId, side);
        const marketPrice = parseFloat(priceFromOrderbook.price);

        if (isNaN(marketPrice) || marketPrice <= 0 || marketPrice >= 1) {
          throw new Error("Invalid price from orderbook");
        }

        aggressivePrice =
          req.side === "BUY"
            ? Math.min(0.99, marketPrice * 1.05)
            : Math.max(0.01, marketPrice * 0.95);
      } catch {
        aggressivePrice = req.side === "BUY" ? 0.99 : 0.01;
      }

      const maybeAligned = await applyTick(aggressivePrice);
      if (typeof maybeAligned !== "number") return maybeAligned;

      const order: any = {
        tokenID: req.tokenId,
        price: maybeAligned,
        size: req.size,
        side,
        feeRateBps: 0,
        expiration: orderType === OrderType.GTD ? req.expirationUnixSeconds : 0,
        taker: "0x0000000000000000000000000000000000000000",
      };

      try {
        const res = await (clobClient as any).createAndPostOrder(
          order,
          options,
          orderType,
          deferExec
        );
        const normalized = this.normalizeOrderResponse(res);
        if (!normalized.success) return normalized;
        if (!normalized.orderId) {
          return {
            success: false,
            errorCode: "UNKNOWN",
            errorMsg: "Order submission failed",
            raw: normalized.raw,
          };
        }
        return normalized;
      } catch (err: any) {
        const httpStatus = err?.response?.status as number | undefined;
        const data = err?.response?.data as any;
        const errorMsg: string =
          (data?.errorMsg as string | undefined) ??
          (data?.error as string | undefined) ??
          (err?.message as string | undefined) ??
          "Request failed";
        return {
          success: false,
          errorCode: httpStatus ? "HTTP_ERROR" : "UNKNOWN",
          errorMsg,
          raw: { httpStatus, data },
        };
      }
    }

    if (req.price === undefined) {
      return {
        success: false,
        errorCode: "INVALID_ORDER_ERROR",
        errorMsg: "price is required for limit orders",
      };
    }

    const maybeAligned = await applyTick(req.price);
    if (typeof maybeAligned !== "number") return maybeAligned;

    const order: any = {
      tokenID: req.tokenId,
      price: maybeAligned,
      size: req.size,
      side,
      feeRateBps: 0,
      expiration: orderType === OrderType.GTD ? req.expirationUnixSeconds : 0,
      taker: "0x0000000000000000000000000000000000000000",
    };

    try {
      const res = await (clobClient as any).createAndPostOrder(
        order,
        options,
        orderType,
        deferExec
      );
      const normalized = this.normalizeOrderResponse(res);
      if (!normalized.success) return normalized;
      if (!normalized.orderId) {
        return {
          success: false,
          errorCode: "UNKNOWN",
          errorMsg: "Order submission failed",
          raw: normalized.raw,
        };
      }
      return normalized;
    } catch (err: any) {
      const httpStatus = err?.response?.status as number | undefined;
      const data = err?.response?.data as any;
      const errorMsg: string =
        (data?.errorMsg as string | undefined) ??
        (data?.error as string | undefined) ??
        (err?.message as string | undefined) ??
        "Request failed";
      return {
        success: false,
        errorCode: httpStatus ? "HTTP_ERROR" : "UNKNOWN",
        errorMsg,
        raw: { httpStatus, data },
      };
    }
  }

  /**
   * Market-style orders (FOK/FAK).
   * - BUY: amountUsdc is required
   * - SELL: amountShares is required
   */
  async createMarketOrder(
    clobClient: ClobClient,
    req: CreateMarketOrderRequest
  ): Promise<CreateOrderResult> {
    const side = req.side === "BUY" ? Side.BUY : Side.SELL;
    const deferExec = req.deferExec ?? false;
    const orderType = req.orderType ?? "FOK";
    const tickSizeMode = req.tickSizeMode ?? "none";
    const tickRounding = req.tickRounding ?? "nearest";
    const mode = req.mode ?? "auto";

    const metaArgs: any = {
      clobClient,
      tokenId: req.tokenId,
      mode,
      needTickSize: tickSizeMode !== "none" && req.price !== undefined,
      needNegRisk: req.negRisk === undefined,
    };
    if (req.tickSize) metaArgs.tickSizeOverride = req.tickSize;
    if (req.negRisk !== undefined) metaArgs.negRiskOverride = req.negRisk;
    const meta = await this.resolveTokenMeta(metaArgs);

    const options: any = {};
    const negRiskResolved =
      req.negRisk !== undefined ? req.negRisk : meta.negRisk;
    if (negRiskResolved !== undefined) {
      options.negRisk = negRiskResolved;
    }

    let price = req.price;
    if (price !== undefined && tickSizeMode !== "none") {
      const tick = meta.tickSize ?? req.tickSize;
      if (!tick) {
        return {
          success: false,
          errorCode: "INVALID_ORDER_MIN_TICK_SIZE",
          errorMsg: "Missing tick size for token",
        };
      }
      const aligned = alignPriceToTick({ price, tick, rounding: tickRounding });
      if (tickSizeMode === "validate" && Math.abs(aligned - price) > 1e-12) {
        return {
          success: false,
          errorCode: "INVALID_ORDER_MIN_TICK_SIZE",
          errorMsg: "Price breaks minimum tick size rules",
        };
      }
      price = aligned;
    }

    const amount =
      req.side === "BUY" ? req.amountUsdc : req.amountShares;
    if (amount === undefined || amount <= 0) {
      return {
        success: false,
        errorCode: "INVALID_ORDER_ERROR",
        errorMsg:
          req.side === "BUY"
            ? "amountUsdc is required for BUY market orders"
            : "amountShares is required for SELL market orders",
      };
    }

    const userMarketOrder: any = {
      tokenID: req.tokenId,
      amount,
      side,
    };
    if (price !== undefined) {
      userMarketOrder.price = price;
    }

    try {
      const res = await (clobClient as any).createAndPostMarketOrder(
        userMarketOrder,
        options,
        orderType,
        deferExec
      );
      const normalized = this.normalizeOrderResponse(res);
      if (!normalized.success) return normalized;
      if (!normalized.orderId) {
        return {
          success: false,
          errorCode: "UNKNOWN",
          errorMsg: "Order submission failed",
          raw: normalized.raw,
        };
      }
      return normalized;
    } catch (err: any) {
      const httpStatus = err?.response?.status as number | undefined;
      const data = err?.response?.data as any;
      const errorMsg: string =
        (data?.errorMsg as string | undefined) ??
        (data?.error as string | undefined) ??
        (err?.message as string | undefined) ??
        "Request failed";
      return {
        success: false,
        errorCode: httpStatus ? "HTTP_ERROR" : "UNKNOWN",
        errorMsg,
        raw: { httpStatus, data },
      };
    }
  }

  /**
   * @deprecated Use createLimitOrder instead.
   */
  async createOrder(
    clobClient: ClobClient,
    req: any
  ): Promise<CreateOrderResult> {
    return await this.createLimitOrder(clobClient, req as CreateLimitOrderRequest);
  }

  async cancelOrder(clobClient: ClobClient, orderId: string): Promise<void> {
    await clobClient.cancelOrder({ orderID: orderId });
  }

  async getOpenOrders(clobClient: ClobClient) {
    return await clobClient.getOpenOrders();
  }

  async getBestBidAsk(clobClient: ClobClient, tokenId: string): Promise<{
    bidPrice: number;
    askPrice: number;
    midPrice: number;
    spread: number;
  }> {
    const [bidRes, askRes] = await Promise.all([
      clobClient.getPrice(tokenId, Side.BUY),
      clobClient.getPrice(tokenId, Side.SELL),
    ]);

    const bidPrice = parseFloat(bidRes.price);
    const askPrice = parseFloat(askRes.price);

    if (
      isNaN(bidPrice) ||
      isNaN(askPrice) ||
      bidPrice <= 0 ||
      bidPrice >= 1 ||
      askPrice <= 0 ||
      askPrice >= 1
    ) {
      throw new Error("Invalid prices");
    }

    return {
      bidPrice,
      askPrice,
      midPrice: (bidPrice + askPrice) / 2,
      spread: askPrice - bidPrice,
    };
  }

  async redeemPosition(relayClient: RelayClient, params: { conditionId: string; outcomeIndex: number; }): Promise<void> {
    const tx = createRedeemTx(params);
    const response = await relayClient.execute(
      [tx],
      `Redeem position for condition ${params.conditionId}`
    );
    await response.wait();
  }
}
