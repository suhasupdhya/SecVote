import React, { useState } from 'react';
import { voterLogin, voterRegister, adminLogin, adminRegister, getErrorMessage } from '../services/api';
import { ShieldCheck, UserCheck, Lock, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

export default function LoginPage({ onVoterLogin, onAdminLogin }) {
  const [activeTab, setActiveTab] = useState('voter'); // 'voter' or 'admin'

  // Voter Login / Register State
  const [voterEmail, setVoterEmail] = useState('');
  const [voterPassword, setVoterPassword] = useState('');
  const [voterRegNo, setVoterRegNo] = useState('');
  const [isVoterRegisterMode, setIsVoterRegisterMode] = useState(false);
  const [voterLoading, setVoterLoading] = useState(false);
  const [voterError, setVoterError] = useState('');
  const [voterSuccess, setVoterSuccess] = useState('');

  // Admin Login / Register State
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminRegisterMode, setIsAdminRegisterMode] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [adminSuccess, setAdminSuccess] = useState('');

  const handleVoterAuthSubmit = async (e) => {
    e.preventDefault();
    setVoterError('');
    setVoterSuccess('');

    if (!voterEmail.trim() || !voterPassword.trim()) {
      setVoterError('Email and Password are required.');
      return;
    }

    if (isVoterRegisterMode && !voterRegNo.trim()) {
      setVoterError('Registration Number is required for voter account creation.');
      return;
    }

    setVoterLoading(true);
    try {
      let res;
      if (isVoterRegisterMode) {
        res = await voterRegister(voterRegNo.trim(), voterEmail.trim(), voterPassword.trim());
        setVoterSuccess('Voter registered successfully! Logging in...');
      } else {
        res = await voterLogin(voterEmail.trim(), voterPassword.trim());
        setVoterSuccess('Voter login successful! Redirecting...');
      }

      setTimeout(() => {
        onVoterLogin({
          regNo: res.student_reg_no,
          email: res.email
        });
      }, 600);
    } catch (err) {
      setVoterError(getErrorMessage(err, 'Voter authentication failed. Please check credentials or register.'));
    } finally {
      setVoterLoading(false);
    }
  };

  const handleAdminAuthSubmit = async (e) => {
    e.preventDefault();
    setAdminError('');
    setAdminSuccess('');

    if (!adminUsername.trim() || !adminPassword.trim()) {
      setAdminError('Username and Password are required.');
      return;
    }

    setAdminLoading(true);
    try {
      let res;
      if (isAdminRegisterMode) {
        res = await adminRegister(adminUsername.trim(), adminPassword.trim());
        setAdminSuccess('Admin account created! Logging in...');
      } else {
        res = await adminLogin(adminUsername.trim(), adminPassword.trim());
        setAdminSuccess('Login successful! Redirecting...');
      }

      setTimeout(() => {
        onAdminLogin(res.username);
      }, 600);
    } catch (err) {
      setAdminError(getErrorMessage(err, 'Authentication failed. Please check your credentials.'));
    } finally {
      setAdminLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto my-8 px-4">
      {/* Brand Header */}
      <div className="text-center mb-8">
        <div className="h-14 w-14 mx-auto mb-4 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/20 text-white">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          SecVote Authentication Portal
        </h1>
        <p className="text-xs text-slate-500 mt-1 font-medium">
          Official Access Point for Institutional & Civic E-Voting
        </p>
      </div>

      {/* Main Card */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-7 shadow-sm space-y-6">
        
        {/* Tab Selection */}
        <div className="grid grid-cols-2 gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200/60">
          <button
            type="button"
            onClick={() => { setActiveTab('voter'); setVoterError(''); setVoterSuccess(''); }}
            className={`py-2 px-3 rounded-lg font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'voter'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <UserCheck className="h-4 w-4 text-blue-600" />
            Voter Login
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('admin'); setAdminError(''); setAdminSuccess(''); }}
            className={`py-2 px-3 rounded-lg font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'admin'
                ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Lock className="h-4 w-4 text-slate-700" />
            Admin Login
          </button>
        </div>

        {/* Tab 1: Voter Login */}
        {activeTab === 'voter' && (
          <form onSubmit={handleVoterAuthSubmit} className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900">
                {isVoterRegisterMode ? 'Register Voter Identity' : 'Voter Access'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Log in to inspect elections, submit eligibility proofs, and cast secret ballots.
              </p>
            </div>

            {voterSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl text-xs flex items-center gap-2 animate-fade-in">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{voterSuccess}</span>
              </div>
            )}

            {voterError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs flex items-center gap-2 animate-fade-in">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>{voterError}</span>
              </div>
            )}

            {isVoterRegisterMode && (
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                  Registration Number / Voter ID *
                </label>
                <input
                  type="text"
                  placeholder="e.g. RA2111003010001"
                  value={voterRegNo}
                  onChange={(e) => setVoterRegNo(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                Institutional Email Address *
              </label>
              <input
                type="email"
                placeholder="e.g. voter@srmist.edu.in"
                value={voterEmail}
                onChange={(e) => setVoterEmail(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                Password *
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={voterPassword}
                onChange={(e) => setVoterPassword(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            {!isVoterRegisterMode && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-[11px] text-slate-600 flex items-center justify-between font-mono">
                <span>Demo Account:</span>
                <span className="text-blue-700 font-medium">voter@srmist.edu.in &bull; voter123</span>
              </div>
            )}

            <button
              type="submit"
              disabled={voterLoading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg shadow-sm transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span>{voterLoading ? 'Authenticating...' : (isVoterRegisterMode ? 'Complete Registration' : 'Log In to Voter Portal')}</span>
              <ArrowRight className="h-4 w-4" />
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => { setIsVoterRegisterMode(!isVoterRegisterMode); setVoterError(''); setVoterSuccess(''); }}
                className="text-xs text-blue-600 hover:text-blue-700 underline font-medium cursor-pointer"
              >
                {isVoterRegisterMode ? 'Already registered? Log in with Email & Password' : 'New Voter? Create your student account'}
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Admin Login */}
        {activeTab === 'admin' && (
          <form onSubmit={handleAdminAuthSubmit} className="space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold text-slate-900">
                Administrator Authentication
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Authorized access for election creation, voter proof verification, and results auditing.
              </p>
            </div>

            {adminSuccess && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-xl text-xs flex items-center gap-2 animate-fade-in">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <span>{adminSuccess}</span>
              </div>
            )}

            {adminError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs flex items-center gap-2 animate-fade-in">
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                <span>{adminError}</span>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                Admin Username *
              </label>
              <input
                type="text"
                placeholder="e.g. admin"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                Password *
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-lg px-3.5 py-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/20 focus:border-blue-600"
              />
            </div>

            {!isAdminRegisterMode && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-[11px] text-slate-600 flex items-center justify-between font-mono">
                <span>Demo Admin:</span>
                <span className="text-blue-700 font-medium">admin &bull; admin123</span>
              </div>
            )}

            <button
              type="submit"
              disabled={adminLoading}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs rounded-lg shadow-sm transition cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span>{adminLoading ? 'Authenticating...' : (isAdminRegisterMode ? 'Register & Log In' : 'Log In to Administrator Portal')}</span>
              <ArrowRight className="h-4 w-4" />
            </button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => { setIsAdminRegisterMode(!isAdminRegisterMode); setAdminError(''); setAdminSuccess(''); }}
                className="text-xs text-blue-600 hover:text-blue-700 underline font-medium cursor-pointer"
              >
                {isAdminRegisterMode ? 'Existing Admin? Log in here' : 'New Administrator? Register account'}
              </button>
            </div>
          </form>
        )}

      </div>

      <div className="text-center mt-6 text-[11px] text-slate-400">
        Secured by OpenZeppelin Merkle Verification &bull; EVM On-Chain Nullifier State
      </div>
    </div>
  );
}
