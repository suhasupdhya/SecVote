import axios from 'axios';

const getApiBaseUrl = () => {
  if (typeof window !== 'undefined' && window.location.hostname) {
    const host = window.location.hostname;
    return `http://${host}:8000`;
  }
  return 'http://127.0.0.1:8000';
};

export const API_BASE_URL = getApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const getErrorMessage = (error, fallback = 'An unexpected error occurred.') => {
  if (!error) return fallback;
  if (error.code === 'ERR_NETWORK' || error.message === 'Network Error' || !error.response) {
    return `Network Error: Unable to reach SecVote backend server at ${API_BASE_URL}. Please ensure python backend is running.`;
  }
  return error.response?.data?.detail || error.message || fallback;
};

// Attach JWT token to requests if present in localStorage
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const checkBackendHealth = async () => {
  try {
    const response = await api.get('/', { timeout: 3000 });
    return response.status === 200;
  } catch (error) {
    return false;
  }
};

export const voterLogin = async (email, password) => {
  const response = await api.post('/auth/voter/login', { email, password });
  if (response.data.student_reg_no) {
    localStorage.setItem('voter_email', response.data.email);
    localStorage.setItem('voter_reg_no', response.data.student_reg_no);
  }
  return response.data;
};

export const voterRegister = async (student_reg_no, email, password) => {
  const response = await api.post('/auth/voter/register', { student_reg_no, email, password });
  if (response.data.student_reg_no) {
    localStorage.setItem('voter_email', response.data.email);
    localStorage.setItem('voter_reg_no', response.data.student_reg_no);
  }
  return response.data;
};

export const adminLogin = async (username, password) => {
  const response = await api.post('/auth/admin/login', { username, password });
  if (response.data.access_token) {
    localStorage.setItem('admin_access_token', response.data.access_token);
    localStorage.setItem('admin_username', response.data.username);
  }
  return response.data;
};

export const adminRegister = async (username, password) => {
  const response = await api.post('/auth/admin/register', { username, password });
  if (response.data.access_token) {
    localStorage.setItem('admin_access_token', response.data.access_token);
    localStorage.setItem('admin_username', response.data.username);
  }
  return response.data;
};

export const logoutAdmin = () => {
  localStorage.removeItem('admin_access_token');
  localStorage.removeItem('admin_username');
  localStorage.removeItem('voter_email');
  localStorage.removeItem('voter_reg_no');
};

export const getPublicElections = async () => {
  const response = await api.get('/elections/public');
  return response.data;
};

export const applyForBooth = async (formData) => {
  const response = await api.post('/voter/apply-booth', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const getVoterApplications = async (electionId) => {
  const response = await api.get(`/admin/applications/${electionId}`);
  return response.data;
};

export const approveVoterApplication = async (appId) => {
  const response = await api.post(`/admin/applications/${appId}/approve`);
  return response.data;
};

export const rejectVoterApplication = async (appId) => {
  const response = await api.post(`/admin/applications/${appId}/reject`);
  return response.data;
};

export const getApplicationPdfUrl = (appId) => {
  return `${API_BASE_URL}/admin/applications/${appId}/pdf`;
};

export const getElections = async () => {
  const response = await api.get('/elections');
  return response.data;
};

export const createElection = async (name, domain, candidateNames) => {
  const response = await api.post('/admin/create-election', {
    name,
    domain,
    candidate_names: candidateNames,
  });
  return response.data;
};

export const setEligibleVoters = async (electionId, voterIds) => {
  const response = await api.post('/admin/eligible-voters', {
    election_id: parseInt(electionId, 10),
    voter_ids: voterIds,
  });
  return response.data;
};

export const pauseElection = async (electionId) => {
  const response = await api.post(`/admin/election/${electionId}/pause`);
  return response.data;
};

export const resumeElection = async (electionId) => {
  const response = await api.post(`/admin/election/${electionId}/resume`);
  return response.data;
};

export const closeElection = async (electionId) => {
  const response = await api.post(`/admin/election/${electionId}/close`);
  return response.data;
};

export const generateSecrets = async (electionId) => {
  const response = await api.post(`/admin/generate-secrets?election_id=${electionId}`);
  return response.data;
};

export const requestOtp = async (electionId, voterId) => {
  const response = await api.post('/voter/request-otp', {
    election_id: parseInt(electionId, 10),
    voter_id: voterId,
  });
  return response.data;
};

export const verifyOtp = async (electionId, voterId, otp) => {
  const response = await api.post('/voter/verify-otp', {
    election_id: parseInt(electionId, 10),
    voter_id: voterId,
    otp,
  });
  return response.data;
};

export const castVote = async (electionId, voterId, candidateId) => {
  const response = await api.post('/vote/cast', {
    election_id: parseInt(electionId, 10),
    voter_id: voterId,
    candidate_id: parseInt(candidateId, 10),
  });
  return response.data;
};

export const getResults = async (electionId) => {
  const response = await api.get(`/results/${electionId}`);
  return response.data;
};
