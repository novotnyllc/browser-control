#!/usr/bin/env node
import { selectBrowserTarget } from "./lib/browser-selection.mjs";

function usage() {
  console.error("Usage: node scripts/select-browser.mjs [--profile-context <text>] [--json]");
}

function parseArgs(argv) {
  const args = { context: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--profile-context") args.context = argv[++i];
    else if (arg === "--json") args.json = true;
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
        profile: selected.selectedProfile
      }
    : null,
  candidates: selection.candidates.map((candidate) => ({
    target: candidate.targetId,
    displayName: candidate.displayName,
    installed: candidate.installed,
    running: candidate.running,
    connected: candidate.connected,
    frontmost: candidate.frontmost,
    profileSelectionStatus: candidate.profileSelection.status,
    profileSelectionReason: candidate.profileSelection.reason,
    selectedProfile: candidate.selectedProfile
      ? {
          displayLabel: candidate.selectedProfile.displayLabel,
          profileDirectory: candidate.selectedProfile.profileDirectory,
          activeTime: candidate.selectedProfile.activeTime
        }
      : null,
    installedProfiles: candidate.profileSelection.installedProfiles.map((profile) => ({
      displayLabel: profile.displayLabel,
      profileDirectory: profile.profileDirectory,
      activeTime: profile.activeTime
    }))
  }))
};

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else if (selected) {
  console.log(`${selected.displayName}: ${selected.selectedProfile.displayLabel}`);
  console.log(`reason: ${selection.reason}`);
} else {
  console.log(`browser selection: ${selection.status}`);
  console.log(`reason: ${selection.reason}`);
}

process.exit(selection.status === "selected" ? 0 : 2);
