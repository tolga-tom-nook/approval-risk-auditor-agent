import { createPublicClient, decodeEventLog, encodeEventTopics, getAddress, http, isAddress, type Address, type Hex, type Log } from "viem";
import { arbitrum, avalanche, base, bsc, fantom, gnosis, mainnet, optimism, polygon } from "viem/chains";
import {
  buildErc20RevokeTx,
  buildErc721ApprovalForAllRevokeTx,
  classifyApprovalRisk,
  normalizeChainKey,
  summarizeRisk,
  type ApprovalStandard,
  type RevokeTxData,
  type RiskClassification,
  type SupportedChainKey,
} from "./auditor.js";

const approvalForAllEvent = {
  type: "event",
  name: "ApprovalForAll",
  inputs: [
    { indexed: true, name: "owner", type: "address" },
    { indexed: true, name: "operator", type: "address" },
    { indexed: false, name: "approved", type: "bool" },
  ],
} as const;

const erc20ApprovalEvent = {
  type: "event",
  name: "Approval",
  inputs: [
    { indexed: true, name: "owner", type: "address" },
    { indexed: true, name: "spender", type: "address" },
    { indexed: false, name: "value", type: "uint256" },
  ],
} as const;

const erc20AllowanceAbi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

export interface TrackedToken {
  address: string;
  symbol: string;
  decimals: number;
  standard: ApprovalStandard;
}

export interface ChainConfig {
  key: SupportedChainKey;
  chainId: number;
  fromBlock: bigint;
  rpcUrl?: string | undefined;
  trackedTokens: TrackedToken[];
}

export interface ApprovalLog {
  tokenAddress: string;
  spender: string;
  blockNumber: bigint;
  transactionHash: string;
}

export interface RpcClient {
  getApprovalLogs(token: TrackedToken, wallet: Address, fromBlock: bigint, toBlock?: bigint): Promise<ApprovalLog[]>;
  getNftApprovalForAllLogs?(wallet: Address, fromBlock: bigint, toBlock?: bigint): Promise<ApprovalLog[]>;
  getAllowance(token: TrackedToken, wallet: Address, spender: Address): Promise<bigint>;
  getBlockTimestamp(blockNumber: bigint): Promise<Date>;
  hasCode?(address: Address): Promise<boolean>;
}

export interface AuditedApproval {
  chain: SupportedChainKey;
  chainId: number;
  tokenAddress: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  standard: ApprovalStandard;
  wallet: Address;
  spender: Address;
  allowance: string;
  lastUpdatedAt: string;
  sourceTransactionHash: string;
  risk: RiskClassification;
  revokeTx: RevokeTxData;
}

export interface AuditResult {
  wallet: Address;
  generated_at: string;
  approvals: AuditedApproval[];
  risk_flags: {
    summary: ReturnType<typeof summarizeRisk>;
    by_approval: Array<{ tokenAddress: Address; spender: Address; flags: string[]; severity: string; reasons: string[] }>;
  };
  revoke_tx_data: RevokeTxData[];
  methodology: string[];
}

export interface AuditOptions {
  wallet: string;
  chains: ChainConfig[];
  rpcFactory?: (chain: ChainConfig) => RpcClient;
  now?: Date;
  staleDays?: number;
}


const KNOWN_PROTOCOL_SPENDERS = new Set<string>([
  // Permit2, routers, exchanges and NFT marketplaces commonly seen in approval history.
  "0x000000000022d473030f116ddee9f6b43ac78ba3", // Uniswap Permit2
  "0x1111111254eeb25477b68fb85ed929f73a960582", // 1inch router
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x exchange proxy
  "0x00000000006c3852cbef3e08e8df289169ede581", // Seaport 1.1
  "0x00000000000001ad428e4906ae43d8f9852d0dd6", // Seaport conduit controller
].map((addr) => addr.toLowerCase()));

function isKnownSpender(address: Address): boolean {
  return KNOWN_PROTOCOL_SPENDERS.has(address.toLowerCase());
}

