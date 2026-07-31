import React, { useState, useEffect } from 'react';
import { createElection, setEligibleVoters, generateSecrets, getResults } from '../services/api';
import { Users, KeyRound, BarChart3, RefreshCw, CheckCircle2, ShieldAlert, Cpu, PlusCircle } from 'lucide-react';

export default function AdminView({ electionId, setElectionId }) {
  // Create Election Form state
  const [newElectionName, setNewElectionName] = useState("SRM Computer Science Election 2026");
  const [newDomain, setNewDomain] = useState("COLLEGE");
  const [newCandidatesInput, setNewCandidatesInput] = useState("Priya Sharma, Rahul Verma, Ananya Iyer");
  
  // Eligible voters form state
  const [voterInput, setVoterInput] = useState("VOTER001, VOTER002, VOTER003, VOTER004, VOTER005");
  const [eligibleCount, setEligibleCount] = useState(null);
  
  const [merkleData, setMerkleData] = useState(null);
  const [results, setResults] = useState(null);
  
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [loadingSecrets, setLoadingSecrets] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    fetchLiveResults();
  }, [electionId]);

  const handleCreateElection = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (!newElectionName.trim()) {
      setErrorMsg("Please enter an election name.");
      return;
    }

    const candidateList = newCandidatesInput
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (candidateList.length < 2) {
      setErrorMsg("Please provide at least 2 candidate names (comma-separated).");
      return;
    }

    setLoadingCreate(true);
    try {
      const res = await createElection(newElectionName.trim(), newDomain, candidateList);
      setSuccessMsg(`Successfully deployed election '${res.title}' on-chain with ID #${res.election_id}!`);
      
      // Automatically switch election selection to the newly deployed election
      if (setElectionId) {
        setElectionId(res.election_id);
      }
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Failed to deploy new election.";
      setErrorMsg(detail);
    } finally {
      setLoadingCreate(false);
    }
  };

  const handleAddEligibleVoters = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const voterList = voterInput
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (voterList.length === 0) {
      setErrorMsg("Please enter at least one voter ID / roll number.");
      return;
    }

    setLoadingEligible(true);
    try {
      const res = await setEligibleVoters(electionId, voterList);
      setEligibleCount(res.eligible_count);
      setSuccessMsg(`Successfully registered ${res.eligible_count} eligible voters for Election #${electionId}.`);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Failed to add eligible voters.";
      setErrorMsg(detail);
    } finally {
      setLoadingEligible(false);
    }
  };

  const handleGenerateSecrets = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setLoadingSecrets(true);

    try {
      const res = await generateSecrets(electionId);
      setMerkleData(res);
      setSuccessMsg(`Generated ${res.voters_issued} secrets and published Merkle root on-chain!`);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Failed to generate voter secrets.";
      setErrorMsg(detail);
    } finally {
      setLoadingSecrets(false);
    }
  };

  const fetchLiveResults = async () => {
    setLoadingResults(true);
    try {
      const data = await getResults(electionId);
      setResults(data);
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Could not fetch election results.";
      setErrorMsg(detail);
    } finally {
      setLoadingResults(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Admin Header */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Cpu className="h-6 w-6 text-indigo-400" />
              Election Administrator Portal
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Create on-chain elections, manage voter eligibility, publish Merkle tree roots, and inspect tallies.
            </p>
          </div>
          <span className="text-xs font-mono text-indigo-400 bg-indigo-950/60 border border-indigo-500/30 px-3 py-1 rounded-full">
            Active Election #{electionId}
          </span>
        </div>
      </div>

      {/* Security Error Alert */}
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start space-x-3 text-red-300 animate-fade-in">
          <ShieldAlert className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-red-200">Admin Action Error / Rejection</h4>
            <p className="text-xs font-mono text-red-300/90 mt-1">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Success Notification */}
      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center space-x-3 text-emerald-300 animate-fade-in">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <p className="text-xs font-medium text-emerald-200">{successMsg}</p>
        </div>
      )}

      {/* SECTION 1: CREATE ELECTION FORM */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
            <PlusCircle className="h-4 w-4 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">1. Create New Election (Deploy On-Chain)</h3>
            <p className="text-xs text-slate-400">Deploys an isolated Election contract instance via ElectionFactory</p>
          </div>
        </div>

        <form onSubmit={handleCreateElection} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Election Name / Title:
              </label>
              <input
                type="text"
                value={newElectionName}
                onChange={(e) => setNewElectionName(e.target.value)}
                placeholder="e.g. SRM Computer Science Election 2026"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Domain Type:
              </label>
              <select
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="COLLEGE">COLLEGE (Student Roll No)</option>
                <option value="GOVT">GOVT (Aadhaar / Voter ID)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Candidate Names (comma-separated):
            </label>
            <input
              type="text"
              value={newCandidatesInput}
              onChange={(e) => setNewCandidatesInput(e.target.value)}
              placeholder="Priya Sharma, Rahul Verma, Ananya Iyer"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loadingCreate}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 py-2.5 rounded-xl text-xs transition shadow-md shadow-indigo-600/20 disabled:opacity-50 flex items-center space-x-2"
            >
              <PlusCircle className="h-4 w-4" />
              <span>{loadingCreate ? "Deploying On-Chain..." : "Deploy New Election On-Chain"}</span>
            </button>
          </div>
        </form>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* SECTION 2: ELIGIBLE VOTERS MANAGEMENT */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <Users className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">2. Add Eligible Voters</h3>
              <p className="text-xs text-slate-400">Bulk register voter IDs for Election #{electionId}</p>
            </div>
          </div>

          <form onSubmit={handleAddEligibleVoters} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Voter IDs (comma or line separated):
              </label>
              <textarea
                rows={4}
                value={voterInput}
                onChange={(e) => setVoterInput(e.target.value)}
                placeholder="VOTER001, VOTER002, VOTER003..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setVoterInput("VOTER001, VOTER002, VOTER003, VOTER004, VOTER005")}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 underline"
              >
                Reset Default Demo IDs
              </button>

              <button
                type="submit"
                disabled={loadingEligible}
                className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-xl text-xs transition shadow-md shadow-indigo-600/20 disabled:opacity-50"
              >
                {loadingEligible ? "Saving..." : "Register Eligible List"}
              </button>
            </div>
          </form>

          {eligibleCount !== null && (
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-xs text-slate-300 flex items-center justify-between font-mono">
              <span>Total Registered Voters:</span>
              <span className="text-indigo-400 font-bold">{eligibleCount}</span>
            </div>
          )}
        </div>

        {/* SECTION 3: MERKLE TREE & SECRET GENERATION */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
          <div className="flex items-center space-x-3 border-b border-slate-800 pb-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <KeyRound className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">3. Secret Generation & Merkle Root</h3>
              <p className="text-xs text-slate-400">Lock roster & push Merkle Root on-chain</p>
            </div>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Generates one-time secrets for all registered voters in Election #{electionId}, constructs the Merkle tree, and updates the smart contract root.
          </p>

          <button
            onClick={handleGenerateSecrets}
            disabled={loadingSecrets}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-xl text-xs transition shadow-md shadow-indigo-600/20 disabled:opacity-50 flex items-center justify-center space-x-2"
          >
            {loadingSecrets ? (
              <span>Pushing Merkle Root On-Chain...</span>
            ) : (
              <>
                <KeyRound className="h-4 w-4" />
                <span>Generate Secrets & Update On-Chain Root</span>
              </>
            )}
          </button>

          {merkleData && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Voters Issued Secrets:</span>
                <span className="text-emerald-400 font-bold">{merkleData.voters_issued}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-1">On-Chain Merkle Root:</span>
                <p className="text-[11px] text-indigo-400 bg-slate-900 p-2 rounded border border-slate-800 break-all select-all">
                  {merkleData.merkle_root}
                </p>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* SECTION 4: LIVE RESULTS BAR CHART */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
        
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <BarChart3 className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">4. Live Election Results Tally</h3>
              <p className="text-xs text-slate-400">Real-time vote totals retrieved directly from smart contract</p>
            </div>
          </div>

          <button
            onClick={fetchLiveResults}
            disabled={loadingResults}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium px-3 py-1.5 rounded-lg text-xs transition flex items-center space-x-1.5 border border-slate-700"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingResults ? 'animate-spin text-indigo-400' : ''}`} />
            <span>Refresh Tally</span>
          </button>
        </div>

        {results && (
          <div className="space-y-4">
            
            <div className="flex items-center justify-between text-xs text-slate-400 font-mono bg-slate-950 p-3 rounded-xl border border-slate-800">
              <span>Election Title: <strong className="text-white font-sans ml-1">{results.title || `Election #${electionId}`}</strong></span>
              <span>Total Votes Cast: <strong className="text-emerald-400 font-bold ml-1 text-sm">{results.total_votes_cast}</strong></span>
            </div>

            {/* Candidate Bar Chart Display */}
            <div className="space-y-4 pt-2">
              {results.candidates && results.candidates.map((cand) => {
                const total = results.total_votes_cast || 1;
                const percentage = Math.round((cand.votes / total) * (results.total_votes_cast > 0 ? 100 : 0));
                
                return (
                  <div key={cand.id} className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-white">{cand.name}</span>
                      <span className="font-mono text-slate-300">{cand.votes} votes ({percentage}%)</span>
                    </div>

                    <div className="h-4 w-full bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full transition-all duration-500 shadow-sm"
                        style={{ width: `${Math.max(percentage, 2)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

          </div>
        )}

      </div>

    </div>
  );
}
