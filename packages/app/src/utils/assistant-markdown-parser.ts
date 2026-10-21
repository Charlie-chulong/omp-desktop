import MarkdownIt from "markdown-it";
import { markdownMathPlugin } from "@/components/markdown/math/plugin";

export function createAssistantMarkdownParser(typographer = true): MarkdownIt {
  const parser = new MarkdownIt({
    html: false,
    linkify: true,
    typographer,
  });
  parser.use(markdownMathPlugin);
  const defaultValidateLink = parser.validateLink.bind(parser);

  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  return parser;
}
