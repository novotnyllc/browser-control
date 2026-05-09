import { browserInstallationStatus, browserRunningStatus, runningProcessTreeSnapshot } from "./browser-detection.mjs";
import { nativeHostStatus } from "./native-host-status.mjs";
import { extensionHostSocketMappings } from "./runtime-backends.mjs";
import { publicContextMatches, publicProfile, selectExtensionProfile } from "./profiles.mjs";

export function publicNativeHost(status, options = {}) {
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

export async function connectedMappingsFor(target, options = {}) {
  const currentPlatform = options.platform ?? process.platform;
  if (currentPlatform === "win32") {
    return { mappings: [], observable: false, reason: "windows-unix-socket-observation-unavailable", error: null };
  }
  const socketMappings = options.extensionHostSocketMappings ?? extensionHostSocketMappings;
  try {
    const mappings = await socketMappings(options.mappingOptions ?? {});
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

function withSharedProcessTree(options, processTreeSnapshot) {
  if (!Array.isArray(processTreeSnapshot)) return options;
  return {
    ...options,
    mappingOptions: {
      ...(options.mappingOptions ?? {}),
      processTreeSnapshot
    }
  };
}

export async function connectionStatusForTarget({
  target,
  context = null,
  profileDirectory = null,
  includeSensitive = false,
  deps = {}
}) {
  const selectProfile = deps.selectExtensionProfile ?? selectExtensionProfile;
  const installStatusFor = deps.browserInstallationStatus ?? browserInstallationStatus;
  const runningStatusFor = deps.browserRunningStatus ?? browserRunningStatus;
  const nativeHostStatusFor = deps.nativeHostStatus ?? nativeHostStatus;
  const connectedMappingsForTarget = deps.connectedMappingsFor ?? connectedMappingsFor;
  const getProcessTreeSnapshot = deps.runningProcessTreeSnapshot ?? runningProcessTreeSnapshot;

  const selection = selectProfile(target, { context, profileDirectory });
  const installStatus = installStatusFor(target, { includeSensitive });
  const shouldShareProcessTree = Boolean(deps.runningProcessTreeSnapshot)
    || runningStatusFor === browserRunningStatus
    || connectedMappingsForTarget === connectedMappingsFor;
  const processTreeSnapshot = shouldShareProcessTree
    ? getProcessTreeSnapshot(deps.runningProcessTreeSnapshotOptions ?? {})
    : null;
  const runningStatus = runningStatusFor(target, {
    includeSensitive,
    ...(processTreeSnapshot ? { processes: processTreeSnapshot } : {})
  });
  const nativeHost = nativeHostStatusFor(target);
  const connectedMappingsOptions = withSharedProcessTree(
    deps.connectedMappingsOptions ?? {},
    processTreeSnapshot
  );
  const connectionObservation = await connectedMappingsForTarget(target, connectedMappingsOptions);
  const connected = connectionObservation.mappings.map((mapping) => ({
    extensionHostPid: mapping.extensionHostPid,
    parentPid: mapping.parentPid
  }));
  const status = selection.status !== "selected"
    ? selection.status
    : !connectionObservation.observable
    ? "connection-observation-unsupported"
    : connected.length > 0
    ? "connected"
    : "existing-profile-not-connected";

  return {
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
    contextMatches: publicContextMatches(selection.contextMatches, { includeSensitive }),
    lastUsedProfile: selection.lastUsedProfile,
    selectedProfile: publicProfile(selection.selectedProfile, { includeSensitive }),
    extensionProfiles: selection.installedProfiles.map((profile) => publicProfile(profile, { includeSensitive })),
    nativeHost: publicNativeHost(nativeHost, { includeSensitive }),
    nativeHostInstalled: nativeHost.installed,
    nativeHostMatches: nativeHost.matches,
    nativeHostReady: nativeHost.ready,
    ...(includeSensitive ? { nativeHostManifestPath: nativeHost.manifestPath } : {}),
    connectionObservable: connectionObservation.observable,
    connectionObservationReason: connectionObservation.reason,
    connectionObservationError: connectionObservation.error,
    connected: connected.length > 0,
    connections: connected,
    status
  };
}
