#!/usr/bin/env node
import { getTarget } from "../src/targets.mjs";
import { browserInstallationStatus, browserRunningStatus } from "./lib/browser-detection.mjs";
import { nativeHostStatus } from "./lib/native-host-status.mjs";
import { extensionHostSocketMappings } from "./lib/runtime-backends.mjs";
import { publicContextMatches, publicProfile, selectExtensionProfile } from "./lib/profiles.mjs";

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

function publicNativeHost(status, options = {}) {
  if (options.includeSensitive) return status;
  return {
    installed: status.installed,
    matches: status.matches,
    ready: status.ready,
    reasons: status.reasons,
    registry: status.registry
      ? {
          installed: status.registry.installed,
          matches: status.registry.matches
        }
      : null
  };
}

async function connectedMappingsFor(target) {
  if (process.platform === "win32") {
    return { mappings: [], observable: false, reason: "windows-unix-socket-observation-unavailable", error: null };
  }
  try {
    const mappings = await extensionHostSocketMappings();
    return {
      mappings: mappings.filter((mapping) => mapping.target?.id === target.id),
      observable: true,
      reason: null,
      error: null
    };
  } catch (error) {
    return {
      mappings: [],
      observable: false,
      reason: "socket-observation-error",
      error: { code: error.code, message: error.message }
    };
  }
}

const args = parseArgs(process.argv.slice(2));
const target = getTarget(args.target);
const selection = selectExtensionProfile(target, {
  context: args.context,
  profileDirectory: args.profileDirectory
});
const connectionObservation = await connectedMappingsFor(target);
const connected = connectionObservation.mappings.map((mapping) => ({
  extensionHostPid: mapping.extensionHostPid,
  parentPid: mapping.parentPid
}));
const installStatus = browserInstallationStatus(target, { includeSensitive: args.includeSensitive });
const runningStatus = browserRunningStatus(target, { includeSensitive: args.includeSensitive });
const nativeHost = nativeHostStatus(target);
const status = selection.status !== "selected"
  ? selection.status
  : !connectionObservation.observable
  ? "connection-observation-unsupported"
  : connected.length > 0
  ? "connected"
  : "existing-profile-not-connected";
const result = {
  target: target.id,
  displayName: target.displayName,
  installed: installStatus.installed,
  running: runningStatus.running,
  installStatus,
  runningStatus,
  extensionInstalled: selection.installedProfiles.length > 0,
  profileSelectionStatus: selection.status,
  profileSelectionReason: selection.reason,
  profileStateStatus: selection.profileStateStatus,
  profileStateError: selection.profileStateError,
  contextMatches: publicContextMatches(selection.contextMatches, { includeSensitive: args.includeSensitive }),
  lastUsedProfile: selection.lastUsedProfile,
  selectedProfile: publicProfile(selection.selectedProfile, { includeSensitive: args.includeSensitive }),
  extensionProfiles: selection.installedProfiles.map((profile) => publicProfile(profile, { includeSensitive: args.includeSensitive })),
  nativeHost: publicNativeHost(nativeHost, { includeSensitive: args.includeSensitive }),
  nativeHostInstalled: nativeHost.installed,
  nativeHostMatches: nativeHost.matches,
  nativeHostReady: nativeHost.ready,
  ...(args.includeSensitive ? { nativeHostManifestPath: nativeHost.manifestPath } : {}),
  connectionObservable: connectionObservation.observable,
  connectionObservationReason: connectionObservation.reason,
  connectionObservationError: connectionObservation.error,
  connected: connected.length > 0,
  connections: connected,
  status
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

process.exit(result.status === "connected" ? 0 : 3);
