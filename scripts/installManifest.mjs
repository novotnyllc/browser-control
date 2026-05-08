import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { TARGETS } from "../src/targets.mjs";
import {
  assertBundledBrowserUseAvailable,
  assertReadableFile,
  extensionHostPath,
  manifestFor,
  nativeHostManifestPath,
  nativeHostRegistryKey
} from "./lib/paths.mjs";

export async function install() {
  assertBundledBrowserUseAvailable();
  const hostPath = extensionHostPath();
  assertReadableFile(hostPath, "extension host");

  await Promise.all(
    Object.values(TARGETS).map(async (target) => {
      const manifestPath = nativeHostManifestPath(target);
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(
        manifestPath,
        JSON.stringify(manifestFor(target), null, 2)
      );
      if (process.platform === "win32") {
        execFileSync("reg", ["add", nativeHostRegistryKey(target), "/ve", "/d", manifestPath, "/f"], {
          stdio: "ignore"
        });
      }
    })
  );
}
