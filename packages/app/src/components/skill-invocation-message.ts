export interface SkillInvocationMessage {
  name: string;
  userArguments: string | null;
}

const SKILL_INVOCATION_HEADER =
  /^\[IMPORTANT: User invoked the ["“]([^"”\r\n]+)["”] skill; follow its instructions\. Full skill below\.\]\r?\n\r?\n/;
const SKILL_DIRECTORY_FOOTER = /\r?\n\r?\n---\r?\n\r?\n\[Skill directory: [^\]\r\n]+\]\r?\n/;
const USER_ARGUMENTS = /(?:^|\r?\n)User: ([\s\S]*)$/;

/** Recognizes the prompt envelope OMP emits after expanding a slash skill. */
export function parseSkillInvocationMessage(message: string): SkillInvocationMessage | null {
  const header = SKILL_INVOCATION_HEADER.exec(message);
  if (!header) return null;

  const footerStart = message.slice(header[0].length).search(SKILL_DIRECTORY_FOOTER);
  if (footerStart < 0) return null;

  const footer = message.slice(header[0].length + footerStart);
  const userArguments = USER_ARGUMENTS.exec(footer)?.[1] ?? null;
  return { name: header[1]!, userArguments };
}
