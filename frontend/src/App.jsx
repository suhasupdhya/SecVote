import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import VoterView from './components/VoterView';
import AdminView from './components/AdminView';
import LoginPage from './components/LoginPage';
import { ShieldCheck } from 'lucide-react';
import { checkBackendHealth, logoutAdmin } from './services/api';

export default function App() {
  const [userRole, setUserRole] = useState(null); // null (not logged in), 'voter', or 'admin'
  const [currentUser, setCurrentUser] = useState(null);
  const [electionId, setElectionId] = useState(0);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [isBackendLive, setIsBackendLive] = useState(null);

  useEffect(() => {
    const verifyHealth = async () => {
      const live = await checkBackendHealth();
      setIsBackendLive(live);
    };

    verifyHealth();
    const interval = setInterval(verifyHealth, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleVoterLogin = (voterData) => {
    setCurrentUser(voterData);
    setUserRole('voter');
  };

  const handleAdminLogin = (username) => {
    setCurrentUser({ username });
    setUserRole('admin');
  };

  const handleLogout = () => {
    logoutAdmin();
    setUserRole(null);
    setCurrentUser(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        isBackendLive={isBackendLive}
        userRole={userRole}
        currentUser={currentUser}
        onLogout={handleLogout}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Auth Gated Screen Switcher */}
        {userRole === null ? (
          <LoginPage
            onVoterLogin={handleVoterLogin}
            onAdminLogin={handleAdminLogin}
          />
        ) : userRole === 'voter' ? (
          <VoterView
            voterUser={currentUser}
            onLogout={handleLogout}
          />
        ) : (
          <AdminView
            electionId={electionId}
            setElectionId={setElectionId}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-slate-600">
            <span className="font-semibold text-slate-800">SecVote Institutional E-Voting System</span>
            <span>&bull;</span>
            <span>Cryptographic Privacy &bull; EVM Ledger Auditability</span>
          </div>
          <button
            onClick={() => setShowSecurityModal(true)}
            className="text-blue-600 hover:text-blue-800 font-medium underline flex items-center gap-1 cursor-pointer transition-colors"
          >
            Security & Verification Architecture
          </button>
        </div>
      </footer>

      {/* Security Info Modal */}
      {showSecurityModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl animate-fade-in text-slate-800">
            <div className="flex items-center space-x-3 border-b border-slate-100 pb-3.5">
              <div className="h-9 w-9 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">SecVote Cryptographic Architecture</h3>
                <p className="text-xs text-slate-500">How voter secrecy and universal auditability are enforced</p>
              </div>
            </div>

            <div className="space-y-3 text-xs leading-relaxed">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 font-bold text-[11px] flex items-center justify-center">1</span>
                  Merkle Tree Eligibility Verification
                </h4>
                <p className="text-slate-600 pl-7">
                  Voter eligibility is verified using cryptographic Merkle proofs evaluated against a single immutable 32-byte root published on-chain. Voter names, registration numbers, and identities are never stored on the public blockchain.
                </p>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[11px] flex items-center justify-center">2</span>
                  Single-Use Cryptographic Nullifiers
                </h4>
                <p className="text-slate-600 pl-7">
                  Every ballot requires a single-use nullifier derived from the voter's one-time secret. Once cast, the smart contract marks the nullifier as spent on-chain. Any duplicate voting attempt is immediately reverted by the Ethereum Virtual Machine.
                </p>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                <h4 className="font-semibold text-slate-900 mb-1 flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[11px] flex items-center justify-center">3</span>
                  Gasless Transaction Relayer & Public Receipts
                </h4>
                <p className="text-slate-600 pl-7">
                  Ballots are relayed to the smart contract via a secure backend relayer, meaning voters do not need cryptocurrency wallets or gas fees. Every voter receives a 66-character EVM transaction receipt for independent audit verification.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowSecurityModal(false)}
                className="bg-slate-900 hover:bg-slate-800 text-white font-semibold px-4 py-2 rounded-xl text-xs cursor-pointer transition-colors"
              >
                Close Explanation
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
