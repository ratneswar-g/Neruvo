import React, { useState } from 'react';
import { AlertTriangle, Phone, X, ShieldAlert } from 'lucide-react';
import { EmergencyCategory, VALID_EMERGENCY_CATEGORIES } from '../../domain/types/index.ts';

interface EmergencyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmSos: (reason: string, category?: EmergencyCategory) => Promise<void>;
  hospitalPhone?: string;
}

export const EmergencyModal: React.FC<EmergencyModalProps> = ({
  isOpen,
  onClose,
  onConfirmSos,
  hospitalPhone,
}) => {
  const [category, setCategory] = useState<EmergencyCategory>('MEDICAL_EMERGENCY');
  const [reason, setReason] = useState<string>('Patient requires urgent medical evaluation or road assistance');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      await onConfirmSos(reason, category);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-red-200 animate-in fade-in zoom-in duration-150">
        <div className="flex items-center justify-between pb-3 border-b border-red-100">
          <div className="flex items-center gap-2.5 text-red-600">
            <div className="p-2 bg-red-100 rounded-xl">
              <ShieldAlert className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Activate Emergency SOS</h3>
              <p className="text-xs text-red-600 font-medium">In-Journey Critical Alert Protocol</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-xs text-slate-600 leading-relaxed">
            Activating Emergency SOS transitions this journey to <strong>EMERGENCY_ACTIVE</strong>.
            The Neravu Operations Desk and your linked family contacts will be alerted with current coordinates and journey state.
          </p>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Emergency Incident Classification:
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as EmergencyCategory)}
              className="w-full text-xs p-2 border border-slate-300 rounded-lg bg-white focus:outline-hidden focus:ring-2 focus:ring-red-500 mb-2 font-medium"
            >
              <option value="MEDICAL_EMERGENCY">Medical Emergency (Acute symptoms; user-initiated 112 dialing)</option>
              <option value="SAFETY_CONCERN">Safety Concern (Road danger, vehicle breakdown, hazard)</option>
              <option value="ACCIDENT">Traffic / Slip & Fall Incident</option>
              <option value="PATIENT_DISTRESS">Patient Distress / Severe Anxiety / Disorientation</option>
              <option value="OTHER">Other Urgent Incident</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Operational Incident Description (Non-clinical coordination):
            </label>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full text-xs p-2.5 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-red-500"
              placeholder="Operational description (e.g. companion delayed, safe stop requested, 112 called)..."
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              Neravu provides non-clinical accompaniment. Notes are for operational coordination only; no medical or diagnostic data is recorded.
            </span>
          </div>

          <div className="p-3 bg-red-50 rounded-xl border border-red-200">
            <span className="text-[11px] font-bold text-red-900 block mb-1">
              Direct Telephone Action (User-Initiated Call):
            </span>
            <div className="flex flex-col gap-1.5 text-xs text-red-800">
              <a
                href="tel:112"
                className="flex items-center gap-1.5 font-bold hover:underline"
              >
                <Phone className="w-3.5 h-3.5" /> Call 112
              </a>
              {hospitalPhone ? (
                <a
                  href={`tel:${hospitalPhone}`}
                  className="flex items-center gap-1.5 hover:underline text-[11px]"
                >
                  <Phone className="w-3 h-3" /> Call Hospital Emergency: {hospitalPhone}
                </a>
              ) : (
                <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-slate-400" /> Hospital emergency contact: Not configured
                </span>
              )}
            </div>
          </div>

          <div className="text-[11px] text-slate-500 leading-normal">
            Notice: This triggers internal domain status EMERGENCY_ACTIVE and alerts operations. The application does not automatically contact or dispatch external emergency services (112); use the Call 112 button above to place a direct phone call if immediate help is required.
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm flex items-center gap-1.5"
          >
            <AlertTriangle className="w-4 h-4" />
            {isSubmitting ? 'Transmitting Alert...' : 'CONFIRM EMERGENCY SOS'}
          </button>
        </div>
      </div>
    </div>
  );
};
