const OMP_PLAN_TURN_PREFIX = `<system-directive>
Plan mode active for this turn. The working tree and system are read-only: NEVER create, edit, delete, or rename files, and NEVER run state-changing commands. You may inspect with read-only tools. Produce or refine the requested plan only.
</system-directive>\n\n`;
const OMP_STANDARD_TURN_PREFIX = `<system-directive>
Plan mode is inactive for this turn. All earlier per-turn Plan mode directives have expired. Follow the current user request normally; working-tree changes are permitted subject to the active tool-approval policy.
</system-directive>\n\n`;

export function buildOmpPlanTurnPrompt(prompt: string): string {
  return `${OMP_PLAN_TURN_PREFIX}${prompt}`;
}

export function buildOmpStandardTurnPrompt(prompt: string): string {
  return `${OMP_STANDARD_TURN_PREFIX}${prompt}`;
}

export function getOmpWorkflowDisplayText(prompt: string): string {
  if (prompt.startsWith(OMP_PLAN_TURN_PREFIX)) {
    return prompt.slice(OMP_PLAN_TURN_PREFIX.length);
  }
  if (prompt.startsWith(OMP_STANDARD_TURN_PREFIX)) {
    return prompt.slice(OMP_STANDARD_TURN_PREFIX.length);
  }
  return prompt;
}
