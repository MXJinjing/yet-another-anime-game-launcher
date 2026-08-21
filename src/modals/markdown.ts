import { marked } from "marked";
import DOMPurify from "dompurify";

/**
 * Renders GitHub-Flavored Markdown (e.g. GitHub release bodies) to sanitized
 * HTML. `marked` produces the HTML and DOMPurify strips any unsafe markup
 * before it is injected with innerHTML.
 */
export function renderMarkdownHtml(markdown: string): string {
  const html = marked.parse(markdown);
  return DOMPurify.sanitize(typeof html === "string" ? html : "");
}
