import { Hono, type Context } from "hono";
import { isAddress } from "viem";
import { auditWalletApprovals, chainsFromInput, type AuditResult } from "./scanner.js";

const AGENT_NAME = "approval-risk-auditor-agent";
const AGENT_VERSION = "0.1.0";
const DEFAULT_PRICE_USD = "0.01";
const DEFAULT_NETWORK = "base";
const DEFAULT_ASSET = "USDC";
const DEFAULT_TIMEOUT_SECONDS = 120;

export interface AuditRequest {
  wallet: string;
  chains?: Array<string | number>;
}

export interface X402Accept {
  scheme: "exact";
  network: string;
  payTo: string;
  asset: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  maxTimeoutSeconds: number;
  outputSchema?: Record<string, unknown>;
  extra: {
    name: string;
    version: string;
    priceUsd: string;
  };
}

export interface PaymentCheckInput {
  payment: string;
  requirement: X402Accept;
  request: Request;
}

export interface PaymentCheckResult {
  ok: boolean;
  reason?: string;
  payload?: unknown;
}

export interface PaymentSettleResult {
  ok: boolean;
  reason?: string;
  transaction?: string;
  payload?: unknown;
}

export interface CreateServerOptions {
  audit?: (request: AuditRequest) => Promise<AuditResult>;
  paymentAddress?: string;
  priceUsd?: string;
  paymentNetwork?: string;
  paymentAsset?: string;
  publicBaseUrl?: string;
  facilitatorUrl?: string;
  verifyPayment?: (input: PaymentCheckInput) => Promise<PaymentCheckResult>;
  settlePayment?: (input: PaymentCheckInput) => Promise<PaymentSettleResult>;
}

function auditPayload(wallet: string, chains?: Array<string | number>): AuditRequest {
  return chains === undefined ? { wallet } : { wallet, chains };
}

function normalizeBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? "http://localhost:3000").replace(/\/$/, "");
}

function priceUsdToUsdcAtomic(priceUsd: string): string {
  const normalized = priceUsd.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(normalized)) return priceUsd;
  const [whole = "0", fraction = ""] = normalized.split(".");
  return `${whole}${fraction.padEnd(6, "0")}`.replace(/^0+(?=\d)/, "");
}

function buildPaymentRequirement(options: CreateServerOptions, path: "/audit" | "/invoke" | "/entrypoints/audit_approvals/invoke"): X402Accept | undefined {
  if (!options.paymentAddress) return undefined;
  const priceUsd = options.priceUsd ?? DEFAULT_PRICE_USD;
  return {
    scheme: "exact",
    network: options.paymentNetwork ?? DEFAULT_NETWORK,
    payTo: options.paymentAddress,
    asset: options.paymentAsset ?? DEFAULT_ASSET,
    maxAmountRequired: priceUsdToUsdcAtomic(priceUsd),
    resource: `${normalizeBaseUrl(options.publicBaseUrl)}${path}`,
    description: "Approval Risk Auditor report with risky ERC-20 approvals and revoke transaction calldata.",
    mimeType: "application/json",
    maxTimeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    extra: {
      name: AGENT_NAME,
      version: AGENT_VERSION,
      priceUsd,
    },
  };
}

