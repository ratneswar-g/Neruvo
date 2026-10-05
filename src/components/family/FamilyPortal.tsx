import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthContext.tsx';
import { neravuApi } from '../../services/api-client.ts';
import { Journey, CarePartnerProfile, ContactPermissionLevel } from '../../domain/types/index.ts';
import { JourneyTimeline } from '../common/JourneyTimeline.tsx';
import { NeravuJourneyMap } from '../maps/NeravuJourneyMap.tsx';
import {
  ShieldCheck,
  HeartHandshake,
  MapPin,
  Clock,
  AlertTriangle,
  Lock,
  Phone,
  Eye,
  RefreshCw,
  WifiOff,
} from 'lucide-react';

export const FamilyPortal: React.FC = () => {
  const { currentUser } = useAuth();
  const [activeJourney, setActiveJourney] = useState<Journey | null>(null);
  const [carePartnerProfile, setCarePartnerProfile] = useState<CarePartnerProfile | null>(null);
  const [permissionLevel, setPermissionLevel] = useState<ContactPermissionLevel>('FULL_STATUS');
  const [apiError, setApiError] = useState<string | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>(new Date().toLocaleTimeString());

  // In our seeded domain, Anand Narayanan (dev-user-family-1) is authorized for Smt. Lakshmi Narayanan (dev-user-patient-1)
  const authorizedPatientId = 'dev-user-patient-1';

  const loadData = async () => {
    try {
      // 1. Fetch authorized journeys from the server API
      const journeys = await neravuApi.getJourneys();
      const patientJourney = journeys.find(
        (j) => j.patientId === authorizedPatientId && j.currentState !== 'COMPLETED' && j.currentState !== 'CANCELLED'
      ) || (journeys.length > 0 ? journeys[0] : null);

      if (patientJourney) {
        // Fetch detailed journey through API which applies backend permission scope & redaction
        const detailed = await neravuApi.getJourneyById(patientJourney.id);
        setActiveJourney(detailed || patientJourney);

        if (patientJourney.carePartnerId && permissionLevel === 'FULL_STATUS') {
          const partner = await neravuApi.getCarePartnerProfile(patientJourney.carePartnerId);
          setCarePartnerProfile(partner);
        } else {
          setCarePartnerProfile(null);
        }
      } else {
        setActiveJourney(null);
        setCarePartnerProfile(null);
      }

      setLastSyncedTime(new Date().toLocaleTimeString());
      setApiError(null);
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Unable to connect to the Neravu server.');
    }
  };

  useEffect(() => {
    loadData();
    // Conservative HTTP polling: every 4 seconds to sync authoritative journey status from backend
    const interval = setInterval(() => {
      loadData();
    }, 4000);
    return () => clearInterval(interval);
  }, [currentUser, permissionLevel]);

  if (!currentUser) return null;

  return (
    <div className="space-y-6">
      {/* Network / Server Error Notice */}
      {apiError && (
        <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex items-center justify-between text-amber-900 text-xs shadow-2xs">
          <div className="flex items-center gap-2.5">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Server Communication Notice:</strong> {apiError}
            </span>
          </div>
          <button
            type="button"
            onClick={loadData}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shrink-0 cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900">
              Family & Trusted Contact Portal
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              Read-Only Status
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Monitoring medical journey accompaniment for <strong className="text-slate-700">[DEMO] Smt. Lakshmi Narayanan</strong> (Mother)
          </p>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-2">
            <RefreshCw className="w-3 h-3 text-blue-600 animate-spin-slow" />
            <span>Automatically refreshed from the server (Last sync: {lastSyncedTime})</span>
          </div>
        </div>

        {/* Permission Tier Switcher for Testing Verification */}
        <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200 text-xs">
          <span className="text-[10px] font-bold uppercase text-slate-400">Permission:</span>
          {(['FULL_STATUS', 'LIVE_LOCATION', 'EMERGENCY_ONLY'] as ContactPermissionLevel[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPermissionLevel(p)}
              className={`px-2 py-1 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                permissionLevel === p
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white hover:bg-slate-200 text-slate-600 border border-slate-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Read-Only Safety Protocol Notice */}
      <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 flex items-center gap-3 text-xs shadow-2xs">
        <Lock className="w-4 h-4 text-slate-500 shrink-0" />
        <div>
          <span className="font-semibold text-slate-900">Read-Only Observer Access:</span>{' '}
          Family and trusted contacts receive development journey status and safety notifications.
          To preserve patient autonomy and service integrity, state progression is handled by the Patient and Care Partner.
        </div>
      </div>

      {/* Emergency Alert Banner */}
      {activeJourney?.currentState === 'EMERGENCY_ACTIVE' && (
        <div className="p-4 bg-red-100 border-2 border-red-500 rounded-2xl text-red-950 text-xs shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-sm block">EMERGENCY PROTOCOL ACTIVATED</span>
              <p className="mt-1">
                An SOS alert was triggered for this journey. Neravu Operations Desk has been notified and is coordinating immediate support.
              </p>
              <div className="mt-3 flex flex-wrap gap-3">
                <a
                  href="tel:112"
                  className="px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white rounded-lg font-bold flex items-center gap-1.5"
                >
                  <Phone className="w-3.5 h-3.5" /> Call 112
                </a>
                {activeJourney.hospitalDestination.emergencyContactPhone ? (
                  <a
                    href={`tel:${activeJourney.hospitalDestination.emergencyContactPhone}`}
                    className="px-3 py-1.5 bg-white border border-red-300 text-red-900 rounded-lg font-bold flex items-center gap-1.5"
                  >
                    <Phone className="w-3.5 h-3.5" /> Call Hospital Desk: {activeJourney.hospitalDestination.emergencyContactPhone}
                  </a>
                ) : (
                  <span className="px-3 py-1.5 bg-white/80 border border-red-200 text-red-800 rounded-lg font-medium flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-red-400" /> Hospital emergency contact: Not configured
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ACTIVE JOURNEY DISPLAY ACCORDING TO PERMISSION TIER */}
      {activeJourney ? (
        <>
          {/* CASE 1: EMERGENCY_ONLY PERMISSION */}
          {permissionLevel === 'EMERGENCY_ONLY' && activeJourney.currentState !== 'EMERGENCY_ACTIVE' && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-2xs">
              <Eye className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">
                Permission Tier: EMERGENCY_ONLY
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                Your authorization is restricted to emergency alerts only. Routine journey milestones and locations are hidden.
                If an emergency SOS is triggered by the patient or Care Partner, full emergency status and coordinates will display here immediately.
              </p>
            </div>
          )}

          {/* CASE 2: FULL_STATUS or LIVE_LOCATION (or EMERGENCY_ACTIVE) */}
          {(permissionLevel === 'FULL_STATUS' ||
            permissionLevel === 'LIVE_LOCATION' ||
            activeJourney.currentState === 'EMERGENCY_ACTIVE') && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Permitted Journey Map */}
                <NeravuJourneyMap
                  journey={activeJourney}
                  showCarePartnerLocation={permissionLevel === 'FULL_STATUS'}
                />

                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
                  <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        Monitored Journey (Development Status)
                      </span>
                      <h2 className="text-base font-bold text-slate-900 mt-0.5">
                        {activeJourney.hospitalDestination.name}
                      </h2>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-mono px-3 py-1 rounded-full bg-blue-50 text-blue-800 font-bold border border-blue-200">
                        {activeJourney.currentState.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-1 font-mono">
                        ID: {activeJourney.id}
                      </span>
                    </div>
                  </div>

                  {/* Hospital Accompaniment Status Indicator (FULL_STATUS only) */}
                  {permissionLevel === 'FULL_STATUS' && activeJourney.currentState === 'HOSPITAL_VISIT' && (
                    <div className="my-5 p-4 bg-teal-50 border border-teal-300 rounded-xl text-xs text-teal-900">
                      <div className="flex items-center gap-2 font-bold mb-1">
                        <HeartHandshake className="w-4 h-4 text-teal-600" />
                        Care Partner is Accompanying Smt. Lakshmi at the Hospital
                      </div>
                      <p className="text-teal-800 leading-relaxed">
                        The companion is currently on-site waiting with your family member during their consultation.
                        The return journey has not started yet. You will be alerted when the return leg commences.
                      </p>
                    </div>
                  )}

                  {/* Locations summary (Allowed for FULL_STATUS and LIVE_LOCATION) */}
                  <div className="my-5 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Location Information (Location shown from booking data)
                      </span>
                      <span className="text-[10px] text-slate-400 italic">
                        GPS provider not connected in development mode
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold uppercase text-slate-500">Pickup Origin:</span>
                      <p className="font-semibold text-slate-900">{activeJourney.pickupLocation.address}</p>
                    </div>
                    <div className="pt-2 border-t border-slate-200">
                      <span className="text-[10px] font-bold uppercase text-slate-500">Hospital Destination:</span>
                      <p className="font-semibold text-teal-900">{activeJourney.hospitalDestination.name}</p>
                      <p className="text-slate-500 text-[11px]">{activeJourney.hospitalDestination.entranceOrDepartment || activeJourney.hospitalDestination.address}</p>
                    </div>
                    <div className="pt-2 border-t border-slate-200">
                      <span className="text-[10px] font-bold uppercase text-slate-500">Agreed Return Drop-Off:</span>
                      <p className="font-semibold text-slate-900">{activeJourney.returnDropoffLocation.address}</p>
                    </div>
                  </div>

                  {/* Assigned Companion Details (FULL_STATUS only) */}
                  {permissionLevel === 'FULL_STATUS' && carePartnerProfile && (
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-600 text-white rounded-xl">
                          <HeartHandshake className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="text-xs font-bold text-slate-900 block">
                            Assigned Companion: [DEMO] Ramesh Kumar (Test Companion)
                          </span>
                          <span className="text-[11px] text-slate-600 block">
                            Vehicle: {carePartnerProfile.vehicle.make} {carePartnerProfile.vehicle.model} ({carePartnerProfile.vehicle.licensePlate})
                          </span>
                          <span className="text-[11px] text-emerald-700 font-semibold block">
                            Verified Non-Clinical Care Partner
                          </span>
                        </div>
                      </div>
                      <a
                        href="tel:+919800000002"
                        className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100 flex items-center gap-1.5"
                      >
                        <Phone className="w-3.5 h-3.5" /> Call Companion
                      </a>
                    </div>
                  )}

                  {permissionLevel === 'LIVE_LOCATION' && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
                      <span className="font-semibold">Permission Notice:</span> You are viewing in <strong>LIVE_LOCATION</strong> mode.
                      Personal health notes and Care Partner details are restricted.
                    </div>
                  )}
                </div>
              </div>

              {/* Timeline (Only displayed if permission allows status progression, i.e. FULL_STATUS) */}
              <div>
                {permissionLevel === 'FULL_STATUS' ? (
                  <JourneyTimeline currentState={activeJourney.currentState} />
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 p-5 text-center text-xs text-slate-500">
                    <Clock className="w-6 h-6 text-slate-400 mx-auto mb-2" />
                    Milestone progress timeline is restricted under <strong>{permissionLevel}</strong> tier.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-2xs">
          <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-slate-800">No Active Journey Right Now</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            When Smt. Lakshmi requests a Care Partner for an upcoming appointment, journey status will appear here automatically.
          </p>
        </div>
      )}
    </div>
  );
};
