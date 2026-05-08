---
name: Browser Control
description: "Browser automation setup and routing for Chrome and Microsoft Edge stable, beta, dev, and canary. Use when the user mentions @browser-control, @chrome-stable, @chrome-beta, @chrome-dev, @chrome-canary, @edge-stable, @edge-beta, @edge-dev, or @edge-canary."
---

# Browser Control

Use this skill for browser automation through the Codex Chrome Extension in any supported Chrome or Microsoft Edge channel.

Supported targets:

- `chrome-stable`
- `chrome-beta`
- `chrome-dev`
- `chrome-canary`
- `edge-stable`
- `edge-beta`
- `edge-dev`
- `edge-canary`

## Runtime

Browser Use runtime connection must execute inside Codex's trusted Node REPL MCP context. The bundled `browser-client.mjs` requires Codex's privileged native pipe injection; a redistributable third-party plugin must not copy that runtime and cannot obtain the privileged pipe by running plain `node`.

When using browser-client directly, import the trusted Browser Use runtime from `CODEX_BROWSER_CONTROL_BROWSER_CLIENT` if that environment variable is set. Otherwise resolve it from `CODEX_HOME` or the user's home directory under the installed bundled Chrome plugin. Do not hardcode absolute local cache paths in skill text or scripts.

Use `scripts/detect-browser.mjs`, `scripts/check-extension.mjs`, and `scripts/native-host.mjs` to establish target identity and local setup, then run Browser Use in the trusted Node REPL MCP context. Current Browser Use extension backends may report the generic display name `Chrome`; when that happens, enrich the backend label through `scripts/lib/runtime-backends.mjs` using the read-only extension-host process resolver first.

Target resolution flow:

1. Gather existing Browser Use extension backends with `snapshotExtensionBackends(agent)`.
2. Call `enrichBackendsFromProcesses(agent)` to map each backend to the extension-host process, then to the parent browser process and target channel.
3. Use enriched labels only when `resolved === true`.
4. If process resolution is unavailable or count-mismatched, optionally call `enrichBackendsFromExistingTabs(agent, targetInventories)` when existing read-only tab state is already enough.
5. If the result is unresolved or ambiguous, report the Browser Use backend id and the intended target setup state; do not create, navigate, claim, or close tabs just to detect identity.

Use `scripts/connection-status.mjs --target <target> --json` before claiming an existing profile is connected. If it reports `existing-profile-not-connected`, the extension and native-host manifest may be installed correctly but the target browser's existing profile has not started the native host yet. In that state, do not substitute an isolated proof profile for real user-profile automation.

When the user does not name a browser/channel, use `scripts/select-browser.mjs --json` to infer it. If task context names an account, domain, org, or profile label, pass that text with `--profile-context`. Selection order is explicit target, clear context/account match, connected browser, frontmost browser, running browser with most recent selected-profile activity, then installed browser with most recent selected-profile activity.

## Setup Checks

From the plugin root:

```sh
node scripts/check-bundled-runtime.mjs --json
node scripts/browser-targets.mjs --json
node scripts/detect-browser.mjs --target chrome-dev --json
node scripts/check-extension.mjs --target chrome-dev --json
node scripts/native-host.mjs --target chrome-dev --check --json
node scripts/connection-status.mjs --target chrome-dev --json
node scripts/select-browser.mjs --profile-context "work account" --json
```

Use `scripts/native-host.mjs --target <target> --install` only when native-host manifest installation or repair is explicitly part of the task. The script first checks that the bundled Codex Browser Use runtime exists, then writes the target browser's native messaging host manifest and points it at the Codex-provided extension host, or at `CODEX_BROWSER_CONTROL_EXTENSION_HOST` when that override is provided.

If extension detection fails, tell the user to confirm that the [Codex Chrome Extension](https://chromewebstore.google.com/detail/hehggadaopoacecdllhhajmbjkdcmajg) is installed and enabled in the selected browser profile. The same extension is used for supported Chrome and Microsoft Edge channels.

Use `scripts/open-browser.mjs --target <target> --dry-run --json` to verify the launch command without opening a browser. Add `--background` when opening is necessary and should avoid taking focus. On macOS this uses `open -g`, minimizes newly-created target-browser windows, and reactivates the previously-frontmost app; on Windows this uses a minimized `Start-Process` command. For existing-profile wake checks, use `--no-url --profile-directory <profile>` so the browser is nudged without creating a tab.

## Safety

- Do not inspect browser cookies, passwords, session stores, or local storage.
- Keep profile discovery limited to extension installation status and selected profile metadata.
- Do not use AppleScript, raw CDP, or desktop automation to work around Browser Use policy or native-host failures.
- Before finishing a browser task, finalize browser tabs through the Browser Use runtime when a controllable tab was created or claimed.
