#!/usr/bin/env node
import { existsSync } from "node:fs";

import { getTarget } from "../src/targets.mjs";
import {
  assertBundledBrowserUseAvailable,
  assertReadableFile,
  extensionHostPath
} from "./lib/paths.mjs";
import { installNativeHostManifest, nativeHostStatus } from "./lib/native-host-status.mjs";

function usage() {
  console.error(
    "Usage: node scripts/native-host.mjs --target <id> (--check|--install) [--extension-host <path>] [--json]"
  );
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(argv) {
  const args = { check: false, install: false, json: false, target: null, extensionHost: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = readValue(argv, i++, arg);
    else if (arg === "--check") args.check = true;
    else if (arg === "--install") args.install = true;
    else if (arg === "--extension-host") args.extensionHost = readValue(argv, i++, arg);
    else if (arg === "--json") args.json = true;
    else {
      usage();
      process.exit(2);
    }
  }
  if (!args.target || args.check === args.install) {
    usage();
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const target = getTarget(args.target);
const options = { extensionHost: args.extensionHost };

if (args.install) {
  if (!args.extensionHost && !process.env.CODEX_BROWSER_CONTROL_EXTENSION_HOST) {
    assertBundledBrowserUseAvailable();
  }
  const hostPath = extensionHostPath(options);
  assertReadableFile(hostPath, "extension host");
  await installNativeHostManifest(target, options);
}

const result = nativeHostStatus(target, options);
if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${target.displayName} native host manifest: ${result.matches ? "ok" : "not ok"}`);
  console.log(`manifest: ${result.manifestPath}`);
  console.log(`extension host: ${result.extensionHostPath}`);
  if (!existsSync(result.extensionHostPath)) console.log("extension host: missing");
}

process.exit(result.matches ? 0 : 1);
