# Browser Control First Tab Latency Optimization Runs

## Goal

Improve first target-browser connection readiness and, when trusted runtime is available, first controlled-tab creation latency.

Stop criterion:

- oracle-satisfied, or
- at least 30% faster median `connection_readiness_ms` versus baseline without correctness/safety regressions.

## Environment

| Field | Value |
|---|---|
| Date | 2026-05-08 |
| Machine / OS | macOS / `darwin` `arm64` |
| Node version | `v25.9.0` during benchmark (`npm test` also passed under the active repo script environment) |
| Plugin path | `plugins/browser-control` |
| Target | `edge-dev` / Microsoft Edge Dev |
| Profile directory | `Default` |
| Profile context used | no |
| Browser initially running | yes |
| Backend initially connected | yes, 1 connected mapping |
| Trusted runtime available | yes: bundled runtime files present; runtime agent unavailable in normal CLI process |
| Notes | Baseline measured warm connected readiness only. Wake was not requested. Runtime proof and tab creation were skipped because the benchmark was not running in the trusted Node REPL/agent context. |

## Benchmark command

```sh
npm run benchmark:first-tab -- --samples 5 --warmups 1 --include-tab-create --json --output prompt-exports/first-tab-baseline.json
```

JSON output: `plugins/browser-control/prompt-exports/first-tab-baseline.json`

## Baseline

| Metric | Samples | Warmups | Median ms | p95 ms | Min ms | Max ms | Failures | Skipped |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| process-snapshot | 5 | 1 | 91.122 | 110.363 | 79.172 | 110.363 | 0 | 0 |
| select-browser | 5 | 1 | 976.361 | 1094.138 | 945.840 | 1094.138 | 0 | 0 |
| connection-status | 5 | 1 | 155.786 | 176.937 | 148.622 | 176.937 | 0 | 0 |
| connection-readiness | 5 | 1 | 154.335 | 176.443 | 148.244 | 176.443 | 0 | 0 |
| runtime-proof | 0 | 1 |  |  |  |  | 0 | 5 |
| runtime-tab-create | 0 | 1 |  |  |  |  | 0 | 5 |

Correctness status:

- Selected target: `edge-dev`
- Selected profile: `Default`
- Connected mapping count: 1
- Runtime backend resolved: skipped in normal CLI (`trusted-runtime-agent-unavailable-outside-node-repl`)
- Tab creation skipped/created: skipped (`trusted-runtime-agent-unavailable-outside-node-repl`)
- Test results:
  - `npm test` → exit 0
  - `npm run validate` → exit 0
  - `npm --prefix plugins/browser-control run check:runtime` → exit 0; bundled runtime files available
  - `npm run validate:runtime` → exit 0

## Optimization runs

