import React from 'react';
import { ShieldCheck, LogOut, UserCheck, Shield, Activity } from 'lucide-react';

export default function Navbar({ isBackendLive, userRole, currentUser, onLogout }) {
  return (
    <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-50 text-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Brand Title */}
          <div className="flex items-center space-x-3.5">
            <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-900/30">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg text-white tracking-tight">SecVote</span>
                <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 border border-blue-400/30">
                  Institutional Portal
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium hidden sm:block">
                Verifiable Blockchain Electronic Voting &bull; Zero-Knowledge Identity
              </p>
            </div>
          </div>

          {/* Right Section: Status Indicator & User Session */}
          <div className="flex items-center space-x-3">
            {/* Live Status Pill */}
            <div className="hidden md:flex items-center space-x-1.5 px-3 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-xs">
              <span className={`h-2 w-2 rounded-full ${isBackendLive !== false ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
              <span className="text-slate-300 font-medium">
                {isBackendLive !== false ? 'EVM Relayer: Active' : 'Connecting Relayer...'}
              </span>
            </div>

            {/* User Session & Actions */}
            {userRole && (
              <>
                <div className="flex items-center space-x-2 bg-slate-800 px-3.5 py-1.5 rounded-xl border border-slate-700 text-xs">
                  {userRole === 'admin' ? (
                    <Shield className="h-4 w-4 text-blue-400" />
                  ) : (
                    <UserCheck className="h-4 w-4 text-emerald-400" />
                  )}
                  <span className="text-slate-200 font-medium">
                    {userRole === 'admin' ? (
                      <>Admin: <strong className="text-white font-semibold">{currentUser?.username || 'Administrator'}</strong></>
                    ) : (
                      <>Voter: <strong className="text-white font-mono font-semibold">{currentUser?.regNo}</strong></>
                    )}
                  </span>
                </div>

                <button
                  onClick={onLogout}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 hover:border-slate-600 text-xs font-semibold rounded-xl transition cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5 text-slate-400" />
                  <span>Logout</span>
                </button>
              </>
            )}
          </div>

        </div>
      </div>
    </header>
  );
}
