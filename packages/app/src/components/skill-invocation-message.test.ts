import { describe, expect, it } from "vitest";

import { parseSkillInvocationMessage } from "./skill-invocation-message";

function expandedSkill(input?: { quote?: '"' | "“"; lineEnding?: "\n" | "\r\n"; args?: string }) {
  const quote = input?.quote ?? '"';
  const closingQuote = quote === "“" ? "”" : quote;
  const eol = input?.lineEnding ?? "\n";
  return [
    `[IMPORTANT: User invoked the ${quote}shannon${closingQuote} skill; follow its instructions. Full skill below.]`,
    "",
    "# Shannon",
    "",
    "Keep this long skill body out of the collapsed message.",
    "",
    "---",
    "",
    "[Skill directory: /Users/test/.agents/skills/shannon]",
    "Resolve relative paths in this skill against this absolute directory.",
    ...(input?.args === undefined ? [] : [`User: ${input.args}`]),
  ].join(eol);
}

describe("parseSkillInvocationMessage", () => {
  it("extracts the invoked skill and preserves multiline user arguments", () => {
    expect(
      parseSkillInvocationMessage(expandedSkill({ args: "inspect this account\nfor fraud" })),
    ).toEqual({
      name: "shannon",
      userArguments: "inspect this account\nfor fraud",
    });
  });

  it("accepts the curly quotes and CRLF emitted by platform variants", () => {
    expect(parseSkillInvocationMessage(expandedSkill({ quote: "“", lineEnding: "\r\n" }))).toEqual({
      name: "shannon",
      userArguments: null,
    });
  });

  it("leaves ordinary or incomplete user messages untouched", () => {
    expect(parseSkillInvocationMessage("Please use the shannon skill")).toBeNull();
    expect(
      parseSkillInvocationMessage(
        '[IMPORTANT: User invoked the "shannon" skill; follow its instructions. Full skill below.]\n\nnot an expanded skill',
      ),
    ).toBeNull();
  });
});
