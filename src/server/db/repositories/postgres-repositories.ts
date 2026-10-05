import {
  User,
  PatientProfile,
  CarePartnerProfile,
  HospitalDestination,
  Journey,
  EmergencyLogRecord,
} from '../../../domain/types/index.ts';
import {
  IUserRepository,
  IPatientProfileRepository,
  ICarePartnerProfileRepository,
  IHospitalRepository,
  IJourneyRepository,
  IDomainStore,
} from '../../../domain/storage/repository.ts';
import { DomainError } from '../../../domain/types/errors.ts';
import { IServerDatabaseDriver, InMemoryRelationalDriver, PostgresDatabaseDriver } from '../driver.ts';

export class PostgresUserRepository implements IUserRepository {
  constructor(private driver: IServerDatabaseDriver) {}

  async findById(id: string): Promise<User | null> {
    if (!id) return null;
    if (this.driver instanceof InMemoryRelationalDriver) {
      const row = this.driver.getTable('users').get(id);
      return row ? (row as unknown as User) : null;
    }
    const rows = await this.driver.query<any>('SELECT * FROM users WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      phone: r.phone,
      name: r.name,
      role: r.role,
      status: r.status,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    };
  }

  async findByPhone(phone: string): Promise<User | null> {
    if (!phone) return null;
    if (this.driver instanceof InMemoryRelationalDriver) {
      for (const row of this.driver.getTable('users').values()) {
        if (row.phone === phone) return row as unknown as User;
      }
      return null;
    }
    const rows = await this.driver.query<any>('SELECT * FROM users WHERE phone = $1', [phone]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      phone: r.phone,
      name: r.name,
      role: r.role,
      status: r.status,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    };
  }

  async save(user: User): Promise<User> {
    if (!user || !user.id) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'User must have a valid non-empty id');
    }
    const now = new Date().toISOString();
    const updated: User = { ...user, updatedAt: now, createdAt: user.createdAt || now };

    if (this.driver instanceof InMemoryRelationalDriver) {
      this.driver.getTable('users').set(user.id, updated as unknown as Record<string, unknown>);
      return updated;
    }

    await this.driver.execute(
      `INSERT INTO users (id, phone, name, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         phone = EXCLUDED.phone,
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         status = EXCLUDED.status,
         updated_at = EXCLUDED.updated_at`,
      [updated.id, updated.phone, updated.name, updated.role, updated.status, updated.createdAt, updated.updatedAt]
    );

    return updated;
  }

  async findAll(): Promise<User[]> {
    if (this.driver instanceof InMemoryRelationalDriver) {
      return Array.from(this.driver.getTable('users').values()) as unknown as User[];
    }
    const rows = await this.driver.query<any>('SELECT * FROM users ORDER BY created_at ASC');
    return rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      name: r.name,
      role: r.role,
      status: r.status,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    }));
  }
}

export class PostgresPatientProfileRepository implements IPatientProfileRepository {
  constructor(private driver: IServerDatabaseDriver) {}

  async findByUserId(userId: string): Promise<PatientProfile | null> {
    if (!userId) return null;
    if (this.driver instanceof InMemoryRelationalDriver) {
      const row = this.driver.getTable('patient_profiles').get(userId);
      return row ? (row as unknown as PatientProfile) : null;
    }
    const rows = await this.driver.query<any>('SELECT * FROM patient_profiles WHERE user_id = $1', [userId]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      userId: r.user_id,
      homeAddress: typeof r.home_address === 'string' ? JSON.parse(r.home_address) : r.home_address,
      mobilityAssistance: ['INDEPENDENT_WALKER'],
      nonClinicalAssistanceNotes: r.mobility_notes || '',
      trustedContacts: [],
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    };
  }

