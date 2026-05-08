#!/usr/bin/env node

import { getTarget } from "../src/targets.mjs";
import { profileRoot } from "./lib/paths.mjs";
import { publicContextMatches, publicProfile, selectExtensionProfile } from "./lib/profiles.mjs";

function usage() {
  console.error("Usage: node scripts/check-extension.mjs --target <id> [--profile-directory <name>] [--profile-context <text>] [--json]");
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
const root = profileRoot(target);
const selection = selectExtensionProfile(target, {
  context: args.context,
  profileDirectory: args.profileDirectory
});
const result = {
  target: target.id,
  displayName: target.displayName,
  profileRoot: root,
  extensionId: target.extensionDiscovery.extensionId,
  installed: selection.selectedProfile?.installed ?? selection.installedProfiles.length > 0,
  selectionStatus: selection.status,
  selectionReason: selection.reason,
  profileStateStatus: selection.profileStateStatus,
  profileStateError: selection.profileStateError,
  contextMatches: publicContextMatches(selection.contextMatches, { includeSensitive: args.includeSensitive }),
  lastUsedProfile: selection.lastUsedProfile,
  selectedProfile: publicProfile(selection.selectedProfile, { includeSensitive: args.includeSensitive }),
  installedProfiles: selection.installedProfiles.map((profile) => publicProfile(profile, { includeSensitive: args.includeSensitive })),
  profiles: selection.profiles.map((profile) => publicProfile(profile, { includeSensitive: args.includeSensitive }))
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`${target.displayName} extension installed: ${result.installed ? "yes" : "no"}`);
  console.log(`profile selection: ${result.selectionStatus}`);
  if (result.profileStateStatus !== "ok") console.log(`profile state: ${result.profileStateStatus}`);
  if (result.selectedProfile) console.log(`profile: ${result.selectedProfile.profileDirectory}`);
}

process.exit(result.selectionStatus === "selected" ? 0 : 2);
