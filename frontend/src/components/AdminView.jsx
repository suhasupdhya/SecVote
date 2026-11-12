import React, { useState, useEffect } from 'react';
import { createElection, setEligibleVoters, generateSecrets, getResults, getPublicElections, pauseElection, resumeElection, closeElection, getErrorMessage } from '../services/api';
import AdminApplicationReview from './AdminApplicationReview';
import { Users, KeyRound, BarChart3, RefreshCw, CheckCircle2, ShieldAlert, Cpu, PlusCircle, FileText, PauseCircle, PlayCircle, XCircle, ListFilter, CheckCircle } from 'lucide-react';

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
  
  const [allElections, setAllElections] = useState([]);
  const [currentElectionStatus, setCurrentElectionStatus] = useState('ACTIVE');
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'applications' | 'security' | 'deploy'

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const loadAllElections = async () => {
    try {
      const data = await getPublicElections();
      setAllElections(data || []);
      const current = (data || []).find((e) => Number(e.election_id) === Number(electionId));
      if (current) {
        setCurrentElectionStatus(current.status || 'ACTIVE');
        if (current.eligible_count !== undefined) {
          setEligibleCount(current.eligible_count);
        }
      }
    } catch (err) {
      console.error("Error loading elections:", err);
    }
  };

  useEffect(() => {
    loadAllElections();
    fetchLiveResults();
  }, [electionId]);

  const handlePause = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setActionLoading(true);
    try {
      const res = await pauseElection(electionId);
      setSuccessMsg(res.message);
      await loadAllElections();
    } catch (err) {
      setErrorMsg(getErrorMessage(err, "Failed to pause election."));
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setActionLoading(true);
    try {
      const res = await resumeElection(electionId);
      setSuccessMsg(res.message);
      await loadAllElections();
    } catch (err) {
      setErrorMsg(getErrorMessage(err, "Failed to resume election."));
    } finally {
      setActionLoading(false);
    }
  };

  const handleClose = async () => {
    if (!window.confirm(`Are you sure you want to CLOSE Election #${electionId}? Voting will be permanently stopped.`)) return;
    setErrorMsg('');
    setSuccessMsg('');
    setActionLoading(true);
    try {
      const res = await closeElection(electionId);
      setSuccessMsg(res.message);
      await loadAllElections();
    } catch (err) {
      setErrorMsg(getErrorMessage(err, "Failed to close election."));
    } finally {
      setActionLoading(false);
    }
  };

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
      
      await loadAllElections();

      if (setElectionId) {
        setElectionId(res.election_id);
      }
      setActiveTab('overview');
    } catch (err) {
      setErrorMsg(getErrorMessage(err, "Failed to deploy new election."));
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
      setErrorMsg(getErrorMessage(err, "Failed to add eligible voters."));
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
      setErrorMsg(getErrorMessage(err, "Failed to generate voter secrets."));
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
      setErrorMsg(getErrorMessage(err, "Could not fetch election results."));
    } finally {
      setLoadingResults(false);
    }
  };

  const currentElectionObj = allElections.find((e) => Number(e.election_id) === Number(electionId));
  const currentTitle = results?.title || currentElectionObj?.title || `Election #${electionId}`;
  const totalVotesCast = results?.total_votes_cast || 0;
  const totalEligible = eligibleCount !== null ? eligibleCount : (currentElectionObj?.eligible_count || 0);
  const participationRate = totalEligible > 0 ? Math.min(100, Math.round((totalVotesCast / totalEligible) * 100)) : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      
      {/* Admin Header with Dropdown & Action Controls */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Cpu className="h-6 w-6 text-blue-600" />
                Election Administration Panel
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Configure elections, inspect student ID applications, manage cryptographic voter whitelists, and monitor live audited tallies.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Status Badge */}
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${
              currentElectionStatus === 'ACTIVE' 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : currentElectionStatus === 'PAUSED'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-rose-50 text-rose-700 border-rose-200'
            }`}>
              <span className={`h-2 w-2 rounded-full ${
                currentElectionStatus === 'ACTIVE' ? 'bg-emerald-500 animate-pulse' : currentElectionStatus === 'PAUSED' ? 'bg-amber-500' : 'bg-rose-500'
              }`} />
              {currentElectionStatus}
            </span>
          </div>
        </div>

        {/* Election Selector & Actions Toolbar */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-[280px]">
            <ListFilter className="h-4 w-4 text-blue-600 shrink-0" />
            <label className="text-xs font-semibold text-slate-700 shrink-0">Selected Booth:</label>
            <select
              value={electionId}
              onChange={(e) => setElectionId && setElectionId(Number(e.target.value))}
              className="bg-white border border-slate-300 text-slate-900 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 w-full cursor-pointer font-medium"
            >
              {allElections.map((el) => (
                <option key={el.election_id} value={el.election_id}>
                  Election #{el.election_id} — {el.title} [{el.status || 'ACTIVE'}]
                </option>
              ))}
            </select>
          </div>

          {/* Pause / Resume / Close Action Controls */}
          <div className="flex items-center gap-2">
            {currentElectionStatus === 'ACTIVE' && (
              <button
                onClick={handlePause}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <PauseCircle className="h-4 w-4 text-amber-600" />
                Pause
              </button>
            )}

            {currentElectionStatus === 'PAUSED' && (
              <button
                onClick={handleResume}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <PlayCircle className="h-4 w-4 text-emerald-600" />
                Resume
              </button>
            )}

            {currentElectionStatus !== 'CLOSED' && (
              <button
                onClick={handleClose}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <XCircle className="h-4 w-4 text-rose-600" />
                Close Election
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Executive Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Status</span>
          <div className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${
              currentElectionStatus === 'ACTIVE' ? 'bg-emerald-500' : currentElectionStatus === 'PAUSED' ? 'bg-amber-500' : 'bg-rose-500'
            }`} />
            {currentElectionStatus}
          </div>
          <p className="text-[11px] text-slate-500">Election #{electionId}</p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Eligible Voters</span>
          <div className="text-xl font-bold text-blue-700 font-mono">
            {totalEligible}
          </div>
          <p className="text-[11px] text-slate-500">Registered Roster</p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Votes Cast</span>
          <div className="text-xl font-bold text-emerald-700 font-mono">
            {totalVotesCast}
          </div>
          <p className="text-[11px] text-slate-500">On-Chain Ballots</p>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Participation</span>
          <div className="text-xl font-bold text-slate-900 font-mono">
            {participationRate}%
          </div>
          <p className="text-[11px] text-slate-500">Voter Turnout Rate</p>
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start space-x-3 text-rose-800 animate-fade-in">
          <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <p className="text-xs font-medium">{errorMsg}</p>
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center space-x-3 text-emerald-800 animate-fade-in">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <p className="text-xs font-medium text-emerald-800">{successMsg}</p>
        </div>
      )}

      {/* Admin Tab Navigation */}
      <div className="flex border-b border-slate-200 gap-1 overflow-x-auto bg-white px-3 pt-2 rounded-t-2xl border-t border-x">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition flex items-center gap-2 cursor-pointer border-b-2 ${
            activeTab === 'overview'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <BarChart3 className="h-4 w-4" />
          Live Results & Tallies
        </button>

        <button
          onClick={() => setActiveTab('applications')}
          className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition flex items-center gap-2 cursor-pointer border-b-2 ${
            activeTab === 'applications'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="h-4 w-4" />
          Voter Applications (PDFs)
        </button>

        <button
          onClick={() => setActiveTab('security')}
          className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition flex items-center gap-2 cursor-pointer border-b-2 ${
            activeTab === 'security'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <KeyRound className="h-4 w-4" />
          Merkle & Voter Security
        </button>

        <button
          onClick={() => setActiveTab('deploy')}
          className={`px-4 py-2.5 text-xs font-semibold rounded-t-lg transition flex items-center gap-2 cursor-pointer border-b-2 ${
            activeTab === 'deploy'
              ? 'border-blue-600 text-blue-700 bg-blue-50/50'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <PlusCircle className="h-4 w-4" />
          Create New Election
        </button>
      </div>

      {/* TAB 1: LIVE RESULTS & TALLIES */}
      {activeTab === 'overview' && (
        <div className="bg-white border border-slate-200 rounded-b-2xl p-6 space-y-6 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">{currentTitle}</h3>
              <p className="text-xs text-slate-500 mt-0.5">Real-time candidate vote tallies verified directly from the smart contract</p>
            </div>

            <button
              onClick={fetchLiveResults}
              disabled={loadingResults}
              className="bg-white hover:bg-slate-50 text-slate-700 font-semibold px-3 py-1.5 rounded-lg text-xs transition flex items-center gap-1.5 border border-slate-300 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${loadingResults ? 'animate-spin text-blue-600' : ''}`} />
              <span>Refresh Results</span>
            </button>
          </div>

          {results ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4">
                {results.candidates && results.candidates.map((cand) => {
                  const total = results.total_votes_cast || 1;
                  const percentage = Math.round((cand.votes / total) * (results.total_votes_cast > 0 ? 100 : 0));
                  
                  return (
                    <div key={cand.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-900 text-sm">{cand.name}</span>
                        <span className="font-mono text-slate-700 font-semibold">{cand.votes} votes ({percentage}%)</span>
                      </div>

                      <div className="h-3 w-full bg-slate-200 rounded-full overflow-hidden p-0.5">
                        <div
                          className="h-full bg-blue-600 rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(percentage, 1)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-xs text-slate-500">Loading election results...</div>
          )}
        </div>
      )}

      {/* TAB 2: VOTER APPLICATIONS */}
      {activeTab === 'applications' && (
        <div className="bg-white border border-slate-200 rounded-b-2xl p-6 shadow-sm">
          <AdminApplicationReview electionId={electionId} />
        </div>
      )}

      {/* TAB 3: MERKLE & VOTER SECURITY */}
      {activeTab === 'security' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* MANUAL ELIGIBLE VOTERS */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center space-x-3 border-b border-slate-100 pb-3">
              <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center border border-blue-200 text-blue-600">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Manual Voter Registration</h3>
                <p className="text-xs text-slate-500">Bulk register voter IDs for Election #{electionId}</p>
              </div>
            </div>

            <form onSubmit={handleAddEligibleVoters} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Voter IDs / Roll Numbers (comma or line separated):
                </label>
                <textarea
                  rows={4}
                  value={voterInput}
                  onChange={(e) => setVoterInput(e.target.value)}
                  placeholder="VOTER001, VOTER002, VOTER003..."
                  className="w-full bg-white border border-slate-300 rounded-lg p-3 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setVoterInput("VOTER001, VOTER002, VOTER003, VOTER004, VOTER005")}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium underline cursor-pointer"
                >
                  Reset Default Demo IDs
                </button>

                <button
                  type="submit"
                  disabled={loadingEligible}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg text-xs transition shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  {loadingEligible ? "Saving..." : "Register Eligible List"}
                </button>
              </div>
            </form>
          </div>

          {/* MERKLE TREE & SECRETS */}
          <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
            <div className="flex items-center space-x-3 border-b border-slate-100 pb-3">
              <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center border border-blue-200 text-blue-600">
                <KeyRound className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Merkle Root & On-Chain Security</h3>
                <p className="text-xs text-slate-500">Publish eligibility Merkle root on-chain</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Generates cryptographic secret commitments for all registered voters in Election #{electionId} and submits the binary Merkle root to the smart contract.
            </p>

            <button
              onClick={handleGenerateSecrets}
              disabled={loadingSecrets}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 rounded-lg text-xs transition shadow-sm disabled:opacity-50 flex items-center justify-center space-x-2 cursor-pointer"
            >
              {loadingSecrets ? (
                <span>Publishing Root On-Chain...</span>
              ) : (
                <>
                  <KeyRound className="h-4 w-4" />
                  <span>Generate Secrets & Publish Root</span>
                </>
              )}
            </button>

            {merkleData && (
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs font-mono">
                <div className="flex justify-between text-slate-700">
                  <span>Voters Issued Secrets:</span>
                  <span className="text-emerald-700 font-bold">{merkleData.voters_issued}</span>
                </div>
                <div>
                  <span className="text-slate-600 block mb-1">On-Chain Merkle Root:</span>
                  <p className="text-[11px] text-blue-700 bg-white p-2.5 rounded-lg border border-slate-200 break-all select-all font-semibold">
                    {merkleData.merkle_root}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: DEPLOY NEW ELECTION */}
      {activeTab === 'deploy' && (
        <div className="bg-white border border-slate-200 rounded-b-2xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center space-x-3 border-b border-slate-100 pb-3">
            <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center border border-blue-200 text-blue-600">
              <PlusCircle className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Create New Election Instance</h3>
              <p className="text-xs text-slate-500">Deploys an isolated Election contract on-chain via ElectionFactory</p>
            </div>
          </div>

          <form onSubmit={handleCreateElection} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Election Name / Title:
                </label>
                <input
                  type="text"
                  value={newElectionName}
                  onChange={(e) => setNewElectionName(e.target.value)}
                  placeholder="e.g. SRM Computer Science Election 2026"
                  className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Domain Type:
                </label>
                <select
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 cursor-pointer font-medium"
                >
                  <option value="COLLEGE">COLLEGE (Student Roll No)</option>
                  <option value="GOVT">GOVT (Aadhaar / Voter ID)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Candidate Names (comma-separated):
              </label>
              <input
                type="text"
                value={newCandidatesInput}
                onChange={(e) => setNewCandidatesInput(e.target.value)}
                placeholder="Priya Sharma, Rahul Verma, Ananya Iyer"
                className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 font-mono"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={loadingCreate}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg text-xs transition shadow-sm disabled:opacity-50 flex items-center space-x-2 cursor-pointer"
              >
                <PlusCircle className="h-4 w-4" />
                <span>{loadingCreate ? "Deploying On-Chain..." : "Create Election"}</span>
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  );
}