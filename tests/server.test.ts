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

const paymentAddress = "0x9999999999999999999999999999999999999999";

describe("HTTP service", () => {
  it("serves health metadata", async () => {
    const app = createServer({ audit: vi.fn() });
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({ ok: true, name: "approval-risk-auditor-agent" });
  });

  it("serves agent discovery metadata", async () => {
    const app = createServer({ audit: vi.fn(), publicBaseUrl: "https://agent.example" });
    const res = await app.request("/.well-known/agent.json");

    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({
      name: "approval-risk-auditor-agent",
      endpoints: {
        entrypoints: "https://agent.example/entrypoints",
        invoke: "https://agent.example/entrypoints/audit_approvals/invoke",
      },
      entrypoints: [{ id: "audit_approvals" }],
    });
  });

  it("lists Daydreams/agent-kit style entrypoints", async () => {
    const app = createServer({ audit: vi.fn(), paymentAddress });
    const res = await app.request("/entrypoints");

    expect(res.status).toBe(200);
    expect((await res.json()) as object).toMatchObject({
      entrypoints: [
        {
          id: "audit_approvals",
          method: "POST",
          path: "/entrypoints/audit_approvals/invoke",
          x402: { required: true },
        },
      ],
    });
  });

  it("validates audit payloads", async () => {
    const app = createServer({ audit: vi.fn() });
    const res = await app.request("/audit", { method: "POST", body: JSON.stringify({ wallet: "not-an-address" }) });

    expect(res.status).toBe(400);
    expect((await res.json()) as object).toMatchObject({ error: "invalid_request" });
  });

  it("requires x402 payment before running paid audits", async () => {
    const audit = vi.fn(async () => sampleResult);
    const app = createServer({ audit, paymentAddress, priceUsd: "0.01", publicBaseUrl: "https://agent.example" });
    const res = await app.request("/invoke", {
      method: "POST",
      body: JSON.stringify({ entrypoint: "audit_approvals", input: { wallet: sampleResult.wallet, chains: ["ethereum"] } }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(402);
    expect(audit).not.toHaveBeenCalled();
    expect(res.headers.get("x-accept-payment")).toContain("exact");
    expect((await res.json()) as object).toMatchObject({
      error: "payment_required",
      x402Version: 1,
      accepts: [{ scheme: "exact", network: "base", payTo: paymentAddress, resource: "https://agent.example/entrypoints/audit_approvals/invoke" }],
    });
  });

  it("rejects invalid x402 payments before running audits", async () => {
    const audit = vi.fn(async () => sampleResult);
    const verifyPayment = vi.fn(async () => ({ ok: false, reason: "underpaid" }));
    const app = createServer({ audit, paymentAddress, verifyPayment });
    const res = await app.request("/invoke", {
      method: "POST",
      body: JSON.stringify({ wallet: sampleResult.wallet }),
      headers: { "content-type": "application/json", "x-payment": "bad-payment" },
    });

    expect(res.status).toBe(402);
    expect(audit).not.toHaveBeenCalled();
    expect(verifyPayment).toHaveBeenCalledWith(expect.objectContaining({ payment: "bad-payment" }));
    expect((await res.json()) as object).toMatchObject({ error: "payment_required", detail: "underpaid" });
  });

  it("runs invoke audits only after x402 verification succeeds and then settles", async () => {
    const audit = vi.fn(async () => sampleResult);
    const verifyPayment = vi.fn(async () => ({ ok: true }));
    const settlePayment = vi.fn(async () => ({ ok: true, transaction: "0xsettled" }));
    const app = createServer({ audit, paymentAddress, priceUsd: "0.01", verifyPayment, settlePayment });
    const res = await app.request("/invoke", {
      method: "POST",
      body: JSON.stringify({ entrypoint: "audit_approvals", input: { wallet: sampleResult.wallet, chains: ["ethereum"] } }),
      headers: { "content-type": "application/json", "x-payment": "paid-payload" },
    });

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith({ wallet: sampleResult.wallet, chains: ["ethereum"] });
    expect(verifyPayment).toHaveBeenCalledOnce();
    expect(settlePayment).toHaveBeenCalledOnce();
    const paymentResponse = JSON.parse(Buffer.from(res.headers.get("x-payment-response") ?? "", "base64url").toString("utf8"));
    expect(paymentResponse).toMatchObject({ transaction: "0xsettled" });
    expect((await res.json()) as object).toMatchObject({
      entrypoint: "audit_approvals",
      result: sampleResult,
      x402: { paid: true, settlement: { ok: true, transaction: "0xsettled" } },
    });
  });


  it("supports canonical Daydreams entrypoint invoke route", async () => {
    const audit = vi.fn(async () => sampleResult);
    const app = createServer({ audit });
    const res = await app.request("/entrypoints/audit_approvals/invoke", {
      method: "POST",
      body: JSON.stringify({ input: { wallet: sampleResult.wallet, chains: ["base"] } }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith({ wallet: sampleResult.wallet, chains: ["base"] });
    expect((await res.json()) as object).toMatchObject({ entrypoint: "audit_approvals", result: sampleResult });
  });

  it("supports audit-approvals hyphen alias used by competing submissions", async () => {
    const audit = vi.fn(async () => sampleResult);
    const app = createServer({ audit });
    const res = await app.request("/entrypoints/audit-approvals/invoke", {
      method: "POST",
      body: JSON.stringify({ entrypoint: "audit-approvals", input: { wallet: sampleResult.wallet, chains: ["base"] } }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith({ wallet: sampleResult.wallet, chains: ["base"] });
    expect((await res.json()) as object).toMatchObject({ entrypoint: "audit_approvals", result: sampleResult });
  });

  it("keeps unpaid /audit available when no payment address is configured", async () => {
    const audit = vi.fn(async () => sampleResult);
    const app = createServer({ audit });
    const res = await app.request("/audit", {
      method: "POST",
      body: JSON.stringify({ wallet: sampleResult.wallet, chains: ["ethereum"] }),
      headers: { "content-type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(audit).toHaveBeenCalledWith({ wallet: sampleResult.wallet, chains: ["ethereum"] });
    expect((await res.json()) as object).toMatchObject({ result: sampleResult });
  });
});
