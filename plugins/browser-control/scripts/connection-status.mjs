#!/usr/bin/env node
import { getTarget } from "../src/targets.mjs";
import { connectionStatusForTarget } from "./lib/connection-status-core.mjs";

function usage() {
  console.error("Usage: node scripts/connection-status.mjs --target <id> [--profile-directory <name>] [--profile-context <text>] [--json]");
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const args = { context: null, includeSensitive: false, json: false, profileDirectory: null, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = readValue(argv, i++, arg);
    else if (arg === "--profile-directory") args.profileDirectory = readValue(argv, i++, arg);
    else if (arg === "--profile-context") args.context = readValue(argv, i++, arg);
    else if (arg === "--json") args.json = true;
    else if (arg === "--include-sensitive") args.includeSensitive = true;
    else {
      usage();
      process.exit(2);
    }
  }
  if (!args.target) {
    usage();
    process.exit(2);
  }
  if (args.profileDirectory === "") {
    throw new Error("--profile-directory must not be empty");
  }
  if (args.context === "") {
    throw new Error("--profile-context must not be empty");
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const target = getTarget(args.target);
const result = await connectionStatusForTarget({
  target,
  context: args.context,
  profileDirectory: args.profileDirectory,
  includeSensitive: args.includeSensitive
});

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${target.displayName}: ${result.status}`);
  console.log(`browser installed: ${result.installed ? "yes" : "no"}`);
  console.log(`browser running: ${result.running ? "yes" : "no"}`);
  console.log(`extension installed: ${result.extensionInstalled ? "yes" : "no"}`);
  console.log(`native host manifest: ${result.nativeHostMatches ? "ok" : "missing or mismatched"}`);
}

process.exit(result.status === "connected" ? 0 : 3);
