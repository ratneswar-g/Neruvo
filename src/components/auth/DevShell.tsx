import React, { useState } from 'react';
import { useAuth } from '../../auth/AuthContext.tsx';
import { canAccessRoute, getDefaultRouteForRole } from '../../auth/route-guards.ts';
import { UserRole } from '../../domain/types/user.ts';
import { PatientPortal } from '../patient/PatientPortal.tsx';
import { CarePartnerPortal } from '../care-partner/CarePartnerPortal.tsx';
import { FamilyPortal } from '../family/FamilyPortal.tsx';
import { AdminPortal } from '../admin/AdminPortal.tsx';
import {
  HeartHandshake,
  LogOut,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  CheckCircle2,
  Lock,
} from 'lucide-react';

export const DevShell: React.FC = () => {
  const { currentUser, role, logout, loginAsDevRole } = useAuth();
  const [currentPath, setCurrentPath] = useState<string>(
    role ? getDefaultRouteForRole(role) : '/patient/home'
  );
  const [accessDeniedMessage, setAccessDeniedMessage] = useState<string | null>(null);

  if (!currentUser) return null;

  const handleNavigate = (path: string) => {
    const check = canAccessRoute(currentUser, path);
    if (!check.allowed) {
      setAccessDeniedMessage(
        check.reason || `Access denied: Role ${currentUser.role} cannot access ${path}`
      );
      return;
    }
    setAccessDeniedMessage(null);
    setCurrentPath(path);
  };

  const handleRoleSwitch = async (newRole: UserRole) => {
    await loginAsDevRole(newRole);
    setAccessDeniedMessage(null);
    setCurrentPath(getDefaultRouteForRole(newRole));
  };

  const navLinks = [
    { label: 'Patient Portal', path: '/patient/home', requiredRole: 'PATIENT' },
    { label: 'Care Partner Desk', path: '/care-partner/dashboard', requiredRole: 'CARE_PARTNER' },
    { label: 'Family Tracking', path: '/family/tracking', requiredRole: 'FAMILY_CONTACT' },
    { label: 'Admin Operations', path: '/admin/overview', requiredRole: 'ADMIN' },
  ];

  // Render Portal Component with strict Route & Role Guarding
  const renderActivePortal = () => {
    const check = canAccessRoute(currentUser, currentPath);
    if (!check.allowed) {
      return (
        <div className="p-8 bg-white rounded-2xl border border-red-200 text-center shadow-2xs">
          <Lock className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="text-base font-bold text-slate-900">Access Denied by Role Guard</h2>
          <p className="text-xs text-slate-600 max-w-md mx-auto mt-1">
            {check.reason || `Role ${currentUser.role} is not permitted to access ${currentPath}.`}
          </p>
        </div>
      );
    }

    if (currentPath.startsWith('/patient')) {
      return <PatientPortal />;
    }
    if (currentPath.startsWith('/care-partner')) {
      return <CarePartnerPortal />;
    }
    if (currentPath.startsWith('/family')) {
      return <FamilyPortal />;
    }
    if (currentPath.startsWith('/admin')) {
      return <AdminPortal />;
    }

    return <PatientPortal />;
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans">
      {/* Top Bar with Development Banner */}
      <div className="bg-amber-500 text-amber-950 px-4 py-1.5 text-xs font-medium flex items-center justify-between border-b border-amber-600/20">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span>
            <strong>NERAVU DEVELOPMENT MODE</strong>: Simulating authenticated session for{' '}
            <span className="font-bold underline">{currentUser.name}</span> ({currentUser.role}). Real phone verification is not connected.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] opacity-75">Quick Switch Role:</span>
          {(['PATIENT', 'CARE_PARTNER', 'FAMILY_CONTACT', 'ADMIN'] as UserRole[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => handleRoleSwitch(r)}
              className={`text-[10px] px-2 py-0.5 rounded font-mono transition-colors cursor-pointer ${
                role === r
                  ? 'bg-amber-950 text-amber-100 font-bold'
                  : 'bg-amber-400/80 hover:bg-amber-300 text-amber-950'
              }`}
            >
              {r.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Main Header */}
      <header className="bg-white border-b border-slate-200 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-600 rounded-xl text-white shadow-2xs">
              <HeartHandshake className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight text-slate-900">NERAVU</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                  Medical Journey Companion
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Patient ↔ Care Partner Round-Trip Transport & Accompaniment
              </p>
            </div>
          </div>

          {/* User Badge & Logout */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-900 flex items-center justify-end gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                {currentUser.name}
              </div>
              <div className="text-[11px] font-mono text-slate-500">
                {currentUser.role} • {currentUser.phone}
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-slate-500" />
              Sign Out
            </button>
          </div>
        </div>

        {/* Route Guard Navigation Bar */}
        <div className="bg-slate-50 border-t border-slate-200 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex items-center gap-2 py-2 overflow-x-auto">
            <span className="text-xs font-semibold text-slate-400 mr-2 uppercase tracking-wider text-[10px]">
              Portals:
            </span>
            {navLinks.map((link) => {
              const isActive = currentPath.startsWith(
                link.path.split('/')[1] ? `/${link.path.split('/')[1]}` : link.path
              );
              const isRoleMatched = currentUser.role === link.requiredRole || currentUser.role === 'ADMIN';

              return (
                <button
                  key={link.path}
                  type="button"
                  onClick={() => handleNavigate(link.path)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-2xs'
                      : 'bg-white hover:bg-slate-200/70 text-slate-700 border border-slate-200'
                  }`}
                >
                  {!isRoleMatched ? (
                    <Lock className="w-3 h-3 text-slate-400" />
                  ) : (
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  )}
                  {link.label}
                  <span
                    className={`text-[9px] font-mono px-1 py-0.2 rounded ${
                      isActive ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {link.requiredRole}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Access Denied Warning Toast */}
        {accessDeniedMessage && (
          <div className="mb-6 p-4 rounded-xl border border-red-300 bg-red-50 text-red-900 flex items-start gap-3 shadow-2xs animate-fade-in">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block text-red-950">
                Navigation Denied (Role Guard Enforcement)
              </span>
              <p className="text-xs text-red-800 mt-0.5">{accessDeniedMessage}</p>
            </div>
          </div>
        )}

        {/* Render Guarded Portal */}
        {renderActivePortal()}
      </main>
    </div>
  );
};
