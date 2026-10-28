// Procedural Retro Pixel-Art Canvas Renderer
// Little Fighter 2 & River City Ransom Style Engine

class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width;
    this.height = canvas.height;
    this.groundBaseY = 310; // Screen Y coordinate corresponding to Z=0
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.width = w;
    this.height = h;
    this.groundBaseY = Math.floor(h * 0.65);
  }

  // Convert 2.5D world (x, z, y) to 2D screen coordinates
  toScreen(x, z, y = 0) {
    return {
      sx: x,
      sy: this.groundBaseY + z - y
    };
  }

  render(gameState, currentUserId, cameraX = 0) {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false; // Keep pixel crispness

    ctx.save();
    // Camera follow
    ctx.translate(-cameraX, 0);

    // 1. Draw Background & Stage
    this.drawStage(ctx);

    // 2. Gather all renderable entities & sort by depth (Z axis) for true 2.5D sorting
    const entities = [];

    if (gameState.players) {
      for (const p of gameState.players) {
        entities.push({ type: 'player', data: p, z: p.z });
      }
    }
    if (gameState.bots) {
      for (const b of gameState.bots) {
        entities.push({ type: 'bot', data: b, z: b.z });
      }
    }
    if (gameState.projectiles) {
      for (const proj of gameState.projectiles) {
        entities.push({ type: 'projectile', data: proj, z: proj.z });
      }
    }

    // Sort entities from furthest (low Z) to closest (high Z)
    entities.sort((a, b) => a.z - b.z);

    // 3. Render Shadows First for Grounded Realism
    for (const ent of entities) {
      if (ent.type === 'player' || ent.type === 'bot') {
        this.drawShadow(ctx, ent.data.x, ent.data.z, ent.data.y, ent.data.state === 'fallen');
      }
    }

    // 4. Render Characters & Projectiles
    for (const ent of entities) {
      if (ent.type === 'player' || ent.type === 'bot') {
        const isSelf = ent.data.id === currentUserId;
        this.drawCharacter(ctx, ent.data, isSelf);
      } else if (ent.type === 'projectile') {
        this.drawProjectile(ctx, ent.data);
      }
    }

    // 5. Render Visual Effects (Hit Sparks, Dust, KO bursts)
    if (gameState.effects) {
      for (const fx of gameState.effects) {
        this.drawEffect(ctx, fx);
      }
    }

    ctx.restore();
  }

  // Draw 2.5D Retro City Street Stage
  drawStage(ctx) {
    const w = 1200;
    const h = this.height;

    // Distant night sky / cityscape
    const skyGrad = ctx.createLinearGradient(0, 0, 0, this.groundBaseY);
    skyGrad.addColorStop(0, '#0a0d1f');
    skyGrad.addColorStop(0.7, '#181b36');
    skyGrad.addColorStop(1, '#2c2242');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, this.groundBaseY);

    // Distant buildings & neon signs
    this.drawCitySkyline(ctx);

    // Street Sidewalk & Asphalt
    const streetGrad = ctx.createLinearGradient(0, this.groundBaseY, 0, h);
    streetGrad.addColorStop(0, '#262933');
    streetGrad.addColorStop(0.4, '#1e2129');
    streetGrad.addColorStop(1, '#13151b');
    ctx.fillStyle = streetGrad;
    ctx.fillRect(0, this.groundBaseY, w, h - this.groundBaseY);

    // Curb edge line
    ctx.fillStyle = '#4a5063';
    ctx.fillRect(0, this.groundBaseY, w, 5);
    ctx.fillStyle = '#222530';
    ctx.fillRect(0, this.groundBaseY + 5, w, 3);

    // Road Grid / Perspective Lines (LF2 Belt-scroller feeling)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let z = 30; z <= 240; z += 35) {
      const y = this.groundBaseY + z;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Road dash lines
    ctx.fillStyle = 'rgba(255, 215, 0, 0.25)';
    for (let x = 60; x < w; x += 110) {
      ctx.fillRect(x, this.groundBaseY + 120, 60, 4);
    }

    // Street Lamps
    this.drawStreetLamp(ctx, 160, this.groundBaseY + 10);
    this.drawStreetLamp(ctx, 600, this.groundBaseY + 10);
    this.drawStreetLamp(ctx, 1040, this.groundBaseY + 10);

    // Decorative Vending Machine & Crates
    this.drawVendingMachine(ctx, 360, this.groundBaseY + 15);
    this.drawCrates(ctx, 840, this.groundBaseY + 15);
  }

  drawCitySkyline(ctx) {
    const buildings = [
      { x: 30, w: 90, h: 140, color: '#13162b', neon: '熱血' },
      { x: 140, w: 120, h: 190, color: '#181b36', neon: 'LF2' },
      { x: 280, w: 70, h: 110, color: '#0f1124', neon: null },
      { x: 440, w: 140, h: 220, color: '#191b3b', neon: 'RAMEN' },
      { x: 680, w: 100, h: 160, color: '#14162e', neon: 'ARCADE' },
      { x: 810, w: 130, h: 180, color: '#1a1c38', neon: 'BAR 99' },
      { x: 960, w: 110, h: 130, color: '#121429', neon: null }
    ];

    for (const b of buildings) {
      const top = this.groundBaseY - b.h;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, top, b.w, b.h);

      // Lit Windows
      ctx.fillStyle = '#fffae0';
      for (let wx = b.x + 10; wx < b.x + b.w - 10; wx += 16) {
        for (let wy = top + 20; wy < this.groundBaseY - 20; wy += 22) {
          if (Math.sin(wx * 11 + wy) > 0.1) {
            ctx.globalAlpha = 0.5 + Math.sin(wx + wy) * 0.3;
            ctx.fillRect(wx, wy, 8, 12);
          }
        }
      }
      ctx.globalAlpha = 1.0;

      // Neon Sign
      if (b.neon) {
        ctx.font = 'bold 13px "Courier New", monospace';
        ctx.fillStyle = '#ff0077';
        ctx.shadowColor = '#ff0077';
        ctx.shadowBlur = 10;
        ctx.fillText(b.neon, b.x + 14, top + 35);
        ctx.shadowBlur = 0;
      }
    }
  }

  drawStreetLamp(ctx, x, zBase) {
    ctx.fillStyle = '#222530';
    ctx.fillRect(x - 3, zBase - 130, 6, 130);
    ctx.fillRect(x - 14, zBase - 135, 28, 6);

    // Glow cone
    const grad = ctx.createRadialGradient(x, zBase - 130, 5, x, zBase, 120);
    grad.addColorStop(0, 'rgba(255, 230, 140, 0.28)');
    grad.addColorStop(1, 'rgba(255, 230, 140, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(x, zBase, 70, 25, 0, 0, Math.PI * 2);
    ctx.fill();

    // Lamp bulb
    ctx.fillStyle = '#fff4cc';
    ctx.beginPath();
    ctx.arc(x, zBase - 130, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  drawVendingMachine(ctx, x, zBase) {
    ctx.fillStyle = '#e63946';
    ctx.fillRect(x, zBase - 65, 34, 65);
    ctx.fillStyle = '#1d3557';
    ctx.fillRect(x + 4, zBase - 60, 26, 32);
    ctx.fillStyle = '#f1faee';
    ctx.fillRect(x + 6, zBase - 16, 22, 8);
  }

  drawCrates(ctx, x, zBase) {
    ctx.fillStyle = '#8d5b2c';
    ctx.fillRect(x, zBase - 36, 36, 36);
    ctx.fillStyle = '#6b431e';
    ctx.strokeRect(x, zBase - 36, 36, 36);
    ctx.beginPath();
    ctx.moveTo(x, zBase - 36);
    ctx.lineTo(x + 36, zBase);
    ctx.stroke();
  }

  // Draw Ground Shadow
  drawShadow(ctx, x, z, y, isFallen) {
    const sPos = this.toScreen(x, z, 0); // Shadow is strictly on ground level y=0
    const scale = Math.max(0.3, 1 - (y / 180));
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    const rx = (isFallen ? 35 : 22) * scale;
    const ry = (isFallen ? 14 : 9) * scale;
    ctx.ellipse(sPos.sx, sPos.sy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw Little Fighter 2 / Kunio-kun Styled Character
  drawCharacter(ctx, char, isSelf) {
    const sPos = this.toScreen(char.x, char.z, char.y);

    // Invulnerability flicker
    if (char.invulnerableTimer > 0 && Math.floor(Date.now() / 60) % 2 === 0) {
      return; // Flash effect
    }

    ctx.save();
    ctx.translate(sPos.sx, sPos.sy);
    ctx.scale(char.facing, 1); // Flip horizontally depending on facing direction

    // Determine color palette based on hero/bot type
    const palette = this.getPalette(char);

    // Render Body Parts according to Action State
    this.renderCharacterPose(ctx, char, palette);

    ctx.restore();

    // Draw Overhead HUD (Name, Health Bar, Arrow)
    this.drawOverheadHUD(ctx, char, sPos.sx, sPos.sy - 65, isSelf);
  }

  getPalette(char) {
    if (char.isBot) {
      if (char.type === 'heavy') {
        return {
          skin: '#d49b6a',
          hair: '#2b2d42',
          shirt: '#e76f51',
          pants: '#264653',
          band: '#e76f51',
          aura: 'rgba(231, 111, 81, 0.4)'
        };
      }
      return {
        skin: '#e0a96d',
        hair: '#4a4e69',
        shirt: '#6c757d',
        pants: '#343a40',
        band: '#adb5bd',
        aura: 'rgba(108, 117, 125, 0.3)'
      };
    }

    switch (char.heroType) {
      case 'fire': // Davis / Kunio
        return {
          skin: '#ffd1a4',
          hair: '#4a2810',
          shirt: '#d90429',
          pants: '#ffffff',
          band: '#ffffff',
          boots: '#2b2d42',
          aura: 'rgba(239, 35, 60, 0.5)'
        };
      case 'ice': // Dennis
        return {
          skin: '#ffe0bd',
          hair: '#0077b6',
          shirt: '#023e8a',
          pants: '#caf0f8',
          band: '#00b4d8',
          boots: '#03045e',
          aura: 'rgba(0, 180, 216, 0.5)'
        };
      case 'titan': // Woody / Tank
        return {
          skin: '#d49b6a',
          hair: '#ffb703',
          shirt: '#2d6a4f',
          pants: '#1b4332',
          band: '#52b788',
          boots: '#081c15',
          aura: 'rgba(82, 183, 136, 0.5)'
        };
      default:
        return {
          skin: '#ffd1a4',
          hair: '#333333',
          shirt: '#e63946',
          pants: '#f1faee',
          band: '#ffffff',
          boots: '#1d3557',
          aura: 'rgba(230, 57, 70, 0.4)'
        };
    }
  }

  renderCharacterPose(ctx, char, pal) {
    const state = char.state;
    const now = Date.now();

    // Guarding Stance
    if (state === 'guard') {
      this.drawPants(ctx, pal, 0, 0);
      this.drawTorso(ctx, pal, 0, 2);
      this.drawHead(ctx, pal, 0, 2);
      // Guarding arms crossed
      ctx.fillStyle = pal.shirt;
      ctx.fillRect(2, -26, 14, 10);
      ctx.fillStyle = pal.skin;
      ctx.fillRect(10, -28, 8, 8);

      // Energy Shield
      ctx.strokeStyle = '#00f5d4';
      ctx.lineWidth = 3;
      ctx.fillStyle = 'rgba(0, 245, 212, 0.25)';
      ctx.beginPath();
      ctx.arc(14, -25, 28, -Math.PI * 0.4, Math.PI * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }

    // Fallen on Ground
    if (state === 'fallen') {
      ctx.save();
      ctx.translate(0, -6);
      ctx.rotate(-Math.PI * 0.45);
      this.drawPants(ctx, pal, 0, 0);
      this.drawTorso(ctx, pal, 0, 0);
      this.drawHead(ctx, pal, 0, 0);
      ctx.restore();

      // Dizzy stars overhead
      const starAng = (now / 200) % (Math.PI * 2);
      ctx.fillStyle = '#ffd166';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('💫', Math.cos(starAng) * 16, -26 + Math.sin(starAng) * 6);
      ctx.fillText('💫', Math.cos(starAng + Math.PI) * 16, -26 + Math.sin(starAng + Math.PI) * 6);
      return;
    }

    // Hurt Stagger
    if (state === 'hurt') {
      ctx.save();
      ctx.translate(-8, 0);
      ctx.rotate(-0.15);
      this.drawPants(ctx, pal, 0, 0);
      this.drawTorso(ctx, pal, 0, 0);
      this.drawHead(ctx, pal, -2, 0);
      // Backwards hurt arms
      ctx.fillStyle = pal.skin;
      ctx.fillRect(-14, -30, 8, 8);
      ctx.restore();
      return;
    }

    // Airborne Jump Kick
    if (state === 'jump_kick') {
      this.drawHead(ctx, pal, 4, -4);
      this.drawTorso(ctx, pal, 2, -2);
      // Outstretched flying kick leg
      ctx.fillStyle = pal.pants;
      ctx.fillRect(6, -14, 26, 9);
      ctx.fillStyle = pal.boots || '#222';
      ctx.fillRect(28, -15, 10, 11);
      // Trailing tucked leg
      ctx.fillRect(-12, -18, 12, 9);
      return;
    }

    // Ground Punch Combo
    if (state === 'punch') {
      const isUppercut = char.combo === 3;
      this.drawPants(ctx, pal, 0, 0);
      this.drawTorso(ctx, pal, 4, 0);
      this.drawHead(ctx, pal, 4, 0);

      // Extended punch arm
      ctx.fillStyle = pal.shirt;
      if (isUppercut) {
        ctx.fillRect(4, -38, 9, 20);
        ctx.fillStyle = pal.skin;
        ctx.fillRect(3, -46, 12, 12); // High fist

        // Fiery uppercut whoosh
        ctx.fillStyle = 'rgba(255, 120, 0, 0.7)';
        ctx.beginPath();
        ctx.arc(8, -40, 16, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(6, -28, 20, 8);
        ctx.fillStyle = pal.skin;
        ctx.fillRect(24, -30, 11, 11); // Punch fist

        // Punch swoosh trail
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(10, -25);
        ctx.lineTo(34, -25);
        ctx.stroke();
      }
      return;
    }

    // Kick Combo
    if (state === 'kick') {
      this.drawTorso(ctx, pal, 0, 0);
      this.drawHead(ctx, pal, -2, 0);
      // Standing leg
      ctx.fillStyle = pal.pants;
      ctx.fillRect(-6, -15, 8, 16);
      // High Kick Leg
      ctx.fillStyle = pal.pants;
      ctx.fillRect(4, -26, 24, 9);
      ctx.fillStyle = pal.boots || '#222';
      ctx.fillRect(24, -28, 10, 12);
      return;
    }

    // Special Skill Cast Pose
    if (state === 'skill') {
      this.drawPants(ctx, pal, 0, 0);
      this.drawTorso(ctx, pal, 6, 2);
      this.drawHead(ctx, pal, 4, 2);

      // Both hands thrusting forward
      ctx.fillStyle = pal.skin;
      ctx.fillRect(16, -28, 12, 10);
      ctx.fillRect(16, -20, 12, 10);

      // Energy charging aura
      ctx.fillStyle = pal.aura;
      ctx.beginPath();
      ctx.arc(28, -24, 18 + Math.sin(now / 50) * 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Jump
    if (state === 'jump') {
      this.drawHead(ctx, pal, 0, -2);
      this.drawTorso(ctx, pal, 0, 0);
      // Tucked legs
      ctx.fillStyle = pal.pants;
      ctx.fillRect(-8, -12, 8, 10);
      ctx.fillRect(2, -12, 8, 10);
      return;
    }

    // Walk / Run Cycle
    if (state === 'walk' || state === 'run') {
      const freq = state === 'run' ? 0.024 : 0.014;
      const legOffset = Math.sin(now * freq) * 10;
      const bob = Math.abs(Math.sin(now * freq)) * 3;

      // Legs alternating
      ctx.fillStyle = pal.pants;
      ctx.fillRect(-6 - legOffset * 0.6, -14, 7, 15);
      ctx.fillRect(2 + legOffset * 0.6, -14, 7, 15);

      this.drawTorso(ctx, pal, 0, -bob);
      this.drawHead(ctx, pal, 0, -bob);

      // Arm swing
      ctx.fillStyle = pal.skin;
      ctx.fillRect(-10 + legOffset * 0.5, -24 - bob, 6, 6);
      ctx.fillRect(8 - legOffset * 0.5, -24 - bob, 6, 6);
      return;
    }

    // Default Idle (Breathing bob)
    const breatheBob = Math.sin(now * 0.006) * 1.5;
    this.drawPants(ctx, pal, 0, 0);
    this.drawTorso(ctx, pal, 0, -breatheBob);
    this.drawHead(ctx, pal, 0, -breatheBob);

    // Idle hands
    ctx.fillStyle = pal.skin;
    ctx.fillRect(-8, -22 - breatheBob, 6, 7);
    ctx.fillRect(6, -22 - breatheBob, 6, 7);
  }

  drawHead(ctx, pal, offsetX, offsetY) {
    const x = offsetX;
    const y = -36 + offsetY;

    // Face Skin
    ctx.fillStyle = pal.skin;
    ctx.fillRect(x - 8, y - 8, 16, 15);

    // Hair
    ctx.fillStyle = pal.hair;
    ctx.fillRect(x - 9, y - 13, 18, 7);
    ctx.fillRect(x - 10, y - 11, 4, 10); // Sideburn

    // Eyes
    ctx.fillStyle = '#111';
    ctx.fillRect(x + 2, y - 2, 3, 3);

    // Headband / Bandana (Kunio / LF2 Signature)
    if (pal.band) {
      ctx.fillStyle = pal.band;
      ctx.fillRect(x - 9, y - 7, 18, 4);
      // Headband tails fluttering behind head
      const flutter = Math.sin(Date.now() * 0.015) * 3;
      ctx.fillRect(x - 14, y - 6 + flutter, 6, 3);
      ctx.fillRect(x - 18, y - 4 + flutter, 6, 3);
    }
  }

  drawTorso(ctx, pal, offsetX, offsetY) {
    const x = offsetX;
    const y = -24 + offsetY;

    // Shirt / Gi
    ctx.fillStyle = pal.shirt;
    ctx.fillRect(x - 7, y, 15, 14);

    // Belt / Waistband
    ctx.fillStyle = '#111';
    ctx.fillRect(x - 8, y + 12, 17, 3);
  }

  drawPants(ctx, pal, offsetX, offsetY) {
    const x = offsetX;
    const y = -12 + offsetY;

    // Pants
    ctx.fillStyle = pal.pants;
    ctx.fillRect(x - 7, y, 6, 12);
    ctx.fillRect(x + 1, y, 6, 12);

    // Boots
    ctx.fillStyle = pal.boots || '#111';
    ctx.fillRect(x - 8, y + 9, 8, 4);
    ctx.fillRect(x + 1, y + 9, 8, 4);
  }

  // Overhead Status: Player Name, HP Bar, Self Arrow Indicator
  drawOverheadHUD(ctx, char, sx, sy, isSelf) {
    // Current player indicator arrow
    if (isSelf) {
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(sx, sy - 14);
      ctx.lineTo(sx - 5, sy - 22);
      ctx.lineTo(sx + 5, sy - 22);
      ctx.closePath();
      ctx.fill();
    }

    // Name text
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = char.isBot ? '#e76f51' : (isSelf ? '#ffd166' : '#ffffff');
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText(char.name, sx, sy - 4);
    ctx.shadowBlur = 0;

    // HP Bar
    const barW = 44;
    const barH = 5;
    const hpRatio = Math.max(0, char.hp / char.maxHp);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(sx - barW / 2, sy + 1, barW, barH);

    ctx.fillStyle = hpRatio > 0.4 ? '#06d6a0' : (hpRatio > 0.2 ? '#ffd166' : '#ef476f');
    ctx.fillRect(sx - barW / 2 + 1, sy + 2, (barW - 2) * hpRatio, barH - 2);
  }

  // Draw Projectiles (Fireball, Ice Shards, Ground Shockwave)
  drawProjectile(ctx, proj) {
    const sPos = this.toScreen(proj.x, proj.z, proj.y);
    const now = Date.now();

    ctx.save();
    ctx.translate(sPos.sx, sPos.sy);

    if (proj.type === 'fireball') {
      // Davis Energy Blast
      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, proj.radius);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, '#ffbe0b');
      grad.addColorStop(0.7, '#fb5607');
      grad.addColorStop(1, 'rgba(255, 0, 110, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, proj.radius + Math.sin(now / 30) * 3, 0, Math.PI * 2);
      ctx.fill();

      // Flame sparks
      for (let i = 0; i < 4; i++) {
        const sparkX = (Math.random() - 0.5) * 16 - (proj.vx > 0 ? 12 : -12);
        const sparkY = (Math.random() - 0.5) * 16;
        ctx.fillStyle = '#ffbe0b';
        ctx.fillRect(sparkX, sparkY, 4, 4);
      }
    } else if (proj.type === 'ice_shard') {
      // Dennis Ice Shard
      ctx.fillStyle = '#caf0f8';
      ctx.shadowColor = '#00b4d8';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(proj.vx > 0 ? 14 : -14, 0);
      ctx.lineTo(proj.vx > 0 ? -10 : 10, -7);
      ctx.lineTo(proj.vx > 0 ? -6 : 6, 0);
      ctx.lineTo(proj.vx > 0 ? -10 : 10, 7);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (proj.type === 'earth_quake') {
      // Titan Shockwave
      ctx.fillStyle = '#b7094c';
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffb703';
      ctx.fillRect(-10, -14, 6, 14);
      ctx.fillRect(4, -18, 7, 18);
    }

    ctx.restore();
  }

  // Draw Special Effects & Damage Numbers
  drawEffect(ctx, fx) {
    const sPos = this.toScreen(fx.x, fx.z, fx.y);
    const lifeRatio = fx.life / 25;

    ctx.save();
    ctx.translate(sPos.sx, sPos.sy);

    if (fx.type === 'damage_number') {
      // Floating damage number that pops up
      const riseY = (1 - lifeRatio) * 35;
      ctx.font = fx.isCrit ? 'bold 18px "Impact", sans-serif' : 'bold 14px sans-serif';
      ctx.textAlign = 'center';

      if (fx.isGuarded) {
        ctx.fillStyle = '#adb5bd';
        ctx.fillText(`🛡️ -${fx.value}`, 0, -riseY);
      } else if (fx.isCrit) {
        ctx.fillStyle = '#ff0055';
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 6;
        ctx.fillText(`CRIT! -${fx.value}`, 0, -riseY);
      } else {
        ctx.fillStyle = '#ffd166';
        ctx.shadowColor = '#000000';
        ctx.shadowBlur = 4;
        ctx.fillText(`-${fx.value}`, 0, -riseY);
      }
    } else if (fx.type === 'spark_hit') {
      // Hit flash sparks
      ctx.fillStyle = '#ffff3f';
      ctx.shadowColor = '#ff5400';
      ctx.shadowBlur = 8;
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        const dist = (1 - lifeRatio) * 22;
        ctx.fillRect(Math.cos(ang) * dist, Math.sin(ang) * dist, 5, 5);
      }
    } else if (fx.type === 'spark_guard') {
      // Guard sparks
      ctx.strokeStyle = '#00f5d4';
      ctx.lineWidth = 2;
      ctx.strokeRect(-12, -12, 24, 24);
    } else if (fx.type === 'dust') {
      // Jump / Land Dust puff
      ctx.fillStyle = `rgba(180, 180, 180, ${lifeRatio * 0.6})`;
      ctx.beginPath();
      ctx.arc(-8, 0, (1 - lifeRatio) * 12, 0, Math.PI * 2);
      ctx.arc(8, 0, (1 - lifeRatio) * 12, 0, Math.PI * 2);
      ctx.fill();
    } else if (fx.type === 'ko_burst') {
      // Dramatic KO explosion
      ctx.font = 'bold 24px "Impact", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff0055';
      ctx.shadowColor = '#ffff00';
      ctx.shadowBlur = 12;
      ctx.fillText('K. O. !', 0, -20);
    }

    ctx.restore();
  }
}

window.GameRenderer = GameRenderer;
