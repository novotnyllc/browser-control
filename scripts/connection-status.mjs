#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { getTarget } from "../src/targets.mjs";
import { extensionHostSocketMappings } from "./lib/runtime-backends.mjs";
import { manifestFor, nativeHostManifestPath, profileRoot } from "./lib/paths.mjs";
import { readJson, selectExtensionProfile } from "./lib/profiles.mjs";

function usage() {
  console.error("Usage: node scripts/connection-status.mjs --target <id> [--profile-directory <name>] [--profile-context <text>] [--json]");
}

function parseArgs(argv) {
  const args = { context: null, json: false, profileDirectory: null, target: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = argv[++i];
    else if (arg === "--profile-directory") args.profileDirectory = argv[++i];
    else if (arg === "--profile-context") args.context = argv[++i];
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
  if (args.profileDirectory === "") {
    throw new Error("--profile-directory must not be empty");
  }
  if (args.context === "") {
    throw new Error("--profile-context must not be empty");
  }
  return args;
}

function browserInstalled(target) {
  if (process.platform === "darwin") {
    return existsSync(path.resolve("/Applications", target.macos.appName));
  }
  return existsSync(profileRoot(target));
}

function browserRunning(target) {
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

function nativeHostInstalled(target) {
  const manifestPath = nativeHostManifestPath(target);
  if (!existsSync(manifestPath)) return { installed: false, matches: false, manifestPath };

  const actual = readJson(manifestPath);
  const expected = manifestFor(target);
  return {
    installed: true,
    matches: JSON.stringify(actual) === JSON.stringify(expected),
    manifestPath
  };
}

const args = parseArgs(process.argv.slice(2));
const target = getTarget(args.target);
const selection = selectExtensionProfile(target, {
  context: args.context,
  profileDirectory: args.profileDirectory
});
const connected = (await extensionHostSocketMappings())
  .filter((mapping) => mapping.target?.id === target.id)
  .map((mapping) => ({
    extensionHostPid: mapping.extensionHostPid,
    parentPid: mapping.parentPid
  }));
const nativeHost = nativeHostInstalled(target);
const result = {
  target: target.id,
  displayName: target.displayName,
  installed: browserInstalled(target),
  running: browserRunning(target),
  extensionInstalled: selection.installedProfiles.length > 0,
  profileSelectionStatus: selection.status,
  profileSelectionReason: selection.reason,
  contextMatches: selection.contextMatches,
  lastUsedProfile: selection.lastUsedProfile,
  selectedProfile: selection.selectedProfile,
  extensionProfiles: selection.installedProfiles,
  nativeHostInstalled: nativeHost.installed,
  nativeHostMatches: nativeHost.matches,
  nativeHostManifestPath: nativeHost.manifestPath,
  connected: connected.length > 0,
  connections: connected,
  status:
    selection.status !== "selected"
      ? selection.status
      : connected.length > 0
      ? "connected"
      : "existing-profile-not-connected"
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${target.displayName}: ${result.status}`);
  console.log(`browser installed: ${result.installed ? "yes" : "no"}`);
  console.log(`browser running: ${result.running ? "yes" : "no"}`);
  console.log(`extension installed: ${result.extensionInstalled ? "yes" : "no"}`);
  console.log(`native host manifest: ${result.nativeHostMatches ? "ok" : "missing or mismatched"}`);
}

process.exit(result.connected ? 0 : 3);
