import { writeFile } from "node:fs/promises";
import { auditWalletApprovals, chainsFromInput } from "./scanner.js";
import { startServer } from "./server.js";

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";
  if (command === "serve") {
    await startServer();
    return;
  }

  if (command === "audit") {
    const wallet = readArg("wallet");
    if (!wallet) throw new Error("Missing required --wallet 0x... argument");
    const chains = readArg("chains")?.split(",").map((chain) => chain.trim()).filter(Boolean);
    const result = await auditWalletApprovals({ wallet, chains: chainsFromInput(chains) });
    const outputPath = readArg("out");
    const json = JSON.stringify(result, null, 2);
    if (outputPath) {
      await writeFile(outputPath, `${json}\n`, "utf8");
      console.log(`Wrote audit report to ${outputPath}`);
    } else {
      console.log(json);
    }
    return;
  }

  console.log(`approval-risk-auditor-agent

Usage:
  npm start -- serve
  npm start -- audit --wallet 0x... [--chains ethereum,base] [--out report.json]

Environment:
  ETHEREUM_RPC_URL, BASE_RPC_URL, POLYGON_RPC_URL, ARBITRUM_RPC_URL, OPTIMISM_RPC_URL
  PAYMENT_ADDRESS and PRICE_USD for x402-compatible payment metadata on /audit responses
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
