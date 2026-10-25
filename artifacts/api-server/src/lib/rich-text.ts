/**
 * Formatted text (Message Prep notes, blog posts) is stored as a small, safe subset of
 * HTML. Everything is cleaned here on the server before it is saved, so nothing a
 * browser sends can put scripts, styles or tracking into a page members read.
 */
import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "u", "s", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "hr"],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    b: "strong",
    i: "em",
    strike: "s",
    del: "s",
    h1: "h2",
    h4: "h3",
    h5: "h3",
    h6: "h3",
    a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer nofollow" }),
  },
  // Drop the contents of dangerous elements entirely rather than keeping their text.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object"],
};

const looksLikeHtml = (value: string) => /^\s*<(p|h2|h3|ul|ol|blockquote|hr|br)[\s>/]/i.test(value);

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Notes written before formatting existed were plain text; show them as paragraphs. */
export function plainTextToHtml(text: string): string {
  if (!text.trim()) return "";
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** Safe HTML for any stored value, whether it was saved as plain text or formatted. */
export function toSafeHtml(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  return cleanRichText(looksLikeHtml(value) ? value : plainTextToHtml(value));
}

const EMPTY_PARAGRAPH = String.raw`<p>(?:\s|<br\s*\/?>)*<\/p>`;
const EDGE_EMPTIES = new RegExp(`^(?:\\s|${EMPTY_PARAGRAPH})+|(?:\\s|${EMPTY_PARAGRAPH})+$`, "g");

export function cleanRichText(html: string): string {
  // Empty paragraphs at the start or end (an untouched editor sends "<p></p>", and
  // removed content can leave one behind) are dropped; blank lines in between stay.
  return sanitizeHtml(html, OPTIONS).replace(EDGE_EMPTIES, "").trim();
}

/** Readable plain text, e.g. for excerpts, search and word counts. */
export function richTextToPlain(value: unknown): string {
  const html = toSafeHtml(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|h2|h3|li|blockquote|ul|ol|hr)[^>]*>/gi, "\n");
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function wordsIn(value: unknown): number {
  return richTextToPlain(value).match(/\S+/g)?.length ?? 0;
}
