import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth } from './auth-middleware.ts';
import { JourneyService } from '../../services/journey-service.ts';
import { DomainError } from '../../domain/types/errors.ts';

export function createPricingRoutes(journeyService: JourneyService): Router {
  const router = Router();

  /**
   * GET /api/pricing/policy
   * Retrieve active pricing policy with development estimate transparency.
   */
  router.get('/policy', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const policy = journeyService.getPricingPolicy();
      res.json({
        success: true,
        policy,
        isDevelopmentPricing: true,
        notice: 'Estimated test configuration only. Not commercial tariff.',
      });
    } catch (err: any) {
      if (err instanceof DomainError) {
        res.status(403).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve pricing policy' });
      }
    }
  });

  /**
   * PUT /api/pricing/policy
   * Admin only. Update pricing policy configuration.
   */
  router.put('/policy', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const newPolicy = req.body;

      if (!newPolicy || typeof newPolicy !== 'object') {
        res.status(400).json({ error: 'INVALID_DATA', message: 'Valid pricing policy object required' });
        return;
      }

      const updated = await journeyService.updatePricingPolicy(user, newPolicy);
      res.json({ success: true, policy: updated });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const statusCode = err.code === 'UNAUTHORIZED_ACTION' ? 403 : 400;
        res.status(statusCode).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update pricing policy' });
      }
    }
  });

  /**
   * POST /api/pricing/estimate
   * Compute authoritative round-trip fare breakdown using domain pricing policy.
   */
  router.post('/estimate', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        outboundDistanceMeters,
        returnDistanceMeters,
        totalDistanceKm,
        estimatedAccompanimentMinutes,
        estimatedHospitalStayMinutes,
      } = req.body;

      let outbound = typeof outboundDistanceMeters === 'number' ? outboundDistanceMeters : 0;
      let returnDist = typeof returnDistanceMeters === 'number' ? returnDistanceMeters : outbound;

      if (!outbound && typeof totalDistanceKm === 'number') {
        // total distance km split across outbound and return legs
        outbound = Math.round((totalDistanceKm * 1000) / 2);
        returnDist = outbound;
      }

      const accompanimentMinutes =
        typeof estimatedAccompanimentMinutes === 'number'
          ? estimatedAccompanimentMinutes
          : typeof estimatedHospitalStayMinutes === 'number'
          ? estimatedHospitalStayMinutes
          : undefined;

      const estimate = journeyService.calculateFareEstimate({
        outboundDistanceMeters: outbound,
        returnDistanceMeters: returnDist,
        estimatedAccompanimentMinutes: accompanimentMinutes,
      });

      res.json({ success: true, estimate });
    } catch (err: any) {
      if (err instanceof DomainError) {
        res.status(400).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to compute fare estimate' });
      }
    }
  });

  return router;
}
