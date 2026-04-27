require('dotenv').config();

const express = require('express');
const http = require('http');
const session = require('express-session');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DATABASE_PATH || './data/game.db';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev_secret';

const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const MAX_PLAYERS = 16;
const PLAYER_SPEED = 220;
const PLAYER_RADIUS = 14;
const PICKUP_RANGE = 55;
const START_HEALTH = 100;
const START_ARMOR = 0;
const BASE_SAFE_ZONE_SECONDS = 150;

const WEAPONS = {
  pistol: { name: 'Pistol', damage: 18, fireRate: 3.2, bulletSpeed: 1100, range: 620, magSize: 12, reloadTime: 1.3, spread: 0.03, ammoType: 'light' },
  smg: { name: 'SMG', damage: 12, fireRate: 9, bulletSpeed: 1000, range: 500, magSize: 28, reloadTime: 1.8, spread: 0.08, ammoType: 'light' },
  shotgun: { name: 'Shotgun', damage: 12, pellets: 7, fireRate: 1.2, bulletSpeed: 900, range: 360, magSize: 6, reloadTime: 2.1, spread: 0.22, ammoType: 'shell' },
  rifle: { name: 'Assault Rifle', damage: 20, fireRate: 6, bulletSpeed: 1300, range: 760, magSize: 30, reloadTime: 2, spread: 0.05, ammoType: 'heavy' },
  sniper: { name: 'Sniper Rifle', damage: 72, fireRate: 0.8, bulletSpeed: 1700, range: 1150, magSize: 5, reloadTime: 2.4, spread: 0.01, ammoType: 'heavy' }
};

const MAPS = {
  forest: { key: 'forest', name: 'Forest Camp', width: 2600, height: 2600, obstacleTheme: 'forest' },
  desert: { key: 'desert', name: 'Desert Outpost', width: 2800, height: 2600, obstacleTheme: 'desert' },
  urban: { key: 'urban', name: 'Urban Ruins', width: 2500, height: 2500, obstacleTheme: 'urban' }
};

const app = express();
const server = http.createServer(app);

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
});

app.use(express.json());
app.use(sessionMiddleware);
app.use(express.static('public'));

const io = new Server(server);
io.engine.use(sessionMiddleware);

const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    games_played INTEGER NOT NULL DEFAULT 0,
    total_kills INTEGER NOT NULL DEFAULT 0,
    total_wins INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

function sanitizeUser(userRow) {
  return {
    id: userRow.id,
    username: userRow.username,
    gamesPlayed: userRow.games_played,
    totalKills: userRow.total_kills,
    totalWins: userRow.total_wins
  };
}

app.post('/api/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters.' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]);
    req.session.userId = result.lastID;
    const user = await get('SELECT * FROM users WHERE id = ?', [result.lastID]);
    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    if (error.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username already exists.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Server error while registering.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return res.status(400).json({ error: 'Invalid credentials.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials.' });
    req.session.userId = user.id;
    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error while logging in.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', async (req, res) => {
  try {
    if (!req.session.userId) return res.json({ user: null });
    const user = await get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.json({ user: null });
    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error while loading profile.' });
  }
});

const rooms = new Map();
const socketToRoom = new Map();

function roomCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

function createObstacles(map) {
  const obs = [];
  const addRect = (x, y, w, h, type = 'wall', blocksBullets = true) => obs.push({ id: uuidv4(), x, y, w, h, type, blocksBullets });
  const count = map.obstacleTheme === 'forest' ? 70 : map.obstacleTheme === 'desert' ? 55 : 85;

  for (let i = 0; i < count; i += 1) {
    const x = 120 + Math.random() * (map.width - 240);
    const y = 120 + Math.random() * (map.height - 240);
    if (map.obstacleTheme === 'forest') {
      const size = 30 + Math.random() * 40;
      addRect(x, y, size, size, Math.random() > 0.45 ? 'tree' : 'rock', true);
    } else if (map.obstacleTheme === 'desert') {
      addRect(x, y, 40 + Math.random() * 70, 25 + Math.random() * 65, Math.random() > 0.6 ? 'tent' : 'barrier', true);
    } else {
      addRect(x, y, 45 + Math.random() * 90, 35 + Math.random() * 75, Math.random() > 0.55 ? 'building' : 'car', true);
    }
  }

  return obs;
}

