# Approval Risk Auditor deployment report

Public URL: https://approval-risk-auditor.tolga-730.workers.dev

Current deployed Worker version includes the final quality pass:
- Canonical Daydreams-style invoke route: `/entrypoints/audit_approvals/invoke`
- Legacy `/invoke` route retained for compatibility
- Discovery: `/health`, `/.well-known/agent.json`, `/entrypoints`
- x402 unpaid gating on `/audit`, `/invoke`, and `/entrypoints/audit_approvals/invoke`
- Etherscan-compatible explorer fallback hooks for ERC-20 Approval logs when API keys are configured
- NFT `ApprovalForAll` discovery via RPC/global logs where supported, plus explorer fallback hooks
- Revoke calldata for ERC-20 `approve(spender, 0)` and NFT `setApprovalForAll(operator, false)`

Verification run by RFDY:
- `npm test` => 17 passed / 3 files
- `npm run build` => TypeScript clean
- `npx wrangler deploy` => live at public URL
- Smoke: `/health` ok
- Smoke: manifest points invoke to `/entrypoints/audit_approvals/invoke`
- Smoke: unpaid canonical invoke returns HTTP 402 with x402 payment requirement
- Smoke: unpaid legacy invoke returns HTTP 402 with same canonical x402 resource

x402 payTo EVM address: 0xd2475a9a1a6eC3B76e1c38F9C368084cfd98D46a
Solana payout public address: 8sqgL8Srd7QCWJnQRFw1Gsi4spS9rndAbER1HEGDHLNT

Remaining caveat:
- `X402_FACILITATOR_URL` is still not configured, so full paid verify/settle has not been live-tested. The server code supports facilitator `/verify` and `/settle`; configure the exact Daydreams/Coinbase facilitator URL and expected asset identifier before claiming fully settled paid-flow proof.
