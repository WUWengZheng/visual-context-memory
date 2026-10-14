import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_DATABASE_PATH = path.join('.visual-context-memory', 'memory.db');

const migrationsDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

function utcNow() {
  return new Date().toISOString();
}

function configure(database) {
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA synchronous = NORMAL');
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL CHECK(length(applied_at) = 24 AND applied_at GLOB '????-??-??T??:??:??.???Z')
    ) STRICT
  `);

  const applied = new Set(
    database.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version),
  );
  const migrations = fs.readdirSync(migrationsDirectory)
    .filter((name) => /^\d{3}-[a-z0-9-]+\.sql$/.test(name))
    .sort();

  for (const filename of migrations) {
    const version = filename.slice(0, -4);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDirectory, filename), 'utf8');
    database.exec('BEGIN IMMEDIATE');
    try {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(version, utcNow());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

function seedSystemActor(database) {
  database.prepare(`
    INSERT OR IGNORE INTO actors(id, actor_type, display_name, external_id, created_at)
    VALUES (?, 'system', 'Visual Context Memory system', NULL, ?)
  `).run(SYSTEM_ACTOR_ID, utcNow());
}

export function initializeDatabase({ dbPath = DEFAULT_DATABASE_PATH } = {}) {
  const resolvedPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const database = new DatabaseSync(resolvedPath);
  try {
    configure(database);
    migrate(database);
    seedSystemActor(database);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

export function withImmediateTransaction(database, operation) {
  const depth = transactionDepth.get(database) ?? 0;
  if (depth > 0) {
    transactionDepth.set(database, depth + 1);
    try {
      return operation();
    } finally {
      transactionDepth.set(database, depth);
    }
  }
  database.exec('BEGIN IMMEDIATE');
  transactionDepth.set(database, 1);
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    transactionDepth.delete(database);
  }
}

const transactionDepth = new WeakMap();
