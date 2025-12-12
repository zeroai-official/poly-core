import type { ClobInsertErrorCode } from "./types.js";

export function mapClobErrorMsgToCode(errorMsg: string | undefined | null): ClobInsertErrorCode | undefined {
  if (!errorMsg) return undefined;

  const msg = errorMsg.trim().toLowerCase();

  // Map by exact known phrases from Polymarket docs.
  if (msg.includes("price breaks minimum tick size")) return "INVALID_ORDER_MIN_TICK_SIZE";
  if (msg.includes("size lower than the minimum")) return "INVALID_ORDER_MIN_SIZE";
  if (msg.includes("duplicated")) return "INVALID_ORDER_DUPLICATED";
  if (msg.includes("not enough balance") || msg.includes("allowance")) return "INVALID_ORDER_NOT_ENOUGH_BALANCE";
  if (msg.includes("invalid expiration")) return "INVALID_ORDER_EXPIRATION";
  if (msg.includes("could not insert order")) return "INVALID_ORDER_ERROR";
  if (msg.includes("could not run the execution")) return "EXECUTION_ERROR";
  if (msg.includes("order match delayed")) return "ORDER_DELAYED";
  if (msg.includes("error delaying")) return "DELAYING_ORDER_ERROR";
  if (msg.includes("fok orders") || msg.includes("not fully filled")) return "FOK_ORDER_NOT_FILLED_ERROR";
  if (msg.includes("market is not yet ready")) return "MARKET_NOT_READY";

  return "UNKNOWN";
}
