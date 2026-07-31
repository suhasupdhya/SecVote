import React, { useEffect, useState } from 'react';
import { ShieldCheck, Vote, Settings, Layers } from 'lucide-react';
import { getElections } from '../services/api';

export default function Navbar({ activeTab, setActiveTab, electionId, setElectionId }) {
  const [availableElections, setAvailableElections] = useState([]);

  useEffect(() => {
    fetchAvailableElections();
  }, []);

  const fetchAvailableElections = async () => {
    try {
      const data = await getElections();
      if (Array.isArray(data) && data.length > 0) {
        setAvailableElections(data);
        // Default to first active election ID if current selection is invalid
        const validIds = data.map(e => e.election_id);
        if (!validIds.includes(parseInt(electionId, 10))) {
          setElectionId(data[0].election_id);
        }
      }
    } catch (err) {
      // Fallback if backend initializing
      setAvailableElections([{ election_id: 0, domain: "COLLEGE" }]);
    }
  };

  return (
    <header className="bg-slate-950/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Brand Title */}
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <ShieldCheck className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg text-white tracking-wide">SecVote</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  Blockchain E-Voting
                </span>
              </div>
              <p className="text-xs text-slate-400">Merkle-Proof & Nullifier-Protected Ballot Ledger</p>
            </div>
          </div>

          {/* Election ID Selector & Mode Switcher */}
          <div className="flex items-center space-x-4">
            
            {/* Active Election Selector */}
            <div className="hidden md:flex items-center bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-300">
              <Layers className="h-3.5 w-3.5 text-indigo-400 mr-2" />
              <span className="text-slate-400 mr-2 font-medium">Select Election:</span>
              
              {availableElections.length > 0 ? (
                <select
                  value={electionId}
                  onChange={(e) => setElectionId(parseInt(e.target.value, 10))}
                  className="bg-slate-800 text-white font-mono text-xs rounded px-2 py-1 border border-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {availableElections.map((elec) => (
                    <option key={elec.election_id} value={elec.election_id}>
                      Election #{elec.election_id} ({elec.domain})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="number"
                  value={electionId}
                  onChange={(e) => setElectionId(parseInt(e.target.value || 0, 10))}
                  className="w-12 bg-slate-800 text-white font-mono text-center rounded py-0.5 border border-slate-700 focus:outline-none focus:border-indigo-500"
                  min="0"
                />
              )}
            </div>

            {/* Tab Navigation */}
            <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setActiveTab('voter')}
                className={`flex items-center space-x-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === 'voter'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Vote className="h-4 w-4" />
                <span>Voter View</span>
              </button>

              <button
                onClick={() => setActiveTab('admin')}
                className={`flex items-center space-x-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                  activeTab === 'admin'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Settings className="h-4 w-4" />
                <span>Admin View</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    </header>
  );
}
