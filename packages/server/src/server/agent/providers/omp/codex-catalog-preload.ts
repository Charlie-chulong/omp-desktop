import { createRequire } from "node:module";
import { basename } from "node:path";
import {
  createCodexCatalogFetch,
  migrateCodexCatalogCache,
  type CodexCatalogCacheDatabase,
  type CodexCatalogCacheStatement,
} from "./codex-catalog-policy.js";

interface NativeDatabase extends CodexCatalogCacheDatabase {
  filename: string;
  query(sql: string): CodexCatalogCacheStatement;
  prepare(sql: string, params?: unknown): CodexCatalogCacheStatement;
}

// Bun preloads run before OMP creates its registry or captures fetch. An OMP extension is too late.
globalThis.fetch = createCodexCatalogFetch(globalThis.fetch);
const { Database } = createRequire(import.meta.url)("bun:sqlite") as {
  Database: { prototype: NativeDatabase };
};
const migratedConnections = new WeakSet<NativeDatabase>();
function migrateBeforeCacheStatement(database: NativeDatabase, sql: string): void {
  if (
    !sql.includes("model_cache") ||
    basename(database.filename) !== "models.db" ||
    migratedConnections.has(database)
  ) {
    return;
  }
  // Use the kernel's actual connection, after its profile/XDG selection, before any cache read.
  // Mark first to avoid recursion through Bun's prepare/query aliases during migration.
  migratedConnections.add(database);
  try {
    migrateCodexCatalogCache(database);
  } catch (error) {
    migratedConnections.delete(database);
    throw error;
  }
}
const nativeQuery = Database.prototype.query;
Database.prototype.query = function (sql) {
  migrateBeforeCacheStatement(this, sql);
  return nativeQuery.call(this, sql);
};
const nativePrepare = Database.prototype.prepare;
Database.prototype.prepare = function (sql, params) {
  migrateBeforeCacheStatement(this, sql);
  return nativePrepare.call(this, sql, params);
};
