import assert from "node:assert/strict";
import test from "node:test";

import { EXTENSION_ID, getTarget, TARGETS, targetIds } from "../src/targets.mjs";
import {
  bundledBrowserClientPath,
  extensionHostPath,
  manifestFor,
  nativeHostManifestPath,
  nativeHostRegistryKey
} from "../scripts/lib/paths.mjs";
import {
  enrichBackendsFromExistingTabs,
  mapExtensionHostSockets,
  parseLsofUnixSockets,
  parsePsProcesses
} from "../scripts/lib/runtime-backends.mjs";
import { chooseExtensionProfile } from "../scripts/lib/profiles.mjs";
import { chooseBrowserTarget } from "../scripts/lib/browser-selection.mjs";

test("defines every required browser target", () => {
  assert.deepEqual(targetIds(), [
    "chrome-stable",
    "chrome-beta",
    "chrome-dev",
    "chrome-canary",
    "edge-stable",
    "edge-beta",
    "edge-dev",
    "edge-canary"
  ]);
});

test("target metadata contains required platform details", () => {
  for (const id of targetIds()) {
    const target = getTarget(id);
    assert.equal(target.id, id);
    assert.ok(target.displayName);
    assert.ok(target.macos.bundleId);
    assert.ok(target.macos.appName.endsWith(".app"));
    assert.ok(target.macos.profileRoot.length >= 3);
    assert.ok(target.macos.nativeMessagingHostDir.at(-1) === "NativeMessagingHosts");
    assert.ok(target.windows.executable.endsWith(".exe"));
    assert.ok(target.windows.nativeMessagingRegistryKey.includes("NativeMessagingHosts"));
    assert.ok(target.linux.commands.length >= 1);
    assert.ok(target.linux.nativeMessagingHostDir.at(-1) === "NativeMessagingHosts");
    assert.equal(target.extensionDiscovery.extensionId, EXTENSION_ID);
  }
});

test("native host manifests use per-target native messaging directories", () => {
  const chromeDev = nativeHostManifestPath(TARGETS["chrome-dev"]);
  const edgeDev = nativeHostManifestPath(TARGETS["edge-dev"]);
  assert.match(chromeDev, /Chrome Dev/);
  assert.match(edgeDev, /Microsoft Edge Dev/);
  assert.notEqual(chromeDev, edgeDev);
});

test("Windows native messaging registry keys use browser vendor locations", () => {
  assert.equal(
    nativeHostRegistryKey(TARGETS["chrome-dev"]),
    "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.openai.codexextension"
  );
  assert.equal(
    nativeHostRegistryKey(TARGETS["edge-dev"]),
    "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.openai.codexextension"
  );
});

test("manifest generation points at explicit extension host and allows extension origin", () => {
  const target = TARGETS["edge-dev"];
  const manifest = manifestFor(target, { extensionHost: "/opt/codex/extension-host" });
  assert.equal(manifest.name, "com.openai.codexextension");
  assert.equal(manifest.type, "stdio");
  assert.equal(manifest.path, "/opt/codex/extension-host");
  assert.deepEqual(manifest.allowed_origins, [
    `chrome-extension://${EXTENSION_ID}/`
  ]);
});

test("default runtime paths resolve through bundled Browser Use plugin", () => {
  assert.match(bundledBrowserClientPath(), /openai-bundled/);
  assert.match(bundledBrowserClientPath(), /browser-client\.mjs$/);
  assert.match(extensionHostPath(), /openai-bundled/);
  assert.match(extensionHostPath(), /extension-host/);
});

test("runtime resolver enriches generic backend from existing tab overlap", async () => {
  const agentLike = mockAgent([
    {
      info: { id: "backend-1", name: "Chrome", type: "extension", capabilities: { browser: [], tab: [] } },
      openTabs: [{ id: "tab-1", title: "Docs", url: "https://example.test/chrome" }]
    },
    {
      info: { id: "backend-2", name: "Chrome", type: "extension", capabilities: { browser: [], tab: [] } },
      openTabs: [{ id: "tab-2", title: "Docs", url: "https://example.test/edge" }]
    }
  ]);

  const resolved = await enrichBackendsFromExistingTabs(agentLike, {
    "chrome-dev": { tabs: [{ url: "https://example.test/chrome" }] },
    "edge-dev": { tabs: [{ url: "https://example.test/edge" }] }
  });

  assert.equal(resolved[0].backend.reportedName, "Chrome");
  assert.equal(resolved[0].backend.name, "Google Chrome Dev");
  assert.equal(resolved[0].backend.targetId, "chrome-dev");
  assert.equal(resolved[0].backend.identitySource, "existing-tab-overlap");
  assert.equal(resolved[1].backend.name, "Microsoft Edge Dev");
  assert.equal(resolved[1].backend.targetId, "edge-dev");
});

