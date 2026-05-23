# Approval Risk Auditor Agent

DaydreamsAI bounty deliverable: an x402-gated agent that audits risky token approvals for an EVM wallet and returns risk flags plus safe revoke transaction data.

This repo now has a live Cloudflare Worker deployment for RFDY review. See `RFDY_REVIEW.md` and `DEPLOYMENT_REPORT.md` before making any public PR/comment because full paid x402 verification/settlement still depends on configuring `X402_FACILITATOR_URL`.

## What it does

- Scans curated top ERC-20 approval history across Ethereum, Base, Polygon, Arbitrum, and Optimism.
- Reads current `allowance(owner, spender)` before reporting so revoked/zero allowances are ignored.
- Flags:
  - `unlimited_allowance`
  - `nonzero_allowance`
  - `stale_approval`
  - `operator_approval_for_all` for NFT collection approvals
- Builds revoke calldata:
  - ERC-20: `approve(spender, 0)`
  - NFT: `setApprovalForAll(operator, false)`
- Exposes agent discovery and invocation endpoints:
  - `GET /.well-known/agent.json`
  - `GET /entrypoints`
  - `POST /entrypoints/audit_approvals/invoke` canonical Daydreams-style invoke route
  - `POST /entrypoints/audit-approvals/invoke` compatibility alias
  - `POST /invoke` legacy compatibility route
  - `POST /audit` legacy direct audit route
- Enforces x402-style payment when `PAYMENT_ADDRESS` is configured:
  - Missing or invalid `X-PAYMENT` receives HTTP 402 and payment requirements.
  - Valid payments are verified before the audit runs.
  - Successful audits optionally settle through a facilitator and return `X-PAYMENT-RESPONSE`.

## Install

```bash
npm install
```

Node 20+ is required.

## Validate

```bash
npm test
npm run build
```

## CLI usage

```bash
# Show help
npm start

# Run an audit and print JSON
npm start -- audit --wallet 0xYourWallet --chains ethereum,base

# Write report to a file
npm start -- audit --wallet 0xYourWallet --chains ethereum,base --out report.json
```

## HTTP service

Unpaid local/dev mode:

```bash
npm start -- serve
```

x402-enforced mode:

```bash
PAYMENT_ADDRESS=0xYourPaymentAddress \
PRICE_USD=0.01 \
PUBLIC_BASE_URL=http://localhost:3000 \
X402_FACILITATOR_URL=https://your-facilitator.example \
npm start -- serve
```

Environment:

| Variable | Purpose |
| --- | --- |
| `PAYMENT_ADDRESS` | Enables x402 enforcement and receives payment. If absent, local/dev audits are not paywalled. |
| `PRICE_USD` | Human price metadata; default `0.01`. Converted to 6-decimal USDC atomic units for `maxAmountRequired`. |
| `PAYMENT_NETWORK` | Payment network in x402 accept object; default `base`. |
| `PAYMENT_ASSET` | Asset in x402 accept object; default `USDC`. Replace with facilitator-required token address if needed. |
| `PUBLIC_BASE_URL` | Public HTTPS origin used in manifest and x402 `resource` fields. |
| `X402_FACILITATOR_URL` | Facilitator base URL. Server calls `POST /verify` before audit and `POST /settle` after audit. |
| `PORT`, `HOST` | Node server bind settings. |

### Endpoints

- `GET /health` — basic service metadata.
- `GET /.well-known/agent.json` — agent discovery manifest with endpoint URLs and x402 metadata.
- `GET /entrypoints` — Daydreams/agent-kit-style entrypoint list.
- `POST /entrypoints/audit_approvals/invoke` — canonical Daydreams-style agent invocation endpoint.
- `POST /entrypoints/audit-approvals/invoke` — compatibility alias for hyphenated entrypoint clients.
- `POST /invoke` — legacy compatibility invocation endpoint.
- `POST /audit` — legacy direct audit endpoint with same payment enforcement.

Invoke request:

```bash
curl -s http://localhost:3000/entrypoints/audit_approvals/invoke \
  -H 'content-type: application/json' \
  -H 'X-PAYMENT: <x402-payment-payload>' \
  -d '{"entrypoint":"audit_approvals","input":{"wallet":"0x1234567890123456789012345678901234567890","chains":["ethereum","base"]}}'
```

