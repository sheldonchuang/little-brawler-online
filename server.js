const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

// HTTP Server
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, reqPath);
  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

// ==================== RFC 6455 WebSocket Implementation ====================
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function computeAcceptKey(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function encodeFrame(payloadText) {
  const payload = Buffer.from(payloadText, 'utf8');
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0F;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7F;
    offset += 2;

    if (payloadLength === 126) {
      if (offset + 2 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (offset + 8 > buffer.length) break;
      payloadLength = Number(buffer.readBigUInt64BE(offset));
      offset += 8;
    }

    let maskKey = null;
    if (masked) {
      if (offset + 4 > buffer.length) break;
      maskKey = buffer.subarray(offset, offset + 4);
      offset += 4;
    }

    if (offset + payloadLength > buffer.length) break;
    const rawPayload = buffer.subarray(offset, offset + payloadLength);
    offset += payloadLength;

    let unmasked = rawPayload;
    if (masked && maskKey) {
      unmasked = Buffer.alloc(payloadLength);
      for (let i = 0; i < payloadLength; i++) {
        unmasked[i] = rawPayload[i] ^ maskKey[i % 4];
      }
    }
    frames.push({ opcode, payload: unmasked });
  }
  return { frames, remaining: buffer.subarray(offset) };
}

// WebSocket Connection Wrapper
class WSClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.id = 'p_' + Math.random().toString(36).substring(2, 9);
    this.room = null;
    this.player = null;
    this.isAlive = true;

    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      const { frames, remaining } = decodeFrames(this.buffer);
      this.buffer = remaining;

      for (const frame of frames) {
        if (frame.opcode === 0x08) {
          // Close
          this.close();
        } else if (frame.opcode === 0x09) {
          // Ping -> Pong
          this.sendRaw(Buffer.from([0x8A, 0x00]));
        } else if (frame.opcode === 0x01) {
          // Text
          try {
            const data = JSON.parse(frame.payload.toString('utf8'));
            this.onMessage(data);
          } catch (e) {
            console.error('Error parsing message JSON:', e);
          }
        }
      }
    });

    socket.on('error', () => this.close());
    socket.on('close', () => this.close());
  }

  send(msgObj) {
    if (this.socket.writable) {
      this.socket.write(encodeFrame(JSON.stringify(msgObj)));
    }
  }

  sendRaw(buffer) {
    if (this.socket.writable) {
      this.socket.write(buffer);
    }
  }

  close() {
    if (this.isAlive) {
      this.isAlive = false;
      if (this.room) {
        this.room.removeClient(this);
      }
      try {
        this.socket.end();
      } catch (e) {}
    }
  }

  onMessage(data) {
    if (!this.room && data.type !== 'join') return;

    if (data.type === 'join') {
      const roomId = (data.roomId || 'ARENA-1').trim().toUpperCase();
      joinRoom(this, roomId, data.name || '格鬥手', data.heroType || 'fire');
    } else if (this.room) {
      this.room.handleMessage(this, data);
    }
  }
}

// ==================== Game World & Room Engine ====================
const rooms = new Map();

const STAGE_MIN_X = 40;
const STAGE_MAX_X = 1160;
const STAGE_MIN_Z = 20;
const STAGE_MAX_Z = 230;

const HERO_CONFIGS = {
  fire: {
    name: '赤焰 (Davis)',
    speed: 4.8,
    maxHp: 120,
    maxMp: 100,
    skillCost: 25,
    attackPower: 12,
    skillName: '波動氣功拳'
  },
  ice: {
    name: '疾風 (Dennis)',
    speed: 5.5,
    maxHp: 105,
    maxMp: 100,
    skillCost: 25,
    attackPower: 10,
    skillName: '冰晶旋風'
  },
  titan: {
    name: '阿豪 (Titan)',
    speed: 3.8,
    maxHp: 150,
    maxMp: 100,
    skillCost: 30,
    attackPower: 18,
    skillName: '巨岩裂地衝'
  }
};