| Run | Candidate | Command / Commit | Median readiness ms | Δ vs baseline | p95 readiness ms | Correctness | Tests | Decision |
|---|---|---|---:|---:|---:|---|---|---|
| 1 | Baseline | `npm run benchmark:first-tab -- --samples 5 --warmups 1 --include-tab-create --json --output prompt-exports/first-tab-baseline.json` | 154.335 | baseline | 176.443 | connected, 1 mapping, native host ready | `npm test`, `npm run validate`, `npm run validate:runtime` all exit 0 | keep |
| 2 | Candidate 1: shared process scan | `npm run benchmark:first-tab -- --samples 5 --warmups 1 --include-tab-create --json --output prompt-exports/first-tab-candidate1-run2.json` | 166.513 (`select-browser` 443.965) | readiness +12.178 ms / +7.89%; `select-browser` -532.396 ms / -54.53% | 204.379 (`select-browser` 591.774) | connected, 1 mapping, native host ready; runtime/tab skipped outside trusted REPL | `npm test`, `npm run validate`, `npm run validate:runtime` all exit 0 | keep: primary target-selection metric improved; readiness slowdown noted as variance concern |
| 3 | Candidate 2: connection-status overlap | Primary corrected evidence: `npm run benchmark:first-tab -- --target edge-dev --profile-directory Default --samples 10 --warmups 1 --include-tab-create --json --output prompt-exports/first-tab-candidate2-run3-edge-dev.json` | not measured: 0 samples, 10 failures (`connection-status` 144.204; `select-browser` 386.496) | readiness unavailable because pinned `edge-dev` was not connected; `connection-status` -11.582 ms / -7.43%; `select-browser` -589.865 ms / -60.42% | not measured (`connection-status` 147.511; `select-browser` 400.022) | pinned `edge-dev` / `Default`; not connected, 0 mappings, native host ready; runtime/tab skipped outside trusted REPL | `npm test`, `npm run validate`, `npm run validate:runtime` all exit 0; corrected benchmark exit 0 | keep: implementation/test decision unchanged, but corrected run cannot evaluate readiness stop criterion because Edge Dev was disconnected |
| 3b | Measurement hardening: `--require-connected` preflight + Candidate 2 pinned rerun | Strict setup check first failed before sampling: `npm run benchmark:first-tab -- --target edge-dev --profile-directory Default --samples 10 --warmups 1 --include-tab-create --require-connected --json --output prompt-exports/first-tab-candidate2-rerun-edge-dev-connected.json`; official rerun used same pinned target/profile with `--wake --require-connected` | 171.284 | +16.949 ms / +10.98% | 245.014 | pinned `edge-dev` / `Default`; preflight `connected-after-wake`, 1 mapping, native host ready; all 10 readiness samples connected; runtime/tab skipped outside trusted REPL | `npm test`, `npm run validate`, `npm run validate:runtime` all exit 0; no-wake preflight exit 1 as intended; wake rerun exit 0 | measurement now comparable enough for next oracle decision; 30% readiness stop criterion not met |
| 3c | Candidate 2 reverted: serial connection-status restored, measurement hardening retained | `npm run benchmark:first-tab -- --target edge-dev --profile-directory Default --samples 10 --warmups 1 --include-tab-create --wake --require-connected --json --output prompt-exports/first-tab-after-candidate2-revert-edge-dev-connected.json` | 152.770 | -1.565 ms / -1.01% | 160.804 | pinned `edge-dev` / `Default`; preflight `connected`, 1 mapping, native host ready; all 10 readiness samples connected; runtime/tab skipped outside trusted REPL | `npm test`, `npm run validate`, `npm run validate:runtime`, strict benchmark all exit 0 | Candidate 2 reverted; keep Candidate 1 and `--require-connected`; measurement clean enough to consider Candidate 3 next |
| 4 | Candidate 3: shared process tree for connection status/socket mapping | `npm run benchmark:first-tab -- --target edge-dev --profile-directory Default --samples 10 --warmups 1 --include-tab-create --wake --require-connected --json --output prompt-exports/first-tab-candidate3-edge-dev-connected.json` | 133.041 | -21.294 ms / -13.80% vs baseline; -19.729 ms / -12.91% vs post-Candidate-2-revert | 138.864 | pinned `edge-dev` / `Default`; preflight `connected`, 1 mapping, native host ready; all 10 readiness samples connected; runtime/tab skipped outside trusted REPL | `npm test`, `npm run validate`, `npm run validate:runtime`, strict benchmark all exit 0 | keep: shared process tree reduced readiness/status without correctness regression; 30% stop criterion not yet met |
| 5 | Candidate 4: profile scan reduction |  |  |  |  |  |  |  |
| 6 | Candidate 5: macOS wake guard optimization |  |  |  |  |  |  |  |

## Per-run notes

### Run 1 — Baseline

- JSON output: `plugins/browser-control/prompt-exports/first-tab-baseline.json`
- Observed hotspots:
  - `select-browser` median is ~976 ms, much higher than connected readiness, consistent with all-target selection doing repeated process/profile/socket work.
  - `connection-readiness` median is ~154 ms and is effectively the extracted connection-status path in the warm connected case.
  - `process-snapshot` median is ~91 ms, a material portion of the status path.
- Correctness issues: none for repo-owned readiness samples; all five readiness samples were connected with one mapping and native host ready.
- Variance / reliability notes:
  - `connection-readiness` spread was ~28 ms (148.244–176.443 ms), acceptable for an initial 5-sample warm baseline.
  - `select-browser` spread was ~148 ms (945.840–1094.138 ms), enough variance to prefer at least 5 samples for candidate comparisons.
  - Runtime files are present, but normal CLI does not have the trusted runtime agent; runtime proof and runtime-tab-create are not comparable until run in trusted Node REPL context.
