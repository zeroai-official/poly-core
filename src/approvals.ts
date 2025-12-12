import { createPublicClient, encodeFunctionData, erc20Abi, http } from "viem";
import { polygon } from "viem/chains";
import {
  OperationType,
  type SafeTransaction,
} from "@polymarket/builder-relayer-client";

import {
  CTF_CONTRACT_ADDRESS,
  CTF_EXCHANGE_ADDRESS,
  NEG_RISK_ADAPTER_ADDRESS,
  NEG_RISK_CTF_EXCHANGE_ADDRESS,
  USDC_E_CONTRACT_ADDRESS,
} from "./tokens";
import { DEFAULT_USDC_APPROVAL_THRESHOLD, MAX_UINT256 } from "./constants";
import type {
  ApprovalStatus,
  CreateApprovalTxsResult,
  HexAddress,
} from "./types";

const erc1155Abi = [
  {
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    name: "setApprovalForAll",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    name: "isApprovedForAll",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const USDC_E_SPENDERS = [
  { address: CTF_CONTRACT_ADDRESS, name: "CTF Contract" },
  { address: NEG_RISK_ADAPTER_ADDRESS, name: "Neg Risk Adapter" },
  { address: CTF_EXCHANGE_ADDRESS, name: "CTF Exchange" },
  { address: NEG_RISK_CTF_EXCHANGE_ADDRESS, name: "Neg Risk CTF Exchange" },
] as const;

const OUTCOME_TOKEN_SPENDERS = [
  { address: CTF_EXCHANGE_ADDRESS, name: "CTF Exchange" },
  { address: NEG_RISK_CTF_EXCHANGE_ADDRESS, name: "Neg Risk Exchange" },
  { address: NEG_RISK_ADAPTER_ADDRESS, name: "Neg Risk Adapter" },
] as const;

export function createAllApprovalTxs(): CreateApprovalTxsResult {
  const txs: SafeTransaction[] = [];

  for (const { address } of USDC_E_SPENDERS) {
    txs.push({
      to: USDC_E_CONTRACT_ADDRESS,
      operation: OperationType.Call,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [address as HexAddress, BigInt(MAX_UINT256)],
      }),
      value: "0",
    });
  }

  for (const { address } of OUTCOME_TOKEN_SPENDERS) {
    txs.push({
      to: CTF_CONTRACT_ADDRESS,
      operation: OperationType.Call,
      data: encodeFunctionData({
        abi: erc1155Abi,
        functionName: "setApprovalForAll",
        args: [address as HexAddress, true],
      }),
      value: "0",
    });
  }

  return { txs };
}

export async function checkAllApprovals(params: {
  rpcUrl: string;
  safeAddress: HexAddress;
  threshold?: bigint;
}): Promise<ApprovalStatus> {
  const publicClient = createPublicClient({
    chain: polygon,
    transport: http(params.rpcUrl),
  });

  const threshold = params.threshold ?? DEFAULT_USDC_APPROVAL_THRESHOLD;

  const usdcApprovals: Record<string, boolean> = {};
  const outcomeTokenApprovals: Record<string, boolean> = {};

  await Promise.all(
    USDC_E_SPENDERS.map(async ({ address, name }) => {
      try {
        const allowance = await publicClient.readContract({
          address: USDC_E_CONTRACT_ADDRESS,
          abi: erc20Abi,
          functionName: "allowance",
          args: [params.safeAddress, address as HexAddress],
        });
        usdcApprovals[name] = allowance >= threshold;
      } catch {
        usdcApprovals[name] = false;
      }
    })
  );

  await Promise.all(
    OUTCOME_TOKEN_SPENDERS.map(async ({ address, name }) => {
      try {
        const isApproved = await publicClient.readContract({
          address: CTF_CONTRACT_ADDRESS,
          abi: erc1155Abi,
          functionName: "isApprovedForAll",
          args: [params.safeAddress, address as HexAddress],
        });
        outcomeTokenApprovals[name] = isApproved;
      } catch {
        outcomeTokenApprovals[name] = false;
      }
    })
  );

  const allApproved =
    Object.values(usdcApprovals).every(Boolean) &&
    Object.values(outcomeTokenApprovals).every(Boolean);

  return { allApproved, usdcApprovals, outcomeTokenApprovals };
}
