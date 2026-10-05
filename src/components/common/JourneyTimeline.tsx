import React from 'react';
import { JourneyState } from '../../domain/types/journey.ts';
import { Check, Circle, AlertTriangle, Clock } from 'lucide-react';

interface JourneyTimelineProps {
  currentState: JourneyState;
}

interface Milestone {
  key: JourneyState;
  label: string;
  sublabel: string;
  order: number;
}

const MILESTONES: Milestone[] = [
  { key: 'REQUESTED', label: 'Booking Requested', sublabel: 'Request received & matching nearest Care Partner', order: 1 },
  { key: 'PARTNER_ASSIGNED', label: 'Care Partner Assigned', sublabel: 'Companion verified & assigned to your journey', order: 2 },
  { key: 'PARTNER_EN_ROUTE', label: 'Care Partner Travelling to You', sublabel: 'Companion en route to your home pickup', order: 3 },
  { key: 'PARTNER_ARRIVED', label: 'Care Partner Arrived', sublabel: 'Companion arrived at your residence gate', order: 4 },
  { key: 'PATIENT_PICKED_UP', label: 'Patient Assisted & Picked Up', sublabel: 'Comfortably assisted into the vehicle', order: 5 },
  { key: 'IN_TRANSIT_TO_HOSPITAL', label: 'Travelling to Hospital', sublabel: 'Outbound Leg 1: En route to medical facility', order: 6 },
  { key: 'ARRIVED_AT_HOSPITAL', label: 'Arrived at Hospital', sublabel: 'Vehicle parked at patient assistance drop-off', order: 7 },
  { key: 'HOSPITAL_VISIT', label: 'Care Partner Accompanying You in Hospital', sublabel: 'Companion stays with you during waiting & consultation', order: 8 },
  { key: 'RETURN_STARTED', label: 'Return Journey Started', sublabel: 'Visit concluded, moving to vehicle for return leg', order: 9 },
  { key: 'IN_TRANSIT_TO_HOME', label: 'Returning Home', sublabel: 'Inbound Leg 2: Driving back to patient residence', order: 10 },
  { key: 'PATIENT_RETURNED_HOME', label: 'Patient Returned Home', sublabel: 'Safely assisted from vehicle back into residence', order: 11 },
  { key: 'COMPLETED', label: 'Journey Completed', sublabel: 'Complete round-trip service concluded safely', order: 12 },
];

const STATE_ORDER_MAP: Record<JourneyState, number> = {
  DRAFT: 0,
  REQUESTED: 1,
  MATCHING: 1,
  PARTNER_ASSIGNED: 2,
  PARTNER_EN_ROUTE: 3,
  PARTNER_ARRIVED: 4,
  PATIENT_PICKED_UP: 5,
  IN_TRANSIT_TO_HOSPITAL: 6,
  ARRIVED_AT_HOSPITAL: 7,
  HOSPITAL_VISIT: 8,
  RETURN_STARTED: 9,
  IN_TRANSIT_TO_HOME: 10,
  PATIENT_RETURNED_HOME: 11,
  COMPLETED: 12,
  CANCELLED: -1,
  PARTNER_CANCELLED: -2,
  EMERGENCY_ACTIVE: 99,
  ESCALATED: 100,
  INCIDENT_REPORTED: 101,
};

export const JourneyTimeline: React.FC<JourneyTimelineProps> = ({ currentState }) => {
  const currentOrder = STATE_ORDER_MAP[currentState] ?? 0;
  const isEmergency = currentState === 'EMERGENCY_ACTIVE';
  const isCancelled = currentState === 'CANCELLED' || currentState === 'PARTNER_CANCELLED';

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-teal-600" />
            Development Journey Status
          </h3>
          <span className="text-[10px] text-slate-400 block mt-0.5">
            Milestones updated from domain state engine • Location shown from booking data
          </span>
        </div>
        <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 font-semibold border border-slate-200">
          State: {currentState}
        </span>
      </div>

      {isEmergency && (
        <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-900 text-xs flex items-center gap-2 font-medium">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
          EMERGENCY PROTOCOL ACTIVE — Operations desk and emergency contacts alerted. Status snapshot preserved.
        </div>
      )}

      {isCancelled && (
        <div className="mb-4 p-3 bg-amber-100 border border-amber-300 rounded-lg text-amber-900 text-xs font-medium">
          Booking was cancelled prior to transit.
        </div>
      )}

      <div className="relative pl-6 space-y-4">
        {MILESTONES.map((m, idx) => {
          const isPassed = currentOrder > m.order;
          const isCurrent = currentOrder === m.order;
          const isHospitalVisit = m.key === 'HOSPITAL_VISIT';

          return (
            <div key={m.key} className="relative flex items-start group">
              {/* Vertical connector line */}
              {idx < MILESTONES.length - 1 && (
                <div
                  className={`absolute left-[-16px] top-4 w-0.5 h-[calc(100%+8px)] ${
                    isPassed ? 'bg-teal-500' : 'bg-slate-200'
                  }`}
                />
              )}

              {/* Status Indicator Icon */}
              <div
                className={`absolute left-[-22px] top-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center transition-all ${
                  isPassed
                    ? 'bg-teal-600 text-white ring-2 ring-teal-100'
                    : isCurrent
                    ? 'bg-white border-2 border-teal-600 ring-4 ring-teal-100'
                    : 'bg-white border border-slate-300 text-transparent'
                }`}
              >
                {isPassed && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-teal-600 animate-pulse" />}
              </div>

              {/* Label & Description */}
              <div className="ml-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold ${
                      isCurrent
                        ? 'text-teal-900 font-bold'
                        : isPassed
                        ? 'text-slate-800'
                        : 'text-slate-400'
                    }`}
                  >
                    {m.label}
                  </span>
                  {isCurrent && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-teal-100 text-teal-800 font-bold uppercase tracking-wider">
                      Current Milestone
                    </span>
                  )}
                </div>
                <p
                  className={`text-[11px] mt-0.5 ${
                    isCurrent
                      ? 'text-teal-700 font-medium'
                      : isPassed
                      ? 'text-slate-500'
                      : 'text-slate-400'
                  }`}
                >
                  {m.sublabel}
                </p>

                {/* Special Highlight for Hospital Visit */}
                {isHospitalVisit && isCurrent && (
                  <div className="mt-2 p-2.5 bg-teal-50/90 border border-teal-300 rounded-lg text-teal-950 text-xs shadow-2xs">
                    <span className="font-bold block mb-0.5 text-teal-900">
                      Companion On-Site Accompaniment Active
                    </span>
                    Care Partner is actively waiting with you at the clinic. Your round-trip booking remains open. When your appointment concludes, tap "Ready to return home".
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