class GameRoom {
  constructor(id) {
    this.id = id;
    this.clients = new Set();
    this.players = new Map();
    this.bots = new Map();
    this.projectiles = [];
    this.effects = []; // hit sparks, floating texts
    this.botCounter = 1;
    this.lastTick = Date.now();

    // Start 30Hz game loop
    this.interval = setInterval(() => this.tick(), 1000 / 30);

    // Initial bots for immediately satisfying gameplay
    this.spawnBot('雜兵·阿飛', 'minion', 400, 100);
    this.spawnBot('流氓·大牛', 'heavy', 750, 150);
  }

  addClient(client, name, heroType) {
    this.clients.add(client);
    client.room = this;

    const hero = HERO_CONFIGS[heroType] || HERO_CONFIGS.fire;
    const spawnX = 200 + Math.random() * 700;
    const spawnZ = 60 + Math.random() * 120;

    const player = {
      id: client.id,
      name: (name || '熱血格鬥家').slice(0, 12),
      heroType: heroType,
      x: spawnX,
      z: spawnZ,
      y: 0,
      vy: 0,
      vx: 0,
      vz: 0,
      facing: 1, // 1: right, -1: left
      hp: hero.maxHp,
      maxHp: hero.maxHp,
      mp: hero.maxMp,
      maxMp: hero.maxMp,
      state: 'idle', // idle, walk, run, jump, punch, kick, skill, hurt, fallen
      stateTimer: 0,
      combo: 0,
      isGuarding: false,
      invulnerableTimer: 60, // 2s spawn immunity
      isDead: false,
      respawnTimer: 0,
      kills: 0,
      deaths: 0,
      score: 0
    };

    this.players.set(client.id, player);
    client.player = player;

    // Send welcome packet
    client.send({
      type: 'init',
      yourId: client.id,
      roomId: this.id,
      players: Array.from(this.players.values()),
      bots: Array.from(this.bots.values())
    });

    this.broadcast({
      type: 'player_joined',
      player: player,
      msg: `${player.name} 加入了戰局！`
    });
  }

  removeClient(client) {
    this.clients.delete(client);
    if (this.players.has(client.id)) {
      const p = this.players.get(client.id);
      this.players.delete(client.id);
      this.broadcast({
        type: 'player_left',
        id: client.id,
        msg: `${p.name} 離開了戰局。`
      });
    }

    if (this.clients.size === 0) {
      clearInterval(this.interval);
      rooms.delete(this.id);
    }
  }

  broadcast(msgObj) {
    const encoded = encodeFrame(JSON.stringify(msgObj));
    for (const c of this.clients) {
      c.sendRaw(encoded);
    }
  }

  spawnBot(name, type, x, z) {
    const botId = 'bot_' + this.botCounter++;
    const isHeavy = type === 'heavy';
    const bot = {
      id: botId,
      name: name,
      type: type,
      x: x || 300 + Math.random() * 500,
      z: z || 50 + Math.random() * 140,
      y: 0,
      vy: 0,
      vx: 0,
      vz: 0,
      facing: Math.random() > 0.5 ? 1 : -1,
      hp: isHeavy ? 100 : 60,
      maxHp: isHeavy ? 100 : 60,
      mp: 50,
      maxMp: 50,
      state: 'idle',
      stateTimer: 0,
      combo: 0,
      isGuarding: false,
      invulnerableTimer: 20,
      isDead: false,
      targetId: null,
      aiActionTimer: Math.floor(Math.random() * 30),
      isBot: true
    };
    this.bots.set(botId, bot);
  }