function spawnLoot(map, obstacles) {
  const loot = [];
  const allWeapons = Object.keys(WEAPONS);
  const itemCount = 110;
  for (let i = 0; i < itemCount; i += 1) {
    const roll = Math.random();
    let item;
    if (roll < 0.36) {
      const wid = allWeapons[Math.floor(Math.random() * allWeapons.length)];
      item = { kind: 'weapon', weaponId: wid, amount: 1 };
    } else if (roll < 0.7) {
      const ammoTypes = ['light', 'heavy', 'shell'];
      item = { kind: 'ammo', ammoType: ammoTypes[Math.floor(Math.random() * ammoTypes.length)], amount: 10 + Math.floor(Math.random() * 24) };
    } else if (roll < 0.9) {
      item = { kind: 'armor', amount: 18 + Math.floor(Math.random() * 28) };
    } else {
      item = { kind: 'medkit', amount: 22 + Math.floor(Math.random() * 24) };
    }

    loot.push({
      id: uuidv4(),
      x: 90 + Math.random() * (map.width - 180),
      y: 90 + Math.random() * (map.height - 180),
      ...item
    });
  }

  // make sure center has some loot
  for (let i = 0; i < 12; i += 1) {
    loot.push({ id: uuidv4(), kind: 'ammo', ammoType: 'light', amount: 20, x: map.width / 2 + (Math.random() - 0.5) * 300, y: map.height / 2 + (Math.random() - 0.5) * 300 });
  }

  return loot;
}

function randomSpawn(map) {
  return {
    x: 100 + Math.random() * (map.width - 200),
    y: 100 + Math.random() * (map.height - 200)
  };
}

function newPlayer({ id, username, bot = false, color = '#3da5ff' }, map) {
  const spawn = randomSpawn(map);
  return {
    id,
    username,
    bot,
    color,
    x: spawn.x,
    y: spawn.y,
    angle: 0,
    moving: false,
    hp: START_HEALTH,
    armor: START_ARMOR,
    alive: true,
    kills: 0,
    input: { up: false, down: false, left: false, right: false, angle: 0, shooting: false, pickup: false, reload: false, mobileStickX: 0, mobileStickY: 0 },
    equipped: { weaponId: 'pistol', ammoInMag: WEAPONS.pistol.magSize, reserve: { light: 40, heavy: 0, shell: 0 } },
    shootCd: 0,
    reloadCd: 0,
    hitFlash: 0,
    respawnLock: false
  };
}

function ensureBots(room) {
  const currentHumans = Object.values(room.players).filter((p) => !p.bot).length;
  const target = Math.max(0, MAX_PLAYERS - currentHumans);
  let bots = Object.values(room.players).filter((p) => p.bot);

  while (bots.length < target) {
    const id = `bot_${uuidv4().slice(0, 8)}`;
    room.players[id] = newPlayer({ id, username: `Bot-${Math.floor(Math.random() * 900 + 100)}`, bot: true, color: '#ffb347' }, room.map);
    bots = Object.values(room.players).filter((p) => p.bot);
  }

  while (bots.length > target) {
    const remove = bots.pop();
    delete room.players[remove.id];
  }
}

function createRoom(hostUser) {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const map = MAPS.forest;
  const obstacles = createObstacles(map);

  const room = {
    code,
    hostUserId: hostUser.id,
    map,
    mapKey: map.key,
    players: {},
    sockets: new Set(),
    state: 'lobby',
    startedAt: null,
    safeZone: {
      cx: map.width / 2,
      cy: map.height / 2,
      startRadius: Math.min(map.width, map.height) * 0.48,
      currentRadius: Math.min(map.width, map.height) * 0.48,
      finalRadius: 90,
      durationMs: BASE_SAFE_ZONE_SECONDS * 1000,
      delayMs: 15000,
      phaseStartedAt: null
    },
    obstacles,
    loot: spawnLoot(map, obstacles),
    recentShots: [],
    winners: []
  };

  rooms.set(code, room);
  return room;
}

function rectCircleCollide(rect, x, y, r) {
  const nx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - nx;
  const dy = y - ny;
  return (dx * dx + dy * dy) < r * r;
}

