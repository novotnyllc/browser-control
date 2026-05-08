#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const roots = ["scripts", "src", "test"];
const files = [];

function collect(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) collect(fullPath);
    else if (/\.(mjs|js)$/.test(entry)) files.push(fullPath);
  }
}

for (const root of roots) collect(root);
for (const file of files) {
  execFileSync("node", ["--check", file], { stdio: "inherit" });
}
console.log(`Checked ${files.length} JavaScript files.`);
