import { DomainError } from '../types/errors.ts';

/**
 * Server-Side Database Configuration interface.
 * Represents configuration required for a real production database connection (e.g., PostgreSQL/Cloud SQL).
 * MUST be loaded exclusively from server-side environment variables and NEVER exposed to the client.
 */
export interface ServerDatabaseConfig {
  databaseUrl?: string;
  host: string;
  port: number;
  databaseName: string;
  user: string;
  password?: string;
  ssl: boolean;
  maxPoolSize: number;
  connectionTimeoutMs: number;
}

export function validateServerDatabaseConfig(config: Partial<ServerDatabaseConfig>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.databaseUrl && (!config.host || !config.databaseName || !config.user)) {
    errors.push('Database configuration requires either a valid databaseUrl or host, databaseName, and user');
  }

  if (config.port !== undefined && (config.port <= 0 || config.port > 65535)) {
    errors.push('Database port must be between 1 and 65535');
  }

  if (config.maxPoolSize !== undefined && config.maxPoolSize <= 0) {
    errors.push('maxPoolSize must be greater than 0');
  }

  if (config.connectionTimeoutMs !== undefined && config.connectionTimeoutMs <= 0) {
    errors.push('connectionTimeoutMs must be greater than 0');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Interface representing the required server-side database driver/adapter.
 * In production, a server-side pool (such as pg.Pool or a Cloud SQL connector)
 * implements this interface behind domain repository interfaces.
 */
export interface IServerDatabaseDriver {
  readonly driverName: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  query<T>(statement: string, params?: unknown[]): Promise<T[]>;
  execute(statement: string, params?: unknown[]): Promise<{ affectedRows: number }>;
}

/**
 * Production boundary architecture documentation:
 * 
 * [React Frontend (Vite)]
 *         ↓ (HTTPS REST / Bearer token via /api/*)
 * [Backend API Gateway (Express / Node.js)]
 *         ↓ (Token verification, RBAC & IDOR authorization)
 * [Repository Interfaces (IUserRepository, IJourneyRepository, etc.)]
 *         ↓ (Query translation, schema mapping)
 * [Server-Side Database Adapter]
 *         ↓ (Encrypted connection pool with SSL)
 * [Production Database (PostgreSQL / Cloud SQL / Relational DB)]
 */
export interface IBackendApiRouteContract {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  description: string;
  authorizedRoles: string[];
}

export const REQUIRED_BACKEND_API_ROUTES: IBackendApiRouteContract[] = [
  {
    path: '/api/journeys',
    method: 'GET',
    description: 'Fetch journeys scoped to authenticated user (patient, partner, family, or admin)',
    authorizedRoles: ['PATIENT', 'CARE_PARTNER', 'FAMILY_CONTACT', 'ADMIN'],
  },
  {
    path: '/api/journeys/:id',
    method: 'GET',
    description: 'Retrieve single journey with strict IDOR access control check',
    authorizedRoles: ['PATIENT', 'CARE_PARTNER', 'FAMILY_CONTACT', 'ADMIN'],
  },
  {
    path: '/api/journeys',
    method: 'POST',
    description: 'Create a new round-trip patient journey with domain pricing snapshot',
    authorizedRoles: ['PATIENT', 'ADMIN'],
  },
  {
    path: '/api/journeys/:id/milestones',
    method: 'PUT',
    description: 'Advance journey milestone through domain state machine',
    authorizedRoles: ['CARE_PARTNER', 'PATIENT', 'ADMIN'],
  },
  {
    path: '/api/journeys/:id/emergency',
    method: 'POST',
    description: 'Trigger active journey emergency incident',
    authorizedRoles: ['PATIENT', 'CARE_PARTNER', 'ADMIN'],
  },
  {
    path: '/api/journeys/:id/emergency/resolve',
    method: 'POST',
    description: 'Resolve emergency with strictly operational/non-clinical notes and restore journey state',
    authorizedRoles: ['ADMIN'],
  },
  {
    path: '/api/pricing/policy',
    method: 'GET',
    description: 'Retrieve active pricing policy configuration',
    authorizedRoles: ['PATIENT', 'CARE_PARTNER', 'FAMILY_CONTACT', 'ADMIN'],
  },
  {
    path: '/api/pricing/policy',
    method: 'PUT',
    description: 'Update pricing policy configuration (admin only)',
    authorizedRoles: ['ADMIN'],
  },
];

/**
 * Explicit status report for the persistence layer.
 * Acknowledges that browser localStorage and node file persistence are local development tools,
 * and defines the exact server-side database requirements for production.
 */
export const PERSISTENCE_ARCHITECTURE_STATUS = {
  environment: 'DEVELOPMENT_FOUNDATION',
  isProductionDatabaseConnected: false,
  storageMode: 'LOCAL_DEVELOPMENT_ADAPTERS',
  notice:
    'Browser localStorage and local JSON file storage are DEVELOPMENT / PROTOTYPE / TEST RUNNER tools only. ' +
    'They DO NOT provide multi-user shared production persistence. ' +
    'A real server-side persistent database (such as PostgreSQL/Cloud SQL) connected via secure backend API ' +
    'is required for production deployment.',
  productionRequirements: [
    'Server-side runtime with port 3000 API proxy',
    'Shared relational database (e.g., PostgreSQL or Cloud SQL)',
    'SSL-encrypted connection pool (DATABASE_URL from server env)',
    'Zero database credentials in client-side bundle or VITE_* variables',
    'All journey, patient, partner, hospital, state history, pricing snapshot, and emergency records persisted centrally',
    'Independent from user browser, device, or individual client instances',
  ],
};
