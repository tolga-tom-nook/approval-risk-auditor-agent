import { describe, expect, it } from "vitest";
import { auditWalletApprovals } from "../src/scanner.js";
import type { ChainConfig, RpcClient } from "../src/scanner.js";

const wallet = "0x1234567890123456789012345678901234567890";
const spender = "0x1111111111111111111111111111111111111111";
const token = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

function makeMockRpc(): RpcClient {
  return {
    async getApprovalLogs() {
      return [
        {
          tokenAddress: token,
          spender,
          blockNumber: 100n,
          transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ];
    },
    async getAllowance() {
      return 2n ** 256n - 1n;
    },
    async getBlockTimestamp() {
      return new Date("2024-01-01T00:00:00.000Z");
    },
  };
}

const chain: ChainConfig = {
  key: "ethereum",
  chainId: 1,
  fromBlock: 1n,
  trackedTokens: [{ address: token, symbol: "USDC", decimals: 6, standard: "erc20" }],
};

describe("auditWalletApprovals", () => {
  it("discovers current risky ERC-20 approvals and returns revoke tx data", async () => {
    const result = await auditWalletApprovals({
      wallet,
      chains: [chain],
      rpcFactory: () => makeMockRpc(),
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]).toMatchObject({
      chain: "ethereum",
      chainId: 1,
      tokenSymbol: "USDC",
      tokenAddress: token,
      spender,
      standard: "erc20",
      risk: { severity: "critical" },
    });
    expect(result.risk_flags.summary).toEqual({ total: 1, critical: 1, high: 0, medium: 0, low: 0 });
    expect(result.revoke_tx_data).toHaveLength(1);
    expect(result.revoke_tx_data[0]?.data.startsWith("0x095ea7b3")).toBe(true);
  });

  it("drops approvals whose current allowance is zero", async () => {
    const rpc = makeMockRpc();
    rpc.getAllowance = async () => 0n;

    const result = await auditWalletApprovals({ wallet, chains: [chain], rpcFactory: () => rpc });

    expect(result.approvals).toEqual([]);
    expect(result.revoke_tx_data).toEqual([]);
  });
});
