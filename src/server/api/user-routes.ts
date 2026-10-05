import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth } from './auth-middleware.ts';
import { JourneyService } from '../../services/journey-service.ts';
import { authorizeAction } from '../../auth/authorization.ts';
import { DomainError } from '../../domain/types/errors.ts';

export function createUserRoutes(journeyService: JourneyService): Router {
  const router = Router();

  /**
   * GET /api/users/me
   * Retrieve current user profile and role details from the database.
   */
  router.get('/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      let profile: any = null;

      if (user.role === 'PATIENT') {
        profile = await journeyService.getPatientProfile(user.id);
      } else if (user.role === 'CARE_PARTNER') {
        profile = await journeyService.getCarePartnerProfile(user.id);
      }

      res.json({
        success: true,
        user,
        profile,
      });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve user profile' });
    }
  });

  /**
   * GET /api/users/patient/:id
   * Retrieve patient profile with IDOR authorization check.
   */
  router.get('/patient/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      // Authorization: Patient themselves, Admin, or authorized Care Partner / Family Contact
      const profile = await journeyService.getPatientProfile(id);
      if (!profile) {
        res.status(404).json({ error: 'ENTITY_NOT_FOUND', message: `Patient profile '${id}' not found` });
        return;
      }

      const auth = authorizeAction(user, 'VIEW_PATIENT_PROFILE', {
        patientId: id,
        trustedContacts: profile.trustedContacts,
      });

      // Also allow Care Partner assigned to one of their active journeys
      let partnerAuthorized = false;
      if (!auth.authorized && user.role === 'CARE_PARTNER') {
        const journeys = await journeyService.getAllJourneys();
        const hasActiveJourneyWithPatient = journeys.some(
          (j) => j.patientId === id && j.carePartnerId === user.id && j.currentState !== 'COMPLETED' && j.currentState !== 'CANCELLED'
        );
        if (hasActiveJourneyWithPatient) {
          partnerAuthorized = true;
        }
      }

      // Also allow authorized Family Contact
      let familyAuthorized = false;
      if (!auth.authorized && user.role === 'FAMILY_CONTACT') {
        const isTrusted = profile.trustedContacts?.some((c) => c.contactUserId === user.id);
        if (isTrusted) {
          familyAuthorized = true;
        }
      }

      if (!auth.authorized && !partnerAuthorized && !familyAuthorized) {
        res.status(403).json({
          error: 'IDOR_VIOLATION',
          message: 'You are not authorized to view this patient profile',
        });
        return;
      }

      res.json({ success: true, profile });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve patient profile' });
    }
  });

  /**
   * GET /api/users/care-partner/:id
   * Retrieve care partner profile.
   */
  router.get('/care-partner/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const profile = await journeyService.getCarePartnerProfile(id);
      if (!profile) {
        res.status(404).json({ error: 'ENTITY_NOT_FOUND', message: `Care partner profile '${id}' not found` });
        return;
      }
      res.json({ success: true, profile });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve care partner profile' });
    }
  });

  /**
   * PUT /api/users/care-partner/availability
   * Update Care Partner availability status ('AVAILABLE' | 'OFFLINE').
   */
  router.put('/care-partner/availability', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      if (user.role !== 'CARE_PARTNER') {
        res.status(403).json({
          error: 'FORBIDDEN_ROLE',
          message: 'Only Care Partners can update availability status',
        });
        return;
      }

      const { status } = req.body;
      if (status !== 'AVAILABLE' && status !== 'OFFLINE') {
        res.status(400).json({
          error: 'INVALID_DATA',
          message: "Availability status must be 'AVAILABLE' or 'OFFLINE'",
        });
        return;
      }

      const updated = await journeyService.setPartnerAvailability(user, status);
      res.json({ success: true, profile: updated });
    } catch (err: any) {
      if (err instanceof DomainError) {
        res.status(400).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update availability status' });
      }
    }
  });

  return router;
}
