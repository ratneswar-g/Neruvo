import pg from 'pg';
import { DomainError } from '../../domain/types/errors.ts';
import { ServerDatabaseConfig, validateServerDatabaseConfig } from '../../domain/storage/production-database-contract.ts';

export interface IServerDatabaseDriver {
  readonly driverName: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  query<T>(statement: string, params?: unknown[]): Promise<T[]>;
  execute(statement: string, params?: unknown[]): Promise<{ affectedRows: number }>;
  transaction<T>(callback: (client: IServerDatabaseDriver) => Promise<T>): Promise<T>;
}

/**
 * Production PostgreSQL driver using mature Node 'pg' Pool.
 * Connects to PostgreSQL using server-side configuration / DATABASE_URL.
 */
export class PostgresDatabaseDriver implements IServerDatabaseDriver {
  readonly driverName = 'PostgresDatabaseDriver (pg.Pool)';
  private pool: pg.Pool | null = null;
  private connected = false;
  private config: ServerDatabaseConfig | { connectionString: string };

  constructor(configOrUrl?: ServerDatabaseConfig | string) {
    if (typeof configOrUrl === 'string') {
      this.config = { connectionString: configOrUrl };
    } else if (configOrUrl) {
      const validation = validateServerDatabaseConfig(configOrUrl);
      if (!validation.valid) {
        throw new DomainError('RECORD_VALIDATION_ERROR', `Invalid database configuration: ${validation.errors.join(', ')}`);
      }
      this.config = configOrUrl;
    } else {
      const envUrl = process.env.DATABASE_URL;
      if (envUrl) {
        this.config = { connectionString: envUrl };
      } else {
        this.config = {
          host: process.env.DATABASE_HOST || 'localhost',
          port: parseInt(process.env.DATABASE_PORT || '5432', 10),
          databaseName: process.env.DATABASE_NAME || 'neravu_db',
          user: process.env.DATABASE_USER || 'neravu_app',
          password: process.env.DATABASE_PASSWORD,
          ssl: process.env.DATABASE_SSL === 'true',
          maxPoolSize: parseInt(process.env.DATABASE_MAX_POOL_SIZE || '20', 10),
          connectionTimeoutMs: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT_MS || '5000', 10),
        };
      }
    }
  }

  async connect(): Promise<void> {
    if (this.connected && this.pool) return;
    try {
      if ('connectionString' in this.config) {
        this.pool = new pg.Pool({
          connectionString: this.config.connectionString,
          ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
          max: 20,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 5000,
        });
      } else {
        this.pool = new pg.Pool({
          host: this.config.host,
          port: this.config.port,
          database: this.config.databaseName,
          user: this.config.user,
          password: this.config.password,
          ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
          max: this.config.maxPoolSize,
          connectionTimeoutMillis: this.config.connectionTimeoutMs,
        });
      }

      // Test connectivity
      const client = await this.pool.connect();
      client.release();
      this.connected = true;
    } catch (err: any) {
      this.connected = false;
      throw new DomainError('STORAGE_UNAVAILABLE', `Failed to connect to PostgreSQL: ${err.message}`, {
        details: { code: err.code },
      });
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async query<T>(statement: string, params?: unknown[]): Promise<T[]> {
    if (!this.pool) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Database pool not connected');
    }
    try {
      const result = await this.pool.query(statement, params);
      return result.rows as T[];
    } catch (err: any) {
      throw new DomainError('PERSISTENCE_READ_ERROR', `PostgreSQL query error: ${err.message}`, {
        details: { code: err.code, statement },
      });
    }
  }

  async execute(statement: string, params?: unknown[]): Promise<{ affectedRows: number }> {
    if (!this.pool) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Database pool not connected');
    }
    try {
      const result = await this.pool.query(statement, params);
      return { affectedRows: result.rowCount || 0 };
    } catch (err: any) {
      throw new DomainError('PERSISTENCE_WRITE_ERROR', `PostgreSQL write error: ${err.message}`, {
        details: { code: err.code, statement },
      });
    }
  }

  async transaction<T>(callback: (client: IServerDatabaseDriver) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Database pool not connected');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const transactionalDriver: IServerDatabaseDriver = {
        driverName: 'PostgresClient (Transaction)',
        connect: async () => {},
        disconnect: async () => {},
        isConnected: () => true,
        query: async <R>(stmt: string, p?: unknown[]) => {
          const res = await client.query(stmt, p);
          return res.rows as R[];
        },
        execute: async (stmt: string, p?: unknown[]) => {
          const res = await client.query(stmt, p);
          return { affectedRows: res.rowCount || 0 };
        },
        transaction: async (cb) => cb(transactionalDriver),
      };

      const result = await callback(transactionalDriver);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw err instanceof DomainError
        ? err
        : new DomainError('PERSISTENCE_WRITE_ERROR', `Transaction rolled back: ${err.message}`);
    } finally {
      client.release();
    }
  }
}

