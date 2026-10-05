import {
  User,
  PatientProfile,
  CarePartnerProfile,
  HospitalDestination,
  Journey,
} from '../types/index.ts';
import {
  IUserRepository,
  IPatientProfileRepository,
  ICarePartnerProfileRepository,
  IHospitalRepository,
  IJourneyRepository,
  IDomainStore,
} from './repository.ts';
import {
  IPersistenceStorageAdapter,
  AdaptivePersistenceAdapter,
} from './persistence-adapter.ts';
import { DomainError } from '../types/errors.ts';

const PREFIX_USER = 'neravu:user:';
const PREFIX_PATIENT = 'neravu:patient:';
const PREFIX_PARTNER = 'neravu:partner:';
const PREFIX_HOSPITAL = 'neravu:hospital:';
const PREFIX_JOURNEY = 'neravu:journey:';

export class PersistentUserRepository implements IUserRepository {
  constructor(private adapter: IPersistenceStorageAdapter) {}

  async findById(id: string): Promise<User | null> {
    if (!id || typeof id !== 'string') return null;
    return this.adapter.getItem<User>(`${PREFIX_USER}${id}`);
  }

  async findByPhone(phone: string): Promise<User | null> {
    if (!phone) return null;
    const all = await this.findAll();
    return all.find((u) => u.phone === phone) || null;
  }

  async findAll(): Promise<User[]> {
    const keys = await this.adapter.getAllKeys(PREFIX_USER);
    const users: User[] = [];
    for (const key of keys) {
      const u = await this.adapter.getItem<User>(key);
      if (u) users.push(u);
    }
    return users;
  }

  async save(user: User): Promise<User> {
    if (!user || !user.id) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'User must have a valid non-empty id');
    }
    const updated: User = { ...user, updatedAt: new Date().toISOString() };
    await this.adapter.setItem(`${PREFIX_USER}${user.id}`, updated);
    return updated;
  }
}

export class PersistentPatientProfileRepository implements IPatientProfileRepository {
  constructor(private adapter: IPersistenceStorageAdapter) {}

  async findByUserId(userId: string): Promise<PatientProfile | null> {
    if (!userId || typeof userId !== 'string') return null;
    return this.adapter.getItem<PatientProfile>(`${PREFIX_PATIENT}${userId}`);
  }

  async findAll(): Promise<PatientProfile[]> {
    const keys = await this.adapter.getAllKeys(PREFIX_PATIENT);
    const profiles: PatientProfile[] = [];
    for (const key of keys) {
      const p = await this.adapter.getItem<PatientProfile>(key);
      if (p) profiles.push(p);
    }
    return profiles;
  }

  async save(profile: PatientProfile): Promise<PatientProfile> {
    if (!profile || !profile.userId) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'PatientProfile must have a valid userId');
    }
    const updated: PatientProfile = { ...profile, updatedAt: new Date().toISOString() };
    await this.adapter.setItem(`${PREFIX_PATIENT}${profile.userId}`, updated);
    return updated;
  }
}

export class PersistentCarePartnerProfileRepository implements ICarePartnerProfileRepository {
  constructor(private adapter: IPersistenceStorageAdapter) {}

  async findByUserId(userId: string): Promise<CarePartnerProfile | null> {
    if (!userId || typeof userId !== 'string') return null;
    return this.adapter.getItem<CarePartnerProfile>(`${PREFIX_PARTNER}${userId}`);
  }

  async findAvailable(): Promise<CarePartnerProfile[]> {
    const all = await this.findAll();
    return all.filter((p) => p.availabilityStatus === 'AVAILABLE' && p.verificationStatus === 'VERIFIED');
  }

  async findAll(): Promise<CarePartnerProfile[]> {
    const keys = await this.adapter.getAllKeys(PREFIX_PARTNER);
    const profiles: CarePartnerProfile[] = [];
    for (const key of keys) {
      const p = await this.adapter.getItem<CarePartnerProfile>(key);
      if (p) profiles.push(p);
    }
    return profiles;
  }

  async save(profile: CarePartnerProfile): Promise<CarePartnerProfile> {
    if (!profile || !profile.userId) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'CarePartnerProfile must have a valid userId');
    }
    const updated: CarePartnerProfile = { ...profile, updatedAt: new Date().toISOString() };
    await this.adapter.setItem(`${PREFIX_PARTNER}${profile.userId}`, updated);
    return updated;
  }
}

