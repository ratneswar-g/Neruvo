import { IServerDatabaseDriver, PostgresDatabaseDriver } from './driver.ts';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export interface MigrationRecord {
  version: string;
  name: string;
  executed_at: string;
}

export async function runMigrations(driver: IServerDatabaseDriver, migrationsDir?: string): Promise<string[]> {
  const dir = migrationsDir || path.resolve(process.cwd(), 'src/server/db/migrations');
  const applied: string[] = [];

  // Ensure driver is connected
  if (!driver.isConnected()) {
    await driver.connect();
  }

  // 1. Create migrations tracking table
  await driver.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 2. Query already applied migrations
  let existing: MigrationRecord[] = [];
  try {
    existing = await driver.query<MigrationRecord>('SELECT version, name, executed_at FROM schema_migrations ORDER BY version ASC');
  } catch {
    existing = [];
  }
  const appliedVersions = new Set(existing.map((m) => m.version));

  // 3. Read migration files
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const match = file.match(/^(\d+)_(.+)\.sql$/);
      if (!match) continue;
      const [_, version, name] = match;

      if (!appliedVersions.has(version)) {
        const filePath = path.join(dir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        await driver.transaction(async (tx) => {
          // Execute migration DDL
          await tx.execute(sql);
          // Record migration
          await tx.execute(
            'INSERT INTO schema_migrations (version, name, executed_at) VALUES ($1, $2, NOW()) ON CONFLICT (version) DO NOTHING',
            [version, name]
          );
        });

        applied.push(`${version}_${name}`);
        console.log(`[Neravu DB] Applied migration: ${version}_${name}`);
      }
    }
  }

  return applied;
}

// Allow CLI execution: tsx src/server/db/migrate.ts
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('migrate.ts')) {
  dotenv.config();

  if (!process.env.DATABASE_URL && !process.env.DATABASE_HOST) {
    console.log('[Neravu DB Migration CLI]');
    console.log('No DATABASE_URL or DATABASE_HOST configured in environment.');
    console.log('Please provide DATABASE_URL to run migrations against your target PostgreSQL database.');
    console.log('Example: DATABASE_URL=postgresql://user:password@localhost:5432/neravu_db npm run migrate');
    process.exit(0);
  }

  const driver = new PostgresDatabaseDriver();
  driver
    .connect()
    .then(() => runMigrations(driver))
    .then((applied) => {
      console.log(`[Neravu DB] Migrations complete. Applied: ${applied.length}`);
      return driver.disconnect();
    })
    .catch((err) => {
      console.error('[Neravu DB] Migration failed:', err?.message || err);
      process.exit(1);
    });
}
