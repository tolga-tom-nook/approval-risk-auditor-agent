import { encodeFunctionData, getAddress, isAddress, type Hex } from "viem";

export type SupportedChainKey = "ethereum" | "base" | "polygon" | "arbitrum" | "optimism";
export type ApprovalStandard = "erc20" | "erc721" | "erc721_approval_for_all" | "erc1155_approval_for_all";
export type RiskSeverity = "critical" | "high" | "medium" | "low";

export interface ApprovalForRisk {
  standard: ApprovalStandard;
  allowance?: string;
  approved?: boolean;
  lastUpdatedAt?: string;
  tokenSymbol?: string;
  spender: string;
}

export interface RiskClassification {
  severity: RiskSeverity;
  flags: string[];
  reasons: string[];
}

export interface RiskSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface RevokeTxInput {
  chainId: number;
  tokenAddress: string;
  spender: string;
}

export interface RevokeTxData {
  chainId: number;
  to: Hex;
  data: Hex;
  value: "0";
  description: string;
}

const UINT256_MAX = 2n ** 256n - 1n;
const UNLIMITED_THRESHOLD = UINT256_MAX / 2n;

export function normalizeChainKey(chain: string | number): SupportedChainKey {
  const key = String(chain).trim().toLowerCase();
  const aliases: Record<string, SupportedChainKey> = {
    "1": "ethereum",
    eth: "ethereum",
    ethereum: "ethereum",
    mainnet: "ethereum",
    "8453": "base",
    base: "base",
    "137": "polygon",
    polygon: "polygon",
    matic: "polygon",
    "42161": "arbitrum",
    arbitrum: "arbitrum",
    arb: "arbitrum",
    "10": "optimism",
    optimism: "optimism",
    op: "optimism",
  };
  const normalized = aliases[key];
  if (!normalized) {
    throw new Error(`Unsupported chain: ${chain}`);
  }
  return normalized;
}

export function classifyApprovalRisk(
  approval: ApprovalForRisk,
  options: { now?: Date; staleDays?: number } = {},
): RiskClassification {
  const now = options.now ?? new Date();
  const staleDays = options.staleDays ?? 180;
  const flags: string[] = [];
  const reasons: string[] = [];

  if (approval.standard === "erc20" && approval.allowance != null) {
    const allowance = BigInt(approval.allowance);
    if (allowance >= UNLIMITED_THRESHOLD) {
      flags.push("unlimited_allowance");
      reasons.push("ERC-20 allowance is effectively unlimited.");
    } else if (allowance > 0n) {
      flags.push("nonzero_allowance");
      reasons.push("ERC-20 allowance is non-zero.");
    }
  }

  if ((approval.standard === "erc721_approval_for_all" || approval.standard === "erc1155_approval_for_all") && approval.approved) {
    flags.push("operator_approval_for_all");
    reasons.push("NFT operator can transfer every token in this collection.");
  }

  if (approval.lastUpdatedAt) {
    const ageMs = now.getTime() - new Date(approval.lastUpdatedAt).getTime();
    const ageDays = ageMs / 86_400_000;
    if (ageDays >= staleDays) {
      flags.push("stale_approval");
      reasons.push(`Approval is older than ${staleDays} days.`);
    }
  }

  let severity: RiskSeverity = "low";
  if (flags.includes("unlimited_allowance") || flags.includes("operator_approval_for_all")) {
    severity = "critical";
  } else if (flags.includes("stale_approval")) {
    severity = "high";
  } else if (flags.includes("nonzero_allowance")) {
    severity = "medium";
  }

  return { severity, flags, reasons };
}

export function summarizeRisk(items: Array<Pick<RiskClassification, "severity" | "flags">>): RiskSummary {
  const summary: RiskSummary = { total: items.length, critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of items) {
    summary[item.severity] += 1;
  }
  return summary;
}

function validateAddress(address: string, label: string): Hex {
  if (!isAddress(address)) {
    throw new Error(`Invalid ${label}: ${address}`);
  }
  return getAddress(address) as Hex;
}

export function buildErc20RevokeTx(input: RevokeTxInput): RevokeTxData {
  const to = validateAddress(input.tokenAddress, "token address");
  const spender = validateAddress(input.spender, "spender");
  return {
    chainId: input.chainId,
    to,
    value: "0",
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "approve",
          stateMutability: "nonpayable",
          inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
          ],
          outputs: [{ type: "bool" }],
        },
      ],
      functionName: "approve",
      args: [spender, 0n],
    }),
    description: "Revoke ERC-20 allowance by approving 0 for the spender.",
  };
}

export function buildErc721ApprovalForAllRevokeTx(input: RevokeTxInput): RevokeTxData {
  const to = validateAddress(input.tokenAddress, "token address");
  const spender = validateAddress(input.spender, "spender");
  return {
    chainId: input.chainId,
    to,
    value: "0",
    data: encodeFunctionData({
      abi: [
        {
          type: "function",
          name: "setApprovalForAll",
          stateMutability: "nonpayable",
          inputs: [
            { name: "operator", type: "address" },
            { name: "approved", type: "bool" },
          ],
          outputs: [],
        },
      ],
      functionName: "setApprovalForAll",
      args: [spender, false],
    }),
    description: "Revoke NFT operator approval by setting approvalForAll to false.",
  };
}
