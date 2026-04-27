# Battle Royle MVP (Browser Multiplayer)

A full-stack MVP top-down battle royale game you can run locally, push to GitHub, and deploy on Railway.

## Features in this MVP

- ✅ Register/login (username + password)
- ✅ Persistent player stats (games played, kills, wins) in SQLite
- ✅ Create or join room using room code
- ✅ Host can select map and start match
- ✅ Solos match up to 16 slots (bots fill missing players)
- ✅ 3 maps:
  - Forest Camp
  - Desert Outpost
  - Urban Ruins
- ✅ WASD + mouse aim + click shoot + E pickup + R reload
- ✅ Mobile touch controls (move stick + aim/shoot stick + pickup/reload buttons)
- ✅ Weapons: pistol, SMG, shotgun, AR, sniper
- ✅ Ground loot: weapons, ammo, armor, medkits
- ✅ Armor and health system
- ✅ Shrinking fire zone damages players outside safe circle
- ✅ Win detection + end match screen + stats update

---

## Folder structure

```txt
BattleRoyle/
  .env.example
  .gitignore
  package.json
  server.js
  README.md
  data/
    (sqlite db created automatically at runtime)
  public/
    index.html
    styles.css
    js/
      client.js
```

---

## 1) Run locally (beginner steps)

### Prerequisites

- Install Node.js 20+ from: https://nodejs.org/

### Steps

1. Clone/download this repo.
2. Open terminal in project root.
3. Install dependencies:

```bash
npm install
```

4. Create your `.env` file:

```bash
cp .env.example .env
```

5. Start the server:

```bash
npm run dev
```

6. Open browser:

- http://localhost:3000

7. Register a user and start playing.

---

## 2) Push to GitHub

If this is a brand new repo:

```bash
git init
git add .
git commit -m "Initial Battle Royle MVP"
git branch -M main
git remote add origin https://github.com/<YOUR_USERNAME>/<YOUR_REPO>.git
git push -u origin main
```

If repo already exists:

```bash
git add .
git commit -m "Build playable battle royale MVP"
git push
```

---

## 3) Deploy to Railway

1. Go to https://railway.app and create project.
2. Choose **Deploy from GitHub Repo**.
3. Select this repository.
4. In Railway variables, set:
   - `SESSION_SECRET` = random long secret
   - `PORT` (Railway normally injects this automatically)
   - optional: `DATABASE_PATH=./data/game.db`
5. Ensure Start Command is:

```bash
npm start
```

6. Deploy and open the generated Railway URL.

> Note: SQLite works for MVPs but is single-file local storage. For production scale, switch to Postgres.

---

## 4) Test multiplayer (tabs/devices)

### Local same computer

1. Open Tab A and Tab B to `http://localhost:3000`.
2. Register/login with two separate accounts.
3. In Tab A: create room, copy code.
4. In Tab B: join room by code.
5. Host starts game.
6. Verify movement/combat on both tabs.

### Local network (phone + computer)

1. Find computer local IP (example: `192.168.1.24`).
2. Start server with `npm run dev`.
3. On phone (same Wi-Fi), open:

```txt
http://<YOUR_LOCAL_IP>:3000
```

4. Join same room code and test mobile controls.

### Railway online

1. Open deployed URL in multiple tabs/devices.
2. Repeat room flow.
3. Verify stats persist after match end.

---

## Gameplay notes

- Bots are basic but functional: they move toward enemies/safe zone, shoot, loot occasionally.
- Bullets are hitscan and can be blocked by map obstacles.
- Safe zone starts large, then shrinks after delay.

---

## Beginner guide: where to edit what

- `server.js`
  - Authentication APIs
  - SQLite setup and stats
  - Room + multiplayer logic
  - Bot AI
  - Weapons/map/zone mechanics
- `public/js/client.js`
  - UI and screen flow
  - Input handling (desktop/mobile)
  - Rendering (cartoon players, HUD, map, effects)
- `public/index.html`
  - All menus/lobby/game HUD markup
- `public/styles.css`
  - Visual styles

---

## Security warning for production

This MVP is for learning/prototyping. Before real production, add:

- stronger auth/session hardening
- rate-limiting
- validation library
- anti-cheat improvements
- HTTPS cookie settings
- move to Postgres

