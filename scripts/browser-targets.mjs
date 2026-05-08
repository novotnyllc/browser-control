#!/usr/bin/env node
import { getTarget, TARGETS, targetIds } from "../src/targets.mjs";

function usage() {
  console.error("Usage: node scripts/browser-targets.mjs [--target <id>] [--json]");
}

function parseArgs(argv) {
  const args = { json: false, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--target") args.target = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else {
      usage();
      process.exit(2);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const payload = args.target ? getTarget(args.target) : TARGETS;

if (args.json) {
  console.log(JSON.stringify(payload, null, 2));
} else if (args.target) {
  const target = payload;
  console.log(`${target.id}: ${target.displayName}`);
  console.log(`macOS bundle: ${target.macos.bundleId}`);
  console.log(`macOS app: ${target.macos.appName}`);
} else {
  for (const id of targetIds()) {
    console.log(`${id}\t${TARGETS[id].displayName}`);
  }
}
