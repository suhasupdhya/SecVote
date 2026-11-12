# SecVote — Frontend (React + Vite)

This is the web UI for the SecVote platform. It provides dashboards for:
- **Admins**: Create elections, set eligible voters, and issue voter secret tokens.
- **Voters**: Authenticate via OTP, retrieve voter secret, select candidates, and cast encrypted votes on-chain.
- **Public**: View real-time election results and tally verification.

---

## 🚀 How to Run

### Prerequisites
Make sure the **local blockchain** and **backend API** are running first (see [Main README](../README.md)).

### Start Development Server
```bash
# 1. Install dependencies
npm install

# 2. Run dev server
npm run dev
```

The app will be available at: **http://localhost:5173**

---

## 📜 Available Scripts

- `npm run dev`: Starts the Vite development server with HMR.
- `npm run build`: Bundles the app for production in `dist/`.
- `npm run preview`: Locally previews the production build.
- `npm run lint`: Runs Oxlint code analysis.