function segmentIntersectsRect(x1, y1, x2, y2, rect) {
  // quick reject bounding box
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  if (maxX < rect.x || minX > rect.x + rect.w || maxY < rect.y || minY > rect.y + rect.h) return false;

  // If line endpoint is inside rect
  const inRect = (x, y) => x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
  if (inRect(x1, y1) || inRect(x2, y2)) return true;

  const lineIntersects = (ax, ay, bx, by, cx, cy, dx, dy) => {
    const det = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (det === 0) return false;
    const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / det;
    const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / det;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  };

  const rx = rect.x;
  const ry = rect.y;
  const rw = rect.w;
  const rh = rect.h;

  return (
    lineIntersects(x1, y1, x2, y2, rx, ry, rx + rw, ry) ||
    lineIntersects(x1, y1, x2, y2, rx + rw, ry, rx + rw, ry + rh) ||
    lineIntersects(x1, y1, x2, y2, rx + rw, ry + rh, rx, ry + rh) ||
    lineIntersects(x1, y1, x2, y2, rx, ry + rh, rx, ry)
  );
}

function emitLobby(room) {
  const players = Object.values(room.players).map((p) => ({ id: p.id, username: p.username, bot: p.bot }));
  io.to(room.code).emit('room:update', {
    code: room.code,
    hostUserId: room.hostUserId,
    mapKey: room.mapKey,
    mapName: room.map.name,
    players,
    botFill: Math.max(0, MAX_PLAYERS - players.filter((p) => !p.bot).length),
    state: room.state
  });
}

function playerPublicState(p) {
  return {
    id: p.id,
    username: p.username,
    bot: p.bot,
    x: p.x,
    y: p.y,
    angle: p.angle,
    moving: p.moving,
    hp: p.hp,
    armor: p.armor,
    alive: p.alive,
    kills: p.kills,
    color: p.color,
    weaponId: p.equipped.weaponId,
    ammoInMag: p.equipped.ammoInMag,
    reserve: p.equipped.reserve,
    hitFlash: p.hitFlash
  };
}

async function addGameStats(room, winnerId) {
  const humans = Object.values(room.players).filter((p) => !p.bot);
  for (const p of humans) {
    const isWinner = p.id === winnerId;
    await run(
      'UPDATE users SET games_played = games_played + 1, total_kills = total_kills + ?, total_wins = total_wins + ? WHERE id = ?',
      [p.kills, isWinner ? 1 : 0, p.id]
    );
  }
}

function attemptPickup(player, room) {
  if (!player.alive) return;
  let nearestIndex = -1;
  let nearestDist = Number.MAX_SAFE_INTEGER;

  room.loot.forEach((l, i) => {
    const d = Math.hypot(player.x - l.x, player.y - l.y);
    if (d < PICKUP_RANGE && d < nearestDist) {
      nearestDist = d;
      nearestIndex = i;
    }
  });

  if (nearestIndex === -1) return;
  const item = room.loot[nearestIndex];
  room.loot.splice(nearestIndex, 1);

  if (item.kind === 'weapon') {
    player.equipped.weaponId = item.weaponId;
    const stat = WEAPONS[item.weaponId];
    player.equipped.ammoInMag = Math.min(stat.magSize, player.equipped.reserve[stat.ammoType] || 0);
  } else if (item.kind === 'ammo') {
    const current = player.equipped.reserve[item.ammoType] || 0;
    player.equipped.reserve[item.ammoType] = Math.min(240, current + item.amount);
  } else if (item.kind === 'armor') {
    player.armor = Math.min(100, player.armor + item.amount);
  } else if (item.kind === 'medkit') {
    player.hp = Math.min(100, player.hp + item.amount);
  }
}

function dealDamage(room, shooter, target, rawDamage) {
  if (!target.alive) return;
  const armorAbsorb = Math.min(target.armor, rawDamage * 0.5);
  target.armor = Math.max(0, target.armor - armorAbsorb);
  const hpDamage = rawDamage - armorAbsorb;
  target.hp -= hpDamage;
  target.hitFlash = 0.22;

  if (target.hp <= 0) {
    target.alive = false;
    target.hp = 0;
    if (shooter && shooter.id !== target.id) shooter.kills += 1;
    io.to(room.code).emit('killfeed', {
      killer: shooter ? shooter.username : 'Fire Zone',
      victim: target.username
    });
  }
}

