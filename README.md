# PROMETHEUS-X

**Industrial Defect Intelligence, Self-Challenging Model Reliability & 3D Counterfactual Factory Twin Platform**

PROMETHEUS-X is a full-stack industrial quality engineering platform designed for electronics assembly and automotive manufacturing lines. It combines deterministic optical defect inspection, 5-perturbation model reliability auditing, an interactive 3D factory twin connected to persisted inspection records, spatial & production-line heat maps, cross-factory defect transfer intelligence, human-in-the-loop QA calibration, and predictive maintenance forecasting.

---

## Core Capabilities

1. **Executive Quality Overview & Interactive Heat Maps**
   - KPI summary across total inspected volume, detected defects, flagged model reliability, QA queue, false positive rate, and average reliability score.
   - **Defect Intensity & Spatial Heat Map** with switchable **Line × Defect**, **Shift Hours**, and **Spatial Surface** Gaussian density views (Thermal, Viridis, and Amber scales) linked directly to Digital Defect Passports.
2. **Optical Inspection Workbench & Self-Challenging AI Reliability**
   - Deterministic Sobel gradient localization, luminance/contrast/edge metrics, and thermal anomaly heat map overlay with adjustable opacity.
   - Runs a 5-perturbation optical stress test (Exposure -35%, Glare +30%, Gaussian Blur, ISO Noise, Rotation +7°) to score prediction stability (`RELIABLE`, `REVIEW_REQUIRED`, `UNSTABLE`).
3. **Interactive 3D Counterfactual Factory Twin (Three.js / WebGL)**
   - Live 3D production line representing Station 01 (Reflow Oven / CNC Cell / Flux Washer), Station 02 (Pick & Place / Stamping Press / Coating Cell), and Station 03 (Optical AOI Bridge).
   - **Connected to real inspection records**: click any 3D station to inspect its persisted inspection history, automatically highlight stations with active inspection or maintenance alerts, track defective workpieces on the conveyor linked to their Digital Defect Passports, switch individual station camera presets, toggle a 3D floor thermal heat map, and run a **Before / After Process Simulation** comparing observed baseline drift against counterfactual interventions.
4. **Cross-Factory Intelligence**
   - Interactive React Flow transfer graph and comparative defect analytics across three simulated plants: **Factory A** (Electronics Manufacturing), **Factory B** (Automotive Components), and **Factory C** (Automotive Electronics).
5. **Digital Defect Passports & Human Review Loop**
   - Traceable inspection passports with thermal heat map overlay, perturbation audit log, JSON export, and QA engineer verification (`CONFIRMED`, `FALSE_POSITIVE`, `RECLASSIFIED`).
6. **Predictive Maintenance & Context-Aware Dashboard Assistant**
   - Equipment health scores, 7-day vs. 30-day failure risk forecasts, Remaining Useful Life (RUL), and a slide-over Dashboard Assistant that explains active dashboard telemetry and recommends corrective engineering actions.
7. **Light & Dark Theme Support**
   - Enterprise Light and Dark mode toggle persisted across reloads, adapting all charts, graphs, heat maps, and the 3D WebGL factory scene.

---

## Architecture & Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4 | Single-page enterprise dashboard with Light/Dark theming |
| **3D & Visualization** | Three.js, Recharts, React Flow (`@xyflow/react`), HTML5 Canvas | 3D Factory Twin, trend/sensitivity charts, cross-factory graph, thermal heat maps |
| **Backend** | Node.js, Express, TypeScript (`server.ts`) | REST API, RBAC middleware, file upload validation, server-side AI proxy |
| **Database** | PostgreSQL (Google Cloud SQL) + Drizzle ORM (`src/db/schema.ts`) | Persistent storage for factories, users, inspections, scenarios, maintenance forecasts, and audit logs |
| **Authentication** | Server-signed HMAC-SHA256 workspace sessions (`src/middleware/auth.ts`) | Non-personal role-based workspace sign-in (`SUPER_ADMIN`, `FACTORY_ADMIN`, `QUALITY_ENGINEER`, `OPERATOR`) with optional env-configured Firebase Admin verification |
| **CV & Simulation** | Deterministic TypeScript engines (`src/lib/cv-engine.ts`, `src/lib/counterfactual-engine.ts`) | Pixel-level Sobel localization, anomaly scoring, perturbation auditing, and counterfactual process modeling |
| **Generative AI** | Google Gemini API (`@google/genai`, server-side only) | Natural-language root-cause summaries, cross-factory digests, and dashboard Q&A |

---

## Local Setup & Running

### 1. Prerequisites
- Node.js 20+
- PostgreSQL 15+ (local instance or Google Cloud SQL)

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your local values (never commit `.env`):
```bash
cp .env.example .env
```

