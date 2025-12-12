import { encodeFunctionData } from "viem";
import {
  OperationType,
  type SafeTransaction,
} from "@polymarket/builder-relayer-client";
import { CTF_CONTRACT_ADDRESS, USDC_E_CONTRACT_ADDRESS } from "./tokens";
import type { RedeemParams } from "./types";

const ctfAbi = [
  {
    inputs: [
      { name: "collateralToken", type: "address" },
      { name: "parentCollectionId", type: "bytes32" },
      { name: "conditionId", type: "bytes32" },
      { name: "indexSets", type: "uint256[]" },
    ],
    name: "redeemPositions",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export function createRedeemTx(params: RedeemParams): SafeTransaction {
  const parentCollectionId = ("0x" + "0".repeat(64)) as `0x${string}`;
  const indexSet = BigInt(1 << params.outcomeIndex);

  const data = encodeFunctionData({
    abi: ctfAbi,
    functionName: "redeemPositions",
    args: [
      USDC_E_CONTRACT_ADDRESS,
      parentCollectionId,
      params.conditionId as `0x${string}`,
      [indexSet],
    ],
  });

  return {
    to: CTF_CONTRACT_ADDRESS,
    operation: OperationType.Call,
    data,
    value: "0",
  };
}
