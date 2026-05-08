#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { getTarget } from "../src/targets.mjs";
import { profileRoot } from "./lib/paths.mjs";

function usage() {
  console.error("Usage: node scripts/detect-browser.mjs --target <id> [--json]");
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

function macosAppPath(target) {
  return path.resolve("/Applications", target.macos.appName);
}

function isRunning(target) {
  if (process.platform === "win32") {
    const output = execFileSync(
      "tasklist",
      ["/fo", "csv", "/nh", "/fi", `imagename eq ${target.windows.executable}`],
      { encoding: "utf8" }
    );
    return target.windows.processNames.some((name) =>
      output.toLowerCase().includes(name.toLowerCase())
    );
  }

  const output = execFileSync("ps", ["-axo", "comm,args"], { encoding: "utf8" });
  const patterns =
    process.platform === "darwin"
      ? target.macos.processNames
      : target.linux.processNames;
  return patterns.some((pattern) => output.includes(pattern));
}

const args = parseArgs(process.argv.slice(2));
const target = getTarget(args.target);
const appPath = process.platform === "darwin" ? macosAppPath(target) : null;
const result = {
  target: target.id,
  displayName: target.displayName,
  installed:
    process.platform === "darwin" ? existsSync(appPath) : existsSync(profileRoot(target)),
  running: isRunning(target),
  appPath,
  profileRoot: profileRoot(target),
  macosBundleId: target.macos.bundleId
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${target.displayName} installed: ${result.installed ? "yes" : "no"}`);
  console.log(`${target.displayName} running: ${result.running ? "yes" : "no"}`);
}
