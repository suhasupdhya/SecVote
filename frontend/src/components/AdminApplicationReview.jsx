import React, { useState, useEffect } from 'react';
import { getVoterApplications, approveVoterApplication, rejectVoterApplication, getApplicationPdfUrl, getErrorMessage } from '../services/api';
import { FileText, CheckCircle, XCircle, Clock, ExternalLink, RefreshCw, Eye } from 'lucide-react';

export default function AdminApplicationReview({ electionId }) {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [message, setMessage] = useState(null);
  const [previewPdfUrl, setPreviewPdfUrl] = useState(null);

  useEffect(() => {
    if (electionId !== undefined && electionId !== null) {
      loadApplications();
    }
  }, [electionId]);

  const loadApplications = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await getVoterApplications(electionId);
      setApplications(data || []);
    } catch (err) {
      console.error('Error loading voter applications:', err);
      setMessage({ type: 'error', text: getErrorMessage(err, 'Failed to load applications. Make sure you are logged in as Admin.') });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (appId) => {
    setActionLoading(appId);
    setMessage(null);
    try {
      const res = await approveVoterApplication(appId);
      setMessage({ type: 'success', text: res.message || 'Application approved and voter registered!' });
      loadApplications();
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Approval failed.') });
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (appId) => {
    setActionLoading(appId);
    setMessage(null);
    try {
      const res = await rejectVoterApplication(appId);
      setMessage({ type: 'info', text: res.message || 'Application rejected.' });
      loadApplications();
    } catch (err) {
      setMessage({ type: 'error', text: getErrorMessage(err, 'Rejection failed.') });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600" />
            Voter Identity Proof Applications (Election #{electionId})
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">Review uploaded identity proof documents and activate voter registration for this booth.</p>
        </div>
        <button
          onClick={loadApplications}
          disabled={loading}
          className="text-xs text-slate-700 hover:text-slate-900 bg-white border border-slate-300 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-xs disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Applications</span>
        </button>
      </div>

      {message && (
        <div className={`p-3 rounded-xl text-xs flex items-center gap-2 border animate-fade-in ${
          message.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : message.type === 'error'
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : 'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          <span>{message.text}</span>
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500 bg-white border border-slate-200 rounded-xl">Loading voter applications...</div>
      ) : applications.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500 shadow-sm">
          No voter applications submitted for this booth yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 font-semibold">
              <tr>
                <th className="p-3.5">Registration No.</th>
                <th className="p-3.5">Email Address</th>
                <th className="p-3.5">ID Proof Document</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Submitted Date</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {applications.map((app) => {
                const pdfUrl = getApplicationPdfUrl(app.application_id);
                return (
                  <tr key={app.application_id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-3.5 font-mono font-semibold text-slate-900">{app.student_reg_no}</td>
                    <td className="p-3.5 text-slate-600">{app.email}</td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setPreviewPdfUrl(previewPdfUrl === pdfUrl ? null : pdfUrl)}
                          className="text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" /> Preview
                        </button>
                        <a
                          href={pdfUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-500 hover:text-slate-800 flex items-center gap-1"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Open PDF
                        </a>
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                        app.status === 'APPROVED'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : app.status === 'REJECTED'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {app.status}
                      </span>
                    </td>
                    <td className="p-3.5 text-slate-500 text-[11px] font-mono">
                      {new Date(app.submitted_at).toLocaleString()}
                    </td>
                    <td className="p-3.5 text-right">
                      {app.status === 'PENDING' && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleApprove(app.application_id)}
                            disabled={actionLoading === app.application_id}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs transition cursor-pointer flex items-center gap-1 disabled:opacity-50 shadow-xs"
                          >
                            <CheckCircle className="h-3.5 w-3.5" /> Approve
                          </button>

                          <button
                            onClick={() => handleReject(app.application_id)}
                            disabled={actionLoading === app.application_id}
                            className="px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-300 font-semibold rounded-lg text-xs transition cursor-pointer flex items-center gap-1 disabled:opacity-50"
                          >
                            <XCircle className="h-3.5 w-3.5" /> Reject
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* PDF Inline Preview Overlay */}
      {previewPdfUrl && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 shadow-md animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="text-xs font-bold text-slate-900 flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" /> Identity Document Proof Preview
            </span>
            <button
              onClick={() => setPreviewPdfUrl(null)}
              className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded-lg transition cursor-pointer border border-slate-200"
            >
              Close Preview
            </button>
          </div>
          <iframe
            src={previewPdfUrl}
            title="PDF Proof Preview"
            className="w-full h-96 rounded-xl border border-slate-200 bg-slate-50"
          />
        </div>
      )}
    </div>
  );
}