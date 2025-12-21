import type { SafeTransaction } from "@polymarket/builder-relayer-client";

export type HexAddress = `0x${string}`;

export type RemoteSigningConfig = {
  url: string;
  token?: string;
};

export type PolyCoreConfig = {
  chainId?: number;
  rpcUrl: string;
  clobApiUrl?: string;
  relayerUrl?: string;
  remoteSigning: RemoteSigningConfig;
  /**
   * Provide a custom fetch implementation if globalThis.fetch is unavailable.
   */
  fetchFn?: typeof fetch;
};

export type ApiCredentials = {
  key: string;
  secret: string;
  passphrase: string;
};

export type TradingSession = {
  eoaAddress: HexAddress;
  safeAddress: HexAddress;
  apiCredentials: ApiCredentials;
  approvals: ApprovalStatus;
};

export type TradingSessionStep =
  | "init_relay_client"
  | "derive_safe"
  | "check_safe_deployed"
  | "deploy_safe"
  | "get_api_credentials"
  | "check_approvals"
  | "set_approvals"
  | "complete";

export type ProgressEvent = {
  step: TradingSessionStep;
  message: string;
};

export type ApprovalStatus = {
  allApproved: boolean;
  usdcApprovals: Record<string, boolean>;
  outcomeTokenApprovals: Record<string, boolean>;
};

export type EnsureApprovalsResult = {
  didSubmitTx: boolean;
  approvals: ApprovalStatus;
};

export type OrderSide = "BUY" | "SELL";

export type OrderTimeInForce = "GTC" | "GTD";

export type TickSizeMode = "none" | "validate" | "round";

export type TickRoundingMode = "nearest" | "down" | "up";

export type OrderMetaMode = "auto" | "manual";

export type TickSize = "0.1" | "0.01" | "0.001" | "0.0001";

export type CreateLimitOrderRequest = {
  tokenId: string;
  /**
   * Shares size.
   */
  size: number;
  price?: number;
  side: OrderSide;
  /**
   * Default: "auto".
   * - "auto": if needed, the kit will query CLOB orderbook once to resolve tickSize + negRisk (cached).
   * - "manual": caller must provide negRisk/tickSize when needed to avoid extra queries.
   */
  mode?: OrderMetaMode;
  /**
   * Optional override to avoid a CLOB metadata lookup.
   */
  negRisk?: boolean;
  /**
   * If true, the kit will fetch an orderbook price and submit an aggressive limit order.
   */
  isMarketOrder?: boolean;
  /**
   * Default: "GTC".
   */
  timeInForce?: OrderTimeInForce;
  /**
   * Only used when timeInForce = "GTD". Unix seconds.
   */
  expirationUnixSeconds?: number;
  /**
   * Default: false.
   * When true, the CLOB may accept/match the order but defer onchain execution.
   */
  deferExec?: boolean;
  /**
   * Default: "none".
   * - "validate": fail early if price is not aligned to tick size
   * - "round": align price to tick size using tickRounding
   */
  tickSizeMode?: TickSizeMode;
  /**
   * Default: "nearest".
   * Only used when tickSizeMode = "round".
   */
  tickRounding?: TickRoundingMode;
  /**
   * Optional override to avoid a CLOB metadata lookup when tickSizeMode != "none".
   */
  tickSize?: TickSize;
};

export type MarketOrderType = "FOK" | "FAK";

export type CreateMarketOrderRequest = {
  tokenId: string;
  side: OrderSide;
  /**
   * Default: "auto".
   * - "auto": if needed, the kit will query CLOB orderbook once to resolve tickSize + negRisk (cached).
   * - "manual": caller must provide negRisk/tickSize when needed to avoid extra queries.
   */
  mode?: OrderMetaMode;
  /**
   * Optional override to avoid a CLOB metadata lookup.
   */
  negRisk?: boolean;
  /**
   * BUY: amount in USDC
   */
  amountUsdc?: number;
  /**
   * SELL: amount in shares
   */
  amountShares?: number;
  /**
   * Optional price cap/floor.
   * If omitted, the client will use market price.
   */
  price?: number;
  /**
   * Default: "FOK".
   */
  orderType?: MarketOrderType;
  /**
   * Default: false.
   * When true, the CLOB may accept/match the order but defer onchain execution.
   */
  deferExec?: boolean;
  /**
   * Default: "none".
   * Applies to req.price when present.
   */
  tickSizeMode?: TickSizeMode;
  /**
   * Default: "nearest".
   */
  tickRounding?: TickRoundingMode;
  /**
   * Optional override to avoid a CLOB metadata lookup when tickSizeMode != "none".
   */
  tickSize?: TickSize;
};

