import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { profileRoot } from "./paths.mjs";

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function browserProfileState(root) {
  const localState = path.join(root, "Local State");
  if (!existsSync(localState)) {
    return { lastUsedProfile: null, profileInfo: {}, profilesOrder: [] };
  }

  const state = readJson(localState);
  return {
    lastUsedProfile: state.profile?.last_used ?? null,
    profileInfo: state.profile?.info_cache ?? {},
    profilesOrder: state.profile?.profiles_order ?? []
  };
}

export function candidateProfiles(root) {
  const state = browserProfileState(root);
  const candidates = [];
  if (state.lastUsedProfile) candidates.push(state.lastUsedProfile);
  for (const profile of state.profilesOrder) candidates.push(profile);

  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "Default" || /^Profile \d+$/.test(entry.name)) {
        candidates.push(entry.name);
      }
    }
  }

  return [...new Set(candidates)];
}

export function inspectProfile(root, profile, extensionId, profileInfo = {}) {
  const metadata = profileMetadata(profile, profileInfo[profile]);
  const extensionDir = path.join(root, profile, "Extensions", extensionId);
  const settingsDir = path.join(root, profile, "Local Extension Settings", extensionId);
  const versions =
    existsSync(extensionDir)
      ? readdirSync(extensionDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      : [];
  return {
    displayLabel: profileDisplayLabel(metadata),
    profileDirectory: profile,
    profileName: metadata.profileName,
    user: metadata.user,
    gaiaName: metadata.gaiaName,
    hostedDomain: metadata.hostedDomain,
    activeTime: metadata.activeTime,
    extensionDir,
    settingsDir,
    installed: versions.length > 0,
    hasLocalExtensionSettings: existsSync(settingsDir),
    versions
  };
}

export function inspectExtensionProfiles(target) {
  const root = profileRoot(target);
  const state = browserProfileState(root);
  return candidateProfiles(root).map((profile) =>
    inspectProfile(root, profile, target.extensionDiscovery.extensionId, state.profileInfo)
  );
}

export function selectExtensionProfile(target, options = {}) {
  const root = profileRoot(target);
  const state = browserProfileState(root);
  const profiles = inspectExtensionProfiles(target);

  return chooseExtensionProfile({
    context: options.context,
    lastUsedProfile: state.lastUsedProfile,
    profileDirectory: options.profileDirectory,
    profiles,
    inspectRequestedProfile: (profileDirectory) =>
      inspectProfile(root, profileDirectory, target.extensionDiscovery.extensionId, state.profileInfo)
  });
}

export function chooseExtensionProfile({
  context = null,
  lastUsedProfile,
  profileDirectory = null,
  profiles,
  inspectRequestedProfile
}) {
  const installedProfiles = profiles.filter((profile) => profile.installed);

  if (profileDirectory) {
    const selectedProfile =
      profiles.find((profile) => profile.profileDirectory === profileDirectory) ??
      inspectRequestedProfile(profileDirectory);
    return {
      status: selectedProfile.installed ? "selected" : "requested-profile-not-installed",
      reason: "explicit-profile",
      selectedProfile,
      contextMatches: [],
      lastUsedProfile,
      installedProfiles,
      profiles
    };
  }

  const contextMatches = rankProfilesForContext(installedProfiles, context);
  const contextWinner = contextMatches[0];
  if (
    contextWinner &&
    contextWinner.score >= 3 &&
    (contextMatches[1]?.score ?? 0) < contextWinner.score
  ) {
    return {
      status: "selected",
      reason: "context-match",
      selectedProfile: contextWinner.profile,
      contextMatches,
      lastUsedProfile,
      installedProfiles,
      profiles
    };
  }

  const lastUsedInstalled = installedProfiles.find(
    (profile) => profile.profileDirectory === lastUsedProfile
  );
  if (lastUsedInstalled) {
    return {
      status: "selected",
      reason: "last-used-profile",
      selectedProfile: lastUsedInstalled,
      contextMatches,
      lastUsedProfile,
      installedProfiles,
      profiles
    };
  }

  if (installedProfiles.length === 1) {
    return {
      status: "selected",
      reason: "only-installed-profile",
      selectedProfile: installedProfiles[0],
      contextMatches,
      lastUsedProfile,
      installedProfiles,
      profiles
    };
  }

  return {
    status: installedProfiles.length > 1 ? "ambiguous-profile" : "no-extension-installed",
    reason: installedProfiles.length > 1 ? "multiple-installed-profiles" : "extension-not-found",
    selectedProfile: null,
    contextMatches,
    lastUsedProfile,
    installedProfiles,
    profiles
  };
}

export function rankProfilesForContext(profiles, context) {
  const normalizedContext = normalizeText(context);
  if (!normalizedContext) return [];

  return profiles
    .map((profile) => {
      const terms = profileMatchTerms(profile);
      const matchedTerms = terms.filter((term) => contextMatchesTerm(normalizedContext, term.value));
      const score = matchedTerms.reduce((sum, term) => sum + term.weight, 0);
      return {
        profile,
        score,
        matchedTerms: matchedTerms.map((term) => term.value)
      };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score);
}

function profileMatchTerms(profile) {
  const terms = [];
  addTerm(terms, profile.profileName, 2);
  addTerm(terms, profile.user, 4);
  addTerm(terms, profile.gaiaName, 1);
  addTerm(terms, profile.hostedDomain, 3);
  if (profile.user?.includes("@")) {
    addTerm(terms, profile.user.split("@").at(1), 3);
    addTerm(terms, profile.user.split("@").at(0), 1);
  }
  return dedupeTerms(terms);
}

function addTerm(terms, value, weight) {
  const normalized = normalizeText(value);
  if (!normalized) return;
  terms.push({ value: normalized, weight });
  const compact = normalized.replace(/[.\s@]+/g, "");
  if (compact !== normalized) terms.push({ value: compact, weight });
}

function dedupeTerms(terms) {
  const byValue = new Map();
  for (const term of terms) {
    const existing = byValue.get(term.value);
    if (!existing || term.weight > existing.weight) byValue.set(term.value, term);
  }
  return Array.from(byValue.values());
}

function contextMatchesTerm(context, term) {
  if (term.length < 3) return false;
  return context.includes(term) || (context.length >= 4 && term.includes(context));
}

function normalizeText(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9@.]+/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

export function profileMetadata(profileDirectory, info = {}) {
  const profileName = cleanString(info.name) ?? profileDirectory;
  const user = cleanString(info.user_name) ?? cleanString(info.email);
  const gaiaName = cleanString(info.gaia_name);
  const hostedDomain = cleanString(info.hosted_domain);
  const activeTime = typeof info.active_time === "number" ? info.active_time : null;
  return {
    profileDirectory,
    profileName,
    user,
    gaiaName,
    hostedDomain: hostedDomain === "NO_HOSTED_DOMAIN" ? null : hostedDomain,
    activeTime
  };
}

export function profileDisplayLabel(metadata) {
  return [metadata.profileName, metadata.user].filter(Boolean).join(" - ");
}

function cleanString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
