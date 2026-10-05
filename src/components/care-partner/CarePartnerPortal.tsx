import React, { useState, useEffect } from 'react';
import { useAuth } from '../../auth/AuthContext.tsx';
import { neravuApi } from '../../services/api-client.ts';
import { Journey, CarePartnerProfile, JourneyState } from '../../domain/types/index.ts';
import { JourneyTimeline } from '../common/JourneyTimeline.tsx';
import { EmergencyModal } from '../common/EmergencyModal.tsx';
import { NeravuJourneyMap } from '../maps/NeravuJourneyMap.tsx';
import {
  HeartHandshake,
  Car,
  ShieldCheck,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  ShieldAlert,
  Power,
  User,
  RefreshCw,
  WifiOff,
} from 'lucide-react';

export const CarePartnerPortal: React.FC = () => {
  const { currentUser } = useAuth();
  const [partnerProfile, setPartnerProfile] = useState<CarePartnerProfile | null>(null);
  const [activeJourney, setActiveJourney] = useState<Journey | null>(null);
  const [offeredJourneys, setOfferedJourneys] = useState<Journey[]>([]);
  const [isSosOpen, setIsSosOpen] = useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [lastSyncedTime, setLastSyncedTime] = useState<string>(new Date().toLocaleTimeString());

  const loadData = async () => {
    if (!currentUser) return;
    try {
      const [profile, journeys] = await Promise.all([
        neravuApi.getCarePartnerProfile(currentUser.id),
        neravuApi.getJourneys(),
      ]);

      setPartnerProfile(profile);

      // Active journey: Assigned to this partner and not COMPLETED / CANCELLED
      const assigned = journeys.find(
        (j) => j.carePartnerId === currentUser.id && j.currentState !== 'COMPLETED' && j.currentState !== 'CANCELLED'
      ) || null;
      setActiveJourney(assigned);

      // Offered journeys: Currently in MATCHING state
      const offered = journeys.filter((j) => j.currentState === 'MATCHING');
      setOfferedJourneys(offered);

      setLastSyncedTime(new Date().toLocaleTimeString());
      setApiError(null);
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Unable to connect to the Neravu server.');
    }
  };

  useEffect(() => {
    loadData();
    // Conservative HTTP polling: every 4 seconds to sync dispatch offers and milestone status
    const interval = setInterval(() => {
      loadData();
    }, 4000);
    return () => clearInterval(interval);
  }, [currentUser]);

  if (!currentUser) return null;

  // Toggle Availability via backend API
  const handleToggleAvailability = async () => {
    if (!partnerProfile) return;
    const newStatus = partnerProfile.availabilityStatus === 'AVAILABLE' ? 'OFFLINE' : 'AVAILABLE';
    setIsActionLoading(true);
    setApiError(null);
    try {
      const updated = await neravuApi.setCarePartnerAvailability(newStatus);
      setPartnerProfile(updated);
      await loadData();
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to update duty availability.');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Accept Offered Journey via backend API
  const handleAcceptJourney = async (journeyId: string) => {
    setIsActionLoading(true);
    setApiError(null);
    try {
      await neravuApi.acceptJourney(journeyId);
      await loadData();
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to accept journey.');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Advance Journey Milestone via backend API
  const handleAdvanceMilestone = async (targetState: JourneyState, note?: string) => {
    if (!activeJourney) return;
    setIsActionLoading(true);
    setApiError(null);
    try {
      await neravuApi.advanceMilestone(activeJourney.id, targetState, { note });
      await loadData();
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to advance milestone.');
    } finally {
      setIsActionLoading(false);
    }
  };

  // Handle SOS via backend API
  const handleConfirmSos = async (reason: string, category?: any) => {
    if (!activeJourney || !currentUser) return;
    setApiError(null);
    try {
      await neravuApi.triggerEmergency(activeJourney.id, {
        category,
        reason,
        locationSnapshot: activeJourney.pickupLocation,
      });
      await loadData();
    } catch (err: any) {
      setApiError(err.userFriendlyMessage || err.message || 'Failed to trigger emergency.');
    }
  };

  // Determine Next Legitimate Action for Care Partner based on state
  const getNextAction = (state: JourneyState) => {
    switch (state) {
      case 'PARTNER_ASSIGNED':
        return {
          target: 'PARTNER_EN_ROUTE' as JourneyState,
          label: 'Start Travel to Patient Pickup',
          description: 'Signal that you are driving toward the patient residence',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'PARTNER_EN_ROUTE':
        return {
          target: 'PARTNER_ARRIVED' as JourneyState,
          label: 'Mark Arrived at Patient Home',
          description: 'Signal arrival at the patient doorway/gate',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'PARTNER_ARRIVED':
        return {
          target: 'PATIENT_PICKED_UP' as JourneyState,
          label: 'Confirm Patient Assisted & In Vehicle',
          description: 'Patient safely met and seated with seatbelt fastened',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'PATIENT_PICKED_UP':
        return {
          target: 'IN_TRANSIT_TO_HOSPITAL' as JourneyState,
          label: 'Start Transit to Hospital (Leg 1)',
          description: 'Driving to medical destination facility',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'IN_TRANSIT_TO_HOSPITAL':
        return {
          target: 'ARRIVED_AT_HOSPITAL' as JourneyState,
          label: 'Mark Arrived at Hospital Drop-Off',
          description: 'Vehicle parked at hospital patient assistance bay',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'ARRIVED_AT_HOSPITAL':
        return {
          target: 'HOSPITAL_VISIT' as JourneyState,
          label: 'Begin Hospital Accompaniment & Waiting',
          description: 'Assist patient inside clinic; stay with patient during visit',
          color: 'bg-teal-600 hover:bg-teal-700',
        };
      case 'HOSPITAL_VISIT':
        return {
          target: 'RETURN_STARTED' as JourneyState,
          label: 'Start Return Journey (Visit Concluded)',
          description: 'Patient finished appointment; escorting back to vehicle',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'RETURN_STARTED':
        return {
          target: 'IN_TRANSIT_TO_HOME' as JourneyState,
          label: 'Start Transit Home (Leg 2)',
          description: 'Driving patient back to residence',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'IN_TRANSIT_TO_HOME':
        return {
          target: 'PATIENT_RETURNED_HOME' as JourneyState,
          label: 'Confirm Patient Safely Returned Home',
          description: 'Assisted patient from vehicle safely inside home entrance',
          color: 'bg-indigo-600 hover:bg-indigo-700',
        };
      case 'PATIENT_RETURNED_HOME':
        return {
          target: 'COMPLETED' as JourneyState,
          label: 'Complete Round-Trip Journey',
          description: 'Patient is safe indoors; service concluded',
          color: 'bg-emerald-600 hover:bg-emerald-700',
        };
      default:
        return null;
    }
  };

  const nextAction = activeJourney ? getNextAction(activeJourney.currentState) : null;

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
              Care Partner Desk: {currentUser.name}
            </h1>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              Verified Companion
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Dedicated Medical Accompaniment & Safe Transport Service
          </p>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-2">
            <RefreshCw className="w-3 h-3 text-indigo-600 animate-spin-slow" />
            <span>Automatically refreshed from the server (Last sync: {lastSyncedTime})</span>
          </div>
        </div>

        {/* Availability Toggle */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Duty Status
            </span>
            <span
              className={`text-xs font-bold ${
                partnerProfile?.availabilityStatus === 'AVAILABLE'
                  ? 'text-emerald-600'
                  : partnerProfile?.availabilityStatus === 'ON_JOURNEY'
                  ? 'text-indigo-600'
                  : 'text-slate-400'
              }`}
            >
              {partnerProfile?.availabilityStatus}
            </span>
          </div>

          <button
            type="button"
            disabled={partnerProfile?.availabilityStatus === 'ON_JOURNEY'}
            onClick={handleToggleAvailability}
            className={`p-2.5 rounded-xl border transition-all cursor-pointer disabled:opacity-50 ${
              partnerProfile?.availabilityStatus === 'AVAILABLE'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                : 'bg-slate-100 border-slate-300 text-slate-600'
            }`}
          >
            <Power className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Safety & Non-Clinical Scope Notice */}
      <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/70 text-blue-950 flex items-start gap-3 text-xs leading-relaxed shadow-2xs">
        <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-blue-900 block mb-0.5">
            Care Partner Safety Boundary
          </span>
          Care Partners provide transportation, mobility assistance, physical escort, and hospital waiting accompaniment.
          Care Partners are <strong>strictly non-clinical companions</strong> and must never administer medication, medical treatment, or clinical procedures.
        </div>
      </div>

      {/* OFFERED JOURNEYS (MATCHING DISPATCHES) */}
      {!activeJourney && offeredJourneys.length > 0 && (
        <div className="bg-white rounded-2xl border border-amber-300 p-6 shadow-2xs">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-amber-600" />
            <h2 className="text-base font-bold text-slate-900">
              New Journey Dispatch Offers ({offeredJourneys.length})
            </h2>
          </div>

          <div className="space-y-4">
            {offeredJourneys.map((j) => (
              <div
                key={j.id}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">
                      Destination: {j.hospitalDestination.name}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-teal-100 text-teal-800 font-mono">
                      Round Trip
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    <span className="font-semibold">Pickup:</span> {j.pickupLocation.address}
                  </p>
                  <p className="text-xs text-slate-600">
                    <span className="font-semibold">Return Drop-Off:</span> {j.returnDropoffLocation.address}
                  </p>
                  {j.specialAssistanceNotes && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 px-2 py-1 rounded border border-amber-200 inline-block">
                      Note: {j.specialAssistanceNotes}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={isActionLoading}
                  onClick={() => handleAcceptJourney(j.id)}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm shrink-0 cursor-pointer disabled:opacity-50"
                >
                  Accept Dispatch
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ACTIVE ASSIGNED JOURNEY CONSOLE */}
      {activeJourney && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Interactive Journey Map */}
            <NeravuJourneyMap journey={activeJourney} />

            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                    Active Assigned Journey
                  </span>
                  <h2 className="text-base font-bold text-slate-900 mt-0.5">
                    {activeJourney.hospitalDestination.name}
                  </h2>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono px-3 py-1 rounded-full bg-indigo-50 text-indigo-800 font-bold border border-indigo-200">
                    {activeJourney.currentState}
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-1 font-mono">
                    ID: {activeJourney.id}
                  </span>
                </div>
              </div>

              {/* CRITICAL HOSPITAL VISIT BANNER FOR PARTNER */}
              {activeJourney.currentState === 'HOSPITAL_VISIT' && (
                <div className="my-5 p-5 bg-teal-50 border-2 border-teal-500 rounded-2xl shadow-xs">
                  <div className="flex items-start gap-3">
                    <HeartHandshake className="w-6 h-6 text-teal-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-xs font-bold text-teal-950 uppercase tracking-wider block">
                        Hospital Accompaniment Protocol Active
                      </span>
                      <p className="text-xs text-teal-900 mt-1 leading-relaxed">
                        <strong>Stay with the patient during the hospital visit.</strong> The Care Partner does not leave.
                        Wait with the patient in the consultation / testing area. You are providing reassurance, mobility support, and return transport.
                      </p>
                      <span className="text-[11px] font-bold text-teal-800 block mt-2">
                        DO NOT attempt to complete the journey here. The booking completes only after safely returning the patient home.
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Location details */}
              <div className="my-5 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Location Details (Location shown from booking data)
                  </span>
                  <span className="text-[10px] text-slate-400 italic">
                    GPS provider not connected
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase text-slate-500">Pickup Address:</span>
                  <p className="font-semibold text-slate-900">{activeJourney.pickupLocation.address}</p>
                  <p className="text-slate-500 text-[11px]">Landmark: {activeJourney.pickupLocation.landmark}</p>
                </div>
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-500">Hospital Bay / Clinic:</span>
                  <p className="font-semibold text-teal-900">{activeJourney.hospitalDestination.entranceOrDepartment || activeJourney.hospitalDestination.name}</p>
                </div>
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-500">Return Drop-Off:</span>
                  <p className="font-semibold text-slate-900">{activeJourney.returnDropoffLocation.address}</p>
                </div>
              </div>

              {/* Sequential Milestone Action Button */}
              {nextAction && (
                <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/50">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 block mb-1">
                    Next Required Operational Milestone:
                  </span>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <span className="text-sm font-bold text-slate-900 block">
                        {nextAction.label}
                      </span>
                      <span className="text-xs text-slate-600 block mt-0.5">
                        {nextAction.description}
                      </span>
                    </div>

                    <button
                      type="button"
                      disabled={isActionLoading}
                      onClick={() => handleAdvanceMilestone(nextAction.target)}
                      className={`px-5 py-2.5 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-2 cursor-pointer shrink-0 disabled:opacity-50 ${nextAction.color}`}
                    >
                      <ArrowRight className="w-4 h-4" />
                      {nextAction.label}
                    </button>
                  </div>
                </div>
              )}

              {/* Emergency SOS Button for Partner */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Encountered road delay, medical distress, or accident?
                </span>
                <button
                  type="button"
                  onClick={() => setIsSosOpen(true)}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-2xs flex items-center gap-1.5 cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Trigger Emergency SOS
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Live Timeline */}
          <div>
            <JourneyTimeline currentState={activeJourney.currentState} />
          </div>
        </div>
      )}

      {/* Profile & Vehicle Card */}
      {partnerProfile && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-2xs">
          <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Car className="w-4 h-4 text-indigo-600" />
            Registered Vehicle & Accommodations
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Vehicle</span>
              <p className="font-semibold text-slate-900 mt-1">
                {partnerProfile.vehicle.make} {partnerProfile.vehicle.model} ({partnerProfile.vehicle.year})
              </p>
              <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                Plate: {partnerProfile.vehicle.licensePlate} • Color: {partnerProfile.vehicle.color}
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Accessibility Specs</span>
              <p className="text-slate-700 mt-1">
                {partnerProfile.vehicle.isWheelchairAccessible ? '✓ Wheelchair Accessible' : 'Standard Ingress'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {partnerProfile.vehicle.accommodationsDescription}
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Service History</span>
              <p className="font-semibold text-slate-900 mt-1">
                {partnerProfile.totalJourneysCompleted} Completed Round Trips
              </p>
              <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                Verification: {partnerProfile.verificationStatus}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* SOS Modal */}
      <EmergencyModal
        isOpen={isSosOpen}
        onClose={() => setIsSosOpen(false)}
        onConfirmSos={handleConfirmSos}
        hospitalPhone={activeJourney?.hospitalDestination.emergencyContactPhone}
      />
    </div>
  );
};
