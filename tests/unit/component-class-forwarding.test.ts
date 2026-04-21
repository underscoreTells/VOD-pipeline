import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import BeatPanel from "../../src/renderer/lib/components/BeatPanel.svelte";
import ChapterPanel from "../../src/renderer/lib/components/ChapterPanel.svelte";
import ChatPanel from "../../src/renderer/lib/components/ChatPanel.svelte";
import ClipPreview from "../../src/renderer/lib/components/ClipPreview.svelte";
import ChapterPreview from "../../src/renderer/lib/components/ChapterPreview.svelte";

function expectForwardedRootClass(body: string, rootClass: string, forwardedClass: string): void {
  expect(body).toMatch(new RegExp(`<[^>]+class="[^"]*${rootClass}[^"]*${forwardedClass}[^"]*"`));
}

describe("renderer component root class forwarding", () => {
  it("forwards a custom root class through BeatPanel", () => {
    const forwardedClass = "forwarded-beat-panel";
    const { body } = render(BeatPanel, {
      props: {
        class: forwardedClass,
        clips: [],
        chapterStartTime: 0,
        chapterDuration: null,
      },
    });

    expectForwardedRootClass(body, "beat-panel", forwardedClass);
  });

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

  it("forwards a custom root class through ClipPreview", () => {
    const forwardedClass = "forwarded-clip-preview";
    const { body } = render(ClipPreview, {
      props: {
        class: forwardedClass,
      },
    });

    expectForwardedRootClass(body, "clip-preview", forwardedClass);
  });

  it("forwards a custom root class through ChapterPreview", () => {
    const forwardedClass = "forwarded-chapter-preview";
    const { body } = render(ChapterPreview, {
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
