const screens = {
  auth: document.getElementById('authScreen'),
  menu: document.getElementById('menuScreen'),
  lobby: document.getElementById('lobbyScreen'),
  game: document.getElementById('gameScreen'),
  end: document.getElementById('endScreen')
};

const el = {
  usernameInput: document.getElementById('usernameInput'),
  passwordInput: document.getElementById('passwordInput'),
  authMessage: document.getElementById('authMessage'),
  menuMessage: document.getElementById('menuMessage'),
  welcomeText: document.getElementById('welcomeText'),
  statBlock: document.getElementById('statBlock'),
  roomCodeInput: document.getElementById('roomCodeInput'),
  lobbyCode: document.getElementById('lobbyCode'),
  lobbyMap: document.getElementById('lobbyMap'),
  lobbyCount: document.getElementById('lobbyCount'),
  lobbyBots: document.getElementById('lobbyBots'),
  lobbyPlayers: document.getElementById('lobbyPlayers'),
  lobbyMessage: document.getElementById('lobbyMessage'),
  lobbyMapSelect: document.getElementById('lobbyMapSelect'),
  createMapSelect: document.getElementById('createMapSelect'),
  canvas: document.getElementById('gameCanvas'),
  hudHp: document.getElementById('hudHp'),
  hudArmor: document.getElementById('hudArmor'),
  hudWeapon: document.getElementById('hudWeapon'),
  hudAmmo: document.getElementById('hudAmmo'),
  hudKills: document.getElementById('hudKills'),
  hudRemaining: document.getElementById('hudRemaining'),
  hudZone: document.getElementById('hudZone'),
  pickupBtn: document.getElementById('pickupBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  endWinner: document.getElementById('endWinner'),
  endResults: document.getElementById('endResults'),
  mobileControls: document.getElementById('mobileControls'),
  moveStick: document.getElementById('moveStick'),
  aimStick: document.getElementById('aimStick')
};

const ctx = el.canvas.getContext('2d');
let socket = null;
let me = null;
let currentRoom = null;
let roomState = null;
let weaponMeta = {};
let gameState = null;
let camera = { x: 0, y: 0 };
let pointer = { x: 0, y: 0 };
const keyState = { up: false, down: false, left: false, right: false, shooting: false, pickup: false, reload: false };
const touch = {
  move: { active: false, startX: 0, startY: 0, x: 0, y: 0 },
  aim: { active: false, startX: 0, startY: 0, x: 0, y: 0 }
};
let killFeed = [];

function showScreen(name) {
  Object.entries(screens).forEach(([key, node]) => {
    node.classList.toggle('hidden', key !== name);
  });
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

function setMessage(target, msg, timeout = 3500) {
  target.textContent = msg || '';
  if (msg) setTimeout(() => { if (target.textContent === msg) target.textContent = ''; }, timeout);
}

function isMobile() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

async function refreshMe() {
  const data = await api('/api/me');
  me = data.user;
  if (me) {
    el.welcomeText.textContent = `Logged in as ${me.username}`;
    el.statBlock.textContent = `Games: ${me.gamesPlayed} | Kills: ${me.totalKills} | Wins: ${me.totalWins}`;
    connectSocket();
    showScreen('menu');
  } else {
    showScreen('auth');
  }
}

function connectSocket() {
  if (socket) socket.disconnect();
  socket = io();

  socket.on('connect_error', (err) => {
    setMessage(el.menuMessage, err.message || 'Socket auth failed. Re-login.');
  });

  socket.on('meta:weapons', (meta) => { weaponMeta = meta; });

  socket.on('error:message', (msg) => {
    setMessage(el.menuMessage, msg);
    setMessage(el.lobbyMessage, msg);
  });

  socket.on('room:update', (state) => {
    roomState = state;
    currentRoom = state.code;
    el.lobbyCode.textContent = state.code;
    el.lobbyMap.textContent = state.mapName;
    el.lobbyCount.textContent = state.players.length;
    el.lobbyBots.textContent = state.botFill;
    el.lobbyMapSelect.value = state.mapKey;
    el.lobbyPlayers.innerHTML = '';

    state.players.forEach((p) => {
      const li = document.createElement('li');
      li.textContent = `${p.username}${p.bot ? ' (BOT)' : ''}`;
      el.lobbyPlayers.appendChild(li);
    });

    if (state.state === 'lobby') showScreen('lobby');
  });

  socket.on('match:start', () => {
    showScreen('game');
    if (isMobile()) el.mobileControls.classList.remove('hidden');
  });

  socket.on('game:state', (state) => {
    gameState = state;
    const myPlayer = state.players.find((p) => String(p.id) === String(me.id));
    if (myPlayer) {
      camera.x = myPlayer.x - el.canvas.width / 2;
      camera.y = myPlayer.y - el.canvas.height / 2;
      el.hudHp.textContent = Math.round(myPlayer.hp);
      el.hudArmor.textContent = Math.round(myPlayer.armor);
      el.hudKills.textContent = myPlayer.kills;
      el.hudWeapon.textContent = weaponMeta[myPlayer.weaponId]?.name || myPlayer.weaponId;
      const ammoType = weaponMeta[myPlayer.weaponId]?.ammoType || 'light';
      el.hudAmmo.textContent = `${myPlayer.ammoInMag} / ${myPlayer.reserve[ammoType] || 0}`;
    }

    el.hudRemaining.textContent = state.remaining;
    el.hudZone.textContent = `${Math.round(state.safeZone.currentRadius)} radius`;
  });

  socket.on('killfeed', (k) => {
    killFeed.unshift(`${k.killer} eliminated ${k.victim}`);
    killFeed = killFeed.slice(0, 5);
  });

  socket.on('match:end', (payload) => {
    showScreen('end');
    el.mobileControls.classList.add('hidden');
    el.endWinner.textContent = `Winner: ${payload.winner}`;
    el.endResults.innerHTML = '';
    payload.players.sort((a, b) => b.kills - a.kills).forEach((p) => {
      const li = document.createElement('li');
      li.textContent = `${p.username} - ${p.kills} kills ${p.alive ? '(Alive)' : ''}`;
      el.endResults.appendChild(li);
    });
    refreshMe();
  });
}

function worldToScreen(x, y) {
  return { x: x - camera.x, y: y - camera.y };
}

function drawMapBackground(mapKey) {
  const gradients = {
    forest: ['#26452e', '#1d3224'],
    desert: ['#6a542f', '#4f3d22'],
    urban: ['#3a3f4a', '#2b2f37']
  };
  const [a, b] = gradients[mapKey] || gradients.forest;
  const g = ctx.createLinearGradient(0, 0, el.canvas.width, el.canvas.height);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, el.canvas.width, el.canvas.height);
}

function drawPlayer(p, time) {
  const pos = worldToScreen(p.x, p.y);
  if (pos.x < -100 || pos.y < -100 || pos.x > el.canvas.width + 100 || pos.y > el.canvas.height + 100) return;

  const pulse = p.moving ? Math.sin(time * 0.015 + p.x * 0.04) * 2 : 0;

  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(p.angle);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 18, 14, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // legs (walking anim)
  ctx.fillStyle = '#2f2f2f';
  ctx.fillRect(-9, 8 + pulse, 7, 14);
  ctx.fillRect(2, 8 - pulse, 7, 14);

  // body
  ctx.fillStyle = p.hitFlash > 0 ? '#ff5e5e' : p.color;
  ctx.fillRect(-12, -8, 24, 22);

  // arms + gun
  ctx.strokeStyle = '#f6d2b2';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-2, 0);
  ctx.lineTo(8, 0);
  ctx.stroke();

  ctx.strokeStyle = '#111';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(8, 0);
  ctx.lineTo(20, 0);
  ctx.stroke();

  // head / facing direction
  ctx.fillStyle = '#f6d2b2';
  ctx.beginPath();
  ctx.arc(0, -16, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(4, -17, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // hp bar/name
  ctx.fillStyle = '#00000088';
  ctx.fillRect(pos.x - 24, pos.y - 42, 48, 7);
  ctx.fillStyle = '#e5484d';
  ctx.fillRect(pos.x - 24, pos.y - 42, 48 * (p.hp / 100), 7);
  ctx.fillStyle = '#5bc17f';
  ctx.fillRect(pos.x - 24, pos.y - 34, 48 * (p.armor / 100), 4);
  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.fillText(p.username, pos.x - 24, pos.y - 46);

  if (!p.alive) {
    ctx.fillStyle = '#fff';
    ctx.fillText('💀', pos.x - 6, pos.y + 8);
  }
}

function drawObstacle(o) {
  const pos = worldToScreen(o.x, o.y);
  const palette = {
    tree: '#2e7d32',
    rock: '#787878',
    tent: '#a9744f',
    barrier: '#c78f4a',
    building: '#707784',
    car: '#455369',
    wall: '#868686'
  };
  ctx.fillStyle = palette[o.type] || '#888';
  ctx.fillRect(pos.x, pos.y, o.w, o.h);
}

function drawLoot(item) {
  const pos = worldToScreen(item.x, item.y);
  if (item.kind === 'weapon') ctx.fillStyle = '#ffd166';
  else if (item.kind === 'ammo') ctx.fillStyle = '#8ecae6';
  else if (item.kind === 'armor') ctx.fillStyle = '#90be6d';
  else ctx.fillStyle = '#ef476f';
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 7, 0, Math.PI * 2);
  ctx.fill();
}

function render(now) {
  requestAnimationFrame(render);
  el.canvas.width = window.innerWidth;
  el.canvas.height = window.innerHeight;

  if (!gameState || screens.game.classList.contains('hidden')) return;

  drawMapBackground(gameState.map.key);

  const z = worldToScreen(gameState.safeZone.cx, gameState.safeZone.cy);
  ctx.fillStyle = 'rgba(255, 60, 60, 0.18)';
  ctx.beginPath();
  ctx.arc(z.x, z.y, gameState.safeZone.currentRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();

  gameState.obstacles.forEach(drawObstacle);
  gameState.loot.forEach(drawLoot);

  gameState.players.forEach((p) => drawPlayer(p, now));

  gameState.shots.forEach((s) => {
    const start = worldToScreen(s.x, s.y);
    ctx.strokeStyle = '#ffec99';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(start.x + Math.cos(s.angle) * 60, start.y + Math.sin(s.angle) * 60);
    ctx.stroke();
  });

  killFeed.forEach((line, idx) => {
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(line, 14, el.canvas.height - 20 - idx * 20);
  });
}
requestAnimationFrame(render);

function computeInput() {
  let angle = 0;
  const myPlayer = gameState?.players?.find((p) => String(p.id) === String(me?.id));
  if (myPlayer) {
    const centerX = el.canvas.width / 2;
    const centerY = el.canvas.height / 2;
    angle = Math.atan2(pointer.y - centerY, pointer.x - centerX);
  }

  const input = {
    up: keyState.up,
    down: keyState.down,
    left: keyState.left,
    right: keyState.right,
    angle,
    shooting: keyState.shooting,
    pickup: keyState.pickup,
    reload: keyState.reload
  };

  if (touch.move.active) {
    input.left = touch.move.x < -0.25;
    input.right = touch.move.x > 0.25;
    input.up = touch.move.y < -0.25;
    input.down = touch.move.y > 0.25;
  }

  if (touch.aim.active) {
    input.angle = Math.atan2(touch.aim.y, touch.aim.x);
    input.shooting = Math.hypot(touch.aim.x, touch.aim.y) > 0.28;
  }

  return input;
}

setInterval(() => {
  if (!socket || !socket.connected || !gameState || screens.game.classList.contains('hidden')) return;
  const payload = computeInput();
  socket.emit('player:input', payload);
  keyState.pickup = false;
  keyState.reload = false;
}, 50);

window.addEventListener('mousemove', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
window.addEventListener('mousedown', () => { keyState.shooting = true; });
window.addEventListener('mouseup', () => { keyState.shooting = false; });
window.addEventListener('keydown', (e) => {
  if (e.key === 'w' || e.key === 'W') keyState.up = true;
  if (e.key === 's' || e.key === 'S') keyState.down = true;
  if (e.key === 'a' || e.key === 'A') keyState.left = true;
  if (e.key === 'd' || e.key === 'D') keyState.right = true;
  if (e.key === 'e' || e.key === 'E') keyState.pickup = true;
  if (e.key === 'r' || e.key === 'R') keyState.reload = true;
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'w' || e.key === 'W') keyState.up = false;
  if (e.key === 's' || e.key === 'S') keyState.down = false;
  if (e.key === 'a' || e.key === 'A') keyState.left = false;
  if (e.key === 'd' || e.key === 'D') keyState.right = false;
});

el.pickupBtn.addEventListener('click', () => { keyState.pickup = true; });
el.reloadBtn.addEventListener('click', () => { keyState.reload = true; });

document.getElementById('registerBtn').addEventListener('click', async () => {
  const res = await api('/api/register', { username: el.usernameInput.value, password: el.passwordInput.value });
  if (res.error) setMessage(el.authMessage, res.error);
  else refreshMe();
});

document.getElementById('loginBtn').addEventListener('click', async () => {
  const res = await api('/api/login', { username: el.usernameInput.value, password: el.passwordInput.value });
  if (res.error) setMessage(el.authMessage, res.error);
  else refreshMe();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await api('/api/logout', {});
  if (socket) socket.disconnect();
  me = null;
  showScreen('auth');
});

document.getElementById('createRoomBtn').addEventListener('click', () => {
  socket.emit('room:create', { mapKey: el.createMapSelect.value });
});

document.getElementById('joinRoomBtn').addEventListener('click', () => {
  socket.emit('room:join', { code: el.roomCodeInput.value.trim().toUpperCase() });
});

document.getElementById('setMapBtn').addEventListener('click', () => {
  socket.emit('room:setMap', { mapKey: el.lobbyMapSelect.value });
});

document.getElementById('startGameBtn').addEventListener('click', () => {
  socket.emit('room:start');
});

document.getElementById('leaveLobbyBtn').addEventListener('click', () => {
  window.location.reload();
});

document.getElementById('endBackBtn').addEventListener('click', () => {
  showScreen('lobby');
});

function setupTouchStick(stickEl, store, onTap) {
  stickEl.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    store.active = true;
    store.startX = t.clientX;
    store.startY = t.clientY;
    store.x = 0;
    store.y = 0;
    if (onTap) onTap();
    e.preventDefault();
  }, { passive: false });

  stickEl.addEventListener('touchmove', (e) => {
    const t = e.changedTouches[0];
    const dx = (t.clientX - store.startX) / 50;
    const dy = (t.clientY - store.startY) / 50;
    store.x = Math.max(-1, Math.min(1, dx));
    store.y = Math.max(-1, Math.min(1, dy));
    e.preventDefault();
  }, { passive: false });

  stickEl.addEventListener('touchend', (e) => {
    store.active = false;
    store.x = 0;
    store.y = 0;
    e.preventDefault();
  }, { passive: false });
}

setupTouchStick(el.moveStick, touch.move);
setupTouchStick(el.aimStick, touch.aim, () => { keyState.shooting = true; });

refreshMe();