- Follow-up:
  - First optimization loop can start with Candidate 1 or Candidate 2 from the scaffold.
  - Keep runtime-tab-create optional and skipped unless a trusted agent context and safe `browser.tabs.new()` API are confirmed.

### Run 2 — Candidate 1: shared process scan across target selection

- Candidate: Share one process snapshot across `inspectBrowserTargets()` and pass it into every `browserRunningStatus(target, { processes })` call.
- Implementation summary:
  - `scripts/lib/browser-selection.mjs` now obtains one `runningProcessSnapshot()` per inspection unless `options.processes` is supplied.
  - The same snapshot is passed to all per-target running checks.
  - Added focused dependency injection for testability only; no profile-scan reductions, socket-mapping changes, connection-status overlap, wake changes, ordering changes, or redaction changes.
  - Added `targets.test.mjs` coverage proving one process snapshot is shared across all target running checks and target order is preserved.
- Behavior proof:
  - Ordering preserved: yes; still maps over `targetIds()` in the same order.
  - Tie-breaking unchanged: yes; `chooseBrowserTarget()` unchanged.
  - Redaction unchanged: yes; `select-browser.mjs` public output shape unchanged and `browserRunningStatus()` still redacts by default.
  - Safety constraints unchanged: no tab inspection/creation for identity, no backend order guessing, no hardcoded runtime paths.
- Commands:
  - `npm test` → exit 0
  - `npm run validate` → exit 0
  - `npm run validate:runtime` → exit 0
  - `npm run benchmark:first-tab -- --samples 5 --warmups 1 --include-tab-create --json --output prompt-exports/first-tab-candidate1-run2.json` → exit 0
- JSON output: `plugins/browser-control/prompt-exports/first-tab-candidate1-run2.json`
- Primary candidate metric (`select-browser`): median 443.965 ms, p95 591.774 ms.
  - Delta vs baseline: median -532.396 ms (-54.53%); p95 -502.364 ms (-45.91%).
- Secondary check (`connection-readiness`): median 166.513 ms, p95 204.379 ms.
  - Delta vs baseline: median +12.178 ms (+7.89%); p95 +27.936 ms (+15.83%). This path is not touched by Candidate 1, so record as benchmark variance/possible environmental noise rather than a candidate-caused behavior regression.
- Correctness: selected `edge-dev` / `Default`; connected with 1 mapping; native host ready; runtime proof and tab create skipped in normal CLI (`trusted-runtime-agent-unavailable-outside-node-repl`).
- Keep/revert decision: keep. The primary target-selection metric improved substantially with tests passing; note the connection-readiness variance for the next loop.

### Run 3 — Candidate 2: connection-status overlap

- Candidate: Start `connectedMappingsForTarget()` connection observation before local profile/install/running/native-host status work inside `connectionStatusForTarget()`, then await the observation before assembling the same public result.
- Implementation summary:
  - `scripts/lib/connection-status-core.mjs` now starts the connection observation promise first and attaches a no-op rejection handler so a later local synchronous failure cannot leave an unhandled rejection.
  - Result assembly, JSON shape, redaction, native-host diagnostics, status derivation, and Windows unsupported behavior remain unchanged.
  - Added focused `targets.test.mjs` coverage proving connection observation starts before local status work and that the default public/redacted output remains equivalent.
  - Did not pursue shared socket/process discovery, profile-scan reductions, wake changes, or additional target-selection changes.
- Behavior proof:
  - Scheduling: test confirms `connectedMappingsForTarget()` starts before profile selection, install status, running status, and native-host status.
  - Output shape/redaction: test confirms connected result fields, public `connections`, redacted selected profile, redacted context matches, and hidden native-host manifest path.
  - Safety constraints unchanged: no tab inspection/creation for readiness, no backend-order guessing, no hardcoded runtime paths.
- Commands:
  - `npm test` → exit 0
  - `npm run validate` → exit 0
  - `npm run validate:runtime` → exit 0
  - Initial, non-primary benchmark: `npm run benchmark:first-tab -- --samples 10 --warmups 1 --include-tab-create --json --output prompt-exports/first-tab-candidate2-run3.json` → exit 0
  - Corrected pinned benchmark: `npm run benchmark:first-tab -- --target edge-dev --profile-directory Default --samples 10 --warmups 1 --include-tab-create --json --output prompt-exports/first-tab-candidate2-run3-edge-dev.json` → exit 0
