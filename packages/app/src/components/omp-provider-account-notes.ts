import { z } from "zod";
import { readValidatedJson } from "@/storage/validated-storage";

export const OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY = "@omp-desktop:omp-provider-account-notes";
export function ompProviderAccountNotesStorageKey(scope?: string): string {
  const normalizedScope = scope?.trim();
  return normalizedScope
    ? `${OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY}:${normalizedScope}`
    : OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY;
}
export const OmpProviderAccountNotesSchema = z.record(
  z.string().regex(/^\d+$/),
  z.string().max(200),
);

export interface OmpProviderAccountNotesStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

export async function loadOmpProviderAccountNotes(
  storage: OmpProviderAccountNotesStorage,
  scope?: string,
): Promise<Record<string, string>> {
  const scopedNotes = await readValidatedJson(
    storage,
    ompProviderAccountNotesStorageKey(scope),
    OmpProviderAccountNotesSchema,
  );
  if (scopedNotes !== null) return scopedNotes;
  if (scope) {
    return (
      (await readValidatedJson(
        storage,
        OMP_PROVIDER_ACCOUNT_NOTES_STORAGE_KEY,
        OmpProviderAccountNotesSchema,
      )) ?? {}
    );
  }
  return {};
}

export async function saveOmpProviderAccountNotes(
  storage: OmpProviderAccountNotesStorage,
  notes: Record<string, string>,
  scope?: string,
): Promise<void> {
  const parsed = OmpProviderAccountNotesSchema.parse(notes);
  await storage.setItem(ompProviderAccountNotesStorageKey(scope), JSON.stringify(parsed));
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
  return next;
}
