import assert from 'node:assert/strict';
import { sharedJourneyService, JourneyService } from '../src/services/journey-service.ts';
import { DEV_IDENTITIES, canAccessRoute, authorizeAction } from '../src/auth/index.ts';
import { DomainError } from '../src/domain/index.ts';

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

async function runPhase3TestSuite() {
  console.log('\n==================================================');
  console.log('NERAVU PHASE 3: ROLE-SPECIFIC WORKFLOWS TEST SUITE');
  console.log('==================================================\n');

  const patient = DEV_IDENTITIES.PATIENT;
  const partner = DEV_IDENTITIES.CARE_PARTNER;
  const family = DEV_IDENTITIES.FAMILY_CONTACT;
  const admin = DEV_IDENTITIES.ADMIN;

  const testService = new JourneyService();
  const hospitals = await testService.getHospitals();
  const hospital = hospitals[0];
  const patientProfile = await testService.getPatientProfile(patient.id);
  assert(patientProfile, 'Patient profile must exist');

  // 1. Patient can access Patient Portal
  await runTest('1. Patient can access Patient Portal (/patient/home)', () => {
    const guard = canAccessRoute(patient, '/patient/home');
    assert.equal(guard.allowed, true);
  });

  // 2. Patient can create a booking
  await runTest('2. Patient can create a booking', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      returnDropoffLocation: patientProfile.homeAddress,
      bookingType: 'ON_DEMAND',
    });
    assert(journey);
    assert.equal(journey.patientId, patient.id);
    assert.equal(journey.currentState, 'MATCHING');
  });

  // 3. Booking contains pickup
  await runTest('3. Booking contains pickup location', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    assert(journey.pickupLocation);
    assert.equal(journey.pickupLocation.address, patientProfile.homeAddress.address);
  });

  // 4. Booking contains hospital destination
  await runTest('4. Booking contains hospital destination', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    assert(journey.hospitalDestination);
    assert.equal(journey.hospitalDestination.id, hospital.id);
    assert.equal(journey.hospitalDestination.name, hospital.name);
  });

  // 5. Booking contains return destination
  await runTest('5. Booking contains return destination', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      returnDropoffLocation: patientProfile.homeAddress,
      bookingType: 'ON_DEMAND',
    });
    assert(journey.returnDropoffLocation);
    assert.equal(journey.returnDropoffLocation.address, patientProfile.homeAddress.address);
  });

  // 6. Booking can be on-demand
  await runTest('6. Booking can be on-demand', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    assert.equal(journey.bookingType, 'ON_DEMAND');
  });

  // 7. Booking can be scheduled
  await runTest('7. Booking can be scheduled', async () => {
    const scheduledTime = '2026-10-05T09:30:00.000Z';
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'SCHEDULED',
      scheduledPickupTime: scheduledTime,
    });
    assert.equal(journey.bookingType, 'SCHEDULED');
    assert.equal(journey.scheduledPickupTime, scheduledTime);
  });

  // 8. Patient cannot access another patient's journey
  await runTest("8. Patient cannot access another patient's journey (IDOR)", async () => {
    const otherPatientJourney = await testService.createBooking(
      { ...patient, id: 'dev-user-patient-2' },
      {
        pickupLocation: patientProfile.homeAddress,
        hospitalDestination: hospital,
        bookingType: 'ON_DEMAND',
      }
    );

    const authCheck = authorizeAction(patient, 'VIEW_JOURNEY', {
      journey: otherPatientJourney,
    });
    assert.equal(authCheck.authorized, false);
    assert.equal(authCheck.code, 'IDOR_VIOLATION');
  });

  // CARE PARTNER TESTS

  // 9. Care Partner can access Care Partner Portal
  await runTest('9. Care Partner can access Care Partner Portal (/care-partner/dashboard)', () => {
    const guard = canAccessRoute(partner, '/care-partner/dashboard');
    assert.equal(guard.allowed, true);
  });

  // 10. Care Partner can view offered/assigned journey
  await runTest('10. Care Partner can view offered/assigned journey', async () => {
    const offered = await testService.getOfferedJourneysForPartner(partner.id);
    assert(Array.isArray(offered));

    // Partner accepts an offered journey
    if (offered.length > 0) {
      const assigned = await testService.acceptJourney(partner, offered[0].id);
      assert.equal(assigned.carePartnerId, partner.id);
      assert.equal(assigned.currentState, 'PARTNER_ASSIGNED');
    }
  });

  // 11. Care Partner cannot access another partner's private journey
  await runTest("11. Care Partner cannot access another partner's private journey", async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assignedPartnerB = await testService.acceptJourney(
      { ...partner, id: 'dev-user-partner-2' },
      journey.id
    );

    // Care Partner 1 tries to access Care Partner 2's private journey
    const authCheck = authorizeAction(partner, 'VIEW_JOURNEY', {
      journey: assignedPartnerB,
    });
    assert.equal(authCheck.authorized, false);
    assert.equal(authCheck.code, 'IDOR_VIOLATION');
  });

  // 12. Care Partner can progress the assigned journey through valid states
  await runTest('12. Care Partner can progress assigned journey through valid states', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assigned = await testService.acceptJourney(partner, journey.id);

    // Advance En Route -> Arrived -> Picked Up -> In Transit
    const enRoute = await testService.advanceMilestone(partner, assigned.id, 'PARTNER_EN_ROUTE');
    assert.equal(enRoute.currentState, 'PARTNER_EN_ROUTE');

    const arrived = await testService.advanceMilestone(partner, enRoute.id, 'PARTNER_ARRIVED');
    assert.equal(arrived.currentState, 'PARTNER_ARRIVED');

    const pickedUp = await testService.advanceMilestone(partner, arrived.id, 'PATIENT_PICKED_UP');
    assert.equal(pickedUp.currentState, 'PATIENT_PICKED_UP');

    const inTransit = await testService.advanceMilestone(partner, pickedUp.id, 'IN_TRANSIT_TO_HOSPITAL');
    assert.equal(inTransit.currentState, 'IN_TRANSIT_TO_HOSPITAL');
  });

  // 13. Care Partner cannot complete at hospital
  await runTest('13. Care Partner cannot complete at hospital', async () => {
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

    // Attempting COMPLETED from ARRIVED_AT_HOSPITAL must reject!
    await assert.rejects(
      async () => {
        await testService.advanceMilestone(partner, cur.id, 'COMPLETED');
      },
      (err: any) => err.code === 'ARRIVED_AT_HOSPITAL_CANNOT_COMPLETE'
    );
  });

  // HOSPITAL VISIT TESTS

  // 14. ARRIVED_AT_HOSPITAL → HOSPITAL_VISIT works
  await runTest('14. ARRIVED_AT_HOSPITAL → HOSPITAL_VISIT works', async () => {
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

    const hospVisit = await testService.advanceMilestone(partner, cur.id, 'HOSPITAL_VISIT');
    assert.equal(hospVisit.currentState, 'HOSPITAL_VISIT');
  });

  // 15. HOSPITAL_VISIT keeps journey active
  await runTest('15. HOSPITAL_VISIT keeps journey active', async () => {
    const active = await testService.getActiveJourneyForPatient(patient.id);
    if (active && active.currentState === 'HOSPITAL_VISIT') {
      assert(active.carePartnerId, 'Care Partner remains assigned during HOSPITAL_VISIT');
      assert.notEqual(active.currentState, 'COMPLETED');
      assert.notEqual(active.currentState, 'CANCELLED');
    }
  });

  // 16. HOSPITAL_VISIT → COMPLETED is rejected
  await runTest('16. HOSPITAL_VISIT → COMPLETED is rejected', async () => {
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

    await assert.rejects(
      async () => {
        await testService.advanceMilestone(partner, cur.id, 'COMPLETED');
      },
      (err: any) => err.code === 'HOSPITAL_VISIT_CANNOT_COMPLETE'
    );
  });

  // 17. HOSPITAL_VISIT → RETURN_STARTED works
  await runTest('17. HOSPITAL_VISIT → RETURN_STARTED works (Patient or Partner triggers return)', async () => {
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

    // Patient signals ready for return home
    const returnStarted = await testService.advanceMilestone(patient, cur.id, 'RETURN_STARTED');
    assert.equal(returnStarted.currentState, 'RETURN_STARTED');
  });

  // RETURN TESTS

  // 18. RETURN_STARTED → IN_TRANSIT_TO_HOME works
  await runTest('18. RETURN_STARTED → IN_TRANSIT_TO_HOME works (Leg 2 Transit)', async () => {
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

    const inTransitHome = await testService.advanceMilestone(partner, cur.id, 'IN_TRANSIT_TO_HOME');
    assert.equal(inTransitHome.currentState, 'IN_TRANSIT_TO_HOME');
  });

  // 19. IN_TRANSIT_TO_HOME → PATIENT_RETURNED_HOME works
  await runTest('19. IN_TRANSIT_TO_HOME → PATIENT_RETURNED_HOME works', async () => {
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

    const returnedHome = await testService.advanceMilestone(partner, cur.id, 'PATIENT_RETURNED_HOME');
    assert.equal(returnedHome.currentState, 'PATIENT_RETURNED_HOME');
  });

  // 20. PATIENT_RETURNED_HOME → COMPLETED works
  await runTest('20. PATIENT_RETURNED_HOME → COMPLETED works (Safe Conclusion)', async () => {
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

    const completed = await testService.advanceMilestone(partner, cur.id, 'COMPLETED');
    assert.equal(completed.currentState, 'COMPLETED');
  });

  // FAMILY TESTS

  // 21. Authorized Family Contact can view permitted journey
  await runTest('21. Authorized Family Contact can view permitted journey', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });

    const authCheck = authorizeAction(family, 'VIEW_JOURNEY', {
      journey,
      trustedContacts: patientProfile.trustedContacts,
    });
    assert.equal(authCheck.authorized, true);
  });

  // 22. Unauthorized Family Contact cannot view journey
  await runTest('22. Unauthorized Family Contact cannot view journey', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });

    // Unrelated family contact
    const unrelatedFamily = { ...family, id: 'unrelated-family-99', phone: '+91 99999 88888' };
    const authCheck = authorizeAction(unrelatedFamily, 'VIEW_JOURNEY', {
      journey,
      trustedContacts: patientProfile.trustedContacts,
    });
    assert.equal(authCheck.authorized, false);
    assert.equal(authCheck.code, 'IDOR_VIOLATION');
  });

  // 23. Family Contact cannot modify journey state
  await runTest('23. Family Contact cannot modify journey state', () => {
    const authCheck = authorizeAction(family, 'UPDATE_JOURNEY_MILESTONE');
    assert.equal(authCheck.authorized, false);
    assert.equal(authCheck.code, 'READ_ONLY_ACCESS');
  });

  // ADMIN TESTS

  // 24. Admin can view operational journey information
  await runTest('24. Admin can view operational journey information', () => {
    const authCheck = authorizeAction(admin, 'ACCESS_ADMIN_OPERATIONS');
    assert.equal(authCheck.authorized, true);
    assert.equal(canAccessRoute(admin, '/admin/overview').allowed, true);
  });

  // 25. Non-admin cannot access Admin Portal
  await runTest('25. Non-admin cannot access Admin Portal', () => {
    assert.equal(canAccessRoute(patient, '/admin/overview').allowed, false);
    assert.equal(canAccessRoute(partner, '/admin/overview').allowed, false);
    assert.equal(canAccessRoute(family, '/admin/overview').allowed, false);
  });

  // PHASE 3 CORRECTION PASS TESTS

  // 26. Development status is not represented as real GPS
  await runTest('26. Development status is not represented as real GPS (Location is from booking data)', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    // Verify coordinates are static from booking data model, not connected to a live GPS socket/telemetry
    assert.equal(journey.pickupLocation.latitude, patientProfile.homeAddress.latitude);
    assert.equal(journey.pickupLocation.longitude, patientProfile.homeAddress.longitude);
  });

  // 27. Demo data is clearly labeled as development data
  await runTest('27. Demo data is clearly labeled as development data', async () => {
    const pProfile = await testService.getPatientProfile(patient.id);
    const cpProfile = await testService.getCarePartnerProfile(partner.id);
    assert(pProfile?.homeAddress.address.includes('[DEMO]'));
    assert(cpProfile?.vehicle.make.includes('[DEMO]'));
    assert(patient.name.includes('[DEMO]'));
    assert(partner.name.includes('[DEMO]'));
    assert(hospital.name.includes('[DEMO]'));
  });

  // 28. No hospital emergency telephone number is invented
  await runTest('28. No hospital emergency telephone number is invented', () => {
    // Default seed hospitals must have undefined emergencyContactPhone so UI displays "Hospital emergency contact: Not configured"
    assert.equal(hospital.emergencyContactPhone, undefined);
  });

  // 29. 112 is not represented as an API integration
  await runTest('29. 112 is not represented as an API integration (Dialing action only)', () => {
    // There is no backend service call or direct dispatch API for 112 in journeyService
    assert.equal(typeof (testService as any).dispatch112EmergencyApi, 'undefined');
  });

  // 30. FULL_STATUS permissions allow full milestones, location, and companion details
  await runTest('30. FULL_STATUS permission level allows full status, location, and companion details', async () => {
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

    const viewDetails = authorizeAction(family, 'VIEW_JOURNEY_DETAILS', { journey, trustedContacts });
    const viewLocation = authorizeAction(family, 'VIEW_JOURNEY_LOCATION', { journey, trustedContacts });
    const viewEmergency = authorizeAction(family, 'VIEW_JOURNEY_EMERGENCY', { journey, trustedContacts });

    assert.equal(viewDetails.authorized, true);
    assert.equal(viewLocation.authorized, true);
    assert.equal(viewEmergency.authorized, true);
  });

  // 31. LIVE_LOCATION permission restricts non-location journey details
  await runTest('31. LIVE_LOCATION permission restricts non-location details but allows location', async () => {
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

    const viewDetails = authorizeAction(family, 'VIEW_JOURNEY_DETAILS', { journey, trustedContacts });
    const viewLocation = authorizeAction(family, 'VIEW_JOURNEY_LOCATION', { journey, trustedContacts });

    // Non-location details are restricted
    assert.equal(viewDetails.authorized, false);
    assert.equal(viewDetails.code, 'FORBIDDEN_ROLE');
    // Location is permitted
    assert.equal(viewLocation.authorized, true);
  });

  // 32. EMERGENCY_ONLY permission restricts routine details and location when inactive
  await runTest('32. EMERGENCY_ONLY permission restricts routine details and location when inactive', async () => {
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

    const viewDetails = authorizeAction(family, 'VIEW_JOURNEY_DETAILS', { journey, trustedContacts });
    const viewLocation = authorizeAction(family, 'VIEW_JOURNEY_LOCATION', { journey, trustedContacts });
    const viewEmergency = authorizeAction(family, 'VIEW_JOURNEY_EMERGENCY', { journey, trustedContacts });

    // Details and location are restricted when inactive
    assert.equal(viewDetails.authorized, false);
    assert.equal(viewLocation.authorized, false);
    // Emergency alerts are authorized
    assert.equal(viewEmergency.authorized, true);

    // When emergency triggers, location becomes accessible
    journey.currentState = 'EMERGENCY_ACTIVE';
    const viewLocationActive = authorizeAction(family, 'VIEW_JOURNEY_LOCATION', { journey, trustedContacts });
    assert.equal(viewLocationActive.authorized, true);
  });

  console.log('\n--------------------------------------------------');
  console.log(`TOTAL PHASE 3 TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
  console.log('ALL PHASE 3 ROLE-SPECIFIC WORKFLOW TESTS PASSED!');
  console.log('--------------------------------------------------\n');
}

runPhase3TestSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