export class PersistentHospitalRepository implements IHospitalRepository {
  private seeded = false;
  constructor(private adapter: IPersistenceStorageAdapter) {}

  async findById(id: string): Promise<HospitalDestination | null> {
    if (!id || typeof id !== 'string') return null;
    return this.adapter.getItem<HospitalDestination>(`${PREFIX_HOSPITAL}${id}`);
  }

  async findAll(): Promise<HospitalDestination[]> {
    const keys = await this.adapter.getAllKeys(PREFIX_HOSPITAL);
    const hospitals: HospitalDestination[] = [];
    for (const key of keys) {
      const h = await this.adapter.getItem<HospitalDestination>(key);
      if (h) hospitals.push(h);
    }
    if (hospitals.length === 0 && !this.seeded) {
      this.seeded = true;
      await this.seedDefaults();
      const newKeys = await this.adapter.getAllKeys(PREFIX_HOSPITAL);
      for (const key of newKeys) {
        const h = await this.adapter.getItem<HospitalDestination>(key);
        if (h) hospitals.push(h);
      }
    }
    return hospitals;
  }

  async save(hospital: HospitalDestination): Promise<HospitalDestination> {
    if (!hospital || !hospital.id) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'Hospital must have a valid id');
    }
    await this.adapter.setItem(`${PREFIX_HOSPITAL}${hospital.id}`, hospital);
    return hospital;
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
}

export class PersistentJourneyRepository implements IJourneyRepository {
  constructor(private adapter: IPersistenceStorageAdapter) {}

  async findById(id: string): Promise<Journey | null> {
    if (!id || typeof id !== 'string') return null;
    return this.adapter.getItem<Journey>(`${PREFIX_JOURNEY}${id}`);
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
    const active = all.find(
      (j) => j.currentState !== 'COMPLETED' && j.currentState !== 'CANCELLED'
    );
    return active || null;
  }

  async findAll(): Promise<Journey[]> {
    const keys = await this.adapter.getAllKeys(PREFIX_JOURNEY);
    const journeys: Journey[] = [];
    for (const key of keys) {
      const j = await this.adapter.getItem<Journey>(key);
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
      throw new DomainError('RECORD_VALIDATION_ERROR', 'Journey requires pickup, hospital, and return drop-off locations');
    }
    if (!journey.currentState) {
      throw new DomainError('RECORD_VALIDATION_ERROR', 'Journey requires a valid currentState');
    }

    const updated: Journey = { ...journey, updatedAt: new Date().toISOString() };
    await this.adapter.setItem(`${PREFIX_JOURNEY}${journey.id}`, updated);
    return updated;
  }
}

/**
 * Production-oriented domain store utilizing the provider-neutral persistence adapter.
 */
export class PersistentDomainStore implements IDomainStore {
  public users: PersistentUserRepository;
  public patientProfiles: PersistentPatientProfileRepository;
  public carePartners: PersistentCarePartnerProfileRepository;
  public hospitals: PersistentHospitalRepository;
  public journeys: PersistentJourneyRepository;
  public adapter: IPersistenceStorageAdapter;

  constructor(adapter?: IPersistenceStorageAdapter) {
    this.adapter = adapter || new AdaptivePersistenceAdapter();
    this.users = new PersistentUserRepository(this.adapter);
    this.patientProfiles = new PersistentPatientProfileRepository(this.adapter);
    this.carePartners = new PersistentCarePartnerProfileRepository(this.adapter);
    this.hospitals = new PersistentHospitalRepository(this.adapter);
    this.journeys = new PersistentJourneyRepository(this.adapter);
  }

  /**
   * Returns whether the underlying storage is an active production database.
   * Returns false when running development local adapters (localStorage, file-JSON, memory).
   */
  isProductionDatabase(): boolean {
    return this.adapter.isProductionDatabase;
  }

  /**
   * Returns human-readable name of current storage implementation.
   */
  getStorageDescription(): string {
    return this.adapter.name;
  }

  async clear(): Promise<void> {
    await this.adapter.clear();
  }
}