  async save(profile: PatientProfile): Promise<PatientProfile> {
    if (!profile || !profile.userId) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'PatientProfile must have a valid userId');
    }
    const now = new Date().toISOString();
    const updated: PatientProfile = { ...profile, updatedAt: now, createdAt: profile.createdAt || now };

    if (this.driver instanceof InMemoryRelationalDriver) {
      this.driver.getTable('patient_profiles').set(profile.userId, updated as unknown as Record<string, unknown>);
      return updated;
    }

    await this.driver.execute(
      `INSERT INTO patient_profiles (user_id, home_address, mobility_notes, preferred_hospital_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         home_address = EXCLUDED.home_address,
         mobility_notes = EXCLUDED.mobility_notes,
         updated_at = EXCLUDED.updated_at`,
      [
        updated.userId,
        JSON.stringify(updated.homeAddress),
        updated.nonClinicalAssistanceNotes || null,
        null,
        updated.createdAt,
        updated.updatedAt,
      ]
    );

    return updated;
  }

  async findAll(): Promise<PatientProfile[]> {
    if (this.driver instanceof InMemoryRelationalDriver) {
      return Array.from(this.driver.getTable('patient_profiles').values()) as unknown as PatientProfile[];
    }
    const rows = await this.driver.query<any>('SELECT * FROM patient_profiles ORDER BY created_at ASC');
    return rows.map((r) => ({
      userId: r.user_id,
      homeAddress: typeof r.home_address === 'string' ? JSON.parse(r.home_address) : r.home_address,
      mobilityAssistance: ['INDEPENDENT_WALKER'],
      nonClinicalAssistanceNotes: r.mobility_notes || '',
      trustedContacts: [],
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    }));
  }
}

export class PostgresCarePartnerProfileRepository implements ICarePartnerProfileRepository {
  constructor(private driver: IServerDatabaseDriver) {}

  async findByUserId(userId: string): Promise<CarePartnerProfile | null> {
    if (!userId) return null;
    if (this.driver instanceof InMemoryRelationalDriver) {
      const row = this.driver.getTable('care_partner_profiles').get(userId);
      return row ? (row as unknown as CarePartnerProfile) : null;
    }
    const rows = await this.driver.query<any>('SELECT * FROM care_partner_profiles WHERE user_id = $1', [userId]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      userId: r.user_id,
      verificationStatus: r.verification_status,
      availabilityStatus: r.availability_status,
      vehicle: {
        make: '[DEMO] Maruti Suzuki',
        model: r.vehicle_type || 'Ertiga',
        year: 2023,
        color: 'Silver',
        licensePlate: r.vehicle_registration || 'KA 03 DEMO 4821',
        isWheelchairAccessible: true,
        seatingCapacity: 6,
      },
      totalJourneysCompleted: 10,
      ratingAverage: 5.0,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    };
  }

  async findAvailable(): Promise<CarePartnerProfile[]> {
    if (this.driver instanceof InMemoryRelationalDriver) {
      const all = Array.from(this.driver.getTable('care_partner_profiles').values()) as unknown as CarePartnerProfile[];
      return all.filter((p) => p.availabilityStatus === 'AVAILABLE' && p.verificationStatus === 'VERIFIED');
    }
    const rows = await this.driver.query<any>(
      "SELECT * FROM care_partner_profiles WHERE availability_status = 'AVAILABLE' AND verification_status = 'VERIFIED'"
    );
    return rows.map((r) => ({
      userId: r.user_id,
      verificationStatus: r.verification_status,
      availabilityStatus: r.availability_status,
      vehicle: {
        make: '[DEMO] Maruti Suzuki',
        model: r.vehicle_type || 'Ertiga',
        year: 2023,
        color: 'Silver',
        licensePlate: r.vehicle_registration || 'KA 03 DEMO 4821',
        isWheelchairAccessible: true,
        seatingCapacity: 6,
      },
      totalJourneysCompleted: 10,
      ratingAverage: 5.0,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    }));
  }

