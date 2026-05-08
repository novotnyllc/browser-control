import { TARGETS } from "../src/targets.mjs";
import {
  assertBundledBrowserUseAvailable,
  assertReadableFile,
  extensionHostPath
} from "./lib/paths.mjs";
import { installNativeHostManifest } from "./lib/native-host-status.mjs";

export async function install() {
  assertBundledBrowserUseAvailable();
  const hostPath = extensionHostPath();
  assertReadableFile(hostPath, "extension host");

  await Promise.all(
    Object.values(TARGETS).map((target) => installNativeHostManifest(target))
  );
}
