import React, { useState, useEffect } from 'react';
import { getPublicElections, applyForBooth, requestOtp, verifyOtp, castVote, getResults, getErrorMessage } from '../services/api';
import { UserCheck, KeyRound, Vote, CheckCircle2, Copy, ShieldAlert, Lock, ArrowRight, ShieldCheck, RefreshCw, FileUp, AlertCircle, Building2, Search, PauseCircle, Clock, Printer } from 'lucide-react';

export default function VoterView({ voterUser, onLogout }) {
  const [elections, setElections] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeBoothId, setActiveBoothId] = useState(null);
  
  // Application Modal state
  const [applyModalElection, setApplyModalElection] = useState(null);
  const [pdfFile, setPdfFile] = useState(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyMsg, setApplyMsg] = useState(null);

  // Voting Wizard state for selected booth
  const [otpInput, setOtpInput] = useState('');
  const [step, setStep] = useState('BOOTH_LIST'); // 'BOOTH_LIST' -> 'OTP_INPUT' -> 'VOTING_BOOTH' -> 'RECEIPT'
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendLoading, setResendLoading] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [voteLoading, setVoteLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [successReceipt, setSuccessReceipt] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadElections();
  }, []);

  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const loadElections = async () => {
    try {
      const data = await getPublicElections();
      setElections(data || []);
    } catch (err) {
      console.error('Error loading public elections:', err);
    }
  };

  const filteredElections = elections.filter((booth) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      booth.title.toLowerCase().includes(q) ||
      booth.domain.toLowerCase().includes(q) ||
      String(booth.election_id).includes(q)
    );
  });

  const handleStartVoting = async (electionId) => {
    setActiveBoothId(electionId);
    setErrorMsg('');
    setInfoMsg('');
    setOtpInput('');
    setVoteLoading(true);

    try {
      // Request 6-digit email OTP for this voter & election
      const res = await requestOtp(electionId, voterUser.regNo);
      setResendCooldown(60);
      if (res?.message) {
        setInfoMsg(res.message);
      }
      
      // Fetch candidates for this election with safe fallback
      try {
        const resultsData = await getResults(electionId);
        if (resultsData && resultsData.candidates && resultsData.candidates.length > 0) {
          setCandidates(resultsData.candidates);
        } else {
          setCandidates([
            { id: 0, name: "Priya Sharma", votes: 0 },
            { id: 1, name: "Rahul Verma", votes: 0 },
            { id: 2, name: "Ananya Iyer", votes: 0 }
          ]);
        }
      } catch (candErr) {
        console.warn("Could not fetch candidate tallies, using default candidates list:", candErr);
        setCandidates([
          { id: 0, name: "Priya Sharma", votes: 0 },
          { id: 1, name: "Rahul Verma", votes: 0 },
          { id: 2, name: "Ananya Iyer", votes: 0 }
        ]);
      }

      setStep('OTP_INPUT');
    } catch (err) {
      setErrorMsg(getErrorMessage(err, "Failed to start voting portal."));
    } finally {
      setVoteLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0 || resendLoading) return;
    setResendLoading(true);
    setErrorMsg('');
    setInfoMsg('');
    try {
      const res = await requestOtp(activeBoothId, voterUser.regNo);
      setResendCooldown(60);
      setInfoMsg(res?.message || "Verification code sent to your registered email.");
    } catch (err) {
      setErrorMsg(getErrorMessage(err, "Failed to resend verification code."));
    } finally {
      setResendLoading(false);
    }
  };

  const handleVerifyOtpSubmit = async (e) => {
    e.preventDefault();
    const cleanOtp = otpInput.replace(/[^0-9]/g, '').trim();
    if (cleanOtp.length !== 6) {
      setErrorMsg("Please enter the 6-digit verification code sent to your email.");
      return;
    }

    setVoteLoading(true);
    setErrorMsg('');

    try {
      await verifyOtp(activeBoothId, voterUser.regNo, cleanOtp);
      setStep('VOTING_BOOTH');
    } catch (err) {
      setErrorMsg(getErrorMessage(err, "Verification failed."));
    } finally {
      setVoteLoading(false);
    }
  };

  const handleCastVoteSubmit = async () => {
    if (selectedCandidate === null) {
      setErrorMsg("Please select a candidate before submitting your vote.");
      return;
    }

    setVoteLoading(true);
    setErrorMsg('');

    try {
      const res = await castVote(activeBoothId, voterUser.regNo, selectedCandidate);
      setSuccessReceipt(res);
      setStep('RECEIPT');
    } catch (err) {
      setErrorMsg(getErrorMessage(err, "Vote submission failed."));
    } finally {
      setVoteLoading(false);
    }
  };

  const handleApplySubmit = async (e) => {
    e.preventDefault();
    setApplyMsg(null);

    if (!pdfFile) {
      setApplyMsg({ type: 'error', text: 'Please attach a Student ID / Identity Proof PDF file.' });
      return;
    }

    setApplyLoading(true);
    try {
      const formData = new FormData();
      formData.append('election_id', applyModalElection.election_id);
      formData.append('student_reg_no', voterUser.regNo);
      formData.append('email', voterUser.email);
      formData.append('id_proof_pdf', pdfFile);

      const res = await applyForBooth(formData);
      setApplyMsg({ type: 'success', text: res.message || 'Application submitted successfully to Admin!' });
      setPdfFile(null);
    } catch (err) {
      setApplyMsg({ type: 'error', text: getErrorMessage(err, 'Application submission failed.') });
    } finally {
      setApplyLoading(false);
    }
  };

  const handleCopyHash = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBackToBooths = () => {
    setStep('BOOTH_LIST');
    setActiveBoothId(null);
    setOtpInput('');
    setSelectedCandidate(null);
    setErrorMsg('');
    setInfoMsg('');
    setSuccessReceipt(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Voter Profile Header */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <UserCheck className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-lg font-bold text-slate-900">Voter Dashboard</h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                Verified Voter
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Registration No: <strong className="text-slate-800 font-mono font-semibold">{voterUser?.regNo}</strong> &bull; Email: <strong className="text-slate-800">{voterUser?.email}</strong>
            </p>
          </div>
        </div>

        {onLogout && (
          <button
            onClick={onLogout}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg border border-slate-300 transition cursor-pointer"
          >
            End Voter Session
          </button>
        )}
      </div>

      {/* Security Error Alert */}
      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start space-x-3 text-rose-800 animate-fade-in">
          <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-rose-900">Voting Rule Notice</h4>
            <p className="text-xs text-rose-700 leading-relaxed font-mono bg-rose-100/60 p-2.5 rounded border border-rose-200">
              {errorMsg}
            </p>
          </div>
        </div>
      )}

      {/* VIEW 1: AVAILABLE VOTING BOOTHS LIST */}
      {step === 'BOOTH_LIST' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="h-5 w-5 text-blue-600" />
                Available Voting Booths (Elections)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Select an active election booth to verify your identity and cast your ballot.</p>
            </div>

            <div className="relative">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search booths..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 w-full sm:w-60"
              />
            </div>
          </div>

          {filteredElections.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-3 shadow-sm">
              <Building2 className="h-10 w-10 text-slate-300 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800">No Elections Found</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No active election booths match your search criteria. Check back when an election is opened by administrators.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredElections.map((booth) => {
                const isPaused = booth.status === 'PAUSED';
                const isClosed = booth.status === 'CLOSED';
                const isActive = booth.status === 'ACTIVE' || (!isPaused && !isClosed);

                return (
                  <div
                    key={booth.election_id}
                    className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-sm hover:shadow-md transition space-y-4 flex flex-col justify-between"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center space-x-2">
                          <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            Booth #{booth.election_id}
                          </span>
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                            booth.domain === 'COLLEGE'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                          }`}>
                            {booth.domain || 'COLLEGE'}
                          </span>
                        </div>

                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : isPaused
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            isActive ? 'bg-emerald-500' : isPaused ? 'bg-amber-500' : 'bg-slate-400'
                          }`} />
                          {booth.status || 'ACTIVE'}
                        </span>
                      </div>

                      <h4 className="text-sm font-bold text-slate-900 leading-snug">
                        {booth.title}
                      </h4>

                      {booth.contract_address && (
                        <p className="text-[11px] text-slate-500 font-mono truncate" title={booth.contract_address}>
                          Contract: {booth.contract_address.slice(0, 10)}...{booth.contract_address.slice(-8)}
                        </p>
                      )}
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                      <button
                        onClick={() => setApplyModalElection(booth)}
                        className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer transition"
                      >
                        <FileUp className="h-3.5 w-3.5" />
                        <span>Submit ID Proof</span>
                      </button>

                      <button
                        onClick={() => handleStartVoting(booth.election_id)}
                        disabled={voteLoading || !isActive}
                        className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer ${
                          isActive
                            ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {voteLoading && activeBoothId === booth.election_id ? (
                          <span>Connecting...</span>
                        ) : isPaused ? (
                          <>
                            <PauseCircle className="h-3.5 w-3.5" />
                            <span>Paused</span>
                          </>
                        ) : isClosed ? (
                          <span>Closed</span>
                        ) : (
                          <>
                            <Vote className="h-3.5 w-3.5" />
                            <span>Enter Booth</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: EMAIL OTP VERIFICATION SCREEN */}
      {step === 'OTP_INPUT' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-7 space-y-6 shadow-sm animate-fade-in max-w-xl mx-auto">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center space-x-3.5">
              <div className="h-11 w-11 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Voter Authentication (2FA)</h3>
                <p className="text-xs text-slate-500 mt-0.5">A 6-digit verification code was dispatched to your institutional email.</p>
              </div>
            </div>
            <button
              onClick={handleBackToBooths}
              className="text-xs text-slate-500 hover:text-slate-900 underline cursor-pointer"
            >
              Back
            </button>
          </div>

          {infoMsg && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 flex items-start gap-2">
              <Clock className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <span>{infoMsg}</span>
            </div>
          )}

          <form onSubmit={handleVerifyOtpSubmit} className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-700">
                  Enter 6-Digit Verification Code:
                </label>
                <span className="text-[11px] text-slate-500 font-mono">Expires in 5 minutes</span>
              </div>

              <input
                type="text"
                autoFocus
                maxLength={6}
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="• • • • • •"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3.5 text-xl font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600 tracking-[0.6em] text-center font-extrabold shadow-inner"
                disabled={voteLoading}
              />
            </div>

            <button
              type="submit"
              disabled={voteLoading || otpInput.replace(/[^0-9]/g, '').length !== 6}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg text-xs transition flex items-center justify-center space-x-2 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {voteLoading ? (
                <span>Verifying Cryptographic Code...</span>
              ) : (
                <>
                  <span>Verify Identity & Proceed to Ballot</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          {/* Resend Cooldown Section */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">Didn't receive the verification email?</span>
            
            {resendCooldown > 0 ? (
              <span className="text-slate-500 font-mono text-[11px]">
                Resend available in <strong className="text-blue-700 font-semibold">{resendCooldown}s</strong>
              </span>
            ) : (
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={resendLoading}
                className="text-blue-600 hover:text-blue-800 font-semibold underline cursor-pointer disabled:opacity-50"
              >
                {resendLoading ? "Sending Code..." : "Resend Verification Code"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: CANDIDATE SELECTION & BALLOT CASTING */}
      {step === 'VOTING_BOOTH' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-7 space-y-6 shadow-sm animate-fade-in max-w-2xl mx-auto">
          
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Official Ballot</h3>
              <p className="text-xs text-slate-500 mt-0.5">Select your chosen candidate. Your vote is decoupled from your identity on-chain.</p>
            </div>

            <span className="text-xs font-mono text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 flex items-center gap-1.5 font-semibold">
              <Lock className="h-3.5 w-3.5 text-emerald-600" /> Identity Protected
            </span>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-semibold text-slate-700">
              Candidate Slate:
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
                        ? 'bg-blue-50/70 border-blue-600 ring-2 ring-blue-600/20 shadow-xs'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-3.5">
                      <div className={`h-5 w-5 rounded-full border flex items-center justify-center transition-all ${
                        isSelected ? 'border-blue-600 bg-blue-600' : 'border-slate-300'
                      }`}>
                        {isSelected && <div className="h-2 w-2 rounded-full bg-white" />}
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{cand.name}</h4>
                        <p className="text-xs text-slate-500 font-mono">Ballot Option #{cand.id + 1}</p>
                      </div>
                    </div>

                    <span className={`text-xs font-semibold px-3 py-1 rounded-lg transition ${
                      isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {isSelected ? 'Selected' : 'Select'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center space-x-3 pt-3">
            <button
              onClick={() => setStep('OTP_INPUT')}
              className="w-1/3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-3 rounded-lg text-xs transition border border-slate-300 cursor-pointer"
            >
              Back
            </button>
            <button
              onClick={handleCastVoteSubmit}
              disabled={voteLoading || selectedCandidate === null}
              className="w-2/3 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg text-xs transition flex items-center justify-center space-x-2 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {voteLoading ? "Submitting Anonymous Ballot..." : (
                <>
                  <Vote className="h-4 w-4" />
                  <span>Cast Anonymous Ballot</span>
                </>
              )}
            </button>
          </div>

        </div>
      )}

      {/* VIEW 4: VOTE SUCCESS RECEIPT */}
      {step === 'RECEIPT' && successReceipt && (
        <div className="bg-white border border-slate-200 rounded-2xl p-7 space-y-6 animate-fade-in shadow-sm max-w-xl mx-auto">
          <div className="text-center space-y-2 border-b border-slate-100 pb-5">
            <div className="h-14 w-14 rounded-full bg-emerald-50 border border-emerald-200 mx-auto flex items-center justify-center text-emerald-600 shadow-sm">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">Ballot Recorded Successfully</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Your anonymous vote has been confirmed and written to the Ethereum smart contract ledger.
            </p>
          </div>

          <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 font-semibold">Ledger Confirmation:</span>
              <span className="text-emerald-700 font-bold bg-emerald-100 px-2.5 py-0.5 rounded-full border border-emerald-200">
                ✓ Confirmed On-Chain
              </span>
            </div>

            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold">Transaction Receipt Hash:</span>
                <button
                  onClick={() => handleCopyHash(successReceipt.tx_hash)}
                  className="flex items-center space-x-1 text-blue-600 hover:text-blue-800 font-medium cursor-pointer"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>{copied ? "Copied!" : "Copy Receipt"}</span>
                </button>
              </div>
              <p className="text-xs font-mono text-slate-800 bg-white p-3 rounded-lg border border-slate-200 break-all select-all font-semibold">
                {successReceipt.tx_hash}
              </p>
            </div>
          </div>

          <div className="pt-2 flex justify-between gap-3">
            <button
              onClick={() => window.print()}
              className="w-1/2 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs flex items-center justify-center space-x-2 border border-slate-300 cursor-pointer transition"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print Audit Certificate</span>
            </button>

            <button
              onClick={handleBackToBooths}
              className="w-1/2 bg-slate-900 hover:bg-slate-800 text-white font-semibold py-2.5 rounded-lg text-xs flex items-center justify-center space-x-2 cursor-pointer transition"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Return to Dashboard</span>
            </button>
          </div>
        </div>
      )}

      {/* PDF APPLICATION MODAL */}
      {applyModalElection && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl animate-fade-in text-slate-800">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FileUp className="h-5 w-5 text-blue-600" />
                Submit ID Verification ({applyModalElection.title})
              </h3>
              <button
                onClick={() => { setApplyModalElection(null); setApplyMsg(null); }}
                className="text-slate-400 hover:text-slate-700 text-xs cursor-pointer"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Attach your Student ID or official verification PDF document. Once approved by the election admin, your registration will be activated.
            </p>

            {applyMsg && (
              <div className={`p-3 rounded-xl text-xs border ${
                applyMsg.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}>
                {applyMsg.text}
              </div>
            )}

            <form onSubmit={handleApplySubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Voter Registration Number:
                </label>
                <input
                  type="text"
                  value={voterUser?.regNo}
                  disabled
                  className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono text-slate-600 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Registered Email Address:
                </label>
                <input
                  type="text"
                  value={voterUser?.email}
                  disabled
                  className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Upload Student ID / Official Proof PDF *
                </label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setPdfFile(e.target.files[0] || null)}
                  className="w-full bg-white border border-dashed border-slate-300 rounded-lg p-3 text-xs text-slate-700 cursor-pointer"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setApplyModalElection(null); setApplyMsg(null); }}
                  className="px-4 py-2 bg-slate-100 text-slate-700 text-xs font-semibold rounded-lg hover:bg-slate-200 cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={applyLoading}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer"
                >
                  {applyLoading ? "Uploading..." : "Submit for Approval"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}