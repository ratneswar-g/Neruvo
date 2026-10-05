import { DomainError } from '../types/errors.ts';

/**
 * Provider-neutral storage adapter interface.
 * The domain layer and repositories interact only with this interface,
 * allowing any persistence backend (file, browser storage, relational SQL, document store)
 * to be plugged in without changing domain code.
 */
export interface IPersistenceStorageAdapter {
  readonly name: string;
  readonly isProductionDatabase: boolean;
  isAvailable(): boolean;
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(prefix?: string): Promise<string[]>;
  clear(prefix?: string): Promise<void>;
}

/**
 * In-memory fallback adapter for isolated unit tests and transient test execution.
 * Explicitly NOT a production database.
 */
export class MemoryPersistenceAdapter implements IPersistenceStorageAdapter {
  readonly name = 'MemoryPersistenceAdapter';
  readonly isProductionDatabase = false;
  private storage = new Map<string, string>();

  isAvailable(): boolean {
    return true;
  }

  async getItem<T>(key: string): Promise<T | null> {
    const raw = this.storage.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      throw new DomainError('PERSISTENCE_READ_ERROR', `Failed to parse memory record '${key}'`, {
        details: { raw, error: String(err) },
      });
    }
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    try {
      this.storage.set(key, JSON.stringify(value));
    } catch (err) {
      throw new DomainError('PERSISTENCE_WRITE_ERROR', `Failed to serialize record for '${key}'`, {
        details: { error: String(err) },
      });
    }
  }

  async removeItem(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async getAllKeys(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.storage.keys());
    if (!prefix) return keys;
    return keys.filter((k) => k.startsWith(prefix));
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      this.storage.clear();
      return;
    }
    for (const k of Array.from(this.storage.keys())) {
      if (k.startsWith(prefix)) {
        this.storage.delete(k);
      }
    }
  }
}

/**
 * DEVELOPMENT ONLY — Browser LocalStorage adapter.
 * 
 * ARCHITECTURAL NOTICE:
 * Browser localStorage is device-local and browser-instance specific.
 * It DOES NOT constitute production database persistence for Neravu.
 * It cannot serve as a shared production data source between Patient, Care Partner,
 * Family Contact, and Operations Admin.
 * In production, the React frontend interacts with the Server Backend API (/api/*),
 * which manages the shared production database behind repository interfaces.
 */
export class DevelopmentBrowserLocalStorageAdapter implements IPersistenceStorageAdapter {
  readonly name = 'DevelopmentBrowserLocalStorageAdapter';
  readonly isProductionDatabase = false;

  isAvailable(): boolean {
    try {
      return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  async getItem<T>(key: string): Promise<T | null> {
    if (!this.isAvailable()) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Browser localStorage is not available');
    }
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      throw new DomainError('PERSISTENCE_READ_ERROR', `Corrupted localStorage record '${key}'`, {
        details: { error: String(err) },
      });
    }
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    if (!this.isAvailable()) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Browser localStorage is not available');
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      throw new DomainError('PERSISTENCE_WRITE_ERROR', `Failed writing to localStorage for '${key}'`, {
        details: { error: String(err) },
      });
    }
  }

  async removeItem(key: string): Promise<void> {
    if (this.isAvailable()) {
      window.localStorage.removeItem(key);
    }
  }

  async getAllKeys(prefix?: string): Promise<string[]> {
    if (!this.isAvailable()) return [];
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k) {
        if (!prefix || k.startsWith(prefix)) {
          keys.push(k);
        }
      }
    }
    return keys;
  }

  async clear(prefix?: string): Promise<void> {
    if (!this.isAvailable()) return;
    if (!prefix) {
      window.localStorage.clear();
      return;
    }
    const toRemove = await this.getAllKeys(prefix);
    for (const k of toRemove) {
      window.localStorage.removeItem(k);
    }
  }
}

/**
 * Backward compatibility alias for development browser storage.
 * Explicitly marked as not a production database.
 */
export const BrowserLocalStorageAdapter = DevelopmentBrowserLocalStorageAdapter;

