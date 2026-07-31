import axios from 'axios';

const API_BASE_URL = 'http://127.0.0.1:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
