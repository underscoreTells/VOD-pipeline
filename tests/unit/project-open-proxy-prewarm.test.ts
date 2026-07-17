import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectDetailSource = readFileSync(
  new URL("../../src/renderer/lib/components/ProjectDetail.svelte", import.meta.url),
  "utf8"
);
const settingsPanelSource = readFileSync(
  new URL("../../src/renderer/lib/components/SettingsPanel.svelte", import.meta.url),
  "utf8"
);

describe("project-open proxy prewarm", () => {
  it("is controlled by autoGenerateProxies on project mount", () => {
    expect(projectDetailSource).toContain("if (settingsState.settings.autoGenerateProxies)");
    expect(projectDetailSource).toContain("prewarmProjectProxies(project.id");
  });

  it("exposes the project-open prewarm setting", () => {
    expect(settingsPanelSource).toContain(
      "bind:checked={settingsState.settings.autoGenerateProxies}"
    );
    expect(settingsPanelSource).toContain("Prewarm missing proxies when opening a project");
  });
});
