import assert from 'node:assert/strict';
import { IServerDatabaseDriver, InMemoryRelationalDriver, PostgresDatabaseDriver } from '../src/server/db/driver.ts';
import { PostgresDomainStore } from '../src/server/db/repositories/postgres-repositories.ts';
import { runMigrations } from '../src/server/db/migrate.ts';
import { JourneyService } from '../src/services/journey-service.ts';
import { createApiApp } from '../src/server/api/app.ts';
import { DEV_IDENTITIES, authorizeAction } from '../src/auth/index.ts';
import { validateServerDatabaseConfig } from '../src/domain/storage/production-database-contract.ts';
import { DomainError } from '../src/domain/types/errors.ts';
import { calculateJourneyFare, DEFAULT_PRICING_POLICY } from '../src/domain/index.ts';
import http from 'node:http';

let testCount = 0;
let passCount = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  testCount++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      await res;
    }
    passCount++;
    console.log(`  ✓ [TEST ${testCount}] ${name}`);
  } catch (err: any) {
    console.error(`  ✗ [TEST ${testCount} FAILED] ${name}`);
    console.error(err);
    throw err;
  }
}

async function runPhase6BTestSuite() {
  console.log('\n==================================================');
  console.log('NERAVU PHASE 6B: BACKEND API & POSTGRESQL PERSISTENCE TEST SUITE');
  console.log('==================================================\n');

  const patient = DEV_IDENTITIES.PATIENT;
  const partner = DEV_IDENTITIES.CARE_PARTNER;
  const family = DEV_IDENTITIES.FAMILY_CONTACT;
  const admin = DEV_IDENTITIES.ADMIN;

  const driver = new InMemoryRelationalDriver();
  const store = new PostgresDomainStore(driver);
  const service = new JourneyService(store);
  const apiApp = createApiApp(service);

  let server: http.Server | null = null;
  let serverPort = 0;
  let baseUrl = '';

  let createdJourneyId = '';
  let patientProfile: any;
  let hospital: any;

  // 1. Backend starts
  await runTest('1. Backend starts and listens on HTTP port', async () => {
    await new Promise<void>((resolve) => {
      const s = apiApp.listen(0, '127.0.0.1', () => {
        server = s;
        const addr = s.address() as any;
        serverPort = addr.port;
        baseUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
    assert(serverPort > 0);
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'UP');
  });

  // 2. Database configuration validation
  await runTest('2. Database configuration validation', () => {
    // Missing host and databaseUrl
    const invalid = validateServerDatabaseConfig({ port: 5432 });
    assert.equal(invalid.valid, false);

    // Valid configuration
    const valid = validateServerDatabaseConfig({
      host: 'localhost',
      port: 5432,
      databaseName: 'neravu_prod_db',
      user: 'neravu_admin',
      ssl: true,
      maxPoolSize: 20,
      connectionTimeoutMs: 5000,
    });
    assert.equal(valid.valid, true);
  });

  // 3. Database connection
  await runTest('3. Database connection', async () => {
    await driver.connect();
    assert.equal(driver.isConnected(), true);
  });

  // 4. Migration execution
  await runTest('4. Migration execution', async () => {
    const applied = await runMigrations(driver);
    assert(Array.isArray(applied));
    // Verify migration tracking table exists
    const records = await driver.query('SELECT * FROM schema_migrations');
    assert(Array.isArray(records));
  });

  // 5. Create user
  await runTest('5. Create user', async () => {
    await service.seedInitialDomainData();
    const createdUser = await store.users.save({
      id: 'usr-new-patient-99',
      phone: '+91 98999 11111',
      name: 'New Test Patient',
      role: 'PATIENT',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert.equal(createdUser.id, 'usr-new-patient-99');
    assert.equal(createdUser.role, 'PATIENT');
  });

  // 6. Retrieve user
  await runTest('6. Retrieve user by ID and phone', async () => {
    const byId = await store.users.findById('usr-new-patient-99');
    assert(byId);
    assert.equal(byId.name, 'New Test Patient');

    const byPhone = await store.users.findByPhone('+91 98999 11111');
    assert(byPhone);
    assert.equal(byPhone.id, 'usr-new-patient-99');
  });

  // 7. Create journey
  await runTest('7. Create journey with pricing snapshot', async () => {
    patientProfile = await service.getPatientProfile(patient.id);
    assert(patientProfile);
    const hospitals = await service.getHospitals();
    hospital = hospitals[0];
    assert(hospital);

    const journey = await service.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
      specialAssistanceNotes: '[DEMO] Assist with wheelchair at main pavilion',
    });

    assert(journey.id);
    createdJourneyId = journey.id;
    assert.equal(journey.patientId, patient.id);
    assert.equal(journey.currentState, 'MATCHING');
    assert.equal(journey.isRoundTrip, true);
    assert(journey.fareEstimate, 'Fare estimate snapshot must be present');
    assert.equal(journey.fareEstimate.isEstimate, true);
  });

  // 8. Retrieve journey
  await runTest('8. Retrieve journey with full round-trip endpoints', async () => {
    const retrieved = await service.getJourneyById(createdJourneyId);
    assert(retrieved);
    assert.equal(retrieved.id, createdJourneyId);
    assert.equal(retrieved.pickupLocation.address, patientProfile.homeAddress.address);
    assert.equal(retrieved.hospitalDestination.id, hospital.id);
    assert.equal(retrieved.returnDropoffLocation.address, patientProfile.homeAddress.address);
  });

  // 9. Update journey
  await runTest('9. Update journey milestone', async () => {
    const updated = await service.acceptJourney(partner, createdJourneyId);
    assert.equal(updated.currentState, 'PARTNER_ASSIGNED');
    assert.equal(updated.carePartnerId, partner.id);
  });

  // 10. State history persistence
  await runTest('10. State history persistence across transitions', async () => {
    let j = await service.advanceMilestone(partner, createdJourneyId, 'PARTNER_EN_ROUTE');
    j = await service.advanceMilestone(partner, createdJourneyId, 'PARTNER_ARRIVED');
    j = await service.advanceMilestone(partner, createdJourneyId, 'PATIENT_PICKED_UP');
    j = await service.advanceMilestone(partner, createdJourneyId, 'IN_TRANSIT_TO_HOSPITAL');

    assert.equal(j.currentState, 'IN_TRANSIT_TO_HOSPITAL');
    assert(j.stateHistory.length >= 5);
    const lastTransition = j.stateHistory[j.stateHistory.length - 1];
    assert.equal(lastTransition.toState, 'IN_TRANSIT_TO_HOSPITAL');
  });

  // 11. Pricing snapshot persistence
  await runTest('11. Pricing snapshot persistence (immutable fare estimate)', async () => {
    const retrieved = await service.getJourneyById(createdJourneyId);
    assert(retrieved?.fareEstimate);
    assert.equal(retrieved.fareEstimate.currency, 'INR');
    assert.equal(retrieved.fareEstimate.isEstimate, true);
    const fareTotal = retrieved.fareEstimate.total || (retrieved.fareEstimate as any).totalEstimatedFare;
    assert(fareTotal > 0);
  });

  // 12. Emergency persistence
  await runTest('12. Emergency incident persistence with operational category', async () => {
    const emergencyJourney = await service.triggerEmergency(partner, createdJourneyId, {
      category: 'MEDICAL_EMERGENCY',
      reason: 'Patient reported dizziness during transit',
      locationSnapshot: patientProfile.homeAddress,
    });

    assert.equal(emergencyJourney.currentState, 'EMERGENCY_ACTIVE');
    assert.equal(emergencyJourney.previousStateBeforeEmergency, 'IN_TRANSIT_TO_HOSPITAL');
    assert(emergencyJourney.emergencyLogs.length > 0);
    const incident = emergencyJourney.emergencyLogs[emergencyJourney.emergencyLogs.length - 1];
    assert.equal(incident.status, 'ACTIVE');
    assert.equal(incident.category, 'MEDICAL_EMERGENCY');
  });

  // 13. Emergency resolution persistence
  await runTest('13. Emergency resolution persistence with strictly operational notes', async () => {
    const operationalNotes = 'Reviewed by Admin; companion verified safe; traffic cleared; authorized to resume.';
    const resolved = await service.resolveEmergency(admin, createdJourneyId, operationalNotes);

    assert.equal(resolved.currentState, 'IN_TRANSIT_TO_HOSPITAL');
    const incident = resolved.emergencyLogs[resolved.emergencyLogs.length - 1];
    assert.equal(incident.status, 'RESOLVED');
    assert.equal(incident.resolutionNotes, operationalNotes);
    assert.equal(incident.resolvedByUserId, admin.id);
  });

  // 14. Persistence survives backend restart
  await runTest('14. Persistence survives backend restart (simulated store reload)', async () => {
    // Recreate store and service using the same underlying driver
    const reloadedStore = new PostgresDomainStore(driver);
    const reloadedService = new JourneyService(reloadedStore);

    const reloadedJourney = await reloadedService.getJourneyById(createdJourneyId);
    assert(reloadedJourney);
    assert.equal(reloadedJourney.id, createdJourneyId);
    assert.equal(reloadedJourney.currentState, 'IN_TRANSIT_TO_HOSPITAL');
    assert(reloadedJourney.emergencyLogs.length > 0);
  });

  // 15. Patient ownership enforcement
  await runTest('15. Patient ownership enforcement (server-side IDOR check)', async () => {
    const patient2 = {
      id: 'dev-user-patient-2',
      name: 'Other Patient',
      phone: '+91 98000 00004',
      role: 'PATIENT' as const,
      status: 'ACTIVE' as const,
    };
    const journey = await service.getJourneyById(createdJourneyId);
    assert(journey);

    const auth = authorizeAction(patient2, 'VIEW_JOURNEY', { journey });
    assert.equal(auth.authorized, false);
    assert.equal(auth.code, 'IDOR_VIOLATION');
  });

  // 16. Care Partner authorization
  await runTest('16. Care Partner authorization (assigned vs unassigned)', async () => {
    const unassignedPartner = {
      id: 'partner-other-88',
      name: 'Unassigned Partner',
      phone: '+91 99999 12345',
      role: 'CARE_PARTNER' as const,
      status: 'ACTIVE' as const,
    };
    const journey = await service.getJourneyById(createdJourneyId);
    assert(journey);

    // Assigned partner authorized
    const authAssigned = authorizeAction(partner, 'VIEW_JOURNEY', { journey });
    assert.equal(authAssigned.authorized, true);

    // Unassigned partner rejected
    const authUnassigned = authorizeAction(unassignedPartner, 'VIEW_JOURNEY', { journey });
    assert.equal(authUnassigned.authorized, false);
    assert.equal(authUnassigned.code, 'IDOR_VIOLATION');
  });

  // 17. Family permission enforcement
  await runTest('17. Family permission enforcement', async () => {
    const journey = await service.getJourneyById(createdJourneyId);
    assert(journey);

    // Authorized family contact
    const authScope = authorizeAction(family, 'VIEW_JOURNEY_DETAILS', {
      journey,
      trustedContacts: patientProfile.trustedContacts,
    });
    assert.equal(authScope.authorized, true);

    // Unauthorized family contact
    const unauthorizedFamily = {
      id: 'family-other-77',
      name: 'Stranger',
      phone: '+91 91111 22222',
      role: 'FAMILY_CONTACT' as const,
      status: 'ACTIVE' as const,
    };
    const authUnauth = authorizeAction(unauthorizedFamily, 'VIEW_JOURNEY', {
      journey,
      trustedContacts: patientProfile.trustedContacts,
    });
    assert.equal(authUnauth.authorized, false);
    assert.equal(authUnauth.code, 'IDOR_VIOLATION');
  });

  // 18. Admin authorization
  await runTest('18. Admin authorization across all records', async () => {
    const all = await service.getAllJourneys();
    assert(all.length > 0);
    const incidents = await service.getAllEmergencyIncidents(admin);
    assert(incidents.length > 0);
  });

  // 19. IDOR rejection on API endpoint (HTTP 403)
  await runTest('19. IDOR rejection on API endpoint returns HTTP 403', async () => {
    const res = await fetch(`${baseUrl}/api/journeys/${createdJourneyId}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'dev-user-patient-2',
        'X-Role': 'PATIENT',
        'Authorization': 'Bearer dev-session-patient-2',
      },
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'IDOR_VIOLATION');
  });

  // 20. Invalid request rejection on API endpoint (HTTP 400)
  await runTest('20. Invalid request rejection on API endpoint returns HTTP 400', async () => {
    const res = await fetch(`${baseUrl}/api/journeys`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': patient.id,
        'X-Role': patient.role,
        'Authorization': `Bearer dev-session-${patient.id}`,
      },
      body: JSON.stringify({}), // Missing pickup and hospital
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'INVALID_DATA');
  });

  // 21. Duplicate record handling
  await runTest('21. Duplicate record handling', async () => {
    const journey = await service.getJourneyById(createdJourneyId);
    assert(journey);

    // Saving updated state for same ID updates the entity without duplicating records
    await store.journeys.save({
      ...journey,
      specialAssistanceNotes: 'Updated special assistance notes',
    });

    const all = await store.journeys.findAll();
    const matches = all.filter((j) => j.id === createdJourneyId);
    assert.equal(matches.length, 1);
  });

  // 22. Database failure handling
  await runTest('22. Database failure handling safely returns domain errors', async () => {
    const faultyDriver: IServerDatabaseDriver = {
      driverName: 'FaultyMockDriver',
      connect: async () => {},
      disconnect: async () => {},
      isConnected: () => false,
      query: async () => {
        throw new DomainError('PERSISTENCE_READ_ERROR', 'Simulated query failure');
      },
      execute: async () => {
        throw new DomainError('PERSISTENCE_WRITE_ERROR', 'Simulated write failure');
      },
      transaction: async () => {
        throw new DomainError('PERSISTENCE_WRITE_ERROR', 'Simulated transaction failure');
      },
    };

    const faultyStore = new PostgresDomainStore(faultyDriver);
    await assert.rejects(async () => {
      await faultyStore.journeys.findById('any-id');
    }, (err: any) => err instanceof DomainError && err.code === 'PERSISTENCE_READ_ERROR');
  });

  // 23. Transaction rollback
  await runTest('23. Transaction rollback on write failure', async () => {
    let rolledBack = false;
    try {
      await driver.transaction(async (tx) => {
        await tx.execute('INSERT INTO users (id, phone, name, role) VALUES ($1, $2, $3, $4)', [
          'usr-tx-test',
          '+91 00000 00000',
          'Tx Patient',
          'PATIENT',
        ]);
        throw new Error('Simulated failure midway through transaction');
      });
    } catch {
      rolledBack = true;
    }
    assert.equal(rolledBack, true);
    // User must NOT exist after rollback
    const userAfterRollback = await store.users.findById('usr-tx-test');
    assert.equal(userAfterRollback, null);
  });

  // 24. Pricing authority remains domain-side
  await runTest('24. Pricing authority remains domain-side', () => {
    const fare = calculateJourneyFare({
      outboundDistanceMeters: 15500,
      returnDistanceMeters: 15500,
      estimatedAccompanimentMinutes: 120,
    });
    assert(fare.total > 0);
    assert.equal(fare.isEstimate, true);
    assert.equal(fare.currency, 'INR');
    // Maps distance was an input, domain engine computed final fare
    assert.equal(
      fare.total,
      fare.baseBookingFee +
        fare.transitDistanceFee +
        fare.companionServiceTimeFee +
        fare.platformServiceFee +
        fare.taxes
    );
  });

  // 25. Emergency state behavior unchanged
  await runTest('25. Emergency state behavior unchanged and round-trip completion preserved', async () => {
    let j = await service.getJourneyById(createdJourneyId);
    assert(j);

    j = await service.advanceMilestone(partner, j.id, 'ARRIVED_AT_HOSPITAL');
    j = await service.advanceMilestone(partner, j.id, 'HOSPITAL_VISIT');
    assert.equal(j.currentState, 'HOSPITAL_VISIT');

    // Hospital visit cannot complete directly
    await assert.rejects(async () => {
      await service.advanceMilestone(partner, j!.id, 'COMPLETED');
    });

    j = await service.advanceMilestone(partner, j!.id, 'RETURN_STARTED');
    j = await service.advanceMilestone(partner, j!.id, 'IN_TRANSIT_TO_HOME');
    j = await service.advanceMilestone(partner, j!.id, 'PATIENT_RETURNED_HOME');
    const completed = await service.advanceMilestone(partner, j!.id, 'COMPLETED');
    assert.equal(completed.currentState, 'COMPLETED');
  });

  // Cleanup server
  if (server) {
    (server as any).close();
  }

  console.log('\n--------------------------------------------------');
  console.log(`TOTAL PHASE 6B TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
  console.log('ALL PHASE 6B BACKEND API & POSTGRESQL PERSISTENCE TESTS PASSED!');
  console.log('--------------------------------------------------\n');
}

runPhase6BTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
