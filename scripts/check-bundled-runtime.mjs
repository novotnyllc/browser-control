#!/usr/bin/env node
import { existsSync } from "node:fs";

import {
  bundledBrowserClientPath,
  extensionHostPath
} from "./lib/paths.mjs";

const json = process.argv.includes("--json");

const result = {
  browserClientPath: bundledBrowserClientPath(),
  browserClientExists: existsSync(bundledBrowserClientPath()),
  extensionHostPath: extensionHostPath(),
  extensionHostExists: existsSync(extensionHostPath())
};

result.available = result.browserClientExists && result.extensionHostExists;
result.reason = result.available
  ? "Bundled Codex Browser Use runtime is available."
  : "Missing bundled Codex Browser Use runtime. Install or repair the bundled Browser Use/Chrome plugin before using browser-control.";

if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(result.reason);
  console.log(`browser-client: ${result.browserClientPath}`);
  console.log(`extension-host: ${result.extensionHostPath}`);
}

process.exit(result.available ? 0 : 1);
