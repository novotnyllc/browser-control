#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { getTarget } from "../src/targets.mjs";

const execFileAsync = promisify(execFile);

function usage() {
  console.error("Usage: node scripts/open-browser.mjs --target <id> [--url <url>|--no-url] [--profile-directory <name>] [--background] [--dry-run] [--json]");
}

function parseArgs(argv) {
  const args = {
    background: false,
    dryRun: false,
    json: false,
    profileDirectory: null,
    target: null,
    url: "about:blank"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = argv[++i];
    else if (arg === "--url") args.url = argv[++i];
    else if (arg === "--no-url") args.url = null;
    else if (arg === "--profile-directory") args.profileDirectory = argv[++i];
    else if (arg === "--background") args.background = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else {
      usage();
      process.exit(2);
    }
  }
  if (!args.target) {
    usage();
    process.exit(2);
  }
  if (args.url === "") {
    throw new Error("--url must not be empty");
  }
  if (args.profileDirectory === "") {
    throw new Error("--profile-directory must not be empty");
  }
  return args;
}

function commandFor(target, url, options = {}) {
  if (process.platform === "darwin") {
    const appPath = path.resolve("/Applications", target.macos.appName);
    if (!existsSync(appPath)) {
      throw new Error(`Could not find ${target.macos.appName}`);
    }
    const appName = target.macos.appName.replace(/\.app$/, "");
    const browserArgs = options.profileDirectory
      ? [`--profile-directory=${options.profileDirectory}`]
      : [];
    return {
      command: "open",
      args: [
        options.background ? "-g" : null,
        "-a",
        appName,
        url,
        browserArgs.length > 0 ? "--args" : null,
        ...browserArgs
      ].filter((arg) => arg != null),
      appName,
      backgroundMode: options.background ? "minimize-new-windows" : null,
      focusGuard: options.background ? "restore-frontmost-app" : null
    };
  }

  if (process.platform === "win32") {
    const browserArgs = [
      options.profileDirectory ? `--profile-directory=${options.profileDirectory}` : null,
      url
    ].filter((arg) => arg != null);
    if (options.background) {
      return {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-Command",
          `Start-Process -FilePath ${quotePowerShell(target.windows.executable)} -ArgumentList ${quotePowerShell(browserArgs.join(" "))} -WindowStyle Minimized`
        ],
        backgroundMode: "minimized"
      };
    }
    return { command: target.windows.executable, args: browserArgs };
  }

  return {
    command: target.linux.commands[0],
    args: [
      options.profileDirectory ? `--profile-directory=${options.profileDirectory}` : null,
      url
    ].filter((arg) => arg != null)
  };
}

const args = parseArgs(process.argv.slice(2));
const target = getTarget(args.target);
const command = commandFor(target, args.url, {
  background: args.background,
  profileDirectory: args.profileDirectory
});
if (!args.dryRun) {
  await runCommand(command);
}

const result = {
  target: target.id,
  displayName: target.displayName,
  url: args.url,
  profileDirectory: args.profileDirectory,
  ...command,
  background: args.background,
  dryRun: args.dryRun
};
if (args.json) console.log(JSON.stringify(result, null, 2));
else console.log(`${command.command} ${command.args.join(" ")}`);

function quotePowerShell(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runCommand(command) {
  const useMacFocusGuard = process.platform === "darwin" && command.focusGuard === "restore-frontmost-app";
  const frontmostBundleId = useMacFocusGuard
    ? await currentFrontmostBundleId().catch(() => null)
    : null;
  const beforeWindowIds = useMacFocusGuard && command.appName
    ? await windowIdsForApp(command.appName).catch(() => [])
    : [];

  await execFileAsync(command.command, command.args);

  if (useMacFocusGuard && command.appName) {
    await minimizeNewWindows(command.appName, beforeWindowIds);
  }

  if (frontmostBundleId) {
    await restoreFrontmostApp(frontmostBundleId);
  }
}

async function currentFrontmostBundleId() {
  const script = [
    'tell application "System Events"',
    '  set frontApp to first application process whose frontmost is true',
    '  return bundle identifier of frontApp',
    "end tell"
  ].join("\n");
  const { stdout } = await execFileAsync("osascript", ["-e", script]);
  return stdout.trim() || null;
}

async function restoreFrontmostApp(bundleId) {
  const script = [
    "on run argv",
    "  delay 0.05",
    "  tell application id (item 1 of argv) to activate",
    "  delay 0.3",
    "  tell application id (item 1 of argv) to activate",
    "end run"
  ].join("\n");
  await execFileAsync("osascript", ["-e", script, bundleId]).catch(() => {});
}

async function windowIdsForApp(appName) {
  const script = [
    "on run argv",
    "  set targetName to item 1 of argv",
    '  tell application "System Events"',
    "    if not (exists process targetName) then return \"\"",
    "    tell process targetName",
    "      set output to {}",
    "      repeat with targetWindow in windows",
    "        try",
    "          set end of output to (id of targetWindow as text)",
    "        end try",
    "      end repeat",
    "      return output",
    "    end tell",
    "  end tell",
    "end run"
  ].join("\n");
  const { stdout } = await execFileAsync("osascript", ["-e", script, appName]);
  return stdout
    .split(/,|\\r?\\n/)
    .map((id) => id.trim())
    .filter(Boolean);
}

async function minimizeNewWindows(appName, beforeWindowIds) {
  const script = [
    "on run argv",
    "  set targetName to item 1 of argv",
    "  set knownIds to items 2 thru -1 of argv",
    "  delay 0.12",
    "  my minimizeUnknownWindows(targetName, knownIds)",
    "  delay 0.35",
    "  my minimizeUnknownWindows(targetName, knownIds)",
    "end run",
    "",
    "on minimizeUnknownWindows(targetName, knownIds)",
    '  tell application "System Events"',
    "    if not (exists process targetName) then return",
    "    tell process targetName",
    "      repeat with targetWindow in windows",
    "        try",
    "          set windowId to (id of targetWindow as text)",
    "          if knownIds does not contain windowId then",
    "            set value of attribute \"AXMinimized\" of targetWindow to true",
    "          end if",
    "        end try",
    "      end repeat",
    "    end tell",
    "  end tell",
    "end minimizeUnknownWindows"
  ].join("\n");
  await execFileAsync("osascript", ["-e", script, appName, ...beforeWindowIds]).catch(() => {});
}
