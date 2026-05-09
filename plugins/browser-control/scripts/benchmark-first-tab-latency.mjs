#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { getTarget } from "../src/targets.mjs";
import { runningProcessSnapshot } from "./lib/browser-detection.mjs";
import { selectBrowserTarget } from "./lib/browser-selection.mjs";
import { connectionStatusForTarget, connectedMappingsFor } from "./lib/connection-status-core.mjs";
import { measurePhase, roundMs, summarizeCases } from "./lib/latency-metrics.mjs";
import { commandForTarget } from "./lib/open-browser-command.mjs";
import { bundledBrowserClientPath, extensionHostPath } from "./lib/paths.mjs";
import { runRuntimeProof } from "./lib/runtime-proof-runner.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_CASES = ["process-snapshot", "select-browser", "connection-status", "connection-readiness", "runtime-proof"];

function usage() {
  console.error(`Usage: node scripts/benchmark-first-tab-latency.mjs [--target <id>] [--profile-directory <name>] [--profile-context <text>] [--samples <n>] [--warmups <n>] [--cases <list>] [--wake] [--require-connected] [--include-tab-create] [--timeout-ms <n>] [--poll-ms <n>] [--json] [--output <path>]`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv) {
  const args = {
    cases: DEFAULT_CASES.slice(),
    context: null,
    includeSensitive: false,
    includeTabCreate: false,
    json: false,
    output: null,
    pollMs: 100,
    profileDirectory: null,
    requireConnected: false,
    samples: 5,
    tabUrl: "about:blank",
    target: null,
    timeoutMs: 10000,
    wake: false,
    warmups: 1
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = readValue(argv, i++, arg);
    else if (arg === "--profile-directory") args.profileDirectory = readValue(argv, i++, arg);
    else if (arg === "--profile-context") args.context = readValue(argv, i++, arg);
    else if (arg === "--samples") args.samples = positiveInteger(readValue(argv, i++, arg), arg);
    else if (arg === "--warmups") args.warmups = nonNegativeInteger(readValue(argv, i++, arg), arg);
    else if (arg === "--cases") args.cases = readValue(argv, i++, arg).split(",").map((entry) => entry.trim()).filter(Boolean);
    else if (arg === "--wake") args.wake = true;
    else if (arg === "--require-connected") args.requireConnected = true;
    else if (arg === "--include-tab-create") args.includeTabCreate = true;
    else if (arg === "--tab-url") args.tabUrl = readValue(argv, i++, arg);
    else if (arg === "--timeout-ms") args.timeoutMs = positiveInteger(readValue(argv, i++, arg), arg);
    else if (arg === "--poll-ms") args.pollMs = positiveInteger(readValue(argv, i++, arg), arg);
    else if (arg === "--json") args.json = true;
    else if (arg === "--output") args.output = readValue(argv, i++, arg);
    else if (arg === "--include-sensitive") args.includeSensitive = true;
    else {
      usage();
      process.exit(2);
    }
  }

  if (args.context === "") throw new Error("--profile-context must not be empty");
  if (args.profileDirectory === "") throw new Error("--profile-directory must not be empty");
  if (args.includeTabCreate && !args.cases.includes("runtime-tab-create")) args.cases.push("runtime-tab-create");
  return args;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative integer`);
  return parsed;
}

export async function runBenchmark(args) {
  const startedAt = new Date();
  const deps = args.deps ?? {};
  const resolved = await resolveBenchmarkTarget(args);
  const preflight = args.requireConnected
    ? await ensureBenchmarkConnectedState({ args, resolved, deps })
    : null;
  const runtimeAvailable = trustedRuntimeAvailable();
  const samples = [];
  const iterations = args.warmups + args.samples;
  const caseRunner = deps.runCase ?? runCase;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const warmup = iteration < args.warmups;
    for (const caseName of args.cases) {
      samples.push(await caseRunner(caseName, { args, resolved, iteration, warmup, runtimeAvailable }));
    }
  }

  return redactBenchmarkResult({
    schemaVersion: 1,
    runId: `first-tab-${startedAt.toISOString().replace(/[:.]/g, "-")}`,
    timestamp: startedAt.toISOString(),
    platform: os.platform(),
    arch: os.arch(),
    nodeVersion: process.version,
    target: resolved.target ? { id: resolved.target.id, displayName: resolved.target.displayName } : null,
    profileDirectory: resolved.profileDirectory,
    profileContextProvided: Boolean(args.context),
    runtimeAvailable,
    wakeRequested: args.wake,
    timeoutMs: args.timeoutMs,
    pollMs: args.pollMs,
    ...(preflight ? { measurementPreflight: preflight } : {}),
    samples,
    summary: summarizeCases(samples, args.cases)
  }, { includeSensitive: args.includeSensitive });
}

async function resolveBenchmarkTarget(args) {
  if (args.target) {
    const target = getTarget(args.target);
    return { target, profileDirectory: args.profileDirectory, selectionStatus: null };
  }

  const selection = await selectBrowserTarget({ context: args.context });
  const selected = selection.selected;
  return {
    target: selected?.target ?? null,
    profileDirectory: args.profileDirectory ?? selected?.selectedProfile?.profileDirectory ?? null,
    selectionStatus: selection.status,
    selectionReason: selection.reason
  };
}

async function runCase(caseName, context) {
  if (caseName === "process-snapshot") return runMeasuredSample(caseName, context, processSnapshotCase);
  if (caseName === "select-browser") return runMeasuredSample(caseName, context, selectBrowserCase);
  if (caseName === "connection-status") return runMeasuredSample(caseName, context, connectionStatusCase);
  if (caseName === "connection-readiness") return runMeasuredSample(caseName, context, connectionReadinessCase);
  if (caseName === "runtime-proof") return runMeasuredSample(caseName, context, runtimeProofCase);
  if (caseName === "runtime-tab-create") return runMeasuredSample(caseName, context, runtimeTabCreateCase);
  return skippedSample(caseName, context, "unknown-case");
}

async function runMeasuredSample(caseName, context, fn) {
  const timings = {};
  const sample = baseSample(caseName, context, timings);
  try {
    const result = await measurePhase("total", timings, () => fn({ ...context, timings }));
    return normalizeCaseResult(sample, result);
  } catch (error) {
    return {
      ...sample,
      status: "failed",
      reason: error.message,
      error: { name: error.name, code: error.code ?? null }
    };
  }
}

function baseSample(caseName, { iteration, warmup }, timings) {
  return {
    caseName,
    iteration,
    warmup,
    status: "ok",
    timingsMs: timings,
    correctness: {}
  };
}

function normalizeCaseResult(sample, result = {}) {
  return {
    ...sample,
    status: result.status ?? "ok",
    reason: result.reason ?? null,
    skippedReason: result.skippedReason ?? null,
    correctness: result.correctness ?? {},
    metadata: result.metadata ?? undefined
  };
}

function skippedSample(caseName, context, reason) {
  return {
    ...baseSample(caseName, context, {}),
    status: "skipped",
    skippedReason: reason
  };
}

async function processSnapshotCase() {
  const snapshot = runningProcessSnapshot();
  if (snapshot.error) return { status: "failed", reason: "process-snapshot-error", metadata: { errorCode: snapshot.error.code ?? null } };
  return { correctness: { processCount: snapshot.length } };
}

async function selectBrowserCase({ args }) {
  const selection = await selectBrowserTarget({ context: args.context });
  const selected = selection.selected;
  return {
    status: selection.status === "selected" ? "ok" : "failed",
    reason: selection.reason,
    correctness: {
      selectedTarget: selected?.targetId ?? null,
      selectedProfileDirectory: selected?.selectedProfile?.profileDirectory ?? null,
      candidateCount: selection.candidates.length
    }
  };
}

async function connectionStatusCase({ args, resolved }) {
  if (!resolved.target) return { status: "failed", reason: "no-selected-target" };
  const result = await benchmarkConnectionStatus({ args, resolved, deps: args.deps ?? {} });
  return { correctness: connectionCorrectness(result) };
}

async function connectionReadinessCase({ args, resolved, timings }) {
  if (!resolved.target) return { status: "failed", reason: "no-selected-target" };
  if (os.platform() === "win32") {
    return { status: "skipped", skippedReason: "connection-observation-unsupported" };
  }

  const first = await measurePhase("connectionStatus", timings, () => benchmarkConnectionStatus({ args, resolved, deps: args.deps ?? {} }));
  if (first.connected) return { correctness: connectionCorrectness(first) };
  if (!args.wake) {
    return { status: "failed", reason: first.status, correctness: connectionCorrectness(first) };
  }

  return wakeAndPollConnected({ args, resolved, timings, deps: args.deps ?? {}, initialStatus: first });
}

export async function ensureBenchmarkConnectedState({ args, resolved, deps = {} }) {
  const timings = {};
  if (!resolved.target) {
    throw benchmarkSetupError("no-selected-target", "no target was selected for required connected preflight", { timings });
  }
  if (!resolved.profileDirectory) {
    throw benchmarkSetupError(
      "require-connected-requires-profile-directory",
      `required connected target ${resolved.target.id} needs an explicit or selected profile directory`,
      { target: resolved.target.id, profileDirectory: null, timings }
    );
  }

  const first = await measurePhase("connectionStatus", timings, () => benchmarkConnectionStatus({ args, resolved, deps }));
  if (!first.connectionObservable) {
    throw preflightFailure(first.connectionObservationReason ?? "connection-observation-unsupported", resolved, first, timings);
  }
  if (first.connected) {
    return preflightMetadata({ resolved, status: "connected", source: first, timings, wakeAttempted: false });
  }
  if (!args.wake) {
    throw preflightFailure(first.status, resolved, first, timings);
  }

  const readiness = await wakeAndPollConnected({ args, resolved, timings, deps, initialStatus: first });
  if (readiness.status === "skipped") {
    throw preflightFailure(readiness.skippedReason ?? "connection-observation-unsupported", resolved, first, timings);
  }
  if (readiness.status === "failed") {
    throw preflightFailure(readiness.reason, resolved, {
      ...first,
      connected: false,
      connections: []
    }, timings);
  }

  return preflightMetadata({
    resolved,
    status: "connected-after-wake",
    source: {
      ...first,
      connected: true,
      connections: Array.from({ length: readiness.correctness.connectedMappingCount }, () => ({}))
    },
    timings,
    wakeAttempted: true
  });
}

async function benchmarkConnectionStatus({ args, resolved, deps = {} }) {
  const statusForTarget = deps.connectionStatusForTarget ?? connectionStatusForTarget;
  return statusForTarget({
    target: resolved.target,
    context: args.context,
    profileDirectory: resolved.profileDirectory,
    includeSensitive: args.includeSensitive,
    ...(deps.connectionStatusDeps ? { deps: deps.connectionStatusDeps } : {})
  });
}

async function wakeAndPollConnected({ args, resolved, timings, deps = {}, initialStatus }) {
  if (!resolved.profileDirectory) {
    return { status: "failed", reason: "wake-requires-profile-directory", correctness: connectionCorrectness(initialStatus) };
  }

  await measurePhase("launchWake", timings, () => benchmarkWakeTarget(resolved.target, resolved.profileDirectory, deps));
  const observation = await pollConnectedMappings({ args, target: resolved.target, deps });

  if (!observation.observable) {
    return { status: "skipped", skippedReason: observation.reason ?? "connection-observation-unsupported" };
  }
  if (observation.mappings.length === 0) {
    return { status: "failed", reason: "connection-readiness-timeout", correctness: { connected: false, connectedMappingCount: 0 } };
  }
  return { correctness: { connected: true, connectedMappingCount: observation.mappings.length, selectedTarget: resolved.target.id, selectedProfileDirectory: resolved.profileDirectory } };
}

async function pollConnectedMappings({ args, target, deps = {} }) {
  const mappingsForTarget = deps.connectedMappingsFor ?? connectedMappingsFor;
  const options = deps.connectedMappingsOptions ?? {};
  const deadline = Date.now() + args.timeoutMs;
  let observation = await mappingsForTarget(target, options);
  while (observation.observable && observation.mappings.length === 0 && Date.now() < deadline) {
    await delay(args.pollMs);
    observation = await mappingsForTarget(target, options);
  }
  return observation;
}

async function benchmarkWakeTarget(target, profileDirectory, deps = {}) {
  const wake = deps.wakeTarget ?? wakeTarget;
  return wake(target, profileDirectory);
}

async function wakeTarget(target, profileDirectory) {
  const command = commandForTarget(target, { profileDirectory, requireInstalled: true, url: null });
  await execFileAsync(command.command, command.args, { timeout: 10000 });
}

function preflightFailure(reason, resolved, status, timings) {
  const connectedMappingCount = status.connections?.length ?? 0;
  return benchmarkSetupError(
    reason,
    `required connected target ${resolved.target.id} / ${resolved.profileDirectory}, but status was ${reason} with ${connectedMappingCount} mappings`,
    {
      target: resolved.target.id,
      profileDirectory: resolved.profileDirectory,
      status: status.status ?? reason,
      connectedMappingCount,
      nativeHostReady: status.nativeHostReady ?? null,
      connectionObservable: status.connectionObservable ?? null,
      timings: roundTimings(timings)
    }
  );
}

function preflightMetadata({ resolved, status, source, timings, wakeAttempted }) {
  return {
    requireConnected: true,
    status,
    target: resolved.target.id,
    profileDirectory: resolved.profileDirectory,
    connectedMappingCount: source.connections?.length ?? 0,
    nativeHostReady: source.nativeHostReady ?? null,
    connectionObservable: source.connectionObservable ?? null,
    profileSelectionStatus: source.profileSelectionStatus ?? null,
    wakeAttempted,
    timingsMs: roundTimings(timings)
  };
}

function benchmarkSetupError(code, message, metadata = {}) {
  const error = new Error(message);
  error.name = "BenchmarkSetupError";
  error.code = code;
  error.setupFailure = true;
  error.metadata = metadata;
  return error;
}

function roundTimings(timings) {
  return Object.fromEntries(Object.entries(timings ?? {}).map(([key, value]) => [key, roundMs(value)]));
}

async function runtimeProofCase({ resolved, runtimeAvailable, timings }) {
  if (!resolved.target) return { status: "failed", reason: "no-selected-target" };
  if (!runtimeAvailable) return { status: "skipped", skippedReason: "trusted-runtime-unavailable" };
  const setup = await setupTrustedRuntimeIfAvailable(timings);
  if (setup.skippedReason) return { status: "skipped", skippedReason: setup.skippedReason };
  const proof = await measurePhase("runtimeBackendResolution", timings, () => runRuntimeProof({
    target: resolved.target,
    agentLike: setup.agentLike,
    includeTabs: false
  }));
  return {
    correctness: {
      runtimeBackendResolved: true,
      selectedTarget: proof.target,
      selectedBackendId: proof.selectedBrowser.id,
      tabInspection: proof.tabInspection
    }
  };
}

async function runtimeTabCreateCase({ args, resolved, runtimeAvailable, timings }) {
  if (!args.includeTabCreate) return { status: "skipped", skippedReason: "runtime-tab-create-not-requested" };
  if (!resolved.target) return { status: "failed", reason: "no-selected-target" };
  if (!runtimeAvailable) return { status: "skipped", skippedReason: "trusted-runtime-unavailable" };

  const setup = await setupTrustedRuntimeIfAvailable(timings);
  if (setup.skippedReason) return { status: "skipped", skippedReason: setup.skippedReason };
  const proof = await measurePhase("runtimeBackendResolution", timings, () => runRuntimeProof({
    target: resolved.target,
    agentLike: setup.agentLike,
    includeTabs: false
  }));
  const browser = await setup.agentLike.browsers.get(proof.selectedBrowser.id);
  if (typeof browser?.tabs?.new !== "function") {
    return { status: "skipped", skippedReason: "runtime-tab-api-unavailable", correctness: { runtimeBackendResolved: true, tabCreated: false } };
  }

  const tab = await measurePhase("runtimeTabCreate", timings, () => browser.tabs.new({ url: args.tabUrl }));
  return {
    correctness: {
      runtimeBackendResolved: true,
      tabCreated: true,
      tabId: tab?.id ?? null,
      selectedTarget: proof.target
    }
  };
}

async function setupTrustedRuntimeIfAvailable(timings) {
  if (typeof agent === "undefined" && !globalThis.agent && process.env.CODEX_BROWSER_CONTROL_ALLOW_RUNTIME_SETUP !== "1") {
    return { skippedReason: "trusted-runtime-agent-unavailable-outside-node-repl" };
  }
  try {
    return await measurePhase("runtimeSetup", timings, async () => {
      const { setupAtlasRuntime } = await import(bundledBrowserClientPath());
      await setupAtlasRuntime({ globals: globalThis });
      const agentLike = typeof agent !== "undefined" ? agent : globalThis.agent;
      if (!agentLike) return { skippedReason: "trusted-runtime-agent-unavailable-outside-node-repl" };
      return { agentLike };
    });
  } catch (error) {
    return { skippedReason: `trusted-runtime-setup-unavailable:${error.code ?? error.name ?? "error"}` };
  }
}

function trustedRuntimeAvailable() {
  return existsSync(bundledBrowserClientPath()) && existsSync(extensionHostPath());
}

function connectionCorrectness(result) {
  return {
    selectedTarget: result.target,
    selectedProfileDirectory: result.selectedProfile?.profileDirectory ?? null,
    connected: result.connected,
    connectedMappingCount: result.connections.length,
    status: result.status,
    profileSelectionStatus: result.profileSelectionStatus,
    nativeHostReady: result.nativeHostReady
  };
}

export function redactBenchmarkResult(result, options = {}) {
  if (options.includeSensitive) return result;
  return {
    ...result,
    samples: result.samples.map((sample) => ({
      caseName: sample.caseName,
      iteration: sample.iteration,
      warmup: sample.warmup,
      status: sample.status,
      reason: sample.reason ?? null,
      skippedReason: sample.skippedReason ?? null,
      timingsMs: Object.fromEntries(Object.entries(sample.timingsMs ?? {}).map(([key, value]) => [key, roundMs(value)])),
      correctness: redactCorrectness(sample.correctness ?? {}),
      ...(sample.metadata ? { metadata: sample.metadata } : {}),
      ...(sample.error ? { error: sample.error } : {})
    }))
  };
}

function redactCorrectness(correctness) {
  return {
    selectedTarget: correctness.selectedTarget ?? null,
    selectedProfileDirectory: correctness.selectedProfileDirectory ?? null,
    connected: correctness.connected ?? undefined,
    connectedMappingCount: correctness.connectedMappingCount ?? undefined,
    status: correctness.status ?? undefined,
    profileSelectionStatus: correctness.profileSelectionStatus ?? undefined,
    nativeHostReady: correctness.nativeHostReady ?? undefined,
    runtimeBackendResolved: correctness.runtimeBackendResolved ?? undefined,
    selectedBackendId: correctness.selectedBackendId ?? undefined,
    tabInspection: correctness.tabInspection ?? undefined,
    tabCreated: correctness.tabCreated ?? undefined,
    tabId: correctness.tabId ?? undefined,
    processCount: correctness.processCount ?? undefined,
    candidateCount: correctness.candidateCount ?? undefined
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runBenchmark(args);
  const json = JSON.stringify(result, null, 2);
  if (args.output) writeFileSync(path.resolve(args.output), `${json}\n`, "utf8");
  if (args.json || !args.output) console.log(json);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    if (error.setupFailure) {
      console.error(`Benchmark preflight failed: ${error.message}`);
    } else {
      console.error(error.stack || error.message);
    }
    process.exit(1);
  });
}
