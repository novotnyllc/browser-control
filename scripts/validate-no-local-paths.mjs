#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const forbiddenFragments = [
  ["/Volumes", "/Data"],
  ["/Users/", ["c", "l", "a", "i", "r", "e"].join("")],
  ["Library/Cloud", "Storage"],
  [String.raw`\.codex`, "/plugins/", "cache"],
  ["/private", "/var"],
  ["/t", "mp/"]
];

const pattern = forbiddenFragments
  .map((fragments) => fragments.join(""))
  .join("|");

const ignored = [
  "node_modules",
  ".git",
  "extension-host"
];

const args = ["-n", pattern, "."];
for (const ignore of ignored) args.push("-g", `!${ignore}/**`);

try {
  const output = execFileSync("rg", args, { encoding: "utf8" });
  if (output.trim()) {
    console.error(output);
    process.exit(1);
  }
} catch (error) {
  if (error.status === 1) {
    console.log("No forbidden local paths found.");
    process.exit(0);
  }
  throw error;
}
