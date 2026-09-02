import MarkdownIt from "markdown-it";
import { markdownMathPlugin } from "@/components/markdown/math/plugin";

export function createAssistantMarkdownParser(): MarkdownIt {
  const parser = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
  });
  parser.use(markdownMathPlugin);
  const defaultValidateLink = parser.validateLink.bind(parser);

  parser.validateLink = (url: string) =>
    url.trim().toLowerCase().startsWith("file://") || defaultValidateLink(url);

  return parser;
}
