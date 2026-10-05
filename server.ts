import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { IServerDatabaseDriver, PostgresDatabaseDriver, InMemoryRelationalDriver } from './src/server/db/driver.ts';
import { PostgresDomainStore } from './src/server/db/repositories/postgres-repositories.ts';
import { runMigrations } from './src/server/db/migrate.ts';
import { JourneyService } from './src/services/journey-service.ts';
import { createApiApp } from './src/server/api/app.ts';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

async function bootstrapServer() {
  console.log('[Neravu Server] Initializing persistence foundation...');

  // 1. Initialize PostgreSQL or development relational driver
  let dbDriver: IServerDatabaseDriver;
  if (process.env.DATABASE_URL || process.env.DATABASE_HOST) {
    console.log('[Neravu Server] PostgreSQL database configuration detected. Initializing pg.Pool...');
    dbDriver = new PostgresDatabaseDriver();
    try {
      await dbDriver.connect();
      console.log('[Neravu Server] Connected to PostgreSQL. Running database migrations...');
      await runMigrations(dbDriver);
    } catch (err: any) {
      console.error('[Neravu Server] PostgreSQL connection error:', err?.message || err);
      console.warn('[Neravu Server] Falling back to InMemoryRelationalDriver for local execution.');
      dbDriver = new InMemoryRelationalDriver();
    }
  } else {
    console.log('[Neravu Server] No database configuration found. Initializing InMemoryRelationalDriver for local execution.');
    dbDriver = new InMemoryRelationalDriver();
  }

  // 2. Initialize domain store and service
  const domainStore = new PostgresDomainStore(dbDriver);
  const journeyService = new JourneyService(domainStore);
  await journeyService.seedInitialDomainData();

  // 3. Create Express app with /api/* routes
  const app = createApiApp(journeyService);

  // 4. Mount Vite middleware in development, or serve dist in production
  if (!isProduction) {
    console.log('[Neravu Server] Mounting Vite development server in middleware mode...');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    console.log('[Neravu Server] Production mode: Serving static client assets from dist/...');
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      const express = (await import('express')).default;
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  // 5. Start listening on PORT
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Neravu Server] Listening on http://0.0.0.0:${PORT}`);
    console.log(`[Neravu Server] API Endpoints available at http://0.0.0.0:${PORT}/api/health`);
  });

  return { app, server, journeyService, dbDriver };
}

export { bootstrapServer };

// Direct execution
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.ts')) {
  bootstrapServer().catch((err) => {
    console.error('[Neravu Server] Bootstrap failed:', err);
    process.exit(1);
  });
}
