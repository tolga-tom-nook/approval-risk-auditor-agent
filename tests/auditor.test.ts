import { describe, expect, it } from "vitest";
import {
  buildErc20RevokeTx,
  buildErc721ApprovalForAllRevokeTx,
  classifyApprovalRisk,
  normalizeChainKey,
  summarizeRisk,
} from "../src/auditor.js";

describe("approval risk classification", () => {
  it("flags unlimited ERC-20 approvals", () => {
    const risk = classifyApprovalRisk({
      standard: "erc20",
      allowance: (2n ** 256n - 1n).toString(),
      lastUpdatedAt: new Date().toISOString(),
      tokenSymbol: "USDC",
      spender: "0x1111111111111111111111111111111111111111",
    });

    expect(risk.flags).toContain("unlimited_allowance");
    expect(risk.severity).toBe("critical");
  });

  it("flags stale approvals older than the stale-day threshold", () => {
    const risk = classifyApprovalRisk(
      {
        standard: "erc20",
        allowance: "1000000000",
        lastUpdatedAt: "2023-01-01T00:00:00.000Z",
        tokenSymbol: "DAI",
        spender: "0x2222222222222222222222222222222222222222",
      },
      { now: new Date("2026-01-01T00:00:00.000Z"), staleDays: 365 },
    );

    expect(risk.flags).toContain("stale_approval");
    expect(risk.severity).toBe("high");
  });

  it("summarizes total approvals by severity", () => {
    const summary = summarizeRisk([
      { severity: "critical", flags: ["unlimited_allowance"] },
      { severity: "high", flags: ["stale_approval"] },
      { severity: "low", flags: [] },
    ]);

    expect(summary).toEqual({ total: 3, critical: 1, high: 1, medium: 0, low: 1 });
  });
});

describe("revoke transaction data", () => {
  it("encodes ERC-20 approve(spender, 0) calldata", () => {
    const tx = buildErc20RevokeTx({
      chainId: 1,
      tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      spender: "0x1111111111111111111111111111111111111111",
    });

    expect(tx.to).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    expect(tx.value).toBe("0");
    expect(tx.data).toBe("0x095ea7b300000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000000");
  });

  it("encodes ERC-721/ERC-1155 setApprovalForAll(spender, false) calldata", () => {
    const tx = buildErc721ApprovalForAllRevokeTx({
      chainId: 1,
      tokenAddress: "0x0000000000000000000000000000000000000003",
      spender: "0x2222222222222222222222222222222222222222",
    });

    expect(tx.to).toBe("0x0000000000000000000000000000000000000003");
    expect(tx.data).toBe("0xa22cb46500000000000000000000000022222222222222222222222222222222222222220000000000000000000000000000000000000000000000000000000000000000");
  });
});

describe("chain normalization", () => {
  it("accepts common chain names and ids", () => {
    expect(normalizeChainKey("ethereum")).toBe("ethereum");
    expect(normalizeChainKey("eth")).toBe("ethereum");
    expect(normalizeChainKey("1")).toBe("ethereum");
    expect(normalizeChainKey("base")).toBe("base");
    expect(normalizeChainKey("8453")).toBe("base");
  });
});
