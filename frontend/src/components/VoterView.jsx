import React, { useState, useEffect } from 'react';
import { requestOtp, verifyOtp, castVote, getResults } from '../services/api';
import { UserCheck, KeyRound, Vote, CheckCircle2, Copy, ShieldAlert, Lock, ArrowRight, ShieldCheck, RefreshCw } from 'lucide-react';

export default function VoterView({ electionId }) {
  const [voterId, setVoterId] = useState('');
  const [otpInput, setOtpInput] = useState('');
  
  // Step state: 'ID_INPUT' -> 'OTP_INPUT' -> 'VOTING_BOOTH' -> 'RECEIPT'
  const [step, setStep] = useState('ID_INPUT');
  const [demoOtpHint, setDemoOtpHint] = useState('');
  const [verifiedMessage, setVerifiedMessage] = useState('');

  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successReceipt, setSuccessReceipt] = useState(null);
  const [copied, setCopied] = useState(false);

  // Fetch candidate roster whenever electionId changes
  useEffect(() => {
    fetchCandidates();
    // Reset state on election change
    setStep('ID_INPUT');
    setVoterId('');
    setOtpInput('');
    setErrorMsg('');
    setSuccessReceipt(null);
  }, [electionId]);

  const fetchCandidates = async () => {
    try {
      const data = await getResults(electionId);
      if (data && data.candidates && data.candidates.length > 0) {
        setCandidates(data.candidates);
      } else {
        setCandidates([
          { id: 0, name: "Priya Sharma", votes: 0 },
          { id: 1, name: "Rahul Verma", votes: 0 },
          { id: 2, name: "Ananya Iyer", votes: 0 }
        ]);
      }
    } catch (err) {
      setCandidates([
        { id: 0, name: "Priya Sharma", votes: 0 },
        { id: 1, name: "Rahul Verma", votes: 0 },
        { id: 2, name: "Ananya Iyer", votes: 0 }
      ]);
    }
  };

  // STEP 2a: Request OTP
  const handleRequestOtp = async (e) => {
    e.preventDefault();
    if (!voterId.trim()) {
      setErrorMsg("Please enter a valid Voter ID / Roll Number.");
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await requestOtp(electionId, voterId.trim());
      setDemoOtpHint(res.demo_otp_hint || '');
      setStep('OTP_INPUT');
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Failed to request OTP.";
      setErrorMsg(detail);
    } finally {
      setLoading(false);
    }
  };

  // STEP 2b: Verify OTP
  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otpInput.trim()) {
      setErrorMsg("Please enter the OTP code.");
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await verifyOtp(electionId, voterId.trim(), otpInput.trim());
      setVerifiedMessage(res.message);
      setStep('VOTING_BOOTH');
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "OTP verification failed.";
      setErrorMsg(detail);
    } finally {
      setLoading(false);
    }
  };

  // STEP 3: Cast Anonymous Vote
  const handleCastVote = async () => {
    if (selectedCandidate === null) {
      setErrorMsg("Please select a candidate before casting your ballot.");
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      const res = await castVote(electionId, voterId.trim(), selectedCandidate);
      setSuccessReceipt(res);
      setStep('RECEIPT');
    } catch (err) {
      const detail = err.response?.data?.detail || err.message || "Vote submission failed.";
      setErrorMsg(detail);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyHash = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setStep('ID_INPUT');
    setVoterId('');
    setOtpInput('');
    setSelectedCandidate(null);
    setErrorMsg('');
    setSuccessReceipt(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Vote className="h-6 w-6 text-indigo-400" />
              Voter Portal — Identity & Voting Wizard
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Submit identity credentials → Request OTP → Verify OTP → Cast secret ballot on-chain.
            </p>
          </div>
          <span className="text-xs font-mono text-indigo-400 bg-indigo-950/60 border border-indigo-500/30 px-3 py-1 rounded-full">
            Election #{electionId}
          </span>
        </div>
      </div>

      {/* Security Rejection Alert */}
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-start space-x-3 text-red-300 animate-fade-in">
          <ShieldAlert className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-red-200">Security Rule Enforced / Rejection</h4>
            <p className="text-xs text-red-300/90 leading-relaxed font-mono bg-red-950/40 p-2.5 rounded border border-red-500/20">
              {errorMsg}
            </p>
          </div>
        </div>
      )}

      {/* STEP 1: VOTER ID INPUT */}
      {step === 'ID_INPUT' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
          <div className="flex items-center space-x-3 border-b border-slate-800 pb-4">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
              <UserCheck className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Step 1: Submit Voter Identity</h2>
              <p className="text-xs text-slate-400">Enter your Aadhaar Number (GOVT) or Roll Number / Email (COLLEGE)</p>
            </div>
          </div>

          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Voter ID / Roll Number:
              </label>
              <input
                type="text"
                value={voterId}
                onChange={(e) => setVoterId(e.target.value)}
                placeholder="e.g. VOTER001, VOTER002, or 21BCE1001"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                disabled={loading}
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Demo Registered IDs: <code className="text-indigo-400 font-mono">VOTER001</code>, <code className="text-indigo-400 font-mono">VOTER002</code>, <code className="text-indigo-400 font-mono">VOTER003</code>
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-xl text-sm transition flex items-center justify-center space-x-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
            >
              {loading ? "Checking Eligibility & Generating OTP..." : (
                <>
                  <span>Request One-Time OTP</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      )}

      {/* STEP 2: OTP INPUT */}
      {step === 'OTP_INPUT' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                <KeyRound className="h-4 w-4 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Step 2: Enter One-Time OTP</h2>
                <p className="text-xs text-slate-400">Sent to registered contact for voter '{voterId}'</p>
              </div>
            </div>
            <button
              onClick={() => setStep('ID_INPUT')}
              className="text-xs text-slate-400 hover:text-slate-200 underline"
            >
              Change ID
            </button>
          </div>

          {/* Demo OTP Hint Banner */}
          {demoOtpHint && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-center justify-between text-xs text-amber-200">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="h-4 w-4 text-amber-400 shrink-0" />
                <span><strong>[DEMO MODE OTP HINT]:</strong> Use secret code below for testing</span>
              </div>
              <code className="bg-amber-950/80 px-2.5 py-1 rounded font-mono text-amber-300 font-bold border border-amber-500/30 select-all">
                {demoOtpHint}
              </code>
            </div>
          )}

          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Enter One-Time OTP Secret:
              </label>
              <input
                type="text"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value)}
                placeholder="Paste or enter secret OTP code..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm font-mono text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                disabled={loading}
              />
            </div>

            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={() => setOtpInput("WRONG_OTP_TEST_123")}
                className="w-1/3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-3 rounded-xl text-xs transition border border-slate-700"
              >
                Test Wrong OTP
              </button>

              <button
                type="submit"
                disabled={loading}
                className="w-2/3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-xl text-sm transition flex items-center justify-center space-x-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
              >
                {loading ? "Verifying OTP..." : (
                  <>
                    <span>Verify OTP & Continue</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STEP 3: CANDIDATE SELECTION & BALLOT CASTING */}
      {step === 'VOTING_BOOTH' && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl animate-fade-in">
          
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Step 3: Cast Secret Vote</h2>
                <p className="text-xs text-slate-400">Authenticated Voter: '{voterId}'</p>
              </div>
            </div>

            <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 px-3 py-1 rounded-full border border-emerald-500/30 flex items-center gap-1">
              <Lock className="h-3 w-3" /> OTP Verified
            </span>
          </div>

          {/* Candidate Radio List */}
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-300">
              Select Candidate:
            </label>

            <div className="grid grid-cols-1 gap-3">
              {candidates.map((cand) => {
                const isSelected = selectedCandidate === cand.id;
                return (
                  <div
                    key={cand.id}
                    onClick={() => setSelectedCandidate(cand.id)}
                    className={`p-4 rounded-xl border cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-indigo-600/15 border-indigo-500 shadow-md shadow-indigo-500/10'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`h-5 w-5 rounded-full border flex items-center justify-center ${
                        isSelected ? 'border-indigo-400 bg-indigo-600' : 'border-slate-600'
                      }`}>
                        {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-white">{cand.name}</h4>
                        <p className="text-xs text-slate-400">Candidate #{cand.id + 1}</p>
                      </div>
                    </div>

                    <span className={`text-xs px-2.5 py-1 rounded-md ${
                      isSelected ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {isSelected ? 'Selected' : 'Select'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center space-x-3 pt-2">
            <button
              onClick={() => setStep('OTP_INPUT')}
              className="w-1/3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium py-3 rounded-xl text-sm transition"
            >
              Back
            </button>
            <button
              onClick={handleCastVote}
              disabled={loading || selectedCandidate === null}
              className="w-2/3 bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-3 rounded-xl text-sm transition flex items-center justify-center space-x-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50"
            >
              {loading ? "Relaying Vote On-Chain..." : (
                <>
                  <Vote className="h-4 w-4" />
                  <span>Submit Anonymous Vote</span>
                </>
              )}
            </button>
          </div>

        </div>
      )}

      {/* STEP 4: RECEIPT */}
      {step === 'RECEIPT' && successReceipt && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-6 space-y-4 animate-fade-in shadow-xl">
          <div className="flex items-center space-x-3 text-emerald-400">
            <CheckCircle2 className="h-7 w-7 shrink-0" />
            <div>
              <h3 className="text-lg font-bold text-emerald-200">Vote Successfully Mined On-Chain!</h3>
              <p className="text-xs text-emerald-300/80">Your ballot hash has been committed to the smart contract ledger.</p>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Transaction Hash (Public Audit Receipt):</span>
              <button
                onClick={() => handleCopyHash(successReceipt.tx_hash)}
                className="flex items-center space-x-1 text-indigo-400 hover:text-indigo-300 font-medium"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>{copied ? "Copied!" : "Copy Receipt"}</span>
              </button>
            </div>
            <p className="text-xs font-mono text-emerald-400 bg-slate-900 p-2.5 rounded border border-slate-800 break-all select-all">
              {successReceipt.tx_hash}
            </p>
          </div>

          <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 text-xs text-slate-300 flex items-center space-x-2">
            <Lock className="h-4 w-4 text-indigo-400 shrink-0" />
            <span>
              <strong>Zero-Knowledge Privacy:</strong> Your voter ID and identity credentials were NOT saved on-chain with your vote choice.
            </span>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={handleReset}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2.5 rounded-xl text-xs flex items-center space-x-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Next Voter</span>
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
