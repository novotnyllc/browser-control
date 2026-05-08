import { existsSync } from "node:fs";
import path from "node:path";

import { resolveBrowserExecutable } from "./browser-detection.mjs";

export function commandForTarget(target, options = {}, deps = {}) {
  const platform = deps.platform ?? process.platform;
  const url = options.url === undefined ? "about:blank" : options.url;
  const browserArgs = [
    options.profileDirectory ? `--profile-directory=${options.profileDirectory}` : null,
    url
  ].filter((arg) => arg != null);

  if (platform === "darwin") {
    const appPath = path.resolve("/Applications", target.macos.appName);
    const requireInstalled = options.requireInstalled ?? true;
    const exists = deps.existsSync ?? existsSync;
    if (requireInstalled && !exists(appPath)) {
      throw new Error(`Could not find ${target.macos.appName}`);
    }
    const appName = target.macos.appName.replace(/\.app$/, "");
    return {
      command: "open",
      args: [
        options.background ? "-g" : null,
        "-a",
        appName,
        url,
        options.profileDirectory ? "--args" : null,
        options.profileDirectory ? `--profile-directory=${options.profileDirectory}` : null
      ].filter((arg) => arg != null),
      appName,
      executablePath: appPath,
      backgroundMode: options.background ? "minimize-new-windows" : null,
      focusGuard: options.background ? "restore-frontmost-app" : null
    };
  }

  if (platform === "win32") {
    const resolution = resolveBrowserExecutable(target, { ...deps, platform });
    const executablePath = resolution.executablePath ?? (options.requireInstalled === false ? resolution.candidates[0] : null);
    if (!executablePath) {
      throw new Error(`Could not find ${target.displayName} executable`);
    }
    if (options.background) {
      const argumentList = browserArgs.length > 0 ? windowsArgumentList(browserArgs) : null;
      return {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "if ($args.Length -gt 1) { Start-Process -FilePath $args[0] -ArgumentList $args[1] -WindowStyle Minimized } else { Start-Process -FilePath $args[0] -WindowStyle Minimized }",
          executablePath,
          argumentList
        ].filter((arg) => arg != null),
        executablePath,
        backgroundMode: "minimized"
      };
    }
    return { command: executablePath, args: browserArgs, executablePath };
  }

  const resolution = resolveBrowserExecutable(target, { ...deps, platform });
  const requireInstalled = options.requireInstalled ?? true;
  if (requireInstalled && !resolution.executablePath) {
    throw new Error(`Could not find ${target.displayName} executable`);
  }
  const command = resolution.executablePath ?? target.linux.commands[0];
  return { command, args: browserArgs, executablePath: resolution.executablePath };
}

function windowsArgumentList(args) {
  return args.map(quoteWindowsArgument).join(" ");
}

function quoteWindowsArgument(arg) {
  const value = String(arg);
  if (!/[\s"]/.test(value)) return value;
  let result = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === "\\") {
      backslashes += 1;
    } else if (char === '"') {
      result += "\\".repeat(backslashes * 2 + 1);
      result += '"';
      backslashes = 0;
    } else {
      result += "\\".repeat(backslashes);
      result += char;
      backslashes = 0;
    }
  }
  result += "\\".repeat(backslashes * 2);
  result += '"';
  return result;
}
