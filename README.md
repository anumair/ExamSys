# FortiExam (ExamSys)

Secure exam delivery and evaluation platform built with React, Express, and MongoDB. Admins create encrypted exam packages; students decrypt at the scheduled time, take quizzes, and submit signed answers; the backend verifies signatures, stores submissions, and computes results.

## Features
- Encrypted exam packages (AES‑256‑GCM + HKDF key evolution)
- Server‑signed packages (Ed25519) with client verification
- Client‑side student keypair (private key stored in IndexedDB, non‑extractable)
- Signed answer submissions with server verification
- Admin dashboards: package history, submissions, action logs, results
- Result announcement with re‑verification of signatures

## Quick Start
1. Install dependencies:
   ```bash
   npm install
   npm --prefix server install
   npm --prefix client install
   ```
2. Create `/server/.env`:
   ```env
   MONGO_URI=your_mongodb_uri
   JWT_SECRET=your_secret
   EPOCH_TIME=2025-01-01T00:00:00Z
   STEP_SIZE_SECONDS=300
   K0_HEX=9f8c7a1e3d5b6c9a2f4e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a291817161514
   ```
3. Run:
   ```bash
   npm run server
   npm run client
   ```

## Scripts
- `npm run server` — start API server
- `npm run client` — start React dev server

## Notes
- Student private keys are stored in IndexedDB via WebCrypto as non‑extractable keys.
- Exam packages are stored in `/packages` and metadata in MongoDB.
- Admin routes are protected by JWT and role checks.