  async save(profile: CarePartnerProfile): Promise<CarePartnerProfile> {
    if (!profile || !profile.userId) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'CarePartnerProfile must have a valid userId');
    }
    const now = new Date().toISOString();
    const updated: CarePartnerProfile = { ...profile, updatedAt: now, createdAt: profile.createdAt || now };

    if (this.driver instanceof InMemoryRelationalDriver) {
      this.driver.getTable('care_partner_profiles').set(profile.userId, updated as unknown as Record<string, unknown>);
      return updated;
    }

    await this.driver.execute(
      `INSERT INTO care_partner_profiles (user_id, languages_spoken, vehicle_type, vehicle_registration, verification_status, availability_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET
         vehicle_type = EXCLUDED.vehicle_type,
         vehicle_registration = EXCLUDED.vehicle_registration,
         verification_status = EXCLUDED.verification_status,
         availability_status = EXCLUDED.availability_status,
         updated_at = EXCLUDED.updated_at`,
      [
        updated.userId,
        [],
        updated.vehicle?.model || null,
        updated.vehicle?.licensePlate || null,
        updated.verificationStatus,
        updated.availabilityStatus,
        updated.createdAt,
        updated.updatedAt,
      ]
    );

    return updated;
  }

  async findAll(): Promise<CarePartnerProfile[]> {
    if (this.driver instanceof InMemoryRelationalDriver) {
      return Array.from(this.driver.getTable('care_partner_profiles').values()) as unknown as CarePartnerProfile[];
    }
    const rows = await this.driver.query<any>('SELECT * FROM care_partner_profiles ORDER BY created_at ASC');
    return rows.map((r) => ({
      userId: r.user_id,
      verificationStatus: r.verification_status,
      availabilityStatus: r.availability_status,
      vehicle: {
        make: '[DEMO] Maruti Suzuki',
        model: r.vehicle_type || 'Ertiga',
        year: 2023,
        color: 'Silver',
        licensePlate: r.vehicle_registration || 'KA 03 DEMO 4821',
        isWheelchairAccessible: true,
        seatingCapacity: 6,
      },
      totalJourneysCompleted: 10,
      ratingAverage: 5.0,
      createdAt: r.created_at?.toISOString?.() || r.created_at,
      updatedAt: r.updated_at?.toISOString?.() || r.updated_at,
    }));
  }
}

export class PostgresHospitalRepository implements IHospitalRepository {
  constructor(private driver: IServerDatabaseDriver) {}

  async findById(id: string): Promise<HospitalDestination | null> {
    if (!id) return null;
    if (this.driver instanceof InMemoryRelationalDriver) {
      const row = this.driver.getTable('hospitals').get(id);
      return row ? (row as unknown as HospitalDestination) : null;
    }
    const rows = await this.driver.query<any>('SELECT * FROM hospitals WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      address: r.address,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      entranceOrDepartment: r.entrance_or_department,
      accessNotes: r.access_notes,
      emergencyContactPhone: r.emergency_contact_phone,
    };
  }

  private seeded = false;

  async findAll(): Promise<HospitalDestination[]> {
    if (this.driver instanceof InMemoryRelationalDriver) {
      let all = Array.from(this.driver.getTable('hospitals').values()) as unknown as HospitalDestination[];
      if (all.length === 0 && !this.seeded) {
        this.seeded = true;
        await this.seedDefaults();
        all = Array.from(this.driver.getTable('hospitals').values()) as unknown as HospitalDestination[];
      }
      return all;
    }
    const rows = await this.driver.query<any>('SELECT * FROM hospitals ORDER BY name ASC');
    if (rows.length === 0 && !this.seeded) {
      this.seeded = true;
      await this.seedDefaults();
      const newRows = await this.driver.query<any>('SELECT * FROM hospitals ORDER BY name ASC');
      return newRows.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        latitude: Number(r.latitude),
        longitude: Number(r.longitude),
        entranceOrDepartment: r.entrance_or_department,
        accessNotes: r.access_notes,
        emergencyContactPhone: r.emergency_contact_phone,
      }));
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      entranceOrDepartment: r.entrance_or_department,
      accessNotes: r.access_notes,
      emergencyContactPhone: r.emergency_contact_phone,
    }));
  }

  private async seedDefaults(): Promise<void> {
    const defaultHospitals: HospitalDestination[] = [
      {
        id: 'hosp-manipal',
        name: '[DEMO] Manipal Hospital (Sample Destination)',
        address: '[DEMO] 98 HAL Airport Road, Kodihalli, Bengaluru (Sample)',
        latitude: 12.9592,
        longitude: 77.6499,
        entranceOrDepartment: 'Specialty Clinic Pavilion (East Wing)',
        accessNotes: 'Companion assistance desk immediately inside.',
        emergencyContactPhone: undefined,
      },
      {
        id: 'hosp-apollo',
        name: '[DEMO] Apollo Hospital (Sample Destination)',
        address: '[DEMO] 154/11 Bannerghatta Main Rd, Bengaluru (Sample)',
        latitude: 12.8954,
        longitude: 77.5986,
        entranceOrDepartment: 'Outpatient Care Center (Gate 2)',
        accessNotes: 'Wheelchair access ramp at main lobby entrance.',
        emergencyContactPhone: undefined,
      },
    ];
    for (const h of defaultHospitals) {
      await this.save(h);
    }
  }

  async save(hospital: HospitalDestination): Promise<HospitalDestination> {
    if (!hospital || !hospital.id) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'Hospital must have a valid non-empty id');
    }
    if (this.driver instanceof InMemoryRelationalDriver) {
      this.driver.getTable('hospitals').set(hospital.id, hospital as unknown as Record<string, unknown>);
      return hospital;
    }

    await this.driver.execute(
      `INSERT INTO hospitals (id, name, address, latitude, longitude, entrance_or_department, access_notes, emergency_contact_phone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         address = EXCLUDED.address,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         entrance_or_department = EXCLUDED.entrance_or_department,
         access_notes = EXCLUDED.access_notes,
         emergency_contact_phone = EXCLUDED.emergency_contact_phone,
         updated_at = NOW()`,
      [
        hospital.id,
        hospital.name,
        hospital.address,
        hospital.latitude,
        hospital.longitude,
        hospital.entranceOrDepartment || null,
        hospital.accessNotes || null,
        hospital.emergencyContactPhone || null,
      ]
    );

    return hospital;
  }
}

