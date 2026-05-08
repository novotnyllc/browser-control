import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { platform } from "node:os";
import { join, sep } from "node:path";
import { promisify } from "node:util";

import { getTarget } from "../../src/targets.mjs";
import { targetFromBrowserProcessArgs } from "./browser-detection.mjs";

const execFileAsync = promisify(execFile);
const BROWSER_USE_SOCKET_DIR_NAME = "codex-browser-use";

export async function listExtensionBackends(agentLike) {
  return (await agentLike.browsers.list()).filter((info) => info.type === "extension");
}

export async function snapshotExtensionBackends(agentLike) {
  const infos = await listExtensionBackends(agentLike);
  const snapshots = [];
  for (const info of infos) {
    const browser = await agentLike.browsers.get(info.id);
    snapshots.push({
      info,
      openTabs: await browser.user.openTabs()
    });
  }
  return snapshots;
}

export async function enrichBackendsFromProcesses(agentLike, options = {}) {
  const infos = await listExtensionBackends(agentLike);
  const mappings = await extensionHostSocketMappings(options);

  return infos.map((info) => {
    const match = deterministicProcessMapping(info, infos, mappings);
    if (!match.mapping) {
      return unresolved({ info }, match.reason, {
        extensionBackendCount: infos.length,
        extensionHostSocketCount: mappings.length,
        mappedTargets: mappings.map((mapping) => ({
          extensionHostPid: mapping.extensionHostPid,
          parentPid: mapping.parentPid,
          targetId: mapping.target?.id ?? null
        })),
        ...(match.pid ? { extensionHostPid: match.pid } : {})
      });
    }

    const mapping = match.mapping;
    if (!mapping.target) {
      return unresolved({ info }, "unmatched-extension-host-process", {
        extensionHostPid: mapping.extensionHostPid,
        parentPid: mapping.parentPid
      });
    }

    return {
      info,
      backend: {
        ...info,
        reportedName: info.name,
        name: mapping.target.displayName,
        targetId: mapping.target.id,
        family: mapping.target.family,
        channel: mapping.target.channel,
        identitySource: "extension-host-parent-process",
        process: {
          extensionHostPid: mapping.extensionHostPid,
          parentPid: mapping.parentPid
        }
      },
      resolved: true,
      process: {
        extensionHostPid: mapping.extensionHostPid,
        parentPid: mapping.parentPid
      }
    };
  });
}

export async function enrichBackendsFromExistingTabs(agentLike, targetInventories) {
  const snapshots = await snapshotExtensionBackends(agentLike);
  return snapshots.map((snapshot) => enrichSnapshot(snapshot, targetInventories));
}

export async function extensionHostSocketMappings(options = {}) {
  const currentPlatform = options.platform ?? platform();
  if (currentPlatform === "win32") return [];

  const socketDir = options.socketDir ?? browserUseSocketDir();
  const readDir = options.readdir ?? readdir;
  const run = options.execFile ?? execFileAsync;

  let socketNames;
  try {
    socketNames = await readDir(socketDir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const [lsofResult, psResult] = await Promise.all([
    run("lsof", ["-nU"]),
    run("ps", ["-axo", "pid=,ppid=,args="])
  ]);

  return mapExtensionHostSockets({
    socketDir,
    socketNames,
    lsofOutput: lsofResult.stdout,
    psOutput: psResult.stdout,
    platform: currentPlatform
  });
}

export function browserUseSocketDir() {
  return join(sep, "tmp", BROWSER_USE_SOCKET_DIR_NAME);
}

export function mapExtensionHostSockets({ socketDir, socketNames, lsofOutput, psOutput, platform: processPlatform = platform() }) {
  const liveSockets = parseLsofUnixSockets(lsofOutput, socketDir);
  const processes = parsePsProcesses(psOutput);
  const socketsByPath = new Map(liveSockets.map((socket) => [socket.path, socket]));

  return socketNames
    .map((socketName) => join(socketDir, socketName))
    .filter((socketPath) => socketsByPath.has(socketPath))
    .map((socketPath) => {
      const socket = socketsByPath.get(socketPath);
      const extensionHost = processes.get(socket.pid);
      const parent = extensionHost ? processes.get(extensionHost.ppid) : null;
      const target = parent ? targetFromBrowserProcessArgs(parent.args, { platform: processPlatform }) : null;
      return {
        socketPath,
        extensionHostPid: socket.pid,
        parentPid: extensionHost?.ppid,
        parentArgs: parent?.args,
        target
      };
    });
}

export function parseLsofUnixSockets(output, socketDir) {
  const prefix = `${socketDir}${sep}`;
  const byPid = new Map();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("COMMAND")) continue;
    const parts = trimmed.split(/\s+/);
    const command = parts[0];
    const pid = Number(parts[1]);
    const socketPath = parts.at(-1);
    if (!Number.isInteger(pid) || !socketPath?.startsWith(prefix)) continue;
    if (!command.toLowerCase().startsWith("extension")) continue;

    const existing = byPid.get(pid);
    if (!existing || socketPath.length < existing.path.length) {
      byPid.set(pid, { pid, path: socketPath });
    }
  }
  return Array.from(byPid.values());
}

