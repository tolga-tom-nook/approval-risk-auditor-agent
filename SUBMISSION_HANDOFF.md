# Approval Risk Auditor — RFDY Submission Handoff

## Live service

- Public Worker: https://approval-risk-auditor.tolga-730.workers.dev
- Agent manifest: https://approval-risk-auditor.tolga-730.workers.dev/.well-known/agent.json
- Entrypoints: https://approval-risk-auditor.tolga-730.workers.dev/entrypoints
- Main invocation endpoint: `POST https://approval-risk-auditor.tolga-730.workers.dev/entrypoints/audit_approvals/invoke`
- Compatibility endpoints: `POST /entrypoints/audit-approvals/invoke`, `POST /invoke`
- Entrypoint name: `audit_approvals`

## Payment / payout details

- x402 payTo EVM address: `0xd2475a9a1a6eC3B76e1c38F9C368084cfd98D46a`
- Solana payout public address: `8sqgL8Srd7QCWJnQRFw1Gsi4spS9rndAbER1HEGDHLNT`

## Verified smoke tests

- `GET /health` returns HTTP 200.
- `GET /.well-known/agent.json` returns HTTP 200 and an agent manifest.
- `GET /entrypoints` returns HTTP 200 and includes `audit_approvals`.
- Unpaid canonical `POST /entrypoints/audit_approvals/invoke` returns HTTP 402.
- Unpaid hyphenated `POST /entrypoints/audit-approvals/invoke` returns HTTP 402 with the canonical x402 resource.
- Unpaid legacy `POST /invoke` returns HTTP 402.
- Unpaid `POST /audit` returns HTTP 402.

## Caveat to state publicly if posting now

The deployment proves x402 reachability/payment requirements because unpaid protected calls return HTTP 402 with requirements. It does not yet prove full paid verification/settlement because `X402_FACILITATOR_URL` is not configured on the Worker.

Do not claim complete paid settlement until RFDY/Tolga provides the facilitator URL/schema, the Worker is configured, and a paid `/invoke` request succeeds end-to-end.

## Suggested public wording, if RFDY approves a reputation-oriented post

Live x402-gated Approval Risk Auditor agent for wallet approval risk checks:

- Worker: https://approval-risk-auditor.tolga-730.workers.dev
- Manifest: https://approval-risk-auditor.tolga-730.workers.dev/.well-known/agent.json
- Entrypoint: `audit_approvals`
- Unpaid `/invoke` and `/audit` requests return HTTP 402 payment requirements.
- x402 payTo: `0xd2475a9a1a6eC3B76e1c38F9C368084cfd98D46a`
- Solana payout: `8sqgL8Srd7QCWJnQRFw1Gsi4spS9rndAbER1HEGDHLNT`

Pending final paid-flow validation once the expected x402 facilitator URL/schema is provided and configured.

## What RFDY/Tolga must provide before stronger public bounty-completion claims

1. Exact `X402_FACILITATOR_URL`.
2. Expected verify/settle request and response schema if it differs from the implemented `/verify` + `/settle` shape.
3. Required Base USDC `asset` value: display string `USDC` vs contract address/CAIP identifier.
4. Confirmation that the bounty is still eligible/payable relative to earlier PR #167.
5. Permission to post a public PR/comment and the preferred wording/positioning.

## Final quality-pass note

RFDY upgraded and redeployed the Worker after benchmarking against existing bounty #5 PRs. The implementation now uses canonical Daydreams-style `/entrypoints/audit_approvals/invoke`, keeps legacy `/invoke`, includes HTTP 402 x402 gating, ERC-20 explorer fallback hooks, NFT ApprovalForAll discovery hooks, and revoke calldata for both ERC-20 and NFT approvals.

Evidence: 21 tests passing, TypeScript build clean, live Worker smoke-tested at https://approval-risk-auditor.tolga-730.workers.dev. The latest local loop added explicit ERC-20 explorer fallback regression coverage; no public submission was posted.

Do not submit publicly until Tolga/RFDY explicitly approves.
