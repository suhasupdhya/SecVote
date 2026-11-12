# SecVote — Smart Contracts (Solidity)

Solidity smart contracts for the SecVote platform. Contains anti-fraud mechanisms (Merkle proof eligibility checks, nullifier double-vote protection) and multi-election factory tracking.

---

## 🚀 How to Run

### Setup
```bash
npm install
```

### Start Local Blockchain Node
```bash
npx ganache
```
This runs a local RPC endpoint at `http://127.0.0.1:8545`. Keep this running when testing or running the backend.

---

## 🧪 Contracts Compilation & Testing

### Compile Contracts
Compiles Solidity contracts and outputs JSON ABIs/Bytecode to `../voting-backend/contracts_abi/`:
```bash
node compile.js
```

### End-to-End Anti-Fraud Test
Deploys `ElectionFactory`, creates an election, builds off-chain Merkle tree, casts valid votes, and verifies invalid/duplicate votes are rejected:
```bash
node test/fullFlow.js
```

---

## 📂 Key Contracts
- `contracts/Election.sol`: Individual election logic, Merkle verification, time window, nullifier storage.
- `contracts/ElectionFactory.sol`: Factory pattern to deploy and index multiple elections.


to run the app

cd voting-contracts
npm install
npx ganache

cd voting-backend

# Install Python dependencies
pip install -r requirements.txt

# Deploy contracts and populate demo data
python deploy.py

# Launch FastAPI backend server
python -m uvicorn app.main:app --reload


cd frontend

# Install Node dependencies
npm install

# Start Vite dev server
npm run dev




