# SecVote — Backend API (FastAPI)

This service bridges the React frontend and Ethereum smart contracts using Web3.py. It manages voter identity, Merkle tree construction, voter token generation, and transaction relaying.

---

## 🚀 How to Run

### Prerequisites
Make sure Ganache is running in `voting-contracts`:
```bash
cd ../voting-contracts
npx ganache
```

### Setup & Launch
```bash
# 1. Install Python dependencies
pip install -r requirements.txt

# 2. Deploy contracts and generate initial demo deployment metadata
python deploy.py

# 3. Start the API server
python -m uvicorn app.main:app --reload
```

---

## 📖 API Documentation & Endpoints

Once running, view the interactive Swagger documentation at:  
👉 **http://127.0.0.1:8000/docs**

### Primary API Routes:
- `GET /elections` — List active elections
- `POST /admin/create-election` — Create a new election instance on-chain
- `POST /admin/eligible-voters` — Register eligible voter IDs
- `POST /admin/generate-secrets` — Compute Merkle root & post on-chain
- `POST /voter/request-otp` & `POST /voter/verify-otp` — Authenticate voter & return voter token
- `POST /vote/cast` — Verify Merkle proof and submit vote transaction on-chain
- `GET /results/{election_id}` — Public vote tally from blockchain