function encodePaymentResponse(payload: unknown): string {
  const json = JSON.stringify(payload);
  const base64 = typeof btoa === "function" ? btoa(json) : Buffer.from(json).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function xAcceptPaymentHeader(requirement: X402Accept): string {
  return `${requirement.scheme}; network=${requirement.network}; asset=${requirement.asset}; amount=${requirement.maxAmountRequired}; payTo=${requirement.payTo}`;
}

async function facilitatorPost<T>(facilitatorUrl: string, path: "/verify" | "/settle", input: PaymentCheckInput): Promise<T> {
  const res = await fetch(`${facilitatorUrl.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 1, payment: input.payment, paymentRequirements: input.requirement }),
  });
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return { ok: false, reason: typeof payload.error === "string" ? payload.error : `facilitator_${res.status}`, payload } as T;
  }
  return payload as T;
}

function defaultVerifyPayment(options: CreateServerOptions): ((input: PaymentCheckInput) => Promise<PaymentCheckResult>) | undefined {
  if (options.verifyPayment) return options.verifyPayment;
  if (!options.facilitatorUrl) return undefined;
  return async (input) => facilitatorPost<PaymentCheckResult>(options.facilitatorUrl!, "/verify", input);
}

function defaultSettlePayment(options: CreateServerOptions): ((input: PaymentCheckInput) => Promise<PaymentSettleResult>) | undefined {
  if (options.settlePayment) return options.settlePayment;
  if (!options.facilitatorUrl) return undefined;
  return async (input) => facilitatorPost<PaymentSettleResult>(options.facilitatorUrl!, "/settle", input);
}

function paymentRequiredResponse(requirement: X402Accept, detail?: string): Response {
  const body = {
    error: "payment_required",
    detail: detail ?? "Provide a valid x402 payment in the X-PAYMENT header.",
    x402Version: 1,
    accepts: [requirement],
  };
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "x-accept-payment": xAcceptPaymentHeader(requirement),
    },
  });
}

async function enforcePayment(c: { req: { raw: Request } }, requirement: X402Accept, options: CreateServerOptions): Promise<{ paid: true; settlement?: PaymentSettleResult } | Response> {
  const payment = c.req.raw.headers.get("x-payment") ?? c.req.raw.headers.get("X-PAYMENT");
  if (!payment) return paymentRequiredResponse(requirement);

  const verifyPayment = defaultVerifyPayment(options);
  if (!verifyPayment) return paymentRequiredResponse(requirement, "x402 facilitator is not configured for payment verification");

  const input: PaymentCheckInput = { payment, requirement, request: c.req.raw };
  const verification = await verifyPayment(input);
  if (!verification.ok) return paymentRequiredResponse(requirement, verification.reason ?? "payment verification failed");

  const settlePayment = defaultSettlePayment(options);
  if (!settlePayment) return { paid: true };
  const settlement = await settlePayment(input);
  if (!settlement.ok) return paymentRequiredResponse(requirement, settlement.reason ?? "payment settlement failed");
  return { paid: true, settlement };
}

function agentEntrypoints(options: CreateServerOptions) {
  return [
    {
      id: "audit_approvals",
      aliases: ["audit-approvals", "audit"],
      name: "Audit risky token approvals",
      description: "Scan an EVM wallet for risky ERC-20 approvals and return revoke transaction data.",
      method: "POST",
      path: "/entrypoints/audit_approvals/invoke",
      inputSchema: {
        type: "object",
        required: ["wallet"],
        properties: {
          wallet: { type: "string", description: "EVM wallet address to audit" },
          chains: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } },
        },
      },
      outputSchema: {
        type: "object",
        properties: {
          result: { type: "object" },
          x402: { type: "object" },
        },
      },
      x402: {
        required: Boolean(options.paymentAddress),
        accepts: buildPaymentRequirement(options, "/entrypoints/audit_approvals/invoke") ? [buildPaymentRequirement(options, "/entrypoints/audit_approvals/invoke")] : [],
      },
    },
  ];
}

function parseInvokeBody(body: Record<string, unknown>): Partial<AuditRequest> & { entrypoint?: string } {
  const input = typeof body.input === "object" && body.input !== null && !Array.isArray(body.input) ? (body.input as Record<string, unknown>) : body;
  const parsed: Partial<AuditRequest> & { entrypoint?: string } = {};
  if (typeof input.wallet === "string") parsed.wallet = input.wallet;
  if (Array.isArray(input.chains)) parsed.chains = input.chains as Array<string | number>;
  if (typeof body.entrypoint === "string") parsed.entrypoint = body.entrypoint;
  return parsed;
}

function validateAuditRequest(body: Partial<AuditRequest>): Response | undefined {
  if (!body.wallet || !isAddress(body.wallet)) {
    return new Response(JSON.stringify({ error: "invalid_request", message: "wallet must be a valid EVM address" }), { status: 400, headers: { "content-type": "application/json" } });
  }
  if (body.chains !== undefined && !Array.isArray(body.chains)) {
    return new Response(JSON.stringify({ error: "invalid_request", message: "chains must be an array of chain names or ids" }), { status: 400, headers: { "content-type": "application/json" } });
  }
  return undefined;
}

export function createServer(options: CreateServerOptions = {}): Hono {
  const app = new Hono();
  const audit = options.audit ?? (async (request: AuditRequest) => auditWalletApprovals({ wallet: request.wallet, chains: chainsFromInput(request.chains) }));

  app.get("/health", (c) =>
    c.json({
      ok: true,
      name: AGENT_NAME,
      version: AGENT_VERSION,
      capabilities: ["approval_scan", "risk_flags", "revoke_tx_data", "x402_enforced", "agent_manifest"],
    }),
  );

  app.get("/.well-known/agent.json", (c) => {
    const baseUrl = normalizeBaseUrl(options.publicBaseUrl);
    return c.json({
      name: AGENT_NAME,
      version: AGENT_VERSION,
      description: "x402-gated agent that audits risky EVM token approvals and returns safe revoke transaction calldata.",
      protocolVersion: "0.1",
      homepage: baseUrl,
      endpoints: {
        health: `${baseUrl}/health`,
        entrypoints: `${baseUrl}/entrypoints`,
        invoke: `${baseUrl}/entrypoints/audit_approvals/invoke`,
      },
      entrypoints: agentEntrypoints(options),
      x402: {
        required: Boolean(options.paymentAddress),
        accepts: buildPaymentRequirement(options, "/entrypoints/audit_approvals/invoke") ? [buildPaymentRequirement(options, "/entrypoints/audit_approvals/invoke")] : [],
      },
    });
  });

  app.get("/entrypoints", (c) => c.json({ entrypoints: agentEntrypoints(options) }));

  app.post("/audit", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<AuditRequest>;
    const invalid = validateAuditRequest(body);
    if (invalid) return invalid;

    const requirement = buildPaymentRequirement(options, "/audit");
    let payment: { paid: true; settlement?: PaymentSettleResult } | undefined;
    if (requirement) {
      const paid = await enforcePayment(c, requirement, options);
      if (paid instanceof Response) return paid;
      payment = paid;
    }

    const result = await audit(auditPayload(body.wallet!, body.chains));
    if (payment?.settlement) c.header("x-payment-response", encodePaymentResponse(payment.settlement));
    return c.json({ result, ...(payment ? { x402: { paid: true, settlement: payment.settlement } } : {}) });
  });

  async function handleInvoke(c: Context) {
    const rawBody = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const body = parseInvokeBody(rawBody);
    if (body.entrypoint && !["audit_approvals", "audit-approvals", "audit"].includes(body.entrypoint)) {
      return c.json({ error: "invalid_request", message: "unsupported entrypoint" }, 400);
    }
    const invalid = validateAuditRequest(body);
    if (invalid) return invalid;

    const requirement = buildPaymentRequirement(options, "/entrypoints/audit_approvals/invoke");
    let payment: { paid: true; settlement?: PaymentSettleResult } | undefined;
    if (requirement) {
      const paid = await enforcePayment(c, requirement, options);
      if (paid instanceof Response) return paid;
      payment = paid;
    }

    const result = await audit(auditPayload(body.wallet!, body.chains));
    if (payment?.settlement) c.header("x-payment-response", encodePaymentResponse(payment.settlement));
    return c.json({ entrypoint: "audit_approvals", result, ...(payment ? { x402: { paid: true, settlement: payment.settlement } } : {}) });
  }

  app.post("/invoke", handleInvoke);
  app.post("/entrypoints/audit_approvals/invoke", handleInvoke);
  app.post("/entrypoints/audit-approvals/invoke", handleInvoke);
  app.post("/entrypoints/audit/invoke", handleInvoke);

  return app;
}
