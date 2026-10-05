import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth } from './auth-middleware.ts';
import { JourneyService } from '../../services/journey-service.ts';
import { authorizeAction, getFamilyAccessScope } from '../../auth/authorization.ts';
import { DomainError } from '../../domain/types/errors.ts';

export function createJourneyRoutes(journeyService: JourneyService): Router {
  const router = Router();

  /**
   * GET /api/journeys
   * Scoped to the authenticated user's role.
   */
  router.get('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const statusFilter = req.query.status as string | undefined;
      let journeys = await journeyService.getAllJourneys();

      // Enforce role scoping
      if (user.role === 'PATIENT') {
        journeys = journeys.filter((j) => j.patientId === user.id);
      } else if (user.role === 'CARE_PARTNER') {
        if (statusFilter === 'MATCHING') {
          journeys = journeys.filter((j) => j.currentState === 'MATCHING');
        } else {
          journeys = journeys.filter((j) => j.carePartnerId === user.id || j.currentState === 'MATCHING');
        }
      } else if (user.role === 'FAMILY_CONTACT') {
        // Find authorized patients
        const profilesRepo = journeyService.store.patientProfiles as any;
        const profiles = typeof profilesRepo.findAll === 'function' ? await profilesRepo.findAll() : [];
        const authorizedPatientIds = profiles
          .filter((p: any) => p.trustedContacts?.some((c: any) => c.contactUserId === user.id))
          .map((p: any) => p.userId);
        journeys = journeys.filter((j) => authorizedPatientIds.includes(j.patientId));
      }
      // ADMIN sees all

      if (statusFilter && user.role !== 'CARE_PARTNER') {
        journeys = journeys.filter((j) => j.currentState === statusFilter);
      }

      res.json({ success: true, count: journeys.length, journeys });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve journeys' });
    }
  });

  /**
   * GET /api/journeys/:id
   * Strict IDOR protection and family permission level redaction.
   */
  router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const journey = await journeyService.getJourneyById(id);

      if (!journey) {
        res.status(404).json({ error: 'ENTITY_NOT_FOUND', message: `Journey '${id}' not found` });
        return;
      }

      // Check IDOR authorization
      const patientProfile = await journeyService.getPatientProfile(journey.patientId);
      const auth = authorizeAction(user, 'VIEW_JOURNEY', {
        journey,
        trustedContacts: patientProfile?.trustedContacts,
      });

      if (!auth.authorized) {
        res.status(403).json({
          error: auth.code || 'IDOR_VIOLATION',
          message: auth.reason || 'You are not authorized to view this journey',
        });
        return;
      }

      // Server-side enforcement of Family Permission tiers
      if (user.role === 'FAMILY_CONTACT') {
        const trustedContacts = patientProfile?.trustedContacts || [];
        const scope = getFamilyAccessScope(user, journey, trustedContacts);

        if (scope.permissionLevel === 'EMERGENCY_ONLY') {
          // If emergency is not active, location is redacted
          const redacted: any = {
            id: journey.id,
            patientId: journey.patientId,
            currentState: journey.currentState,
            bookingType: journey.bookingType,
            emergencyLogs: journey.emergencyLogs,
            isEmergencyActive: journey.currentState === 'EMERGENCY_ACTIVE',
            permissionLevel: 'EMERGENCY_ONLY',
            // Location only exposed if emergency is active
            pickupLocation: journey.currentState === 'EMERGENCY_ACTIVE' ? journey.pickupLocation : undefined,
            hospitalDestination: journey.currentState === 'EMERGENCY_ACTIVE' ? journey.hospitalDestination : undefined,
            specialAssistanceNotes: undefined,
            initialFareEstimate: undefined,
            fareEstimate: undefined,
          };
          res.json({ success: true, journey: redacted, scope });
          return;
        } else if (scope.permissionLevel === 'LIVE_LOCATION') {
          // Live location is allowed, but companion notes / fare details are redacted
          const redacted: any = {
            ...journey,
            specialAssistanceNotes: undefined,
            initialFareEstimate: undefined,
            fareEstimate: undefined,
            permissionLevel: 'LIVE_LOCATION',
          };
          res.json({ success: true, journey: redacted, scope });
          return;
        }
      }

      res.json({ success: true, journey });
    } catch (err: any) {
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to retrieve journey' });
    }
  });

  /**
   * POST /api/journeys
   * Create single round-trip journey with immutable fare snapshot.
   */
  router.post('/', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { pickupLocation, hospitalDestination, returnDropoffLocation, bookingType, specialAssistanceNotes } = req.body;

      if (!pickupLocation || !hospitalDestination) {
        res.status(400).json({
          error: 'INVALID_DATA',
          message: 'Both pickupLocation and hospitalDestination are required',
        });
        return;
      }

      // Only patient or admin can create bookings
      const auth = authorizeAction(user, 'CREATE_JOURNEY');
      if (!auth.authorized) {
        res.status(403).json({ error: auth.code || 'UNAUTHORIZED_ACTION', message: auth.reason });
        return;
      }

      const created = await journeyService.createBooking(user, {
        pickupLocation,
        hospitalDestination,
        returnDropoffLocation,
        bookingType: bookingType || 'ON_DEMAND',
        specialAssistanceNotes,
      });

      res.status(201).json({ success: true, journey: created });
    } catch (err: any) {
      if (err instanceof DomainError) {
        res.status(400).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'PERSISTENCE_ERROR', message: 'Failed to create journey' });
      }
    }
  });

  /**
   * POST /api/journeys/:id/accept
   * Care Partner accepts an offered journey in MATCHING state.
   */
  router.post('/:id/accept', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const updated = await journeyService.acceptJourney(user, id);
      res.json({ success: true, journey: updated });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const statusCode = err.code === 'UNAUTHORIZED_TRANSITION' ? 403 : 400;
        res.status(statusCode).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to accept journey' });
      }
    }
  });

  /**
   * PUT /api/journeys/:id/milestones
   * Progress journey through state machine milestones.
   */
  router.put('/:id/milestones', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { targetState, metadata } = req.body;

      if (!targetState) {
        res.status(400).json({ error: 'INVALID_DATA', message: 'targetState is required' });
        return;
      }

      if (targetState === 'PARTNER_ASSIGNED') {
        const updated = await journeyService.acceptJourney(user, id);
        res.json({ success: true, journey: updated });
        return;
      }

      const note = typeof metadata === 'object' && metadata?.note ? String(metadata.note) : undefined;
      const updated = await journeyService.advanceMilestone(user, id, targetState, note);
      res.json({ success: true, journey: updated });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const statusCode = err.code === 'UNAUTHORIZED_TRANSITION' ? 403 : 400;
        res.status(statusCode).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update milestone' });
      }
    }
  });

  /**
   * POST /api/journeys/:id/emergency
   * Trigger in-journey emergency incident.
   */
  router.post('/:id/emergency', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { category, reason, locationSnapshot } = req.body;

      const updated = await journeyService.triggerEmergency(user, id, {
        category,
        reason,
        locationSnapshot,
      });

      res.json({ success: true, journey: updated });
    } catch (err: any) {
      if (err instanceof DomainError) {
        res.status(400).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to trigger emergency' });
      }
    }
  });

  /**
   * POST /api/journeys/:id/emergency/resolve
   * Resolve emergency with strictly operational, non-clinical notes. Admin only.
   */
  router.post('/:id/emergency/resolve', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { operationalResolutionNotes } = req.body;

      if (!operationalResolutionNotes || typeof operationalResolutionNotes !== 'string') {
        res.status(400).json({
          error: 'INVALID_DATA',
          message: 'Operational resolution notes are required to resolve emergency',
        });
        return;
      }

      const updated = await journeyService.resolveEmergency(user, id, operationalResolutionNotes);
      res.json({ success: true, journey: updated });
    } catch (err: any) {
      if (err instanceof DomainError) {
        const statusCode =
          err.code === 'UNAUTHORIZED_ACTION' || err.code === 'UNAUTHORIZED_TRANSITION' ? 403 : 400;
        res.status(statusCode).json({ error: err.code, message: err.message });
      } else {
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to resolve emergency' });
      }
    }
  });

  return router;
}
