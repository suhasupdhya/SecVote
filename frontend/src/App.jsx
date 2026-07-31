import React, { useState } from 'react';
import Navbar from './components/Navbar';
import VoterView from './components/VoterView';
import AdminView from './components/AdminView';
import { ShieldCheck, Info } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('voter');
  const [electionId, setElectionId] = useState(0);
  const [showSecurityModal, setShowSecurityModal] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        electionId={electionId}
        setElectionId={setElectionId}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Quick Info Bar */}
        <div className="mb-6 bg-indigo-950/40 border border-indigo-500/20 rounded-xl p-3 flex items-center justify-between text-xs text-indigo-300">
          <div className="flex items-center space-x-2">
            <Info className="h-4 w-4 text-indigo-400 shrink-0" />
            <span>
              Connected to local FastAPI backend (<code className="text-white bg-indigo-900/60 px-1.5 py-0.5 rounded font-mono">http://127.0.0.1:8000</code>).
            </span>
          </div>

          <button
            onClick={() => setShowSecurityModal(true)}
            className="text-indigo-400 hover:text-indigo-200 underline font-medium flex items-center gap-1"
          >
            <span>How Security Works</span>
          </button>
        </div>

        {/* View Switcher */}
        {activeTab === 'voter' ? (
          <VoterView electionId={electionId} />
        ) : (
          <AdminView electionId={electionId} setElectionId={setElectionId} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>SecVote — Blockchain E-Voting System Prototype</span>
          <span className="font-mono text-slate-600">Solidity + Hardhat + FastAPI + Web3.py + React</span>
        </div>
      </footer>

      {/* Security Info Modal */}
      {showSecurityModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl animate-fade-in">
            <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
              <ShieldCheck className="h-6 w-6 text-indigo-400" />
              <h3 className="text-base font-bold text-white">SecVote Security Architecture</h3>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <h4 className="font-semibold text-indigo-300 mb-1">1. Merkle Tree Voter Eligibility</h4>
                <p className="text-slate-400">
                  Admin commits a single cryptographic Merkle Root on-chain. Eligible voters verify membership using Merkle proofs without publishing voter lists on-chain.
                </p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <h4 className="font-semibold text-emerald-300 mb-1">2. One-Time Secrets & Nullifier Protection</h4>
                <p className="text-slate-400">
                  Each vote marks a unique nullifier hash on the smart contract. Double-voting attempts are rejected immediately by the blockchain EVM engine.
                </p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <h4 className="font-semibold text-cyan-300 mb-1">3. Voter Privacy & Unlinkability</h4>
                <p className="text-slate-400">
                  No voter ID, Aadhaar number, or identity credential is saved with the candidate selection. The ballot commitment on-chain is voter-anonymous.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowSecurityModal(false)}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-xl text-xs"
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
