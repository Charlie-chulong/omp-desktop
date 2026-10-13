export function shouldFocusProjectOnPress(input: {
  metaKey: boolean;
  isMacDesktop: boolean;
}): boolean {
  return input.metaKey && input.isMacDesktop;
}
