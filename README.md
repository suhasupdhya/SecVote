# SecVote — Blockchain E-Voting Platform

SecVote is a secure, verifiable, anti-fraud blockchain e-voting system. It consists of three main components:
1. **`voting-contracts`**: Solidity smart contracts (`Election` and `ElectionFactory`) with Merkle proof eligibility verification and anti-double-voting nullifiers.
2. **`voting-backend`**: FastAPI Python backend using Web3.py to manage elections, issue voter tokens, build Merkle trees, and relay votes to the blockchain.
3. **`frontend`**: React + Vite UI for admins (election management, voter registration, results) and voters (OTP authentication, voting portal).

---

## 📋 Prerequisites

Before running the application, make sure you have installed:
- **Node.js** (v18 or higher) & **npm** — [Download Node.js](https://nodejs.org/)
- **Python** (v3.9 or higher) & **pip** — [Download Python](https://www.python.org/)

---

## ⚡ Quick Start: How to Run the Website

To run the application easily, execute the commands below in separate terminal windows:

### 1️⃣ Run Backend (`voting-backend`)
```bash
cd voting-backend
pip install -r requirements.txt
python deploy.py
python -m uvicorn app.main:app --reload
```
> 📍 **Backend API:** `http://127.0.0.1:8000`  
> 📖 **API Docs (Swagger):** `http://127.0.0.1:8000/docs`

### 2️⃣ Run Frontend (`frontend`)
```bash
cd frontend
npm install
npm run dev
```
> 🌐 **Frontend Web App:** `http://localhost:5173`

### 3️⃣ Run Local Blockchain (`voting-contracts`)
```bash
cd voting-contracts
npm install
npx ganache

```
> ⛓️ **Local Ethereum Node:** `http://127.0.0.1:8545`

---

## 🚀 How to Run the Application (Step-by-Step)

To run the complete stack locally, open **3 separate terminal windows** (or tabs) and execute the steps in order:

```
┌───────────────────────────┐   ┌───────────────────────────┐   ┌───────────────────────────┐
│        Terminal 1         │   │        Terminal 2         │   │        Terminal 3         │
│     Local Blockchain      │ → │        FastAPI API        │ → │        React UI           │
│       (npx ganache)       │   │  (deploy.py + uvicorn)    │   │      (npm run dev)        │
└───────────────────────────┘   └───────────────────────────┘   └───────────────────────────┘
```

### Step 1: Start the Local Blockchain

In **Terminal 1**, start a local Ethereum blockchain node using Ganache:

```bash
cd voting-contracts
npm install
npx ganache
```

> ℹ️ **Keep this terminal running!** It hosts the local blockchain at `http://127.0.0.1:8545`.

---

### Step 2: Deploy Contracts & Start the Backend

In **Terminal 2**, install Python dependencies, deploy the smart contracts to Ganache, and launch the FastAPI server:

```bash
cd voting-backend

# 1. Install dependencies
pip install -r requirements.txt

# 2. Deploy contracts and initialize demo election data
python deploy.py

# 3. Start the FastAPI backend server
python -m uvicorn app.main:app --reload
```

> ✅ **Backend Server:** `http://127.0.0.1:8000`  
> 📖 **Interactive API Documentation (Swagger):** `http://127.0.0.1:8000/docs`

---

### Step 3: Start the Frontend

In **Terminal 3**, install Node modules and launch the Vite development server:

```bash
cd frontend

# 1. Install dependencies
npm install

# 2. Start the development server
npm run dev
```

> 🌐 **Frontend Web App:** `http://localhost:5173` (or `http://127.0.0.1:5173`)

---

## 📂 Project Structure

```
SecVote/
├── frontend/                 # React + Vite frontend application
│   ├── src/
│   │   ├── components/      # UI components (Admin, Voter, Results)
│   │   ├── services/        # Axios API client (`api.js`)
│   │   ├── App.jsx          # Main App routing & state
│   │   └── main.jsx         # Entry point
│   ├── package.json
│   └── vite.config.js
│
├── voting-backend/           # FastAPI backend server
│   ├── app/
│   │   ├── main.py          # REST API endpoints
│   │   ├── blockchain.py    # Web3 interface to local Ethereum node
│   │   ├── merkle.py        # Merkle tree & proof generator
│   │   ├── identity.py      # Voter OTP authentication module
│   │   └── store.py         # In-memory data storage
│   ├── deploy.py            # Deploys ElectionFactory & creates demo election
│   ├── deployed.json        # Contract deployment metadata
│   └── requirements.txt     # Python requirements
│
└── voting-contracts/         # Solidity smart contracts
    ├── contracts/
    │   ├── Election.sol        # Core voting logic & Merkle verification
    │   └── ElectionFactory.sol # Factory contract to create elections
    ├── test/
    │   └── fullFlow.js      # Anti-fraud E2E verification test
    ├── compile.js           # Solc contract compiler script
    └── package.json
```

---

## 🧪 Testing & Utilities

### Smart Contract Verification
To test contract compilation and run end-to-end blockchain tests without starting the backend:
```bash
cd voting-contracts
node compile.js        # Compiles contracts to voting-backend/contracts_abi
node test/fullFlow.js  # Runs standalone anti-fraud end-to-end test
```

### Frontend Build
To build the production frontend bundle:
```bash
cd frontend
npm run build
npm run preview        # Preview production build locally
```

---

## ❓ Troubleshooting

- **`sender account not recognized` / failed to create election on-chain**
  - Occurs when the local Ganache node was stopped and restarted. Ganache generates new accounts upon restart, making older deployed addresses stale.
  - **Fix:** Run `python deploy.py` inside `voting-backend` to synchronize contracts with the new Ganache instance. SecVote also auto-syncs upon detecting a restarted chain.
- **`Cannot reach chain at http://127.0.0.1:8545`**
  - Make sure Ganache is running in **Terminal 1** (`npx ganache` inside `voting-contracts`).
- **`deployed.json not found`**
  - Run `python deploy.py` inside `voting-backend` before starting `uvicorn`.
- **`Port 8000 already in use`**
  - Kill any process running on port 8000 or run uvicorn on another port (e.g. `--port 8001`).
- **`CORS or Network Error in Frontend`**
  - Verify `voting-backend` is active at `http://127.0.0.1:8000`.
