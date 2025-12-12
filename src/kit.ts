import { BuilderConfig } from "@polymarket/builder-signing-sdk";
import { RelayClient } from "@polymarket/builder-relayer-client";
import { deriveSafe } from "@polymarket/builder-relayer-client/dist/builder/derive";
import { getContractConfig } from "@polymarket/builder-relayer-client/dist/config";
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
  CreateOrderRequest,
  CreateOrderResult,
  EnsureApprovalsResult,
  HexAddress,
  PolyCoreConfig,
  ProgressEvent,
  TradingSession,
} from "./types.js";

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

  async createOrder(clobClient: ClobClient, req: CreateOrderRequest): Promise<CreateOrderResult> {
    const side = req.side === "BUY" ? Side.BUY : Side.SELL;

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

      const order: any = {
        tokenID: req.tokenId,
        price: aggressivePrice,
        size: req.size,
        side,
        feeRateBps: 0,
        expiration: 0,
        taker: "0x0000000000000000000000000000000000000000",
      };

      const options: any = {};
      if (req.negRisk !== undefined) {
        options.negRisk = req.negRisk;
      }

      const res = await clobClient.createAndPostOrder(
        order,
        options,
        OrderType.GTC
      );

      if (!res.orderID) {
        throw new Error("Order submission failed");
      }
      return { orderId: res.orderID };
    }

    if (req.price === undefined) {
      throw new Error("price is required for limit orders");
    }

    const order: any = {
      tokenID: req.tokenId,
      price: req.price,
      size: req.size,
      side,
      feeRateBps: 0,
      expiration: 0,
      taker: "0x0000000000000000000000000000000000000000",
    };

    const options: any = {};
    if (req.negRisk !== undefined) {
      options.negRisk = req.negRisk;
    }

    const res = await clobClient.createAndPostOrder(
      order,
      options,
      OrderType.GTC
    );

    if (!res.orderID) {
      throw new Error("Order submission failed");
    }

    return { orderId: res.orderID };
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
