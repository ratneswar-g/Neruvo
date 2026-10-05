import {
  Coordinate,
  GeocodingResult,
  PlaceSearchResult,
  RouteLegInfo,
  TwoLegRouteInfo,
  IGeocodingProvider,
  IPlacesProvider,
  IRoutingProvider,
  IMapProvider,
  isValidCoordinate,
  validateLocation,
} from './types.ts';
import { Location } from '../domain/types/location.ts';
import { HospitalDestination } from '../domain/types/hospital.ts';
import { createFallbackRouteLeg, createTwoLegJourneyRoute } from './geo-utils.ts';
import { sharedJourneyService } from '../services/journey-service.ts';

export class GoogleMapsService
  implements IMapProvider, IGeocodingProvider, IPlacesProvider, IRoutingProvider
{
  private _apiKey: string | null = null;
  private _routeCache: Map<string, TwoLegRouteInfo> = new Map();
  private _calculationCount: number = 0;

  constructor() {
    this.initApiKey();
  }

  get calculationCount(): number {
    return this._calculationCount;
  }

  clearRouteCache(): void {
    this._routeCache.clear();
  }

  private initApiKey() {
    try {
      // Read key from process.env (Node/test) or import.meta.env (Vite browser)
      let envKey: string | undefined;
      if (typeof process !== 'undefined' && process.env && process.env.VITE_GOOGLE_MAPS_API_KEY) {
        envKey = process.env.VITE_GOOGLE_MAPS_API_KEY;
      } else if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY) {
        envKey = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY;
      }
      if (envKey && typeof envKey === 'string' && envKey.trim().length > 0) {
        this._apiKey = envKey.trim();
      } else {
        this._apiKey = null;
      }
    } catch {
      this._apiKey = null;
    }
  }

  get isAvailable(): boolean {
    return this._apiKey !== null && this._apiKey.length > 0;
  }

  get apiKey(): string | null {
    return this._apiKey;
  }

  /**
   * Geocodes an address string to normalized Location coordinates.
   */
  async geocodeAddress(address: string): Promise<GeocodingResult | null> {
    if (!address || address.trim().length === 0) return null;

    // Check if matching any of our registered demo destinations
    const hospitals = await this.getHospitalDestinations();
    const matchedHospital = hospitals.find(
      (h) =>
        h.name.toLowerCase().includes(address.toLowerCase()) ||
        h.address.toLowerCase().includes(address.toLowerCase())
    );

    if (matchedHospital) {
      return {
        address: matchedHospital.address,
        location: {
          latitude: matchedHospital.latitude,
          longitude: matchedHospital.longitude,
          address: matchedHospital.address,
          landmark: matchedHospital.name,
        },
        placeId: matchedHospital.id,
      };
    }

    // Default fallback geocode centered in Bangalore region if outside known places
    const sampleLoc: Location = {
      latitude: 12.9716,
      longitude: 77.5946,
      address: address.trim(),
    };

    return {
      address: address.trim(),
      location: sampleLoc,
      placeId: `place-${Date.now()}`,
    };
  }

  async reverseGeocode(coord: Coordinate): Promise<GeocodingResult | null> {
    if (!isValidCoordinate(coord.lat, coord.lng)) {
      throw new Error(`Invalid coordinate for reverse geocoding: lat=${coord.lat}, lng=${coord.lng}`);
    }

    return {
      address: `Location at (${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)})`,
      location: {
        latitude: coord.lat,
        longitude: coord.lng,
        address: `Verified Coordinates: ${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}`,
      },
    };
  }

  /**
   * Searches for hospital destinations and medical clinics.
   */
  async searchPlaces(query: string): Promise<PlaceSearchResult[]> {
    const hospitals = await this.getHospitalDestinations();
    const q = query.trim().toLowerCase();

    if (!q) {
      return hospitals.map((h) => ({
        id: h.id,
        name: h.name,
        address: h.address,
        location: {
          latitude: h.latitude,
          longitude: h.longitude,
          address: h.address,
          landmark: h.entranceOrDepartment,
        },
        placeId: h.id,
        isHospital: true,
      }));
    }

    const filtered = hospitals.filter(
      (h) => h.name.toLowerCase().includes(q) || h.address.toLowerCase().includes(q)
    );

    return filtered.map((h) => ({
      id: h.id,
      name: h.name,
      address: h.address,
      location: {
        latitude: h.latitude,
        longitude: h.longitude,
        address: h.address,
        landmark: h.entranceOrDepartment,
      },
      placeId: h.id,
      isHospital: true,
    }));
  }

  /**
   * Retrieves verified hospital destinations from the domain store.
   */
  async getHospitalDestinations(): Promise<HospitalDestination[]> {
    return sharedJourneyService.getHospitals();
  }

  /**
   * Computes routing for a single leg.
   */
  async computeRouteLeg(origin: Location, destination: Location): Promise<RouteLegInfo> {
    const valOrigin = validateLocation(origin);
    if (!valOrigin.valid) throw new Error(valOrigin.error);

    const valDest = validateLocation(destination);
    if (!valDest.valid) throw new Error(valDest.error);

    // If Google Maps API is loaded with routes library in browser, use Routes API if available
    if (typeof window !== 'undefined' && (window as any).google?.maps?.Route?.computeRoutes) {
      try {
        const routesLib = (window as any).google.maps;
        const response = await routesLib.Route.computeRoutes({
          origin: { lat: origin.latitude, lng: origin.longitude },
          destination: { lat: destination.latitude, lng: destination.longitude },
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE',
        });

        if (response.routes && response.routes.length > 0) {
          const r = response.routes[0];
          const distMeters = r.distanceMeters || 0;
          const durSeconds = parseInt(r.duration?.replace('s', '') || '0', 10);
          return {
            origin,
            destination,
            distanceMeters: distMeters,
            distanceText: `${(distMeters / 1000).toFixed(1)} km`,
            durationSeconds: durSeconds,
            durationText: `${Math.round(durSeconds / 60)} mins`,
            polylinePoints: r.polyline?.encodedPolyline ? undefined : undefined,
          };
        }
      } catch {
        // Fall back gracefully
      }
    }

    return createFallbackRouteLeg(origin, destination);
  }

  /**
   * Computes the complete two-leg round-trip route:
   * Leg 1 (Outbound): Pickup (Home) -> Hospital
   * Leg 2 (Return): Hospital -> Return Home Dropoff
   */
  async computeTwoLegJourneyRoute(
    pickup: Location,
    hospital: HospitalDestination,
    returnDropoff: Location
  ): Promise<TwoLegRouteInfo> {
    const valPickup = validateLocation(pickup);
    if (!valPickup.valid) throw new Error(`Pickup: ${valPickup.error}`);

    const hospitalLoc: Location = {
      latitude: hospital.latitude,
      longitude: hospital.longitude,
      address: hospital.address,
      landmark: hospital.entranceOrDepartment,
    };
    const valHosp = validateLocation(hospitalLoc);
    if (!valHosp.valid) throw new Error(`Hospital: ${valHosp.error}`);

    const valReturn = validateLocation(returnDropoff);
    if (!valReturn.valid) throw new Error(`Return drop-off: ${valReturn.error}`);

    const cacheKey = `${pickup.latitude.toFixed(6)},${pickup.longitude.toFixed(6)}->${hospital.id}:${hospital.latitude.toFixed(6)},${hospital.longitude.toFixed(6)}->${returnDropoff.latitude.toFixed(6)},${returnDropoff.longitude.toFixed(6)}`;
    const cached = this._routeCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const leg1 = await this.computeRouteLeg(pickup, hospitalLoc);
    const leg2 = await this.computeRouteLeg(hospitalLoc, returnDropoff);

    const totalDist = leg1.distanceMeters + leg2.distanceMeters;
    const totalDur = leg1.durationSeconds + leg2.durationSeconds;

    this._calculationCount++;
    const routeInfo: TwoLegRouteInfo = {
      leg1Outbound: leg1,
      leg2Return: leg2,
      totalDistanceMeters: totalDist,
      totalDistanceText: `${(totalDist / 1000).toFixed(1)} km`,
      totalDurationSeconds: totalDur,
      totalDurationText: `${Math.round(totalDur / 60)} mins`,
      isEstimated: true,
      source: 'CALCULATED_FALLBACK',
    };
    this._routeCache.set(cacheKey, routeInfo);
    return routeInfo;
  }
}

export const googleMapsService = new GoogleMapsService();
