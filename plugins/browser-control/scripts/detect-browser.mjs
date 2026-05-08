#!/usr/bin/env node
import { getTarget } from "../src/targets.mjs";
import { browserInstallationStatus, browserRunningStatus } from "./lib/browser-detection.mjs";
import { profileRoot } from "./lib/paths.mjs";

function usage() {
  console.error("Usage: node scripts/detect-browser.mjs --target <id> [--json]");
}

function parseArgs(argv) {
  const args = { includeSensitive: false, json: false, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = argv[++i];
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
  return args;
}

const args = parseArgs(process.argv.slice(2));
const target = getTarget(args.target);
const installStatus = browserInstallationStatus(target, { includeSensitive: args.includeSensitive });
const runningStatus = browserRunningStatus(target, { includeSensitive: args.includeSensitive });
const result = {
  target: target.id,
  displayName: target.displayName,
  installed: installStatus.installed,
  running: runningStatus.running,
  installStatus,
  runningStatus,
  ...(args.includeSensitive ? { executablePath: installStatus.executablePath } : {}),
  profileRoot: profileRoot(target),
  macosBundleId: target.macos.bundleId
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${target.displayName} installed: ${result.installed ? "yes" : "no"}`);
  console.log(`${target.displayName} running: ${result.running ? "yes" : "no"}`);
}