Required variables:
- `GEMINI_API_KEY` — Server-side Google Gemini API key for engineering explanations and dashboard assistant
- `SQL_HOST`, `SQL_DB_NAME`, `SQL_USER`, `SQL_PASSWORD` — PostgreSQL connection credentials
- `SQL_ADMIN_USER`, `SQL_ADMIN_PASSWORD` — PostgreSQL admin credentials for Drizzle schema push
- `APP_URL` — Application base URL (default `http://localhost:3000`)
- `VITE_FIREBASE_*` *(optional)* — Client-side Firebase web configuration read by `src/lib/firebase.ts`; place real values only in local `.env.local` or hosting environment settings (never commit `firebase-applet-config.json`)

### 4. Push Database Schema & Run
```bash
npx drizzle-kit push --config=src/db/drizzle.config.ts
npm run dev
```
The server starts on `http://localhost:3000`.

### 5. Build & Type-Check
```bash
npm run lint
npm run build
```

---

## Security & Secret Hygiene

- **No committed secrets or API keys**: `.env*`, `.aistudio/`, and any local Firebase config files are excluded via `.gitignore`.
- **Server-side secret boundary**: `GEMINI_API_KEY`, database credentials, and HMAC session signing keys are read strictly from server-side `process.env` and never exposed to browser bundles.
- **Parameterized database queries**: All PostgreSQL queries use Drizzle ORM parameterized builders (`src/db/`).
- **Upload & request validation**: Zod schemas validate API payloads (`src/types/prometheus.ts`), and image uploads verify MIME type, 5 MB ceiling, and binary magic bytes (`src/middleware/security.ts`).

---

## Section 5 Disclosures — Tools, APIs, Datasets & Templates

To maintain full transparency for evaluation and auditing:

1. **AI-Assisted Development Tools**
   - **Google AI Studio** was used to assist with iterative code generation, UI layout refinement, Three.js scene wiring, and TypeScript debugging.
2. **External APIs**
   - **Google Gemini API (`@google/genai`)**: Called exclusively from the Express backend (`/api/*`) to generate human-readable defect investigation briefs, counterfactual summaries, cross-factory digests, and Dashboard Assistant responses. Gemini is **not** used as a replacement for the deterministic computer-vision inspection and reliability engine.
3. **Datasets & Simulated Data Notice**
   - All default production lines (**Factory A — Electronics Manufacturing**, **Factory B — Automotive Components**, **Factory C — Automotive Electronics**), seed inspection records, sample AOI inspection plates, predictive maintenance forecasts, and counterfactual process curves are **explicitly simulated** and labeled as simulated throughout the UI and database (`isSimulated = true`). Users may also upload custom JPEG/PNG/WebP inspection frames, which are labeled as live (`isSimulated = false`).
4. **Open-Source Libraries & Starter Templates**
   - Built on the Vite + React + TypeScript starter structure using open-source packages: React, Tailwind CSS, Three.js, Recharts, React Flow (`@xyflow/react`), Lucide React, Express, Drizzle ORM, pg, Helmet, Multer, Axios, and Zod.

---

## Repository Submission & Deliverables Checklist

Before submitting to your public Git repository:

1. **Create Meaningful Git Commit History** (recommended when exporting locally):
   ```bash
   git init
   git add package.json tsconfig.json vite.config.ts index.html .gitignore .env.example metadata.json
   git commit -m "chore: initialize PROMETHEUS-X project configuration and hygiene"
   git add src/db src/middleware src/lib server.ts
   git commit -m "feat: add PostgreSQL Drizzle schema, Express API, CV engine, and counterfactual engine"
   git add src/context src/types src/components/ui src/components/auth src/components/layout
   git commit -m "feat: add enterprise light/dark UI shell and role-based workspace auth"
   git add src/components/overview src/components/heatmap src/components/inspection src/components/passport
   git commit -m "feat: add executive dashboard, defect heat maps, optical inspection workbench, and passports"
   git add src/components/twin src/components/crossfactory src/components/feedback src/components/maintenance src/components/admin src/components/assistant src/App.tsx src/main.tsx src/index.css public
   git commit -m "feat: add interactive 3D factory twin, cross-factory graph, maintenance, and dashboard assistant"
   git add README.md
   git commit -m "docs: add architecture documentation and Section 5 AI/API/dataset disclosures"
   ```
2. **Verify Zero Secrets Before Push**:
   ```bash
   git grep -E "AIzaSy|sk-|ghp_" || echo "Clean: no secrets tracked"
   ```
3. **Final Deliverables**:
   - **Team Name & Members**: `[Add team name and member details]`
   - **Public Repository URL**: `[Add GitHub repository URL]`
   - **Live Demo / Deployment URL**: `[Add deployed Cloud Run / live demo URL]`
   - **Presentation Deck (PPT)**: `[Add link to project presentation slides]`