function performShoot(room, shooter) {
  if (!shooter.alive) return;
  const weapon = WEAPONS[shooter.equipped.weaponId];
  if (!weapon) return;
  if (shooter.reloadCd > 0) return;
  if (shooter.shootCd > 0) return;

  if (shooter.equipped.ammoInMag <= 0) {
    return;
  }

  shooter.equipped.ammoInMag -= 1;
  shooter.shootCd = 1 / weapon.fireRate;

  const pelletCount = weapon.pellets || 1;
  for (let p = 0; p < pelletCount; p += 1) {
    const spread = (Math.random() - 0.5) * weapon.spread;
    const ang = shooter.angle + spread;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const endX = shooter.x + dx * weapon.range;
    const endY = shooter.y + dy * weapon.range;

    const blocked = room.obstacles.some((o) => o.blocksBullets && segmentIntersectsRect(shooter.x, shooter.y, endX, endY, o));
    if (blocked) continue;

    let bestTarget = null;
    let bestDist = Number.MAX_SAFE_INTEGER;

    Object.values(room.players).forEach((target) => {
      if (!target.alive || target.id === shooter.id) return;
      const vx = target.x - shooter.x;
      const vy = target.y - shooter.y;
      const along = vx * dx + vy * dy;
      if (along < 0 || along > weapon.range) return;
      const perpSq = vx * vx + vy * vy - along * along;
      if (perpSq > (PLAYER_RADIUS + 5) * (PLAYER_RADIUS + 5)) return;
      if (along < bestDist) {
        bestDist = along;
        bestTarget = target;
      }
    });

    if (bestTarget) {
      dealDamage(room, shooter, bestTarget, weapon.damage);
    }
  }

  room.recentShots.push({
    id: uuidv4(),
    x: shooter.x,
    y: shooter.y,
    angle: shooter.angle,
    weaponId: shooter.equipped.weaponId,
    at: Date.now()
  });
}

function processReload(player) {
  const weapon = WEAPONS[player.equipped.weaponId];
  if (!weapon) return;
  const ammoType = weapon.ammoType;
  const reserve = player.equipped.reserve[ammoType] || 0;
  if (player.equipped.ammoInMag >= weapon.magSize || reserve <= 0 || player.reloadCd > 0) return;
  player.reloadCd = weapon.reloadTime;
}

function finishReload(player) {
  const weapon = WEAPONS[player.equipped.weaponId];
  const ammoType = weapon.ammoType;
  const reserve = player.equipped.reserve[ammoType] || 0;
  const need = weapon.magSize - player.equipped.ammoInMag;
  const take = Math.min(need, reserve);
  player.equipped.ammoInMag += take;
  player.equipped.reserve[ammoType] = reserve - take;
}

function updateBots(room, dt) {
  const aliveEnemies = Object.values(room.players).filter((p) => p.alive);
  Object.values(room.players).forEach((bot) => {
    if (!bot.bot || !bot.alive) return;

    const enemy = aliveEnemies
      .filter((e) => e.id !== bot.id)
      .sort((a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y))[0];

    bot.input.up = bot.input.down = bot.input.left = bot.input.right = false;
    bot.input.pickup = Math.random() < 0.02;

    let tx = room.safeZone.cx;
    let ty = room.safeZone.cy;

    const distZone = Math.hypot(bot.x - room.safeZone.cx, bot.y - room.safeZone.cy);
    if (distZone < room.safeZone.currentRadius - 40 && enemy) {
      tx = enemy.x;
      ty = enemy.y;
    }

    const dx = tx - bot.x;
    const dy = ty - bot.y;

    if (Math.abs(dx) > 12) {
      if (dx > 0) bot.input.right = true;
      else bot.input.left = true;
    }
    if (Math.abs(dy) > 12) {
      if (dy > 0) bot.input.down = true;
      else bot.input.up = true;
    }

    if (enemy) {
      bot.angle = Math.atan2(enemy.y - bot.y, enemy.x - bot.x);
      const distEnemy = Math.hypot(enemy.x - bot.x, enemy.y - bot.y);
      bot.input.shooting = distEnemy < 500;
      if (bot.equipped.ammoInMag <= 0) bot.input.reload = true;
    }
  });
}