/**
 * DEVELOPMENT / TEST RUNNER ONLY — Local filesystem adapter for Node.js.
 * 
 * ARCHITECTURAL NOTICE:
 * Local file storage in a JSON directory (.neravu_data) is for local test runners
 * and single-node development only.
 * It DOES NOT constitute production database persistence for Neravu.
 * In production, a server-side relational database (e.g. PostgreSQL / Cloud SQL)
 * or managed enterprise database with transactional guarantees is required.
 */
export class DevelopmentFilePersistenceAdapter implements IPersistenceStorageAdapter {
  readonly name = 'DevelopmentFilePersistenceAdapter';
  readonly isProductionDatabase = false;
  private baseDir: string;
  private memoryCache = new Map<string, string>();
  private initialized = false;

  constructor(baseDir = '.neravu_data') {
    this.baseDir = baseDir;
  }

  isAvailable(): boolean {
    return typeof process !== 'undefined' && Boolean(process.versions?.node);
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized || !this.isAvailable()) return;
    try {
      const fs = await import('node:fs');
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      this.initialized = true;
    } catch {
      // Fallback to in-memory if disk write is not permitted
    }
  }

  private getFilePath(key: string): string {
    const encoded = encodeURIComponent(key);
    return `${this.baseDir}/${encoded}.json`;
  }

  async getItem<T>(key: string): Promise<T | null> {
    await this.ensureDir();
    try {
      const fs = await import('node:fs');
      const filePath = this.getFilePath(key);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        this.memoryCache.set(key, raw);
        return JSON.parse(raw) as T;
      }
    } catch (err) {
      if (this.memoryCache.has(key)) {
        try {
          return JSON.parse(this.memoryCache.get(key)!) as T;
        } catch {}
      }
      throw new DomainError('PERSISTENCE_READ_ERROR', `Failed reading file record '${key}'`, {
        details: { error: String(err) },
      });
    }

    if (this.memoryCache.has(key)) {
      try {
        return JSON.parse(this.memoryCache.get(key)!) as T;
      } catch {}
    }
    return null;
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    await this.ensureDir();
    const serialized = JSON.stringify(value, null, 2);
    this.memoryCache.set(key, serialized);

    try {
      const fs = await import('node:fs');
      const filePath = this.getFilePath(key);
      fs.writeFileSync(filePath, serialized, 'utf-8');
    } catch (err) {
      if (!this.memoryCache.has(key)) {
        throw new DomainError('PERSISTENCE_WRITE_ERROR', `Failed writing file record '${key}'`, {
          details: { error: String(err) },
        });
      }
    }
  }

  async removeItem(key: string): Promise<void> {
    await this.ensureDir();
    this.memoryCache.delete(key);
    try {
      const fs = await import('node:fs');
      const filePath = this.getFilePath(key);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Safe ignore
    }
  }

  async getAllKeys(prefix?: string): Promise<string[]> {
    await this.ensureDir();
    const keys = new Set<string>(this.memoryCache.keys());
    try {
      const fs = await import('node:fs');
      if (fs.existsSync(this.baseDir)) {
        const files = fs.readdirSync(this.baseDir);
        for (const f of files) {
          if (f.endsWith('.json')) {
            try {
              const rawKey = decodeURIComponent(f.slice(0, -5));
              keys.add(rawKey);
            } catch {
              keys.add(f.slice(0, -5));
            }
          }
        }
      }
    } catch {}

    const list = Array.from(keys);
    if (!prefix) return list;
    return list.filter((k) => k.startsWith(prefix));
  }

  async clear(prefix?: string): Promise<void> {
    await this.ensureDir();
    const keysToRemove = await this.getAllKeys(prefix);
    for (const k of keysToRemove) {
      await this.removeItem(k);
    }
  }
}

/**
 * Backward compatibility alias for development file storage.
 * Explicitly marked as not a production database.
 */
export const NodeFilePersistenceAdapter = DevelopmentFilePersistenceAdapter;

/**
 * Adaptive development persistence adapter that automatically detects the runtime environment
 * and delegates to the most appropriate development store:
 * - In browser: delegates to DevelopmentBrowserLocalStorageAdapter (local page refresh)
 * - In Node.js: delegates to DevelopmentFilePersistenceAdapter (local runner)
 * - Fallback: delegates to MemoryPersistenceAdapter
 * 
 * Explicitly marked as NOT a production database.
 */
