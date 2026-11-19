# BrandGuard AI — Round 2 working prototype

BrandGuard checks draft content against organisation-approved brand guidance before publication. It reports rule violations and suggested corrections; a human reviewer makes the final decision.

## Included workflow
1. Create a brand guideline (brand name, tone, approved facts, required terms and prohibited terms).
2. Paste draft content or upload a text-based PDF/TXT file.
3. Run the content checker.
4. Inspect each finding, the rule it breaks and the suggested correction.
5. Record a human decision: Approved, Rejected or Changes requested.
6. View previous checks in Review history.

## Technology
- Frontend: React 18 + Vite
- Backend: Python + FastAPI
- Database: MongoDB (optional locally; temporary in-memory demo mode if no URI is configured)
- PDF text extraction: pypdf
- Analysis: transparent rule-based checks for configured terms and common unsupported promotional claims. Gemini is not required for the prototype.

## Run locally (Windows PowerShell)

### 1. Backend
Open PowerShell in the project folder:

```powershell
cd backend
py -3.10 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

Backend: http://localhost:8000  
API docs: http://localhost:8000/docs

If PowerShell blocks activation, run:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

### 2. Frontend (open a second PowerShell window)
```powershell
cd frontend
npm install
npm run dev
```
Open the local URL printed by Vite, usually http://localhost:5173.

## MongoDB Atlas
For persistent storage, create a free MongoDB Atlas database and copy its connection string into `backend/.env`:
```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@YOUR_CLUSTER/brandguard?retryWrites=true&w=majority
MONGODB_DATABASE=brandguard
FRONTEND_ORIGIN=http://localhost:5173
```
Replace the placeholders. Add your development IP to Atlas Network Access. Never commit `.env` or API keys to GitHub. If MongoDB is not configured, the backend uses temporary memory storage and data is lost when it restarts.

## Deploy
- Backend: Render, root directory `backend`, build command `pip install -r requirements.txt`, start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- Frontend: Vercel, root directory `frontend`, build command `npm run build`, output directory `dist`.
- Set Vercel environment variable `VITE_API_URL` to the deployed backend URL (no trailing slash).
- Set backend `FRONTEND_ORIGIN` to the deployed frontend URL and `MONGODB_URI` to the Atlas connection string.

## Important limitations to disclose
- Current PDF support extracts selectable text. Scanned PDFs need OCR and are not supported in this first build.
- Current checker is a transparent baseline, not a complete semantic AI fact-checker. It flags configured terminology and common absolute/promotional claims for human verification.
- The system does not publish content. Human reviewers own the final decision.
- Login, multi-organisation isolation, advanced image/visual checks, OCR and production-grade access control are not implemented in this Round 2 prototype.

## Demo test
1. Add a brand called `Acme Demo`.
2. Approved facts: `Acme was founded in 2015.`
3. Required term: `Acme`
4. Prohibited term: `cheap`
5. Submit: `Hey guys! Acme is the number 1 company with guaranteed results.`
6. Verify that terminology / claim / tone findings appear.
7. Enter reviewer name and approve, reject or request changes.
8. Open Review history and confirm the decision is listed.

## Before public submission
Test all links in a private/incognito window. Use MongoDB Atlas for persistent storage. Confirm the frontend can reach the backend. Do not submit until the public workflow has been tested end to end.