export function getDefaultChains(): ChainConfig[] {
  return [
    {
      key: "ethereum",
      chainId: 1,
      fromBlock: 19_000_000n,
      rpcUrl: process.env.ETHEREUM_RPC_URL,
      trackedTokens: [
        { symbol: "USDC", decimals: 6, standard: "erc20", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
        { symbol: "USDT", decimals: 6, standard: "erc20", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
        { symbol: "DAI", decimals: 18, standard: "erc20", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" },
        { symbol: "WETH", decimals: 18, standard: "erc20", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
      ],
    },
    {
      key: "base",
      chainId: 8453,
      fromBlock: 10_000_000n,
      rpcUrl: process.env.BASE_RPC_URL,
      trackedTokens: [
        { symbol: "USDC", decimals: 6, standard: "erc20", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
        { symbol: "WETH", decimals: 18, standard: "erc20", address: "0x4200000000000000000000000000000000000006" },
      ],
    },
    {
      key: "polygon",
      chainId: 137,
      fromBlock: 50_000_000n,
      rpcUrl: process.env.POLYGON_RPC_URL,
      trackedTokens: [
        { symbol: "USDC.e", decimals: 6, standard: "erc20", address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" },
        { symbol: "USDT", decimals: 6, standard: "erc20", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
      ],
    },
    {
      key: "arbitrum",
      chainId: 42161,
      fromBlock: 160_000_000n,
      rpcUrl: process.env.ARBITRUM_RPC_URL,
      trackedTokens: [
        { symbol: "USDC", decimals: 6, standard: "erc20", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
        { symbol: "WETH", decimals: 18, standard: "erc20", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" },
      ],
    },
    {
      key: "optimism",
      chainId: 10,
      fromBlock: 115_000_000n,
      rpcUrl: process.env.OPTIMISM_RPC_URL,
      trackedTokens: [
        { symbol: "USDC", decimals: 6, standard: "erc20", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
        { symbol: "WETH", decimals: 18, standard: "erc20", address: "0x4200000000000000000000000000000000000006" },
      ],
    },
    {
      key: "bsc",
      chainId: 56,
      fromBlock: 35_000_000n,
      rpcUrl: process.env.BSC_RPC_URL,
      trackedTokens: [
        { symbol: "USDT", decimals: 18, standard: "erc20", address: "0x55d398326f99059fF775485246999027B3197955" },
        { symbol: "USDC", decimals: 18, standard: "erc20", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
        { symbol: "WBNB", decimals: 18, standard: "erc20", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" },
      ],
    },
    {
      key: "avalanche",
      chainId: 43114,
      fromBlock: 40_000_000n,
      rpcUrl: process.env.AVALANCHE_RPC_URL,
      trackedTokens: [
        { symbol: "USDC", decimals: 6, standard: "erc20", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
        { symbol: "WAVAX", decimals: 18, standard: "erc20", address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7" },
      ],
    },
    {
      key: "fantom",
      chainId: 250,
      fromBlock: 70_000_000n,
      rpcUrl: process.env.FANTOM_RPC_URL,
      trackedTokens: [
        { symbol: "USDC", decimals: 6, standard: "erc20", address: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75" },
        { symbol: "WFTM", decimals: 18, standard: "erc20", address: "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83" },
      ],
    },
    {
      key: "gnosis",
      chainId: 100,
      fromBlock: 32_000_000n,
      rpcUrl: process.env.GNOSIS_RPC_URL,
      trackedTokens: [
        { symbol: "WXDAI", decimals: 18, standard: "erc20", address: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d" },
        { symbol: "USDC", decimals: 6, standard: "erc20", address: "0xddafbb505ad214d7b80b1f830fccc89b60fb7a83" },
      ],
    },
  ];
}

function viemChainFor(key: SupportedChainKey) {
  return { ethereum: mainnet, base, polygon, arbitrum, optimism, bsc, avalanche, fantom, gnosis }[key];
}

export function chainsFromInput(chains: Array<string | number> | undefined): ChainConfig[] {
  const defaults = getDefaultChains();
  if (!chains?.length) return defaults;
  const wanted = new Set(chains.map(normalizeChainKey));
  return defaults.filter((chain) => wanted.has(chain.key));
}

export function createViemRpcClient(chain: ChainConfig): RpcClient {
  const publicClient = createPublicClient({
    chain: viemChainFor(chain.key),
    transport: http(chain.rpcUrl),
  });

  return {
    async getApprovalLogs(token, wallet, fromBlock, toBlock) {
      const logs = await publicClient.getLogs({
        address: getAddress(token.address),
        event: erc20ApprovalEvent,
        args: { owner: wallet },
        fromBlock,
        toBlock,
      });
      return logs.flatMap((log: Log) => {
        try {
          const decoded = decodeEventLog({ abi: [erc20ApprovalEvent], data: log.data, topics: log.topics });
          const spender = String((decoded.args as { spender?: string }).spender ?? "");
          if (!isAddress(spender) || !log.blockNumber || !log.transactionHash) return [];
          return [{ tokenAddress: token.address, spender, blockNumber: log.blockNumber, transactionHash: log.transactionHash }];
        } catch {
          return [];
        }
      });
    },
    async getNftApprovalForAllLogs(wallet, fromBlock, toBlock) {
      const logs = await publicClient.getLogs({
        event: approvalForAllEvent,
        args: { owner: wallet },
        fromBlock,
        toBlock,
      });
      return logs.flatMap((log: Log) => {
        try {
          const decoded = decodeEventLog({ abi: [approvalForAllEvent], data: log.data, topics: log.topics });
          const args = decoded.args as { operator?: string; approved?: boolean };
          const operator = String(args.operator ?? "");
          if (!args.approved || !isAddress(operator) || !log.address || !log.blockNumber || !log.transactionHash) return [];
          return [{ tokenAddress: log.address, spender: operator, blockNumber: log.blockNumber, transactionHash: log.transactionHash }];
        } catch {
          return [];
        }
      });
    },
    async getAllowance(token, wallet, spender) {
      const allowance = await publicClient.readContract({
        address: getAddress(token.address),
        abi: erc20AllowanceAbi,
        functionName: "allowance",
        args: [wallet, spender],
      });
      return allowance;
    },
    async getBlockTimestamp(blockNumber) {
      const block = await publicClient.getBlock({ blockNumber });
      return new Date(Number(block.timestamp) * 1000);
    },
    async hasCode(address) {
      const code = await publicClient.getCode({ address });
      return Boolean(code && code !== "0x");
    },
  };
}


const EXPLORER_APIS: Partial<Record<SupportedChainKey, { baseUrl: string; apiKeyEnv: string }>> = {
  ethereum: { baseUrl: "https://api.etherscan.io/api", apiKeyEnv: "ETHERSCAN_API_KEY" },
  base: { baseUrl: "https://api.basescan.org/api", apiKeyEnv: "BASESCAN_API_KEY" },
  polygon: { baseUrl: "https://api.polygonscan.com/api", apiKeyEnv: "POLYGONSCAN_API_KEY" },
  arbitrum: { baseUrl: "https://api.arbiscan.io/api", apiKeyEnv: "ARBISCAN_API_KEY" },
  optimism: { baseUrl: "https://api-optimistic.etherscan.io/api", apiKeyEnv: "OPTIMISTIC_ETHERSCAN_API_KEY" },
  bsc: { baseUrl: "https://api.bscscan.com/api", apiKeyEnv: "BSCSCAN_API_KEY" },
  avalanche: { baseUrl: "https://api.snowtrace.io/api", apiKeyEnv: "SNOWTRACE_API_KEY" },
  fantom: { baseUrl: "https://api.ftmscan.com/api", apiKeyEnv: "FTMSCAN_API_KEY" },
  gnosis: { baseUrl: "https://api.gnosisscan.io/api", apiKeyEnv: "GNOSISSCAN_API_KEY" },
};

const APPROVAL_TOPIC0 = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
const APPROVAL_FOR_ALL_TOPIC0 = "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31";

function topicAddress(address: Address): Hex {
  return `0x000000000000000000000000${address.slice(2).toLowerCase()}` as Hex;
}

function addressFromTopic(topic: string): Address | undefined {
  const value = `0x${topic.slice(-40)}`;
  return isAddress(value) ? getAddress(value) : undefined;
}

function explorerConfig(chain: ChainConfig): { baseUrl: string; apiKey?: string } | undefined {
  const cfg = EXPLORER_APIS[chain.key];
  if (!cfg) return undefined;
  const apiKey = process.env[cfg.apiKeyEnv] || process.env.ETHERSCAN_API_KEY;
  return { baseUrl: cfg.baseUrl, ...(apiKey ? { apiKey } : {}) };
}

async function fetchExplorerLogs(chain: ChainConfig, topic0: string, owner: Address, address?: string): Promise<ApprovalLog[]> {
  const cfg = explorerConfig(chain);
  if (!cfg) return [];
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    fromBlock: chain.fromBlock.toString(),
    toBlock: "latest",
    topic0,
    topic1: topicAddress(owner),
    topic0_1_opr: "and",
  });
  if (address) params.set("address", getAddress(address));
  if (cfg.apiKey) params.set("apikey", cfg.apiKey);
  const res = await fetch(`${cfg.baseUrl}?${params.toString()}`);
  const payload = (await res.json().catch(() => ({}))) as { status?: string; result?: unknown };
  if (!Array.isArray(payload.result)) return [];
  return payload.result.flatMap((raw): ApprovalLog[] => {
    const log = raw as Record<string, string>;
    const topics = Array.isArray((raw as { topics?: unknown }).topics) ? ((raw as { topics: string[] }).topics) : [];
    const spender = addressFromTopic(topics[2] ?? "");
    const tokenAddress = typeof log.address === "string" && isAddress(log.address) ? getAddress(log.address) : undefined;
    const blockNumber = typeof log.blockNumber === "string" ? BigInt(log.blockNumber) : undefined;
    const transactionHash = typeof log.transactionHash === "string" ? log.transactionHash : undefined;
    if (!spender || !tokenAddress || blockNumber === undefined || !transactionHash) return [];
    return [{ tokenAddress, spender, blockNumber, transactionHash }];
  });
}

export async function auditWalletApprovals(options: AuditOptions): Promise<AuditResult> {
  if (!isAddress(options.wallet)) throw new Error(`Invalid wallet: ${options.wallet}`);
  const wallet = getAddress(options.wallet);
  const now = options.now ?? new Date();
  const approvals: AuditedApproval[] = [];

  for (const chain of options.chains) {
    const rpc = options.rpcFactory ? options.rpcFactory(chain) : createViemRpcClient(chain);
    for (const token of chain.trackedTokens.filter((t) => t.standard === "erc20")) {
      const seenSpenders = new Set<string>();
      const rpcLogs = await rpc.getApprovalLogs(token, wallet, chain.fromBlock);
      const explorerLogs = await fetchExplorerLogs(chain, APPROVAL_TOPIC0, wallet, token.address).catch(() => []);
      const logs = [...rpcLogs, ...explorerLogs];
      for (const log of logs.sort((a, b) => Number(b.blockNumber - a.blockNumber))) {
        if (!isAddress(log.spender)) continue;
        const spender = getAddress(log.spender);
        if (seenSpenders.has(spender)) continue;
        seenSpenders.add(spender);
        const allowance = await rpc.getAllowance(token, wallet, spender);
        if (allowance === 0n) continue;
        const lastUpdatedAt = (await rpc.getBlockTimestamp(log.blockNumber)).toISOString();
        const riskOptions: { now: Date; staleDays?: number } = { now };
        if (options.staleDays !== undefined) riskOptions.staleDays = options.staleDays;
        const risk = classifyApprovalRisk(
          { standard: token.standard, allowance: allowance.toString(), lastUpdatedAt, tokenSymbol: token.symbol, spender, spenderHasCode: rpc.hasCode ? await rpc.hasCode(spender).catch(() => undefined) : undefined, knownSpender: isKnownSpender(spender) },
          riskOptions,
        );
        const revokeTx = buildErc20RevokeTx({ chainId: chain.chainId, tokenAddress: token.address, spender });
        approvals.push({
          chain: chain.key,
          chainId: chain.chainId,
          tokenAddress: getAddress(token.address),
          tokenSymbol: token.symbol,
          tokenDecimals: token.decimals,
          standard: token.standard,
          wallet,
          spender,
          allowance: allowance.toString(),
          lastUpdatedAt,
          sourceTransactionHash: log.transactionHash,
          risk,
          revokeTx,
        });
      }
    }

    const nftRpcLogs = rpc.getNftApprovalForAllLogs ? await rpc.getNftApprovalForAllLogs(wallet, chain.fromBlock).catch(() => []) : [];
    const nftExplorerLogs = await fetchExplorerLogs(chain, APPROVAL_FOR_ALL_TOPIC0, wallet).catch(() => []);
    const nftLogs = [...nftRpcLogs, ...nftExplorerLogs];
    const seenNftOperators = new Set<string>();
    for (const log of nftLogs.sort((a, b) => Number(b.blockNumber - a.blockNumber))) {
      if (!isAddress(log.spender) || !isAddress(log.tokenAddress)) continue;
      const tokenAddress = getAddress(log.tokenAddress);
      const spender = getAddress(log.spender);
      const key = `${tokenAddress}:${spender}`;
      if (seenNftOperators.has(key)) continue;
      seenNftOperators.add(key);
      const lastUpdatedAt = (await rpc.getBlockTimestamp(log.blockNumber)).toISOString();
      const riskOptions: { now: Date; staleDays?: number } = { now };
      if (options.staleDays !== undefined) riskOptions.staleDays = options.staleDays;
      const risk = classifyApprovalRisk({ standard: "erc721_approval_for_all", approved: true, lastUpdatedAt, tokenSymbol: "NFT", spender, spenderHasCode: rpc.hasCode ? await rpc.hasCode(spender).catch(() => undefined) : undefined, knownSpender: isKnownSpender(spender) }, riskOptions);
      const revokeTx = buildErc721ApprovalForAllRevokeTx({ chainId: chain.chainId, tokenAddress, spender });
      approvals.push({
        chain: chain.key,
        chainId: chain.chainId,
        tokenAddress,
        tokenSymbol: "NFT collection",
        tokenDecimals: 0,
        standard: "erc721_approval_for_all",
        wallet,
        spender,
        allowance: "approval_for_all",
        lastUpdatedAt,
        sourceTransactionHash: log.transactionHash,
        risk,
        revokeTx,
      });
    }
  }

  return {
    wallet,
    generated_at: now.toISOString(),
    approvals,
    risk_flags: {
      summary: summarizeRisk(approvals.map((approval) => approval.risk)),
      by_approval: approvals.map((approval) => ({
        tokenAddress: approval.tokenAddress,
        spender: approval.spender,
        flags: approval.risk.flags,
        severity: approval.risk.severity,
        reasons: approval.risk.reasons,
      })),
    },
    revoke_tx_data: approvals.map((approval) => approval.revokeTx),
    methodology: [
      "Scans Approval(owner, spender, value) logs for a curated top-token list per chain using RPC and Etherscan-compatible explorer fallback when configured.",
      "Reads current allowance(owner, spender) before reporting, so stale event history with zero current allowance is ignored.",
      "Flags effectively unlimited allowances and approvals older than the configured stale-day threshold.",
      "Scans NFT ApprovalForAll(owner, operator, approved) events where RPC/explorer access supports contract-wide log queries.",
      "Classifies unknown EOAs/contracts as higher-risk spenders when bytecode checks are available.",
      "Builds safe revoke calldata using approve(spender, 0) for ERC-20 approvals and setApprovalForAll(operator, false) for NFT operator approvals.",
    ],
  };
}