function updateRoom(room, dt) {
  if (room.state !== 'inGame') return;

  const now = Date.now();
  if (!room.safeZone.phaseStartedAt) room.safeZone.phaseStartedAt = now;
  const phaseTime = now - room.safeZone.phaseStartedAt;
  if (phaseTime > room.safeZone.delayMs) {
    const t = Math.min(1, (phaseTime - room.safeZone.delayMs) / room.safeZone.durationMs);
    room.safeZone.currentRadius = room.safeZone.startRadius + (room.safeZone.finalRadius - room.safeZone.startRadius) * t;
  }

  updateBots(room, dt);

  Object.values(room.players).forEach((p) => {
    if (!p.alive) return;

    const movementX = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    const movementY = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
    let vx = movementX;
    let vy = movementY;
    const len = Math.hypot(vx, vy) || 1;
    vx = (vx / len) * PLAYER_SPEED;
    vy = (vy / len) * PLAYER_SPEED;

    const nx = Math.max(0, Math.min(room.map.width, p.x + vx * dt));
    const ny = Math.max(0, Math.min(room.map.height, p.y + vy * dt));

    const blocked = room.obstacles.some((o) => rectCircleCollide(o, nx, ny, PLAYER_RADIUS));
    if (!blocked) {
      p.x = nx;
      p.y = ny;
    }

    p.moving = Math.abs(vx) + Math.abs(vy) > 0;
    p.angle = p.input.angle;

    p.shootCd = Math.max(0, p.shootCd - dt);
    const prevReload = p.reloadCd;
    p.reloadCd = Math.max(0, p.reloadCd - dt);
    if (prevReload > 0 && p.reloadCd === 0) finishReload(p);

    p.hitFlash = Math.max(0, p.hitFlash - dt * 2.5);

    if (p.input.pickup) attemptPickup(p, room);
    if (p.input.reload) processReload(p);
    if (p.input.shooting) performShoot(room, p);

    const distToCenter = Math.hypot(p.x - room.safeZone.cx, p.y - room.safeZone.cy);
    if (distToCenter > room.safeZone.currentRadius) {
      dealDamage(room, null, p, 6 * dt);
    }
  });

  room.recentShots = room.recentShots.filter((s) => now - s.at < 220);

  const alive = Object.values(room.players).filter((p) => p.alive);
  if (alive.length <= 1) {
    const winner = alive[0] || null;
    room.state = 'ended';
    room.winners = winner ? [winner.id] : [];
    io.to(room.code).emit('match:end', {
      winner: winner ? winner.username : 'No one',
      players: Object.values(room.players).map((p) => ({ id: p.id, username: p.username, kills: p.kills, alive: p.alive }))
    });

    if (winner) addGameStats(room, winner.id).catch(console.error);
    else addGameStats(room, null).catch(console.error);

    setTimeout(() => {
      // reset to lobby for replay
      room.state = 'lobby';
      room.startedAt = null;
      room.safeZone.currentRadius = room.safeZone.startRadius;
      room.safeZone.phaseStartedAt = null;
      room.loot = spawnLoot(room.map, room.obstacles);
      Object.values(room.players).forEach((p) => {
        const fresh = newPlayer({ id: p.id, username: p.username, bot: p.bot, color: p.color }, room.map);
        room.players[p.id] = { ...fresh, equipped: fresh.equipped };
      });
      ensureBots(room);
      emitLobby(room);
    }, 7000);
  }

  io.to(room.code).emit('game:state', {
    roomCode: room.code,
    map: room.map,
    state: room.state,
    safeZone: room.safeZone,
    players: Object.values(room.players).map(playerPublicState),
    obstacles: room.obstacles,
    loot: room.loot,
    shots: room.recentShots,
    remaining: alive.length,
    startedAt: room.startedAt
  });
}

setInterval(() => {
  const dt = TICK_MS / 1000;
  rooms.forEach((room) => updateRoom(room, dt));
}, TICK_MS);

