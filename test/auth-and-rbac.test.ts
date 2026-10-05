import assert from 'node:assert/strict';
import {
  DevelopmentAuthProvider,
  authorizeAction,
  canAccessRoute,
  DEV_IDENTITIES,
  AuthUser,
} from '../src/auth/index.ts';
import {
  createRoundTripJourney,
  Location,
  HospitalDestination,
  Journey,
  TrustedContact,
} from '../src/domain/index.ts';

// Test Fixtures
const homeLocation: Location = {
  latitude: 12.9716,
  longitude: 77.5946,
  address: '104 Sunrise Apts, Indiranagar, Bengaluru',
};

const hospitalDestination: HospitalDestination = {
  id: 'hosp-apollo',
  name: 'Apollo Medical Center',
  address: '21 Greams Lane, Chennai',
  latitude: 13.0604,
  longitude: 80.2496,
};

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

async function runTestSuite() {
  console.log('\n==================================================');
  console.log('NERAVU PHASE 2: AUTHENTICATION & RBAC TEST SUITE');
  console.log('==================================================\n');

  // 1. Unauthenticated state is correctly represented
  await runTest('1. Unauthenticated state is correctly represented', async () => {
    const authProvider = new DevelopmentAuthProvider();
    const session = await authProvider.getCurrentSession();
    const user = await authProvider.getCurrentUser();
    assert.equal(session, null);
    assert.equal(user, null);
  });

  // 2. Patient development login succeeds
  await runTest('2. Patient development login succeeds', async () => {
    const authProvider = new DevelopmentAuthProvider();
    const session = await authProvider.loginAsDevRole('PATIENT');
    assert(session);
    assert.equal(session.user.role, 'PATIENT');
    assert.equal(session.user.id, DEV_IDENTITIES.PATIENT.id);
    assert.equal(session.isDevelopmentSession, true);
    assert(session.token.startsWith('dev-session-'));
  });

  // 3. Care Partner development login succeeds
  await runTest('3. Care Partner development login succeeds', async () => {
    const authProvider = new DevelopmentAuthProvider();
    const session = await authProvider.loginAsDevRole('CARE_PARTNER');
    assert(session);
    assert.equal(session.user.role, 'CARE_PARTNER');
    assert.equal(session.user.id, DEV_IDENTITIES.CARE_PARTNER.id);
  });

  // 4. Family Contact development login succeeds
  await runTest('4. Family Contact development login succeeds', async () => {
    const authProvider = new DevelopmentAuthProvider();
    const session = await authProvider.loginAsDevRole('FAMILY_CONTACT');
    assert(session);
    assert.equal(session.user.role, 'FAMILY_CONTACT');
    assert.equal(session.user.id, DEV_IDENTITIES.FAMILY_CONTACT.id);
  });

  // 5. Admin development login succeeds
  await runTest('5. Admin development login succeeds', async () => {
    const authProvider = new DevelopmentAuthProvider();
    const session = await authProvider.loginAsDevRole('ADMIN');
    assert(session);
    assert.equal(session.user.role, 'ADMIN');
    assert.equal(session.user.id, DEV_IDENTITIES.ADMIN.id);
  });

  // 6. Logout clears the session
  await runTest('6. Logout clears the session', async () => {
    const authProvider = new DevelopmentAuthProvider();
    await authProvider.loginAsDevRole('PATIENT');
    assert(await authProvider.getCurrentUser());

    await authProvider.logout();
    assert.equal(await authProvider.getCurrentSession(), null);
    assert.equal(await authProvider.getCurrentUser(), null);
  });

  // 7. Session restoration works
  await runTest('7. Session restoration works with active session duration', async () => {
    const authProvider = new DevelopmentAuthProvider(24);
    const session = await authProvider.loginAsDevRole('CARE_PARTNER');
    const restored = await authProvider.restoreSession();
    assert(restored);
    assert.equal(restored.user.id, session.user.id);
  });

  // 8. Invalid development identity is rejected
  await runTest('8. Invalid development identity is rejected', async () => {
    const authProvider = new DevelopmentAuthProvider();
    await assert.rejects(
      async () => {
        await authProvider.loginAsDevRole('HOSPITAL_APPROVER' as any);
      },
      /Invalid development role requested/
    );
  });

  // AUTHORIZATION & IDOR TESTS

  // 9. Patient can access own protected operations
  await runTest('9. Patient can access own protected operations', () => {
    const patientUser: AuthUser = DEV_IDENTITIES.PATIENT;
    const ownJourney = createRoundTripJourney({
      id: 'j-patient-1',
      patientId: patientUser.id,
      pickupLocation: homeLocation,
      hospitalDestination,
    });

    const createAuth = authorizeAction(patientUser, 'CREATE_JOURNEY');
    assert.equal(createAuth.authorized, true);

    const viewOwnJourneyAuth = authorizeAction(patientUser, 'VIEW_JOURNEY', {
      journey: ownJourney,
    });
    assert.equal(viewOwnJourneyAuth.authorized, true);

    const viewOwnProfileAuth = authorizeAction(patientUser, 'VIEW_PATIENT_PROFILE', {
      patientId: patientUser.id,
    });
    assert.equal(viewOwnProfileAuth.authorized, true);
  });

  // 10. Patient cannot access another patient's journey (IDOR protection)
  await runTest("10. Patient cannot access another patient's journey (IDOR protection)", () => {
    const patientA: AuthUser = DEV_IDENTITIES.PATIENT;
    const patientBJourney = createRoundTripJourney({
      id: 'j-patient-B',
      patientId: 'dev-user-patient-2', // Different patient
      pickupLocation: homeLocation,
      hospitalDestination,
    });

    const idorCheck = authorizeAction(patientA, 'VIEW_JOURNEY', {
      journey: patientBJourney,
    });
    assert.equal(idorCheck.authorized, false);
    assert.equal(idorCheck.code, 'IDOR_VIOLATION');

    const profileIdorCheck = authorizeAction(patientA, 'VIEW_PATIENT_PROFILE', {
      patientId: 'dev-user-patient-2',
    });
    assert.equal(profileIdorCheck.authorized, false);
    assert.equal(profileIdorCheck.code, 'IDOR_VIOLATION');
  });

  // 11. Care Partner can access assigned journeys
  await runTest('11. Care Partner can access assigned journeys', () => {
    const partnerUser: AuthUser = DEV_IDENTITIES.CARE_PARTNER;
    const assignedJourney = createRoundTripJourney({
      id: 'j-assigned-partner-1',
      patientId: 'dev-user-patient-1',
      pickupLocation: homeLocation,
      hospitalDestination,
    });
    assignedJourney.carePartnerId = partnerUser.id;

    const accessResult = authorizeAction(partnerUser, 'VIEW_JOURNEY', {
      journey: assignedJourney,
    });
    assert.equal(accessResult.authorized, true);

    const milestoneResult = authorizeAction(partnerUser, 'UPDATE_JOURNEY_MILESTONE', {
      journey: assignedJourney,
    });
    assert.equal(milestoneResult.authorized, true);
  });

  // 12. Care Partner cannot access another partner's private journey (IDOR protection)
  await runTest("12. Care Partner cannot access another partner's private journey", () => {
    const partnerA: AuthUser = DEV_IDENTITIES.CARE_PARTNER;
    const partnerBJourney = createRoundTripJourney({
      id: 'j-partner-B-active',
      patientId: 'dev-user-patient-1',
      pickupLocation: homeLocation,
      hospitalDestination,
    });
    partnerBJourney.carePartnerId = 'dev-user-partner-2'; // Assigned to Partner B
    partnerBJourney.currentState = 'IN_TRANSIT_TO_HOSPITAL';

    const idorCheck = authorizeAction(partnerA, 'VIEW_JOURNEY', {
      journey: partnerBJourney,
    });
    assert.equal(idorCheck.authorized, false);
    assert.equal(idorCheck.code, 'IDOR_VIOLATION');
  });

  // 13. Family Contact can access an explicitly authorized patient
  await runTest('13. Family Contact can access an explicitly authorized patient', () => {
    const familyUser: AuthUser = DEV_IDENTITIES.FAMILY_CONTACT;
    const patientJourney = createRoundTripJourney({
      id: 'j-patient-1',
      patientId: DEV_IDENTITIES.PATIENT.id,
      pickupLocation: homeLocation,
      hospitalDestination,
    });

    const trustedContacts: TrustedContact[] = [
      {
        id: 'tc-1',
        patientId: DEV_IDENTITIES.PATIENT.id,
        contactUserId: familyUser.id,
        contactName: familyUser.name,
        contactPhone: familyUser.phone,
        relationship: 'Son',
        permissionLevel: 'FULL_STATUS',
        createdAt: new Date().toISOString(),
      },
    ];

    const authCheck = authorizeAction(familyUser, 'VIEW_JOURNEY', {
      journey: patientJourney,
      trustedContacts,
    });
    assert.equal(authCheck.authorized, true);
  });

  // 14. Family Contact cannot access an unauthorized patient
  await runTest('14. Family Contact cannot access an unauthorized patient', () => {
    const familyUser: AuthUser = DEV_IDENTITIES.FAMILY_CONTACT;
    const unlinkedJourney = createRoundTripJourney({
      id: 'j-stranger-patient',
      patientId: 'stranger-patient-999',
      pickupLocation: homeLocation,
      hospitalDestination,
    });

    // Empty trusted contacts for stranger
    const authCheck = authorizeAction(familyUser, 'VIEW_JOURNEY', {
      journey: unlinkedJourney,
      trustedContacts: [],
    });
    assert.equal(authCheck.authorized, false);
    assert.equal(authCheck.code, 'IDOR_VIOLATION');
  });

  // 15. Family Contact cannot modify journey state (read-only restriction)
  await runTest('15. Family Contact cannot modify journey state', () => {
    const familyUser: AuthUser = DEV_IDENTITIES.FAMILY_CONTACT;
    const modifyCheck = authorizeAction(familyUser, 'UPDATE_JOURNEY_MILESTONE');
    assert.equal(modifyCheck.authorized, false);
    assert.equal(modifyCheck.code, 'READ_ONLY_ACCESS');

    const cancelCheck = authorizeAction(familyUser, 'CANCEL_JOURNEY');
    assert.equal(cancelCheck.authorized, false);
    assert.equal(cancelCheck.code, 'READ_ONLY_ACCESS');
  });

  // 16. Admin can access authorized operational functions
  await runTest('16. Admin can access authorized operational functions', () => {
    const adminUser: AuthUser = DEV_IDENTITIES.ADMIN;
    assert.equal(authorizeAction(adminUser, 'ACCESS_ADMIN_OPERATIONS').authorized, true);
    assert.equal(authorizeAction(adminUser, 'MANAGE_USERS').authorized, true);
    assert.equal(authorizeAction(adminUser, 'MANAGE_CARE_PARTNERS').authorized, true);
    assert.equal(authorizeAction(adminUser, 'DISPATCH_JOURNEY').authorized, true);
  });

  // 17. Non-admin cannot access admin functions
  await runTest('17. Non-admin cannot access admin functions', () => {
    const patientUser: AuthUser = DEV_IDENTITIES.PATIENT;
    const partnerUser: AuthUser = DEV_IDENTITIES.CARE_PARTNER;
    const familyUser: AuthUser = DEV_IDENTITIES.FAMILY_CONTACT;

    assert.equal(authorizeAction(patientUser, 'ACCESS_ADMIN_OPERATIONS').authorized, false);
    assert.equal(authorizeAction(partnerUser, 'ACCESS_ADMIN_OPERATIONS').authorized, false);
    assert.equal(authorizeAction(familyUser, 'ACCESS_ADMIN_OPERATIONS').authorized, false);

    assert.equal(authorizeAction(patientUser, 'MANAGE_CARE_PARTNERS').authorized, false);
    assert.equal(authorizeAction(partnerUser, 'DISPATCH_JOURNEY').authorized, false);
  });

  // ROUTE / VIEW GUARD TESTS

  // 18. Unauthenticated users cannot access protected areas
  await runTest('18. Unauthenticated users cannot access protected areas', () => {
    const patientRoute = canAccessRoute(null, '/patient/home');
    assert.equal(patientRoute.allowed, false);
    assert.equal(patientRoute.redirectTo, '/login');

    const adminRoute = canAccessRoute(null, '/admin/overview');
    assert.equal(adminRoute.allowed, false);
    assert.equal(adminRoute.redirectTo, '/login');
  });

  // 19. Patient cannot enter Care Partner protected area
  await runTest('19. Patient cannot enter Care Partner protected area', () => {
    const patientUser: AuthUser = DEV_IDENTITIES.PATIENT;
    const guard = canAccessRoute(patientUser, '/care-partner/dashboard');
    assert.equal(guard.allowed, false);
    assert.equal(guard.redirectTo, '/patient/home');
  });

  // 20. Care Partner cannot enter Admin protected area
  await runTest('20. Care Partner cannot enter Admin protected area', () => {
    const partnerUser: AuthUser = DEV_IDENTITIES.CARE_PARTNER;
    const guard = canAccessRoute(partnerUser, '/admin/overview');
    assert.equal(guard.allowed, false);
    assert.equal(guard.redirectTo, '/care-partner/dashboard');
  });

  // 21. Family Contact cannot enter Admin protected area
  await runTest('21. Family Contact cannot enter Admin protected area', () => {
    const familyUser: AuthUser = DEV_IDENTITIES.FAMILY_CONTACT;
    const guard = canAccessRoute(familyUser, '/admin/overview');
    assert.equal(guard.allowed, false);
    assert.equal(guard.redirectTo, '/family/tracking');
  });

  // SECURITY TESTS

  // 22. Authorization cannot be bypassed by changing a frontend route
  await runTest('22. Authorization cannot be bypassed by changing a frontend route', () => {
    const patientUser: AuthUser = DEV_IDENTITIES.PATIENT;
    // Suppose a patient tricks the UI into loading an admin view or calls the admin action directly
    const backendAuth = authorizeAction(patientUser, 'ACCESS_ADMIN_OPERATIONS');
    assert.equal(backendAuth.authorized, false);
    assert.equal(backendAuth.code, 'FORBIDDEN_ROLE');
  });

  // 23. User identity comes from the authenticated session
  await runTest('23. User identity comes from the authenticated session', async () => {
    const authProvider = new DevelopmentAuthProvider();
    await authProvider.loginAsDevRole('CARE_PARTNER');
    const current = await authProvider.getCurrentUser();
    assert(current);
    assert.equal(current.id, DEV_IDENTITIES.CARE_PARTNER.id);
    assert.equal(current.role, 'CARE_PARTNER');
  });

  // 24. Development authentication cannot be mistaken for production OTP
  await runTest('24. Development authentication cannot be mistaken for production OTP', async () => {
    const authProvider = new DevelopmentAuthProvider();
    const session = await authProvider.loginAsDevRole('ADMIN');
    assert.equal(session.isDevelopmentSession, true);
    assert(session.token.startsWith('dev-session-'));
    // Explicit check that token cannot be an opaque production JWT
    assert(!session.token.startsWith('eyJ'));
  });

  console.log('\n--------------------------------------------------');
  console.log(`TOTAL PHASE 2 TESTS: ${testCount} | PASSED: ${passCount} | FAILED: 0`);
  console.log('ALL AUTHENTICATION, RBAC & GUARD TESTS PASSED!');
  console.log('--------------------------------------------------\n');
}

runTestSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
