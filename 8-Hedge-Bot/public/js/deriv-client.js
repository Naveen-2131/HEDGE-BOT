/**
 * Deriv Browser WebSocket Client (Dual-Mode: REST OTP + Standard WS)
 * Connects directly to Deriv API from the browser tab
 */
class DerivBrowserClient {
  constructor() {
    this.ws = null;
    this.appId = '1089';
    this.token = '';
    this.balance = 0;
    this.currency = 'USD';
    this.accountId = '';
    this.accountType = 'demo';
    this.isConnected = false;
    this.isAuthorized = false;
    this.reqIdCounter = 1;
    this.callbacks = new Map();
    this.pingInterval = null;
    this.listeners = {};
    this._tickSubIds = {};
    this.openContractsCache = new Map();
    this._lastContractPoll = new Map();
  }

  // ── Event Emitter ──────────────────────────────────────────────
  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  emit(event, data) {
    (this.listeners[event] || []).forEach(fn => { try { fn(data); } catch(e) {} });
  }


  // ── Global Open Contracts Push Subscription ───────────────────
  subscribeOpenContract() {
    if (this._isSubscribedToOpenContracts) {
      return Promise.resolve({ already_subscribed: true });
    }
    this._isSubscribedToOpenContracts = true;
    console.log('[DerivWS] Subscribing to global proposal_open_contract stream...');
    return this.send({
      proposal_open_contract: 1,
      subscribe: 1
    }).catch(err => {
      this._isSubscribedToOpenContracts = false;
      console.warn('[DerivWS] Global proposal_open_contract notice:', err.message || err);
    });
  }

  subscribeOpenContractsGlobal() {
    return this.subscribeOpenContract();
  }

  async fetchOpenContract(contractId) {
    if (!this.isConnected || !contractId) return null;
    const cidNum = parseInt(contractId, 10);
    try {
      const res = await this.send({ proposal_open_contract: 1, contract_id: cidNum });
      if (res && res.proposal_open_contract) {
        const poc = res.proposal_open_contract;
        const cidStr = String(poc.contract_id);
        const isSold = Boolean(poc.is_sold || poc.status !== 'open');
        const ticks = (poc.tick_passed !== undefined && poc.tick_passed !== null)
          ? (parseInt(poc.tick_passed, 10) || 0)
          : 0;

        const data = {
          contract_id: poc.contract_id,
          is_sold: isSold,
          profit: parseFloat(poc.profit || 0),
          status: poc.status,
          tick_passed: ticks,
          is_valid_to_sell: Boolean(poc.is_valid_to_sell)
        };
        this.openContractsCache.set(cidStr, data);
        this.openContractsCache.set(poc.contract_id, data);
        return data;
      }
    } catch(e) {}
    return null;
  }

  // ── Main Connect Method ────────────────────────────────────────
  async connect(appId, token) {
    this.appId = (appId && String(appId).trim()) || '1089';
    this.token = (token && String(token).trim()) || '';

    if (!this.token) {
      throw new Error('API Token is required');
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      try { this.ws.close(); } catch(e) {}
    }

    // Try REST OTP flow first (for pat_ tokens or REST API credentials)
    if (this.token.startsWith('pat_') || this.appId.length > 10) {
      try {
        this.emit('log', { type: 'info', msg: 'Attempting REST API OTP connection...' });
        return await this.connectOTP();
      } catch(otpErr) {
        this.emit('log', { type: 'warning', msg: `REST API notice (${otpErr.message}). Trying Standard WS...` });
      }
    }

    // Standard WebSocket flow fallback
    return await this.connectStandardWS();
  }