io.use(async (socket, next) => {
  try {
    const sessionObj = socket.request.session;
    if (!sessionObj || !sessionObj.userId) return next(new Error('Unauthorized'));
    const user = await get('SELECT * FROM users WHERE id = ?', [sessionObj.userId]);
    if (!user) return next(new Error('Unauthorized'));
    socket.user = sanitizeUser(user);
    return next();
  } catch (err) {
    return next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.emit('meta:weapons', WEAPONS);

  socket.on('room:create', ({ mapKey }) => {
    const selectedMap = MAPS[mapKey] || MAPS.forest;
    const room = createRoom(socket.user);
    room.map = selectedMap;
    room.mapKey = selectedMap.key;
    room.obstacles = createObstacles(selectedMap);
    room.loot = spawnLoot(selectedMap, room.obstacles);
    room.safeZone = {
      cx: selectedMap.width / 2,
      cy: selectedMap.height / 2,
      startRadius: Math.min(selectedMap.width, selectedMap.height) * 0.48,
      currentRadius: Math.min(selectedMap.width, selectedMap.height) * 0.48,
      finalRadius: 90,
      durationMs: BASE_SAFE_ZONE_SECONDS * 1000,
      delayMs: 15000,
      phaseStartedAt: null
    };

    room.players[socket.user.id] = newPlayer({ id: socket.user.id, username: socket.user.username, color: '#4fd1c5' }, selectedMap);
    socket.join(room.code);
    room.sockets.add(socket.id);
    socketToRoom.set(socket.id, room.code);
    ensureBots(room);
    emitLobby(room);
  });

  socket.on('room:join', ({ code }) => {
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) {
      socket.emit('error:message', 'Room code not found.');
      return;
    }
    if (room.state === 'inGame') {
      socket.emit('error:message', 'Match already in progress.');
      return;
    }

    const humanCount = Object.values(room.players).filter((p) => !p.bot).length;
    if (humanCount >= MAX_PLAYERS) {
      socket.emit('error:message', 'Room is full.');
      return;
    }

    room.players[socket.user.id] = newPlayer({ id: socket.user.id, username: socket.user.username, color: '#58a6ff' }, room.map);
    socket.join(room.code);
    room.sockets.add(socket.id);
    socketToRoom.set(socket.id, room.code);
    ensureBots(room);
    emitLobby(room);
  });

  socket.on('room:setMap', ({ mapKey }) => {
    const code = socketToRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.state !== 'lobby') return;
    if (room.hostUserId !== socket.user.id) return;
    const selectedMap = MAPS[mapKey] || MAPS.forest;
    room.map = selectedMap;
    room.mapKey = selectedMap.key;
    room.obstacles = createObstacles(selectedMap);
    room.loot = spawnLoot(selectedMap, room.obstacles);
    room.safeZone = {
      cx: selectedMap.width / 2,
      cy: selectedMap.height / 2,
      startRadius: Math.min(selectedMap.width, selectedMap.height) * 0.48,
      currentRadius: Math.min(selectedMap.width, selectedMap.height) * 0.48,
      finalRadius: 90,
      durationMs: BASE_SAFE_ZONE_SECONDS * 1000,
      delayMs: 15000,
      phaseStartedAt: null
    };

    Object.values(room.players).forEach((p) => {
      const spawn = randomSpawn(selectedMap);
      p.x = spawn.x;
      p.y = spawn.y;
    });
    emitLobby(room);
  });

  socket.on('room:start', () => {
    const code = socketToRoom.get(socket.id);
    const room = rooms.get(code);
    if (!room || room.state !== 'lobby') return;
    if (room.hostUserId !== socket.user.id) return;
    ensureBots(room);
    room.state = 'inGame';
    room.startedAt = Date.now();
    room.safeZone.phaseStartedAt = null;
    io.to(room.code).emit('match:start', { startedAt: room.startedAt, map: room.map });
    emitLobby(room);
  });

  socket.on('player:input', (input) => {
    const code = socketToRoom.get(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room || room.state !== 'inGame') return;
    const player = room.players[socket.user.id];
    if (!player) return;

    player.input = {
      ...player.input,
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      angle: Number.isFinite(input.angle) ? input.angle : player.angle,
      shooting: !!input.shooting,
      pickup: !!input.pickup,
      reload: !!input.reload
    };
  });

  socket.on('disconnect', () => {
    const code = socketToRoom.get(socket.id);
    socketToRoom.delete(socket.id);
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    room.sockets.delete(socket.id);
    if (room.players[socket.user.id]) {
      delete room.players[socket.user.id];
    }

    if (room.hostUserId === socket.user.id) {
      const nextHost = Object.values(room.players).find((p) => !p.bot);
      room.hostUserId = nextHost ? nextHost.id : null;
    }

    const humanCount = Object.values(room.players).filter((p) => !p.bot).length;
    if (humanCount === 0) {
      rooms.delete(code);
      return;
    }

    ensureBots(room);
    emitLobby(room);
  });
});

initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error('Failed to initialize DB:', error);
  process.exit(1);
});
