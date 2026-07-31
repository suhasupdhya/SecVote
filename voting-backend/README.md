# Voting Backend (FastAPI)

## Setup
```
pip install -r requirements.txt
```

## Run (3 steps, in order)

1. Start a local blockchain (from the voting-contracts project):
   ```
   npx ganache
   ```

2. Deploy the contracts + demo election:
   ```
   python deploy.py
   ```

3. Start the API:
   ```
   python -m uvicorn app.main:app --reload
   ```

## Try it
- `POST /admin/eligible-voters` — set who can vote
- `POST /admin/generate-secrets` — issue voter tokens + push Merkle root on-chain
- `POST /voter/login` — mock identity check, returns voter's secret
- `POST /vote/cast` — cast a vote (relayed on-chain by the backend)
- `GET /results/{election_id}` — public tally

Full interactive API docs at http://127.0.0.1:8000/docs once running.

## Still mocked / not production-ready
- `app/identity.py` — real Aadhaar/college-SSO verification not implemented
- In-memory store (`app/store.py`) — swap for a real DB before production
- No frontend yet — this is the API layer only