  handleMessage(client, data) {
    const p = client.player;
    if (!p || p.isDead) return;

    if (data.type === 'input') {
      // Input movement and actions
      if (p.state !== 'hurt' && p.state !== 'fallen') {
        const hero = HERO_CONFIGS[p.heroType] || HERO_CONFIGS.fire;
        const speed = (data.isRunning ? hero.speed * 1.6 : hero.speed);

        p.vx = (data.dx || 0) * speed;
        p.vz = (data.dz || 0) * (speed * 0.75);

        if (data.dx > 0) p.facing = 1;
        if (data.dx < 0) p.facing = -1;

        p.isGuarding = !!data.guard;

        if (p.isGuarding) {
          p.vx = 0;
          p.vz = 0;
          p.state = 'guard';
        } else if (p.y > 0) {
          if (p.state !== 'jump_kick') p.state = 'jump';
        } else if (p.state === 'punch' || p.state === 'kick' || p.state === 'skill') {
          // attacking, wait until finished
        } else if (Math.abs(p.vx) > 0.1 || Math.abs(p.vz) > 0.1) {
          p.state = data.isRunning ? 'run' : 'walk';
        } else {
          p.state = 'idle';
        }
      }
    } else if (data.type === 'action') {
      this.handlePlayerAction(p, data.action);
    } else if (data.type === 'spawn_bot') {
      if (this.bots.size < 8) {
        const types = ['minion', 'heavy', 'ninja'];
        const randomType = types[Math.floor(Math.random() * types.length)];
        const names = ['黑帶混混', '醉拳高手', '斧頭幫眾', '鐵頭娃', '街頭霸王'];
        const randomName = names[Math.floor(Math.random() * names.length)];
        this.spawnBot(randomName, randomType);
        this.broadcast({
          type: 'chat',
          from: '系統',
          text: `🔔 ${p.name} 召喚了對手【${randomName}】！`
        });
      }
    } else if (data.type === 'chat') {
      const text = (data.text || '').trim().slice(0, 50);
      if (text) {
        this.broadcast({
          type: 'chat',
          from: p.name,
          text: text
        });
      }
    }
  }

  handlePlayerAction(p, action) {
    if (p.isDead || p.state === 'hurt' || p.state === 'fallen') return;

    if (action === 'jump') {
      if (p.y === 0) {
        p.vy = 12; // jump impulse
        p.state = 'jump';
        this.addEffect(p.x, p.z, 0, 'dust');
      }
    } else if (action === 'attack') {
      if (p.y > 1) {
        // Air kick
        p.state = 'jump_kick';
        p.stateTimer = 18;
        this.checkMeleeHit(p, {
          reachX: 55,
          reachZ: 25,
          reachY: 40,
          damage: 16,
          knockback: 7,
          isAir: true
        });
      } else {
        // Ground Combo (Punch -> Kick -> Heavy Finisher)
        p.combo = (p.combo % 3) + 1;
        p.state = p.combo === 2 ? 'kick' : 'punch';
        p.stateTimer = 14;
        p.vx = p.facing * (p.combo === 3 ? 5 : 2); // combo step forward

        const damage = p.combo === 3 ? 24 : 12;
        const knockback = p.combo === 3 ? 8 : 2;
        const knockup = p.combo === 3 ? 7 : 0;

        this.checkMeleeHit(p, {
          reachX: p.combo === 3 ? 60 : 45,
          reachZ: 24,
          reachY: 35,
          damage: damage,
          knockback: knockback,
          knockup: knockup,
          isFinisher: p.combo === 3
        });
      }
    } else if (action === 'skill') {
      const hero = HERO_CONFIGS[p.heroType] || HERO_CONFIGS.fire;
      if (p.mp >= hero.skillCost && p.y === 0) {
        p.mp -= hero.skillCost;
        p.state = 'skill';
        p.stateTimer = 22;
        p.vx = 0;

        if (p.heroType === 'fire') {
          // Fireball Projectile
          this.projectiles.push({
            id: 'proj_' + Math.random().toString(36).substring(2, 7),
            ownerId: p.id,
            ownerName: p.name,
            type: 'fireball',
            x: p.x + p.facing * 35,
            z: p.z,
            y: 22,
            vx: p.facing * 9.5,
            damage: 28,
            life: 50,
            radius: 20
          });
          this.addEffect(p.x + p.facing * 20, p.z, 20, 'fire_burst');
        } else if (p.heroType === 'ice') {
          // Dual Ice Shards
          this.projectiles.push({
            id: 'proj_' + Math.random().toString(36).substring(2, 7),
            ownerId: p.id,
            ownerName: p.name,
            type: 'ice_shard',
            x: p.x + p.facing * 35,
            z: p.z - 10,
            y: 20,
            vx: p.facing * 11,
            damage: 16,
            life: 45,
            radius: 18
          });
          this.projectiles.push({
            id: 'proj_' + Math.random().toString(36).substring(2, 7),
            ownerId: p.id,
            ownerName: p.name,
            type: 'ice_shard',
            x: p.x + p.facing * 35,
            z: p.z + 10,
            y: 20,
            vx: p.facing * 10,
            damage: 16,
            life: 45,
            radius: 18
          });
        } else if (p.heroType === 'titan') {
          // Titan Earth Shockwave
          p.vx = p.facing * 6;
          this.projectiles.push({
            id: 'proj_' + Math.random().toString(36).substring(2, 7),
            ownerId: p.id,
            ownerName: p.name,
            type: 'earth_quake',
            x: p.x + p.facing * 40,
            z: p.z,
            y: 0,
            vx: p.facing * 7,
            damage: 32,
            life: 35,
            radius: 28
          });
          this.addEffect(p.x, p.z, 0, 'quake_shock');
        }
      }
    }
  }

