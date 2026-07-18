import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import ChapterPanel from "../../src/renderer/lib/components/ChapterPanel.svelte";
import ChatPanel from "../../src/renderer/lib/components/ChatPanel.svelte";
import ChapterEditorViewer from "../../src/renderer/lib/components/ChapterEditorViewer.svelte";

function expectForwardedRootClass(body: string, rootClass: string, forwardedClass: string): void {
  expect(body).toMatch(new RegExp(`<[^>]+class="[^"]*${rootClass}[^"]*${forwardedClass}[^"]*"`));
}

describe("renderer component root class forwarding", () => {
  it("forwards a custom root class through ChapterPanel", () => {
    const forwardedClass = "forwarded-chapter-panel";
    const { body } = render(ChapterPanel, {
      props: {
        class: forwardedClass,
        projectAssets: [],
        onImportClick: () => {},
      },
    });

    expectForwardedRootClass(body, "chapter-panel", forwardedClass);
  });

  it("forwards a custom root class through ChatPanel", () => {
    const forwardedClass = "forwarded-chat-panel";
    const { body } = render(ChatPanel, {
      props: {
        class: forwardedClass,
      },
    });

    expectForwardedRootClass(body, "chat-panel", forwardedClass);
  });

  it("forwards a custom root class through ChapterEditorViewer", () => {
    const forwardedClass = "forwarded-chapter-preview";
    const { body } = render(ChapterEditorViewer, {
      props: {
        class: forwardedClass,
        chapter: null,
        asset: null,
        clips: [],
      },
    });

    expectForwardedRootClass(body, "chapter-preview", forwardedClass);
  });
});