export type ClobInsertStatus = "matched" | "live" | "delayed" | "unmatched" | string;

export type ClobInsertErrorCode =
  | "INVALID_ORDER_MIN_TICK_SIZE"
  | "INVALID_ORDER_MIN_SIZE"
  | "INVALID_ORDER_DUPLICATED"
  | "INVALID_ORDER_NOT_ENOUGH_BALANCE"
  | "INVALID_ORDER_EXPIRATION"
  | "INVALID_ORDER_ERROR"
  | "EXECUTION_ERROR"
  | "ORDER_DELAYED"
  | "DELAYING_ORDER_ERROR"
  | "FOK_ORDER_NOT_FILLED_ERROR"
  | "MARKET_NOT_READY"
  | "HTTP_ERROR"
  | "UNKNOWN";

export type CreateOrderResult = {
  /**
   * True means the order was accepted by the API (even if delayed/unmatched).
   * It does NOT guarantee onchain settlement succeeded.
   */
  success: boolean;
  orderId?: string;
  status?: ClobInsertStatus;
  errorCode?: ClobInsertErrorCode;
  errorMsg?: string;
  transactionHashes?: string[];
  /**
   * Raw API response for debugging (do not log in production).
   */
  raw?: unknown;
};

export type RedeemParams = {
  conditionId: string;
  outcomeIndex: number;
};

export type MergePositionsParams = {
  /**
   * bytes32 hex string (0x...).
   */
  conditionId: string;
  /**
   * uint256[] partition (index sets).
   */
  partition: bigint[];
  /**
   * uint256 amount (usually collateral amount in base units).
   */
  amount: bigint;
  /**
   * Optional overrides.
   */
  collateralToken?: HexAddress;
  parentCollectionId?: `0x${string}`;
  ctfAddress?: HexAddress;
};

export type UsdcTransferParams = {
  to: HexAddress;
  /**
   * Raw uint256 amount in token base units.
   * Example: parseUnits("100", 6) for 100 USDC.e.
   */
  amount: bigint;
  /**
   * Optional override for token address (defaults to USDC.e).
   */
  tokenAddress?: HexAddress;
};

export type SplitPositionParams = {
  /**
   * bytes32 hex string (0x...).
   */
  conditionId: string;
  /**
   * uint256[] partition (index sets).
   */
  partition: bigint[];
  /**
   * uint256 amount (usually collateral amount in base units).
   */
  amount: bigint;
  /**
   * Optional overrides.
   */
  collateralToken?: HexAddress;
  parentCollectionId?: `0x${string}`;
  ctfAddress?: HexAddress;
};

export type UsdcApproveParams = {
  spender: HexAddress;
  /**
   * Raw uint256 amount in token base units.
   * Default: max uint256.
   */
  amount?: bigint;
  /**
   * Optional override for token address (defaults to USDC.e).
   */
  tokenAddress?: HexAddress;
};

export type ApproveAndTransferUsdcParams = {
  spender: HexAddress;
  to: HexAddress;
  /**
   * Raw uint256 approve amount in token base units.
   * Default: max uint256.
   */
  approveAmount?: bigint;
  /**
   * Raw uint256 transfer amount in token base units.
   * Example: parseUnits("50", 6) for 50 USDC.e.
   */
  transferAmount: bigint;
  /**
   * Optional override for token address (defaults to USDC.e).
   */
  tokenAddress?: HexAddress;
};

export type CreateApprovalTxsResult = {
  txs: SafeTransaction[];
};
