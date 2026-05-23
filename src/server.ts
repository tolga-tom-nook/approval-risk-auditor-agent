import { serve } from "@hono/node-server";
import { createServer, type CreateServerOptions } from "./app.js";

const AGENT_NAME = "approval-risk-auditor-agent";

function serverOptionsFromEnv(): CreateServerOptions {
  const options: CreateServerOptions = {};
  if (process.env.PAYMENT_ADDRESS) options.paymentAddress = process.env.PAYMENT_ADDRESS;
  if (process.env.PRICE_USD) options.priceUsd = process.env.PRICE_USD;
  if (process.env.PAYMENT_NETWORK) options.paymentNetwork = process.env.PAYMENT_NETWORK;
  if (process.env.PAYMENT_ASSET) options.paymentAsset = process.env.PAYMENT_ASSET;
  if (process.env.PUBLIC_BASE_URL) options.publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (process.env.X402_FACILITATOR_URL) options.facilitatorUrl = process.env.X402_FACILITATOR_URL;
  return options;
}

export { createServer } from "./app.js";
export type { AuditRequest, CreateServerOptions, PaymentCheckInput, PaymentCheckResult, PaymentSettleResult, X402Accept } from "./app.js";

export async function startServer(): Promise<void> {
  const app = createServer(serverOptionsFromEnv());
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  serve({ fetch: app.fetch, port, hostname: host });
  console.log(`${AGENT_NAME} listening on http://${host}:${port}`);
}
