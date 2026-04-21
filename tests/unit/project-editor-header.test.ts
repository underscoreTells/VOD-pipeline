import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/renderer/lib/state/settings.svelte", () => ({
  openSettings: vi.fn(),
}));

vi.mock("../../src/renderer/lib/state/theme.svelte", () => ({
  themeState: {
    current: "dark",
  },
  toggleTheme: vi.fn(),
}));

import ProjectEditorHeader from "../../src/renderer/lib/components/ProjectEditorHeader.svelte";

function expectClassFragment(body: string, fragment: string): void {
  expect(body).toMatch(new RegExp(`class="[^"]*${fragment}[^"]*"`));
}

describe("ProjectEditorHeader", () => {
  it("renders the merged header with import controls when project content exists", () => {
    const { body } = render(ProjectEditorHeader, {
      props: {
        projectName: "Mario Odyssey Part 1",
        showImportMore: true,
        onBack: () => {},
        onImportMore: () => {},
        onExport: () => {},
      },
    });

    expectClassFragment(body, "border-b border-border-subtle bg-surface-page px-4 py-2.5 md:px-5");
    expect(body).toContain("VOD Pipeline");
    expect(body).toContain("Back");
    expect(body).toContain("Mario Odyssey Part 1");
    expect(body).toContain("Import More");
    expect(body).toContain("Export");
    expect(body).toMatch(/title="Toggle theme"/);
    expect(body).toMatch(/<button[^>]*>.*Settings.*<\/button>/s);
    expect(body).not.toContain(">Editing<");
    expect(body).not.toContain(">Editor<");
    expect(body).not.toContain("rounded-full");
  });

  it("keeps export and global controls when import is hidden", () => {
    const { body } = render(ProjectEditorHeader, {
      props: {
        projectName: "Mario Odyssey Part 1",
        showImportMore: false,
        onBack: () => {},
        onImportMore: () => {},
        onExport: () => {},
      },
    });

    expect(body).not.toContain("Import More");
    expect(body).toContain("Export");
    expect(body).toMatch(/title="Toggle theme"/);
    expect(body).toMatch(/<button[^>]*>.*Settings.*<\/button>/s);
    expect(body).toContain("Mario Odyssey Part 1");
    expect(body).not.toContain(">Editing<");
    expect(body).not.toContain(">Editor<");
    expect(body).not.toContain("rounded-full");
  });
});
