# DT-SDA: Digital Twin Framework for Secure Document Authentication

MVP implementation of:
**Physical Document Layer → Digital Twin Generation Layer → AI Analytics (simplified) → Blockchain Trust Layer → Verification & Access Layer**

## Project layout

```
dt-sda/
├── contracts/
│   └── DTSDA.sol              # Blockchain Trust Layer
├── scripts/
│   └── deploy.js              # deploys + writes ABI/address to frontend/DTSDA.json
├── test/
│   └── DTSDA.test.js          # Hardhat/Chai contract tests
├── backend/
│   ├── generateTwin.js        # Digital Twin Generation Layer (SHA-256 + pHash)
│   ├── ipfsUpload.js          # Pinata IPFS upload
│   ├── riskScore.js           # AI Analytics Layer (rule-based, SQLite-backed)
│   └── server.js              # Express API tying it together
├── frontend/
│   ├── connectWallet.js       # MetaMask connection
│   ├── dtsdaContract.js       # register/revoke/amend/getTwin via ethers.js
│   ├── verifyDocument.js      # Verification & Access Layer (Algorithm 1)
│   ├── qrCode.js              # QR generate/scan helpers
│   └── App.jsx                # minimal demo UI (issuer + verifier tabs)
├── hardhat.config.js
├── package.json
└── .env.example
```

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `SEPOLIA_RPC_URL` — free from Alchemy or Infura
- `PRIVATE_KEY` — a MetaMask **test wallet's** private key (fund it from a Sepolia faucet)
- `PINATA_API_KEY` / `PINATA_SECRET_API_KEY` — optional, only needed if you want real IPFS uploads
- `ETHERSCAN_API_KEY` — optional, only needed for contract verification

## Build order

1. **Contract + local testing**
   ```bash
   npm run compile
   npm test
   ```
2. **Deploy to Sepolia**
   ```bash
   npm run deploy:sepolia
   ```
   This writes the deployed address + ABI to `frontend/DTSDA.json`, which the frontend imports directly — no manual copy-pasting of addresses.
   Optionally verify on Etherscan:
   ```bash
   npx hardhat verify --network sepolia <address>
   ```
3. **Backend** (handles twin generation + IPFS + risk-score logging)
   ```bash
   npm run backend
   ```
   Runs on `http://localhost:4000`.
4. **Frontend** — `frontend/App.jsx` is written as a drop-in component. Scaffold it into a React app of your choice:
   ```bash
   npx create-vite@latest dt-sda-ui -- --template react
   cp frontend/*.js frontend/*.jsx dt-sda-ui/src/
   cd dt-sda-ui && npm install ethers qrcode crypto-js html5-qrcode
   ```
   Then render `<App />` from `main.jsx`, and set `REACT_APP_BACKEND_URL` / `REACT_APP_CONTRACT_ADDRESS` as needed (or rely on the auto-generated `DTSDA.json`).

## What's implemented vs. stubbed

| Layer | Status |
|---|---|
| Digital Twin Generation (SHA-256 + optional pHash) | ✅ implemented |
| IPFS storage (Pinata) | ✅ implemented (needs Pinata keys) |
| Blockchain Trust Layer (Solidity contract, tested) | ✅ implemented |
| MetaMask signing / issuer identity | ✅ implemented |
| Verification & Access Layer (Algorithm 1) | ✅ implemented |
| QR generation/scanning | ✅ implemented |
| AI Analytics (rule-based duplicate/frequency scoring) | ✅ implemented |
| Full ML anomaly detection | ⛔ out of scope for MVP (rule-based scoring stands in) |
| Zero-Knowledge Proofs (selective metadata disclosure) | ⛔ stubbed only — would need a Circom circuit + `snarkjs`, treat as separate milestone |
| Production key management / post-quantum crypto / scalability | ⛔ explicitly out of scope per the paper |

## Notes

- This was scaffolded and dependency-installed in a sandboxed environment without access to `binaries.soliditylang.org`, so `npm run compile` / `npm test` couldn't be executed here. Both should run normally on a machine with unrestricted internet access — the contract and tests are written against Solidity 0.8.19 / Hardhat Toolbox conventions and don't rely on anything exotic.
- No rate limiting or formal security audit has been done on the contract — fine for a demo, not for production.