test("runtime resolver stays unresolved when existing tabs are insufficient", async () => {
  const agentLike = mockAgent([
    {
      info: { id: "backend-1", name: "Chrome", type: "extension", capabilities: { browser: [], tab: [] } },
      openTabs: []
    }
  ]);

  const resolved = await enrichBackendsFromExistingTabs(agentLike, {
    "chrome-dev": { tabs: [{ url: "https://example.test/chrome" }] }
  });

  assert.equal(resolved[0].resolved, false);
  assert.equal(resolved[0].backend.reportedName, "Chrome");
  assert.equal(resolved[0].backend.identitySource, "no-existing-tab-overlap");
});

test("process resolver maps extension-host sockets to parent browser channels", () => {
  const socketDir = "/socket-root/codex-browser-use";
  const lsofOutput = [
    "COMMAND   PID USER FD TYPE DEVICE SIZE/OFF NODE NAME",
    `extension 101 user 3u unix 0x1 0t0 ${socketDir}/edge.sock`,
    `extension 202 user 3u unix 0x2 0t0 ${socketDir}/chrome.sock`
  ].join("\n");
  const psOutput = [
    "101 1001 /bundle/extension-host chrome-extension://id/",
    "202 2002 /bundle/extension-host chrome-extension://id/",
    "1001 1 /Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev",
    "2002 1 /Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"
  ].join("\n");

  const mappings = mapExtensionHostSockets({
    socketDir,
    socketNames: ["edge.sock", "chrome.sock"],
    lsofOutput,
    psOutput
  });

  assert.equal(mappings[0].extensionHostPid, 101);
  assert.equal(mappings[0].parentPid, 1001);
  assert.equal(mappings[0].target.id, "edge-dev");
  assert.equal(mappings[1].extensionHostPid, 202);
  assert.equal(mappings[1].parentPid, 2002);
  assert.equal(mappings[1].target.id, "chrome-dev");
});

test("process parsers ignore unrelated unix sockets and malformed process rows", () => {
  const socketDir = "/socket-root/codex-browser-use";
  const sockets = parseLsofUnixSockets([
    "COMMAND   PID USER FD TYPE DEVICE SIZE/OFF NODE NAME",
    `Codex 77 user 3u unix 0x0 0t0 ${socketDir}/codex.sock`,
    `extension 88 user 3u unix 0x1 0t0 ${socketDir}/browser.sock`,
    "extension nope user 3u unix 0x2 0t0 elsewhere"
  ].join("\n"), socketDir);
  assert.deepEqual(sockets, [{ pid: 88, path: `${socketDir}/browser.sock` }]);

  const processes = parsePsProcesses([
    "  88 100 /bundle/extension-host",
    "bad data"
  ].join("\n"));
  assert.equal(processes.get(88).ppid, 100);
  assert.equal(processes.has(Number.NaN), false);
});

test("profile selection prefers explicit profile, then installed last-used profile", () => {
  const profiles = [
    { profileDirectory: "Default", displayLabel: "User - user@example.test", installed: true },
    { profileDirectory: "Profile 1", displayLabel: "Work - work@example.test", installed: true },
    { profileDirectory: "Profile 2", displayLabel: "Archive - archive@example.test", installed: false }
  ];
  const explicit = chooseExtensionProfile({
    lastUsedProfile: "Default",
    profileDirectory: "Profile 1",
    profiles,
    inspectRequestedProfile: (profileDirectory) => ({ profileDirectory, installed: false })
  });
  assert.equal(explicit.reason, "explicit-profile");
  assert.equal(explicit.selectedProfile.profileDirectory, "Profile 1");
  assert.equal(explicit.selectedProfile.displayLabel, "Work - work@example.test");

  const automatic = chooseExtensionProfile({
    lastUsedProfile: "Default",
    profiles,
    inspectRequestedProfile: (profileDirectory) => ({ profileDirectory, installed: false })
  });
  assert.equal(automatic.reason, "last-used-profile");
  assert.equal(automatic.selectedProfile.profileDirectory, "Default");
});

