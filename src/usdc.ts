import { encodeFunctionData, erc20Abi } from "viem";
import {
  OperationType,
  type SafeTransaction,
} from "@polymarket/builder-relayer-client";
import { MAX_UINT256 } from "./constants.js";
import { USDC_E_CONTRACT_ADDRESS } from "./tokens.js";
import type {
  ApproveAndTransferUsdcParams,
  HexAddress,
  UsdcApproveParams,
} from "./types.js";
import { createUsdcTransferTx } from "./transfer.js";

/**
 * Builds a SafeTransaction for ERC20 approve on USDC.e.
 * Note: amount is a raw uint256 in token base units.
 */
export function createUsdcApproveTx(params: UsdcApproveParams): SafeTransaction {
  const tokenAddress = (params.tokenAddress ??
    USDC_E_CONTRACT_ADDRESS) as HexAddress;

  const amount = params.amount ?? BigInt(MAX_UINT256);

  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [params.spender, amount],
  });

  return {
    to: tokenAddress,
    operation: OperationType.Call,
    data,
    value: "0",
  };
}

/**
 * Builds 2 SafeTransactions: approve USDC.e then transfer USDC.e.
 */
export function createApproveAndTransferUsdcTxs(
  params: ApproveAndTransferUsdcParams
): SafeTransaction[] {
  const approveArgs: UsdcApproveParams = {
    spender: params.spender,
    ...(params.approveAmount !== undefined ? { amount: params.approveAmount } : {}),
    ...(params.tokenAddress !== undefined ? { tokenAddress: params.tokenAddress } : {}),
  };
  const approveTx = createUsdcApproveTx(approveArgs);

  const transferArgs = {
    to: params.to,
    amount: params.transferAmount,
    ...(params.tokenAddress !== undefined ? { tokenAddress: params.tokenAddress } : {}),
  };
  const transferTx = createUsdcTransferTx(transferArgs);

  return [approveTx, transferTx];
}


