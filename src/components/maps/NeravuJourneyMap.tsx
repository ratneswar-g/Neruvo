import React, { useState, useEffect, useMemo } from 'react';
import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps';
import { Journey, JourneyState } from '../../domain/types/journey.ts';
import { googleMapsService } from '../../maps/google-maps-service.ts';
import { TwoLegRouteInfo, Coordinate } from '../../maps/types.ts';
import { MapPolyline } from './MapPolyline.tsx';
import {
  MapPin,
  HeartHandshake,
  Car,
  Home,
  AlertTriangle,
  Clock,
  Compass,
  CheckCircle2,
  Navigation,
} from 'lucide-react';

interface NeravuJourneyMapProps {
  journey: Journey;
  onReadyToReturn?: () => void;
  showCarePartnerLocation?: boolean;
}

export const NeravuJourneyMap: React.FC<NeravuJourneyMapProps> = ({
  journey,
  onReadyToReturn,
  showCarePartnerLocation = true,
}) => {
  const [routeInfo, setRouteInfo] = useState<TwoLegRouteInfo | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);

  const apiKey = googleMapsService.apiKey;
  const isMapsConfigured = !!apiKey;

  // Listen for Google Maps quota exceeded event
  useEffect(() => {
    const handleQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  const pickupKey = `${journey.pickupLocation.latitude},${journey.pickupLocation.longitude},${journey.pickupLocation.address}`;
  const hospitalKey = `${journey.hospitalDestination.id},${journey.hospitalDestination.latitude},${journey.hospitalDestination.longitude}`;
  const returnKey = `${journey.returnDropoffLocation.latitude},${journey.returnDropoffLocation.longitude},${journey.returnDropoffLocation.address}`;

  // Compute two-leg route for the journey (stable inputs only; state transitions do not recalculate)
  useEffect(() => {
    let mounted = true;
    async function fetchRoute() {
      try {
        const info = await googleMapsService.computeTwoLegJourneyRoute(
          journey.pickupLocation,
          journey.hospitalDestination,
          journey.returnDropoffLocation
        );
        if (mounted) {
          setRouteInfo(info);
        }
      } catch (err: any) {
        if (mounted) {
          setMapError(err.message || 'Routing calculation fallback');
        }
      }
    }
    fetchRoute();
    return () => {
      mounted = false;
    };
  }, [pickupKey, hospitalKey, returnKey]);

  // Center calculation based on current journey state
  const center: Coordinate = useMemo(() => {
    const state = journey.currentState;
    if (
      state === 'ARRIVED_AT_HOSPITAL' ||
      state === 'HOSPITAL_VISIT' ||
      state === 'RETURN_STARTED'
    ) {
      return {
        lat: journey.hospitalDestination.latitude,
        lng: journey.hospitalDestination.longitude,
      };
    }
    if (state === 'IN_TRANSIT_TO_HOME' || state === 'PATIENT_RETURNED_HOME') {
      return {
        lat: journey.returnDropoffLocation.latitude,
        lng: journey.returnDropoffLocation.longitude,
      };
    }
    // Default to pickup or halfway point
    return {
      lat: (journey.pickupLocation.latitude + journey.hospitalDestination.latitude) / 2,
      lng: (journey.pickupLocation.longitude + journey.hospitalDestination.longitude) / 2,
    };
  }, [journey]);

  // Determine which leg is active
  const isLeg1Active =
    journey.currentState === 'PARTNER_ARRIVED' ||
    journey.currentState === 'PATIENT_PICKED_UP' ||
    journey.currentState === 'IN_TRANSIT_TO_HOSPITAL';

  const isLeg2Active =
    journey.currentState === 'RETURN_STARTED' ||
    journey.currentState === 'IN_TRANSIT_TO_HOME';

  const isAtHospital =
    journey.currentState === 'ARRIVED_AT_HOSPITAL' ||
    journey.currentState === 'HOSPITAL_VISIT';

  // Fallback View when API key is missing or quota/network failed
  if (!isMapsConfigured || mapError || quotaExceeded) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-teal-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Journey Route & Location Overview
            </h3>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
            Booking Route Data
          </span>
        </div>

        {quotaExceeded ? (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
            Google Maps Platform quota reached. Route details are displayed from booking data.
          </div>
        ) : !isMapsConfigured ? (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
            <span className="font-semibold block mb-0.5">Map Visualization Fallback:</span>
            Google Maps API key not configured in environment (VITE_GOOGLE_MAPS_API_KEY).
            Displaying authoritative route and milestone endpoints from domain booking.
          </div>
        ) : null}

        {/* Two-Leg Route Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className={`p-3.5 rounded-xl border ${isLeg1Active ? 'border-teal-500 bg-teal-50/50 ring-1 ring-teal-200' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5 text-teal-600" />
                Leg 1: Outbound to Hospital
              </span>
              {isLeg1Active && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-teal-600 text-white font-bold uppercase">
                  Active Leg
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-600 mt-1">
              <strong>Pickup:</strong> {journey.pickupLocation.address}
            </p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              <strong>Destination:</strong> {journey.hospitalDestination.name}
            </p>
            {routeInfo && (
              <div className="mt-2 pt-2 border-t border-slate-200/60 flex justify-between text-[11px] text-slate-500 font-mono">
                <span>Distance: {routeInfo.leg1Outbound.distanceText}</span>
                <span>Est. Time: {routeInfo.leg1Outbound.durationText}</span>
              </div>
            )}
          </div>

          <div className={`p-3.5 rounded-xl border ${isLeg2Active ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-200' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                <Home className="w-3.5 h-3.5 text-indigo-600" />
                Leg 2: Return Journey Home
              </span>
              {isLeg2Active && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-600 text-white font-bold uppercase">
                  Active Leg
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-600 mt-1">
              <strong>From:</strong> {journey.hospitalDestination.name}
            </p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              <strong>Return Drop-Off:</strong> {journey.returnDropoffLocation.address}
            </p>
            {routeInfo && (
              <div className="mt-2 pt-2 border-t border-slate-200/60 flex justify-between text-[11px] text-slate-500 font-mono">
                <span>Distance: {routeInfo.leg2Return.distanceText}</span>
                <span>Est. Time: {routeInfo.leg2Return.durationText}</span>
              </div>
            )}
          </div>
        </div>

        {/* Hospital Accompaniment Banner during visit */}
        {isAtHospital && (
          <div className="p-3 bg-teal-50 border border-teal-300 rounded-xl text-xs text-teal-950 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <HeartHandshake className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block">Care Partner is accompanying you during your hospital visit.</span>
                <span className="text-[11px] text-teal-800">
                  Companion remains on-site with patient. Return journey activates when consultation finishes.
                </span>
              </div>
            </div>
            {onReadyToReturn && (
              <button
                type="button"
                onClick={onReadyToReturn}
                className="px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg font-bold text-[11px] shrink-0 cursor-pointer"
              >
                Ready to return home
              </button>
            )}
          </div>
        )}

        <div className="text-[10px] text-slate-400 italic text-center">
          Note: Route distance and duration are informational estimates. Pricing and journey progress are governed authoritatively by the Neravu domain engine.
        </div>
      </div>
    );
  }

  // Interactive Google Map View (when API key is present)
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
      {/* Header with Route Summary & Active Leg */}
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <div>
          <span className="font-bold text-slate-900 flex items-center gap-1.5">
            <Compass className="w-4 h-4 text-teal-600" />
            Interactive Journey Route (Google Maps Platform)
          </span>
          <span className="text-[11px] text-slate-500 block mt-0.5">
            Two-leg round-trip route: Home ↔ {journey.hospitalDestination.name}
          </span>
        </div>

        {routeInfo && (
          <div className="flex items-center gap-2 font-mono text-[11px] bg-white px-2.5 py-1 rounded-lg border border-slate-200">
            <span className="text-slate-600">Total: {routeInfo.totalDistanceText}</span>
            <span className="text-slate-300">•</span>
            <span className="text-teal-700 font-semibold">Est. {routeInfo.totalDurationText}</span>
          </div>
        )}
      </div>

      {/* Hospital Visit Accompaniment Callout Banner */}
      {isAtHospital && (
        <div className="p-3 bg-teal-50 border-b border-teal-200 text-xs text-teal-950 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HeartHandshake className="w-4 h-4 text-teal-700" />
            <span className="font-semibold">
              Care Partner is accompanying you during your hospital visit.
            </span>
          </div>
          {onReadyToReturn && (
            <button
              type="button"
              onClick={onReadyToReturn}
              className="px-3 py-1 bg-teal-700 hover:bg-teal-800 text-white rounded-lg font-bold text-[11px] cursor-pointer"
            >
              Ready to return home
            </button>
          )}
        </div>
      )}

      {/* Map Container */}
      <div className="relative w-full h-[360px]">
        <APIProvider apiKey={apiKey} libraries={['places', 'routes', 'geometry']}>
          <Map
            mapId="DEMO_MAP_ID"
            defaultCenter={center}
            defaultZoom={13}
            gestureHandling="cooperative"
            disableDefaultUI={false}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            className="w-full h-full"
          >
            {/* Pickup / Home Marker */}
            <AdvancedMarker
              position={{
                lat: journey.pickupLocation.latitude,
                lng: journey.pickupLocation.longitude,
              }}
              title="Pickup: Home Residence"
            >
              <div className="flex items-center justify-center p-1.5 bg-emerald-600 text-white rounded-full shadow-md border-2 border-white ring-2 ring-emerald-200">
                <Home className="w-4 h-4" />
              </div>
            </AdvancedMarker>

            {/* Hospital Destination Marker */}
            <AdvancedMarker
              position={{
                lat: journey.hospitalDestination.latitude,
                lng: journey.hospitalDestination.longitude,
              }}
              title={`Medical Destination: ${journey.hospitalDestination.name}`}
            >
              <div className="flex items-center justify-center p-1.5 bg-rose-600 text-white rounded-full shadow-md border-2 border-white ring-2 ring-rose-200">
                <MapPin className="w-4 h-4" />
              </div>
            </AdvancedMarker>

            {/* Care Partner Marker (Truthfully labeled as booking location) */}
            {showCarePartnerLocation && journey.carePartnerId && (
              <AdvancedMarker
                position={{
                  lat: isAtHospital
                    ? journey.hospitalDestination.latitude
                    : isLeg2Active
                    ? (journey.hospitalDestination.latitude + journey.returnDropoffLocation.latitude) / 2
                    : isLeg1Active
                    ? (journey.pickupLocation.latitude + journey.hospitalDestination.latitude) / 2
                    : journey.pickupLocation.latitude,
                  lng: isAtHospital
                    ? journey.hospitalDestination.longitude
                    : isLeg2Active
                    ? (journey.hospitalDestination.longitude + journey.returnDropoffLocation.longitude) / 2
                    : isLeg1Active
                    ? (journey.pickupLocation.longitude + journey.hospitalDestination.longitude) / 2
                    : journey.pickupLocation.longitude,
                }}
                title="Care Partner (Location from booking data)"
              >
                <div className="flex items-center justify-center p-1.5 bg-indigo-600 text-white rounded-full shadow-md border-2 border-white ring-2 ring-indigo-200">
                  <Car className="w-4 h-4" />
                </div>
              </AdvancedMarker>
            )}

            {/* Polylines for Two-Leg Routing */}
            {routeInfo?.leg1Outbound.polylinePoints && (
              <MapPolyline
                path={routeInfo.leg1Outbound.polylinePoints}
                strokeColor="#0d9488"
                strokeWeight={isLeg1Active ? 5 : 3}
                isActive={isLeg1Active}
              />
            )}

            {routeInfo?.leg2Return.polylinePoints && (
              <MapPolyline
                path={routeInfo.leg2Return.polylinePoints}
                strokeColor="#4f46e5"
                strokeWeight={isLeg2Active ? 5 : 3}
                isActive={isLeg2Active}
              />
            )}
          </Map>
        </APIProvider>

        {/* Non-fake GPS honesty label */}
        <div className="absolute bottom-2 left-2 z-10 bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-md text-[10px] text-slate-600 border border-slate-200 shadow-2xs">
          Care Partner position: Location from booking data (Live GPS not connected)
        </div>
      </div>
    </div>
  );
};