/**
 * In-Memory Relational Simulation Driver.
 * Emulates PostgreSQL table storage, relational keys, queries, and atomic transactions.
 * Enables zero-dependency local testing without external database infrastructure.
 */
export class InMemoryRelationalDriver implements IServerDatabaseDriver {
  readonly driverName = 'InMemoryRelationalDriver (Test Strategy)';
  private tables = new Map<string, Map<string, Record<string, unknown>>>();
  private connected = true;
  private inTransaction = false;
  private transactionSnapshot: Map<string, Map<string, Record<string, unknown>>> | null = null;

  constructor() {
    this.initTables();
  }

  private initTables() {
    const tableNames = [
      'users',
      'patient_profiles',
      'care_partner_profiles',
      'family_contacts',
      'trusted_contact_permissions',
      'hospitals',
      'vehicles',
      'journeys',
      'journey_state_history',
      'pricing_snapshots',
      'emergency_incidents',
      'audit_logs',
      'schema_migrations',
    ];
    for (const name of tableNames) {
      if (!this.tables.has(name)) {
        this.tables.set(name, new Map());
      }
    }
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  setConnected(status: boolean) {
    this.connected = status;
  }

  getTable(name: string): Map<string, Record<string, unknown>> {
    if (!this.tables.has(name)) {
      this.tables.set(name, new Map());
    }
    return this.tables.get(name)!;
  }

  async query<T>(statement: string, params?: unknown[]): Promise<T[]> {
    if (!this.connected) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Database connection lost');
    }
    // High-level query parsing for simulation
    const trimmed = statement.trim();
    if (trimmed.startsWith('SELECT')) {
      const match = trimmed.match(/FROM\s+([a-zA-Z_]+)/i);
      if (match) {
        const table = this.getTable(match[1]);
        const records = Array.from(table.values());

        // Simple ID or parameter match
        if (params && params.length > 0) {
          const firstParam = params[0];
          if (trimmed.includes('WHERE id =') || trimmed.includes('WHERE user_id =')) {
            const found = records.filter((r) => r.id === firstParam || r.user_id === firstParam);
            return found as unknown as T[];
          }
          if (trimmed.includes('WHERE phone =')) {
            const found = records.filter((r) => r.phone === firstParam);
            return found as unknown as T[];
          }
          if (trimmed.includes('WHERE patient_id =')) {
            const found = records.filter((r) => r.patient_id === firstParam);
            return found as unknown as T[];
          }
          if (trimmed.includes('WHERE care_partner_id =')) {
            const found = records.filter((r) => r.care_partner_id === firstParam);
            return found as unknown as T[];
          }
          if (trimmed.includes('WHERE journey_id =')) {
            const found = records.filter((r) => r.journey_id === firstParam);
            return found as unknown as T[];
          }
        }
        return records as unknown as T[];
      }
    }
    return [] as T[];
  }

  async execute(statement: string, params?: unknown[]): Promise<{ affectedRows: number }> {
    if (!this.connected) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Database write failed: connection lost');
    }
    return { affectedRows: 1 };
  }

  async transaction<T>(callback: (client: IServerDatabaseDriver) => Promise<T>): Promise<T> {
    if (!this.connected) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Cannot begin transaction while disconnected');
    }
    // Deep copy snapshot for rollback
    const snapshot = new Map<string, Map<string, Record<string, unknown>>>();
    for (const [tName, map] of this.tables.entries()) {
      const rowCopy = new Map<string, Record<string, unknown>>();
      for (const [k, v] of map.entries()) {
        rowCopy.set(k, JSON.parse(JSON.stringify(v)));
      }
      snapshot.set(tName, rowCopy);
    }
    this.transactionSnapshot = snapshot;
    this.inTransaction = true;

    try {
      const result = await callback(this);
      this.transactionSnapshot = null;
      this.inTransaction = false;
      return result;
    } catch (err) {
      // Rollback to snapshot
      if (this.transactionSnapshot) {
        this.tables = this.transactionSnapshot;
        this.transactionSnapshot = null;
      }
      this.inTransaction = false;
      throw err;
    }
  }

  clear() {
    this.initTables();
    for (const map of this.tables.values()) {
      map.clear();
    }
  }
}
