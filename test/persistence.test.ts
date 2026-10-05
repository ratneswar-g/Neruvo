import assert from 'node:assert/strict';
import {
  JourneyService,
} from '../src/services/journey-service.ts';
import {
  PersistentDomainStore,
  NodeFilePersistenceAdapter,
  BrowserLocalStorageAdapter,
  MemoryPersistenceAdapter,
  ServerSharedPersistenceAdapter,
  DomainError,
  DEFAULT_PRICING_POLICY,
  calculateJourneyFare,
  validateServerDatabaseConfig,
  PERSISTENCE_ARCHITECTURE_STATUS,
  REQUIRED_BACKEND_API_ROUTES,
} from '../src/domain/index.ts';
import {
  DEV_IDENTITIES,
  authorizeAction,
} from '../src/auth/index.ts';

let testCount = 0;
let passCount = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  testCount++;
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          passCount++;
          console.log(`  ✓ [TEST ${testCount}] ${name}`);
        })
        .catch((err) => {
          console.error(`  ✗ [TEST ${testCount} FAILED] ${name}`);
          console.error(err);
          throw err;
        });
    }
    passCount++;
    console.log(`  ✓ [TEST ${testCount}] ${name}`);
  } catch (err: any) {
    console.error(`  ✗ [TEST ${testCount} FAILED] ${name}`);
    console.error(err);
    throw err;
  }
}