export class DevelopmentAdaptivePersistenceAdapter implements IPersistenceStorageAdapter {
  readonly name = 'DevelopmentAdaptivePersistenceAdapter';
  readonly isProductionDatabase = false;
  private primary: IPersistenceStorageAdapter;

  constructor(customAdapter?: IPersistenceStorageAdapter) {
    if (customAdapter) {
      this.primary = customAdapter;
    } else if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      this.primary = new DevelopmentBrowserLocalStorageAdapter();
    } else if (typeof process !== 'undefined' && Boolean(process.versions?.node)) {
      this.primary = new DevelopmentFilePersistenceAdapter();
    } else {
      this.primary = new MemoryPersistenceAdapter();
    }
  }

  get activeAdapter(): IPersistenceStorageAdapter {
    return this.primary;
  }

  isAvailable(): boolean {
    return this.primary.isAvailable();
  }

  async getItem<T>(key: string): Promise<T | null> {
    return this.primary.getItem<T>(key);
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    return this.primary.setItem<T>(key, value);
  }

  async removeItem(key: string): Promise<void> {
    return this.primary.removeItem(key);
  }

  async getAllKeys(prefix?: string): Promise<string[]> {
    return this.primary.getAllKeys(prefix);
  }

  async clear(prefix?: string): Promise<void> {
    return this.primary.clear(prefix);
  }
}

/**
 * Backward compatibility alias for adaptive persistence adapter.
 */
export const AdaptivePersistenceAdapter = DevelopmentAdaptivePersistenceAdapter;

/**
 * Server Shared Persistence Adapter (Simulation of Server-Authoritative Multi-User Persistence).
 * Models a single authoritative server-side persistence store where all connected roles
 * (Patient, Care Partner, Family Contact, and Admin) share the exact same underlying
 * data records without client isolation.
 * 
 * Used for testing server-authoritative multi-user flows, concurrency, and simulated outages.
 */
export class ServerSharedPersistenceAdapter implements IPersistenceStorageAdapter {
  readonly name = 'ServerSharedPersistenceAdapter';
  readonly isProductionDatabase = false; // Simulated until real DB provisioned
  private static sharedStore = new Map<string, string>();
  private simulatedDown = false;

  isAvailable(): boolean {
    return !this.simulatedDown;
  }

  setSimulatedDown(down: boolean): void {
    this.simulatedDown = down;
  }

  async getItem<T>(key: string): Promise<T | null> {
    if (this.simulatedDown) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Server database connection timed out');
    }
    const raw = ServerSharedPersistenceAdapter.sharedStore.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      throw new DomainError('PERSISTENCE_READ_ERROR', `Corrupted server record '${key}'`, {
        details: { error: String(err) },
      });
    }
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    if (this.simulatedDown) {
      throw new DomainError('PERSISTENCE_WRITE_ERROR', 'Cannot write to server database while disconnected');
    }
    try {
      ServerSharedPersistenceAdapter.sharedStore.set(key, JSON.stringify(value));
    } catch (err) {
      throw new DomainError('PERSISTENCE_WRITE_ERROR', `Failed writing server record for '${key}'`, {
        details: { error: String(err) },
      });
    }
  }

  async removeItem(key: string): Promise<void> {
    if (this.simulatedDown) {
      throw new DomainError('PERSISTENCE_WRITE_ERROR', 'Cannot remove server record while disconnected');
    }
    ServerSharedPersistenceAdapter.sharedStore.delete(key);
  }

  async getAllKeys(prefix?: string): Promise<string[]> {
    if (this.simulatedDown) {
      throw new DomainError('STORAGE_UNAVAILABLE', 'Server database connection timed out');
    }
    const keys = Array.from(ServerSharedPersistenceAdapter.sharedStore.keys());
    if (!prefix) return keys;
    return keys.filter((k) => k.startsWith(prefix));
  }

  async clear(prefix?: string): Promise<void> {
    if (!prefix) {
      ServerSharedPersistenceAdapter.sharedStore.clear();
      return;
    }
    for (const k of Array.from(ServerSharedPersistenceAdapter.sharedStore.keys())) {
      if (k.startsWith(prefix)) {
        ServerSharedPersistenceAdapter.sharedStore.delete(k);
      }
    }
  }
}
