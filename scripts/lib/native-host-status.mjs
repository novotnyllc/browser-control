import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  extensionHostPath,
  manifestFor,
  nativeHostManifestPath,
  nativeHostRegistryKey
} from "./paths.mjs";

export function readNativeHostManifest(manifestPath) {
  if (!existsSync(manifestPath)) return { ok: false, actual: null, error: { kind: "missing" } };
  try {
    return { ok: true, actual: JSON.parse(readFileSync(manifestPath, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      actual: null,
      error: { kind: error instanceof SyntaxError ? "invalid-json" : "unreadable", code: error.code, message: error.message }
    };
  }
}

export function compareNativeHostManifest(actual, expected, platform = process.platform) {
  const reasons = [];
  if (!actual || typeof actual !== "object") {
    return { matches: false, reasons: ["manifest-missing-or-unreadable"] };
  }
  if (actual.name !== expected.name) reasons.push("name-mismatch");
  if (actual.type !== "stdio") reasons.push("type-mismatch");
  if (!samePath(actual.path, expected.path, platform)) reasons.push("path-mismatch");
  if (!Array.isArray(actual.allowed_origins) || !actual.allowed_origins.includes(expected.allowed_origins[0])) {
    reasons.push("allowed-origin-missing");
  }
  return { matches: reasons.length === 0, reasons };
}

export function registryStatus(target, manifestPath, deps = {}) {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") return null;
  const key = nativeHostRegistryKey(target);
  const run = deps.execFileSync ?? execFileSync;
  try {
    const output = run("reg", ["query", key, "/ve"], { encoding: "utf8" });
    const actual = parseRegistryDefaultValue(output);
    return {
      key,
      installed: actual != null,
      matches: actual != null && samePath(actual, manifestPath, "win32"),
      actual
    };
  } catch (error) {
    return {
      key,
      installed: false,
      matches: false,
      actual: null,
      error: { code: error.code, message: error.message }
    };
  }
}

export function nativeHostStatus(target, options = {}) {
  const platform = options.platform ?? process.platform;
  const manifestPath = options.manifestPath ?? nativeHostManifestPath(target);
  const expected = manifestFor(target, options);
  const readResult = options.actualManifest === undefined
    ? readNativeHostManifest(manifestPath)
    : { ok: options.actualManifest != null, actual: options.actualManifest, error: options.actualManifest == null ? { kind: "missing" } : undefined };
  const comparison = compareNativeHostManifest(readResult.actual, expected, platform);
  const registry = registryStatus(target, manifestPath, options);
  const registryMatches = registry?.matches ?? true;
  const extensionHostExists = existsSync(expected.path);
  const reasons = [...comparison.reasons];
  if (registry && !registry.matches) reasons.push(registry.installed ? "registry-path-mismatch" : "registry-missing");
  if (!extensionHostExists) reasons.push("extension-host-missing");
  const manifestMatches = comparison.matches && registryMatches;
  const matches = manifestMatches && extensionHostExists;

  return {
    target: target.id,
    displayName: target.displayName,
    manifestPath,
    registryKey: registry?.key ?? null,
    registry,
    extensionHostPath: expected.path,
    extensionHostExists,
    installed: readResult.actual != null,
    manifestMatches,
    matches,
    ready: matches,
    reasons,
    expected,
    actual: readResult.actual,
    readError: readResult.error ?? null
  };
}

export async function installNativeHostManifest(target, options = {}) {
  const hostPath = extensionHostPath(options);
  const manifestPath = nativeHostManifestPath(target);
  const manifest = manifestFor(target, options);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  if ((options.platform ?? process.platform) === "win32") {
    const run = options.execFileSync ?? execFileSync;
    run("reg", ["add", nativeHostRegistryKey(target), "/ve", "/d", manifestPath, "/f"], { stdio: "ignore" });
  }
  return nativeHostStatus(target, options);
}

function parseRegistryDefaultValue(output) {
  for (const line of String(output ?? "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:\(Default\)|<NO NAME>)\s+REG_\w+\s+(.+?)\s*$/i);
    if (match) return match[1];
  }
  return null;
}

function samePath(left, right, platform) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  return platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
