'use strict';
/* server.js — Servidor de salas para Mesa de Fichas.
 * HTTP estático + WebSocket. Las salas viven en memoria (con respaldo opcional a disco).
 * Sólo maneja puntos ficticios: las cartas se juegan en físico.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const E = require('./public/engine.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'rooms.json');
const PERSIST = process.env.NO_PERSIST !== '1';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ROOM_IDLE_MS = 12 * 3600 * 1000;
const HOST_GONE_MS = 45 * 1000;
const MAX_ROOMS = 300;
const MAX_SOCKETS_PER_ROOM = 40;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon'
};

/* ---------------- Salas ---------------- */
const rooms = new Map();

function newCode() {
  for (let n = 0; n < 200; n++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  throw new Error('sin códigos libres');
}
const newToken = () => crypto.randomBytes(12).toString('hex');
const clean = (s, n) => String(s == null ? '' : s).trim().slice(0, n || 14);

function makeRoom(code, table) {
  return { code, table, members: new Map(), lastActive: Date.now(), hostSeen: Date.now(), dirty: false };
}
function addMember(room, extra) {
  const m = Object.assign({ token: newToken(), playerId: null, isHost: false, sockets: new Set() }, extra || {});
  room.members.set(m.token, m);
  return m;
}
function online(room) {
  const ids = [];
  room.members.forEach(m => { if (m.sockets.size && m.playerId) ids.push(m.playerId); });
  return ids;
}
function hostOnline(room) {
  for (const m of room.members.values()) if (m.isHost && m.sockets.size) return true;
  return false;
}
function socketCount(room) {
  let n = 0;
  room.members.forEach(m => { n += m.sockets.size; });
  return n;
}
// Cada celular recibe sólo sus propias cartas (si la sala usa cartas virtuales)
function you(m, room) {
  const o = { playerId: m.playerId, isHost: m.isHost };
  if (room && m.playerId) { const hole = room.table.holeOf(m.playerId); if (hole) o.hole = hole; }
  return o;
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function broadcast(room) {
  const snap = room.table.snapshot();
  const base = { t: 'state', code: room.code, snap, online: online(room), hostOnline: hostOnline(room), now: Date.now() };
  room.members.forEach(m => {
    if (!m.sockets.size) return;
    const payload = JSON.stringify(Object.assign({ you: you(m, room) }, base));
    m.sockets.forEach(ws => { if (ws.readyState === 1) ws.send(payload); });
  });
  room.dirty = true;
  scheduleSave();
}

/* ---------------- Persistencia opcional ---------------- */
let saveTimer = null;
function scheduleSave() {
  if (!PERSIST || saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, 2000);
}
function saveNow() {
  if (!PERSIST) return;
  try {
    const out = [];
    rooms.forEach(r => {
      out.push({
        code: r.code, lastActive: r.lastActive, table: r.table._plain(true),
        members: Array.from(r.members.values()).map(m => ({ token: m.token, playerId: m.playerId, isHost: m.isHost }))
      });
    });
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error('No se pudo guardar:', e.message); }
}
function loadRooms() {
  if (!PERSIST) return;
  try {
    const arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    arr.forEach(r => {
      if (Date.now() - r.lastActive > ROOM_IDLE_MS) return;
      delete r.table.canUndo;
      const room = makeRoom(r.code, new E.Table(r.table));
      room.lastActive = r.lastActive;
      r.members.forEach(m => room.members.set(m.token, { token: m.token, playerId: m.playerId, isHost: m.isHost, sockets: new Set() }));
      rooms.set(r.code, room);
    });
    if (rooms.size) console.log('Salas restauradas:', rooms.size);
  } catch (e) { if (e.code !== 'ENOENT') console.error('No se pudo leer respaldo:', e.message); }
}

/* ---------------- Mensajes ---------------- */
function fail(ws, error, extra) { send(ws, Object.assign({ t: 'err', error }, extra || {})); }

function attach(ws, room, member) {
  detach(ws);
  member.sockets.add(ws);
  ws.ctx = { room, member };
  room.lastActive = Date.now();
  send(ws, { t: 'hello', code: room.code, token: member.token, you: you(member, room) });
  broadcast(room);
}
function detach(ws) {
  const c = ws.ctx;
  if (!c) return;
  c.member.sockets.delete(ws);
  ws.ctx = null;
  if (rooms.get(c.room.code) === c.room) { c.room.lastActive = Date.now(); broadcast(c.room); }
}

function handleCreate(ws, msg) {
  if (rooms.size >= MAX_ROOMS) return fail(ws, 'El servidor está lleno, intenta en un rato');
  const table = new E.Table();
  if (msg.settings && typeof msg.settings === 'object') {
    const r = table.setSettings(msg.settings);
    if (!r.ok) return fail(ws, r.error);
  }
  const room = makeRoom(newCode(), table);
  const member = addMember(room, { isHost: true });
  if (msg.seat !== false) {
    const r = table.addPlayer({ name: clean(msg.name), emoji: clean(msg.emoji, 8) });
    if (!r.ok) return fail(ws, r.error);
    member.playerId = r.player.id;
  }
  rooms.set(room.code, room);
  attach(ws, room, member);
}

function handleJoin(ws, msg) {
  const code = clean(msg.code, 6).toUpperCase();
  const room = rooms.get(code);
  if (!room) return fail(ws, 'No existe una sala con el código ' + (code || '—'), { fatal: true });
  if (socketCount(room) >= MAX_SOCKETS_PER_ROOM) return fail(ws, 'La sala está llena');
  const t = room.table;

  let member = msg.token ? room.members.get(String(msg.token)) : null;
  const known = !!member;
  if (!member) member = addMember(room);

  // Si el jugador ya no existe en la mesa (lo sacaron), queda como espectador
  if (member.playerId && !t.player(member.playerId)) member.playerId = null;

  const name = clean(msg.name);
  if (name && !member.playerId) {
    const taken = t.players.find(p => p.status !== 'left' && p.name.toLowerCase() === name.toLowerCase());
    if (taken) {
      const owner = Array.from(room.members.values()).find(m => m.playerId === taken.id && m !== member);
      const free = !owner || owner.sockets.size === 0;
      if (msg.reclaim && free && !(owner && owner.isHost)) {
        if (owner) owner.playerId = null;
        member.playerId = taken.id;
      } else {
        if (!known) room.members.delete(member.token);
        return fail(ws, 'Ese alias ya está en la mesa', { code: 'name_taken', canReclaim: free && !(owner && owner.isHost) });
      }
    } else {
      const r = t.addPlayer({ name, emoji: clean(msg.emoji, 8) });
      if (!r.ok) { if (!known) room.members.delete(member.token); return fail(ws, r.error); }
      member.playerId = r.player.id;
    }
  }
  attach(ws, room, member);
}

function handleCmd(ws, msg) {
  const c = ws.ctx;
  if (!c) return fail(ws, 'Primero entra a una sala');
  const { room, member } = c;
  const cmd = msg.cmd;
  if (!cmd || typeof cmd !== 'object' || typeof cmd.c !== 'string') return fail(ws, 'Comando inválido');
  const t = room.table;

  // Comandos que maneja el servidor (sesiones, no mesa)
  if (cmd.c === 'makeHost') {
    if (!member.isHost) return fail(ws, 'Sólo el host puede hacer eso');
    const target = Array.from(room.members.values()).find(m => m.playerId && m.playerId === cmd.id);
    if (!target) return fail(ws, 'Ese jugador no tiene un celular conectado');
    member.isHost = false; target.isHost = true;
    t._log('👑 ' + t._name(target.playerId) + ' es ahora el host');
    return broadcast(room);
  }
  if (cmd.c === 'claimHost') {
    if (!member.playerId) return fail(ws, 'Siéntate a la mesa primero');
    if (member.isHost) return;
    if (hostOnline(room) || Date.now() - room.hostSeen < HOST_GONE_MS)
      return fail(ws, 'El host sigue conectado');
    room.members.forEach(m => { m.isHost = false; });
    member.isHost = true;
    t._log('👑 ' + t._name(member.playerId) + ' tomó el control (el host se desconectó)');
    return broadcast(room);
  }
  if (cmd.c === 'sit') {
    if (member.playerId) return fail(ws, 'Ya estás sentado');
    const r = t.addPlayer({ name: clean(cmd.name), emoji: clean(cmd.emoji, 8) });
    if (!r.ok) return fail(ws, r.error);
    member.playerId = r.player.id;
    return broadcast(room);
  }

  const res = E.runCommand(t, cmd, { isHost: member.isHost, playerId: member.playerId });
  if (!res.ok) return fail(ws, res.error);
  // Si sacaron/salió un jugador, su celular pasa a espectador
  room.members.forEach(m => { if (m.playerId && !t.player(m.playerId)) m.playerId = null; });
  if (cmd.c === 'kick') {
    room.members.forEach(m => { if (!m.playerId) m.sockets.forEach(s => { if (s !== ws) send(s, { t: 'kicked' }); }); });
  }
  room.lastActive = Date.now();
  broadcast(room);
}

/* ---------------- HTTP estático ---------------- */
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('No encontrado'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
});

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.budget = 40;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    if (--ws.budget < 0) return;
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    try {
      switch (msg.t) {
        case 'create': return handleCreate(ws, msg);
        case 'join': return handleJoin(ws, msg);
        case 'cmd': return handleCmd(ws, msg);
        case 'ping': return send(ws, { t: 'pong', now: Date.now() });
        case 'leaveRoom': return detach(ws);
      }
    } catch (e) {
      console.error('Error procesando mensaje:', e);
      fail(ws, 'Error interno');
    }
  });
  ws.on('close', () => detach(ws));
  ws.on('error', () => {});
});

setInterval(() => { wss.clients.forEach(ws => { ws.budget = 40; }); }, 5000);
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  });
}, 25000);

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    if (hostOnline(room)) room.hostSeen = now;
    if (room.table.tick(now)) { room.lastActive = now; broadcast(room); }
    if (socketCount(room) === 0 && now - room.lastActive > ROOM_IDLE_MS) {
      rooms.delete(code);
      scheduleSave();
    }
  });
}, 1000);

function shutdown() { saveNow(); process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (require.main === module) {
  loadRooms();
  server.listen(PORT, () => {
    console.log('Mesa de Fichas lista en http://localhost:' + PORT);
    const nets = require('os').networkInterfaces();
    Object.keys(nets).forEach(k => nets[k].forEach(n => {
      if (n.family === 'IPv4' && !n.internal) console.log('  En tu red: http://' + n.address + ':' + PORT);
    }));
  });
}
module.exports = { server, rooms };
