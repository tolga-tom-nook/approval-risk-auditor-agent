# Approval Risk Auditor Agent

DaydreamsAI bounty deliverable: an x402-ready agent that audits risky token approvals for an EVM wallet and returns risk flags plus safe revoke transaction data.

## What it does

- Scans curated top ERC-20 approval history across Ethereum, Base, Polygon, Arbitrum, and Optimism.
- Reads current `allowance(owner, spender)` before reporting so revoked/zero allowances are ignored.
- Flags:
  - `unlimited_allowance`
  - `nonzero_allowance`
  - `stale_approval`
  - NFT approval-for-all risk logic is included in the core auditor helpers for extension.
- Builds revoke calldata:
  - ERC-20: `approve(spender, 0)`
  - NFT helpers: `setApprovalForAll(operator, false)`
- Exposes a JSON HTTP service with x402-compatible payment metadata.

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

Current local validation: 11 Vitest tests pass and TypeScript strict build passes.

## CLI usage

```bash
# Show help
npm start

# Run an audit and print JSON
npm start -- audit --wallet 0xYourWallet --chains ethereum,base

# Write report to a file
npm start -- audit --wallet 0xYourWallet --chains ethereum,base --out report.json
```

## HTTP / x402-ready service

```bash
PAYMENT_ADDRESS=0xYourPaymentAddress PRICE_USD=0.01 npm start -- serve
```

Endpoints:

- `GET /health`
- `POST /audit`

Example request:

```bash
curl -s http://localhost:3000/audit \
  -H 'content-type: application/json' \
  -d '{"wallet":"0x1234567890123456789012345678901234567890","chains":["ethereum","base"]}'
```

Example response shape:

```json
{
  "result": {
    "wallet": "0x...",
    "generated_at": "2026-01-01T00:00:00.000Z",
    "approvals": [],
    "risk_flags": { "summary": { "total": 0, "critical": 0, "high": 0, "medium": 0, "low": 0 }, "by_approval": [] },
    "revoke_tx_data": [],
    "methodology": []
  },
  "x402": {
    "accepts": [{ "scheme": "exact", "network": "base", "payTo": "0x...", "asset": "USDC", "priceUsd": "0.01" }]
  }
}
```

The service emits payment requirements metadata; a production deployment can put the `/audit` route behind an x402 facilitator/middleware to enforce payment before returning reports.

## RPC configuration

Set any of these to override public/default RPC behavior:

- `ETHEREUM_RPC_URL`
- `BASE_RPC_URL`
- `POLYGON_RPC_URL`
- `ARBITRUM_RPC_URL`
- `OPTIMISM_RPC_URL`

## Scope notes

This is intentionally conservative for the bounty:

- It focuses on high-signal ERC-20 approvals for common assets on major chains.
- It validates current on-chain allowance before surfacing a risk.
- It does not move funds or submit transactions. It only returns unsigned transaction targets/calldata for the user to review and execute in their own wallet.
