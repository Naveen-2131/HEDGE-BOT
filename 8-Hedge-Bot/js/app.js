/**
 * Hedge Bot Main App Controller
 * Connects DerivBrowserClient + FourBotStrategy + Full Per-Bot Configuration UI
 */

class HedgeBotApp {
  constructor() {
    this.client = null;
    this.strategy = null;
    this.isConnected = false;
    this.updateInterval = null;
    this.activeFilter = 'ALL';
  }

  init() {
    this.loadCredentials();
    this.bindUIEvents();
    this.log('info', '8-Bot Hedge Dashboard Ready. Enter your API token to connect.');

    const savedToken = localStorage.getItem('hedge_api_token') || '';
    if (savedToken && savedToken.length > 5) {
      setTimeout(() => this.connect(), 600);
    } else {
      this.openModal();
    }
  }

  // ── Credentials ────────────────────────────────────────────────
  loadCredentials() {
    const appId = localStorage.getItem('hedge_app_id') || '1089';
    const token = localStorage.getItem('hedge_api_token') || '';
    const el_appid = document.getElementById('inputAppId');
    const el_token = document.getElementById('inputToken');
    if (el_appid) el_appid.value = appId;
    if (el_token) el_token.value = token;
  }

  saveCredentials() {
    const appId = document.getElementById('inputAppId').value.trim() || '1089';
    const token = document.getElementById('inputToken').value.trim();
    localStorage.setItem('hedge_app_id', appId);
    localStorage.setItem('hedge_api_token', token);
    return { appId, token };
  }

  // ── Connect ────────────────────────────────────────────────────
  async connect() {
    const appId = localStorage.getItem('hedge_app_id') || '1089';
    const token = localStorage.getItem('hedge_api_token') || '';

    if (!token) { this.openModal(); return; }

    this.log('info', `Connecting to Deriv (App ID: ${appId})...`);
    this.setConnectionUI('connecting');

    if (this.client) this.client.disconnect();
    this.client = new DerivBrowserClient();

    this.client.on('log', ({ type, msg }) => this.log(type, msg));
    this.client.on('balanceUpdate', ({ balance, currency }) => {
      const el = document.getElementById('balanceDisplay');
      if (el) el.textContent = `${currency} ${balance.toFixed(2)}`;
    });
    this.client.on('authorized', () => {
      this.setConnectionUI('connected');
      this.initStrategy();
      this.startUIUpdater();
    });
    this.client.on('disconnected', () => {
      this.setConnectionUI('disconnected');
      this.log('warning', 'Disconnected from Deriv.');
    });

    try {
      await this.client.connect(appId, token);
    } catch(err) {
      this.log('error', `Connection failed: ${err.message}`);
      this.setConnectionUI('disconnected');
      this.openModal();
    }
  }

  // ── Strategy Init ──────────────────────────────────────────────
  initStrategy() {
    if (!window.FourBotStrategy) {
      this.log('error', '4bot-browser.js not loaded!');
      return;
    }

    this.strategy = new FourBotStrategy();

    // Patch console.log / error
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args) => {
      origLog.apply(console, args);
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
      this.log('info', msg);
    };
    console.error = (...args) => {
      origErr.apply(console, args);
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ');
      this.log('error', msg);
    };

    this.strategy.onStart(this.client);

    // Subscribe to all symbols
    const symbols = [...new Set(this.strategy.strategies.map(s => s.symbol || 'R_100'))];
    this.log('info', `Subscribing to markets: ${symbols.join(', ')}`);
    symbols.forEach(sym => this.client.subscribeTicks(sym));

    // Forward ticks
    this.client.on('tick', (tick) => {
      if (this.strategy) {
        this.strategy.onTick({
          quote: parseFloat(tick.quote),
          symbol: tick.symbol,
          epoch: tick.epoch
        }).catch(() => {});
      }
    });

