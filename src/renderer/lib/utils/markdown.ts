import { Lexer } from "marked";

type MarkdownTableCell = {
  tokens?: MarkdownToken[];
  [key: string]: unknown;
};

type MarkdownListItem = {
  tokens?: MarkdownToken[];
  [key: string]: unknown;
};

export type MarkdownToken = {
  type: string;
  tokens?: MarkdownToken[];
  items?: MarkdownListItem[];
  header?: MarkdownTableCell[];
  rows?: MarkdownTableCell[][];
  [key: string]: unknown;
};

export const CHAT_MARKDOWN_OPTIONS = Object.freeze({
  breaks: false,
  gfm: true,
  headerIds: false,
  mangle: false,
});

function stripHtmlFromCell(cell: MarkdownTableCell): MarkdownTableCell {
  if (!Array.isArray(cell.tokens)) {
    return { ...cell };
  }

  return {
    ...cell,
    tokens: stripHtmlTokens(cell.tokens),
  };
}

function stripHtmlFromItem(item: MarkdownListItem): MarkdownListItem {
  if (!Array.isArray(item.tokens)) {
    return { ...item };
  }

  return {
    ...item,
    tokens: stripHtmlTokens(item.tokens),
  };
}

function stripHtmlFromToken(token: MarkdownToken): MarkdownToken | null {
  if (token.type === "html" || token.type === "tag") {
    return null;
  }

  const nextToken: MarkdownToken = { ...token };

  if (Array.isArray(token.tokens)) {
    nextToken.tokens = stripHtmlTokens(token.tokens);
  }

  if (Array.isArray(token.items)) {
    nextToken.items = token.items.map(stripHtmlFromItem);
  }

  if (Array.isArray(token.header)) {
    nextToken.header = token.header.map(stripHtmlFromCell);
  }

  if (Array.isArray(token.rows)) {
    nextToken.rows = token.rows.map((row) => row.map(stripHtmlFromCell));
  }

  return nextToken;
}

export function stripHtmlTokens(tokens: readonly MarkdownToken[]): MarkdownToken[] {
  return tokens
    .map((token) => stripHtmlFromToken(token))
    .filter((token): token is MarkdownToken => token !== null);
}

export function prepareMarkdownSource(content: string): MarkdownToken[] {
  if (!content.trim()) {
    return [];
  }

  const tokens = Lexer.lex(content, { ...CHAT_MARKDOWN_OPTIONS }) as MarkdownToken[];
  return stripHtmlTokens(tokens);
}

export function isSafeMarkdownHref(href: string | null | undefined): boolean {
  if (!href) {
    return false;
  }

  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
