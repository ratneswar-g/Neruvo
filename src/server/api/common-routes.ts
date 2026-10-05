import { Router, Response, Request } from 'express';
import { JourneyService } from '../../services/journey-service.ts';
import { PERSISTENCE_ARCHITECTURE_STATUS } from '../../domain/storage/production-database-contract.ts';

export function createHospitalRoutes(journeyService: JourneyService): Router {
  const router = Router();

  /**
   * GET /api/hospitals
   * Public or authenticated retrieval of supported hospital destinations.
   */
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const hospitals = await journeyService.getHospitals();
      res.json({ success: true, count: hospitals.length, hospitals });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve hospitals' });
    }
  });

  return router;
}

export function createHealthRoutes(journeyService: JourneyService): Router {
  const router = Router();

  /**
   * GET /api/health
   * Health and persistence architecture status check.
   */
  router.get('/', (_req: Request, res: Response) => {
    const isDbConnected = journeyService.store instanceof Object && 'driver' in journeyService.store
      ? (journeyService.store as any).driver.isConnected()
      : false;

    const storageDesc = typeof (journeyService.store as any).getStorageDescription === 'function'
      ? (journeyService.store as any).getStorageDescription()
      : 'Unknown';

    const isProd = typeof (journeyService.store as any).isProductionDatabase === 'function'
      ? (journeyService.store as any).isProductionDatabase()
      : false;

    res.json({
      status: 'UP',
      uptimeSeconds: process.uptime ? Math.floor(process.uptime()) : 0,
      timestamp: new Date().toISOString(),
      database: {
        type: storageDesc,
        connected: isDbConnected,
        isProductionDatabase: isProd,
      },
      architecture: PERSISTENCE_ARCHITECTURE_STATUS,
    });
  });

  return router;
}
