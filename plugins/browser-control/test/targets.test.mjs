import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
  enrichBackendsFromProcesses,
  extensionHostSocketMappings,
  mapExtensionHostSockets,
  parseLsofUnixSockets,
  parsePsProcesses,
  processMapFromSnapshot
} from "../scripts/lib/runtime-backends.mjs";
import { browserInstallationStatus, browserRunningStatus, runningProcessSnapshot, runningProcessTreeSnapshot } from "../scripts/lib/browser-detection.mjs";
import { connectionStatusForTarget, connectedMappingsFor, publicNativeHost } from "../scripts/lib/connection-status-core.mjs";
import { latencyStats, summarizeSamples } from "../scripts/lib/latency-metrics.mjs";
import { commandForTarget } from "../scripts/lib/open-browser-command.mjs";
import { compareNativeHostManifest, nativeHostStatus } from "../scripts/lib/native-host-status.mjs";
import { browserProfileState, candidateProfiles, chooseExtensionProfile } from "../scripts/lib/profiles.mjs";
import { runRuntimeProof } from "../scripts/lib/runtime-proof-runner.mjs";
import { chooseBrowserTarget, inspectBrowserTargets } from "../scripts/lib/browser-selection.mjs";
import { parseArgs, redactBenchmarkResult, runBenchmark } from "../scripts/benchmark-first-tab-latency.mjs";