If payment is required but missing/invalid, response is HTTP 402:

```json
{
  "error": "payment_required",
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "base",
      "payTo": "0x...",
      "asset": "USDC",
      "maxAmountRequired": "10000",
      "resource": "https://your-agent.example/entrypoints/audit_approvals/invoke",
      "description": "Approval Risk Auditor report with risky ERC-20 approvals and revoke transaction calldata.",
      "mimeType": "application/json",
      "maxTimeoutSeconds": 120
    }
  ]
}
```

Successful invoke response:

```json
{
  "entrypoint": "audit_approvals",
  "result": {
    "wallet": "0x...",
    "generated_at": "2026-01-01T00:00:00.000Z",
    "approvals": [],
    "risk_flags": { "summary": { "total": 0, "critical": 0, "high": 0, "medium": 0, "low": 0 }, "by_approval": [] },
    "revoke_tx_data": [],
    "methodology": []
  },
  "x402": { "paid": true }
}
```

## RPC configuration

Set any of these to override public/default RPC behavior:

- `ETHEREUM_RPC_URL`
- `BASE_RPC_URL`
- `POLYGON_RPC_URL`
- `ARBITRUM_RPC_URL`
- `OPTIMISM_RPC_URL`

## Docker

Build and run locally:

```bash
docker build -t approval-risk-auditor .
docker run --rm -p 3000:3000 \
  -e PAYMENT_ADDRESS=0xYourPaymentAddress \
  -e PRICE_USD=0.01 \
  -e PUBLIC_BASE_URL=http://localhost:3000 \
  -e X402_FACILITATOR_URL=https://your-facilitator.example \
  approval-risk-auditor
```

## Cloudflare Workers deployment (live RFDY review deployment)

Live Worker:

- Public URL: `https://approval-risk-auditor.tolga-730.workers.dev`
- x402 payTo EVM address: `0xd2475a9a1a6eC3B76e1c38F9C368084cfd98D46a`
- Solana payout public address for submission: `8sqgL8Srd7QCWJnQRFw1Gsi4spS9rndAbER1HEGDHLNT`

The repo includes `src/worker.ts` and `wrangler.toml` for a Worker-shaped serverless deployment.

```bash
# Local preview
npx wrangler dev

# Configure secrets before deployment
npx wrangler secret put PAYMENT_ADDRESS
npx wrangler secret put X402_FACILITATOR_URL
npx wrangler secret put PUBLIC_BASE_URL

# Optional if not using defaults
npx wrangler secret put PRICE_USD
npx wrangler secret put PAYMENT_NETWORK
npx wrangler secret put PAYMENT_ASSET

# Redeploy after config/code changes
npx wrangler deploy
```

Notes:

- `PUBLIC_BASE_URL` must match the final Worker URL so `/.well-known/agent.json` and x402 `resource` values are correct.
- `PAYMENT_ASSET` may need to be the facilitator's exact Base USDC contract address rather than the display string `USDC`; confirm against the chosen facilitator.

## Fly.io deployment option

```bash
fly launch --dockerfile Dockerfile --no-deploy
fly secrets set PAYMENT_ADDRESS=0xYourPaymentAddress \
  PRICE_USD=0.01 \
  PUBLIC_BASE_URL=https://your-app.fly.dev \
  X402_FACILITATOR_URL=https://your-facilitator.example
fly deploy
```

## Render deployment option

- Create a Web Service from this repo.
- Runtime: Docker.
- Dockerfile path: `Dockerfile`.
- Set environment variables listed above.
- Health check path: `/health`.

## Scope notes and limitations

This is intentionally conservative for the bounty:

- It focuses on high-signal ERC-20 approvals for common assets on major chains.
- It validates current on-chain allowance before surfacing a risk.
- It does not move funds or submit transactions. It only returns unsigned transaction targets/calldata for the user to review and execute in their own wallet.
- NFT approval-for-all discovery is implemented through RPC/global logs where supported plus Etherscan-compatible fallback hooks.
- Public RPC `getLogs` over wide ranges can rate-limit; production should prefer provider/explorer API keys or a dedicated indexer.


## Final readiness

See `FINAL_READINESS.md` for the current submit/no-submit recommendation, competitor comparison, verification evidence, and draft public wording.
