export interface OmpAccountIdentity {
  primary: string | null;
  secondary: string | null;
}

export function resolveOmpLoginAction(input: {
  available: boolean;
  authenticated: boolean;
}): "sign-in" | "add-account" | null {
  if (!input.available) return null;
  return input.authenticated ? "add-account" : "sign-in";
}

export function formatOmpAccountIdentity(identityKey?: string): OmpAccountIdentity {
  const normalized = identityKey?.trim();
  if (!normalized) return { primary: null, secondary: null };

  const parts = normalized
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  const emailPart = parts.find((part) => part.toLowerCase().startsWith("email:"));
  const email = emailPart?.slice(emailPart.indexOf(":") + 1).trim();
  if (!email) return { primary: normalized, secondary: null };

  const qualifiers = parts.filter((part) => part !== emailPart);
  return {
    primary: email,
    secondary: qualifiers.length > 0 ? qualifiers.join(" · ") : null,
  };
}

export function formatOmpAccountSelectionLabel(input: {
  note?: string;
  identityKey?: string;
  fallback: string;
}): string {
  const note = input.note?.trim();
  const identity = formatOmpAccountIdentity(input.identityKey).primary?.trim();
  if (note && identity) return `${note} · ${identity}`;
  return note || identity || input.fallback;
}

export function selectOmpQuotaAccounts<T extends { credentialId: number }>(
  accounts: readonly T[],
  selectedCredentialId: number | null | undefined,
): T[] {
  if (accounts.length <= 1) return [...accounts];
  if (selectedCredentialId === null || selectedCredentialId === undefined) return [];
  const selected = accounts.find((account) => account.credentialId === selectedCredentialId);
  return selected ? [selected] : [];
}
