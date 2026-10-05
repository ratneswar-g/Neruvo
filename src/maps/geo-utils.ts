import { Coordinate, RouteLegInfo, TwoLegRouteInfo, isValidCoordinate } from './types.ts';
import { Location } from '../domain/types/location.ts';
import { HospitalDestination } from '../domain/types/hospital.ts';

/**
 * Calculates straight-line distance in meters between two coordinates via Haversine formula.
 */
export function calculateHaversineDistanceMeters(c1: Coordinate, c2: Coordinate): number {
  if (!isValidCoordinate(c1.lat, c1.lng) || !isValidCoordinate(c2.lat, c2.lng)) {
    return 0;
  }
  const R = 6371e3; // Earth radius in meters
  const phi1 = (c1.lat * Math.PI) / 180;
  const phi2 = (c2.lat * Math.PI) / 180;
  const deltaPhi = ((c2.lat - c1.lat) * Math.PI) / 180;
  const deltaLambda = ((c2.lng - c1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

/**
 * Generates human-friendly distance text (e.g. "8.4 km" or "850 m").
 */
export function formatDistanceText(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${meters} m`;
}

/**
 * Generates human-friendly duration text (e.g. "25 mins" or "1 hr 10 mins").
 */
export function formatDurationText(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${Math.max(1, minutes)} mins`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) {
    return `${hours} hr${hours > 1 ? 's' : ''}`;
  }
  return `${hours} hr${hours > 1 ? 's' : ''} ${remainingMinutes} mins`;
}

/**
 * Generates an estimated route leg using road network modeling factor (1.3x haversine) and urban speed (24 km/h).
 */
export function createFallbackRouteLeg(origin: Location, destination: Location): RouteLegInfo {
  const c1: Coordinate = { lat: origin.latitude, lng: origin.longitude };
  const c2: Coordinate = { lat: destination.latitude, lng: destination.longitude };

  const straightLine = calculateHaversineDistanceMeters(c1, c2);
  // Urban road winding coefficient ~ 1.3
  const roadDistance = Math.round(straightLine * 1.3);
  // Average city medical transport speed ~ 24 km/h (6.67 m/s)
  const durationSec = Math.max(300, Math.round(roadDistance / 6.67));

  // Generate intermediate waypoint line points for fallback visual rendering
  const polylinePoints: Coordinate[] = [
    c1,
    {
      lat: (c1.lat * 2 + c2.lat) / 3 + 0.001,
      lng: (c1.lng * 2 + c2.lng) / 3 - 0.001,
    },
    {
      lat: (c1.lat + c2.lat * 2) / 3 - 0.001,
      lng: (c1.lng + c2.lng * 2) / 3 + 0.001,
    },
    c2,
  ];

  return {
    origin,
    destination,
    distanceMeters: roadDistance,
    distanceText: formatDistanceText(roadDistance),
    durationSeconds: durationSec,
    durationText: formatDurationText(durationSec),
    polylinePoints,
  };
}

/**
 * Computes both legs of the Neravu journey:
 * Leg 1 (Outbound): Home -> Hospital
 * Leg 2 (Return): Hospital -> Return Home Dropoff
 */
export function createTwoLegJourneyRoute(
  pickup: Location,
  hospital: HospitalDestination,
  returnDropoff: Location
): TwoLegRouteInfo {
  const hospitalLoc: Location = {
    latitude: hospital.latitude,
    longitude: hospital.longitude,
    address: hospital.address,
    landmark: hospital.entranceOrDepartment,
  };

  const leg1Outbound = createFallbackRouteLeg(pickup, hospitalLoc);
  const leg2Return = createFallbackRouteLeg(hospitalLoc, returnDropoff);

  const totalDistance = leg1Outbound.distanceMeters + leg2Return.distanceMeters;
  const totalDuration = leg1Outbound.durationSeconds + leg2Return.durationSeconds;

  return {
    leg1Outbound,
    leg2Return,
    totalDistanceMeters: totalDistance,
    totalDistanceText: formatDistanceText(totalDistance),
    totalDurationSeconds: totalDuration,
    totalDurationText: formatDurationText(totalDuration),
    isEstimated: true,
    source: 'CALCULATED_FALLBACK',
  };
}