- Primary corrected JSON output: `plugins/browser-control/prompt-exports/first-tab-candidate2-run3-edge-dev.json`
- Primary corrected benchmark target/correctness: pinned `edge-dev` / `Default`; `connection-status` reported not connected with 0 mappings and native host ready; all 10 `connection-readiness` samples failed with `existing-profile-not-connected`; runtime proof and tab create skipped in normal CLI (`trusted-runtime-agent-unavailable-outside-node-repl`). The CLI honored `--target edge-dev` for `connection-status` and `connection-readiness`; the independent `select-browser` tracking case still selected `chrome-dev`, which is not a Candidate 2 behavior change.
- Primary corrected readiness metric (`connection-readiness`): not measured; 0 measured samples, 10 failures, p95 unavailable.
  - Delta vs baseline: unavailable because the current pinned `edge-dev` environment is disconnected, while the baseline had `edge-dev` connected with 1 mapping.
  - Stop target remains <=108.035 ms, so Candidate 2 still does not satisfy the 30% median readiness improvement criterion from this corrected run.
- Primary corrected status metric (`connection-status`): median 144.204 ms, p95 147.511 ms.
  - Delta vs baseline: median -11.582 ms (-7.43%); p95 -29.426 ms (-16.63%).
  - Correctness differs from baseline: baseline was connected with 1 mapping; corrected run was not connected with 0 mappings, so even `connection-status` should be interpreted with that state caveat.
- Regression tracking (`select-browser`): median 386.496 ms, p95 400.022 ms.
  - Delta vs baseline: median -589.865 ms (-60.42%); p95 -694.116 ms (-63.44%). Treat as tracking data only because Candidate 2 did not modify selection and this case selected `chrome-dev` during the corrected run.
- Non-primary caveat/evidence: the earlier unpinned Run 3 JSON, `plugins/browser-control/prompt-exports/first-tab-candidate2-run3.json`, selected `chrome-dev` / `Default`, was connected with 3 mappings, and measured `connection-readiness` median 151.438 ms / p95 154.836 ms. It is retained as evidence but is not the primary Candidate 2 delta because it is not target-comparable with baseline or Run 2.
- Keep/revert decision: keep unchanged. Correctness and validation passed, and no code changed during this measurement correction. The corrected edge-dev run does not provide a comparable connected-readiness measurement because Edge Dev was disconnected, so it neither proves the 30% stop criterion nor justifies reverting Candidate 2.

### Run 3b — Measurement hardening and connected Candidate 2 rerun

- Status update after later evidence: Candidate 2 was reverted in Run 3c below. Historical Run 3b evidence is preserved because it drove the oracle revert decision.
- Scope: benchmark harness only. No production connection behavior, browser selection behavior, runtime backend behavior, or optimization candidate was changed.
- Implementation summary:
  - `scripts/benchmark-first-tab-latency.mjs` adds opt-in `--require-connected`.
  - When enabled, the benchmark resolves the pinned target/profile, runs a preflight with the existing `connectionStatusForTarget()` logic, and fails before sampling if the target/profile is not connected.
  - With `--wake --require-connected`, the benchmark reuses the wake/poll readiness helper and proceeds only after `connectedMappingsFor()` observes a connected mapping.
  - Preflight metadata is included in JSON under `measurementPreflight`.
  - Added focused tests for connected preflight, disconnected fail-before-sampling, and wake-to-connected preflight.
- Commands:
  - `npm test` → exit 0
  - `npm run validate` → exit 0
  - `npm run validate:runtime` → exit 0
  - Strict no-wake setup check: `npm run benchmark:first-tab -- --target edge-dev --profile-directory Default --samples 10 --warmups 1 --include-tab-create --require-connected --json --output prompt-exports/first-tab-candidate2-rerun-edge-dev-connected.json` → exit 1, expected setup failure before sampling: `existing-profile-not-connected` with 0 mappings.
  - Official pinned rerun after wake: `npm run benchmark:first-tab -- --target edge-dev --profile-directory Default --samples 10 --warmups 1 --include-tab-create --wake --require-connected --json --output prompt-exports/first-tab-candidate2-rerun-edge-dev-connected.json` → exit 0.
