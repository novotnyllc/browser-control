#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const forbiddenFragments = [
  ["/Volumes", "/Data"],
  ["/Users/", ["c", "l", "a", "i", "r", "e"].join("")],
  ["Library/Cloud", "Storage"],
  [String.raw`\.codex`, "/plugins/", "cache"],
  ["/private", "/var"],
  ["/t", "mp/"]
];

const forbiddenPatterns = forbiddenFragments.map((fragments) => new RegExp(fragments.join("")));
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "extension-host",
  "prompt-exports"
]);
const ignoredFiles = new Set(["package-lock.json"]);

const root = path.resolve(new URL("..", import.meta.url).pathname);
const matches = [];

for (const filePath of walk(root)) {
  const relative = path.relative(root, filePath);
  if (ignoredFiles.has(path.basename(filePath))) continue;
  const text = readTextFile(filePath);
  if (text == null) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (forbiddenPatterns.some((pattern) => pattern.test(line))) {
      matches.push(`${relative}:${index + 1}:${line}`);
    }
  });
}

if (matches.length > 0) {
  console.error(matches.join("\n"));
  process.exit(1);
}

console.log("No forbidden local paths found.");

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      yield* walk(path.join(directory, entry.name));
    } else if (entry.isFile()) {
      yield path.join(directory, entry.name);
    }
  }
}

function readTextFile(filePath) {
  const stat = statSync(filePath);
  if (stat.size > 1024 * 1024) return null;
  const buffer = readFileSync(filePath);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}
