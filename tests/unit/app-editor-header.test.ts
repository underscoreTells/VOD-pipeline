import { render } from "svelte/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projectSelection = vi.hoisted(() => {
  let selectedProject: {
    id: number;
    name: string;
    created_at: string;
    updated_at: string;
  } | null = null;

  return {
    setSelectedProject(project: typeof selectedProject) {
      selectedProject = project;
    },
    getSelectedProject() {
      return selectedProject;
    },
    reset() {
      selectedProject = null;
    },
  };
});

vi.mock("../../src/renderer/lib/state/project.svelte", () => ({
  projects: {
    items: [],
    loading: false,
    error: null,
    selectedId: null,
  },
  getSelectedProject: () => projectSelection.getSelectedProject(),
  loadProjects: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  selectProject: vi.fn(),
}));

vi.mock("../../src/renderer/lib/state/settings.svelte", () => ({
  openSettings: vi.fn(),
  loadSettings: vi.fn(),
}));

vi.mock("../../src/renderer/lib/state/theme.svelte", () => ({
  themeState: {
    current: "dark",
  },
  toggleTheme: vi.fn(),
}));

vi.mock("../../src/renderer/lib/components/ProjectDetail.svelte", async () => {
  const component = await import("../support/StubComponent.svelte");
  return { default: component.default };
});

vi.mock("../../src/renderer/lib/components/SettingsPanel.svelte", async () => {
  const component = await import("../support/StubComponent.svelte");
  return { default: component.default };
});

import App from "../../src/renderer/App.svelte";

function expectClassFragment(body: string, fragment: string): void {
  expect(body).toMatch(new RegExp(`class="[^"]*${fragment}[^"]*"`));
}

function countStubComponents(body: string): number {
  return (body.match(/data-testid="stub-component"/g) ?? []).length;
}

describe("App editor header", () => {
  beforeEach(() => {
    projectSelection.reset();
  });

  it("keeps the roomy shell header on the project list view", () => {
    const { body } = render(App);

    expectClassFragment(body, "relative z-10 flex items-center justify-between px-8 py-6");
    expectClassFragment(body, "h-9 w-9");
    expectClassFragment(body, "rounded-full");
    expectClassFragment(body, "border-border-subtle");
    expectClassFragment(body, "bg-surface-elevated");
    expect(body).toContain("Your Video Projects");
    expect(countStubComponents(body)).toBe(1);
  });

  it("does not render an editor shell header when a project is open", () => {
    projectSelection.setSelectedProject({
      id: 42,
      name: "Mario Odyssey Part 1",
      created_at: "2026-04-20T12:00:00.000Z",
      updated_at: "2026-04-20T12:00:00.000Z",
    });

    const { body } = render(App);

    expect(body).not.toContain('class="relative z-10 flex items-center justify-between px-8 py-6"');
    expect(body).not.toContain("border-b border-border-subtle px-5 py-3 md:px-6");
    expect(body).not.toContain("VOD Pipeline");
    expect(countStubComponents(body)).toBe(2);
  });
});
