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

export type CreateOrderRequest = {
  tokenId: string;
  size: number;
  price?: number;
  side: OrderSide;
  negRisk?: boolean;
  /**
   * If true, the kit will fetch an orderbook price and submit an aggressive limit order.
   */
  isMarketOrder?: boolean;
};

export type CreateOrderResult = {
  orderId: string;
};

export type RedeemParams = {
  conditionId: string;
  outcomeIndex: number;
};

export type CreateApprovalTxsResult = {
  txs: SafeTransaction[];
};