- JSON output: `plugins/browser-control/prompt-exports/first-tab-candidate2-rerun-edge-dev-connected.json`
- Preflight: `connected-after-wake`; target `edge-dev`; profile `Default`; connected mapping count 1; native host ready; connection observable; preflight timings `connectionStatus` 157.762 ms, `launchWake` 131.641 ms.
- Primary connected readiness metric (`connection-readiness`): median 171.284 ms, p95 245.014 ms, min 152.523 ms, max 245.014 ms; 10 measured samples, 0 failures, 0 skipped.
  - Delta vs baseline: median +16.949 ms (+10.98%); p95 +68.571 ms (+38.86%).
  - Stop target remains <=108.035 ms, so the 30% median readiness improvement criterion is not met.
- Connected status metric (`connection-status`): median 199.405 ms, p95 285.344 ms; 10 measured samples, 0 failures, 0 skipped.
- Regression tracking (`select-browser`): median 415.378 ms, p95 494.927 ms; selected `edge-dev` / `Default` for all measured samples.
- Measurement decision: good enough for the next oracle decision because the run is pinned to the baseline target/profile and all readiness samples are connected with one mapping. Candidate 2 remains kept for now, but this rerun does not satisfy the readiness stop criterion.

### Run 3c — Candidate 2 reverted, strict connected post-revert benchmark

- Oracle decision: revert only Candidate 2's `connectionStatusForTarget()` overlap behavior. Do not run Candidate 3 yet during this loop.
- Implementation summary:
  - `scripts/lib/connection-status-core.mjs` now performs profile selection, install status, running status, and native-host status before awaiting `connectedMappingsForTarget()`, restoring serial/equivalent pre-overlap behavior.
  - Kept Candidate 1 shared process scan and all benchmark/setup instrumentation, including `--require-connected`.
  - Updated the Candidate 2 scheduling-specific test expectation to assert the reverted serial order while keeping output/redaction/connection-status correctness coverage.
- Commands:
  - `npm test` → exit 0
  - `npm run validate` → exit 0
  - `npm run validate:runtime` → exit 0
  - Strict pinned post-revert benchmark: `npm run benchmark:first-tab -- --target edge-dev --profile-directory Default --samples 10 --warmups 1 --include-tab-create --wake --require-connected --json --output prompt-exports/first-tab-after-candidate2-revert-edge-dev-connected.json` → exit 0
- JSON output: `plugins/browser-control/prompt-exports/first-tab-after-candidate2-revert-edge-dev-connected.json`
- Preflight: `connected`; target `edge-dev`; profile `Default`; connected mapping count 1; native host ready; connection observable; wake was requested but not attempted because preflight was already connected; preflight `connectionStatus` 169.979 ms.
- Primary connected readiness metric (`connection-readiness`): median 152.770 ms, p95 160.804 ms, min 149.156 ms, max 160.804 ms; 10 measured samples, 0 failures, 0 skipped.
  - Delta vs baseline: median -1.565 ms (-1.01%); p95 -15.639 ms (-8.86%).
  - Delta vs connected Candidate 2 rerun: median -18.514 ms (-10.81%); p95 -84.210 ms (-34.37%).
  - Stop target remains <=108.035 ms, so the 30% median readiness improvement criterion is not met.
- Connected status metric (`connection-status`): median 153.772 ms, p95 157.852 ms, min 150.670 ms, max 157.852 ms; 10 measured samples, 0 failures, 0 skipped.
  - Delta vs baseline: median -2.014 ms (-1.29%); p95 -19.085 ms (-10.79%).
  - Delta vs connected Candidate 2 rerun: median -45.633 ms (-22.88%); p95 -127.492 ms (-44.68%).
- Regression tracking (`select-browser`): median 413.052 ms, p95 432.946 ms; selected `edge-dev` / `Default` for all measured samples. Candidate 1's selection improvement remains present versus the 976.361 ms baseline median.
- Measurement decision: clean enough to consider Candidate 3 next because the run is pinned to the baseline target/profile, strict `--require-connected` was enforced, preflight and all readiness samples were connected with one mapping, native host was ready, and tests/validation passed. Candidate 3 was intentionally not run in this loop.

### Run 4 — Candidate 3: shared process tree for connection status/socket mapping