export function parsePsProcesses(output) {
  const processes = new Map();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, pid, ppid, args] = match;
    processes.set(Number(pid), {
      pid: Number(pid),
      ppid: Number(ppid),
      args
    });
  }
  return processes;
}

export function enrichSnapshot(snapshot, targetInventories) {
  const scores = Object.entries(targetInventories).map(([targetId, inventory]) => ({
    target: getTarget(targetId),
    matches: countUrlOverlap(snapshot.openTabs, inventory.tabs ?? [])
  }));
  const positive = scores.filter((score) => score.matches > 0);

  if (positive.length !== 1) {
    return unresolved(snapshot, positive.length === 0 ? "no-existing-tab-overlap" : "ambiguous-existing-tab-overlap");
  }

  const winner = positive[0];
  const tied = scores.some(
    (score) => score.target.id !== winner.target.id && score.matches === winner.matches
  );
  if (tied) return unresolved(snapshot, "ambiguous-existing-tab-overlap");

  return {
    ...snapshot,
    backend: {
      ...snapshot.info,
      reportedName: snapshot.info.name,
      name: winner.target.displayName,
      targetId: winner.target.id,
      family: winner.target.family,
      channel: winner.target.channel,
      identitySource: "existing-tab-overlap"
    },
    resolved: true,
    matchCount: winner.matches
  };
}

function deterministicProcessMapping(info, infos, mappings) {
  if (mappings.length === 0) return { mapping: null, reason: "no-extension-host-sockets" };

  const pid = backendExtensionHostPid(info);
  if (pid != null) {
    const pidMatches = mappings.filter((mapping) => mapping.extensionHostPid === pid);
    if (pidMatches.length === 1) return { mapping: pidMatches[0], pid };
    return { mapping: null, reason: "process-socket-association-unavailable", pid };
  }

  if (infos.length === 1 && mappings.length === 1) return { mapping: mappings[0] };
  return { mapping: null, reason: "process-socket-association-unavailable" };
}

function backendExtensionHostPid(info) {
  const candidates = [
    info.extensionHostPid,
    info.nativeHostPid,
    info.process?.extensionHostPid,
    info.process?.pid,
    info.pid
  ];
  return candidates.find((candidate) => Number.isInteger(candidate)) ?? null;
}

function countUrlOverlap(backendTabs, inventoryTabs) {
  const inventoryUrls = new Set(inventoryTabs.map((tab) => tab.url).filter(Boolean));
  return backendTabs.filter((tab) => inventoryUrls.has(tab.url)).length;
}

function unresolved(snapshot, reason, detail = undefined) {
  return {
    ...snapshot,
    backend: {
      ...snapshot.info,
      reportedName: snapshot.info.name,
      identitySource: reason,
      ...(detail ? { detail } : {})
    },
    resolved: false,
    reason,
    ...(detail ? { detail } : {})
  };
}
