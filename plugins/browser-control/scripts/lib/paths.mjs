import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NATIVE_HOST_NAME } from "../../src/targets.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, "..", "..");

const PLATFORM_DIR = {
  darwin: "macos",
  linux: "linux",
  win32: "windows"
};

export function homeResolve(...segments) {
  return path.resolve(os.homedir(), ...segments);
}

export function codexHome() {
  return process.env.CODEX_HOME || homeResolve(".codex");
}

export function profileRoot(target) {
  if (process.platform === "darwin") return homeResolve(...target.macos.profileRoot);
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || homeResolve("AppData", "Local");
    return path.resolve(localAppData, ...target.windows.profileRootSegments);
  }
  return homeResolve(...target.linux.profileRoot);
}

export function nativeHostManifestPath(target) {
  const fileName = `${NATIVE_HOST_NAME}.json`;
  if (process.platform === "darwin") {
    return homeResolve(...target.macos.nativeMessagingHostDir, fileName);
  }
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA || homeResolve("AppData", "Local");
    return path.resolve(localAppData, "OpenAI", "extension", fileName);
  }
  return homeResolve(...target.linux.nativeMessagingHostDir, fileName);
}

export function nativeHostRegistryKey(target) {
  return `${target.windows.nativeMessagingRegistryKey}\\${NATIVE_HOST_NAME}`;
}

export function extensionHostPath(options = {}) {
  if (options.extensionHost) return path.resolve(options.extensionHost);
  if (process.env.CODEX_BROWSER_CONTROL_EXTENSION_HOST) {
    return path.resolve(process.env.CODEX_BROWSER_CONTROL_EXTENSION_HOST);
  }

  const platformDir = PLATFORM_DIR[process.platform];
  const executable = process.platform === "win32" ? "extension-host.exe" : "extension-host";
  if (!platformDir) {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  return bundledBrowserUsePath("extension-host", platformDir, os.arch(), executable);
}

export function manifestFor(target, options = {}) {
  return {
    name: NATIVE_HOST_NAME,
    description: `Codex ${target.displayName} native messaging host`,
    type: "stdio",
    path: extensionHostPath(options),
    allowed_origins: [`chrome-extension://${target.extensionDiscovery.extensionId}/`]
  };
}

export function bundledBrowserClientPath() {
  if (process.env.CODEX_BROWSER_CONTROL_BROWSER_CLIENT) {
    return path.resolve(process.env.CODEX_BROWSER_CONTROL_BROWSER_CLIENT);
  }

  return bundledBrowserUsePath("scripts", "browser-client.mjs");
}

export function bundledBrowserUsePath(...segments) {
  return path.resolve(
    codexHome(),
    "plugins",
    "cache",
    "openai-bundled",
    "chrome",
    "latest",
    ...segments
  );
}

export function assertReadableFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(
      `Missing ${label} at ${filePath}. Install or repair the bundled Codex Browser Use/Chrome plugin before using browser-control.`
    );
  }
}

export function assertBundledBrowserUseAvailable() {
  assertReadableFile(bundledBrowserClientPath(), "trusted Browser Use browser-client");
  assertReadableFile(extensionHostPath(), "bundled Browser Use extension host");
}
