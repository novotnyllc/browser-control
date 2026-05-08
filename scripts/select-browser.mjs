#!/usr/bin/env node
import { selectBrowserTarget } from "./lib/browser-selection.mjs";
import { publicProfile } from "./lib/profiles.mjs";

function usage() {
  console.error("Usage: node scripts/select-browser.mjs [--profile-context <text>] [--json]");
}

function parseArgs(argv) {
  const args = { context: null, includeSensitive: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile-context") args.context = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--include-sensitive") args.includeSensitive = true;
    else {
      usage();
      process.exit(2);
    }
  }
  if (args.context === "") {
    throw new Error("--profile-context must not be empty");
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const selection = await selectBrowserTarget({ context: args.context });
const selected = selection.selected;
const result = {
  status: selection.status,
  reason: selection.reason,
  selected: selected
    ? {
        target: selected.targetId,
        displayName: selected.displayName,
        running: selected.running,
        connected: selected.connected,
        frontmost: selected.frontmost,
        profile: publicProfile(selected.selectedProfile, { includeSensitive: args.includeSensitive })
      }
    : null,
  candidates: selection.candidates.map((candidate) => ({
    target: candidate.targetId,
    displayName: candidate.displayName,
    installed: candidate.installed,
    running: candidate.running,
    installStatus: candidate.installStatus,
    runningStatus: candidate.runningStatus,
    connected: candidate.connected,
    frontmost: candidate.frontmost,
    profileSelectionStatus: candidate.profileSelection.status,
    profileSelectionReason: candidate.profileSelection.reason,
    profileStateStatus: candidate.profileSelection.profileStateStatus,
    profileStateError: candidate.profileSelection.profileStateError,
    selectedProfile: publicProfile(candidate.selectedProfile, { includeSensitive: args.includeSensitive }),
    installedProfiles: candidate.profileSelection.installedProfiles.map((profile) =>
      publicProfile(profile, { includeSensitive: args.includeSensitive })
    )
  }))
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else if (selected) {
  console.log(`${selected.displayName}: ${selected.selectedProfile.profileDirectory}`);
  console.log(`reason: ${selection.reason}`);
} else {
  console.log(`browser selection: ${selection.status}`);
  console.log(`reason: ${selection.reason}`);
}

process.exit(selection.status === "selected" ? 0 : 2);
