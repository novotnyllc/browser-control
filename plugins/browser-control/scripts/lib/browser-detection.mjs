import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { TARGETS } from "../../src/targets.mjs";

export function resolveBrowserExecutable(target, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.existsSync ?? existsSync;
  const candidates = executableCandidates(target, { platform, env });
  const found = candidates.find((candidate) => exists(candidate));
  return {
    platform,
    found: Boolean(found),
    executablePath: found ?? null,
    source: found ? sourceForPlatform(platform) : null,
    candidates
  };
}

export function executableCandidates(target, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform === "darwin") {
    return [path.resolve("/Applications", target.macos.appName)];
  }

  if (platform === "win32") {
    const roots = [
      env.LOCALAPPDATA,
      env.ProgramFiles,
      env["ProgramFiles(x86)"],
      env.PROGRAMFILES,
      env.PROGRAMFILES_X86,
      path.resolve(os.homedir(), "AppData", "Local")
    ].filter(Boolean);
    return [...new Set(roots.map((root) => path.win32.resolve(root, ...target.windows.appPathSegments)))];
  }

  const pathEntries = String(env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  return target.linux.commands.flatMap((command) => {
    if (command.includes(path.sep)) return [command];
    return pathEntries.map((entry) => path.resolve(entry, command));
  });
}

export function browserInstallationStatus(target, options = {}) {
  const resolution = resolveBrowserExecutable(target, options);
  return {
    installed: resolution.found,
    status: resolution.found ? "installed" : "not-installed",
    source: resolution.source,
    ...(options.includeSensitive ? {
      executablePath: resolution.executablePath,
      candidates: resolution.candidates
    } : {})
  };
}

export function runningProcessSnapshot(options = {}) {
  const platform = options.platform ?? process.platform;
  return runningProcesses({ platform, execFileSync: options.execFileSync });
}

export function runningProcessTreeSnapshot(options = {}) {
  const platform = options.platform ?? process.platform;
  return runningProcessTree({ platform, execFileSync: options.execFileSync });
}

export function browserRunningStatus(target, options = {}) {
  const platform = options.platform ?? process.platform;
  const processes = options.processes ?? runningProcessSnapshot({ platform, execFileSync: options.execFileSync });
  if (processes.error) {
    return {
      running: false,
      status: "unknown",
      matches: [],
      error: processes.error
    };
  }

  const resolution = resolveBrowserExecutable(target, options);
  const matches = processes
    .filter((processInfo) => processMatchesTarget(processInfo, target, { platform, resolution }))
    .map((processInfo) => publicProcessInfo(processInfo, { includeSensitive: options.includeSensitive }));

  if (matches.length > 0) {
    return { running: true, status: "running", matches };
  }

  if (platform === "win32" && !resolution.found && processes.some((processInfo) => isGenericWindowsBrowserProcess(processInfo, target))) {
    return { running: false, status: "unknown", matches: [] };
  }

  return { running: false, status: "not-running", matches: [] };
}

export function targetFromBrowserProcessArgs(args, options = {}) {
  const platform = options.platform ?? process.platform;
  const executablePath = options.executablePath ?? firstExecutablePath(args, platform);
  const processInfo = { pid: options.pid, executablePath, commandLine: args, args };
  for (const target of Object.values(TARGETS)) {
    if (processMatchesTarget(processInfo, target, {
      platform,
      resolution: resolveBrowserExecutable(target, options)
    })) {
      return target;
    }
  }
  return null;
}

function processMatchesTarget(processInfo, target, { platform, resolution }) {
  const executablePath = processInfo.executablePath ?? firstExecutablePath(processInfo.commandLine ?? processInfo.args ?? "", platform);
  const commandLine = processInfo.commandLine ?? processInfo.args ?? executablePath ?? "";

  if (platform === "darwin") {
    const appPath = `/Applications/${target.macos.appName}/Contents/MacOS`;
    return commandLine.includes(appPath) || commandLine.includes(`${target.macos.appName}/Contents/MacOS`);
  }

  if (platform === "win32") {
    if (executablePath && resolution.candidates.some((candidate) => samePath(candidate, executablePath, platform))) {
      return true;
    }
    const normalizedCommand = normalizeWindowsPath(commandLine);
    return resolution.candidates.some((candidate) => normalizedCommand.includes(normalizeWindowsPath(candidate)));
  }

  const executableBase = path.basename(stripQuotes(executablePath ?? firstToken(commandLine)));
  return target.linux.commands.includes(executableBase);
}