    this.renderBotCards();
    this.log('success', `>>> ${this.strategy.strategies.length} BOTS LOADED WITH INDIVIDUAL CONFIGS. Ready to trade! <<<`);
  }

  // ── UI Loop ───────────────────────────────────────────────────
  startUIUpdater() {
    if (this.updateInterval) clearInterval(this.updateInterval);
    this.updateInterval = setInterval(() => this.updateBotCards(), 1500);
  }

  updateBotCards() {
    if (!this.strategy) return;
    let totalProfit = 0;
    this.strategy.strategies.forEach(bot => {
      const card = document.getElementById(`bot-card-${bot.id}`);
      if (!card) return;
      const profit = bot.sessionProfit || bot.profit || 0;
      totalProfit += profit;

      const profitEl = card.querySelector(`.profit-val-${bot.id}`);
      const statusDot = card.querySelector(`.status-dot-${bot.id}`);
      const toggleBtn = card.querySelector(`.btn-toggle-${bot.id}`);

      if (profitEl) {
        profitEl.textContent = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`;
        profitEl.className = `profit-val-${bot.id} ${profit > 0 ? 'profit-pos' : profit < 0 ? 'profit-neg' : ''}`;
      }
      if (statusDot) {
        statusDot.className = `status-dot status-dot-${bot.id} ${bot.isRunning ? 'status-running' : ''}`;
      }
      if (toggleBtn) {
        toggleBtn.textContent = bot.isRunning ? 'STOP' : 'START';
        toggleBtn.className = `btn ${bot.isRunning ? 'btn-danger-sm' : 'btn-success-sm'} btn-toggle-${bot.id}`;
      }
    });

    const totalEl = document.getElementById('totalPnL');
    if (totalEl) {
      totalEl.textContent = `${totalProfit >= 0 ? '+' : ''}$${totalProfit.toFixed(2)}`;
      totalEl.className = `total-pnl ${totalProfit > 0 ? 'profit-pos' : totalProfit < 0 ? 'profit-neg' : ''}`;
    }
  }

  // ── Render Bot Cards with Full Inputs ─────────────────────────
  renderBotCards() {
    if (!this.strategy) return;

    const groups = {
      'Over': [],
      'Under': [],
      'Odd/Even': [],
      'Pattern Bots': [],
      'Differ': [],
      'Matches': [],
      'Higher/Lower': [],
      'Hedge': []
    };

    this.strategy.strategies.forEach(bot => {
      const id = bot.id;
      if (id >= 1 && id <= 10) groups['Over'].push(bot);
      else if (id >= 11 && id <= 20) groups['Under'].push(bot);
      else if (id >= 21 && id <= 30) groups['Odd/Even'].push(bot);
      else if (id >= 31 && id <= 34) groups['Pattern Bots'].push(bot);
      else if (id >= 35 && id <= 44) groups['Differ'].push(bot);
      else if (id >= 45 && id <= 54) groups['Matches'].push(bot);
      else if (id >= 55 && id <= 74) groups['Higher/Lower'].push(bot);
      else groups['Hedge'].push(bot);
    });

    const container = document.getElementById('botCardsContainer');
    if (!container) return;
    container.innerHTML = '';

    const marketOptions = `
      <option value="R_100">Volatility 100</option>
      <option value="1HZ100V">Volatility 100 (1s)</option>
      <option value="R_75">Volatility 75</option>
      <option value="1HZ75V">Volatility 75 (1s)</option>
      <option value="R_50">Volatility 50</option>
      <option value="1HZ50V">Volatility 50 (1s)</option>
      <option value="R_25">Volatility 25</option>
      <option value="1HZ25V">Volatility 25 (1s)</option>
      <option value="R_10">Volatility 10</option>
      <option value="1HZ10V">Volatility 10 (1s)</option>
    `;

    Object.entries(groups).forEach(([groupName, bots]) => {
      if (bots.length === 0) return;

      const groupSlug = groupName.replace(/[^a-zA-Z]/g, '').toLowerCase();
      const section = document.createElement('div');
      section.className = `bot-group group-sec-${groupSlug}`;
      section.innerHTML = `<div class="group-title">${groupName} (${bots.length} Bots)</div><div class="group-grid"></div>`;
      container.appendChild(section);

      const grid = section.querySelector('.group-grid');

      bots.forEach(bot => {
        const card = document.createElement('div');
        card.className = 'bot-card';
        card.id = `bot-card-${bot.id}`;

        const isPatternBot = (bot.id >= 31 && bot.id <= 34);
        const isDifferBot = (bot.id >= 35 && bot.id <= 44);
        const isHedgeMatch = (bot.id === 75);
        const isHedgeHiLo = (bot.id >= 76 && bot.id <= 85);
        const hasPrediction = (bot.prediction !== undefined || bot.barrier !== undefined);

        const currentSymbol = bot.symbol || 'R_100';
        const currentStake = bot.baseStake || bot.stake || 0.35;
        const currentDuration = bot.duration || 1;
        const currentPred = bot.prediction !== undefined ? bot.prediction : (bot.barrier !== undefined ? bot.barrier : '');
        const currentTP = bot.takeProfit || 100;
        const currentSL = bot.stopLoss || -10;
        const currentOp = bot.triggerOperator || '=';
        const currentTrig = bot.triggerDigit !== undefined ? bot.triggerDigit : 5;
        const currentMartingale = Array.isArray(bot.martingaleStakes) ? bot.martingaleStakes.join(', ') : (bot.martingaleStakes || '');
        const currentPattern = Array.isArray(bot.tradePattern) ? bot.tradePattern.join(', ') : (bot.tradePattern || '');

        card.innerHTML = `
          <div class="bot-card-header">
            <span class="status-dot status-dot-${bot.id}"></span>
            <span class="bot-name" title="${bot.name}">#${bot.id} ${bot.name}</span>
          </div>

          <div class="bot-profit-row">
            <span class="profit-label">PnL:</span>
            <span class="profit-val-${bot.id} profit-display">$0.00</span>
          </div>

          <div class="card-inputs-grid">
            <div class="c-field">
              <label>MARKET</label>
              <select id="sym-${bot.id}" class="c-input">${marketOptions}</select>
            </div>
            <div class="c-field">
              <label>STAKE ($)</label>
              <input type="number" step="0.01" id="stake-${bot.id}" class="c-input" value="${currentStake}">
            </div>
            <div class="c-field">
              <label>DURATION (t)</label>
              <input type="number" id="dur-${bot.id}" class="c-input" value="${currentDuration}">
            </div>
            ${hasPrediction ? `
            <div class="c-field">
              <label>BARRIER/PRED</label>
              <input type="text" id="pred-${bot.id}" class="c-input" value="${currentPred}">
            </div>` : ''}
            <div class="c-field">
              <label>TAKE PROFIT ($)</label>
              <input type="number" id="tp-${bot.id}" class="c-input" value="${currentTP}">
            </div>
            <div class="c-field">
              <label>STOP LOSS ($)</label>
              <input type="number" id="sl-${bot.id}" class="c-input" value="${currentSL}">
            </div>
            ${isPatternBot ? `
            <div class="c-field full-width">
              <label>PATTERN</label>
              <input type="text" id="pat-${bot.id}" class="c-input" value="${currentPattern}" placeholder="e.g. DIGITEVEN, DIGITODD">
            </div>` : ''}
            ${isDifferBot ? `
            <div class="c-field full-width">
              <label>CONSECUTIVE TICKS</label>
              <input type="number" id="consec-${bot.id}" class="c-input" value="${bot.consecutiveCount || 4}">
            </div>` : ''}
            ${!isPatternBot ? `
            <div class="c-field full-width">
              <label>MARTINGALE MULTIPLIERS</label>
              <input type="text" id="mart-${bot.id}" class="c-input" value="${currentMartingale}" placeholder="e.g. 0.35, 0.70, 1.40">
            </div>` : ''}
            <div class="c-field full-width">
              <label>TRIGGER CONDITION</label>
              <div class="op-trig-row">
                <select id="op-${bot.id}" class="c-input op-select">
                  <option value="=" ${currentOp === '=' ? 'selected' : ''}>=</option>
                  <option value="<" ${currentOp === '<' ? 'selected' : ''}>&lt;</option>
                  <option value=">" ${currentOp === '>' ? 'selected' : ''}>&gt;</option>
                </select>
                <input type="number" id="trig-${bot.id}" class="c-input" value="${currentTrig}" min="0" max="9" placeholder="Digit">
              </div>
            </div>
          </div>

          <div class="bot-card-actions">
            <button class="btn btn-secondary-sm" onclick="app.updateBotConfig(${bot.id})">💾 SAVE CONFIG</button>
            <button class="btn btn-success-sm btn-toggle-${bot.id}" onclick="app.toggleBot(${bot.id})">START</button>
          </div>
        `;

        grid.appendChild(card);

        // Select market
        const symSelect = card.querySelector(`#sym-${bot.id}`);
        if (symSelect) symSelect.value = currentSymbol;
      });
    });

    this.applySectionFilter(this.activeFilter);
  }

  // ── Save Config per Bot ────────────────────────────────────────
  updateBotConfig(id) {
    if (!this.strategy) return;
    const bot = this.strategy.strategies.find(s => s.id === id);
    if (!bot) return;

    const sym = document.getElementById(`sym-${id}`)?.value;
    const stake = parseFloat(document.getElementById(`stake-${id}`)?.value || '0.35');
    const dur = parseInt(document.getElementById(`dur-${id}`)?.value || '1', 10);
    const tp = parseFloat(document.getElementById(`tp-${id}`)?.value || '100');
    const sl = parseFloat(document.getElementById(`sl-${id}`)?.value || '-10');
    const op = document.getElementById(`op-${id}`)?.value || '=';
    const trig = parseInt(document.getElementById(`trig-${id}`)?.value || '5', 10);
    const predEl = document.getElementById(`pred-${id}`);
    const martEl = document.getElementById(`mart-${id}`);
    const patEl = document.getElementById(`pat-${id}`);
    const consecEl = document.getElementById(`consec-${id}`);

    if (sym) {
      bot.symbol = sym;
      if (this.client) this.client.subscribeTicks(sym);
    }
    if (!isNaN(stake)) {
      bot.baseStake = stake;
      bot.stake = stake;
    }
    if (!isNaN(dur)) bot.duration = dur;
    if (!isNaN(tp)) bot.takeProfit = tp;
    if (!isNaN(sl)) bot.stopLoss = sl;
    bot.triggerOperator = op;
    if (!isNaN(trig)) bot.triggerDigit = trig;

    if (predEl && predEl.value !== undefined) {
      const pVal = predEl.value.trim();
      bot.prediction = pVal;
      bot.barrier = pVal;
    }

    if (martEl && martEl.value) {
      const stakesArr = martEl.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      if (stakesArr.length > 0) {
        bot.martingaleStakes = stakesArr;
        bot.maxMartingaleLevel = stakesArr.length - 1;
      }
    }

    if (patEl && patEl.value !== undefined) {
      bot.tradePattern = patEl.value.split(',').map(p => p.trim()).filter(Boolean);
    }

    if (consecEl && consecEl.value) {
      bot.consecutiveCount = parseInt(consecEl.value, 10);
    }

    this.log('success', `✅ Bot #${id} (${bot.name}) configuration updated!`);
  }

  // ── Section Filter Toggles ─────────────────────────────────────
  filterSection(category) {
    this.activeFilter = category;
    this.applySectionFilter(category);
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-filter') === category);
    });
  }

  applySectionFilter(category) {
    document.querySelectorAll('.bot-group').forEach(group => {
      if (category === 'ALL') {
        group.style.display = 'block';
      } else {
        const slug = category.replace(/[^a-zA-Z]/g, '').toLowerCase();
        group.style.display = group.classList.contains(`group-sec-${slug}`) ? 'block' : 'none';
      }
    });
  }

  // ── Bot Controls ───────────────────────────────────────────────
  toggleBot(id) {
    if (!this.strategy) return;
    const bot = this.strategy.strategies.find(s => s.id === id);
    if (!bot) return;
    if (bot.isRunning) {
      bot.stop();
      this.log('warning', `Bot #${id} stopped.`);
    } else {
      if (!this.client || !this.client.isAuthorized) {
        this.log('error', 'Not connected. Please connect first.');
        return;
      }
      bot.start();
      this.log('success', `Bot #${id} started.`);
    }
    this.updateBotCards();
  }

  startAll() {
    if (!this.strategy || !this.client || !this.client.isAuthorized) {
      this.log('error', 'Not connected!');
      return;
    }
    this.strategy.strategies.forEach(bot => { if (!bot.isRunning) bot.start(); });
    this.log('success', 'ALL BOTS STARTED');
    this.updateBotCards();
  }

  stopAll() {
    if (!this.strategy) return;
    this.strategy.strategies.forEach(bot => { if (bot.isRunning) bot.stop(); });
    this.log('warning', 'ALL BOTS STOPPED');
    this.updateBotCards();
  }

  resetAll() {
    if (!this.strategy) return;
    this.strategy.strategies.forEach(bot => {
      if (bot.isRunning) bot.stop();
      if (typeof bot.resetSession === 'function') bot.resetSession();
      bot.sessionProfit = 0;
      bot.profit = 0;
    });
    this.log('info', 'All sessions reset.');
    this.updateBotCards();
  }

  // ── UI Helpers ─────────────────────────────────────────────────
  setConnectionUI(state) {
    const text = document.getElementById('connText');
    const badge = document.getElementById('connBadge');
    const states = {
      connected: { label: 'CONNECTED', cls: 'badge-connected' },
      connecting: { label: 'CONNECTING...', cls: 'badge-connecting' },
      disconnected: { label: 'DISCONNECTED', cls: 'badge-disconnected' }
    };
    const s = states[state] || states.disconnected;
    if (text) text.textContent = s.label;
    if (badge) badge.className = `conn-badge ${s.cls}`;
  }

  openModal() {
    const m = document.getElementById('apiModal');
    if (m) m.classList.add('active');
  }
  closeModal() {
    const m = document.getElementById('apiModal');
    if (m) m.classList.remove('active');
  }

  log(type, msg) {
    const console_el = document.getElementById('logConsole');
    if (!console_el) return;
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#94a3b8' };
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.style.color = colors[type] || '#94a3b8';
    line.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
    line.style.padding = '3px 0';
    line.textContent = `[${time}] ${msg}`;
    console_el.prepend(line);
    while (console_el.children.length > 200) {
      console_el.removeChild(console_el.lastChild);
    }
  }

  bindUIEvents() {
    document.getElementById('btnOpenModal')?.addEventListener('click', () => this.openModal());
    document.getElementById('btnCloseModal')?.addEventListener('click', () => this.closeModal());
    document.getElementById('btnSaveConnect')?.addEventListener('click', () => {
      const { appId, token } = this.saveCredentials();
      if (!token) { this.log('error', 'Token cannot be empty!'); return; }
      this.closeModal();
      this.connect();
    });
    document.getElementById('btnStartAll')?.addEventListener('click', () => this.startAll());
    document.getElementById('btnStopAll')?.addEventListener('click', () => this.stopAll());
    document.getElementById('btnResetAll')?.addEventListener('click', () => this.resetAll());

    // Section Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = e.target.getAttribute('data-filter');
        this.filterSection(filter);
      });
    });

    // Close modal on outside click
    document.getElementById('apiModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'apiModal') this.closeModal();
    });
  }
}

const app = new HedgeBotApp();
window.app = app;
document.addEventListener('DOMContentLoaded', () => app.init());
