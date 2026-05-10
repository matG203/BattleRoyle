# MatchFit Pro Rebuild Prompt

I need you to rebuild a full-stack football fitness gamification app called **MatchFit Pro** from scratch. The existing codebase is at `github.com/matG203/matchpro-fit` but it has significant issues from file corruption during initial setup, so treat this as a reference for features and schema rather than working code. I want you to rebuild it cleanly and get it fully deployed and working.

## Overview

MatchFit Pro is a football fitness gamification platform where players track their fitness, earn XP, unlock avatars, get player card tiers, and compete with friends.

## Required Tech Stack

- **Frontend:** React + Vite + TypeScript + Tailwind CSS (Vercel)
- **Backend:** Node.js + Express + TypeScript, compiled to JavaScript (no ts-node in prod) (Railway)
- **Database:** PostgreSQL on Neon (already exists and is migrated)
- **ORM:** Prisma
- **Auth:** JWT
- **State:** Zustand

## Existing Infrastructure

- Neon DB: `postgresql://neondb_owner:npg_nfTEidgx08Xo@ep-damp-sound-ab4s4dcd-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require`
- GitHub repo: `github.com/matG203/matchpro-fit`
- Frontend: `matchpro-fit.vercel.app`
- Backend: `matchfit-pro-backend-production.up.railway.app`
- Railway env vars already set:
  - `DATABASE_URL` (Neon string above)
  - `JWT_SECRET=matchfitpro-secret-key-2024`
  - `PORT=8080`
  - `NODE_ENV=production`

## Critical Deployment Requirements

1. Backend must be compiled TypeScript (build with `npm run build`, start with `node dist/index.js`).
2. `backend/Dockerfile` must be exactly:

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install
COPY backend/ .
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build
EXPOSE 8080
CMD ["node", "dist/index.js"]
```

3. Prisma generator block must be:

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native"]
}
```

4. Railway backend service builder: Dockerfile mode, Dockerfile path = `backend/Dockerfile`, build context = repo root.
5. `backend/package-lock.json` must exist (root workspaces can break Railway install behavior).
6. `frontend/vercel.json` must exist with:

```json
{"rewrites": [{"source": "/(.*)", "destination": "/index.html"}]}
```

7. Frontend env var on Vercel:

```text
VITE_API_URL=https://matchfit-pro-backend-production.up.railway.app/api
```

8. Express CORS must use `origin: true`.
9. Express must include `app.set("trust proxy", 1)`.

## Prisma Data Model (already migrated in Neon)

Use these models exactly:

- `User`
- `Workout`
- `HealthMetric`
- `Challenge`
- `UserChallenge`
- `Friendship`
- `Notification`
- `PlayerCard`
- `Routine`
- `Wearable`
- `UserSettings`

(Fields and relations were provided in full in the original prompt.)

## Features to Build

- Authentication + onboarding
- Dashboard
- Player card
- Avatar system
- XP + leveling + tiers
- Workout planner + history
- Challenges
- Leaderboards (global + friends)
- Friends system
- Health tracking
- Match readiness score
- Daily routine
- Wearables simulation
- Settings

## Backend Routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/dashboard`
- `GET /api/profile`
- `PUT /api/profile`
- `GET /api/avatar`
- `PUT /api/avatar`
- `GET /api/xp`
- `POST /api/xp/award`
- `GET /api/workout`
- `POST /api/workout`
- `GET /api/health`
- `POST /api/health`
- `GET /api/challenges`
- `POST /api/challenges/:id/progress`
- `GET /api/leaderboard`
- `GET /api/leaderboard/friends`
- `GET /api/friends`
- `POST /api/friends/request`
- `PUT /api/friends/:id/accept`
- `DELETE /api/friends/:id`
- `GET /api/notifications`
- `PUT /api/notifications/:id/read`
- `GET /api/playerCard`
- `PUT /api/playerCard`
- `GET /api/routine`
- `PUT /api/routine`
- `GET /api/wearables`
- `PUT /api/wearables`
- `GET /api/readiness`
- `GET /api/settings`
- `PUT /api/settings`
- `GET /api/onboarding`
- `POST /api/onboarding`
- `GET /health` returns `{ "status": "ok" }`

## Frontend Pages

- Landing
- Register
- Login
- Onboarding
- Dashboard
- Player Card
- Avatar
- Workout Planner
- Workout History
- Challenges
- Leaderboard
- Friends
- Health
- Routine
- Wearables
- Tests
- Settings

## Design Requirements

- Dark theme (`#0a0f1e`) with electric blue accents (`#3b82f6`)
- White text
- Premium card-based look
- Smooth animations
- Mobile responsive

## Known Issues to Avoid

- Existing repo has corruption from bad encoding and quote mangling.
- Do not copy old files directly; rewrite cleanly.
- Root workspaces can break Railway install.
- Missing trust-proxy can break rate-limit behavior on Railway.

## Deliverables

1. Clean backend in `backend/`
2. Clean frontend in `frontend/`
3. Exact required `backend/Dockerfile`
4. `backend/package-lock.json`
5. `frontend/vercel.json`
6. Everything pushed to GitHub
7. Backend deployed on Railway and working
8. Frontend deployed on Vercel with end-to-end auth working

## Primary Success Criteria

Registration must work end to end:

- user submits email, username, password on frontend
- backend persists user to Neon DB
- JWT returned
- user redirected to onboarding
