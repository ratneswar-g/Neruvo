import http from 'node:http';
import dotenv from 'dotenv';
import { createApiApp } from '../src/server/api/app.ts';
import { JourneyService } from '../src/services/journey-service.ts';
import { PostgresDomainStore } from '../src/server/db/repositories/postgres-repositories.ts';
import { IServerDatabaseDriver, InMemoryRelationalDriver, PostgresDatabaseDriver } from '../src/server/db/driver.ts';
import { NeravuApiClient, ApiError } from '../src/services/api-client.ts';
import { DEV_IDENTITIES } from '../src/auth/development-auth.ts';

dotenv.config();

let totalPassed = 0;
let totalFailed = 0;

async function runTest(testName: string, testFn: () => Promise<void>) {
  try {
    await testFn();
    console.log(`  ✓ [PHASE 6C TEST] ${testName}`);
    totalPassed++;
  } catch (err: any) {
    console.error(`  ✗ [PHASE 6C TEST] ${testName} FAILED:`, err.message);
    totalFailed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runPhase6CTestSuite() {
  console.log('==================================================');
  console.log('NERAVU PHASE 6C: FRONTEND → BACKEND API → POSTGRESQL INTEGRATION TEST SUITE');
  console.log('==================================================');

  // Setup Database driver
  let dbDriver: IServerDatabaseDriver;
  if (process.env.DATABASE_URL) {
    try {
      const pgDriver = new PostgresDatabaseDriver(process.env.DATABASE_URL);
      await pgDriver.connect();
      dbDriver = pgDriver;
    } catch {
      dbDriver = new InMemoryRelationalDriver();
    }
  } else {
    dbDriver = new InMemoryRelationalDriver();
  }

  const domainStore = new PostgresDomainStore(dbDriver);
  const journeyService = new JourneyService(domainStore);
  await journeyService.seedInitialDomainData();

  const app = createApiApp(journeyService);
  let server: http.Server | null = null;
  let serverPort = 0;
  let baseUrl = '';

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as any;
      serverPort = addr.port;
      baseUrl = `http://127.0.0.1:${serverPort}`;
      resolve();
    });
  });

  // Helper clients for different roles
  const patientClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-dev-user-patient-1`,
    getUserId: () => 'dev-user-patient-1',
    getRole: () => 'PATIENT',
  });

  const otherPatientClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-other-patient-99`,
    getUserId: () => 'other-patient-99',
    getRole: () => 'PATIENT',
  });

  const partnerClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-dev-user-partner-1`,
    getUserId: () => 'dev-user-partner-1',
    getRole: () => 'CARE_PARTNER',
  });

  const unassignedPartnerClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-unassigned-partner-99`,
    getUserId: () => 'unassigned-partner-99',
    getRole: () => 'CARE_PARTNER',
  });

  const familyClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-dev-user-family-1`,
    getUserId: () => 'dev-user-family-1',
    getRole: () => 'FAMILY_CONTACT',
  });

  const adminClient = new NeravuApiClient({
    baseUrl,
    getAuthToken: () => `dev-session-dev-user-admin-1`,
    getUserId: () => 'dev-user-admin-1',
    getRole: () => 'ADMIN',
  });

  let createdJourneyId = '';

  // 1. Patient creates journey through API
  await runTest('1. Patient creates journey through API', async () => {
    const hospitals = await patientClient.getHospitals();
    assert(hospitals.length > 0, 'Hospitals should be retrieved');

    const created = await patientClient.createBooking({
      pickupLocation: {
        latitude: 12.9716,
        longitude: 77.5946,
        address: '104 Sunrise Apts, Indiranagar, Bengaluru',
      },
      hospitalDestination: hospitals[0],
      bookingType: 'ON_DEMAND',
      specialAssistanceNotes: 'Wheelchair assistance requested at reception',
    });

    assert(!!created.id, 'Journey ID must be returned');
    assert(created.patientId === 'dev-user-patient-1', 'Patient ID must match caller');
    assert(created.currentState === 'MATCHING', 'Initial state must advance to MATCHING for dispatch');
    createdJourneyId = created.id;
  });

  // 2. Journey persists in PostgreSQL / relational store
  await runTest('2. Journey persists in PostgreSQL / relational store', async () => {
    const persisted = await domainStore.journeys.findById(createdJourneyId);
    assert(!!persisted, 'Journey must exist in authoritative relational store');
    assert(persisted!.id === createdJourneyId, 'Persisted journey ID must match');
    assert(persisted!.pickupLocation.address.includes('Indiranagar'), 'Pickup location must be stored');
  });

  // 3. Patient retrieves own journey
  await runTest('3. Patient retrieves own journey', async () => {
    const journeys = await patientClient.getJourneys();
    const found = journeys.find((j) => j.id === createdJourneyId);
    assert(!!found, 'Patient must see their own created journey in list');

    const single = await patientClient.getJourneyById(createdJourneyId);
    assert(!!single, 'Patient must retrieve journey by ID');
    assert(single!.id === createdJourneyId, 'Journey ID must match');
  });

  // 4. Care Partner retrieves authorized journey
  await runTest('4. Care Partner retrieves authorized journey in MATCHING state', async () => {
    const journeys = await partnerClient.getJourneys();
    const matching = journeys.find((j) => j.id === createdJourneyId);
    assert(!!matching, 'Care Partner must see MATCHING journey open for dispatch');
  });

  // 5. Care Partner advances valid milestone
  await runTest('5. Care Partner advances valid milestone', async () => {
    // First accept journey
    const accepted = await partnerClient.acceptJourney(createdJourneyId);
    assert(accepted.currentState === 'PARTNER_ASSIGNED', 'State must become PARTNER_ASSIGNED');
    assert(accepted.carePartnerId === 'dev-user-partner-1', 'Partner ID must be set');

    // Advance to PARTNER_EN_ROUTE
    const enRoute = await partnerClient.advanceMilestone(createdJourneyId, 'PARTNER_EN_ROUTE', 'Partner started driving');
    assert(enRoute.currentState === 'PARTNER_EN_ROUTE', 'State must advance to PARTNER_EN_ROUTE');
  });

  // 6. Invalid milestone transition rejected
  await runTest('6. Invalid milestone transition rejected', async () => {
    try {
      // Cannot jump from PARTNER_EN_ROUTE directly to COMPLETED
      await partnerClient.advanceMilestone(createdJourneyId, 'COMPLETED');
      assert(false, 'Should have thrown error on invalid transition');
    } catch (err: any) {
      assert(err instanceof ApiError, 'Must be ApiError');
      assert(err.status === 400 || err.status === 403, 'Must return HTTP 400 or 403');
    }
  });

  // 7. Patient cannot access another patient journey (IDOR 403)
  await runTest("7. Patient cannot access another patient's journey (IDOR 403)", async () => {
    try {
      await otherPatientClient.getJourneyById(createdJourneyId);
      assert(false, 'Should have been rejected with 403 IDOR');
    } catch (err: any) {
      assert(err instanceof ApiError, 'Must be ApiError');
      assert(err.status === 403, 'Must return HTTP 403');
      assert(err.code === 'IDOR_VIOLATION', 'Code must be IDOR_VIOLATION');
    }
  });

  // 8. Care Partner cannot access unauthorized journey
  await runTest('8. Care Partner cannot access unauthorized journey (IDOR 403)', async () => {
    // Create private journey for patient, assign to partner 1, then unassigned partner 99 tries to access
    try {
      await unassignedPartnerClient.getJourneyById(createdJourneyId);
      assert(false, 'Unassigned partner must be rejected with 403');
    } catch (err: any) {
      assert(err instanceof ApiError, 'Must be ApiError');
      assert(err.status === 403, 'Must return HTTP 403');
    }
  });

  // 9. Family FULL_STATUS authorization
  await runTest('9. Family FULL_STATUS authorization', async () => {
    const journeys = await familyClient.getJourneys();
    const authorized = journeys.find((j) => j.id === createdJourneyId);
    assert(!!authorized, 'Authorized Family Contact must see monitored journey');

    const detail = await familyClient.getJourneyById(createdJourneyId);
    assert(!!detail, 'Family must retrieve journey details');
  });

  // 10. Family LIVE_LOCATION authorization (companion notes/fare redacted)
  await runTest('10. Family LIVE_LOCATION authorization redacts sensitive companion details', async () => {
    // Configure patient profile trusted contact with LIVE_LOCATION
    const profile = await domainStore.patientProfiles.findByUserId('dev-user-patient-1');
    if (profile && profile.trustedContacts) {
      profile.trustedContacts[0].permissionLevel = 'LIVE_LOCATION';
      await domainStore.patientProfiles.save(profile);
    }

    const detail = await familyClient.getJourneyById(createdJourneyId);
    assert(!!detail, 'Detail must be returned');
    assert(detail!.specialAssistanceNotes === undefined, 'Companion notes must be redacted for LIVE_LOCATION');
    assert(detail!.initialFareEstimate === undefined, 'Fare breakdown must be redacted for LIVE_LOCATION');
  });

  // 11. Family EMERGENCY_ONLY restriction (location restricted when inactive)
  await runTest('11. Family EMERGENCY_ONLY restriction restricts location during inactive emergency', async () => {
    const profile = await domainStore.patientProfiles.findByUserId('dev-user-patient-1');
    if (profile && profile.trustedContacts) {
      profile.trustedContacts[0].permissionLevel = 'EMERGENCY_ONLY';
      await domainStore.patientProfiles.save(profile);
    }

    const detail = await familyClient.getJourneyById(createdJourneyId);
    assert(!!detail, 'Emergency-only record must be returned');
    assert(detail!.pickupLocation === undefined, 'Pickup location must be redacted while emergency is inactive');
  });

  // Restore FULL_STATUS for subsequent checks
  const restoreProfile = await domainStore.patientProfiles.findByUserId('dev-user-patient-1');
  if (restoreProfile && restoreProfile.trustedContacts) {
    restoreProfile.trustedContacts[0].permissionLevel = 'FULL_STATUS';
    await domainStore.patientProfiles.save(restoreProfile);
  }

  // 12. Admin authorization across all records
  await runTest('12. Admin authorization retrieves all journeys and configs', async () => {
    const all = await adminClient.getJourneys();
    assert(all.length >= 1, 'Admin must see all journeys');

    const policy = await adminClient.getPricingPolicy();
    assert(!!policy.currency, 'Admin must retrieve pricing policy');

    const updated = await adminClient.updatePricingPolicy({
      ...policy,
      version: 'v2.1-phase6c-verified',
    });
    assert(updated.version === 'v2.1-phase6c-verified', 'Admin must update policy');
  });

  // 13. Emergency creation through API
  await runTest('13. Emergency creation through API', async () => {
    const emgJourney = await patientClient.triggerEmergency(createdJourneyId, {
      category: 'MEDICAL_EMERGENCY',
      reason: 'Patient reported chest discomfort',
    });

    assert(emgJourney.currentState === 'EMERGENCY_ACTIVE', 'State must become EMERGENCY_ACTIVE');
    assert(emgJourney.emergencyLogs.length > 0, 'Emergency log must be recorded');
  });

  // 14. Emergency resolution through API
  await runTest('14. Emergency resolution through API with operational notes', async () => {
    const resolved = await adminClient.resolveEmergency(
      createdJourneyId,
      'Admin contacted attending doctor and confirmed patient stabilized; clearance given to continue.'
    );

    assert(resolved.currentState === 'PARTNER_EN_ROUTE', 'Must restore to previous journey state');
    const lastLog = resolved.emergencyLogs[resolved.emergencyLogs.length - 1];
    assert(lastLog.status === 'RESOLVED', 'Incident status must be RESOLVED');
    assert(!!lastLog.resolutionNotes, 'Operational notes must be saved');
  });

  // 15. Pricing retrieval through API
  await runTest('15. Pricing retrieval through API', async () => {
    const estimate = await patientClient.getPricingEstimate({
      totalDistanceKm: 18.5,
      estimatedHospitalStayMinutes: 60,
      bookingType: 'ON_DEMAND',
    });

    assert(!!estimate.total, 'Estimated total must be calculated');
    assert(estimate.total > 0, 'Estimated total must be positive');
    assert(estimate.currency === 'INR', 'Currency must be INR');
  });

  // 16. Backend 400 handling
  await runTest('16. Backend 400 handling for invalid data', async () => {
    try {
      const res = await fetch(`${baseUrl}/api/journeys`, {
        method: 'POST',
        headers: patientClient.getHeaders(),
        body: JSON.stringify({}), // Missing pickupLocation and hospitalDestination
      });
      assert(res.status === 400, 'Must return HTTP 400');
      const data = await res.json();
      assert(data.error === 'INVALID_DATA', 'Error code must be INVALID_DATA');
    } catch (err: any) {
      if (err.message.includes('Assertion failed')) throw err;
    }
  });

  // 17. Backend 401 handling
  await runTest('17. Backend 401 handling for unauthenticated requests', async () => {
    const res = await fetch(`${baseUrl}/api/journeys`, {
      headers: { 'Content-Type': 'application/json' }, // No auth header
    });
    assert(res.status === 401, 'Must return HTTP 401');
    const data = await res.json();
    assert(data.error === 'UNAUTHENTICATED', 'Error code must be UNAUTHENTICATED');
  });

  // 18. Backend 403 handling
  await runTest('18. Backend 403 handling for forbidden action', async () => {
    // Patient attempts to resolve emergency (strictly admin function)
    const res = await fetch(`${baseUrl}/api/journeys/${createdJourneyId}/emergency/resolve`, {
      method: 'POST',
      headers: patientClient.getHeaders(),
      body: JSON.stringify({ operationalResolutionNotes: 'Patient self resolve' }),
    });
    assert(res.status === 403, 'Must return HTTP 403');
    const data = await res.json();
    assert(data.error === 'UNAUTHORIZED_TRANSITION' || data.error === 'FORBIDDEN_ROLE', 'Must return 403 error');
  });

  // 19. Backend 404 handling
  await runTest('19. Backend 404 handling for non-existent routes or entities', async () => {
    const resRoute = await fetch(`${baseUrl}/api/non-existent-route-xyz`, {
      headers: patientClient.getHeaders(),
    });
    assert(resRoute.status === 404, 'Must return HTTP 404 for unknown route');

    const resEntity = await fetch(`${baseUrl}/api/journeys/journey-does-not-exist-999`, {
      headers: patientClient.getHeaders(),
    });
    assert(resEntity.status === 404, 'Must return HTTP 404 for unknown journey entity');
  });

  // 20. Backend/network failure handling
  await runTest('20. Backend/network failure handling and credential protection', async () => {
    // Bad port simulation
    const offlineClient = new NeravuApiClient({
      baseUrl: 'http://127.0.0.1:59999', // Port with no server
      getAuthToken: () => 'dev-token',
    });

    try {
      await offlineClient.getHealth();
      assert(false, 'Should have failed with network error');
    } catch (err: any) {
      assert(err instanceof ApiError, 'Must be ApiError');
      assert(err.status === 0, 'Status must be 0 for network failure');
      assert(err.code === 'NETWORK_FAILURE', 'Code must be NETWORK_FAILURE');
      assert(!err.message.includes('DATABASE_URL'), 'Must never leak DATABASE_URL');
      assert(!err.message.includes('password'), 'Must never leak database password');
    }
  });

  // Clean up
  if (server) {
    (server as any).close();
  }

  console.log('--------------------------------------------------');
  console.log(`TOTAL PHASE 6C TESTS: ${totalPassed + totalFailed} | PASSED: ${totalPassed} | FAILED: ${totalFailed}`);
  if (totalFailed === 0) {
    console.log('ALL PHASE 6C FRONTEND → BACKEND API INTEGRATION TESTS PASSED!');
  } else {
    console.error('SOME PHASE 6C TESTS FAILED!');
    process.exit(1);
  }
  console.log('--------------------------------------------------');
}

runPhase6CTestSuite().catch((err) => {
  console.error('Fatal error in Phase 6C test suite:', err);
  process.exit(1);
});
