---
name: browser-control
description: "Browser automation setup and routing for Chrome and Microsoft Edge stable, beta, dev, and canary. Use when the user mentions @browser-control, @chrome-* or @edge-*, or asks for Chrome Dev, Chrome Canary, Edge Dev, or Edge Canary."
---

# Browser Control

Use this skill for browser automation through the Codex Chrome Extension in any supported Chrome or Microsoft Edge channel.

## User-Facing Communication

Keep browser-control status messages brief and task-centered. Do the setup, target selection, connection checks, and backend resolution silently unless the user needs to act or the result depends on those details.

For ordinary tasks, say at most one friendly sentence before acting:

- "I'll use your existing browser session and check Outlook."
- "I'm going to open Outlook in the selected browser and look at your calendar."
- "I found the connected browser; I'm checking the calendar now."

Do not narrate internal plumbing such as backend IDs, native host manifests, process matching, profile detection, target ranking, or runtime proof unless debugging setup or the user explicitly asks.

If blocked, explain the blocker in plain language and give the next action:

- "I found Edge Dev, but the Browser Control extension is not connected in that profile yet. Open that browser once with the extension enabled, then I can continue."
- "I can't safely identify the right browser profile from here. Tell me whether to use Chrome Dev or Edge Dev."

When finishing, answer with the user-visible result first. Mention browser or setup details only if they changed the outcome.

Supported targets:

- Google Chrome / Chrome Stable: `chrome-stable`, `@chrome-stable`
- Google Chrome Beta / Chrome Beta: `chrome-beta`, `@chrome-beta`
- Google Chrome Dev / Chrome Dev: `chrome-dev`, `@chrome-dev`
- Google Chrome Canary / Chrome Canary: `chrome-canary`, `@chrome-canary`
- Microsoft Edge / Edge Stable: `edge-stable`, `@edge-stable`
- Microsoft Edge Beta / Edge Beta: `edge-beta`, `@edge-beta`
- Microsoft Edge Dev / Edge Dev: `edge-dev`, `@edge-dev`
- Microsoft Edge Canary / Edge Canary: `edge-canary`, `@edge-canary`

Treat natural-language requests like "open it in Edge Dev", "use Chrome Dev", "open the beta site in Chrome Canary", or "use my Edge work profile" as Browser Control tasks. If no target is explicit, infer the target with `scripts/select-browser.mjs --json` using the selection order below.

## Runtime

Browser Use runtime connection must execute inside Codex's trusted Node REPL MCP context. The bundled `browser-client.mjs` requires Codex's privileged native pipe injection; a redistributable third-party plugin must not copy that runtime and cannot obtain the privileged pipe by running plain `node`.

When using browser-client directly, import the trusted Browser Use runtime from `CODEX_BROWSER_CONTROL_BROWSER_CLIENT` if that environment variable is set. Otherwise resolve it from `CODEX_HOME` or the user's home directory under the installed bundled Chrome plugin. Do not hardcode absolute local cache paths in skill text or scripts.

Use `scripts/detect-browser.mjs`, `scripts/check-extension.mjs`, and `scripts/native-host.mjs` to establish target identity and local setup, then run Browser Use in the trusted Node REPL MCP context. Current Browser Use extension backends may report the generic display name `Chrome`; when that happens, enrich the backend label through `scripts/lib/runtime-backends.mjs` using the read-only extension-host process resolver first.

Target resolution flow:

1. Gather existing Browser Use extension backends with `listExtensionBackends(agent)` or call `enrichBackendsFromProcesses(agent)` directly; this path is tab-free by default and must not call `openTabs()`.
2. `enrichBackendsFromProcesses(agent)` maps a backend only when a deterministic extension-host/native-host PID association or singleton process/socket association exists.
3. Use enriched labels only when `resolved === true`; unresolved or ambiguous results are safer than guessing by array order.
4. If process resolution is unavailable, optionally call `enrichBackendsFromExistingTabs(agent, targetInventories)` only when existing read-only tab state is already intentionally available for the task.
5. If the result is unresolved or ambiguous, explain in user-facing terms that the correct browser or profile could not be identified; include Browser Use backend IDs only when debugging setup or when the user asks for technical details. Do not create, navigate, claim, inspect, or close tabs just to detect identity.

Use `scripts/connection-status.mjs --target <target> --json` before claiming an existing profile is connected. If it reports `existing-profile-not-connected`, the extension and native-host manifest may be installed correctly but the target browser's existing profile has not started the native host yet. On Windows it can report `connection-observation-unsupported`; treat that as setup/status only, not proof of a live Browser Use connection. In either state, do not substitute an isolated proof profile for real user-profile automation.

When the user does not name a browser/channel, use `scripts/select-browser.mjs --json` to infer it. If task context names an account, domain, org, or profile label, pass that text with `--profile-context`. Selection order is explicit target, clear context/account match, connected browser, frontmost browser, running browser with most recent selected-profile activity, then installed browser with most recent selected-profile activity.

## Setup Checks

From the plugin root:

```sh
npm run validate
npm run validate:runtime  # optional local check when the bundled Browser Use runtime exists
node scripts/browser-targets.mjs --json
node scripts/detect-browser.mjs --target chrome-dev --json
node scripts/check-extension.mjs --target chrome-dev --json
node scripts/native-host.mjs --target chrome-dev --check --json
node scripts/connection-status.mjs --target chrome-dev --json
node scripts/select-browser.mjs --profile-context "work account" --json
```

Use `scripts/native-host.mjs --target <target> --install` only when native-host manifest installation or repair is explicitly part of the task. The script first checks that the bundled Codex Browser Use runtime exists, then writes the target browser's native messaging host manifest and points it at the Codex-provided extension host, or at `CODEX_BROWSER_CONTROL_EXTENSION_HOST` when that override is provided.

If extension detection fails, tell the user to confirm that the [Codex Chrome Extension](https://chromewebstore.google.com/detail/hehggadaopoacecdllhhajmbjkdcmajg) is installed and enabled in the selected browser profile. The same extension is used for supported Chrome and Microsoft Edge channels.

Use `scripts/open-browser.mjs --target <target> --dry-run --json` to verify the launch command without opening a browser. Add `--background` when opening is necessary and should avoid taking focus. On macOS this uses `open -g`, minimizes newly-created target-browser windows, and reactivates the previously-frontmost app; on Windows this resolves the channel-specific executable path and uses a minimized `Start-Process` command with separate browser arguments. For existing-profile wake checks, use `--no-url --profile-directory <profile>` so the browser is nudged without creating a tab.

Use `scripts/runtime-proof.mjs --target <target> --json` only inside the trusted Browser Use runtime context. By default it does not inspect tabs and prints no titles or URLs. Add `--include-tabs` only when a count-only tab check is explicitly needed.

## Safety

- Do not inspect browser cookies, passwords, session stores, or local storage.
- Keep profile discovery limited to extension installation status and selected profile metadata.
- Do not use AppleScript, raw CDP, or desktop automation to work around Browser Use policy or native-host failures.
- When a browser task uses a tab group, create a new task-owned group containing only tabs created by this task. Never add an existing user tab to a Browser Control tab group, even if the tab was claimed or inspected for the task.
- Before finishing a browser task, finalize browser tabs through the Browser Use runtime when a controllable tab was created or claimed.