export class PostgresJourneyRepository implements IJourneyRepository {
  constructor(private driver: IServerDatabaseDriver) {}

  async findById(id: string): Promise<Journey | null> {
    if (!id) return null;
    if (this.driver instanceof InMemoryRelationalDriver) {
      const row = this.driver.getTable('journeys').get(id);
      return row ? (row as unknown as Journey) : null;
    }

    const rows = await this.driver.query<any>('SELECT * FROM journeys WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    const jRow = rows[0];

    // Load related history
    const historyRows = await this.driver.query<any>(
      'SELECT * FROM journey_state_history WHERE journey_id = $1 ORDER BY timestamp ASC',
      [id]
    );
    const stateHistory = historyRows.map((h) => ({
      fromState: h.from_state,
      toState: h.to_state,
      timestamp: h.timestamp?.toISOString?.() || h.timestamp,
      triggeredByUserId: h.actor_user_id || 'system',
      notes: typeof h.metadata === 'string' ? JSON.parse(h.metadata)?.note : h.metadata?.note,
    }));

    // Load pricing snapshot
    const pricingRows = await this.driver.query<any>('SELECT * FROM pricing_snapshots WHERE journey_id = $1', [id]);
    let fareEstimate: any = undefined;
    if (pricingRows.length > 0) {
      const p = pricingRows[0];
      fareEstimate = typeof p.breakdown_json === 'string' ? JSON.parse(p.breakdown_json) : p.breakdown_json;
    }

    // Load emergency logs
    const emergencyRows = await this.driver.query<any>(
      'SELECT * FROM emergency_incidents WHERE journey_id = $1 ORDER BY triggered_at ASC',
      [id]
    );
    const emergencyLogs: EmergencyLogRecord[] = emergencyRows.map((e) => ({
      id: e.id,
      journeyId: e.journey_id,
      category: e.category,
      description: e.description,
      status: e.status,
      stateAtTrigger: e.state_at_trigger,
      previousJourneyState: e.previous_journey_state,
      locationSnapshot: typeof e.location_snapshot === 'string' ? JSON.parse(e.location_snapshot) : e.location_snapshot,
      destinationSnapshot: typeof e.destination_snapshot === 'string' ? JSON.parse(e.destination_snapshot) : e.destination_snapshot,
      triggeredByUserId: e.triggered_by_user_id,
      triggeredByRole: e.triggered_by_role,
      triggeredAt: e.triggered_at?.toISOString?.() || e.triggered_at,
      resolvedAt: e.resolved_at?.toISOString?.() || e.resolved_at,
      resolvedByUserId: e.resolved_by_user_id,
      resolutionNotes: e.resolution_notes,
    }));

    return {
      id: jRow.id,
      patientId: jRow.patient_id,
      carePartnerId: jRow.care_partner_id || undefined,
      currentState: jRow.current_state,
      bookingType: jRow.booking_type,
      isRoundTrip: jRow.is_round_trip,
      pickupLocation: typeof jRow.pickup_location === 'string' ? JSON.parse(jRow.pickup_location) : jRow.pickup_location,
      hospitalDestination:
        typeof jRow.hospital_destination === 'string'
          ? JSON.parse(jRow.hospital_destination)
          : jRow.hospital_destination,
      returnDropoffLocation:
        typeof jRow.return_dropoff_location === 'string'
          ? JSON.parse(jRow.return_dropoff_location)
          : jRow.return_dropoff_location,
      specialAssistanceNotes: jRow.special_assistance_notes || undefined,
      previousStateBeforeEmergency: jRow.previous_state_before_emergency || undefined,
      fareEstimate,
      stateHistory,
      stateTimestamps: {},
      emergencyLogs,
      incidentReports: [],
      createdAt: jRow.created_at?.toISOString?.() || jRow.created_at,
      updatedAt: jRow.updated_at?.toISOString?.() || jRow.updated_at,
    };
  }

  async findByPatientId(patientId: string): Promise<Journey[]> {
    const all = await this.findAll();
    return all.filter((j) => j.patientId === patientId);
  }

  async findByCarePartnerId(carePartnerId: string): Promise<Journey[]> {
    const all = await this.findAll();
    return all.filter((j) => j.carePartnerId === carePartnerId);
  }

  async findActiveByPatientId(patientId: string): Promise<Journey | null> {
    const all = await this.findByPatientId(patientId);
    return all.find((j) => j.currentState !== 'COMPLETED' && j.currentState !== 'CANCELLED') || null;
  }

  async findAll(): Promise<Journey[]> {
    if (this.driver instanceof InMemoryRelationalDriver) {
      return Array.from(this.driver.getTable('journeys').values()) as unknown as Journey[];
    }
    const rows = await this.driver.query<any>('SELECT id FROM journeys ORDER BY created_at DESC');
    const journeys: Journey[] = [];
    for (const r of rows) {
      const j = await this.findById(r.id);
      if (j) journeys.push(j);
    }
    return journeys;
  }

  async save(journey: Journey): Promise<Journey> {
    if (!journey || !journey.id) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'Journey must have a valid non-empty id');
    }
    if (!journey.patientId) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'Journey must have a valid patientId');
    }
    if (!journey.pickupLocation || !journey.hospitalDestination || !journey.returnDropoffLocation) {
      throw new DomainError(
        'RECORD_VALIDATION_ERROR',
        'Journey requires pickup, hospital, and return drop-off locations'
      );
    }
    if (!journey.currentState) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'Journey requires a valid currentState');
    }

    const now = new Date().toISOString();
    const updated: Journey = {
      ...journey,
      updatedAt: now,
      createdAt: journey.createdAt || now,
    };

    if (this.driver instanceof InMemoryRelationalDriver) {
      this.driver.getTable('journeys').set(journey.id, updated as unknown as Record<string, unknown>);
      return updated;
    }

    // Atomic transaction for core journey, state history, pricing, and emergency incidents
    await this.driver.transaction(async (tx) => {
      // 1. Upsert journey record
      await tx.execute(
        `INSERT INTO journeys (
           id, patient_id, care_partner_id, current_state, booking_type, is_round_trip,
           pickup_location, hospital_destination, return_dropoff_location,
           special_assistance_notes, previous_state_before_emergency, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           care_partner_id = EXCLUDED.care_partner_id,
           current_state = EXCLUDED.current_state,
           previous_state_before_emergency = EXCLUDED.previous_state_before_emergency,
           special_assistance_notes = EXCLUDED.special_assistance_notes,
           updated_at = EXCLUDED.updated_at`,
        [
          updated.id,
          updated.patientId,
          updated.carePartnerId || null,
          updated.currentState,
          updated.bookingType,
          updated.isRoundTrip,
          JSON.stringify(updated.pickupLocation),
          JSON.stringify(updated.hospitalDestination),
          JSON.stringify(updated.returnDropoffLocation),
          updated.specialAssistanceNotes || null,
          updated.previousStateBeforeEmergency || null,
          updated.createdAt,
          updated.updatedAt,
        ]
      );

      // 2. Persist pricing snapshot if present
      if (updated.fareEstimate) {
        await tx.execute(
          `INSERT INTO pricing_snapshots (
             id, journey_id, currency, total_estimated_fare, base_booking_fee,
             transit_distance_fee, companion_service_time_fee, platform_service_fee,
             taxes_fee, is_estimate, is_development_pricing, breakdown_json, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
           ON CONFLICT (journey_id) DO UPDATE SET
             breakdown_json = EXCLUDED.breakdown_json`,
          [
            `fare-${updated.id}`,
            updated.id,
            updated.fareEstimate.currency || 'INR',
            updated.fareEstimate.total,
            updated.fareEstimate.baseBookingFee,
            updated.fareEstimate.transitDistanceFee,
            updated.fareEstimate.companionServiceTimeFee,
            updated.fareEstimate.platformServiceFee,
            updated.fareEstimate.taxes || 0,
            updated.fareEstimate.isEstimate ?? true,
            true,
            JSON.stringify(updated.fareEstimate),
          ]
        );
      }

      // 3. Persist state history
      if (updated.stateHistory && updated.stateHistory.length > 0) {
        for (let i = 0; i < updated.stateHistory.length; i++) {
          const h = updated.stateHistory[i];
          const histId = `hist-${updated.id}-${i}`;
          await tx.execute(
            `INSERT INTO journey_state_history (id, journey_id, from_state, to_state, actor_user_id, metadata, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO NOTHING`,
            [histId, updated.id, h.fromState, h.toState, h.triggeredByUserId || null, JSON.stringify({ note: h.note }), h.timestamp]
          );
        }
      }

      // 4. Persist emergency incidents
      if (updated.emergencyLogs && updated.emergencyLogs.length > 0) {
        for (const inc of updated.emergencyLogs) {
          await tx.execute(
            `INSERT INTO emergency_incidents (
               id, journey_id, category, description, status, state_at_trigger,
               previous_journey_state, location_snapshot, destination_snapshot,
               triggered_by_user_id, triggered_by_role, triggered_at,
               resolved_at, resolved_by_user_id, resolution_notes
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             ON CONFLICT (id) DO UPDATE SET
               status = EXCLUDED.status,
               resolved_at = EXCLUDED.resolved_at,
               resolved_by_user_id = EXCLUDED.resolved_by_user_id,
               resolution_notes = EXCLUDED.resolution_notes`,
            [
              inc.id,
              updated.id,
              inc.category || 'OPERATIONAL_OTHER',
              inc.description || null,
              inc.status || 'ACTIVE',
              inc.stateAtTrigger,
              inc.previousJourneyState || null,
              inc.locationSnapshot ? JSON.stringify(inc.locationSnapshot) : null,
              inc.destinationSnapshot ? JSON.stringify(inc.destinationSnapshot) : null,
              inc.triggeredByUserId,
              inc.triggeredByRole || null,
              inc.triggeredAt,
              inc.resolvedAt || null,
              inc.resolvedByUserId || null,
              inc.resolutionNotes || null, // STRICTLY NON-CLINICAL
            ]
          );
        }
      }
    });

    return updated;
  }
}

