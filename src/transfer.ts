import { encodeFunctionData, erc20Abi } from "viem";
import {
  OperationType,
  type SafeTransaction,
} from "@polymarket/builder-relayer-client";
import { USDC_E_CONTRACT_ADDRESS } from "./tokens.js";
import type { HexAddress, UsdcTransferParams } from "./types.js";

/**
 * Builds a SafeTransaction for ERC20 transfer of USDC.e (6 decimals).
 * Note: amount is a raw uint256 in token base units.
 */
export function createUsdcTransferTx(params: UsdcTransferParams): SafeTransaction {
  const tokenAddress = (params.tokenAddress ??
    USDC_E_CONTRACT_ADDRESS) as HexAddress;

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [params.to, params.amount],
  });

  return {
    to: tokenAddress,
    operation: OperationType.Call,
    data,
    value: "0",
  };
}