test("profile selection uses a unique account context match before last-used default", () => {
  const selected = chooseExtensionProfile({
    context: "Use the project.example account for this task",
    lastUsedProfile: "Default",
    profiles: [
      {
        profileDirectory: "Default",
        displayLabel: "User - user@example.test",
        profileName: "User",
        user: "user@example.test",
        installed: true
      },
      {
        profileDirectory: "Profile 7",
        displayLabel: "Project - member@project.example",
        hostedDomain: "project.example",
        profileName: "Project",
        user: "member@project.example",
        installed: true
      }
    ],
    inspectRequestedProfile: (profileDirectory) => ({ profileDirectory, installed: false })
  });

  assert.equal(selected.reason, "context-match");
  assert.equal(selected.selectedProfile.displayLabel, "Project - member@project.example");
});

test("profile selection falls back when context is ambiguous", () => {
  const selected = chooseExtensionProfile({
    context: "Use the shared account",
    lastUsedProfile: "Default",
    profiles: [
      {
        profileDirectory: "Default",
        displayLabel: "User - user@example.test",
        gaiaName: "Shared",
        profileName: "User",
        user: "user@example.test",
        installed: true
      },
      {
        profileDirectory: "Profile 7",
        displayLabel: "Work - member@work.example",
        gaiaName: "Shared",
        profileName: "Work",
        user: "member@work.example",
        installed: true
      }
    ],
    inspectRequestedProfile: (profileDirectory) => ({ profileDirectory, installed: false })
  });

  assert.equal(selected.reason, "last-used-profile");
  assert.equal(selected.selectedProfile.profileDirectory, "Default");
});

test("profile selection reports ambiguity when multiple installed profiles have no last-used match", () => {
  const selected = chooseExtensionProfile({
    lastUsedProfile: "Profile 2",
    profiles: [
      { profileDirectory: "Default", displayLabel: "User - user@example.test", installed: true },
      { profileDirectory: "Profile 1", displayLabel: "Work - work@example.test", installed: true },
      { profileDirectory: "Profile 2", displayLabel: "Archive - archive@example.test", installed: false }
    ],
    inspectRequestedProfile: (profileDirectory) => ({ profileDirectory, installed: false })
  });

  assert.equal(selected.status, "ambiguous-profile");
  assert.equal(selected.selectedProfile, null);
});

test("browser selection uses context match before running activity defaults", () => {
  const selection = chooseBrowserTarget([
    browserCandidate({
      id: "chrome-dev",
      running: true,
      reason: "last-used-profile",
      activeTime: 200
    }),
    browserCandidate({
      id: "edge-dev",
      running: true,
      reason: "context-match",
      contextScore: 6,
      activeTime: 100
    })
  ]);

  assert.equal(selection.reason, "context-match");
  assert.equal(selection.selected.targetId, "edge-dev");
});

test("browser selection defaults to running browser with most recent selected profile activity", () => {
  const selection = chooseBrowserTarget([
    browserCandidate({ id: "chrome-dev", running: true, activeTime: 200 }),
    browserCandidate({ id: "edge-dev", running: true, activeTime: 300 }),
    browserCandidate({ id: "chrome-stable", running: false, activeTime: 900 })
  ]);

  assert.equal(selection.reason, "running-browser-most-recent-profile");
  assert.equal(selection.selected.targetId, "edge-dev");
});

function mockAgent(backends) {
  const byId = new Map(backends.map((backend) => [backend.info.id, backend]));
  return {
    browsers: {
      async list() {
        return backends.map((backend) => backend.info);
      },
      async get(id) {
        const backend = byId.get(id);
        if (!backend) throw new Error(`missing backend ${id}`);
        return {
          user: {
            async openTabs() {
              return backend.openTabs;
            }
          }
        };
      }
    }
  };
}

function browserCandidate({ id, running = false, connected = false, frontmost = false, reason = "last-used-profile", contextScore = 0, activeTime = 0 }) {
  const profile = {
    activeTime,
    displayLabel: `${id} profile`,
    installed: true,
    profileDirectory: "Default"
  };
  return {
    connected,
    displayName: id,
    extensionInstalled: true,
    frontmost,
    installed: true,
    profileSelection: {
      contextMatches: contextScore > 0 ? [{ score: contextScore }] : [],
      installedProfiles: [profile],
      reason,
      selectedProfile: profile,
      status: "selected"
    },
    running,
    selectedProfile: profile,
    selectedProfileActiveTime: activeTime,
    target: TARGETS[id],
    targetId: id
  };
}