/**
 * Server-Side PostgreSQL Domain Store.
 * Coordinates all repositories behind IDomainStore.
 */
export class PostgresDomainStore implements IDomainStore {
  public users: PostgresUserRepository;
  public patientProfiles: PostgresPatientProfileRepository;
  public carePartners: PostgresCarePartnerProfileRepository;
  public hospitals: PostgresHospitalRepository;
  public journeys: PostgresJourneyRepository;
  public driver: IServerDatabaseDriver;

  constructor(driver?: IServerDatabaseDriver) {
    this.driver = driver || new PostgresDatabaseDriver();
    this.users = new PostgresUserRepository(this.driver);
    this.patientProfiles = new PostgresPatientProfileRepository(this.driver);
    this.carePartners = new PostgresCarePartnerProfileRepository(this.driver);
    this.hospitals = new PostgresHospitalRepository(this.driver);
    this.journeys = new PostgresJourneyRepository(this.driver);
  }

  isProductionDatabase(): boolean {
    return this.driver instanceof PostgresDatabaseDriver && this.driver.isConnected();
  }

  getStorageDescription(): string {
    return this.driver.driverName;
  }

  async clear(): Promise<void> {
    if (this.driver instanceof InMemoryRelationalDriver) {
      this.driver.clear();
      return;
    }
    await this.driver.execute(`
      TRUNCATE TABLE emergency_incidents, pricing_snapshots, journey_state_history,
                     journeys, trusted_contact_permissions, family_contacts,
                     care_partner_profiles, patient_profiles, users CASCADE;
    `);
  }
}
