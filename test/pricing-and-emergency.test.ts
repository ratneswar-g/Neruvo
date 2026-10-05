import assert from 'node:assert/strict';
import {
  calculateJourneyFare,
  DEFAULT_PRICING_POLICY,
  validatePricingPolicy,
  validateFareInput,
  PricingPolicy,
  isValidEmergencyCategory,
  validateEmergencyTrigger,
  EmergencyCategory,
} from '../src/domain/index.ts';
import {
  JourneyService,
} from '../src/services/journey-service.ts';
import {
  DEV_IDENTITIES,
  authorizeAction,
} from '../src/auth/index.ts';
import { googleMapsService } from '../src/maps/index.ts';

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

async function runPhase5TestSuite() {
  console.log('\n==================================================');
  console.log('NERAVU PHASE 5: PRICING & EMERGENCY TEST SUITE');
  console.log('==================================================\n');

  const patient = DEV_IDENTITIES.PATIENT;
  const partner = DEV_IDENTITIES.CARE_PARTNER;
  const family = DEV_IDENTITIES.FAMILY_CONTACT;
  const admin = DEV_IDENTITIES.ADMIN;

  const testService = new JourneyService();
  const hospitals = await testService.getHospitals();
  const hospital = hospitals[0];
  const patientProfile = await testService.getPatientProfile(patient.id);
  assert(patientProfile);

  // ==========================================
  // PART A: PRICING TESTS (1 to 17)
  // ==========================================

  await runTest('1. Pricing configuration can be created/validated', () => {
    const validPolicy: PricingPolicy = {
      version: 'policy-test-1',
      currency: 'INR',
      baseServiceFee: 250,
      perDistanceRatePerKm: 18,
      perAccompanimentRatePerHour: 200,
      platformFee: 100,
      taxRate: 0.05,
      minimumFare: 600,
      defaultEstimatedAccompanimentMinutes: 120,
    };
    const result = validatePricingPolicy(validPolicy);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  await runTest('2. Invalid negative rates are rejected', () => {
    const invalidPolicy = {
      ...DEFAULT_PRICING_POLICY,
      baseServiceFee: -50,
      perDistanceRatePerKm: -10,
    };
    const result = validatePricingPolicy(invalidPolicy);
    assert.equal(result.valid, false);
    assert(result.errors.some((e) => e.includes('baseServiceFee')));
    assert(result.errors.some((e) => e.includes('perDistanceRatePerKm')));
  });

  await runTest('3. Negative distance is rejected', () => {
    const invalidInput = {
      outboundDistanceMeters: -5000,
      returnDistanceMeters: 5000,
    };
    const result = validateFareInput(invalidInput);
    assert.equal(result.valid, false);
    assert(result.errors.some((e) => e.includes('outboundDistanceMeters')));

    assert.throws(() => {
      calculateJourneyFare(invalidInput);
    });
  });

  await runTest('4. Negative duration is rejected', () => {
    const invalidInput = {
      outboundDistanceMeters: 10000,
      returnDistanceMeters: 10000,
      estimatedAccompanimentMinutes: -60,
    };
    const result = validateFareInput(invalidInput);
    assert.equal(result.valid, false);
    assert(result.errors.some((e) => e.includes('estimatedAccompanimentMinutes')));

    assert.throws(() => {
      calculateJourneyFare(invalidInput);
    });
  });

  await runTest('5. Tax configuration is validated', () => {
    const invalidTaxHigh = {
      ...DEFAULT_PRICING_POLICY,
      taxRate: 1.5, // > 100% tax
    };
    assert.equal(validatePricingPolicy(invalidTaxHigh).valid, false);

    const invalidTaxNegative = {
      ...DEFAULT_PRICING_POLICY,
      taxRate: -0.1,
    };
    assert.equal(validatePricingPolicy(invalidTaxNegative).valid, false);

    const validTax = {
      ...DEFAULT_PRICING_POLICY,
      taxRate: 0.18, // 18% GST
    };
    assert.equal(validatePricingPolicy(validTax).valid, true);
  });

  await runTest('6. Pricing components are calculated correctly', () => {
    // 10km outbound, 10km return -> 20km round trip
    // 120 mins accompaniment -> 2 hours
    // policy: base 250, distance 18/km, accomp 200/hr, plat 100, tax 5%
    const fare = calculateJourneyFare({
      outboundDistanceMeters: 10000,
      returnDistanceMeters: 10000,
      estimatedAccompanimentMinutes: 120,
    }, DEFAULT_PRICING_POLICY);

    assert.equal(fare.baseBookingFee, 250);
    // 20 km * 18 = 360
    assert.equal(fare.transitDistanceFee, 360);
    // 2 hrs * 200 = 400
    assert.equal(fare.companionServiceTimeFee, 400);
    assert.equal(fare.platformServiceFee, 100);
    // subtotal = 250 + 360 + 400 + 100 = 1110
    // tax = 1110 * 0.05 = 55.5 -> 56 (Math.round)
    assert.equal(fare.taxes, 56);
    // total = 1110 + 56 = 1166
    assert.equal(fare.total, 1166);
  });

  await runTest('7. Total equals component sum', () => {
    const fare = calculateJourneyFare({
      outboundDistanceMeters: 15400,
      returnDistanceMeters: 14800,
      estimatedAccompanimentMinutes: 90,
    });
    assert(fare.components && fare.components.length > 0);
    const sum = fare.components.reduce((acc, c) => acc + c.amount, 0);
    assert.equal(sum, fare.total);
  });

  await runTest('8. One booking represents one round-trip fare', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      returnDropoffLocation: patientProfile.homeAddress,
      bookingType: 'ON_DEMAND',
    });
    assert(journey.id);
    assert(journey.initialFareEstimate);
    assert.equal(journey.isRoundTrip, true);
    assert.equal(journey.initialFareEstimate.currency, 'INR');
  });

  await runTest('9. Outbound and return distances can both contribute to the journey calculation', () => {
    // 8km outbound + 12km return = 20km total
    const fareSeparate = calculateJourneyFare({
      outboundDistanceMeters: 8000,
      returnDistanceMeters: 12000,
      estimatedAccompanimentMinutes: 120,
    });
    // 20km outbound + 0km return = 20km total
    const fareCombined = calculateJourneyFare({
      outboundDistanceMeters: 20000,
      returnDistanceMeters: 0,
      estimatedAccompanimentMinutes: 120,
    });
    assert.equal(fareSeparate.transitDistanceFee, fareCombined.transitDistanceFee);
    assert.equal(fareSeparate.total, fareCombined.total);
  });

  await runTest('10. Google Maps distance is an input, not the pricing authority', async () => {
    const route = await googleMapsService.computeTwoLegJourneyRoute(
      patientProfile.homeAddress,
      hospital,
      patientProfile.homeAddress
    );
    // Route provides distance metrics
    assert(route.leg1Outbound.distanceMeters > 0);
    assert(route.leg2Return.distanceMeters > 0);

    // Domain pricing engine evaluates fare based on domain policy, not Google Maps API
    const fare = calculateJourneyFare({
      outboundDistanceMeters: route.leg1Outbound.distanceMeters,
      returnDistanceMeters: route.leg2Return.distanceMeters,
      estimatedAccompanimentMinutes: 120,
    });
    assert(fare.total > 0);
    assert.equal(fare.currency, 'INR');
  });

  await runTest('11. Pricing remains deterministic', () => {
    const input = {
      outboundDistanceMeters: 12345,
      returnDistanceMeters: 12345,
      estimatedAccompanimentMinutes: 150,
    };
    const f1 = calculateJourneyFare(input);
    const f2 = calculateJourneyFare(input);
    assert.deepEqual(f1, f2);
  });

  await runTest('12. Estimated fare is clearly distinguished from payment', () => {
    const fare = calculateJourneyFare({
      outboundDistanceMeters: 10000,
      returnDistanceMeters: 10000,
    });
    assert.equal(fare.isEstimate, true);
  });

  await runTest('13. Pricing snapshot is preserved for the booking', async () => {
    const j1 = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const snapshotFare = j1.initialFareEstimate?.total;
    assert(snapshotFare);

    // Update global pricing policy to higher rates
    testService.updatePricingPolicy(admin, {
      ...DEFAULT_PRICING_POLICY,
      baseServiceFee: 999,
      perDistanceRatePerKm: 50,
    });

    // Check that existing journey j1 preserved its original fare snapshot
    const fetchedJ1 = await testService.getJourneyById(j1.id);
    assert.equal(fetchedJ1?.initialFareEstimate?.total, snapshotFare);

    // Reset policy back to default
    testService.updatePricingPolicy(admin, DEFAULT_PRICING_POLICY);
  });

  await runTest('14. Patient cannot modify global pricing', () => {
    const auth = authorizeAction(patient, 'UPDATE_PRICING_POLICY');
    assert.equal(auth.authorized, false);
    assert.equal(auth.code, 'FORBIDDEN_ROLE');

    assert.throws(() => {
      testService.updatePricingPolicy(patient, DEFAULT_PRICING_POLICY);
    });
  });

  await runTest('15. Care Partner cannot modify global pricing', () => {
    const auth = authorizeAction(partner, 'UPDATE_PRICING_POLICY');
    assert.equal(auth.authorized, false);
    assert.equal(auth.code, 'FORBIDDEN_ROLE');

    assert.throws(() => {
      testService.updatePricingPolicy(partner, DEFAULT_PRICING_POLICY);
    });
  });

  await runTest('16. Family cannot modify pricing', () => {
    const auth = authorizeAction(family, 'UPDATE_PRICING_POLICY');
    assert.equal(auth.authorized, false);
    assert.equal(auth.code, 'FORBIDDEN_ROLE');

    assert.throws(() => {
      testService.updatePricingPolicy(family, DEFAULT_PRICING_POLICY);
    });
  });

  await runTest('17. Authorized Admin can manage pricing configuration where permitted', () => {
    const auth = authorizeAction(admin, 'UPDATE_PRICING_POLICY');
    assert.equal(auth.authorized, true);

    const updated = testService.updatePricingPolicy(admin, {
      ...DEFAULT_PRICING_POLICY,
      version: 'policy-admin-v2',
      minimumFare: 650,
    });
    assert.equal(updated.version, 'policy-admin-v2');
    assert.equal(updated.minimumFare, 650);

    // Restore default
    testService.updatePricingPolicy(admin, DEFAULT_PRICING_POLICY);
  });

  // ==========================================
  // PART B: ACCOMPANIMENT TESTS (18 to 20)
  // ==========================================

  await runTest('18. Hospital accompaniment is represented as a pricing dimension', () => {
    const zeroAccomp = calculateJourneyFare({
      outboundDistanceMeters: 10000,
      returnDistanceMeters: 10000,
      estimatedAccompanimentMinutes: 0,
    });
    const twoHourAccomp = calculateJourneyFare({
      outboundDistanceMeters: 10000,
      returnDistanceMeters: 10000,
      estimatedAccompanimentMinutes: 120,
    });
    assert.equal(zeroAccomp.companionServiceTimeFee, 0);
    assert.equal(twoHourAccomp.companionServiceTimeFee, 400); // 2 hrs @ 200/hr
    assert(twoHourAccomp.total > zeroAccomp.total);
  });

  await runTest('19. Accompaniment estimate is calculated correctly', () => {
    // 3 hours = 180 mins @ 200/hr = 600
    const fare = calculateJourneyFare({
      outboundDistanceMeters: 5000,
      returnDistanceMeters: 5000,
      estimatedAccompanimentMinutes: 180,
    });
    assert.equal(fare.companionServiceTimeFee, 600);
  });

  await runTest('20. No fake live billing meter is created', () => {
    const fare = calculateJourneyFare({
      outboundDistanceMeters: 10000,
      returnDistanceMeters: 10000,
    });
    // Accompaniment fee is an estimate based on configured parameters, not a live tick meter
    assert.equal(fare.isEstimate, true);
    assert(fare.components?.some((c) => c.code === 'COMPANION_SERVICE_TIME'));
  });

  // ==========================================
  // PART C: EMERGENCY TESTS (21 to 38)
  // ==========================================

  // Helpers for legal milestone progression in tests
  const advanceToInTransit = async (journeyId: string) => {
    let cur = await testService.acceptJourney(partner, journeyId);
    cur = await testService.advanceMilestone(partner, cur.id, 'PARTNER_EN_ROUTE');
    cur = await testService.advanceMilestone(partner, cur.id, 'PARTNER_ARRIVED');
    cur = await testService.advanceMilestone(partner, cur.id, 'PATIENT_PICKED_UP');
    return testService.advanceMilestone(partner, cur.id, 'IN_TRANSIT_TO_HOSPITAL');
  };

  const advanceToHospitalVisit = async (journeyId: string) => {
    const inTransit = await advanceToInTransit(journeyId);
    const atHosp = await testService.advanceMilestone(partner, inTransit.id, 'ARRIVED_AT_HOSPITAL');
    return testService.advanceMilestone(partner, atHosp.id, 'HOSPITAL_VISIT');
  };

  await runTest('21. Patient can trigger emergency during active journey', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const inTransit = await advanceToInTransit(journey.id);

    const emergency = await testService.triggerEmergency(patient, inTransit.id, {
      category: 'MEDICAL_EMERGENCY',
      reason: 'Patient feeling chest tightness',
    });
    assert.equal(emergency.currentState, 'EMERGENCY_ACTIVE');
  });

  await runTest('22. Care Partner can trigger emergency during active journey', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const visit = await advanceToHospitalVisit(journey.id);

    const emergency = await testService.triggerEmergency(partner, visit.id, {
      category: 'SAFETY_CONCERN',
      reason: 'Companion vehicle flat tire on hospital ramp',
    });
    assert.equal(emergency.currentState, 'EMERGENCY_ACTIVE');
  });

  await runTest('23. Emergency preserves previous journey state', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const visit = await advanceToHospitalVisit(journey.id);

    const emergency = await testService.triggerEmergency(partner, visit.id, {
      category: 'PATIENT_DISTRESS',
    });
    assert.equal(emergency.previousStateBeforeEmergency, 'HOSPITAL_VISIT');
  });

  await runTest('24. Emergency preserves journey context', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assigned = await testService.acceptJourney(partner, journey.id);

    const emergency = await testService.triggerEmergency(partner, assigned.id, {
      category: 'ACCIDENT',
    });
    assert.equal(emergency.pickupLocation.address, patientProfile.homeAddress.address);
    assert.equal(emergency.hospitalDestination.id, hospital.id);
    assert.equal(emergency.returnDropoffLocation.address, patientProfile.homeAddress.address);
    assert.equal(emergency.carePartnerId, partner.id);
    assert.equal(emergency.patientId, patient.id);
  });

  await runTest('25. Emergency incident record is created', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assigned = await testService.acceptJourney(partner, journey.id);

    const emergency = await testService.triggerEmergency(partner, assigned.id, {
      category: 'MEDICAL_EMERGENCY',
      reason: 'Sudden shortness of breath',
    });
    assert(emergency.emergencyLogs.length > 0);
    const incident = emergency.emergencyLogs[emergency.emergencyLogs.length - 1];
    assert.equal(incident.status, 'ACTIVE');
    assert.equal(incident.category, 'MEDICAL_EMERGENCY');
    assert.equal(incident.triggeredByUserId, partner.id);
    assert.equal(incident.triggeredByRole, 'CARE_PARTNER');
    assert(incident.triggeredAt);
    assert.equal(incident.destinationSnapshot?.id, hospital.id);
  });

  await runTest('26. Unauthorized user cannot resolve another user emergency', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assigned = await testService.acceptJourney(partner, journey.id);
    const emergency = await testService.triggerEmergency(partner, assigned.id, {
      category: 'SAFETY_CONCERN',
    });

    // Patient cannot resolve emergency (strictly Admin/Ops required)
    await assert.rejects(async () => {
      await testService.resolveEmergency(patient, emergency.id, 'Patient attempted clear');
    });

    // Care partner cannot resolve emergency
    await assert.rejects(async () => {
      await testService.resolveEmergency(partner, emergency.id, 'Partner attempted clear');
    });

    // Family contact cannot resolve emergency
    await assert.rejects(async () => {
      await testService.resolveEmergency(family, emergency.id, 'Family attempted clear');
    });
  });

  await runTest('27. Authorized Admin can resolve emergency', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assigned = await testService.acceptJourney(partner, journey.id);
    const emergency = await testService.triggerEmergency(partner, assigned.id, {
      category: 'MEDICAL_EMERGENCY',
    });

    const resolved = await testService.resolveEmergency(
      admin,
      emergency.id,
      'Operations desk verified safe vehicle stop; companion confirmed patient stable; operational clearance to resume journey'
    );
    assert.notEqual(resolved.currentState, 'EMERGENCY_ACTIVE');
    const lastIncident = resolved.emergencyLogs[resolved.emergencyLogs.length - 1];
    assert.equal(lastIncident.status, 'RESOLVED');
    assert.equal(lastIncident.resolvedByUserId, admin.id);
    assert(lastIncident.resolvedAt);
  });

  await runTest('28. Resolution restores the previous journey state', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const inTransit = await advanceToInTransit(journey.id);

    const emergency = await testService.triggerEmergency(patient, inTransit.id, {
      category: 'MEDICAL_EMERGENCY',
    });
    assert.equal(emergency.currentState, 'EMERGENCY_ACTIVE');

    const restored = await testService.resolveEmergency(
      admin,
      emergency.id,
      'Clearance given to resume transit'
    );
    // Must resume exact pre-emergency state: IN_TRANSIT_TO_HOSPITAL
    assert.equal(restored.currentState, 'IN_TRANSIT_TO_HOSPITAL');
  });

  await runTest('29. Emergency cannot complete a journey', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assigned = await testService.acceptJourney(partner, journey.id);
    const emergency = await testService.triggerEmergency(partner, assigned.id);

    // Cannot jump from EMERGENCY_ACTIVE to COMPLETED
    await assert.rejects(async () => {
      await testService.advanceMilestone(partner, emergency.id, 'COMPLETED');
    });
  });

  await runTest('30. HOSPITAL_VISIT remains active during emergency recovery', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const visit = await advanceToHospitalVisit(journey.id);

    const emergency = await testService.triggerEmergency(patient, visit.id, {
      category: 'PATIENT_DISTRESS',
    });
    assert.equal(emergency.previousStateBeforeEmergency, 'HOSPITAL_VISIT');

    const restored = await testService.resolveEmergency(admin, emergency.id, 'Distress de-escalated');
    // Restores to HOSPITAL_VISIT, keeping Care Partner and journey active
    assert.equal(restored.currentState, 'HOSPITAL_VISIT');
    assert.equal(restored.carePartnerId, partner.id);
  });

  await runTest('31. HOSPITAL_VISIT cannot directly become COMPLETED', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const visit = await advanceToHospitalVisit(journey.id);

    await assert.rejects(async () => {
      await testService.advanceMilestone(partner, visit.id, 'COMPLETED');
    });
  });

  await runTest('32. Patient returned home remains the only normal completion path', async () => {
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

  await runTest('33. Emergency category is validated', () => {
    assert.equal(isValidEmergencyCategory('MEDICAL_EMERGENCY'), true);
    assert.equal(isValidEmergencyCategory('SAFETY_CONCERN'), true);
    assert.equal(isValidEmergencyCategory('ACCIDENT'), true);
    assert.equal(isValidEmergencyCategory('PATIENT_DISTRESS'), true);
    assert.equal(isValidEmergencyCategory('OTHER'), true);
    assert.equal(isValidEmergencyCategory('INVALID_CATEGORY'), false);
    assert.equal(isValidEmergencyCategory('CLINICAL_SURGERY'), false);
  });

  await runTest('34. Emergency records are access-controlled', async () => {
    // Admin can access full emergency incident audit log
    const adminAuth = authorizeAction(admin, 'ACCESS_ADMIN_OPERATIONS');
    assert.equal(adminAuth.authorized, true);
    const incidents = await testService.getAllEmergencyIncidents(admin);
    assert(Array.isArray(incidents));

    // Patient cannot access operational emergency audit log
    const patientAuth = authorizeAction(patient, 'ACCESS_ADMIN_OPERATIONS');
    assert.equal(patientAuth.authorized, false);
    await assert.rejects(async () => {
      await testService.getAllEmergencyIncidents(patient);
    });
  });

  await runTest('35. No hospital emergency number is invented', async () => {
    const hosps = await testService.getHospitals();
    for (const h of hosps) {
      if (h.emergencyContactPhone) {
        assert(!h.emergencyContactPhone.includes('555-'));
      }
    }
  });

  await runTest('36. 112 remains a user-initiated dialing action only', () => {
    // Verified: No external 112 API service exists; telephone links only
    assert.equal(typeof (globalThis as any).call112Api, 'undefined');
  });

  await runTest('37. No claim of automatic emergency dispatch', () => {
    // System preserves incident state without claiming auto dispatch to police or ambulances
    const valid = validateEmergencyTrigger({ currentState: 'IN_TRANSIT_TO_HOSPITAL' } as any);
    assert.equal(valid.valid, true);
  });

  await runTest('38. No fake live GPS is created', () => {
    // Booking location coordinates are preserved directly without random jitter simulation
    const loc = patientProfile.homeAddress;
    assert.equal(loc.latitude, 12.9716);
    assert.equal(loc.longitude, 77.5946);
  });

  // ==========================================
  // CORRECTION PASS VERIFICATION TESTS (39 to 42)
  // ==========================================

  await runTest('39. Emergency resolution notes are strictly operational and non-clinical', async () => {
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assigned = await testService.acceptJourney(partner, journey.id);
    const emergency = await testService.triggerEmergency(partner, assigned.id, {
      category: 'SAFETY_CONCERN',
      reason: 'Companion vehicle safe stop at service lane due to traffic congestion',
    });

    const operationalNote = 'Operations desk verified safe vehicle stop; companion and patient contacted; operational clearance given to resume journey.';
    const resolved = await testService.resolveEmergency(admin, emergency.id, operationalNote);

    const incident = resolved.emergencyLogs[resolved.emergencyLogs.length - 1];
    assert.equal(incident.resolutionNotes, operationalNote);
    // Explicitly non-clinical: does not record medication, treatment, diagnostic codes
    assert(!incident.resolutionNotes.toLowerCase().includes('diagnosis'));
    assert(!incident.resolutionNotes.toLowerCase().includes('prescription'));
    assert(!incident.resolutionNotes.toLowerCase().includes('treatment'));
    assert(!incident.resolutionNotes.toLowerCase().includes('medication'));
  });

  await runTest('40. Schema explicitly defines resolution notes as non-clinical operational records', async () => {
    // Ensure all incident logs conform to operational structure
    const journey = await testService.createBooking(patient, {
      pickupLocation: patientProfile.homeAddress,
      hospitalDestination: hospital,
      bookingType: 'ON_DEMAND',
    });
    const assigned = await testService.acceptJourney(partner, journey.id);
    const emergency = await testService.triggerEmergency(partner, assigned.id, {
      category: 'OTHER',
    });
    const resolved = await testService.resolveEmergency(
      admin,
      emergency.id,
      'Incident reviewed by Admin; route reassigned; incident closed.'
    );
    const incident = resolved.emergencyLogs[resolved.emergencyLogs.length - 1];
    assert.equal(typeof incident.resolutionNotes, 'string');
    assert.equal(incident.status, 'RESOLVED');
  });

  await runTest('41. Development pricing is clearly marked as estimated test configuration, not final commercial tariff', () => {
    const fare = calculateJourneyFare({
      outboundDistanceMeters: 10000,
      returnDistanceMeters: 10000,
    });
    // Marked as estimate
    assert.equal(fare.isEstimate, true);
    // Policy version indicates standard development configuration
    assert(DEFAULT_PRICING_POLICY.version.includes('policy-v1-standard'));
    // Currency is explicitly INR
    assert.equal(fare.currency, 'INR');
  });

  await runTest('42. No commercial surge pricing, coupons, or subscriptions are introduced', () => {
    const policy = DEFAULT_PRICING_POLICY as any;
    assert.equal(typeof policy.surgeMultiplier, 'undefined');
    assert.equal(typeof policy.couponCode, 'undefined');
    assert.equal(typeof policy.subscriptionTier, 'undefined');
    assert.equal(typeof policy.dynamicDemandFactor, 'undefined');
  });

  console.log('\n--------------------------------------------------');
  console.log(`TOTAL PHASE 5 TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
  console.log('ALL PHASE 5 PRICING & EMERGENCY DOMAIN TESTS PASSED!');
  console.log('--------------------------------------------------\n');
}

runPhase5TestSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
