import { createServer, type CreateServerOptions } from "./app.js";

function optionsFromEnv(env: Record<string, string | undefined>): CreateServerOptions {
  const options: CreateServerOptions = {};
  if (env.PAYMENT_ADDRESS) options.paymentAddress = env.PAYMENT_ADDRESS;
  if (env.PRICE_USD) options.priceUsd = env.PRICE_USD;
  if (env.PAYMENT_NETWORK) options.paymentNetwork = env.PAYMENT_NETWORK;
  if (env.PAYMENT_ASSET) options.paymentAsset = env.PAYMENT_ASSET;
  if (env.PUBLIC_BASE_URL) options.publicBaseUrl = env.PUBLIC_BASE_URL;
  if (env.X402_FACILITATOR_URL) options.facilitatorUrl = env.X402_FACILITATOR_URL;
  return options;
}

export default {
  fetch(request: Request, env: Record<string, string | undefined>): Promise<Response> | Response {
    return createServer(optionsFromEnv(env)).fetch(request);
  },
};
