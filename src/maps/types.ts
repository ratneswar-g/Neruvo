import { Location } from '../domain/types/location.ts';
import { HospitalDestination } from '../domain/types/hospital.ts';
import { Journey, JourneyState } from '../domain/types/journey.ts';

export interface Coordinate {
  lat: number;
  lng: number;
}

/**
 * Validates latitude (-90 to +90) and longitude (-180 to +180).
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

/**
 * Validates a Location object ensures valid coordinates and non-empty address.
 */
export function validateLocation(location: Location): { valid: boolean; error?: string } {
  if (!location) return { valid: false, error: 'Location object is null or undefined.' };
  if (!location.address || location.address.trim().length === 0) {
    return { valid: false, error: 'Location address is required and cannot be empty.' };
  }
  if (!isValidCoordinate(location.latitude, location.longitude)) {
    return {
      valid: false,
      error: `Invalid coordinates: lat=${location.latitude}, lng=${location.longitude}. Lat must be [-90, 90], Lng must be [-180, 180].`,
    };
  }
  return { valid: true };
}

export interface RouteLegInfo {
  origin: Location;
  destination: Location;
  distanceMeters: number;
  distanceText: string;
  durationSeconds: number;
  durationText: string;
  polylinePoints?: Coordinate[];
}

export interface TwoLegRouteInfo {
  leg1Outbound: RouteLegInfo; // Home -> Hospital
  leg2Return: RouteLegInfo;   // Hospital -> Return Home
  totalDistanceMeters: number;
  totalDistanceText: string;
  totalDurationSeconds: number;
  totalDurationText: string;
  isEstimated: boolean;
  source: 'GOOGLE_ROUTES' | 'CALCULATED_FALLBACK';
}

export interface PlaceSearchResult {
  id: string;
  name: string;
  address: string;
  location: Location;
  placeId?: string;
  isHospital?: boolean;
}

export interface GeocodingResult {
  address: string;
  location: Location;
  placeId?: string;
}

// Provider Contracts (Decoupled Abstraction)
export interface IGeocodingProvider {
  geocodeAddress(address: string): Promise<GeocodingResult | null>;
  reverseGeocode(coord: Coordinate): Promise<GeocodingResult | null>;
}

export interface IPlacesProvider {
  searchPlaces(query: string, nearby?: Coordinate): Promise<PlaceSearchResult[]>;
  getHospitalDestinations(): Promise<HospitalDestination[]>;
}

export interface IRoutingProvider {
  computeRouteLeg(origin: Location, destination: Location): Promise<RouteLegInfo>;
  computeTwoLegJourneyRoute(
    pickup: Location,
    hospital: HospitalDestination,
    returnDropoff: Location
  ): Promise<TwoLegRouteInfo>;
}

export interface IMapProvider {
  readonly isAvailable: boolean;
  readonly apiKey: string | null;
}