  checkMeleeHit(attacker, hitBox) {
    const allTargets = [...this.players.values(), ...this.bots.values()];
    for (const target of allTargets) {
      if (target.id === attacker.id || target.isDead || target.invulnerableTimer > 0) continue;

      const dx = target.x - attacker.x;
      const dz = Math.abs(target.z - attacker.z);
      const dy = Math.abs(target.y - attacker.y);

      // Facing check
      const isFacingTarget = (attacker.facing > 0 && dx >= -10 && dx <= hitBox.reachX) ||
                             (attacker.facing < 0 && dx <= 10 && dx >= -hitBox.reachX);

      if (isFacingTarget && dz <= hitBox.reachZ && dy <= hitBox.reachY) {
        this.applyDamage(target, attacker, hitBox.damage, hitBox.knockback, hitBox.knockup || 0);
      }
    }
  }

  applyDamage(target, attacker, baseDamage, knockback, knockup) {
    if (target.isDead || target.invulnerableTimer > 0) return;

    let damage = baseDamage;
    let isGuarded = false;

    if (target.isGuarding) {
      damage = Math.floor(baseDamage * 0.2); // 80% reduction
      isGuarded = true;
      knockback = knockback * 0.2;
      knockup = 0;
    }

    target.hp = Math.max(0, target.hp - damage);

    // Floating damage text effect
    this.addEffect(target.x, target.z, target.y + 35, 'damage_number', {
      value: damage,
      isCrit: knockup > 0,
      isGuarded: isGuarded
    });

    // Hit sparks
    this.addEffect(target.x, target.z, target.y + 20, isGuarded ? 'spark_guard' : 'spark_hit');

    if (!isGuarded) {
      if (knockup > 0 || knockback > 5 || target.hp <= 0) {
        // Knockdown flight
        target.state = 'fallen';
        target.stateTimer = 40; // time down
        target.vy = knockup > 0 ? knockup : 5;
        target.vx = (attacker ? attacker.facing : (target.facing * -1)) * (knockback || 5);
        target.invulnerableTimer = 50; // brief immunity while knocked down
      } else {
        // Stagger
        target.state = 'hurt';
        target.stateTimer = 10;
        target.vx = (attacker ? attacker.facing : 1) * (knockback || 2);
      }
    }

    if (target.hp <= 0) {
      this.handleDeath(target, attacker);
    }
  }

  handleDeath(target, killer) {
    target.isDead = true;
    target.state = 'fallen';
    target.hp = 0;
    target.deaths = (target.deaths || 0) + 1;

    if (killer) {
      killer.kills = (killer.kills || 0) + 1;
      killer.score = (killer.score || 0) + 100;
    }

    this.addEffect(target.x, target.z, target.y + 10, 'ko_burst');

    this.broadcast({
      type: 'chat',
      from: '💥 裁判',
      text: `${target.name} 被 ${killer ? killer.name : '神秘力量'} 擊倒了！(K.O.)`
    });

    if (target.isBot) {
      // Auto-respawn bot after 4 seconds
      setTimeout(() => {
        if (this.bots.has(target.id)) {
          target.isDead = false;
          target.hp = target.maxHp;
          target.x = 200 + Math.random() * 700;
          target.z = 60 + Math.random() * 120;
          target.y = 0;
          target.state = 'idle';
          target.invulnerableTimer = 45;
        }
      }, 4000);
    } else {
      // Player respawn
      target.respawnTimer = 90; // 3 seconds at 30 ticks
    }
  }

  addEffect(x, z, y, effectType, extra = {}) {
    this.effects.push({
      id: 'fx_' + Math.random().toString(36).substring(2, 7),
      type: effectType,
      x: x,
      z: z,
      y: y,
      life: 25,
      ...extra
    });
  }

