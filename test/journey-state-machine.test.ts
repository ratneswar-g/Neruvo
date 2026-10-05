import assert from 'node:assert/strict';
import {
  createRoundTripJourney,
  transitionJourney,
  validateStateTransition,
  restoreFromEmergency,
  DomainError,
  Location,
  HospitalDestination,
  Journey,
} from '../src/domain/index.ts';

// Test Fixtures
const homeLocation: Location = {
  latitude: 12.9716,
  longitude: 77.5946,
  address: '104 Sunrise Apts, 4th Main, Indiranagar, Bengaluru',
  landmark: 'Near Indiranagar Metro Station',
  accessInstructions: 'Elevator available, ground floor ramp.',
};

const hospitalDestination: HospitalDestination = {
  id: 'hosp-apollo',
  name: 'Apollo Medical Center',
  address: '21 Greams Lane, Thousand Lights, Chennai',
  latitude: 13.0604,
  longitude: 80.2496,
  entranceOrDepartment: 'Main Outpatient Pavilion Gate 2',
  accessNotes: 'Wheelchair assistance bay at entrance',
};

let testCount = 0;
let passCount = 0;

function runTest(name: string, fn: () => void) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✓ [TEST ${testCount}] ${name}`);
  } catch (err: any) {
    console.error(`  ✗ [TEST ${testCount} FAILED] ${name}`);
    console.error(err);
    throw err;
  }
}

console.log('\n==================================================');
console.log('NERAVU PHASE 1: JOURNEY STATE ENGINE TEST SUITE');
console.log('==================================================\n');

// 1. DRAFT → REQUESTED
runTest('DRAFT → REQUESTED transitions successfully', () => {
  const journey = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  assert.equal(journey.currentState, 'DRAFT');

  const requested = transitionJourney(journey, 'REQUESTED', {
    triggeredByUserId: 'patient-101',
    note: 'Patient initiated companion request',
  });
  assert.equal(requested.currentState, 'REQUESTED');
});

// 2. REQUESTED → MATCHING
runTest('REQUESTED → MATCHING transitions successfully', () => {
  const journey = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  const requested = transitionJourney(journey, 'REQUESTED', {
    triggeredByUserId: 'patient-101',
  });
  const matching = transitionJourney(requested, 'MATCHING', {
    triggeredByUserId: 'system',
    note: 'Searching for nearest qualified Care Partner',
  });
  assert.equal(matching.currentState, 'MATCHING');
});

// 3. MATCHING → PARTNER_ASSIGNED
runTest('MATCHING → PARTNER_ASSIGNED assigns Care Partner and records ID', () => {
  const journey = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  const requested = transitionJourney(journey, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  const matching = transitionJourney(requested, 'MATCHING', { triggeredByUserId: 'system' });

  const assigned = transitionJourney(matching, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
    note: 'Care Partner Ramesh Kumar accepted assignment',
  });
  assert.equal(assigned.currentState, 'PARTNER_ASSIGNED');
  assert.equal(assigned.carePartnerId, 'partner-909');
});

// 4. PARTNER_ASSIGNED → PARTNER_EN_ROUTE
runTest('PARTNER_ASSIGNED → PARTNER_EN_ROUTE transitions successfully', () => {
  const journey = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  const requested = transitionJourney(journey, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  const matching = transitionJourney(requested, 'MATCHING', { triggeredByUserId: 'system' });
  const assigned = transitionJourney(matching, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });

  const enRoute = transitionJourney(assigned, 'PARTNER_EN_ROUTE', {
    triggeredByUserId: 'partner-909',
    note: 'Navigating to patient residence',
  });
  assert.equal(enRoute.currentState, 'PARTNER_EN_ROUTE');
});

// 5. PARTNER_EN_ROUTE → PARTNER_ARRIVED
runTest('PARTNER_EN_ROUTE → PARTNER_ARRIVED transitions successfully', () => {
  const journey = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  let state = transitionJourney(journey, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });

  const arrived = transitionJourney(state, 'PARTNER_ARRIVED', {
    triggeredByUserId: 'partner-909',
    note: 'Arrived at patient gate',
  });
  assert.equal(arrived.currentState, 'PARTNER_ARRIVED');
});

// 6. PARTNER_ARRIVED → PATIENT_PICKED_UP
runTest('PARTNER_ARRIVED → PATIENT_PICKED_UP transitions successfully', () => {
  const journey = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  let state = transitionJourney(journey, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });

  const pickedUp = transitionJourney(state, 'PATIENT_PICKED_UP', {
    triggeredByUserId: 'partner-909',
    note: 'Patient met at doorway and assisted into vehicle',
  });
  assert.equal(pickedUp.currentState, 'PATIENT_PICKED_UP');
});

// 7. PATIENT_PICKED_UP → IN_TRANSIT_TO_HOSPITAL
runTest('PATIENT_PICKED_UP → IN_TRANSIT_TO_HOSPITAL transitions successfully (Leg 1 Transit)', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });

  const inTransit = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', {
    triggeredByUserId: 'partner-909',
    note: 'En route to Apollo Medical Center',
  });
  assert.equal(inTransit.currentState, 'IN_TRANSIT_TO_HOSPITAL');
});

// 8. IN_TRANSIT_TO_HOSPITAL → ARRIVED_AT_HOSPITAL
runTest('IN_TRANSIT_TO_HOSPITAL → ARRIVED_AT_HOSPITAL transitions successfully', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });

  const arrivedHosp = transitionJourney(state, 'ARRIVED_AT_HOSPITAL', {
    triggeredByUserId: 'partner-909',
    note: 'Vehicle parked at Gate 2 drop-off bay',
  });
  assert.equal(arrivedHosp.currentState, 'ARRIVED_AT_HOSPITAL');
});

// 9. ARRIVED_AT_HOSPITAL → HOSPITAL_VISIT
runTest('ARRIVED_AT_HOSPITAL → HOSPITAL_VISIT transitions successfully (Care Partner stays with patient)', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'ARRIVED_AT_HOSPITAL', { triggeredByUserId: 'partner-909' });

  const hospVisit = transitionJourney(state, 'HOSPITAL_VISIT', {
    triggeredByUserId: 'partner-909',
    note: 'Accompanied patient into cardiology waiting lounge',
  });
  assert.equal(hospVisit.currentState, 'HOSPITAL_VISIT');
});

// 10. HOSPITAL_VISIT → RETURN_STARTED
runTest('HOSPITAL_VISIT → RETURN_STARTED transitions successfully', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'ARRIVED_AT_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'HOSPITAL_VISIT', { triggeredByUserId: 'partner-909' });

  const returnStarted = transitionJourney(state, 'RETURN_STARTED', {
    triggeredByUserId: 'partner-909',
    note: 'Consultation concluded, moving to vehicle for return leg',
  });
  assert.equal(returnStarted.currentState, 'RETURN_STARTED');
});

// 11. RETURN_STARTED → IN_TRANSIT_TO_HOME
runTest('RETURN_STARTED → IN_TRANSIT_TO_HOME transitions successfully (Leg 2 Transit)', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'ARRIVED_AT_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'HOSPITAL_VISIT', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'RETURN_STARTED', { triggeredByUserId: 'partner-909' });

  const inTransitHome = transitionJourney(state, 'IN_TRANSIT_TO_HOME', {
    triggeredByUserId: 'partner-909',
    note: 'Driving patient back to residence',
  });
  assert.equal(inTransitHome.currentState, 'IN_TRANSIT_TO_HOME');
});

// 12. IN_TRANSIT_TO_HOME → PATIENT_RETURNED_HOME
runTest('IN_TRANSIT_TO_HOME → PATIENT_RETURNED_HOME transitions successfully', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'ARRIVED_AT_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'HOSPITAL_VISIT', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'RETURN_STARTED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOME', { triggeredByUserId: 'partner-909' });

  const returnedHome = transitionJourney(state, 'PATIENT_RETURNED_HOME', {
    triggeredByUserId: 'partner-909',
    note: 'Arrived at home and assisted patient safely inside residence',
  });
  assert.equal(returnedHome.currentState, 'PATIENT_RETURNED_HOME');
});

// 13. PATIENT_RETURNED_HOME → COMPLETED
runTest('PATIENT_RETURNED_HOME → COMPLETED transitions successfully (Normal Completion)', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'ARRIVED_AT_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'HOSPITAL_VISIT', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'RETURN_STARTED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOME', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_RETURNED_HOME', { triggeredByUserId: 'partner-909' });

  const completed = transitionJourney(state, 'COMPLETED', {
    triggeredByUserId: 'partner-909',
    note: 'Round trip successfully finished. Patient safely home.',
  });
  assert.equal(completed.currentState, 'COMPLETED');
});

// 14. CRITICAL: HOSPITAL_VISIT → COMPLETED is rejected
runTest('CRITICAL RULE: HOSPITAL_VISIT → COMPLETED is rejected with HOSPITAL_VISIT_CANNOT_COMPLETE', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'ARRIVED_AT_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'HOSPITAL_VISIT', { triggeredByUserId: 'partner-909' });

  assert.throws(
    () => {
      transitionJourney(state, 'COMPLETED', { triggeredByUserId: 'partner-909' });
    },
    (err: any) => {
      assert(err instanceof DomainError);
      assert.equal(err.code, 'HOSPITAL_VISIT_CANNOT_COMPLETE');
      return true;
    }
  );

  const validation = validateStateTransition(state, 'COMPLETED');
  assert.equal(validation.allowed, false);
  assert.equal(validation.errorCode, 'HOSPITAL_VISIT_CANNOT_COMPLETE');
});

// 15. CRITICAL: ARRIVED_AT_HOSPITAL → COMPLETED is rejected
runTest('CRITICAL RULE: ARRIVED_AT_HOSPITAL → COMPLETED is rejected with ARRIVED_AT_HOSPITAL_CANNOT_COMPLETE', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'ARRIVED_AT_HOSPITAL', { triggeredByUserId: 'partner-909' });

  assert.throws(
    () => {
      transitionJourney(state, 'COMPLETED', { triggeredByUserId: 'partner-909' });
    },
    (err: any) => {
      assert(err instanceof DomainError);
      assert.equal(err.code, 'ARRIVED_AT_HOSPITAL_CANNOT_COMPLETE');
      return true;
    }
  );
});

// 16. Arbitrary invalid transitions are rejected
runTest('Arbitrary invalid transitions are rejected', () => {
  const journey = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });

  // DRAFT -> COMPLETED
  assert.throws(
    () => transitionJourney(journey, 'COMPLETED', { triggeredByUserId: 'patient-101' }),
    (err: any) => err.code === 'COMPLETION_REQUIRES_RETURN_HOME'
  );

  // DRAFT -> IN_TRANSIT_TO_HOSPITAL
  assert.throws(
    () => transitionJourney(journey, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'patient-101' }),
    (err: any) => err.code === 'INVALID_STATE_TRANSITION'
  );

  // MATCHING -> IN_TRANSIT_TO_HOME
  const matching = transitionJourney(
    transitionJourney(journey, 'REQUESTED', { triggeredByUserId: 'p' }),
    'MATCHING',
    { triggeredByUserId: 's' }
  );
  assert.throws(
    () => transitionJourney(matching, 'IN_TRANSIT_TO_HOME', { triggeredByUserId: 's' }),
    (err: any) => err.code === 'INVALID_STATE_TRANSITION'
  );
});

// 17. Every valid transition records its timestamp
runTest('Every valid transition records its timestamp', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });

  const t1 = '2026-10-03T10:00:00.000Z';
  const t2 = '2026-10-03T10:05:00.000Z';
  const t3 = '2026-10-03T10:10:00.000Z';

  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101', timestamp: t1 });
  assert.equal(state.stateTimestamps.REQUESTED, t1);

  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system', timestamp: t2 });
  assert.equal(state.stateTimestamps.MATCHING, t2);

  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'cp-1',
    timestamp: t3,
  });
  assert.equal(state.stateTimestamps.PARTNER_ASSIGNED, t3);

  // Verify stateHistory entries match
  assert.equal(state.stateHistory.length, 4); // Initial draft + 3 transitions
  assert.equal(state.stateHistory[1].toState, 'REQUESTED');
  assert.equal(state.stateHistory[1].timestamp, t1);
  assert.equal(state.stateHistory[2].toState, 'MATCHING');
  assert.equal(state.stateHistory[2].timestamp, t2);
  assert.equal(state.stateHistory[3].toState, 'PARTNER_ASSIGNED');
  assert.equal(state.stateHistory[3].timestamp, t3);
});

// 18. Booking remains the same booking throughout both journey legs
runTest('Booking remains the same booking throughout both journey legs', () => {
  const initial = createRoundTripJourney({
    id: 'single-roundtrip-booking-777',
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });

  let state = transitionJourney(initial, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'ARRIVED_AT_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'HOSPITAL_VISIT', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'RETURN_STARTED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOME', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_RETURNED_HOME', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'COMPLETED', { triggeredByUserId: 'partner-909' });

  // Assert single persistent identity throughout
  assert.equal(state.id, 'single-roundtrip-booking-777');
  assert.equal(state.patientId, 'patient-101');
  assert.equal(state.carePartnerId, 'partner-909');
});

// 19. Return destination is preserved
runTest('Return destination is preserved through all transitions', () => {
  const customReturnDropoff: Location = {
    latitude: 12.9800,
    longitude: 77.6000,
    address: 'Alternative Family Home, 12 Kensington Rd, Bengaluru',
  };

  const journey = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
    returnDropoffLocation: customReturnDropoff,
  });

  assert.equal(journey.returnDropoffLocation.address, customReturnDropoff.address);

  // Transition to hospital visit and return leg
  let state = transitionJourney(journey, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'ARRIVED_AT_HOSPITAL', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'HOSPITAL_VISIT', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'RETURN_STARTED', { triggeredByUserId: 'partner-909' });

  assert.equal(state.returnDropoffLocation.address, customReturnDropoff.address);
  assert.equal(state.returnDropoffLocation.latitude, customReturnDropoff.latitude);
});

// 20. Scheduled and on-demand bookings can both be represented
runTest('Scheduled and on-demand bookings are accurately represented in domain model', () => {
  const onDemand = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
    bookingType: 'ON_DEMAND',
  });
  assert.equal(onDemand.bookingType, 'ON_DEMAND');
  assert.equal(onDemand.scheduledPickupTime, undefined);

  const scheduled = createRoundTripJourney({
    patientId: 'patient-102',
    pickupLocation: homeLocation,
    hospitalDestination,
    bookingType: 'SCHEDULED',
    scheduledPickupTime: '2026-10-04T09:30:00.000Z',
  });
  assert.equal(scheduled.bookingType, 'SCHEDULED');
  assert.equal(scheduled.scheduledPickupTime, '2026-10-04T09:30:00.000Z');
});

// 21. Exceptional: Pre-pickup cancellation (CANCELLED)
runTest('Pre-pickup cancellation transitions to CANCELLED', () => {
  const journey = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  const requested = transitionJourney(journey, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  const cancelled = transitionJourney(requested, 'CANCELLED', {
    triggeredByUserId: 'patient-101',
    note: 'Patient doctor appointment was rescheduled',
  });
  assert.equal(cancelled.currentState, 'CANCELLED');

  // Once cancelled, no further transitions permitted
  assert.throws(
    () => transitionJourney(cancelled, 'MATCHING', { triggeredByUserId: 'system' }),
    (err: any) => err.code === 'BOOKING_ALREADY_TERMINATED'
  );
});

// 22. Exceptional: Partner withdrawal before pickup (PARTNER_CANCELLED)
runTest('Care Partner withdrawal before pickup sets PARTNER_CANCELLED and allows re-matching', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });

  const partnerCancelled = transitionJourney(state, 'PARTNER_CANCELLED', {
    triggeredByUserId: 'partner-909',
    note: 'Flat tire en route, unable to service journey',
  });
  assert.equal(partnerCancelled.currentState, 'PARTNER_CANCELLED');

  // Can be re-dispatched to matching
  const reMatching = transitionJourney(partnerCancelled, 'MATCHING', {
    triggeredByUserId: 'system',
    note: 'Auto-re-dispatching to find another Care Partner',
  });
  assert.equal(reMatching.currentState, 'MATCHING');
});

// 23. Exceptional: Emergency activation (EMERGENCY_ACTIVE) preserves previous state
runTest('EMERGENCY_ACTIVE preserves prior state and allows recovery', () => {
  let state = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  state = transitionJourney(state, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  state = transitionJourney(state, 'MATCHING', { triggeredByUserId: 'system' });
  state = transitionJourney(state, 'PARTNER_ASSIGNED', {
    triggeredByUserId: 'system',
    assignedCarePartnerId: 'partner-909',
  });
  state = transitionJourney(state, 'PARTNER_EN_ROUTE', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PARTNER_ARRIVED', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'PATIENT_PICKED_UP', { triggeredByUserId: 'partner-909' });
  state = transitionJourney(state, 'IN_TRANSIT_TO_HOSPITAL', { triggeredByUserId: 'partner-909' });

  // Activate emergency
  const emergency = transitionJourney(state, 'EMERGENCY_ACTIVE', {
    triggeredByUserId: 'partner-909',
    note: 'Patient feeling sudden dizziness in transit',
  });
  assert.equal(emergency.currentState, 'EMERGENCY_ACTIVE');
  assert.equal(emergency.previousStateBeforeEmergency, 'IN_TRANSIT_TO_HOSPITAL');

  // Restore when cleared
  const restored = restoreFromEmergency(emergency, {
    triggeredByUserId: 'admin-operations-1',
    note: 'Vitals stabilized by nearby EMT, resuming transit',
  });
  assert.equal(restored.currentState, 'IN_TRANSIT_TO_HOSPITAL');
  assert.equal(restored.previousStateBeforeEmergency, undefined);
});

// 24. Partner Assignment requires partnerId
runTest('Transition to PARTNER_ASSIGNED without partnerId is rejected', () => {
  const journey = createRoundTripJourney({
    patientId: 'patient-101',
    pickupLocation: homeLocation,
    hospitalDestination,
  });
  const requested = transitionJourney(journey, 'REQUESTED', { triggeredByUserId: 'patient-101' });
  const matching = transitionJourney(requested, 'MATCHING', { triggeredByUserId: 'system' });

  assert.throws(
    () => transitionJourney(matching, 'PARTNER_ASSIGNED', { triggeredByUserId: 'system' }),
    (err: any) => {
      assert.equal(err.code, 'PARTNER_NOT_ASSIGNED');
      return true;
    }
  );
});

console.log('\n--------------------------------------------------');
console.log(`TOTAL TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
console.log('ALL DOMAIN & JOURNEY STATE MACHINE TESTS PASSED!');
console.log('--------------------------------------------------\n');
