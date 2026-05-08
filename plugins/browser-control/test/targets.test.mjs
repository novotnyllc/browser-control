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
  mapExtensionHostSockets,
  parseLsofUnixSockets,
  parsePsProcesses
} from "../scripts/lib/runtime-backends.mjs";
import { browserInstallationStatus, browserRunningStatus } from "../scripts/lib/browser-detection.mjs";
import { commandForTarget } from "../scripts/lib/open-browser-command.mjs";
import { compareNativeHostManifest, nativeHostStatus } from "../scripts/lib/native-host-status.mjs";
import { browserProfileState, candidateProfiles, chooseExtensionProfile } from "../scripts/lib/profiles.mjs";
import { runRuntimeProof } from "../scripts/lib/runtime-proof-runner.mjs";
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