  tick() {
    // 1. Update Players
    for (const p of this.players.values()) {
      if (p.isDead) {
        if (p.respawnTimer > 0) {
          p.respawnTimer--;
          if (p.respawnTimer <= 0) {
            // Respawn
            p.isDead = false;
            p.hp = p.maxHp;
            p.mp = p.maxMp;
            p.x = 200 + Math.random() * 700;
            p.z = 60 + Math.random() * 120;
            p.y = 0;
            p.state = 'idle';
            p.invulnerableTimer = 60; // 2s spawn protection
            this.broadcast({
              type: 'chat',
              from: '✨ 系統',
              text: `${p.name} 復活回到了戰場！`
            });
          }
        }
        continue;
      }

      // Regain MP
      if (p.mp < p.maxMp) {
        p.mp = Math.min(p.maxMp, p.mp + 0.15);
      }

      if (p.invulnerableTimer > 0) p.invulnerableTimer--;

      // Gravity & Jump Physics
      if (p.y > 0 || p.vy !== 0) {
        p.y += p.vy;
        p.vy -= 0.85; // Gravity
        if (p.y <= 0) {
          p.y = 0;
          p.vy = 0;
          if (p.state === 'jump' || p.state === 'jump_kick') {
            p.state = 'idle';
          }
        }
      }

      // State timer countdown
      if (p.stateTimer > 0) {
        p.stateTimer--;
        if (p.stateTimer <= 0) {
          if (p.state === 'punch' || p.state === 'kick' || p.state === 'skill') {
            p.state = 'idle';
          } else if (p.state === 'hurt') {
            p.state = 'idle';
          } else if (p.state === 'fallen' && !p.isDead) {
            p.state = 'idle';
            p.invulnerableTimer = 30; // 1s wake-up shield
          }
        }
      }

      // Movement application
      p.x += p.vx;
      p.z += p.vz;

      // Friction / Drag on horizontal speed
      if (p.state === 'hurt' || p.state === 'fallen' || p.state === 'idle') {
        p.vx *= 0.8;
        p.vz *= 0.8;
      }

      // Boundary clamp
      p.x = Math.max(STAGE_MIN_X, Math.min(STAGE_MAX_X, p.x));
      p.z = Math.max(STAGE_MIN_Z, Math.min(STAGE_MAX_Z, p.z));
    }

    // 2. AI Bots Update
    this.updateBots();

    // 3. Projectiles Update
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.x += proj.vx;
      proj.life--;

      // Check hit against players & bots
      let hit = false;
      const allTargets = [...this.players.values(), ...this.bots.values()];
      for (const t of allTargets) {
        if (t.id === proj.ownerId || t.isDead || t.invulnerableTimer > 0) continue;

        const dx = Math.abs(t.x - proj.x);
        const dz = Math.abs(t.z - proj.z);
        const dy = Math.abs(t.y - proj.y);

        if (dx <= proj.radius + 15 && dz <= 20 && dy <= 30) {
          const owner = this.players.get(proj.ownerId) || this.bots.get(proj.ownerId);
          this.applyDamage(t, owner, proj.damage, 7, 6);
          this.addEffect(proj.x, proj.z, proj.y, 'explosion');
          hit = true;
          break;
        }
      }

      if (hit || proj.life <= 0 || proj.x < STAGE_MIN_X || proj.x > STAGE_MAX_X) {
        this.projectiles.splice(i, 1);
      }
    }

    // 4. Effects life countdown
    for (let i = this.effects.length - 1; i >= 0; i--) {
      this.effects[i].life--;
      if (this.effects[i].life <= 0) {
        this.effects.splice(i, 1);
      }
    }

