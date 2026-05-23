import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { isAddress } from "viem";
import { auditWalletApprovals, chainsFromInput, type AuditResult } from "./scanner.js";

export interface AuditRequest {
  wallet: string;
  chains?: Array<string | number>;
}

export interface X402Accept {
  scheme: "exact";
  network: "base" | "ethereum";
  payTo: string;
  asset: "USDC";
  priceUsd: string;
}

export interface CreateServerOptions {
  audit?: (request: AuditRequest) => Promise<AuditResult>;
  paymentAddress?: string;
  priceUsd?: string;
}

function auditPayload(wallet: string, chains?: Array<string | number>): AuditRequest {
  return chains === undefined ? { wallet } : { wallet, chains };
}

export function createServer(options: CreateServerOptions = {}): Hono {
  const app = new Hono();
  const audit = options.audit ?? (async (request: AuditRequest) => auditWalletApprovals({ wallet: request.wallet, chains: chainsFromInput(request.chains) }));

  app.get("/health", (c) =>
    c.json({
      ok: true,
      name: "approval-risk-auditor-agent",
      version: "0.1.0",
      capabilities: ["approval_scan", "risk_flags", "revoke_tx_data", "x402_metadata"],
    }),
  );

  app.post("/audit", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<AuditRequest>;
    if (!body.wallet || !isAddress(body.wallet)) {
      return c.json({ error: "invalid_request", message: "wallet must be a valid EVM address" }, 400);
    }
    if (body.chains !== undefined && !Array.isArray(body.chains)) {
      return c.json({ error: "invalid_request", message: "chains must be an array of chain names or ids" }, 400);
    }

    const result = await audit(auditPayload(body.wallet, body.chains));
    const x402 = options.paymentAddress
      ? {
          accepts: [
            {
              scheme: "exact",
              network: "base",
              payTo: options.paymentAddress,
              asset: "USDC",
              priceUsd: options.priceUsd ?? "0.01",
            } satisfies X402Accept,
          ],
          note: "Deploy behind an x402 facilitator/middleware to enforce payment before serving /audit responses.",
        }
      : undefined;

    return c.json({ result, ...(x402 ? { x402 } : {}) });
  });

  return app;
}

function serverOptionsFromEnv(): CreateServerOptions {
  const options: CreateServerOptions = {};
  if (process.env.PAYMENT_ADDRESS) options.paymentAddress = process.env.PAYMENT_ADDRESS;
  if (process.env.PRICE_USD) options.priceUsd = process.env.PRICE_USD;
  return options;
}

export async function startServer(): Promise<void> {
  const app = createServer(serverOptionsFromEnv());
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  serve({ fetch: app.fetch, port, hostname: host });
  console.log(`approval-risk-auditor-agent listening on http://${host}:${port}`);
}
