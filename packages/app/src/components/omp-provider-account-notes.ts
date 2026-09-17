import { OmpProviderAccountNotesSchema } from "@omp-desktop/protocol/messages";
import { readValidatedJson } from "@/storage/validated-storage";

const OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY = "@omp-desktop:omp-provider-account-notes";

function legacyStorageKeys(scope?: string): string[] {
  const normalizedScope = scope?.trim();
  return normalizedScope
    ? [
        `${OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY}:${normalizedScope}`,
        OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY,
      ]
    : [OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY];
}

export interface OmpProviderAccountNotesStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

export interface LegacyOmpProviderAccountNotes {
  key: string;
  notes: Record<string, string>;
}

export async function loadLegacyOmpProviderAccountNotes(
  storage: OmpProviderAccountNotesStorage,
  scope?: string,
): Promise<LegacyOmpProviderAccountNotes | null> {
  for (const key of legacyStorageKeys(scope)) {
    const notes = await readValidatedJson(storage, key, OmpProviderAccountNotesSchema);
    if (notes !== null) return { key, notes };
  }
  return null;
}

export async function removeLegacyOmpProviderAccountNotes(
  storage: OmpProviderAccountNotesStorage,
  key: string,
): Promise<void> {
  await storage.removeItem(key);
}

export function updateOmpProviderAccountNote(
  notes: Record<string, string>,
  credentialId: number,
  note: string,
): Record<string, string> {
  const next = { ...notes };
  const key = String(credentialId);
  const trimmed = note.trim();
  if (trimmed) next[key] = trimmed;
  else delete next[key];
  return OmpProviderAccountNotesSchema.parse(next);
}