    // 5. Broadcast State to All Clients
    const statePayload = {
      type: 'sync',
      players: Array.from(this.players.values()),
      bots: Array.from(this.bots.values()),
      projectiles: this.projectiles,
      effects: this.effects
    };
    this.broadcast(statePayload);
  }

  updateBots() {
    const livePlayers = Array.from(this.players.values()).filter(p => !p.isDead);

    for (const bot of this.bots.values()) {
      if (bot.isDead) continue;

      if (bot.invulnerableTimer > 0) bot.invulnerableTimer--;

      // Gravity
      if (bot.y > 0 || bot.vy !== 0) {
        bot.y += bot.vy;
        bot.vy -= 0.85;
        if (bot.y <= 0) {
          bot.y = 0;
          bot.vy = 0;
          if (bot.state === 'jump') bot.state = 'idle';
        }
      }

      if (bot.stateTimer > 0) {
        bot.stateTimer--;
        if (bot.stateTimer <= 0) {
          if (bot.state === 'punch' || bot.state === 'hurt') {
            bot.state = 'idle';
          } else if (bot.state === 'fallen') {
            bot.state = 'idle';
            bot.invulnerableTimer = 30;
          }
        }
      }

      // Drag
      if (bot.state === 'hurt' || bot.state === 'fallen' || bot.state === 'idle') {
        bot.vx *= 0.8;
        bot.vz *= 0.8;
      }

      bot.x += bot.vx;
      bot.z += bot.vz;
      bot.x = Math.max(STAGE_MIN_X, Math.min(STAGE_MAX_X, bot.x));
      bot.z = Math.max(STAGE_MIN_Z, Math.min(STAGE_MAX_Z, bot.z));

      // AI Decision Cycle
      if (bot.state === 'hurt' || bot.state === 'fallen' || bot.state === 'punch') continue;

      bot.aiActionTimer--;
      if (bot.aiActionTimer <= 0) {
        bot.aiActionTimer = 15 + Math.floor(Math.random() * 20);

        // Find nearest player
        let nearest = null;
        let minDist = 999999;
        for (const p of livePlayers) {
          const dist = Math.hypot(p.x - bot.x, (p.z - bot.z) * 1.5);
          if (dist < minDist) {
            minDist = dist;
            nearest = p;
          }
        }

        if (nearest && minDist < 450) {
          const dx = nearest.x - bot.x;
          const dz = nearest.z - bot.z;
          bot.facing = dx >= 0 ? 1 : -1;

          // In melee strike range
          if (Math.abs(dx) < 55 && Math.abs(dz) < 18) {
            // Punch!
            bot.vx = 0;
            bot.vz = 0;
            bot.state = 'punch';
            bot.stateTimer = 16;
            this.checkMeleeHit(bot, {
              reachX: 50,
              reachZ: 20,
              reachY: 30,
              damage: bot.type === 'heavy' ? 15 : 9,
              knockback: bot.type === 'heavy' ? 6 : 3,
              knockup: bot.type === 'heavy' ? 5 : 0
            });
          } else {
            // Approach target
            const speed = bot.type === 'heavy' ? 2.5 : 3.8;
            bot.vx = (dx > 0 ? 1 : -1) * speed;
            bot.vz = (dz > 0 ? 1 : -1) * (speed * 0.7);
            bot.state = 'walk';

            // Occasionally jump or dodge
            if (Math.random() < 0.08 && bot.y === 0) {
              bot.vy = 10;
              bot.state = 'jump';
            }
          }
        } else {
          // Wander around
          if (Math.random() < 0.4) {
            bot.vx = (Math.random() - 0.5) * 2;
            bot.vz = (Math.random() - 0.5) * 2;
            bot.facing = bot.vx >= 0 ? 1 : -1;
            bot.state = 'walk';
          } else {
            bot.vx = 0;
            bot.vz = 0;
            bot.state = 'idle';
          }
        }
      }
    }
  }
}

function joinRoom(client, roomId, name, heroType) {
  let room = rooms.get(roomId);
  if (!room) {
    room = new GameRoom(roomId);
    rooms.set(roomId, room);
  }
  room.addClient(client, name, heroType);
}

// Upgrade listener for WebSocket connection
server.on('upgrade', (req, socket, head) => {
  const wsKey = req.headers['sec-websocket-key'];
  if (!wsKey) {
    socket.destroy();
    return;
  }

  const acceptKey = computeAcceptKey(wsKey);
  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];

  socket.write(responseHeaders.join('\r\n'));
  new WSClient(socket);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`🥊 熱血格鬥連線 伺服器已啟動！`);
  console.log(`🌐 遊戲網址: http://localhost:${PORT}`);
  console.log(`=========================================`);
});
