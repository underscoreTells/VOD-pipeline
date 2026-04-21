import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import MarkdownContent from "../../src/renderer/lib/components/MarkdownContent.svelte";
import { isSafeMarkdownHref, prepareMarkdownSource } from "../../src/renderer/lib/utils/markdown.js";

describe("markdown chat rendering", () => {
  it("renders headings, lists, code, blockquotes, tables, links, and strikethrough", () => {
    const { body } = render(MarkdownContent, {
      props: {
        content: [
          "# Heading",
          "",
          "- Bullet one",
          "- Bullet two",
          "",
          "1. First",
          "2. Second",
          "",
          "> Quoted",
          "",
          "`inline`",
          "",
          "```ts",
          "const value = 1;",
          "```",
          "",
          "| Name | Score |",
          "| --- | --- |",
          "| Alex | 10 |",
          "",
          "[Docs](https://example.com)",
          "",
          "~~done~~",
        ].join("\n"),
        role: "assistant",
      },
    });

    expect(body).toMatch(/<h1>[\s\S]*Heading[\s\S]*<\/h1>/);
    expect(body).toContain("<ul>");
    expect(body).toContain("<ol");
    expect(body).toContain("<blockquote>");
    expect(body).toContain("<code>inline</code>");
    expect(body).toContain("markdown-code-block");
    expect(body).toContain("<table>");
    expect(body).toContain('href="https://example.com"');
    expect(body).toMatch(/<del>[\s\S]*done[\s\S]*<\/del>/);
  });

  it("strips raw html before rendering", () => {
    const { body } = render(MarkdownContent, {
      props: {
        content: '<script>alert("x")</script>\n<div onclick="evil()">hello</div>',
      },
    });

    expect(body).not.toContain("<script");
    expect(body).not.toContain("onclick=");
    expect(body).not.toContain("hello");
  });

  it("renders plain text markdown as a paragraph", () => {
    const { body } = render(MarkdownContent, {
      props: {
        content: "Plain text input",
      },
    });

    expect(body).toMatch(/<p>[\s\S]*Plain text input[\s\S]*<\/p>/);
  });

  it("handles empty input", () => {
    const { body } = render(MarkdownContent, {
      props: {
        content: "",
      },
    });

    expect(body).toContain("markdown-content assistant");
  });
});

describe("markdown helpers", () => {
  it("treats only http and https as safe markdown links", () => {
    expect(isSafeMarkdownHref("https://example.com/docs")).toBe(true);
    expect(isSafeMarkdownHref("http://example.com/docs")).toBe(true);
    expect(isSafeMarkdownHref("mailto:test@example.com")).toBe(false);
    expect(isSafeMarkdownHref("javascript:alert(1)")).toBe(false);
  });

  it("drops html tokens while preserving markdown tokens", () => {
    const tokens = prepareMarkdownSource("Safe text\n\n<script>alert(1)</script>\n\n- item");
    const tokenTypes = tokens.map((token) => token.type);

    expect(tokenTypes).toContain("paragraph");
    expect(tokenTypes).toContain("list");
    expect(tokenTypes).not.toContain("html");
    expect(tokenTypes).not.toContain("tag");
  });
});
