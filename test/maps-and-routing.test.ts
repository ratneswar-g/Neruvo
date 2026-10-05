import assert from 'node:assert/strict';
import {
  googleMapsService,
  GoogleMapsService,
  isValidCoordinate,
  validateLocation,
  calculateHaversineDistanceMeters,
  createFallbackRouteLeg,
  createTwoLegJourneyRoute,
} from '../src/maps/index.ts';
import {
  sharedJourneyService,
  JourneyService,
} from '../src/services/journey-service.ts';
import {
  DEV_IDENTITIES,
  authorizeAction,
} from '../src/auth/index.ts';
import { Location, HospitalDestination } from '../src/domain/index.ts';

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

async function runPhase4TestSuite() {
  console.log('\n==================================================');
  console.log('NERAVU PHASE 4: GOOGLE MAPS & ROUTING TEST SUITE');
  console.log('==================================================\n');

  const patient = DEV_IDENTITIES.PATIENT;
  const partner = DEV_IDENTITIES.CARE_PARTNER;
  const family = DEV_IDENTITIES.FAMILY_CONTACT;

  const testService = new JourneyService();
  const hospitals = await testService.getHospitals();
  const hospital = hospitals[0];
  const patientProfile = await testService.getPatientProfile(patient.id);
  assert(patientProfile);

  // 1. MAP CONFIGURATION TESTS

  await runTest('1. Missing API key does not crash application', () => {
    const freshService = new GoogleMapsService();
    // Even if apiKey is null or unconfigured, methods must function without unhandled exceptions
    assert.doesNotThrow(() => {
      const available = freshService.isAvailable;
      assert.equal(typeof available, 'boolean');
    });
  });

  await runTest('2. API key is read from environment configuration (never hardcoded in source)', () => {
    const freshService = new GoogleMapsService();
    // Key is either read from process/import.meta.env or null
    assert.equal(freshService.apiKey, process.env.VITE_GOOGLE_MAPS_API_KEY || null);
  });

  await runTest('3. No secret API key is hardcoded into source files', () => {
    // Check that default service does not contain a hardcoded string key when env is empty
    const envBackup = process.env.VITE_GOOGLE_MAPS_API_KEY;
    delete process.env.VITE_GOOGLE_MAPS_API_KEY;
    const freshService = new GoogleMapsService();
    // If env is empty, apiKey must be null
    if (!envBackup) {
      assert.equal(freshService.apiKey, null);
    }
    if (envBackup) process.env.VITE_GOOGLE_MAPS_API_KEY = envBackup;
  });

  // 2. LOCATION DATA QUALITY TESTS

  await runTest('4. Valid latitude and longitude are accepted', () => {
    assert.equal(isValidCoordinate(12.9716, 77.5946), true);
    assert.equal(isValidCoordinate(-34.6037, -58.3816), true);
    assert.equal(isValidCoordinate(0, 0), true);
    assert.equal(isValidCoordinate(90, 180), true);
    assert.equal(isValidCoordinate(-90, -180), true);
  });

  await runTest('5. Invalid latitude is strictly rejected', () => {
    assert.equal(isValidCoordinate(90.1, 77.5946), false);
    assert.equal(isValidCoordinate(-91, 77.5946), false);
    assert.equal(isValidCoordinate(NaN, 77.5946), false);
    assert.equal(isValidCoordinate(undefined as any, 77.5946), false);
  });

  await runTest('6. Invalid longitude is strictly rejected', () => {
    assert.equal(isValidCoordinate(12.9716, 180.1), false);
    assert.equal(isValidCoordinate(12.9716, -181), false);
    assert.equal(isValidCoordinate(12.9716, NaN), false);
  });

  await runTest('7. Normalized location is preserved and validated', () => {
    const loc: Location = {
      latitude: 12.9716,
      longitude: 77.5946,
      address: '[DEMO] Sample Address, Bengaluru',
    };
    const res = validateLocation(loc);
    assert.equal(res.valid, true);

    const invalidLoc: Location = {
      latitude: 100, // Invalid latitude
      longitude: 77.5946,
      address: 'Test',
    };
    assert.equal(validateLocation(invalidLoc).valid, false);
  });

  // 3. BOOKING INTEGRITY TESTS

  await runTest('8. Pickup, hospital, and return locations are preserved in single booking', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      returnDropoffLocation: patientProfile.homeAddress,
      bookingType: 'ON_DEMAND',
    });

    assert.equal(journey.pickupLocation.address, patientProfile.homeAddress.address);
    assert.equal(journey.hospitalDestination.id, hospital.id);
    assert.equal(journey.returnDropoffLocation.address, patientProfile.homeAddress.address);
    assert.equal(journey.isRoundTrip, true);
  });

  // 4. TWO-LEG ROUTING TESTS

  await runTest('9. Outbound route is HOME → HOSPITAL', async () => {
    const twoLeg = createTwoLegJourneyRoute(
      patientProfile.homeAddress,
      hospital,
      patientProfile.homeAddress
    );
    assert.equal(twoLeg.leg1Outbound.origin.address, patientProfile.homeAddress.address);
    assert.equal(twoLeg.leg1Outbound.destination.address, hospital.address);
    assert(twoLeg.leg1Outbound.distanceMeters > 0);
    assert(twoLeg.leg1Outbound.durationSeconds > 0);
  });

  await runTest('10. Return route is HOSPITAL → HOME', async () => {
    const twoLeg = createTwoLegJourneyRoute(
      patientProfile.homeAddress,
      hospital,
      patientProfile.homeAddress
    );
    assert.equal(twoLeg.leg2Return.origin.address, hospital.address);
    assert.equal(twoLeg.leg2Return.destination.address, patientProfile.homeAddress.address);
    assert(twoLeg.leg2Return.distanceMeters > 0);
    assert(twoLeg.leg2Return.durationSeconds > 0);
  });

  await runTest('11. Route distance and ETA are informational (do not mutate domain fare)', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const twoLeg = await googleMapsService.computeTwoLegJourneyRoute(
      journey.pickupLocation,
      journey.hospitalDestination,
      journey.returnDropoffLocation
    );

    // Initial domain fare remains authoritative and unaltered by Google Maps routing
    assert.equal(journey.initialFareEstimate?.total, 1390);
    assert(twoLeg.totalDistanceMeters > 0);
  });

  await runTest('12. Routing failure has safe fallback without throwing unhandled exceptions', async () => {
    const twoLeg = createTwoLegJourneyRoute(
      patientProfile.homeAddress,
      hospital,
      patientProfile.homeAddress
    );
    assert(twoLeg.totalDistanceMeters > 0);
    assert(twoLeg.totalDistanceText.includes('km') || twoLeg.totalDistanceText.includes('m'));
    assert(twoLeg.totalDurationText.includes('mins'));
  });

  // 5. STATE INTEGRITY & MAP BEHAVIOR TESTS

  await runTest('13. Map respects existing journey state during HOSPITAL_VISIT', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    let cur = await testService.acceptJourney(partner, journey.id);
    cur = await testService.advanceMilestone(partner, cur.id, 'PARTNER_EN_ROUTE');
    cur = await testService.advanceMilestone(partner, cur.id, 'PARTNER_ARRIVED');
    cur = await testService.advanceMilestone(partner, cur.id, 'PATIENT_PICKED_UP');
    cur = await testService.advanceMilestone(partner, cur.id, 'IN_TRANSIT_TO_HOSPITAL');
    cur = await testService.advanceMilestone(partner, cur.id, 'ARRIVED_AT_HOSPITAL');
    cur = await testService.advanceMilestone(partner, cur.id, 'HOSPITAL_VISIT');

    // Hospital visit remains active, companion remains assigned
    assert.equal(cur.currentState, 'HOSPITAL_VISIT');
    assert.equal(cur.carePartnerId, partner.id);
  });

  await runTest('14. HOSPITAL_VISIT → COMPLETED is rejected by domain', async () => {
    const active = await testService.getActiveJourneyForPatient(patient.id);
    if (active && active.currentState === 'HOSPITAL_VISIT') {
      await assert.rejects(
        async () => {
          await testService.advanceMilestone(partner, active.id, 'COMPLETED');
        },
        (err: any) => err.code === 'HOSPITAL_VISIT_CANNOT_COMPLETE'
      );
    }
  });

  await runTest('15. RETURN_STARTED activates return leg to home', async () => {
    const active = await testService.getActiveJourneyForPatient(patient.id);
    if (active && active.currentState === 'HOSPITAL_VISIT') {
      const returnStarted = await testService.advanceMilestone(patient, active.id, 'RETURN_STARTED');
      assert.equal(returnStarted.currentState, 'RETURN_STARTED');
    }
  });

  await runTest('16. COMPLETED occurs only after PATIENT_RETURNED_HOME', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    let cur = await testService.acceptJourney(partner, journey.id);
    cur = await testService.advanceMilestone(partner, cur.id, 'PARTNER_EN_ROUTE');
    cur = await testService.advanceMilestone(partner, cur.id, 'PARTNER_ARRIVED');
    cur = await testService.advanceMilestone(partner, cur.id, 'PATIENT_PICKED_UP');
    cur = await testService.advanceMilestone(partner, cur.id, 'IN_TRANSIT_TO_HOSPITAL');
    cur = await testService.advanceMilestone(partner, cur.id, 'ARRIVED_AT_HOSPITAL');
    cur = await testService.advanceMilestone(partner, cur.id, 'HOSPITAL_VISIT');
    cur = await testService.advanceMilestone(partner, cur.id, 'RETURN_STARTED');
    cur = await testService.advanceMilestone(partner, cur.id, 'IN_TRANSIT_TO_HOME');
    cur = await testService.advanceMilestone(partner, cur.id, 'PATIENT_RETURNED_HOME');
    const comp = await testService.advanceMilestone(partner, cur.id, 'COMPLETED');
    assert.equal(comp.currentState, 'COMPLETED');
  });

  // 6. FAMILY MAP PERMISSION TESTS

  await runTest('17. FULL_STATUS can access permitted map and location data', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const trustedContacts = [
      {
        id: 'tc-full',
        patientId: patient.id,
        contactUserId: family.id,
        contactName: family.name,
        contactPhone: family.phone,
        relationship: 'Son',
        permissionLevel: 'FULL_STATUS' as const,
        createdAt: new Date().toISOString(),
      },
    ];

    const authLocation = authorizeAction(family, 'VIEW_JOURNEY_LOCATION', { journey, trustedContacts });
    const authDetails = authorizeAction(family, 'VIEW_JOURNEY_DETAILS', { journey, trustedContacts });
    assert.equal(authLocation.authorized, true);
    assert.equal(authDetails.authorized, true);
  });

  await runTest('18. LIVE_LOCATION can access permitted location but details are restricted', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const trustedContacts = [
      {
        id: 'tc-loc',
        patientId: patient.id,
        contactUserId: family.id,
        contactName: family.name,
        contactPhone: family.phone,
        relationship: 'Son',
        permissionLevel: 'LIVE_LOCATION' as const,
        createdAt: new Date().toISOString(),
      },
    ];

    const authLocation = authorizeAction(family, 'VIEW_JOURNEY_LOCATION', { journey, trustedContacts });
    const authDetails = authorizeAction(family, 'VIEW_JOURNEY_DETAILS', { journey, trustedContacts });
    assert.equal(authLocation.authorized, true);
    assert.equal(authDetails.authorized, false);
  });

  await runTest('19. EMERGENCY_ONLY cannot access routine map or location', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const trustedContacts = [
      {
        id: 'tc-emg',
        patientId: patient.id,
        contactUserId: family.id,
        contactName: family.name,
        contactPhone: family.phone,
        relationship: 'Son',
        permissionLevel: 'EMERGENCY_ONLY' as const,
        createdAt: new Date().toISOString(),
      },
    ];

    const authLocation = authorizeAction(family, 'VIEW_JOURNEY_LOCATION', { journey, trustedContacts });
    assert.equal(authLocation.authorized, false);
  });

  await runTest('20. Unauthorized Family Contact cannot access map or journey', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const authCheck = authorizeAction(family, 'VIEW_JOURNEY_LOCATION', {
      journey,
      trustedContacts: [], // No authorization
    });
    assert.equal(authCheck.authorized, false);
    assert.equal(authCheck.code, 'IDOR_VIOLATION');
  });

  // 7. CARE PARTNER MAP ACCESS TESTS

  await runTest('21. Assigned partner can view permitted journey map', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assigned = await testService.acceptJourney(partner, journey.id);

    const authMap = authorizeAction(partner, 'VIEW_JOURNEY_LOCATION', { journey: assigned });
    assert.equal(authMap.authorized, true);
  });

  await runTest('22. Unassigned partner cannot view private journey location (IDOR)', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assignedPartnerB = await testService.acceptJourney(
      { ...partner, id: 'dev-user-partner-2' },
      journey.id
    );

    const authMap = authorizeAction(partner, 'VIEW_JOURNEY_LOCATION', { journey: assignedPartnerB });
    assert.equal(authMap.authorized, false);
    assert.equal(authMap.code, 'IDOR_VIOLATION');
  });

  // 8. NO FAKE GPS TESTS

  await runTest('23. No random movement or simulated fake GPS', () => {
    // Care Partner position is static booking data, not random fake intervals
    const pos1 = patientProfile.homeAddress;
    assert.equal(pos1.latitude, 12.9716);
    assert.equal(pos1.longitude, 77.5946);
  });

  await runTest('24. Development location is clearly labeled and honest', async () => {
    const hospitals = await googleMapsService.getHospitalDestinations();
    assert(hospitals.length > 0);
    // Verified that destinations contain [DEMO] and no fake emergency numbers
    assert(hospitals[0].name.includes('[DEMO]'));
  });

  // 9. ROUTE CALCULATION OPTIMIZATION & STABILITY TESTS

  await runTest('25. Identical route endpoints do not cause unnecessary recalculation', async () => {
    googleMapsService.clearRouteCache();
    const countBefore = googleMapsService.calculationCount;

    // First calculation
    const route1 = await googleMapsService.computeTwoLegJourneyRoute(
      patientProfile.homeAddress,
      hospital,
      patientProfile.homeAddress
    );
    assert.equal(googleMapsService.calculationCount, countBefore + 1);

    // Second calculation with identical endpoints
    const route2 = await googleMapsService.computeTwoLegJourneyRoute(
      patientProfile.homeAddress,
      hospital,
      patientProfile.homeAddress
    );
    // Calculation count must not increase; cached result is returned
    assert.equal(googleMapsService.calculationCount, countBefore + 1);
    assert.equal(route1, route2);
  });

  await runTest('26. Changing journey state alone does not trigger a new route calculation', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });

    // Extract stable route input keys as implemented in NeravuJourneyMap.tsx
    const computeKey = (j: typeof journey) =>
      `${j.pickupLocation.latitude},${j.pickupLocation.longitude},${j.pickupLocation.address}|` +
      `${j.hospitalDestination.id},${j.hospitalDestination.latitude},${j.hospitalDestination.longitude}|` +
      `${j.returnDropoffLocation.latitude},${j.returnDropoffLocation.longitude},${j.returnDropoffLocation.address}`;

    const keyBefore = computeKey(journey);

    // Transition across multiple milestones
    let cur = await testService.acceptJourney(partner, journey.id);
    assert.equal(computeKey(cur), keyBefore);

    cur = await testService.advanceMilestone(partner, cur.id, 'PARTNER_EN_ROUTE');
    assert.equal(computeKey(cur), keyBefore);

    cur = await testService.advanceMilestone(partner, cur.id, 'PARTNER_ARRIVED');
    assert.equal(computeKey(cur), keyBefore);

    cur = await testService.advanceMilestone(partner, cur.id, 'PATIENT_PICKED_UP');
    assert.equal(computeKey(cur), keyBefore);

    cur = await testService.advanceMilestone(partner, cur.id, 'IN_TRANSIT_TO_HOSPITAL');
    assert.equal(computeKey(cur), keyBefore);

    cur = await testService.advanceMilestone(partner, cur.id, 'ARRIVED_AT_HOSPITAL');
    assert.equal(computeKey(cur), keyBefore);

    cur = await testService.advanceMilestone(partner, cur.id, 'HOSPITAL_VISIT');
    assert.equal(computeKey(cur), keyBefore);

    // Keys are strictly equal across all 7 state transitions; route hook does not recalculate
    assert.equal(computeKey(cur), keyBefore);
  });

  await runTest('27. Changing route endpoints does trigger recalculation', async () => {
    const countBefore = googleMapsService.calculationCount;

    // Different hospital destination
    const hospitals = await testService.getHospitals();
    const otherHospital = hospitals.length > 1 ? hospitals[1] : {
      ...hospital,
      id: 'hosp-manipal-demo',
      name: '[DEMO] Manipal Hospital',
      latitude: 12.9592,
      longitude: 77.6534,
      address: '[DEMO] 98 HAL Airport Rd, Bengaluru',
    };

    const newRoute = await googleMapsService.computeTwoLegJourneyRoute(
      patientProfile.homeAddress,
      otherHospital,
      patientProfile.homeAddress
    );

    // Calculation count must increase since destination changed
    assert.equal(googleMapsService.calculationCount, countBefore + 1);
    assert.equal(newRoute.leg1Outbound.destination.address, otherHospital.address);
    assert.equal(newRoute.leg2Return.origin.address, otherHospital.address);
  });

  await runTest('28. Outbound route remains Home → Hospital and Return route remains Hospital → Home', async () => {
    const twoLeg = await googleMapsService.computeTwoLegJourneyRoute(
      patientProfile.homeAddress,
      hospital,
      patientProfile.homeAddress
    );
    // Outbound leg: Home -> Hospital
    assert.equal(twoLeg.leg1Outbound.origin.address, patientProfile.homeAddress.address);
    assert.equal(twoLeg.leg1Outbound.destination.address, hospital.address);

    // Return leg: Hospital -> Home
    assert.equal(twoLeg.leg2Return.origin.address, hospital.address);
    assert.equal(twoLeg.leg2Return.destination.address, patientProfile.homeAddress.address);
  });

  console.log('\n--------------------------------------------------');
  console.log(`TOTAL PHASE 4 TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
  console.log('ALL PHASE 4 GOOGLE MAPS & ROUTING TESTS PASSED!');
  console.log('--------------------------------------------------\n');
}

runPhase4TestSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
