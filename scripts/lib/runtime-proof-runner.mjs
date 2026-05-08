import { enrichBackendsFromProcesses } from "./runtime-backends.mjs";

export async function runRuntimeProof({ target, agentLike, includeTabs = false, enrichOptions = {} }) {
  const enriched = await enrichBackendsFromProcesses(agentLike, enrichOptions);
  const selected = enriched.find((browser) => browser.resolved && browser.backend.targetId === target.id);
  if (!selected) {
    const available = enriched.map((browser) => ({
      id: browser.info.id,
      reportedName: browser.info.name,
      resolved: browser.resolved,
      targetId: browser.backend.targetId,
      identitySource: browser.backend.identitySource,
      reason: browser.reason
    }));
    throw new Error(`No connected Browser Use extension backend matched ${target.displayName}: ${JSON.stringify(available)}`);
  }

  const result = {
    target: target.id,
    displayName: target.displayName,
    browserClientTrusted: true,
    selectedBrowser: selected.backend,
    tabInspection: includeTabs ? "count-only" : "not-requested"
  };

  if (includeTabs) {
    const browser = await agentLike.browsers.get(selected.info.id);
    const tabs = await browser.user.openTabs();
    result.openTabsCount = tabs.length;
  }

  return result;
}