  // ── OTP Flow ───────────────────────────────────────────────────
  async connectOTP() {
    // 1. Fetch Accounts
    const accRes = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
      method: 'GET',
      headers: {
        'Deriv-App-ID': this.appId,
        'Authorization': `Bearer ${this.token}`
      }
    });

    if (!accRes.ok) {
      const errText = await accRes.text();
      throw new Error(`Accounts API error (${accRes.status}): ${errText}`);
    }

    const accData = await accRes.json();
    let accounts = accData.data || accData.accounts || (Array.isArray(accData) ? accData : [accData]);
    if (!accounts || accounts.length === 0) throw new Error('No accounts found for token');

    // Pick Demo or Real account
    let selected = accounts.find(a => (a.account_type || a.type || '').toLowerCase().includes('demo')) || accounts[0];
    this.accountId = selected.account_id || selected.id || selected.loginid;
    this.balance = parseFloat(selected.balance || 0);
    this.currency = selected.currency || 'USD';
    const isDemo = (selected.account_type || '').toLowerCase().includes('demo');

    // 2. Generate OTP
    const otpRes = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${this.accountId}/otp`, {
      method: 'POST',
      headers: {
        'Deriv-App-ID': this.appId,
        'Authorization': `Bearer ${this.token}`
      }
    });

    if (!otpRes.ok) throw new Error(`OTP generation failed (${otpRes.status})`);
    const otpData = await otpRes.json();
    const wsUrl = otpData.data?.url || otpData.url;
    if (!wsUrl) throw new Error('OTP WS URL missing in response');

    // 3. Connect to OTP WS URL
    return new Promise((resolve, reject) => {
      this.emit('log', { type: 'info', msg: `Connecting to OTP WebSocket...` });
      this.ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => reject(new Error('OTP WS timeout (15s)')), 15000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.isConnected = true;
        this.isAuthorized = true;
        this.startPing();

        const authObj = {
          loginid: this.accountId,
          balance: this.balance,
          currency: this.currency,
          is_virtual: isDemo ? 1 : 0
        };

        this.emit('authorized', authObj);
        this.emit('balanceUpdate', { balance: this.balance, currency: this.currency });
        this.emit('log', {
          type: 'success',
          msg: `✅ Connected & Authorized: ${this.accountId} (${isDemo ? 'Demo' : 'Real'}) | Balance: ${this.currency} ${this.balance.toFixed(2)}`
        });

        this.send({ balance: 1, subscribe: 1 }).catch(() => {});
        this.subscribeOpenContract().catch(() => {});
        resolve({ connected: true, authorized: true });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleMessage(msg);
        } catch(e) {}
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        this.isConnected = false;
        reject(new Error('OTP WS connection error'));
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isAuthorized = false;
        this._isSubscribedToOpenContracts = false;
        this.stopPing();
        this.emit('disconnected', {});

        if (this.token && !this._manualDisconnect) {
          this.emit('log', { type: 'warning', msg: '⚡ Disconnected from Deriv. Auto-reconnecting in 2 seconds...' });
          setTimeout(() => {
            if (!this.isConnected && this.token) {
              this.connect(this.appId, this.token).catch(err => {
                this.emit('log', { type: 'error', msg: `Auto-reconnect failed: ${err.message}` });
              });
            }
          }, 2000);
        }
      };
    });
  }

  // ── Standard WS Flow ───────────────────────────────────────────
  connectStandardWS() {
    const cleanAppId = (this.appId && !isNaN(this.appId)) ? this.appId : '1089';
    const url = `wss://ws.binaryws.com/websockets/v3?app_id=${cleanAppId}`;
    this.emit('log', { type: 'info', msg: `Connecting to Standard WS (${url})...` });

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      const timeout = setTimeout(() => reject(new Error('WS connection timed out (15s)')), 15000);

      this.ws.onopen = () => {
        clearTimeout(timeout);
        this.isConnected = true;
        this.startPing();
        this.emit('log', { type: 'info', msg: 'WebSocket connected. Authorizing Token...' });

        this.send({ authorize: this.token }).then(res => {
          if (res.error) {
            throw new Error(`[${res.error.code || 'AUTH_ERR'}]: ${res.error.message || 'Auth failed'}`);
          }

          this.isAuthorized = true;
          this.accountId = res.authorize.loginid;
          this.balance = parseFloat(res.authorize.balance || 0);
          this.currency = res.authorize.currency || 'USD';
          const isDemo = res.authorize.is_virtual === 1;

          this.emit('authorized', res.authorize);
          this.emit('balanceUpdate', { balance: this.balance, currency: this.currency });
          this.emit('log', {
            type: 'success',
            msg: `✅ Authorized: ${this.accountId} (${isDemo ? 'Demo' : 'Real'}) | Balance: ${this.currency} ${this.balance.toFixed(2)}`
          });

          this.send({ balance: 1, subscribe: 1 }).catch(() => {});
          this.subscribeOpenContract().catch(() => {});
          resolve({ connected: true, authorized: true });
        }).catch(err => {
          this.emit('log', { type: 'error', msg: `Auth Failed: ${err.message}` });
          reject(err);
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleMessage(msg);
        } catch(e) {}
      };

      this.ws.onerror = () => {
        clearTimeout(timeout);
        this.isConnected = false;
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isAuthorized = false;
        this._isSubscribedToOpenContracts = false;
        this.stopPing();
        this.emit('disconnected', {});

        if (this.token && !this._manualDisconnect) {
          this.emit('log', { type: 'warning', msg: '⚡ Disconnected from Deriv. Auto-reconnecting in 2 seconds...' });
          setTimeout(() => {
            if (!this.isConnected && this.token) {
              this.connect(this.appId, this.token).catch(err => {
                this.emit('log', { type: 'error', msg: `Auto-reconnect failed: ${err.message}` });
              });
            }
          }, 2000);
        }
      };
    });
  }

  // ── Message Handler ────────────────────────────────────────────
  _handleMessage(msg) {
    const reqId = msg.req_id;

    if (reqId && this.callbacks.has(reqId)) {
      const { resolve, reject } = this.callbacks.get(reqId);
      this.callbacks.delete(reqId);
      if (msg.error) {
        reject(msg.error);
      } else {
        resolve(msg);
      }
    }

    switch (msg.msg_type) {
      case 'balance':
        if (msg.balance) {
          this.balance = parseFloat(msg.balance.balance);
          this.currency = msg.balance.currency;
          this.emit('balanceUpdate', { balance: this.balance, currency: this.currency });
        }
        break;

      case 'tick':
        if (msg.tick) this.emit('tick', msg.tick);
        break;

      case 'proposal':
        if (msg.proposal) {
          this.emit('proposal', {
            ...msg.proposal,
            echo_req: msg.echo_req
          });
        }
        break;

      case 'buy':
        if (msg.buy) {
          this.emit('buy', {
            ...msg.buy,
            echo_req: msg.echo_req
          });
        }
        break;

      case 'proposal_open_contract':
        if (msg.proposal_open_contract) {
          const poc = msg.proposal_open_contract;
          const cidStr = String(poc.contract_id);
          const isSold = Boolean(poc.is_sold || poc.status !== 'open');

          let ticks = 0;
          const p = parseFloat(poc.profit || 0);
          const s = parseFloat(poc.buy_price || poc.stake || 1.0);
          const g = parseFloat(poc.growth_rate || 0.05);
          if (p > 0 && s > 0 && g > 0) {
            ticks = Math.round(Math.log((p + s) / s) / Math.log(1 + g));
          }
          if (poc.tick_stream && Array.isArray(poc.tick_stream)) {
            const stTicks = Math.max(0, poc.tick_stream.length - 1);
            if (stTicks > ticks) ticks = stTicks;
          }
          if (poc.tick_passed !== undefined && poc.tick_passed !== null) {
            const tp = parseInt(poc.tick_passed, 10) || 0;
            if (tp > ticks) ticks = tp;
          }

          const data = {
            contract_id: poc.contract_id,
            is_sold: isSold,
            profit: p,
            status: poc.status,
            tick_passed: ticks,
            ticks: ticks,
            growth_rate: g,
            stake: s,
            is_valid_to_sell: Boolean(poc.is_valid_to_sell)
          };

          this.openContractsCache.set(cidStr, data);
          this.openContractsCache.set(poc.contract_id, data);

          this.emit('proposalOpenContract', poc);
          this.emit('contractUpdate', poc);
        }
        break;

      case 'sell':
        if (msg.sell) {
          this.emit('sell', {
            ...msg.sell,
            echo_req: msg.echo_req
          });
        }
        break;
    }
  }

  // ── Send ───────────────────────────────────────────────────────
  send(payload) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected'));
      }
      const reqId = this.reqIdCounter++;
      const data = { ...payload, req_id: reqId };
      this.callbacks.set(reqId, { resolve, reject });
      this.ws.send(JSON.stringify(data));

      setTimeout(() => {
        if (this.callbacks.has(reqId)) {
          this.callbacks.delete(reqId);
          reject(new Error(`Request timeout req_id:${reqId}`));
        }
      }, 12000);
    });
  }

  // ── Subscribe Ticks ────────────────────────────────────────────
  async subscribeTicks(symbol) {
    if (this._tickSubIds[symbol]) return;
    try {
      const res = await this.send({ ticks: symbol, subscribe: 1 });
      if (res && res.subscription) this._tickSubIds[symbol] = res.subscription.id;
    } catch(e) {}
  }

  // ── Bot Interface ──────────────────────────────────────────────
  async buy(contractType, amount, duration, unit, prediction, symbol) {
    let cleanType = contractType;
    let barrier = null;

    if (prediction !== undefined && prediction !== null && prediction !== '') {
      barrier = prediction.toString().trim();
    }

    if (barrier !== null && (cleanType === 'CALL' || cleanType === 'PUT' || cleanType === 'HIGHER' || cleanType === 'LOWER' || cleanType === 'RISE' || cleanType === 'FALL')) {
      if (cleanType === 'RISE' || cleanType === 'CALL' || cleanType === 'HIGHER') {
        cleanType = 'HIGHER';
        if (!barrier.startsWith('+') && !barrier.startsWith('-')) barrier = '+' + barrier;
        else if (barrier.startsWith('-')) barrier = '+' + barrier.substring(1);
      } else if (cleanType === 'FALL' || cleanType === 'PUT' || cleanType === 'LOWER') {
        cleanType = 'LOWER';
        if (!barrier.startsWith('+') && !barrier.startsWith('-')) barrier = '-' + barrier;
        else if (barrier.startsWith('+')) barrier = '-' + barrier.substring(1);
      }
    } else {
      if (cleanType === 'RISE' || cleanType === 'HIGHER') cleanType = 'CALL';
      if (cleanType === 'FALL' || cleanType === 'LOWER') cleanType = 'PUT';
    }

    const cleanSymbol = symbol || 'R_100';
    let dur = parseInt(duration) || 1;
    let durUnit = unit || 't';
    if ((cleanType === 'HIGHER' || cleanType === 'LOWER') && durUnit === 't' && dur < 5) {
      dur = 5;
    }

    const req = {
      proposal: 1,
      contract_type: cleanType,
      currency: this.currency || 'USD',
      duration: dur,
      duration_unit: durUnit,
      basis: 'stake',
      amount: parseFloat(parseFloat(amount).toFixed(2))
    };

    if (this.token && this.token.startsWith('pat_')) {
      req.underlying_symbol = cleanSymbol;
    } else {
      req.symbol = cleanSymbol;
    }

    if (barrier !== null) {
      if (cleanType === 'DIGITOVER' || cleanType === 'DIGITUNDER' || cleanType === 'DIGITMATCH') {
        req.barrier = barrier;
      } else if (cleanType === 'DIGITDIFF') {
        req.last_digit_prediction = parseInt(barrier);
      } else {
        req.barrier = barrier;
      }
    }

    let propRes;
    try {
      propRes = await this.send(req);
    } catch (err) {
      const msg = err && (err.message || err.code || (typeof err === 'object' ? JSON.stringify(err) : err));
      throw new Error(`Proposal Error: ${msg}`);
    }

    if (propRes.error) throw new Error(propRes.error.message || propRes.error.code);
    if (!propRes.proposal) throw new Error('Proposal not received');

    const askPrice = (propRes.proposal && propRes.proposal.ask_price) ? parseFloat(propRes.proposal.ask_price) : parseFloat(amount);
    let buyRes;
    try {
      buyRes = await this.send({ buy: propRes.proposal.id, price: askPrice });
    } catch (err) {
      const msg = err && (err.message || err.code || (typeof err === 'object' ? JSON.stringify(err) : err));
      throw new Error(`Buy Error: ${msg}`);
    }

    if (buyRes.error) throw new Error(buyRes.error.message || buyRes.error.code);
    const cid = buyRes.buy.contract_id;
    // Initialize cache immediately so checkContract never returns null or polls
    this.openContractsCache.set(cid, { is_sold: false, profit: 0, status: 'open' });
    this.subscribeOpenContract().catch(() => {});
    return { contract_id: cid };
  }

  // ── Sell Contract (Accumulator cashout) ───────────────────────────
  async sellContract(contractId) {
    if (!contractId) return null;
    const cidNum = parseInt(contractId, 10);
    console.log(`[DerivWS] >>> CALLING DERIV SELL for Contract #${cidNum} <<<`);
    try {
      const res = await this.send({ sell: cidNum, price: 0 });
      console.log(`[DerivWS] Deriv SELL confirmation for #${cidNum}:`, res);
      if (res && res.sell) {
        const key = String(cidNum);
        const cached = this.openContractsCache.get(key) || {};
        const updated = {
          ...cached,
          is_sold: true,
          status: 'sold'
        };
        this.openContractsCache.set(key, updated);
        this.openContractsCache.set(cidNum, updated);
      }
      return res;
    } catch (err) {
      console.warn(`[DerivWS] Sell notice for #${cidNum}:`, err.message || err);
      throw err;
    }
  }

  // ── Accumulator Proposal / Market Stats Check ─────────────────
  async getAccumulatorProposal(symbol, stake = 1, growthRate = 0.05) {
    if (!this.isConnected) return null;
    const cleanSymbol = (symbol || this.activeSymbol || 'R_100').trim();
    const rate = parseFloat(growthRate) || 0.05;
    const amount = parseFloat(stake) || 1.0;

    const propReq = {
      proposal: 1,
      amount: amount,
      basis: 'stake',
      contract_type: 'ACCU',
      currency: this.currency || 'USD',
      growth_rate: rate
    };
    if (this.token && this.token.startsWith('pat_')) {
      propReq.underlying_symbol = cleanSymbol;
    } else {
      propReq.symbol = cleanSymbol;
    }

    try {
      const res = await this.send(propReq);
      if (res && res.proposal) {
        const details = res.proposal.contract_details || {};
        const ticksStayedIn = details.ticks_stayed_in || res.proposal.ticks_stayed_in || [];
        const currentTicks = ticksStayedIn.length > 0 ? ticksStayedIn[ticksStayedIn.length - 1] : 0;
        return {
          id: res.proposal.id,
          ask_price: res.proposal.ask_price,
          spot: res.proposal.spot,
          current_ticks: currentTicks,
          ticks_stayed_in: ticksStayedIn
        };
      }
    } catch (err) {
      // Ignore transient errors
    }
    return null;
  }

  // ── Accumulator Direct Buy ──────────────────────────────────────
  async buyAccumulator(symbol, stake, growthRate) {
    const cleanSymbol = symbol || this.activeSymbol || 'R_100';
    const rate = parseFloat(growthRate) || 0.05;
    const amount = parseFloat(parseFloat(stake).toFixed(2)) || 1.0;

    const req = {
      buy: 1,
      price: amount,
      parameters: {
        amount: amount,
        basis: 'stake',
        contract_type: 'ACCU',
        currency: this.currency || 'USD',
        growth_rate: rate
      }
    };
    if (this.token && this.token.startsWith('pat_')) {
      req.parameters.underlying_symbol = cleanSymbol;
    } else {
      req.parameters.symbol = cleanSymbol;
    }

    let buyRes;
    try {
      buyRes = await this.send(req);
    } catch(directErr) {
      // Fallback: 2-step Proposal -> Buy
      const propReq = {
        proposal: 1,
        amount: amount,
        basis: 'stake',
        contract_type: 'ACCU',
        currency: this.currency || 'USD',
        growth_rate: rate
      };
      if (this.token && this.token.startsWith('pat_')) propReq.underlying_symbol = cleanSymbol;
      else propReq.symbol = cleanSymbol;

      const propRes = await this.send(propReq);
      if (propRes.error) throw new Error(propRes.error.message || 'Accumulator proposal error');
      if (!propRes.proposal) throw new Error('Accumulator proposal missing');
      buyRes = await this.send({ buy: propRes.proposal.id, price: amount });
    }

    if (buyRes.error) throw new Error(buyRes.error.message || 'Accumulator buy error');
    const cid = buyRes.buy.contract_id;

    // Cache initial state
    this.openContractsCache.set(cid, {
      is_sold: false,
      profit: 0,
      status: 'open',
      tick_passed: 0,
      is_valid_to_sell: false
    });

    // Auto-subscribe to stream updates
    this.subscribeOpenContract().catch(() => {});
    return { contract_id: cid };
  }


  // ── Exact methods from derivWS.js for AccumulatorBotEngine ──────
  buyAccumulatorDirect({ symbol, stake, growthRate, currency = 'USD' }) {
    let cleanSymbol = (symbol || 'R_100').trim();
    const rate = parseFloat(growthRate) || 0.05;
    const amount = parseFloat(stake) || 1.0;
    const curr = currency || this.currency || 'USD';

    const buildReq = (sym) => ({
      buy: 1,
      price: amount,
      parameters: {
        amount: amount,
        basis: 'stake',
        contract_type: 'ACCU',
        currency: curr,
        underlying_symbol: sym,
        growth_rate: rate
      }
    });

    return this.send(buildReq(cleanSymbol)).catch(err => {
      if (cleanSymbol === 'BOOM300') return this.send(buildReq('BOOM300N'));
      if (cleanSymbol === 'BOOM300N') return this.send(buildReq('BOOM300'));
      if (cleanSymbol === 'CRASH300') return this.send(buildReq('CRASH300N'));
      if (cleanSymbol === 'CRASH300N') return this.send(buildReq('CRASH300'));
      throw err;
    });
  }

  buyContract(proposalId, price) {
    return this.send({
      buy: proposalId,
      price: parseFloat(price)
    });
  }

  requestAccumulatorProposal({ symbol, stake, growthRate, currency = 'USD' }) {
    let cleanSymbol = (symbol || 'R_100').trim();
    const rate = parseFloat(growthRate) || 0.05;
    const amount = parseFloat(stake) || 1.0;
    const curr = currency || this.currency || 'USD';

    const buildReq = (sym) => ({
      proposal: 1,
      amount: amount,
      basis: 'stake',
      contract_type: 'ACCU',
      currency: curr,
      underlying_symbol: sym,
      growth_rate: rate
    });

    return this.send(buildReq(cleanSymbol)).catch(err => {
      if (cleanSymbol === 'BOOM300') return this.send(buildReq('BOOM300N'));
      if (cleanSymbol === 'BOOM300N') return this.send(buildReq('BOOM300'));
      if (cleanSymbol === 'CRASH300') return this.send(buildReq('CRASH300N'));
      if (cleanSymbol === 'CRASH300N') return this.send(buildReq('CRASH300'));
      throw err;
    });
  }

  unsubscribeOpenContract(contractId) {
    // Handled automatically by global proposal_open_contract stream
  }

  forgetAllSubscriptions() {
    return this.send({ forget_all: 'proposal' }).catch(() => {});
  }

  getPortfolio() {
    return this.send({ portfolio: 1 });
  }

  async checkContract(contractId) {
    if (!contractId) return null;

    // Zero API calls: Read from push stream cache (eliminates rate limit completely)
    if (this.openContractsCache.has(contractId)) {
      const cached = this.openContractsCache.get(contractId);
      if (cached && cached.is_sold) {
        // Retain briefly so multiple checks can read the exit, then delete
        setTimeout(() => this.openContractsCache.delete(contractId), 10000);
      }
      return cached;
    }

    // Default open state while awaiting Deriv push event
    return { is_sold: false, profit: 0, status: 'open' };
  }

  // ── Ping / Disconnect ──────────────────────────────────────────
  startPing() {
    this.stopPing();
    this.pingInterval = setInterval(() => {
      if (this.isConnected) this.send({ ping: 1 }).catch(() => {});
    }, 10000);
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  disconnect() {
    this.stopPing();
    if (this.ws) this.ws.close();
  }
}

window.DerivBrowserClient = DerivBrowserClient;
