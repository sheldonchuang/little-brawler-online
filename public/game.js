// Game Client Engine: Input, Network Sync, Camera, Mobile Virtual Pad

(function() {
  const canvas = document.getElementById('gameCanvas');
  const renderer = new window.GameRenderer(canvas);

  let socket = null;
  let myId = null;
  let myRoomId = 'ARENA-1';
  let myHeroType = 'fire';
  let myName = '熱血少年';

  // Game state synced from server
  let gameState = {
    players: [],
    bots: [],
    projectiles: [],
    effects: []
  };

  // Camera smooth scrolling
  let cameraX = 0;

  // Local input state
  const keys = {
    up: false,
    down: false,
    left: false,
    right: false,
    attack: false,
    jump: false,
    skill: false,
    guard: false,
    dash: false
  };

  // Double tap dash tracking
  let lastTapKey = null;
  let lastTapTime = 0;
  let isRunning = false;

  // Audio triggering cache to avoid repeating sounds every frame
  const lastStateMap = new Map();

  // Resize canvas to match window / container
  function resizeGame() {
    const container = document.getElementById('canvas-container');
    const width = container.clientWidth || 960;
    const height = container.clientHeight || 540;
    renderer.resize(width, height);
  }

  window.addEventListener('resize', resizeGame);
  window.addEventListener('orientationchange', () => setTimeout(resizeGame, 200));

  // ==================== WebSocket Networking ====================
  function connectNetwork() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('Connected to server!');
      document.getElementById('connection-status').innerText = '🟢 已連線';
      document.getElementById('connection-status').className = 'status-connected';

      // Join room
      socket.send(JSON.stringify({
        type: 'join',
        roomId: myRoomId,
        name: myName,
        heroType: myHeroType
      }));
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleServerPacket(data);
      } catch (err) {
        console.error('Failed to parse incoming packet:', err);
      }
    };

    socket.onclose = () => {
      console.warn('Disconnected. Attempting reconnect in 2s...');
      document.getElementById('connection-status').innerText = '🔴 斷線重連中...';
      document.getElementById('connection-status').className = 'status-disconnected';
      setTimeout(connectNetwork, 2000);
    };

    socket.onerror = (e) => {
      console.error('Socket error:', e);
    };
  }

  function handleServerPacket(data) {
    if (data.type === 'init') {
      myId = data.yourId;
      myRoomId = data.roomId;
      document.getElementById('hud-room-name').innerText = myRoomId;
      addChatMessage('系統', `歡迎進入戰局【${myRoomId}】！點擊畫面以開啟音效。`);
    } else if (data.type === 'sync') {
      gameState = data;
      detectAudioEvents(gameState);
      updateHUD();
    } else if (data.type === 'player_joined') {
      addChatMessage('系統', data.msg);
    } else if (data.type === 'player_left') {
      addChatMessage('系統', data.msg);
    } else if (data.type === 'chat') {
      addChatMessage(data.from, data.text);
    }
  }

  // Audio triggering on action changes
  function detectAudioEvents(state) {
    const allChars = [...(state.players || []), ...(state.bots || [])];
    for (const char of allChars) {
      const prev = lastStateMap.get(char.id);
      if (prev) {
        // Attack whoosh
        if ((char.state === 'punch' || char.state === 'kick' || char.state === 'jump_kick') && prev.state !== char.state) {
          window.sounds.playWhoosh();
        }
        // Jump chirp
        if (char.state === 'jump' && prev.state !== 'jump') {
          window.sounds.playJump();
        }
        // Skill blast
        if (char.state === 'skill' && prev.state !== 'skill') {
          window.sounds.playEnergyBlast();
        }
        // Hurt impact
        if (char.state === 'hurt' && prev.state !== 'hurt') {
          window.sounds.playHit(false);
        }
        // Knockdown
        if (char.state === 'fallen' && prev.state !== 'fallen') {
          window.sounds.playKnockdown();
        }
        // Guard Block
        if (char.state === 'guard' && prev.state !== 'guard') {
          window.sounds.playBlock();
        }
        // KO
        if (char.isDead && !prev.isDead) {
          window.sounds.playKO();
        }
      }
      lastStateMap.set(char.id, { state: char.state, isDead: char.isDead, hp: char.hp });
    }
  }

  // Update Top HUD
  function updateHUD() {
    const me = (gameState.players || []).find(p => p.id === myId);
    if (me) {
      const hpPercent = Math.max(0, (me.hp / me.maxHp) * 100);
      const mpPercent = Math.max(0, (me.mp / me.maxMp) * 100);

      document.getElementById('hud-hp-bar').style.width = hpPercent + '%';
      document.getElementById('hud-hp-text').innerText = `${Math.ceil(me.hp)} / ${me.maxHp}`;

      document.getElementById('hud-mp-bar').style.width = mpPercent + '%';
      document.getElementById('hud-mp-text').innerText = `${Math.ceil(me.mp)} / ${me.maxMp}`;

      document.getElementById('hud-player-name').innerText = me.name;
      document.getElementById('hud-kills').innerText = `擊倒: ${me.kills || 0}`;

      const respawnOverlay = document.getElementById('respawn-overlay');
      if (me.isDead) {
        respawnOverlay.style.display = 'flex';
        document.getElementById('respawn-time').innerText = Math.ceil((me.respawnTimer || 0) / 30);
      } else {
        respawnOverlay.style.display = 'none';
      }
    }

    const totalCount = (gameState.players ? gameState.players.length : 0) + (gameState.bots ? gameState.bots.length : 0);
    document.getElementById('hud-online-count').innerText = `在線人數: ${totalCount}`;
  }

  // Chat message helper
  function addChatMessage(from, text) {
    const box = document.getElementById('chat-messages');
    const msg = document.createElement('div');
    msg.className = 'chat-line';
    msg.innerHTML = `<span class="chat-from">${from}:</span> <span class="chat-text">${text}</span>`;
    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
  }

  // Send input to server at 30 FPS
  function sendInput() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    let dx = 0;
    let dz = 0;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (keys.up) dz -= 1;
    if (keys.down) dz += 1;

    // Normalizing diagonal movement
    if (dx !== 0 && dz !== 0) {
      dx *= 0.7071;
      dz *= 0.7071;
    }

    socket.send(JSON.stringify({
      type: 'input',
      dx: dx,
      dz: dz,
      isRunning: isRunning || keys.dash,
      guard: keys.guard
    }));
  }

  function sendAction(action) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      type: 'action',
      action: action
    }));
  }

  // ==================== Keyboard Input Listeners ====================
  window.addEventListener('keydown', (e) => {
    // If typing in chat input, skip game keys
    if (document.activeElement === document.getElementById('chat-input')) {
      if (e.key === 'Enter') {
        sendChatFromInput();
      }
      return;
    }

    window.sounds.init(); // User interaction unlocks audio context

    const code = e.code;
    const now = Date.now();

    // Directional Movement & Double-Tap Dash
    if (code === 'KeyA' || code === 'ArrowLeft') {
      if (!keys.left && lastTapKey === 'left' && now - lastTapTime < 260) {
        isRunning = true;
      }
      lastTapKey = 'left';
      lastTapTime = now;
      keys.left = true;
    } else if (code === 'KeyD' || code === 'ArrowRight') {
      if (!keys.right && lastTapKey === 'right' && now - lastTapTime < 260) {
        isRunning = true;
      }
      lastTapKey = 'right';
      lastTapTime = now;
      keys.right = true;
    } else if (code === 'KeyW' || code === 'ArrowUp') {
      keys.up = true;
    } else if (code === 'KeyS' || code === 'ArrowDown') {
      keys.down = true;
    }

    // Action Keys
    if (code === 'KeyJ' || code === 'KeyZ') { // Attack
      if (!keys.attack) {
        keys.attack = true;
        sendAction('attack');
      }
    } else if (code === 'KeyK' || code === 'KeyX' || code === 'Space') { // Jump
      if (!keys.jump) {
        keys.jump = true;
        sendAction('jump');
      }
    } else if (code === 'KeyL' || code === 'KeyC') { // Skill
      if (!keys.skill) {
        keys.skill = true;
        sendAction('skill');
      }
    } else if (code === 'KeyU' || code === 'KeyV') { // Guard
      keys.guard = true;
    } else if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyI') { // Dash
      keys.dash = true;
      isRunning = true;
    } else if (code === 'Enter') {
      document.getElementById('chat-input').focus();
    }
  });

  window.addEventListener('keyup', (e) => {
    const code = e.code;
    if (code === 'KeyA' || code === 'ArrowLeft') {
      keys.left = false;
      if (!keys.right) isRunning = false;
    } else if (code === 'KeyD' || code === 'ArrowRight') {
      keys.right = false;
      if (!keys.left) isRunning = false;
    } else if (code === 'KeyW' || code === 'ArrowUp') {
      keys.up = false;
    } else if (code === 'KeyS' || code === 'ArrowDown') {
      keys.down = false;
    } else if (code === 'KeyJ' || code === 'KeyZ') {
      keys.attack = false;
    } else if (code === 'KeyK' || code === 'KeyX' || code === 'Space') {
      keys.jump = false;
    } else if (code === 'KeyL' || code === 'KeyC') {
      keys.skill = false;
    } else if (code === 'KeyU' || code === 'KeyV') {
      keys.guard = false;
    } else if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyI') {
      keys.dash = false;
      isRunning = false;
    }
  });

  // ==================== Mobile Touch Virtual Controls ====================
  function setupMobileControls() {
    const dpad = document.getElementById('touch-dpad');
    const stick = document.getElementById('touch-stick');
    let touchId = null;
    let centerX = 0;
    let centerY = 0;

    const resetStick = () => {
      touchId = null;
      stick.style.transform = `translate(0px, 0px)`;
      keys.left = false;
      keys.right = false;
      keys.up = false;
      keys.down = false;
      isRunning = false;
    };

    dpad.addEventListener('touchstart', (e) => {
      e.preventDefault();
      window.sounds.init();
      const touch = e.changedTouches[0];
      touchId = touch.identifier;
      const rect = dpad.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      handleTouchMove(touch);
    }, { passive: false });

    dpad.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId) {
          handleTouchMove(e.changedTouches[i]);
          break;
        }
      }
    }, { passive: false });

    dpad.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId) {
          resetStick();
          break;
        }
      }
    });

    dpad.addEventListener('touchcancel', resetStick);

    function handleTouchMove(touch) {
      const dx = touch.clientX - centerX;
      const dy = touch.clientY - centerY;
      const dist = Math.hypot(dx, dy);
      const maxDist = 45;
      const clampedDist = Math.min(dist, maxDist);
      const angle = Math.atan2(dy, dx);

      const sx = Math.cos(angle) * clampedDist;
      const sy = Math.sin(angle) * clampedDist;
      stick.style.transform = `translate(${sx}px, ${sy}px)`;

      const deadzone = 12;
      keys.left = dx < -deadzone;
      keys.right = dx > deadzone;
      keys.up = dy < -deadzone;
      keys.down = dy > deadzone;
      isRunning = dist > 35;
    }

    // Touch Action Buttons
    function bindTouchButton(btnId, onDown, onUp) {
      const btn = document.getElementById(btnId);
      if (!btn) return;

      btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        window.sounds.init();
        onDown();
      }, { passive: false });

      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (onUp) onUp();
      }, { passive: false });
    }

    bindTouchButton('btn-attack', () => sendAction('attack'));
    bindTouchButton('btn-jump', () => sendAction('jump'));
    bindTouchButton('btn-skill', () => sendAction('skill'));
    bindTouchButton('btn-guard', () => { keys.guard = true; }, () => { keys.guard = false; });
    bindTouchButton('btn-dash', () => { isRunning = true; }, () => { isRunning = false; });
  }

  // ==================== Lobby Modal & Chat UI ====================
  function setupUI() {
    // Character selection cards
    const cards = document.querySelectorAll('.hero-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        myHeroType = card.dataset.hero;
      });
    });

    // Join Button
    document.getElementById('btn-join').addEventListener('click', () => {
      const nameInput = document.getElementById('input-name').value.trim();
      const roomInput = document.getElementById('input-room').value.trim();
      if (nameInput) myName = nameInput;
      if (roomInput) myRoomId = roomInput.toUpperCase();

      document.getElementById('lobby-modal').style.display = 'none';
      window.sounds.init();
      connectNetwork();
    });

    // Spawn Minion / Bot Button
    document.getElementById('btn-spawn-bot').addEventListener('click', () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'spawn_bot' }));
      }
    });

    // Toggle BGM
    document.getElementById('btn-toggle-bgm').addEventListener('click', () => {
      const playing = window.sounds.toggleBGM();
      document.getElementById('btn-toggle-bgm').innerText = playing ? '🎵 音樂: 開' : '🔇 音樂: 關';
    });

    // Chat form submit
    document.getElementById('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      sendChatFromInput();
    });

    // Quick emoji buttons
    document.querySelectorAll('.emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.innerText;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'chat', text: text }));
        }
      });
    });

    // Touch controls toggle
    const toggleTouch = document.getElementById('btn-toggle-touch');
    const mobileControls = document.getElementById('mobile-controls');
    toggleTouch.addEventListener('click', () => {
      const isVisible = mobileControls.style.display !== 'none';
      mobileControls.style.display = isVisible ? 'none' : 'flex';
      toggleTouch.innerText = isVisible ? '📱 開啟虛擬搖桿' : '📱 隱藏虛擬搖桿';
    });

    // Auto show virtual controls on mobile / touch screen
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      mobileControls.style.display = 'flex';
      toggleTouch.innerText = '📱 隱藏虛擬搖桿';
    }
  }

  function sendChatFromInput() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (text && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'chat', text: text }));
      input.value = '';
      input.blur();
    }
  }

  // ==================== Main Game Loop ====================
  let lastInputTime = 0;

  function gameLoop(timestamp) {
    // Send input ~30 times a second
    if (timestamp - lastInputTime > 33) {
      sendInput();
      lastInputTime = timestamp;
    }

    // Camera follow local player
    const me = (gameState.players || []).find(p => p.id === myId);
    if (me) {
      const targetCamX = me.x - renderer.width / 2;
      const maxCamX = Math.max(0, 1200 - renderer.width);
      const clampedCamX = Math.max(0, Math.min(maxCamX, targetCamX));
      // Smooth camera interpolation
      cameraX += (clampedCamX - cameraX) * 0.12;
    }

    // Render frame
    renderer.render(gameState, myId, cameraX);

    requestAnimationFrame(gameLoop);
  }

  // Init
  resizeGame();
  setupUI();
  setupMobileControls();
  requestAnimationFrame(gameLoop);
})();
