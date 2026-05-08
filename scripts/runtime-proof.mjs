#!/usr/bin/env node
import { getTarget } from "../src/targets.mjs";
import { assertReadableFile, bundledBrowserClientPath } from "./lib/paths.mjs";
import { enrichBackendsFromProcesses } from "./lib/runtime-backends.mjs";

function usage() {
  console.error("Usage: node scripts/runtime-proof.mjs --target <id> [--json]");
}

function parseArgs(argv) {
  const args = { json: false, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = argv[++i];
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
const enriched = await enrichBackendsFromProcesses(agent);
const selected = enriched.find((browser) => browser.resolved && browser.backend.targetId === target.id);
if (!selected) {
  const available = enriched.map((browser) => ({
    id: browser.info.id,
    reportedName: browser.info.name,
    resolved: browser.resolved,
    targetId: browser.backend.targetId,
    identitySource: browser.backend.identitySource
  }));
  throw new Error(`No connected Browser Use extension backend matched ${target.displayName}: ${JSON.stringify(available)}`);
}

const browser = await agent.browsers.get(selected.info.id);
const tabs = await browser.user.openTabs();
const tabSummary = tabs.slice(0, 5).map((tab) => ({
  title: tab.title,
  url: tab.url
}));
const result = {
  target: target.id,
  displayName: target.displayName,
  browserClientTrusted: true,
  selectedBrowser: selected.backend,
  openTabsCount: tabs.length,
  tabSummary
};

if (args.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`${target.displayName}: connected`);
  console.log(`browser: ${selected.backend.name} (${selected.info.id})`);
  console.log(`open tabs: ${tabs.length}`);
}
