#!/usr/bin/env node
import { getTarget } from "../src/targets.mjs";
import { assertReadableFile, bundledBrowserClientPath } from "./lib/paths.mjs";
import { runRuntimeProof } from "./lib/runtime-proof-runner.mjs";

function usage() {
  console.error("Usage: node scripts/runtime-proof.mjs --target <id> [--include-tabs] [--json]");
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const args = { includeTabs: false, json: false, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = readValue(argv, i++, arg);
    else if (arg === "--include-tabs") args.includeTabs = true;
    else if (arg === "--json") args.json = true;
    else {
      usage();
      process.exit(2);
    }
  }
  if (!args.target) {
    usage();
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const target = getTarget(args.target);
const browserClientPath = bundledBrowserClientPath();
assertReadableFile(browserClientPath, "trusted Browser Use browser-client");

const { setupAtlasRuntime } = await import(browserClientPath);
await setupAtlasRuntime({ globals: globalThis });
const agentLike = typeof agent !== "undefined" ? agent : globalThis.agent;
if (!agentLike) throw new Error("Trusted Browser Use runtime did not expose an agent");

const result = await runRuntimeProof({
  target,
  agentLike,
  includeTabs: args.includeTabs
});

if (args.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`${target.displayName}: connected`);
  console.log(`browser: ${result.selectedBrowser.name} (${result.selectedBrowser.id})`);
  if (args.includeTabs) console.log(`open tabs: ${result.openTabsCount}`);
  else console.log("tab inspection: not requested");
}