function runningProcesses({ platform, execFileSync: run = execFileSync }) {
  try {
    if (platform === "win32") {
      const stdout = run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
      ], { encoding: "utf8" });
      if (!stdout.trim()) return [];
      const parsed = JSON.parse(stdout);
      return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
        pid: Number(entry.ProcessId),
        executablePath: entry.ExecutablePath || null,
        commandLine: entry.CommandLine || entry.ExecutablePath || ""
      }));
    }

    const stdout = run("ps", ["-axo", "pid=,comm=,args="], { encoding: "utf8" });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/))
      .filter(Boolean)
      .map((match) => ({
        pid: Number(match[1]),
        executablePath: match[2],
        commandLine: match[3]
      }));
  } catch (error) {
    return { error: { code: error.code, message: error.message } };
  }
}

function runningProcessTree({ platform, execFileSync: run = execFileSync }) {
  try {
    if (platform === "win32") {
      const stdout = run("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress"
      ], { encoding: "utf8" });
      if (!stdout.trim()) return [];
      const parsed = JSON.parse(stdout);
      return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
        pid: Number(entry.ProcessId),
        ppid: Number.isInteger(Number(entry.ParentProcessId)) ? Number(entry.ParentProcessId) : null,
        executablePath: entry.ExecutablePath || null,
        commandLine: entry.CommandLine || entry.ExecutablePath || ""
      }));
    }

    const stdout = run("ps", ["-axo", "pid=,ppid=,args="], { encoding: "utf8" });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/))
      .filter(Boolean)
      .map((match) => ({
        pid: Number(match[1]),
        ppid: Number(match[2]),
        executablePath: firstExecutablePath(match[3], platform),
        commandLine: match[3]
      }));
  } catch (error) {
    return { error: { code: error.code, message: error.message } };
  }
}

function publicProcessInfo(processInfo, options = {}) {
  const executablePath = processInfo.executablePath ?? null;
  return {
    pid: processInfo.pid,
    executableName: executablePath ? path.basename(stripQuotes(executablePath)) : null,
    ...(options.includeSensitive ? {
      executablePath,
      commandLine: processInfo.commandLine ?? processInfo.args ?? null
    } : {})
  };
}

function isGenericWindowsBrowserProcess(processInfo, target) {
  const executablePath = processInfo.executablePath ?? firstExecutablePath(processInfo.commandLine ?? "", "win32") ?? "";
  return path.win32.basename(stripQuotes(executablePath)).toLowerCase() === target.windows.executable.toLowerCase();
}

function firstExecutablePath(commandLine, platform) {
  if (typeof commandLine !== "string") return null;
  const trimmed = commandLine.trim();
  if (!trimmed) return null;
  if (platform === "win32") {
    const quoted = trimmed.match(/^"([^"]+\.exe)"/i);
    if (quoted) return quoted[1];
    const unquoted = trimmed.match(/^([^\s]+\.exe)/i);
    return unquoted?.[1] ?? null;
  }
  return firstToken(trimmed);
}

function firstToken(value) {
  const trimmed = String(value ?? "").trim();
  const quoted = trimmed.match(/^"([^"]+)"/);
  if (quoted) return quoted[1];
  return trimmed.split(/\s+/)[0] || "";
}

function samePath(left, right, platform) {
  return platform === "win32"
    ? normalizeWindowsPath(left) === normalizeWindowsPath(right)
    : path.resolve(left) === path.resolve(right);
}

function normalizeWindowsPath(value) {
  return stripQuotes(String(value ?? "")).replace(/\//g, "\\").toLowerCase();
}

function stripQuotes(value) {
  return String(value ?? "").replace(/^['"]|['"]$/g, "");
}

function sourceForPlatform(platform) {
  if (platform === "darwin") return "macos-app";
  if (platform === "win32") return "windows-known-path";
  if (platform === "linux") return "linux-path";
  return null;
}
