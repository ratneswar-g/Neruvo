import React from 'react';
import { useAuth } from '../../auth/AuthContext.tsx';
import { UserRole } from '../../domain/types/user.ts';
import { User, HeartHandshake, Users, ShieldAlert, AlertTriangle, ShieldCheck } from 'lucide-react';

export const DevLoginScreen: React.FC = () => {
  const { loginAsDevRole, isLoading } = useAuth();

  const handleSelectRole = async (role: UserRole) => {
    try {
      await loginAsDevRole(role);
    } catch (err) {
      console.error('Login failed:', err);
    }
  };

  const roleOptions: {
    role: UserRole;
    title: string;
    description: string;
    icon: React.ReactNode;
    color: string;
    identity: string;
  }[] = [
    {
      role: 'PATIENT',
      title: 'Patient',
      description: 'Medical journey requester needing hospital accompaniment & return home',
      identity: 'Smt. Lakshmi Narayanan (+91 98765 43210)',
      icon: <User className="w-6 h-6 text-teal-600" />,
      color: 'border-teal-200 hover:border-teal-500 hover:bg-teal-50/50',
    },
    {
      role: 'CARE_PARTNER',
      title: 'Care Partner',
      description: 'Dedicated companion providing vehicle transport & hospital waiting assistance',
      identity: 'Ramesh Kumar (+91 98765 43220)',
      icon: <HeartHandshake className="w-6 h-6 text-indigo-600" />,
      color: 'border-indigo-200 hover:border-indigo-500 hover:bg-indigo-50/50',
    },
    {
      role: 'FAMILY_CONTACT',
      title: 'Family / Trusted Contact',
      description: 'Authorized family member receiving live status & emergency updates',
      identity: 'Anand Narayanan (+91 98765 43230)',
      icon: <Users className="w-6 h-6 text-blue-600" />,
      color: 'border-blue-200 hover:border-blue-500 hover:bg-blue-50/50',
    },
    {
      role: 'ADMIN',
      title: 'Admin / Operations',
      description: 'Dispatch operations, partner verification, and emergency management desk',
      identity: 'Neravu Operations (+91 98765 43299)',
      icon: <ShieldAlert className="w-6 h-6 text-amber-600" />,
      color: 'border-amber-200 hover:border-amber-500 hover:bg-amber-50/50',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-xl">
        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center p-3 bg-teal-600 rounded-2xl shadow-sm text-white mb-4">
            <HeartHandshake className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 font-sans">
            NERAVU
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500 tracking-wide uppercase">
            Medical Journey Companion & Transport Service
          </p>
          <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-700">
            <ShieldCheck className="w-3.5 h-3.5" />
            Development Authentication Shell
          </div>
        </div>

        {/* Development Notice */}
        <div className="mt-6 mx-4 sm:mx-0 p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 flex items-start gap-3 text-xs leading-relaxed shadow-sm">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold block text-amber-950 mb-0.5">
              Notice: Development Mode Active
            </span>
            Development authentication — real phone verification is not connected.
            Select a verified test identity below to test role-based access control and journey workflows.
          </div>
        </div>

        {/* Role Selector Card */}
        <div className="mt-6 mx-4 sm:mx-0 bg-white py-6 px-6 shadow-sm border border-slate-200 sm:rounded-2xl">
          <h2 className="text-base font-semibold text-slate-900 mb-4">
            Select a Test Identity to Continue
          </h2>

          <div className="space-y-3">
            {roleOptions.map((opt) => (
              <button
                key={opt.role}
                type="button"
                disabled={isLoading}
                onClick={() => handleSelectRole(opt.role)}
                className={`w-full text-left p-4 rounded-xl border transition-all duration-150 flex items-start gap-4 cursor-pointer disabled:opacity-50 ${opt.color}`}
              >
                <div className="p-2.5 bg-white rounded-lg shadow-2xs border border-slate-100 shrink-0 mt-0.5">
                  {opt.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-900">
                      {opt.title}
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                      {opt.role}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    {opt.description}
                  </p>
                  <p className="text-[11px] font-mono text-slate-500 mt-2 flex items-center gap-1">
                    <span className="text-slate-400">Identity:</span> {opt.identity}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 text-center">
            <span className="text-[11px] text-slate-400">
              Session is scoped to development environment & will be retained across reloads.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