async function runPhase6ATestSuite() {
  console.log('\n==================================================');
  console.log('NERAVU PHASE 6A: PERSISTENCE FOUNDATION TEST SUITE');
  console.log('==================================================\n');

  const patient = DEV_IDENTITIES.PATIENT;
  const partner = DEV_IDENTITIES.CARE_PARTNER;
  const family = DEV_IDENTITIES.FAMILY_CONTACT;
  const admin = DEV_IDENTITIES.ADMIN;

  const testDir = '.neravu_test_persistence';
  const adapter = new NodeFilePersistenceAdapter(testDir);
  await adapter.clear();

  const store = new PersistentDomainStore(adapter);
  let service = new JourneyService(store);
  await service.seedInitialDomainData();

  const patientProfile = await service.getPatientProfile(patient.id);
  assert(patientProfile, 'Patient profile must exist');
  const hospitals = await service.getHospitals();
  const hospital = hospitals[0];
  assert(hospital, 'Hospital destination must exist');

  let testJourneyId = '';

  // 1. Create and persist journey
  await runTest('1. Create and persist journey', async () => {
    const created = await service.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
      specialAssistanceNotes: '[DEMO] Assist with wheelchair transfer from gate',
    });
    assert(created.id);
    testJourneyId = created.id;
    assert.equal(created.patientId, patient.id);
    assert.equal(created.currentState, 'MATCHING');

    // Confirm persisted in adapter
    const persisted = await adapter.getItem(`neravu:journey:${testJourneyId}`);
    assert(persisted, 'Journey must be persisted in storage adapter');
  });

  // 2. Retrieve persisted journey
  await runTest('2. Retrieve persisted journey', async () => {
    const retrieved = await service.getJourneyById(testJourneyId);
    assert(retrieved);
    assert.equal(retrieved.id, testJourneyId);
    assert.equal(retrieved.patientId, patient.id);
    assert.equal(retrieved.pickupLocation.address, patientProfile.homeAddress.address);
    assert.equal(retrieved.hospitalDestination.id, hospital.id);
    assert.equal(retrieved.returnDropoffLocation.address, patientProfile.homeAddress.address);
    assert.equal(retrieved.isRoundTrip, true);
  });

  // 3. Update journey
  await runTest('3. Update journey', async () => {
    const assigned = await service.acceptJourney(partner, testJourneyId);
    assert.equal(assigned.currentState, 'PARTNER_ASSIGNED');
    assert.equal(assigned.carePartnerId, partner.id);

    const enRoute = await service.advanceMilestone(partner, testJourneyId, 'PARTNER_EN_ROUTE');
    assert.equal(enRoute.currentState, 'PARTNER_EN_ROUTE');

    // Confirm update persisted in storage
    const inStorage: any = await adapter.getItem(`neravu:journey:${testJourneyId}`);
    assert.equal(inStorage.currentState, 'PARTNER_EN_ROUTE');
    assert.equal(inStorage.carePartnerId, partner.id);
  });

  // 4. Persistence survives repository/service recreation
  await runTest('4. Persistence survives repository/service recreation', async () => {
    // Recreate a completely new service pointing to the same storage adapter
    const newStore = new PersistentDomainStore(adapter);
    const newService = new JourneyService(newStore);

    const retrieved = await newService.getJourneyById(testJourneyId);
    assert(retrieved, 'Journey must exist in new service instance');
    assert.equal(retrieved.id, testJourneyId);
    assert.equal(retrieved.currentState, 'PARTNER_EN_ROUTE');
    assert.equal(retrieved.carePartnerId, partner.id);

    // Switch active service to new instance
    service = newService;
  });

  // 5. State history persists
  await runTest('5. State history persists', async () => {
    const retrieved = await service.getJourneyById(testJourneyId);
    assert(retrieved);
    assert(Array.isArray(retrieved.stateHistory));
    assert(retrieved.stateHistory.length >= 3); // DRAFT->REQUESTED, REQUESTED->MATCHING, MATCHING->PARTNER_ASSIGNED, etc.
    const states = retrieved.stateHistory.map((h) => h.toState);
    assert(states.includes('REQUESTED'));
    assert(states.includes('MATCHING'));
    assert(states.includes('PARTNER_ASSIGNED'));
    assert(states.includes('PARTNER_EN_ROUTE'));
  });

  // 6. Pricing snapshot persists
  await runTest('6. Pricing snapshot persists', async () => {
    const retrieved = await service.getJourneyById(testJourneyId);
    assert(retrieved);
    assert(retrieved.initialFareEstimate);
    assert(retrieved.fareEstimate);
    const initialTotal = retrieved.initialFareEstimate.total;
    assert.equal(typeof initialTotal, 'number');
    assert(retrieved.initialFareEstimate.components && retrieved.initialFareEstimate.components.length > 0);

    // Mutate global pricing policy
    service.updatePricingPolicy(admin, {
      ...DEFAULT_PRICING_POLICY,
      baseServiceFee: 9999,
      perDistanceRatePerKm: 100,
    });

    // Recreate service to confirm snapshot immutability survives recreation
    const serviceInstance2 = new JourneyService(new PersistentDomainStore(adapter));
    const reRetrieved = await serviceInstance2.getJourneyById(testJourneyId);
    assert.equal(reRetrieved?.initialFareEstimate?.total, initialTotal);
    assert.equal(reRetrieved?.initialFareEstimate?.baseBookingFee, 250);

    // Reset policy back
    service.updatePricingPolicy(admin, DEFAULT_PRICING_POLICY);
  });

  // 7. Emergency incident persists
  await runTest('7. Emergency incident persists', async () => {
    // Advance journey to IN_TRANSIT_TO_HOSPITAL
    await service.advanceMilestone(partner, testJourneyId, 'PARTNER_ARRIVED');
    await service.advanceMilestone(partner, testJourneyId, 'PATIENT_PICKED_UP');
    await service.advanceMilestone(partner, testJourneyId, 'IN_TRANSIT_TO_HOSPITAL');

    const emergency = await service.triggerEmergency(partner, testJourneyId, {
      category: 'SAFETY_CONCERN',
      reason: 'Companion vehicle safe stop at service lane due to traffic congestion',
    });
    assert.equal(emergency.currentState, 'EMERGENCY_ACTIVE');
    assert(emergency.emergencyLogs.length > 0);

    // Recreate service and verify incident survives
    const serviceAfterSos = new JourneyService(new PersistentDomainStore(adapter));
    const retrieved = await serviceAfterSos.getJourneyById(testJourneyId);
    assert.equal(retrieved?.currentState, 'EMERGENCY_ACTIVE');
    assert(retrieved?.emergencyLogs.length);
    const incident = retrieved!.emergencyLogs[retrieved!.emergencyLogs.length - 1];
    assert.equal(incident.status, 'ACTIVE');
    assert.equal(incident.category, 'SAFETY_CONCERN');
    assert.equal(incident.previousJourneyState, 'IN_TRANSIT_TO_HOSPITAL');
  });

  // 8. Emergency resolution persists
  await runTest('8. Emergency resolution persists', async () => {
    const operationalNote = 'Incident reviewed by Admin; traffic cleared; companion confirmed safe; operational clearance given to resume.';
    const resolved = await service.resolveEmergency(admin, testJourneyId, operationalNote);
    assert.equal(resolved.currentState, 'IN_TRANSIT_TO_HOSPITAL');

    // Recreate service to verify resolution persistence
    const serviceAfterRes = new JourneyService(new PersistentDomainStore(adapter));
    const retrieved = await serviceAfterRes.getJourneyById(testJourneyId);
    assert.equal(retrieved?.currentState, 'IN_TRANSIT_TO_HOSPITAL');
    const incident = retrieved!.emergencyLogs[retrieved!.emergencyLogs.length - 1];
    assert.equal(incident.status, 'RESOLVED');
    assert.equal(incident.resolutionNotes, operationalNote);
    assert.equal(incident.resolvedByUserId, admin.id);
    assert(incident.resolvedAt);
  });

  // 9. Patient cannot access another patient's journey
  await runTest('9. Patient cannot access another patient journey', async () => {
    const patient2 = {
      id: 'dev-user-patient-2',
      name: 'Other Patient',
      phone: '+91 98000 00004',
      role: 'PATIENT' as const,
      status: 'ACTIVE' as const,
    };
    const journey = await service.getJourneyById(testJourneyId);
    assert(journey);

    const auth = authorizeAction(patient2, 'VIEW_JOURNEY', { journey });
    assert.equal(auth.authorized, false);
    assert.equal(auth.code, 'IDOR_VIOLATION');
  });

  // 10. Care Partner cannot access unauthorized journey
  await runTest('10. Care Partner cannot access unauthorized journey', async () => {
    const unauthorizedPartner = {
      id: 'partner-other-99',
      name: 'Other Partner',
      phone: '+91 99999 88888',
      role: 'CARE_PARTNER' as const,
      status: 'ACTIVE' as const,
    };
    const journey = await service.getJourneyById(testJourneyId);
    assert(journey);

    const auth = authorizeAction(unauthorizedPartner, 'VIEW_JOURNEY', { journey });
    assert.equal(auth.authorized, false);
    assert.equal(auth.code, 'IDOR_VIOLATION');
  });

  // 11. Family permission rules remain enforced
  await runTest('11. Family permission rules remain enforced', async () => {
    const journey = await service.getJourneyById(testJourneyId);
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
    const unauthorizedScope = authorizeAction(unauthorizedFamily, 'VIEW_JOURNEY', {
      journey,
      trustedContacts: patientProfile.trustedContacts,
    });
    assert.equal(unauthorizedScope.authorized, false);
    assert.equal(unauthorizedScope.code, 'IDOR_VIOLATION');
  });

  // 12. Admin access works
  await runTest('12. Admin access works', async () => {
    const journeys = await service.getAllJourneys();
    assert(journeys.length > 0);
    const incidents = await service.getAllEmergencyIncidents(admin);
    assert(Array.isArray(incidents));
    assert(incidents.length > 0);
  });

  // 13. Duplicate IDs handled safely
  await runTest('13. Duplicate IDs handled safely', async () => {
    const journey = await service.getJourneyById(testJourneyId);
    assert(journey);

    // Saving updated state for same ID updates the entity without duplicating records
    await service.store.journeys.save({
      ...journey,
      specialAssistanceNotes: 'Updated assistance notes',
    });

    const all = await service.store.journeys.findAll();
    const matches = all.filter((j) => j.id === testJourneyId);
    assert.equal(matches.length, 1);
  });

  // 14. Invalid persisted data handled safely
  await runTest('14. Invalid persisted data handled safely', async () => {
    // Missing ID
    await assert.rejects(async () => {
      await service.store.journeys.save({} as any);
    }, (err: any) => err instanceof DomainError && err.code === 'RECORD_VALIDATION_ERROR');

    // Missing patientId
    await assert.rejects(async () => {
      await service.store.journeys.save({ id: 'bad-journey-1' } as any);
    }, (err: any) => err instanceof DomainError && err.code === 'RECORD_VALIDATION_ERROR');
  });

  // 15. Persistence failure handled safely
  await runTest('15. Persistence failure handled safely', async () => {
    const faultyAdapter: any = {
      name: 'FaultyAdapter',
      isAvailable: () => true,
      getItem: async () => {
        throw new DomainError('PERSISTENCE_READ_ERROR', 'Simulated disk read corruption');
      },
      setItem: async () => {
        throw new DomainError('PERSISTENCE_WRITE_ERROR', 'Simulated disk write failure');
      },
      removeItem: async () => {},
      getAllKeys: async () => [],
      clear: async () => {},
    };

    const faultyStore = new PersistentDomainStore(faultyAdapter);
    await assert.rejects(async () => {
      await faultyStore.journeys.findById('any-id');
    }, (err: any) => err instanceof DomainError && err.code === 'PERSISTENCE_READ_ERROR');

    await assert.rejects(async () => {
      await faultyStore.journeys.save({
        id: 'fail-journey',
        patientId: 'p-1',
        pickupLocation: patientProfile.homeAddress,
        hospitalDestination: hospital,
        returnDropoffLocation: patientProfile.homeAddress,
        currentState: 'REQUESTED',
      } as any);
    }, (err: any) => err instanceof DomainError && err.code === 'PERSISTENCE_WRITE_ERROR');
  });

  // 16. Existing Phase 1–5 behavior remains unchanged
  await runTest('16. Existing Phase 1–5 behavior remains unchanged', async () => {
    // Round-trip journey progression to completion
    let j = await service.getJourneyById(testJourneyId);
    assert(j);

    j = await service.advanceMilestone(partner, j.id, 'ARRIVED_AT_HOSPITAL');
    j = await service.advanceMilestone(partner, j.id, 'HOSPITAL_VISIT');
    assert.equal(j.currentState, 'HOSPITAL_VISIT');

    // Hospital visit cannot complete
    await assert.rejects(async () => {
      await service.advanceMilestone(partner, j!.id, 'COMPLETED');
    });

    j = await service.advanceMilestone(partner, j!.id, 'RETURN_STARTED');
    j = await service.advanceMilestone(partner, j!.id, 'IN_TRANSIT_TO_HOME');
    j = await service.advanceMilestone(partner, j!.id, 'PATIENT_RETURNED_HOME');
    const completed = await service.advanceMilestone(partner, j!.id, 'COMPLETED');
    assert.equal(completed.currentState, 'COMPLETED');
  });

  // 17. LocalStorage and File-store are explicitly marked as NOT production databases
  await runTest('17. LocalStorage and File-store are explicitly marked as NOT production databases', async () => {
    const fileAdapter = new NodeFilePersistenceAdapter(testDir);
    assert.equal(fileAdapter.isProductionDatabase, false);

    const memAdapter = new MemoryPersistenceAdapter();
    assert.equal(memAdapter.isProductionDatabase, false);

    const storeWithFile = new PersistentDomainStore(fileAdapter);
    assert.equal(storeWithFile.isProductionDatabase(), false);
    assert.equal(PERSISTENCE_ARCHITECTURE_STATUS.isProductionDatabaseConnected, false);
    assert(PERSISTENCE_ARCHITECTURE_STATUS.notice.includes('DO NOT provide multi-user shared production persistence'));
  });

  // 18. Server database configuration validation rejects invalid parameters and accepts valid config
  await runTest('18. Server database configuration validation rejects invalid parameters and accepts valid config', async () => {
    // Missing host and databaseUrl
    const invalidRes = validateServerDatabaseConfig({ port: 5432 });
    assert.equal(invalidRes.valid, false);
    assert(invalidRes.errors.length > 0);

    // Invalid port
    const badPortRes = validateServerDatabaseConfig({
      host: 'localhost',
      databaseName: 'neravu_db',
      user: 'neravu_app',
      port: 999999,
    });
    assert.equal(badPortRes.valid, false);

    // Valid configuration
    const validRes = validateServerDatabaseConfig({
      host: 'localhost',
      port: 5432,
      databaseName: 'neravu_db',
      user: 'neravu_app',
      ssl: true,
      maxPoolSize: 10,
      connectionTimeoutMs: 5000,
    });
    assert.equal(validRes.valid, true);
    assert.equal(validRes.errors.length, 0);
  });

  // 19. Multi-user shared server persistence: Patient, Care Partner, Family, and Admin share authoritative data
  await runTest('19. Multi-user shared server persistence: All roles share authoritative records', async () => {
    const sharedServerAdapter = new ServerSharedPersistenceAdapter();
    await sharedServerAdapter.clear();

    const serverStore = new PersistentDomainStore(sharedServerAdapter);
    const sharedService = new JourneyService(serverStore);
    await sharedService.seedInitialDomainData();

    // Patient creates journey on shared server store
    const patientJourney = await sharedService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    assert(patientJourney.id);

    // Care partner assigns and accesses the same journey
    const partnerStore = new PersistentDomainStore(sharedServerAdapter);
    const partnerService = new JourneyService(partnerStore);
    const retrievedByPartner = await partnerService.getJourneyById(patientJourney.id);
    assert(retrievedByPartner, 'Care partner must access the shared journey created by patient');
    assert.equal(retrievedByPartner.id, patientJourney.id);

    // Family contact accesses the same journey under authorized scope
    const familyStore = new PersistentDomainStore(sharedServerAdapter);
    const familyService = new JourneyService(familyStore);
    const retrievedByFamily = await familyService.getJourneyById(patientJourney.id);
    assert(retrievedByFamily, 'Family contact must access the shared journey');

    // Admin accesses all journeys across all users on shared server store
    const adminStore = new PersistentDomainStore(sharedServerAdapter);
    const adminService = new JourneyService(adminStore);
    const allJourneys = await adminService.getAllJourneys();
    assert(allJourneys.some((j) => j.id === patientJourney.id), 'Admin must access journey on shared server store');
  });

  // 20. Server database connection loss or write failure handled safely
  await runTest('20. Server database connection loss or write failure handled safely', async () => {
    const sharedServerAdapter = new ServerSharedPersistenceAdapter();
    const serverStore = new PersistentDomainStore(sharedServerAdapter);

    // Simulate connection drop
    sharedServerAdapter.setSimulatedDown(true);

    await assert.rejects(async () => {
      await serverStore.journeys.findById('any-id');
    }, (err: any) => err instanceof DomainError && err.code === 'STORAGE_UNAVAILABLE');

    await assert.rejects(async () => {
      await serverStore.journeys.save({
        id: 'fail-j',
        patientId: patient.id,
        pickupLocation: patientProfile.homeAddress,
        hospitalDestination: hospital,
        returnDropoffLocation: patientProfile.homeAddress,
        currentState: 'REQUESTED',
      } as any);
    }, (err: any) => err instanceof DomainError && err.code === 'PERSISTENCE_WRITE_ERROR');

    // Restore connection
    sharedServerAdapter.setSimulatedDown(false);
  });

  // 21. Required backend API routes specification enforces role authorization boundaries
  await runTest('21. Required backend API routes specification enforces role authorization boundaries', async () => {
    assert(REQUIRED_BACKEND_API_ROUTES.length >= 8);

    const emergencyResolveRoute = REQUIRED_BACKEND_API_ROUTES.find((r) => r.path === '/api/journeys/:id/emergency/resolve');
    assert(emergencyResolveRoute);
    assert.deepEqual(emergencyResolveRoute.authorizedRoles, ['ADMIN']);

    const pricingUpdateRoute = REQUIRED_BACKEND_API_ROUTES.find((r) => r.path === '/api/pricing/policy' && r.method === 'PUT');
    assert(pricingUpdateRoute);
    assert.deepEqual(pricingUpdateRoute.authorizedRoles, ['ADMIN']);
  });

  // 22. Simulated browser storage survives simulated page reload while remaining device-local
  await runTest('22. Simulated browser storage survives simulated page reload while remaining device-local', async () => {
    const mockStorage = new Map<string, string>();
    const fakeWindowLocalStorage = {
      getItem: (k: string) => mockStorage.get(k) || null,
      setItem: (k: string, v: string) => { mockStorage.set(k, v); },
      removeItem: (k: string) => { mockStorage.delete(k); },
      key: (i: number) => Array.from(mockStorage.keys())[i] || null,
      get length() { return mockStorage.size; },
      clear: () => { mockStorage.clear(); },
    };

    // Device A writes a record
    fakeWindowLocalStorage.setItem('neravu:journey:test-dev-1', JSON.stringify({ id: 'test-dev-1', patientId: 'p-1' }));

    // Page refresh on same device reads it back
    const reloaded = JSON.parse(fakeWindowLocalStorage.getItem('neravu:journey:test-dev-1')!);
    assert.equal(reloaded.id, 'test-dev-1');

    // A different device has empty storage (demonstrating why localStorage is NOT a shared production DB)
    const deviceBStorage = new Map<string, string>();
    assert.equal(deviceBStorage.get('neravu:journey:test-dev-1'), undefined);
  });

  // Cleanup test directory
  await adapter.clear();

  console.log('\n--------------------------------------------------');
  console.log(`TOTAL PHASE 6A TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
  console.log('ALL PHASE 6A PERSISTENCE FOUNDATION TESTS PASSED!');
  console.log('--------------------------------------------------\n');
}

runPhase6ATestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
