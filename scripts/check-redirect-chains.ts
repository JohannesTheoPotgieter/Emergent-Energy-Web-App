/**
 * Redirect Chain Checker
 *
 * Detects multi-hop redirect chains (A → B → C) in LEGACY_REDIRECTS and PAGE_REGISTRY.
 * Run: npx tsx scripts/check-redirect-chains.ts
 *
 * Exit code 0: No chains found
 * Exit code 1: Chains detected (needs fixing)
 */

import { LEGACY_REDIRECTS, PAGE_REGISTRY } from "../client/src/config/page-registry";

// Build a redirect map: source → target
const redirectMap = new Map<string, string>();

for (const r of LEGACY_REDIRECTS) {
  redirectMap.set(r.path, r.redirectTo);
}

for (const p of PAGE_REGISTRY) {
  if (p.redirectTo) {
    redirectMap.set(p.path, p.redirectTo);
  }
}

// Detect chains: if a redirect target is also a redirect source, that's a chain
let chainCount = 0;

for (const [source, target] of redirectMap) {
  const chain: string[] = [source, target];
  let current = target;

  // Follow the chain (max 10 hops to prevent infinite loops)
  for (let i = 0; i < 10; i++) {
    // Strip query params for lookup
    const cleanTarget = current.split("?")[0];
    const next = redirectMap.get(cleanTarget);
    if (!next) break;
    chain.push(next);
    current = next;
  }

  if (chain.length > 2) {
    chainCount++;
    console.error(`CHAIN: ${chain.join(" → ")}`);
  }
}

console.log(`\nScanned ${redirectMap.size} redirect definitions.`);
console.log(`LEGACY_REDIRECTS: ${LEGACY_REDIRECTS.length}`);
console.log(`PAGE_REGISTRY aliases: ${PAGE_REGISTRY.filter(p => p.redirectTo).length}`);

if (chainCount > 0) {
  console.error(`\n${chainCount} multi-hop chain(s) detected. Collapse them to direct redirects.`);
  process.exit(1);
} else {
  console.log("\nNo multi-hop chains detected.");
  process.exit(0);
}
