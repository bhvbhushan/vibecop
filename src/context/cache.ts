import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_FILENAME = ".vibecop-context.db";

/** Get the database path for a project root. */
export function getDbPath(projectRoot: string): string {
  return join(projectRoot, ".vibecop", DB_FILENAME);
}

/** Open or create the SQLite database with WAL mode. */
export function openDb(projectRoot: string): Database {
  const dbPath = getDbPath(projectRoot);
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 1000");
  initSchema(db);
  return db;
}

function initSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS skeletons (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      skeleton TEXT NOT NULL,
      language TEXT NOT NULL,
      full_tokens INTEGER NOT NULL DEFAULT 0,
      skeleton_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_reads (
      session_id TEXT NOT NULL,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      read_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (session_id, path)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS stats (
      session_id TEXT NOT NULL,
      total_reads INTEGER NOT NULL DEFAULT 0,
      cache_hits INTEGER NOT NULL DEFAULT 0,
      tokens_saved INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (session_id)
    )
  `);
}

// ── Skeleton operations ─────────────────────────────────────────────────────

export interface SkeletonRecord {
  skeleton: string;
  fullTokens: number;
  skeletonTokens: number;
}

export function getSkeleton(db: Database, path: string, hash: string): SkeletonRecord | null {
  const row = db.query<{ skeleton: string; full_tokens: number; skeleton_tokens: number }, [string, string]>(
    "SELECT skeleton, full_tokens, skeleton_tokens FROM skeletons WHERE path = ? AND hash = ?",
  ).get(path, hash);
  if (!row) return null;
  return { skeleton: row.skeleton, fullTokens: row.full_tokens, skeletonTokens: row.skeleton_tokens };
}

export function upsertSkeleton(
  db: Database,
  path: string,
  hash: string,
  skeleton: string,
  language: string,
  fullTokens: number,
  skeletonTokens: number,
): void {
  db.run(
    `INSERT INTO skeletons (path, hash, skeleton, language, full_tokens, skeleton_tokens, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())
     ON CONFLICT(path) DO UPDATE SET hash=excluded.hash, skeleton=excluded.skeleton, language=excluded.language, full_tokens=excluded.full_tokens, skeleton_tokens=excluded.skeleton_tokens, updated_at=excluded.updated_at`,
    [path, hash, skeleton, language, fullTokens, skeletonTokens],
  );
}

// ── Session read tracking ───────────────────────────────────────────────────

export function hasSessionRead(db: Database, sessionId: string, path: string): { hash: string } | null {
  const row = db.query<{ hash: string }, [string, string]>(
    "SELECT hash FROM session_reads WHERE session_id = ? AND path = ?",
  ).get(sessionId, path);
  return row ?? null;
}

export function recordSessionRead(db: Database, sessionId: string, path: string, hash: string): void {
  db.run(
    `INSERT INTO session_reads (session_id, path, hash, read_at)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(session_id, path) DO UPDATE SET hash=excluded.hash, read_at=excluded.read_at`,
    [sessionId, path, hash],
  );
}

export function clearSession(db: Database, sessionId: string): void {
  db.run("DELETE FROM session_reads WHERE session_id = ?", [sessionId]);
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function incrementStats(
  db: Database,
  sessionId: string,
  fields: { totalReads?: number; cacheHits?: number; tokensSaved?: number },
): void {
  db.run(
    `INSERT INTO stats (session_id, total_reads, cache_hits, tokens_saved, updated_at)
     VALUES (?, ?, ?, ?, unixepoch())
     ON CONFLICT(session_id) DO UPDATE SET
       total_reads = stats.total_reads + excluded.total_reads,
       cache_hits = stats.cache_hits + excluded.cache_hits,
       tokens_saved = stats.tokens_saved + excluded.tokens_saved,
       updated_at = excluded.updated_at`,
    [sessionId, fields.totalReads ?? 0, fields.cacheHits ?? 0, fields.tokensSaved ?? 0],
  );
}

export interface SessionStats {
  sessionId: string;
  totalReads: number;
  cacheHits: number;
  tokensSaved: number;
}

export function getSessionStats(db: Database, sessionId: string): SessionStats | null {
  const row = db.query<
    { session_id: string; total_reads: number; cache_hits: number; tokens_saved: number },
    [string]
  >("SELECT * FROM stats WHERE session_id = ?").get(sessionId);
  if (!row) return null;
  return {
    sessionId: row.session_id,
    totalReads: row.total_reads,
    cacheHits: row.cache_hits,
    tokensSaved: row.tokens_saved,
  };
}

export function getAllStats(db: Database): SessionStats[] {
  const rows = db.query<
    { session_id: string; total_reads: number; cache_hits: number; tokens_saved: number },
    []
  >("SELECT * FROM stats ORDER BY updated_at DESC").all();
  return rows.map((r) => ({
    sessionId: r.session_id,
    totalReads: r.total_reads,
    cacheHits: r.cache_hits,
    tokensSaved: r.tokens_saved,
  }));
}

/** Prune old session data older than N days. */
export function pruneOldSessions(db: Database, days: number = 7): number {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const readsResult = db.run("DELETE FROM session_reads WHERE read_at < ?", [cutoff]);
  const statsResult = db.run("DELETE FROM stats WHERE updated_at < ?", [cutoff]);
  return (readsResult.changes ?? 0) + (statsResult.changes ?? 0);
}
