import { performance } from "node:perf_hooks";

export async function measurePhase(name, timings, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    timings[name] = roundMs(performance.now() - start);
  }
}

export function summarizeSamples(samples, caseName) {
  const matching = samples.filter((sample) => sample.caseName === caseName && !sample.warmup);
  const measured = matching
    .filter((sample) => sample.status === "ok" && Number.isFinite(sample.timingsMs?.total))
    .map((sample) => sample.timingsMs.total);
  const skipped = matching.filter((sample) => sample.status === "skipped").length;
  const failures = matching.filter((sample) => sample.status !== "ok" && sample.status !== "skipped").length;
  const stats = latencyStats(measured);
  return {
    measuredSamples: measured.length,
    failures,
    skipped,
    medianMs: stats.medianMs,
    p95Ms: stats.p95Ms,
    minMs: stats.minMs,
    maxMs: stats.maxMs
  };
}

export function summarizeCases(samples, caseNames) {
  return Object.fromEntries(caseNames.map((caseName) => [caseName, summarizeSamples(samples, caseName)]));
}

export function latencyStats(values) {
  const sorted = values.filter(Number.isFinite).slice().sort((left, right) => left - right);
  if (sorted.length === 0) {
    return { count: 0, medianMs: null, p95Ms: null, minMs: null, maxMs: null };
  }

  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  const p95Index = Math.max(0, Math.ceil(0.95 * sorted.length) - 1);

  return {
    count: sorted.length,
    medianMs: roundMs(median),
    p95Ms: roundMs(sorted[p95Index]),
    minMs: roundMs(sorted[0]),
    maxMs: roundMs(sorted.at(-1))
  };
}

export function roundMs(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}
