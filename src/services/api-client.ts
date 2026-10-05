import {
  Journey,
  HospitalDestination,
  Location,
  PricingPolicy,
  BookingType,
  JourneyState,
  EmergencyCategory,
  PatientProfile,
  CarePartnerProfile,
  FareBreakdown,
} from '../domain/types/index.ts';

export class ApiError extends Error {
  public status: number;
  public code: string;
  public userFriendlyMessage: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.userFriendlyMessage = message;
  }
}

export interface ApiClientConfig {
  baseUrl?: string;
  getAuthToken?: () => string | null;
  getUserId?: () => string | null;
  getRole?: () => string | null;
}

export class NeravuApiClient {
  private baseUrl: string;
  private customGetAuthToken?: () => string | null;
  private customGetUserId?: () => string | null;
  private customGetRole?: () => string | null;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl || '';
    this.customGetAuthToken = config.getAuthToken;
    this.customGetUserId = config.getUserId;
    this.customGetRole = config.getRole;
  }

  private getSessionFromStorage(): { token: string | null; userId: string | null; role: string | null } {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem('neravu_dev_auth_session');
        if (raw) {
          const session = JSON.parse(raw);
          if (session?.user) {
            return {
              token: session.token || `dev-session-${session.user.id}`,
              userId: session.user.id,
              role: session.user.role,
            };
          }
        }
      }
    } catch {
      // In-memory or non-browser environment
    }
    return { token: null, userId: null, role: null };
  }

  public getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const storageSession = this.getSessionFromStorage();

    const token = this.customGetAuthToken?.() || storageSession.token;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const userId = this.customGetUserId?.() || storageSession.userId;
    if (userId) {
      headers['X-User-Id'] = userId;
    }

    const role = this.customGetRole?.() || storageSession.role;
    if (role) {
      headers['X-Role'] = role;
    }

    return headers;
  }

  private async handleResponse<T>(res: Response, fallbackActionName: string): Promise<T> {
    if (!res.ok) {
      let errData: any = {};
      try {
        errData = await res.json();
      } catch {
        // Fallback for non-JSON response
      }

      const status = res.status;
      const code = errData.error || (status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'SERVER_ERROR');
      
      let message = errData.message;
      if (!message) {
        if (status === 401) message = 'Your session has expired or requires authentication.';
        else if (status === 403) message = 'You do not have permission to perform this action.';
        else if (status === 404) message = 'The requested resource was not found.';
        else if (status >= 500) message = 'The server encountered an error. Please try again shortly.';
        else message = `${fallbackActionName} failed with HTTP ${status}.`;
      }

      // Ensure no raw SQL or credentials leak in error messages
      if (message.includes('SELECT') || message.includes('DATABASE_URL') || message.includes('password') || message.includes('pg_')) {
        message = 'A secure database operation error occurred. Please try again.';
      }

      throw new ApiError(status, code, message);
    }

    return res.json() as Promise<T>;
  }

  private async safeFetch(url: string, init?: RequestInit, actionName = 'Request'): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (networkErr: any) {
      throw new ApiError(
        0,
        'NETWORK_FAILURE',
        'Unable to connect to the Neravu server. Please check your network connection.'
      );
    }
  }

  async getHealth(): Promise<any> {
    const res = await this.safeFetch(`${this.baseUrl}/api/health`, { headers: this.getHeaders() }, 'Health check');
    return this.handleResponse(res, 'Health check');
  }

  async getHospitals(): Promise<HospitalDestination[]> {
    const res = await this.safeFetch(`${this.baseUrl}/api/hospitals`, { headers: this.getHeaders() }, 'Fetch hospitals');
    const data = await this.handleResponse<{ success: boolean; hospitals: HospitalDestination[] }>(res, 'Fetch hospitals');
    return data.hospitals || [];
  }

  async getJourneys(query?: { status?: string }): Promise<Journey[]> {
    let url = `${this.baseUrl}/api/journeys`;
    if (query?.status) {
      url += `?status=${encodeURIComponent(query.status)}`;
    }
    const res = await this.safeFetch(url, { headers: this.getHeaders() }, 'Fetch journeys');
    const data = await this.handleResponse<{ success: boolean; journeys: Journey[] }>(res, 'Fetch journeys');
    return data.journeys || [];
  }

  async getJourneyById(id: string): Promise<Journey | null> {
    const res = await this.safeFetch(`${this.baseUrl}/api/journeys/${id}`, { headers: this.getHeaders() }, 'Fetch journey');
    if (res.status === 404) return null;
    const data = await this.handleResponse<{ success: boolean; journey: Journey }>(res, 'Fetch journey');
    return data.journey || null;
  }

  async createBooking(params: {
    pickupLocation: Location;
    hospitalDestination: HospitalDestination;
    returnDropoffLocation?: Location;
    bookingType?: BookingType;
    scheduledPickupTime?: string;
    specialAssistanceNotes?: string;
    initialFareEstimate?: FareBreakdown;
    fareEstimate?: FareBreakdown;
  }): Promise<Journey> {
    const res = await this.safeFetch(
      `${this.baseUrl}/api/journeys`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(params),
      },
      'Create booking'
    );
    const data = await this.handleResponse<{ success: boolean; journey: Journey }>(res, 'Create booking');
    return data.journey;
  }

  async acceptJourney(journeyId: string): Promise<Journey> {
    const res = await this.safeFetch(
      `${this.baseUrl}/api/journeys/${journeyId}/accept`,
      {
        method: 'POST',
        headers: this.getHeaders(),
      },
      'Accept journey'
    );
    const data = await this.handleResponse<{ success: boolean; journey: Journey }>(res, 'Accept journey');
    return data.journey;
  }

  async advanceMilestone(
    journeyId: string,
    targetState: JourneyState,
    metadata?: Record<string, unknown> | string
  ): Promise<Journey> {
    const payload = typeof metadata === 'string' ? { targetState, metadata: { note: metadata } } : { targetState, metadata };
    const res = await this.safeFetch(
      `${this.baseUrl}/api/journeys/${journeyId}/milestones`,
      {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
      },
      'Advance milestone'
    );
    const data = await this.handleResponse<{ success: boolean; journey: Journey }>(res, 'Advance milestone');
    return data.journey;
  }

  async triggerEmergency(
    journeyId: string,
    options?: {
      category?: EmergencyCategory;
      reason?: string;
      locationSnapshot?: Location;
    }
  ): Promise<Journey> {
    const res = await this.safeFetch(
      `${this.baseUrl}/api/journeys/${journeyId}/emergency`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(options || {}),
      },
      'Trigger emergency'
    );
    const data = await this.handleResponse<{ success: boolean; journey: Journey }>(res, 'Trigger emergency');
    return data.journey;
  }

  async resolveEmergency(journeyId: string, operationalResolutionNotes: string): Promise<Journey> {
    const res = await this.safeFetch(
      `${this.baseUrl}/api/journeys/${journeyId}/emergency/resolve`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ operationalResolutionNotes }),
      },
      'Resolve emergency'
    );
    const data = await this.handleResponse<{ success: boolean; journey: Journey }>(res, 'Resolve emergency');
    return data.journey;
  }

  async getPricingPolicy(): Promise<PricingPolicy> {
    const res = await this.safeFetch(`${this.baseUrl}/api/pricing/policy`, { headers: this.getHeaders() }, 'Fetch pricing policy');
    const data = await this.handleResponse<{ success: boolean; policy: PricingPolicy }>(res, 'Fetch pricing policy');
    return data.policy;
  }

  async updatePricingPolicy(policy: PricingPolicy): Promise<PricingPolicy> {
    const res = await this.safeFetch(
      `${this.baseUrl}/api/pricing/policy`,
      {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify(policy),
      },
      'Update pricing policy'
    );
    const data = await this.handleResponse<{ success: boolean; policy: PricingPolicy }>(res, 'Update pricing policy');
    return data.policy;
  }

  async getPricingEstimate(params: {
    totalDistanceKm?: number;
    outboundDistanceMeters?: number;
    returnDistanceMeters?: number;
    estimatedAccompanimentMinutes?: number;
    estimatedHospitalStayMinutes?: number;
    bookingType?: 'ON_DEMAND' | 'SCHEDULED';
    specialAssistanceRequired?: boolean;
  }): Promise<FareBreakdown> {
    const res = await this.safeFetch(
      `${this.baseUrl}/api/pricing/estimate`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(params),
      },
      'Calculate pricing estimate'
    );
    const data = await this.handleResponse<{ success: boolean; estimate: FareBreakdown }>(res, 'Calculate pricing estimate');
    return data.estimate;
  }

  async getCurrentUserProfile(): Promise<{ user: any; profile: any }> {
    const res = await this.safeFetch(`${this.baseUrl}/api/users/me`, { headers: this.getHeaders() }, 'Fetch current user');
    return this.handleResponse(res, 'Fetch current user');
  }

  async getPatientProfile(patientId: string): Promise<PatientProfile | null> {
    const res = await this.safeFetch(`${this.baseUrl}/api/users/patient/${patientId}`, { headers: this.getHeaders() }, 'Fetch patient profile');
    if (res.status === 404) return null;
    const data = await this.handleResponse<{ success: boolean; profile: PatientProfile }>(res, 'Fetch patient profile');
    return data.profile || null;
  }

  async getCarePartnerProfile(partnerId: string): Promise<CarePartnerProfile | null> {
    const res = await this.safeFetch(`${this.baseUrl}/api/users/care-partner/${partnerId}`, { headers: this.getHeaders() }, 'Fetch care partner profile');
    if (res.status === 404) return null;
    const data = await this.handleResponse<{ success: boolean; profile: CarePartnerProfile }>(res, 'Fetch care partner profile');
    return data.profile || null;
  }

  async setCarePartnerAvailability(status: 'AVAILABLE' | 'OFFLINE'): Promise<CarePartnerProfile> {
    const res = await this.safeFetch(
      `${this.baseUrl}/api/users/care-partner/availability`,
      {
        method: 'PUT',
        headers: this.getHeaders(),
        body: JSON.stringify({ status }),
      },
      'Update care partner availability'
    );
    const data = await this.handleResponse<{ success: boolean; profile: CarePartnerProfile }>(res, 'Update care partner availability');
    return data.profile;
  }
}

export const neravuApi = new NeravuApiClient();