- Candidate: Share one enriched process tree snapshot between `browserRunningStatus()` and extension-host socket mapping inside the serial `connectionStatusForTarget()` path.
- Implementation summary:
  - `scripts/lib/browser-detection.mjs` adds `runningProcessTreeSnapshot()` with parent process IDs while leaving the legacy `runningProcessSnapshot()` command/shape unchanged.
  - `scripts/lib/runtime-backends.mjs` accepts `processTreeSnapshot` in `extensionHostSocketMappings()` and skips the internal `ps` call when a snapshot is supplied; socket discovery still uses `lsof` and Windows remains unsupported.
  - `scripts/lib/connection-status-core.mjs` collects one shared process tree after profile/install status, passes it to running status, and passes it through `connectedMappingsFor()` mapping options only when the snapshot is an array. If process-tree discovery fails, running status can degrade to unknown while socket mapping falls back without the shared snapshot.
  - Added focused tests for process-tree parsing, snapshot-to-process-map normalization, no internal `ps` when mapping gets a snapshot, shared status/socket use, safe fallback on snapshot failure, and unchanged redacted public output coverage.
  - Did not pursue optional selection-path reuse, profile-scan reduction, wake changes, tab inspection/creation for identity, backend identity guessing by array order, or hardcoded runtime paths.
- Commands:
  - `npm test` → exit 0
  - `npm run validate` → exit 0
  - `npm run validate:runtime` → exit 0
  - Strict pinned benchmark: `npm run benchmark:first-tab -- --target edge-dev --profile-directory Default --samples 10 --warmups 1 --include-tab-create --wake --require-connected --json --output prompt-exports/first-tab-candidate3-edge-dev-connected.json` → exit 0
- JSON output: `plugins/browser-control/prompt-exports/first-tab-candidate3-edge-dev-connected.json`
- Preflight: `connected`; target `edge-dev`; profile `Default`; connected mapping count 1; native host ready; connection observable; wake was requested but not attempted because preflight was already connected; preflight `connectionStatus` 173.620 ms.
- Primary connected readiness metric (`connection-readiness`): median 133.041 ms, p95 138.864 ms, min 129.147 ms, max 138.864 ms; 10 measured samples, 0 failures, 0 skipped.
  - Delta vs baseline: median -21.294 ms (-13.80%); p95 -37.579 ms (-21.30%).
  - Delta vs post-Candidate-2-revert clean run: median -19.729 ms (-12.91%); p95 -21.940 ms (-13.64%).
  - Stop target remains <=108.035 ms, so the 30% median readiness improvement criterion is not met.
- Connected status metric (`connection-status`): median 133.427 ms, p95 136.933 ms, min 128.510 ms, max 136.933 ms; 10 measured samples, 0 failures, 0 skipped.
  - Delta vs baseline: median -22.359 ms (-14.35%); p95 -40.004 ms (-22.61%).
  - Delta vs post-Candidate-2-revert clean run: median -20.345 ms (-13.23%); p95 -20.919 ms (-13.25%).
- Regression tracking (`select-browser`): median 401.064 ms, p95 421.616 ms; selected `edge-dev` / `Default` for all measured samples.
  - Delta vs baseline: median -575.297 ms (-58.92%); p95 -672.522 ms (-61.47%).
  - Delta vs post-Candidate-2-revert clean run: median -11.988 ms (-2.90%); p95 -11.330 ms (-2.62%).
- Keep/revert decision: keep. Tests, validation, strict connected benchmark, redaction/output-shape coverage, Windows unsupported behavior, and socket-mapping fallback all passed; readiness/status improved materially without reintroducing overlap.

## Final stop decision

- Oracle decision: stop under the oracle-satisfied condition after Run 4.
- Final retained changes: Candidate 1 shared process scan, benchmark instrumentation and `--require-connected`, and Candidate 3 shared process tree for connection status/socket mapping.
- Reverted change: Candidate 2 connection-status overlap, because strict connected measurements regressed readiness/status.
- Final strict connected readiness: 154.335 ms baseline -> 133.041 ms final median (-13.80%); p95 176.443 ms -> 138.864 ms (-21.30%).
- Final target selection tracking: 976.361 ms baseline -> 401.064 ms final median (-58.92%).
- Stop rationale: remaining planned candidates mainly target additional selection work or disconnected/wake behavior, not the measured warm connected readiness path; reaching the 30% readiness target would likely require a separate design around caching or changing the connection observation model.
