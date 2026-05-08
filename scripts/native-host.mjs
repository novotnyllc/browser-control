#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getTarget } from "../src/targets.mjs";
import {
  assertBundledBrowserUseAvailable,
  assertReadableFile,
  extensionHostPath,
  manifestFor,
  nativeHostManifestPath,
  nativeHostRegistryKey
} from "./lib/paths.mjs";

function usage() {
  console.error(
    "Usage: node scripts/native-host.mjs --target <id> (--check|--install) [--extension-host <path>] [--json]"
  );
}

function parseArgs(argv) {
  const args = { check: false, install: false, json: false, target: null, extensionHost: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = argv[++i];
    else if (arg === "--check") args.check = true;
    else if (arg === "--install") args.install = true;
    else if (arg === "--extension-host") args.extensionHost = argv[++i];
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

function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function registryStatus(target, manifestPath) {
  if (process.platform !== "win32") return null;
  const key = nativeHostRegistryKey(target);
  try {
    const output = execFileSync("reg", ["query", key, "/ve"], { encoding: "utf8" });
    return {
      key,
      installed: true,
      matches: output.includes(manifestPath),
      actual: output.trim()
    };
  } catch {
    return {
      key,
      installed: false,
      matches: false,
      actual: null
    };
  }
}

function manifestStatus(target, options) {
  const expected = manifestFor(target, options);
  const manifestPath = nativeHostManifestPath(target);
  const actual = readManifest(manifestPath);
  const registry = registryStatus(target, manifestPath);
  const matches =
    actual?.name === expected.name &&
    actual?.type === expected.type &&
    actual?.path === expected.path &&
    Array.isArray(actual?.allowed_origins) &&
    actual.allowed_origins.includes(expected.allowed_origins[0]) &&
    (registry?.matches ?? true);
  return {
    target: target.id,
    displayName: target.displayName,
    manifestPath,
    registryKey: registry?.key ?? null,
    registry,
    extensionHostPath: expected.path,
    extensionHostExists: existsSync(expected.path),
    installed: actual != null,
    matches,
    expected,
    actual
  };
}

const args = parseArgs(process.argv.slice(2));
const target = getTarget(args.target);
const options = { extensionHost: args.extensionHost };
if (!args.extensionHost && !process.env.CODEX_BROWSER_CONTROL_EXTENSION_HOST) {
  assertBundledBrowserUseAvailable();
}

if (args.install) {
  const hostPath = extensionHostPath(options);
  assertReadableFile(hostPath, "extension host");
  const manifestPath = nativeHostManifestPath(target);
  const manifest = manifestFor(target, options);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  if (process.platform === "win32") {
    execFileSync("reg", ["add", nativeHostRegistryKey(target), "/ve", "/d", manifestPath, "/f"], {
      stdio: "ignore"
    });
  }
}

const result = manifestStatus(target, options);
if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${target.displayName} native host manifest: ${result.matches ? "ok" : "not ok"}`);
  console.log(`manifest: ${result.manifestPath}`);
  console.log(`extension host: ${result.extensionHostPath}`);
}

process.exit(result.matches ? 0 : 1);
