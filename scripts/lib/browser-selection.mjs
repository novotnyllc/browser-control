import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { TARGETS, targetIds } from "../../src/targets.mjs";
import { profileRoot } from "./paths.mjs";
import { extensionHostSocketMappings } from "./runtime-backends.mjs";
import { selectExtensionProfile } from "./profiles.mjs";

const execFileAsync = promisify(execFile);

export async function selectBrowserTarget(options = {}) {
  const candidates = await inspectBrowserTargets(options);
  return chooseBrowserTarget(candidates);
}

export async function inspectBrowserTargets(options = {}) {
  const connectedMappings = await extensionHostSocketMappings().catch(() => []);
  const connectedTargetIds = new Set(
    connectedMappings.map((mapping) => mapping.target?.id).filter(Boolean)
  );
  const frontmostBundleId = await currentFrontmostBundleId().catch(() => null);

  return targetIds().map((targetId) => {
    const target = TARGETS[targetId];
    const profileSelection = selectExtensionProfile(target, {
      context: options.context
    });
    const selectedProfile = profileSelection.selectedProfile;
    return {
      target,
      displayName: target.displayName,
      targetId,
      installed: browserInstalled(target),
      running: browserRunning(target),
      connected: connectedTargetIds.has(targetId),
      frontmost: frontmostBundleId != null && target.macos.bundleId === frontmostBundleId,
      profileSelection,
      extensionInstalled: profileSelection.installedProfiles.length > 0,
      selectedProfile,
      selectedProfileActiveTime: selectedProfile?.activeTime ?? null
    };
  });
}

export function chooseBrowserTarget(candidates) {
  const controllable = candidates.filter(
    (candidate) => candidate.installed && candidate.profileSelection.status === "selected"
  );

  if (controllable.length === 0) {
    return {
      status: "no-controllable-browser",
      reason: "no-installed-browser-with-selected-extension-profile",
      selected: null,
      candidates
    };
  }

  const contextMatches = controllable.filter(
    (candidate) => candidate.profileSelection.reason === "context-match"
  );
  const contextChoice = uniqueTopBy(contextMatches, candidateContextScore);
  if (contextChoice) return selected("context-match", contextChoice, candidates);

  const connectedChoice = uniqueTopBy(controllable.filter((candidate) => candidate.connected), candidateActivityTime);
  if (connectedChoice) return selected("connected-browser", connectedChoice, candidates);

  const frontmostChoice = uniqueTopBy(controllable.filter((candidate) => candidate.frontmost), candidateActivityTime);
  if (frontmostChoice) return selected("frontmost-browser", frontmostChoice, candidates);

  const runningChoice = uniqueTopBy(controllable.filter((candidate) => candidate.running), candidateActivityTime);
  if (runningChoice) return selected("running-browser-most-recent-profile", runningChoice, candidates);

  const installedChoice = uniqueTopBy(controllable, candidateActivityTime);
  if (installedChoice) return selected("installed-browser-most-recent-profile", installedChoice, candidates);

  return {
    status: "ambiguous-browser",
    reason: "multiple-browser-targets-without-clear-activity-signal",
    selected: null,
    candidates
  };
}

function selected(reason, candidate, candidates) {
  return {
    status: "selected",
    reason,
    selected: candidate,
    candidates
  };
}

function uniqueTopBy(candidates, scoreFor) {
  if (candidates.length === 0) return null;
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreFor(candidate) }))
    .sort((left, right) => right.score - left.score);
  if (scored.length === 1) return scored[0].candidate;
  return scored[0].score > scored[1].score ? scored[0].candidate : null;
}

function candidateContextScore(candidate) {
  return candidate.profileSelection.contextMatches?.[0]?.score ?? 0;
}

function candidateActivityTime(candidate) {
  return candidate.selectedProfileActiveTime ?? 0;
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

async function currentFrontmostBundleId() {
  if (process.platform !== "darwin") return null;
  const script = [
    'tell application "System Events"',
    '  set frontApp to first application process whose frontmost is true',
    '  return bundle identifier of frontApp',
    "end tell"
  ].join("\n");
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  return stdout.trim() || null;
}
