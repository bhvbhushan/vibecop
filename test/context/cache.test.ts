import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openDb,
  getSkeleton,
  upsertSkeleton,
  hasSessionRead,
  recordSessionRead,
  clearSession,
  incrementStats,
  getSessionStats,
  getAllStats,
  pruneOldSessions,
  getDbPath,
} from "../../src/context/cache.js";
import type { Database } from "bun:sqlite";

let testDir: string;
let db: Database;

beforeEach(() => {
  testDir = join(tmpdir(), `vibecop-cache-test-${Date.now()}`);
  db = openDb(testDir);
});

afterEach(() => {
  db.close();
  try { rmSync(join(testDir, ".vibecop"), { recursive: true }); } catch {}
});

describe("database setup", () => {
  test("creates database file", () => {
    expect(existsSync(getDbPath(testDir))).toBe(true);
  });

  test("uses WAL mode", () => {
    const result = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
    expect(result?.journal_mode).toBe("wal");
  });
});

describe("skeleton operations", () => {
  test("upsert and get skeleton", () => {
    upsertSkeleton(db, "src/foo.ts", "hash1", "import { x } from 'y';", "typescript", 500, 50);
    const result = getSkeleton(db, "src/foo.ts", "hash1");
    expect(result).not.toBeNull();
    expect(result!.skeleton).toBe("import { x } from 'y';");
    expect(result!.fullTokens).toBe(500);
    expect(result!.skeletonTokens).toBe(50);
  });

  test("returns null for wrong hash", () => {
    upsertSkeleton(db, "src/foo.ts", "hash1", "skeleton", "typescript", 500, 50);
    expect(getSkeleton(db, "src/foo.ts", "wrong-hash")).toBeNull();
  });

  test("returns null for non-existent path", () => {
    expect(getSkeleton(db, "nope.ts", "hash1")).toBeNull();
  });

  test("upsert overwrites existing entry", () => {
    upsertSkeleton(db, "src/foo.ts", "hash1", "old", "typescript", 500, 50);
    upsertSkeleton(db, "src/foo.ts", "hash2", "new", "typescript", 600, 60);
    expect(getSkeleton(db, "src/foo.ts", "hash2")?.skeleton).toBe("new");
    expect(getSkeleton(db, "src/foo.ts", "hash1")).toBeNull();
  });
});

describe("session read tracking", () => {
  test("records and checks session read", () => {
    expect(hasSessionRead(db, "sess1", "src/foo.ts")).toBeNull();
    recordSessionRead(db, "sess1", "src/foo.ts", "hash1");
    const read = hasSessionRead(db, "sess1", "src/foo.ts");
    expect(read).not.toBeNull();
    expect(read!.hash).toBe("hash1");
  });

  test("different sessions are independent", () => {
    recordSessionRead(db, "sess1", "src/foo.ts", "hash1");
    expect(hasSessionRead(db, "sess2", "src/foo.ts")).toBeNull();
  });

  test("updates hash on re-read", () => {
    recordSessionRead(db, "sess1", "src/foo.ts", "hash1");
    recordSessionRead(db, "sess1", "src/foo.ts", "hash2");
    expect(hasSessionRead(db, "sess1", "src/foo.ts")?.hash).toBe("hash2");
  });

  test("clears session data", () => {
    recordSessionRead(db, "sess1", "src/foo.ts", "hash1");
    recordSessionRead(db, "sess1", "src/bar.ts", "hash2");
    clearSession(db, "sess1");
    expect(hasSessionRead(db, "sess1", "src/foo.ts")).toBeNull();
    expect(hasSessionRead(db, "sess1", "src/bar.ts")).toBeNull();
  });
});

describe("stats", () => {
  test("increments stats", () => {
    incrementStats(db, "sess1", { totalReads: 1, cacheHits: 0, tokensSaved: 0 });
    incrementStats(db, "sess1", { totalReads: 1, cacheHits: 1, tokensSaved: 500 });
    const stats = getSessionStats(db, "sess1");
    expect(stats).not.toBeNull();
    expect(stats!.totalReads).toBe(2);
    expect(stats!.cacheHits).toBe(1);
    expect(stats!.tokensSaved).toBe(500);
  });

  test("returns null for unknown session", () => {
    expect(getSessionStats(db, "nope")).toBeNull();
  });

  test("getAllStats returns all sessions", () => {
    incrementStats(db, "sess1", { totalReads: 1 });
    incrementStats(db, "sess2", { totalReads: 2 });
    const all = getAllStats(db);
    expect(all.length).toBe(2);
  });
});

describe("pruning", () => {
  test("prunes old session data", () => {
    recordSessionRead(db, "old-sess", "src/foo.ts", "hash1");
    // Manually backdate the read_at
    db.run("UPDATE session_reads SET read_at = unixepoch() - 864000 WHERE session_id = 'old-sess'");
    const pruned = pruneOldSessions(db, 7);
    expect(pruned).toBeGreaterThan(0);
    expect(hasSessionRead(db, "old-sess", "src/foo.ts")).toBeNull();
  });
});
