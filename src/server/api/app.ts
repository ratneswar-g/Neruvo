import express, { Express, Request, Response, NextFunction } from 'express';
import { JourneyService } from '../../services/journey-service.ts';
import { authenticateToken } from './auth-middleware.ts';
import { createJourneyRoutes } from './journey-routes.ts';
import { createPricingRoutes } from './pricing-routes.ts';
import { createHospitalRoutes, createHealthRoutes } from './common-routes.ts';
import { createUserRoutes } from './user-routes.ts';
import { DomainError } from '../../domain/types/errors.ts';

export function createApiApp(journeyService: JourneyService): Express {
  const app = express();

  // 1. Core security headers and body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // 2. Safe CORS headers for local development and Cloud Run deployment
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id, X-Role, X-Dev-Role');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // 3. Global authentication token extraction
  app.use(authenticateToken);

  // 4. API Routes
  app.use('/api/journeys', createJourneyRoutes(journeyService));
  app.use('/api/pricing', createPricingRoutes(journeyService));
  app.use('/api/hospitals', createHospitalRoutes(journeyService));
  app.use('/api/users', createUserRoutes(journeyService));
  app.use('/api/health', createHealthRoutes(journeyService));

  // 5. 404 handler for unknown /api endpoints
  app.use('/api/*', (_req: Request, res: Response) => {
    res.status(404).json({
      error: 'ENDPOINT_NOT_FOUND',
      message: 'The requested API route does not exist',
    });
  });

  // 6. Safe global error handler (NEVER leak database credentials or internals)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API Error]', err?.message || err);

    if (err instanceof DomainError) {
      res.status(400).json({
        error: err.code,
        message: err.message,
      });
      return;
    }

    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'An internal error occurred while processing your request.',
    });
  });

  return app;
}
