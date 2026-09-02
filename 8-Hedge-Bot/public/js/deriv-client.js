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
  }

  // ── Event Emitter ──────────────────────────────────────────────
  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }
  emit(event, data) {
    (this.listeners[event] || []).forEach(fn => { try { fn(data); } catch(e) {} });
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
      case 'proposal_open_contract':
        if (msg.proposal_open_contract) {
          this.emit('contractUpdate', msg.proposal_open_contract);
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
    if (contractType === 'RISE' || contractType === 'HIGHER') contractType = 'CALL';
    if (contractType === 'FALL' || contractType === 'LOWER') contractType = 'PUT';

    const cleanSymbol = symbol || 'R_100';
    const req = {
      proposal: 1,
      contract_type: contractType,
      currency: this.currency || 'USD',
      duration: parseInt(duration) || 1,
      duration_unit: unit || 't',
      basis: 'stake',
      amount: parseFloat(parseFloat(amount).toFixed(2))
    };

    // REST OTP WebSocket API expects 'underlying_symbol', Standard WS expects 'symbol'
    if (this.token && this.token.startsWith('pat_')) {
      req.underlying_symbol = cleanSymbol;
    } else {
      req.symbol = cleanSymbol;
    }

    if (prediction !== undefined && prediction !== null && prediction !== '') {
      if (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER' || contractType === 'DIGITMATCH') {
        req.barrier = prediction.toString();
      } else if (contractType === 'DIGITDIFF') {
        req.last_digit_prediction = parseInt(prediction);
      } else if (!contractType.startsWith('DIGIT')) {
        req.barrier = prediction.toString();
      }
    }

    const propRes = await this.send(req);
    if (propRes.error) throw new Error(propRes.error.message || propRes.error.code);
    if (!propRes.proposal) throw new Error('Proposal not received');

    const buyRes = await this.send({ buy: propRes.proposal.id, price: parseFloat(amount) });
    if (buyRes.error) throw new Error(buyRes.error.message || buyRes.error.code);

    return { contract_id: buyRes.buy.contract_id };
  }

  async checkContract(contractId) {
    const res = await this.send({ proposal_open_contract: 1, contract_id: contractId });
    if (res.error) return null;
    const poc = res.proposal_open_contract;
    if (!poc) return null;
    return {
      is_sold: poc.is_sold,
      profit: poc.profit,
      status: poc.status
    };
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
