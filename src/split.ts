import { encodeFunctionData } from "viem";
import {
  OperationType,
  type SafeTransaction,
} from "@polymarket/builder-relayer-client";
import { CTF_CONTRACT_ADDRESS, USDC_E_CONTRACT_ADDRESS } from "./tokens.js";
import type { HexAddress, SplitPositionParams } from "./types.js";

const ctfAbi = [
  {
    name: "splitPosition",
    type: "function",
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "partition", type: "uint256[]" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/**
 * Builds a SafeTransaction for CTF splitPosition.
 * Note: amount is a raw uint256 (usually collateral amount in token base units).
 */
export function createSplitPositionTx(params: SplitPositionParams): SafeTransaction {
  const parentCollectionId =
    (params.parentCollectionId ?? ("0x" + "0".repeat(64))) as `0x${string}`;

  const collateralToken = (params.collateralToken ??
    USDC_E_CONTRACT_ADDRESS) as HexAddress;
  const ctfAddress = (params.ctfAddress ?? CTF_CONTRACT_ADDRESS) as HexAddress;

  const data = encodeFunctionData({
    abi: ctfAbi,
    functionName: "splitPosition",
    args: [
      collateralToken,
      parentCollectionId,
      params.conditionId as `0x${string}`,
      params.partition,
      params.amount,
    ],
  });

  return {
    to: ctfAddress,
    operation: OperationType.Call,
    data,
    value: "0",
  };
}