test("plugin manifest version matches package versions", () => {
  const pluginRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const marketplaceRoot = path.resolve(pluginRoot, "../..");
  const manifest = JSON.parse(readFileSync(path.join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));
  const pluginPackage = JSON.parse(readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
  const marketplacePackage = JSON.parse(readFileSync(path.join(marketplaceRoot, "package.json"), "utf8"));

  assert.equal(manifest.version, pluginPackage.version);
  assert.equal(manifest.version, marketplacePackage.version);
});

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

test("skill advertises README-supported natural language browser targets", () => {
  const pluginRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const marketplaceRoot = path.resolve(pluginRoot, "../..");
  const readme = readFileSync(path.join(marketplaceRoot, "README.md"), "utf8");
  const skill = readFileSync(path.join(pluginRoot, "skills", "browser-control", "SKILL.md"), "utf8");
  const frontmatter = skill.match(/^---\n(?<body>[\s\S]*?)\n---/)?.groups?.body ?? "";

  assert.match(frontmatter, /^name: browser-control$/m);
  assert.match(frontmatter, /^description: ".*Use when /m);

  assert.match(readme, /Google Chrome\s*\|\s*Stable, Beta, Dev, Canary/);
  assert.match(readme, /Microsoft Edge\s*\|\s*Stable, Beta, Dev, Canary/);

  const naturalAliases = {
    "chrome-stable": ["Google Chrome", "Chrome Stable"],
    "chrome-beta": ["Google Chrome Beta", "Chrome Beta"],
    "chrome-dev": ["Google Chrome Dev", "Chrome Dev"],
    "chrome-canary": ["Google Chrome Canary", "Chrome Canary"],
    "edge-stable": ["Microsoft Edge", "Edge Stable"],
    "edge-beta": ["Microsoft Edge Beta", "Edge Beta"],
    "edge-dev": ["Microsoft Edge Dev", "Edge Dev"],
    "edge-canary": ["Microsoft Edge Canary", "Edge Canary"]
  };

  for (const id of targetIds()) {
    const target = getTarget(id);
    assert.ok(skill.includes(`\`${id}\``), `skill does not list target ${id}`);
    assert.ok(skill.includes(target.mention), `skill does not list mention ${target.mention}`);
    for (const alias of naturalAliases[id]) {
      assert.ok(skill.includes(alias), `skill does not list natural-language alias ${alias}`);
    }
  }
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

test("process map can be built from shared process tree snapshots", () => {
  const processes = processMapFromSnapshot([
    { pid: 88, ppid: 100, executablePath: "/bundle/extension-host", commandLine: "/bundle/extension-host chrome-extension://id/" },
    { pid: 100, ppid: 1, executablePath: "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev", commandLine: "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" },
    { pid: "bad", ppid: 1, commandLine: "ignored" }
  ]);

  assert.equal(processes.get(88).ppid, 100);
  assert.match(processes.get(88).args, /chrome-extension/);
  assert.equal(processes.get(100).ppid, 1);
  assert.equal(processes.has(Number.NaN), false);
});

test("extension host socket mappings skip internal ps when process tree snapshot is supplied", async () => {
  const socketDir = "/socket-root/codex-browser-use";
  const commands = [];
  const mappings = await extensionHostSocketMappings({
    platform: "darwin",
    socketDir,
    readdir: async () => ["edge.sock"],
    processTreeSnapshot: [
      { pid: 101, ppid: 1001, executablePath: "/bundle/extension-host", commandLine: "/bundle/extension-host chrome-extension://id/" },
      { pid: 1001, ppid: 1, executablePath: "/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev", commandLine: "/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev" }
    ],
    execFile: async (command) => {
      commands.push(command);
      assert.equal(command, "lsof");
      return {
        stdout: [
          "COMMAND   PID USER FD TYPE DEVICE SIZE/OFF NODE NAME",
          `extension 101 user 3u unix 0x1 0t0 ${socketDir}/edge.sock`
        ].join("\n")
      };
    }
  });

  assert.deepEqual(commands, ["lsof"]);
  assert.equal(mappings[0].extensionHostPid, 101);
  assert.equal(mappings[0].parentPid, 1001);
  assert.equal(mappings[0].target.id, "edge-dev");
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

test("browser selection follows README inference order after context", () => {
  const connectedSelection = chooseBrowserTarget([
    browserCandidate({ id: "chrome-dev", connected: true, activeTime: 100 }),
    browserCandidate({ id: "edge-dev", frontmost: true, activeTime: 900 }),
    browserCandidate({ id: "chrome-canary", running: true, activeTime: 1000 })
  ]);

  assert.equal(connectedSelection.reason, "connected-browser");
  assert.equal(connectedSelection.selected.targetId, "chrome-dev");

  const frontmostSelection = chooseBrowserTarget([
    browserCandidate({ id: "edge-dev", frontmost: true, activeTime: 100 }),
    browserCandidate({ id: "chrome-canary", running: true, activeTime: 1000 })
  ]);

  assert.equal(frontmostSelection.reason, "frontmost-browser");
  assert.equal(frontmostSelection.selected.targetId, "edge-dev");
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

test("browser target inspection shares one process snapshot across running checks", async () => {
  const processes = [{
    pid: 42,
    executablePath: "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
    commandLine: "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev --profile-directory=Default"
  }];
  const profile = {
    activeTime: 100,
    installed: true,
    profileDirectory: "Default"
  };
  let processSnapshotCalls = 0;
  let runningStatusCalls = 0;
  const runningStatusTargets = [];

  const candidates = await inspectBrowserTargets({
    platform: "darwin",
    deps: {
      async extensionHostSocketMappings() {
        return [{ target: TARGETS["chrome-dev"] }];
      },
      async currentFrontmostBundleId() {
        return TARGETS["edge-dev"].macos.bundleId;
      },
      runningProcessSnapshot(options) {
        processSnapshotCalls += 1;
        assert.equal(options.platform, "darwin");
        return processes;
      },
      browserInstallationStatus(target) {
        return {
          installed: target.id === "chrome-dev",
          status: target.id === "chrome-dev" ? "installed" : "not-installed",
          source: "test"
        };
      },
      browserRunningStatus(target, options) {
        runningStatusCalls += 1;
        runningStatusTargets.push(target.id);
        assert.equal(options.platform, "darwin");
        assert.equal(options.processes, processes);
        return {
          running: target.id === "chrome-dev",
          status: target.id === "chrome-dev" ? "running" : "not-running",
          matches: []
        };
      },
      selectExtensionProfile() {
        return {
          status: "selected",
          reason: "last-used-profile",
          selectedProfile: profile,
          installedProfiles: [profile],
          profiles: [profile],
          contextMatches: [],
          lastUsedProfile: "Default",
          profileStateStatus: "ok",
          profileStateError: null
        };
      }
    }
  });

  assert.equal(processSnapshotCalls, 1);
  assert.equal(runningStatusCalls, targetIds().length);
  assert.deepEqual(runningStatusTargets, targetIds());

  const chromeDev = candidates.find((candidate) => candidate.targetId === "chrome-dev");
  const edgeDev = candidates.find((candidate) => candidate.targetId === "edge-dev");
  assert.equal(chromeDev.running, true);
  assert.equal(chromeDev.connected, true);
  assert.equal(edgeDev.frontmost, true);
});

test("process enrichment is tab-free and resolves singleton socket mapping", async () => {
  const socketDir = "/socket-root/codex-browser-use";
  const agentLike = tabFailingAgent([
    { id: "backend-1", name: "Chrome", type: "extension" }
  ]);
  const resolved = await enrichBackendsFromProcesses(agentLike, socketMappingOptions({
    socketDir,
    socketNames: ["chrome.sock"],
    lsofRows: [`extension 202 user 3u unix 0x2 0t0 ${socketDir}/chrome.sock`],
    psRows: [
      "202 2002 /bundle/extension-host chrome-extension://id/",
      "2002 1 /Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"
    ]
  }));

  assert.equal(resolved[0].resolved, true);
  assert.equal(resolved[0].backend.targetId, "chrome-dev");
  assert.equal(resolved[0].backend.identitySource, "extension-host-parent-process");
});

test("process enrichment does not assign multiple backend mappings by array index", async () => {
  const socketDir = "/socket-root/codex-browser-use";
  const agentLike = tabFailingAgent([
    { id: "backend-chrome", name: "Chrome", type: "extension" },
    { id: "backend-edge", name: "Chrome", type: "extension" }
  ]);
  const resolved = await enrichBackendsFromProcesses(agentLike, socketMappingOptions({
    socketDir,
    socketNames: ["edge.sock", "chrome.sock"],
    lsofRows: [
      `extension 101 user 3u unix 0x1 0t0 ${socketDir}/edge.sock`,
      `extension 202 user 3u unix 0x2 0t0 ${socketDir}/chrome.sock`
    ],
    psRows: [
      "101 1001 /bundle/extension-host chrome-extension://id/",
      "202 2002 /bundle/extension-host chrome-extension://id/",
      "1001 1 /Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev",
      "2002 1 /Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"
    ]
  }));

  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].resolved, false);
  assert.equal(resolved[0].reason, "process-socket-association-unavailable");
  assert.equal(resolved[1].resolved, false);
});

test("process enrichment resolves pid-associated mappings without relying on order", async () => {
  const socketDir = "/socket-root/codex-browser-use";
  const agentLike = tabFailingAgent([
    { id: "backend-chrome", name: "Chrome", type: "extension", extensionHostPid: 202 },
    { id: "backend-edge", name: "Chrome", type: "extension", extensionHostPid: 101 }
  ]);
  const resolved = await enrichBackendsFromProcesses(agentLike, socketMappingOptions({
    socketDir,
    socketNames: ["edge.sock", "chrome.sock"],
    lsofRows: [
      `extension 101 user 3u unix 0x1 0t0 ${socketDir}/edge.sock`,
      `extension 202 user 3u unix 0x2 0t0 ${socketDir}/chrome.sock`
    ],
    psRows: [
      "101 1001 /bundle/extension-host chrome-extension://id/",
      "202 2002 /bundle/extension-host chrome-extension://id/",
      "1001 1 /Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev",
      "2002 1 /Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"
    ]
  }));

  assert.equal(resolved[0].resolved, true);
  assert.equal(resolved[0].backend.targetId, "chrome-dev");
  assert.equal(resolved[1].backend.targetId, "edge-dev");
});

test("runtime proof default omits tab details and does not inspect tabs", async () => {
  const socketDir = "/socket-root/codex-browser-use";
  const agentLike = tabFailingAgent([
    { id: "backend-1", name: "Chrome", type: "extension" }
  ]);
  const result = await runRuntimeProof({
    target: TARGETS["chrome-dev"],
    agentLike,
    includeTabs: false,
    enrichOptions: socketMappingOptions({
      socketDir,
      socketNames: ["chrome.sock"],
      lsofRows: [`extension 202 user 3u unix 0x2 0t0 ${socketDir}/chrome.sock`],
      psRows: [
        "202 2002 /bundle/extension-host chrome-extension://id/",
        "2002 1 /Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"
      ]
    })
  });

  assert.equal(result.tabInspection, "not-requested");
  assert.equal("tabSummary" in result, false);
  assert.equal("openTabsCount" in result, false);
});

test("profile state handles malformed and missing Local State without crashing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "browser-control-profile-"));
  try {
    mkdirSync(path.join(root, "Default"), { recursive: true });
    writeFileSync(path.join(root, "Local State"), "{not json", "utf8");

    const invalid = browserProfileState(root);
    assert.equal(invalid.status, "invalid-json");
    assert.equal(invalid.lastUsedProfile, null);
    assert.deepEqual(candidateProfiles(root, invalid), ["Default"]);

    writeFileSync(path.join(root, "Local State"), "null", "utf8");
    const wrongRoot = browserProfileState(root);
    assert.equal(wrongRoot.status, "invalid-json");

    writeFileSync(path.join(root, "Local State"), JSON.stringify({ profile: { profiles_order: "Default", info_cache: [] } }), "utf8");
    const wrongNested = browserProfileState(root);
    assert.equal(wrongNested.status, "ok");
    assert.deepEqual(wrongNested.profilesOrder, []);
    assert.deepEqual(wrongNested.profileInfo, {});

    rmSync(path.join(root, "Local State"));
    const missing = browserProfileState(root);
    assert.equal(missing.status, "missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit profile selection can proceed when Local State is malformed", () => {
  const selected = chooseExtensionProfile({
    lastUsedProfile: null,
    profileDirectory: "Profile 1",
    profileStateStatus: "invalid-json",
    profileStateError: { kind: "invalid-json", message: "bad json" },
    profiles: [],
    inspectRequestedProfile: (profileDirectory) => ({
      profileDirectory,
      displayLabel: profileDirectory,
      installed: true
    })
  });

  assert.equal(selected.status, "selected");
  assert.equal(selected.reason, "explicit-profile");
  assert.equal(selected.profileStateStatus, "invalid-json");
  assert.equal(selected.selectedProfile.profileDirectory, "Profile 1");
});

test("latency stats calculate median, nearest-rank p95, and summary counts", () => {
  assert.deepEqual(latencyStats([30, 10, 20]), {
    count: 3,
    medianMs: 20,
    p95Ms: 30,
    minMs: 10,
    maxMs: 30
  });
  assert.deepEqual(latencyStats([10, 20, 30, 40]).medianMs, 25);
  assert.deepEqual(latencyStats([1, 2, 3, 4, 100]).p95Ms, 100);

  const summary = summarizeSamples([
    { caseName: "connection-readiness", warmup: true, status: "ok", timingsMs: { total: 1 } },
    { caseName: "connection-readiness", warmup: false, status: "ok", timingsMs: { total: 10 } },
    { caseName: "connection-readiness", warmup: false, status: "failed", timingsMs: { total: 999 } },
    { caseName: "connection-readiness", warmup: false, status: "skipped", timingsMs: { total: 999 } }
  ], "connection-readiness");
  assert.equal(summary.measuredSamples, 1);
  assert.equal(summary.failures, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.medianMs, 10);
});

test("benchmark parser accepts opt-in require-connected preflight", () => {
  const args = parseArgs(["--target", "edge-dev", "--profile-directory", "Default", "--require-connected"]);
  assert.equal(args.requireConnected, true);
  assert.equal(args.target, "edge-dev");
  assert.equal(args.profileDirectory, "Default");
});

test("benchmark require-connected preflight passes before sampling when pinned target is connected", async () => {
  const result = await runBenchmark(benchmarkArgs({
    requireConnected: true,
    deps: {
      async connectionStatusForTarget({ target, profileDirectory }) {
        return benchmarkConnectionStatus({ target, profileDirectory, connected: true });
      }
    }
  }));

  assert.equal(result.measurementPreflight.requireConnected, true);
  assert.equal(result.measurementPreflight.status, "connected");
  assert.equal(result.measurementPreflight.target, "edge-dev");
  assert.equal(result.measurementPreflight.profileDirectory, "Default");
  assert.equal(result.measurementPreflight.connectedMappingCount, 1);
  assert.equal(result.measurementPreflight.nativeHostReady, true);
  assert.equal(result.measurementPreflight.connectionObservable, true);
  assert.deepEqual(result.samples, []);
});

test("benchmark require-connected preflight fails before sampling when pinned target is disconnected", async () => {
  let runCaseCalls = 0;
  await assert.rejects(
    () => runBenchmark(benchmarkArgs({
      cases: ["connection-readiness"],
      requireConnected: true,
      deps: {
        async connectionStatusForTarget({ target, profileDirectory }) {
          return benchmarkConnectionStatus({ target, profileDirectory, connected: false });
        },
        async runCase() {
          runCaseCalls += 1;
          throw new Error("sample loop should not run");
        }
      }
    })),
    (error) => {
      assert.equal(error.name, "BenchmarkSetupError");
      assert.equal(error.code, "existing-profile-not-connected");
      assert.match(error.message, /required connected target edge-dev \/ Default/);
      return true;
    }
  );
  assert.equal(runCaseCalls, 0);
});

test("benchmark require-connected preflight can wake and poll until connected", async () => {
  let wakeCalls = 0;
  let mappingCalls = 0;
  const result = await runBenchmark(benchmarkArgs({
    requireConnected: true,
    wake: true,
    deps: {
      async connectionStatusForTarget({ target, profileDirectory }) {
        return benchmarkConnectionStatus({ target, profileDirectory, connected: false });
      },
      async wakeTarget(target, profileDirectory) {
        wakeCalls += 1;
        assert.equal(target.id, "edge-dev");
        assert.equal(profileDirectory, "Default");
      },
      async connectedMappingsFor(target) {
        mappingCalls += 1;
        return {
          observable: true,
          reason: null,
          error: null,
          mappings: mappingCalls === 1 ? [] : [{ extensionHostPid: 101, parentPid: 1001, target }]
        };
      }
    }
  }));

  assert.equal(wakeCalls, 1);
  assert.equal(mappingCalls, 2);
  assert.equal(result.measurementPreflight.status, "connected-after-wake");
  assert.equal(result.measurementPreflight.wakeAttempted, true);
  assert.equal(result.measurementPreflight.connectedMappingCount, 1);
  assert.deepEqual(result.samples, []);
});

test("benchmark redaction shape keeps counts and drops unapproved detail", () => {
  const redacted = redactBenchmarkResult({
    samples: [{
      caseName: "connection-readiness",
      iteration: 0,
      warmup: false,
      status: "ok",
      timingsMs: { total: 12.34567 },
      correctness: {
        selectedTarget: "chrome-dev",
        selectedProfileDirectory: "Profile 1",
        connected: true,
        connectedMappingCount: 1,
        commandLine: "secret --profile-directory=Profile 1",
        tabUrl: "https://secret.example/"
      }
    }]
  });
  const sample = redacted.samples[0];
  assert.equal(sample.timingsMs.total, 12.346);
  assert.equal(sample.correctness.selectedProfileDirectory, "Profile 1");
  assert.equal("commandLine" in sample.correctness, false);
  assert.equal("tabUrl" in sample.correctness, false);
});

test("running process snapshot exposes injectable process scan helper", () => {
  let calls = 0;
  const snapshot = runningProcessSnapshot({
    platform: "darwin",
    execFileSync(command, args) {
      calls += 1;
      assert.equal(command, "ps");
      assert.deepEqual(args, ["-axo", "pid=,comm=,args="]);
      return "  42 /Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev /Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev\n";
    }
  });
  assert.equal(calls, 1);
  assert.equal(snapshot[0].pid, 42);
  assert.match(snapshot[0].commandLine, /Google Chrome Dev/);
});

test("running process tree snapshot includes parent process ids without changing the legacy scan", () => {
  let calls = 0;
  const snapshot = runningProcessTreeSnapshot({
    platform: "darwin",
    execFileSync(command, args) {
      calls += 1;
      assert.equal(command, "ps");
      assert.deepEqual(args, ["-axo", "pid=,ppid=,args="]);
      return "  42 1 /Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev --profile-directory=Default\n";
    }
  });
  assert.equal(calls, 1);
  assert.deepEqual(snapshot[0], {
    pid: 42,
    ppid: 1,
    executablePath: "/Applications/Google",
    commandLine: "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev --profile-directory=Default"
  });
});

test("connection status core checks local status before connection observation", async () => {
  const target = TARGETS["chrome-dev"];
  const calls = [];
  let releaseConnectionObservation;
  const connectionObservationReady = new Promise((resolve) => {
    releaseConnectionObservation = resolve;
  });
  const profile = {
    profileDirectory: "Default",
    displayLabel: "Default - user@example.test",
    user: "user@example.test",
    installed: true,
    hasLocalExtensionSettings: true,
    versions: ["1.0.0"],
    extensionDir: "/secret/Default/Extensions"
  };

  const statusPromise = connectionStatusForTarget({
    target,
    deps: {
      connectedMappingsFor() {
        calls.push("connected:start");
        return connectionObservationReady;
      },
      selectExtensionProfile() {
        calls.push("select-profile");
        return {
          status: "selected",
          reason: "last-used-profile",
          selectedProfile: profile,
          contextMatches: [{ score: 3, matchedTerms: ["user"], profile }],
          lastUsedProfile: "Default",
          installedProfiles: [profile],
          profiles: [profile],
          profileStateStatus: "ok",
          profileStateError: null
        };
      },
      browserInstallationStatus() {
        calls.push("install-status");
        return { installed: true, status: "installed", source: "macos-app" };
      },
      browserRunningStatus() {
        calls.push("running-status");
        return { running: true, status: "running", matches: [{ pid: 1001, executableName: "Google Chrome Dev" }] };
      },
      nativeHostStatus() {
        calls.push("native-host-status");
        return {
          installed: true,
          matches: true,
          ready: true,
          reasons: [],
          registry: null,
          manifestPath: "/secret/native-host.json"
        };
      }
    }
  });

  assert.deepEqual(calls, [
    "select-profile",
    "install-status",
    "running-status",
    "native-host-status",
    "connected:start"
  ]);

  releaseConnectionObservation({
    observable: true,
    reason: null,
    error: null,
    mappings: [{ extensionHostPid: 101, parentPid: 1001, target }]
  });
  const result = await statusPromise;

  assert.equal(result.status, "connected");
  assert.equal(result.target, "chrome-dev");
  assert.equal(result.installed, true);
  assert.equal(result.running, true);
  assert.equal(result.extensionInstalled, true);
  assert.equal(result.profileSelectionStatus, "selected");
  assert.equal(result.nativeHostReady, true);
  assert.equal(result.connectionObservable, true);
  assert.equal(result.connected, true);
  assert.deepEqual(result.connections, [{ extensionHostPid: 101, parentPid: 1001 }]);
  assert.deepEqual(result.contextMatches, [{ score: 3, profileDirectory: "Default" }]);
  assert.equal(result.selectedProfile.profileDirectory, "Default");
  assert.equal("displayLabel" in result.selectedProfile, false);
  assert.equal("user" in result.selectedProfile, false);
  assert.equal("extensionDir" in result.selectedProfile, false);
  assert.equal("nativeHostManifestPath" in result, false);
});

test("connection status core shares one process tree with running status and socket mapping", async () => {
  const target = TARGETS["edge-dev"];
  const calls = [];
  const processTreeSnapshot = [
    { pid: 101, ppid: 1001, executablePath: "/bundle/extension-host", commandLine: "/bundle/extension-host chrome-extension://id/" },
    { pid: 1001, ppid: 1, executablePath: "/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev", commandLine: "/Applications/Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev" }
  ];
  const profile = {
    profileDirectory: "Default",
    displayLabel: "Default - user@example.test",
    installed: true
  };

  const result = await connectionStatusForTarget({
    target,
    deps: {
      selectExtensionProfile() {
        calls.push("select-profile");
        return {
          status: "selected",
          reason: "last-used-profile",
          selectedProfile: profile,
          contextMatches: [],
          lastUsedProfile: "Default",
          installedProfiles: [profile],
          profiles: [profile],
          profileStateStatus: "ok",
          profileStateError: null
        };
      },
      browserInstallationStatus() {
        calls.push("install-status");
        return { installed: true, status: "installed", source: "macos-app" };
      },
      runningProcessTreeSnapshot() {
        calls.push("process-tree");
        return processTreeSnapshot;
      },
      browserRunningStatus(_target, options) {
        calls.push("running-status");
        assert.equal(options.processes, processTreeSnapshot);
        return { running: true, status: "running", matches: [{ pid: 1001, executableName: "Microsoft Edge Dev" }] };
      },
      nativeHostStatus() {
        calls.push("native-host-status");
        return {
          installed: true,
          matches: true,
          ready: true,
          reasons: [],
          registry: null,
          manifestPath: "/secret/native-host.json"
        };
      },
      connectedMappingsOptions: {
        platform: "darwin",
        extensionHostSocketMappings(mappingOptions) {
          calls.push("socket-mapping");
          assert.equal(mappingOptions.processTreeSnapshot, processTreeSnapshot);
          return Promise.resolve([{ extensionHostPid: 101, parentPid: 1001, target }]);
        }
      }
    }
  });

  assert.deepEqual(calls, [
    "select-profile",
    "install-status",
    "process-tree",
    "running-status",
    "native-host-status",
    "socket-mapping"
  ]);
  assert.equal(result.status, "connected");
  assert.deepEqual(result.connections, [{ extensionHostPid: 101, parentPid: 1001 }]);
});

test("connection status falls back to socket mapping without shared snapshot when process tree fails", async () => {
  const target = TARGETS["edge-dev"];
  const processError = { error: { code: "EPS", message: "ps failed" } };
  const profile = {
    profileDirectory: "Default",
    displayLabel: "Default - user@example.test",
    installed: true
  };

  const result = await connectionStatusForTarget({
    target,
    deps: {
      selectExtensionProfile() {
        return {
          status: "selected",
          reason: "last-used-profile",
          selectedProfile: profile,
          contextMatches: [],
          lastUsedProfile: "Default",
          installedProfiles: [profile],
          profiles: [profile],
          profileStateStatus: "ok",
          profileStateError: null
        };
      },
      browserInstallationStatus() {
        return { installed: true, status: "installed", source: "macos-app" };
      },
      runningProcessTreeSnapshot() {
        return processError;
      },
      browserRunningStatus(_target, options) {
        assert.equal(options.processes, processError);
        return { running: false, status: "unknown", matches: [], error: processError.error };
      },
      nativeHostStatus() {
        return {
          installed: true,
          matches: true,
          ready: true,
          reasons: [],
          registry: null,
          manifestPath: "/secret/native-host.json"
        };
      },
      connectedMappingsOptions: {
        platform: "darwin",
        extensionHostSocketMappings(mappingOptions) {
          assert.equal("processTreeSnapshot" in mappingOptions, false);
          return Promise.resolve([{ extensionHostPid: 101, parentPid: 1001, target }]);
        }
      }
    }
  });

  assert.equal(result.running, false);
  assert.equal(result.runningStatus.status, "unknown");
  assert.equal(result.status, "connected");
  assert.deepEqual(result.connections, [{ extensionHostPid: 101, parentPid: 1001 }]);
});


test("connection status core preserves output shape and default redaction", async () => {
  const target = TARGETS["chrome-dev"];
  const profile = {
    profileDirectory: "Profile 1",
    displayLabel: "Work - work@example.test",
    user: "work@example.test",
    installed: true,
    hasLocalExtensionSettings: true,
    versions: ["1.0.0"],
    extensionDir: "/secret/Profile 1/Extensions"
  };
  const result = await connectionStatusForTarget({
    target,
    profileDirectory: "Profile 1",
    deps: {
      selectExtensionProfile() {
        return {
          status: "selected",
          reason: "explicit-profile",
          selectedProfile: profile,
          contextMatches: [{ score: 4, matchedTerms: ["work"], profile }],
          lastUsedProfile: "Profile 1",
          installedProfiles: [profile],
          profiles: [profile],
          profileStateStatus: "ok",
          profileStateError: null
        };
      },
      async connectedMappingsFor() {
        return {
          observable: true,
          reason: null,
          error: null,
          mappings: [{ extensionHostPid: 101, parentPid: 1001, target }]
        };
      },
      browserInstallationStatus() {
        return { installed: true, status: "installed", source: "macos-app" };
      },
      browserRunningStatus() {
        return { running: true, status: "running", matches: [{ pid: 1001, executableName: "Google Chrome Dev" }] };
      },
      nativeHostStatus() {
        return {
          installed: true,
          matches: true,
          ready: true,
          reasons: [],
          registry: null,
          manifestPath: "/secret/native-host.json"
        };
      }
    }
  });

  assert.equal(result.status, "connected");
  assert.equal(result.selectedProfile.profileDirectory, "Profile 1");
  assert.equal("displayLabel" in result.selectedProfile, false);
  assert.equal("user" in result.selectedProfile, false);
  assert.equal("extensionDir" in result.selectedProfile, false);
  assert.equal("nativeHostManifestPath" in result, false);
  assert.deepEqual(result.connections, [{ extensionHostPid: 101, parentPid: 1001 }]);
  assert.deepEqual(result.contextMatches, [{ score: 4, profileDirectory: "Profile 1" }]);
});

test("connection status core keeps Windows socket observation unsupported", async () => {
  const target = TARGETS["chrome-dev"];
  const observation = await connectedMappingsFor(target, { platform: "win32" });
  assert.equal(observation.observable, false);
  assert.equal(observation.reason, "windows-unix-socket-observation-unavailable");
  assert.deepEqual(observation.mappings, []);

  const publicStatus = publicNativeHost({
    installed: true,
    matches: false,
    ready: false,
    reasons: ["registry-path-mismatch"],
    manifestPath: "C:\\secret\\manifest.json",
    registry: { installed: true, matches: false, path: "C:\\secret\\manifest.json" }
  });
  assert.equal("manifestPath" in publicStatus, false);
  assert.deepEqual(publicStatus.registry, { installed: true, matches: false });
});

test("browser detection redacts process command details by default", () => {
  const target = TARGETS["chrome-dev"];
  const expected = "C:\\Users\\me\\AppData\\Local\\Google\\Chrome Dev\\Application\\chrome.exe";
  const redacted = browserRunningStatus(target, {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    existsSync: (candidate) => candidate === expected,
    processes: [{ pid: 10, executablePath: expected, commandLine: `"${expected}" --profile-directory=Profile 1` }]
  });
  assert.equal(redacted.running, true);
  assert.deepEqual(Object.keys(redacted.matches[0]).sort(), ["executableName", "pid"]);

  const sensitive = browserRunningStatus(target, {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    existsSync: (candidate) => candidate === expected,
    includeSensitive: true,
    processes: [{ pid: 10, executablePath: expected, commandLine: `"${expected}" --profile-directory=Profile 1` }]
  });
  assert.ok(sensitive.matches[0].commandLine.includes("Profile 1"));
});

test("Windows detection uses channel-specific executable paths and avoids generic channel matches", () => {
  const target = TARGETS["chrome-dev"];
  const env = { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
  const expected = "C:\\Users\\me\\AppData\\Local\\Google\\Chrome Dev\\Application\\chrome.exe";
  const install = browserInstallationStatus(target, {
    platform: "win32",
    env,
    existsSync: (candidate) => candidate === expected,
    includeSensitive: true
  });
  assert.equal(install.installed, true);
  assert.equal(install.executablePath, expected);

  const exact = browserRunningStatus(target, {
    platform: "win32",
    env,
    existsSync: (candidate) => candidate === expected,
    includeSensitive: true,
    processes: [{ pid: 10, executablePath: expected, commandLine: `"${expected}" --profile-directory=Default` }]
  });
  assert.equal(exact.running, true);

  const generic = browserRunningStatus(target, {
    platform: "win32",
    env,
    existsSync: () => false,
    processes: [{ pid: 11, executablePath: "chrome.exe", commandLine: "chrome.exe" }]
  });
  assert.equal(generic.running, false);
  assert.equal(generic.status, "unknown");
});

test("Windows background launch command preserves separate browser arguments", () => {
  const target = TARGETS["edge-dev"];
  const expected = "C:\\Users\\me\\AppData\\Local\\Microsoft\\Edge Dev\\Application\\msedge.exe";
  const command = commandForTarget(target, {
    background: true,
    profileDirectory: "Profile 1",
    url: null
  }, {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    existsSync: (candidate) => candidate === expected
  });

  assert.equal(command.command, "powershell.exe");
  assert.ok(command.args.includes(expected));
  assert.ok(command.args.includes('"--profile-directory=Profile 1"'));
  assert.equal(command.args.some((arg) => arg.includes("--profile-directory=Profile 1 about:blank")), false);
});

test("native-host manifest comparison is structural and registry-aware", () => {
  const target = TARGETS["chrome-dev"];
  const expected = {
    ...manifestFor(target, { extensionHost: "/opt/extension-host" }),
    path: "C:\\Host\\extension-host.exe"
  };
  const actual = {
    allowed_origins: ["chrome-extension://other/", expected.allowed_origins[0]],
    extra: true,
    path: "c:\\host\\extension-host.exe",
    type: "stdio",
    name: expected.name
  };
  const comparison = compareNativeHostManifest(actual, expected, "win32");
  assert.equal(comparison.matches, true);

  const statusExpected = manifestFor(target, { extensionHost: "/opt/extension-host" });
  const status = nativeHostStatus(target, {
    platform: "win32",
    extensionHost: "/opt/extension-host",
    manifestPath: "C:\\manifest.json",
    actualManifest: statusExpected,
    execFileSync: () => "    (Default)    REG_SZ    C:\\manifest.json.bak"
  });
  assert.equal(status.matches, false);
  assert.ok(status.reasons.includes("registry-path-mismatch"));
});

test("check-extension JSON redacts profile/account details by default", () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const home = mkdtempSync(path.join(os.tmpdir(), "browser-control-home-"));
  try {
    const profileRoot = path.join(home, "Library", "Application Support", "Google", "Chrome Dev");
    const extensionDir = path.join(profileRoot, "Profile 1", "Extensions", EXTENSION_ID, "1.0.0");
    mkdirSync(extensionDir, { recursive: true });
    writeFileSync(path.join(profileRoot, "Local State"), JSON.stringify({
      profile: {
        last_used: "Profile 1",
        profiles_order: ["Profile 1"],
        info_cache: { "Profile 1": { name: "Work", user_name: "work@example.test" } }
      }
    }));

    const redacted = spawnSync(process.execPath, [
      "scripts/check-extension.mjs",
      "--target", "chrome-dev",
      "--profile-directory", "Profile 1",
      "--json"
    ], { cwd: root, env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.equal(redacted.status, 0, redacted.stderr || redacted.stdout);
    const redactedJson = JSON.parse(redacted.stdout);
    assert.equal(redactedJson.selectedProfile.profileDirectory, "Profile 1");
    assert.equal("displayLabel" in redactedJson.selectedProfile, false);
    assert.equal("user" in redactedJson.selectedProfile, false);
    assert.equal("extensionDir" in redactedJson.selectedProfile, false);

    const sensitive = spawnSync(process.execPath, [
      "scripts/check-extension.mjs",
      "--target", "chrome-dev",
      "--profile-directory", "Profile 1",
      "--json",
      "--include-sensitive"
    ], { cwd: root, env: { ...process.env, HOME: home }, encoding: "utf8" });
    assert.equal(sensitive.status, 0, sensitive.stderr || sensitive.stdout);
    const sensitiveJson = JSON.parse(sensitive.stdout);
    assert.equal(sensitiveJson.selectedProfile.user, "work@example.test");
    assert.ok(sensitiveJson.selectedProfile.extensionDir.includes("Profile 1"));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("native-host readiness fails when extension-host binary is missing", () => {
  const target = TARGETS["chrome-dev"];
  const missingHost = "/definitely/missing/extension-host";
  const actualManifest = manifestFor(target, { extensionHost: missingHost });
  const status = nativeHostStatus(target, {
    extensionHost: missingHost,
    actualManifest,
    manifestPath: path.join(path.sep, "tmp", "native-host.json")
  });
  assert.equal(status.manifestMatches, true);
  assert.equal(status.matches, false);
  assert.equal(status.ready, false);
  assert.ok(status.reasons.includes("extension-host-missing"));
});

test("Linux real launch fails cleanly when browser executable is missing", () => {
  assert.throws(
    () => commandForTarget(TARGETS["chrome-dev"], { requireInstalled: true }, {
      platform: "linux",
      env: { PATH: "/missing" },
      existsSync: () => false
    }),
    /Could not find Google Chrome Dev executable/
  );

  const dryRun = commandForTarget(TARGETS["chrome-dev"], { requireInstalled: false }, {
    platform: "linux",
    env: { PATH: "/missing" },
    existsSync: () => false
  });
  assert.equal(dryRun.command, "google-chrome-unstable");
});

test("validation script runs without ripgrep and metadata has no placeholder URLs", () => {
  const validation = spawnSync(process.execPath, ["scripts/validate-no-local-paths.mjs"], {
    cwd: path.resolve(new URL("..", import.meta.url).pathname),
    env: { ...process.env, PATH: "" },
    encoding: "utf8"
  });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);

  const metadata = readFileSync(path.resolve(new URL("..", import.meta.url).pathname, ".codex-plugin", "plugin.json"), "utf8");
  assert.equal(metadata.includes("example.com"), false);
});

test("plugin manifest references correctly sized icon assets", () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const metadata = JSON.parse(readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(metadata.interface.composerIcon, "./assets/icon.png");
  assert.equal(metadata.interface.logo, "./assets/logo.png");
  assert.deepEqual(pngSize(path.join(root, "assets", "icon.png")), { width: 512, height: 512 });
  assert.deepEqual(pngSize(path.join(root, "assets", "logo.png")), { width: 1024, height: 1024 });
});

function benchmarkArgs(overrides = {}) {
  return {
    cases: [],
    context: null,
    includeSensitive: false,
    includeTabCreate: false,
    json: false,
    output: null,
    pollMs: 1,
    profileDirectory: "Default",
    requireConnected: false,
    samples: 1,
    tabUrl: "about:blank",
    target: "edge-dev",
    timeoutMs: 50,
    wake: false,
    warmups: 0,
    ...overrides
  };
}

function benchmarkConnectionStatus({ target, profileDirectory, connected }) {
  return {
    target: target.id,
    displayName: target.displayName,
    installed: true,
    running: true,
    installStatus: { installed: true, status: "installed", source: "test" },
    runningStatus: { running: true, status: "running", matches: [] },
    extensionInstalled: true,
    profileSelectionStatus: "selected",
    profileSelectionReason: "explicit-profile",
    profileStateStatus: "ok",
    profileStateError: null,
    contextMatches: [],
    lastUsedProfile: profileDirectory,
    selectedProfile: { profileDirectory },
    extensionProfiles: [{ profileDirectory }],
    nativeHost: { installed: true, matches: true, ready: true, reasons: [], registry: null },
    nativeHostInstalled: true,
    nativeHostMatches: true,
    nativeHostReady: true,
    connectionObservable: true,
    connectionObservationReason: null,
    connectionObservationError: null,
    connected,
    connections: connected ? [{ extensionHostPid: 101, parentPid: 1001 }] : [],
    status: connected ? "connected" : "existing-profile-not-connected"
  };
}

function pngSize(filePath) {
  const buffer = readFileSync(filePath);
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

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

function tabFailingAgent(infos) {
  return {
    browsers: {
      async list() {
        return infos;
      },
      async get() {
        throw new Error("openTabs should not be called");
      }
    }
  };
}

function socketMappingOptions({ socketDir, socketNames, lsofRows, psRows }) {
  return {
    socketDir,
    readdir: async () => socketNames,
    execFile: async (command) => ({
      stdout: command === "lsof"
        ? ["COMMAND   PID USER FD TYPE DEVICE SIZE/OFF NODE NAME", ...lsofRows].join("\n")
        : psRows.join("\n")
    })
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
