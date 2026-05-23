import { describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";
import type { AuditResult } from "../src/scanner.js";

const sampleResult: AuditResult = {
  wallet: "0x1234567890123456789012345678901234567890",
  generated_at: "2026-01-01T00:00:00.000Z",
  approvals: [],
  risk_flags: { summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }, by_approval: [] },
  revoke_tx_data: [],
  methodology: ["test"],
};

describe("HTTP service", () => {
  it("serves health metadata", async () => {
    const app = createServer({ audit: vi.fn() });
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, name: "approval-risk-auditor-agent" });
  });

  it("validates audit payloads", async () => {
    const app = createServer({ audit: vi.fn() });
    const res = await app.request("/audit", { method: "POST", body: JSON.stringify({ wallet: "not-an-address" }) });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_request" });
  });

  it("runs audits and returns x402-compatible payment metadata when configured", async () => {
    const audit = vi.fn(async () => sampleResult);
    const app = createServer({ audit, paymentAddress: "0x9999999999999999999999999999999999999999", priceUsd: "0.01" });
    const res = await app.request("/audit", {
      method: "POST",
      body: JSON.stringify({ wallet: sampleResult.wallet, chains: ["ethereum"] }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith({ wallet: sampleResult.wallet, chains: ["ethereum"] });
    expect(await res.json()).toMatchObject({
      result: sampleResult,
      x402: { accepts: [{ scheme: "exact", network: "base", payTo: "0x9999999999999999999999999999999999999999", asset: "USDC", priceUsd: "0.01" }] },
    });
  });
});
