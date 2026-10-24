class SubStrategy {
    constructor(id, config) {
        this.id = id;
        this.name = config.name;
        this.bot = null;
        this.isRunning = false;

        // Limits
        this.tradeCount = 0;
        this.maxTrades = 100;

        // Strategy Parameters
        this.martingaleStakes = config.stakes;
        this.baseStake = this.martingaleStakes[0];
        this.stake = this.baseStake;
        this.martingaleLevel = 0;
        this.maxMartingaleLevel = this.martingaleStakes.length - 1;

        // Trade Config
        this.contractType = config.type;
        this.prediction = config.prediction;
        this.duration = config.duration || 1;
        this.durationUnit = 't';

        // State
        this.lastContractId = null;
        this.waitingForExit = false;
        this.sessionProfit = 0;
        this.takeProfit = config.takeProfit || 100;
        this.stopLoss = config.stopLoss || -10;
        this.triggerDigit = config.triggerDigit !== undefined ? config.triggerDigit : 5;
        this.triggerOperator = config.triggerOperator || '=';
        this.symbol = config.symbol || 'R_10';

        // Rate Limiting
        this.minInterval = 500;
        this.lastTradeTime = 0;

        this.isCheckingExit = false;
        this.processedContracts = new Set();

    }

    onStart(bot) {
        this.bot = bot;
        console.log(`[Bot ${this.id}] ${this.name} Loaded. Trigger: ${this.triggerOperator} ${this.triggerDigit}`);
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.resetSession();
            console.log(`[Bot ${this.id}] STARTED.`);
        }
    }

    stop() {
        this.isRunning = false;
        console.log(`[Bot ${this.id}] STOPPED.`);
    }

    resetSession() {
        this.tradeCount = 0;
        this.stake = this.baseStake;
        this.martingaleLevel = 0;
        this.lastContractId = null;
        this.waitingForExit = false;
        this.sessionProfit = 0;
        this.processedContracts.clear();
    }

    async onTick(tick, now) {
        if (!this.isRunning) return;
        if (tick.symbol && (tick.symbol !== this.symbol)) return;

        if (this.lastContractId && this.waitingForExit) {
            if (this.isCheckingExit) return;
            if (this.processedContracts.has(this.lastContractId)) {
                this.lastContractId = null;
                this.waitingForExit = false;
                return;
            }

            this.isCheckingExit = true;
            try {
                const contract = await this.bot.checkContract(this.lastContractId);
                if (contract && contract.is_sold) {
                    const cid = this.lastContractId;
                    if (this.processedContracts.has(cid)) return;
                    this.processedContracts.add(cid);

                    const profit = parseFloat(contract.profit);
                    this.sessionProfit += profit;
                    console.log(`[Bot ${this.id}] Trade ID: ${cid} | Profit: $${profit.toFixed(2)} | Total: $${this.sessionProfit.toFixed(2)}`);

                    // Target profit/loss limits removed - runs unlimited

                    if (profit > 0) {
                        this.martingaleLevel = 0;
                        this.stake = this.baseStake;
                    } else {
                        this.martingaleLevel++;
                        if (this.martingaleLevel > this.maxMartingaleLevel) this.martingaleLevel = 0;
                        let nextStake = this.martingaleStakes[this.martingaleLevel];
                        if (nextStake === undefined || nextStake === null || isNaN(nextStake)) {
                            this.stake = this.baseStake;
                        } else {
                            this.stake = nextStake;
                        }
                    }
                    this.lastContractId = null;
                    this.waitingForExit = false;
                    this.lastTradeTime = now;
                }
            } catch (e) {
                console.error(`[Bot ${this.id}] Error:`, e.message);
            } finally {
                this.isCheckingExit = false;
            }
            return;
        }

        // Parse Digit & Trigger
        const quoteStr = Number(tick.quote).toFixed(2);
        const currentDigit = parseInt(quoteStr.slice(-1));

        if (now - this.lastTradeTime < this.minInterval) return;
        if (this.waitingForExit) return;

        let triggered = false;
        if (this.triggerOperator === '>') triggered = currentDigit > this.triggerDigit;
        else if (this.triggerOperator === '<') triggered = currentDigit < this.triggerDigit;
        else triggered = currentDigit === this.triggerDigit;

        if (triggered) {
            console.log(`[Bot ${this.id}] Trigger Met: Digit ${currentDigit} ${this.triggerOperator} ${this.triggerDigit}`);
            this.executeTrade(now);
        }
    }

    async executeTrade(now) {
        this.tradeCount++;
        this.waitingForExit = true;
        this.lastTradeTime = now;
        try {
            const trade = await this.bot.buy(this.contractType, this.stake, this.duration, this.durationUnit, this.prediction, this.symbol);
            if (trade && trade.contract_id) {
                this.lastContractId = trade.contract_id;
            } else {
                this.waitingForExit = false;
            }
        } catch (e) {
            console.error(`[Bot ${this.id}] Buy Failed:`, e.message || e);
            this.waitingForExit = false;
        }
    }
}

class OddEvenPatternBot {
    constructor(id, config) {
        this.id = id;
        this.name = config.name;
        this.bot = null;
        this.isRunning = false;

        this.symbol = config.symbol || 'R_10';
        this.stake = config.stake || 0.35;
        this.duration = config.duration || 1;
        this.durationUnit = 't';

        this.sessionProfit = 0;
        this.tradeCount = 0;
        this.totalStake = 0;
        this.maxTotalStake = config.maxTotalStake || 9.5;
        this.minInterval = config.interval || 600;

        // Pattern and State
        this.tradePattern = config.pattern || [];
        this.tradeIndex = 0;
        this.isRandom = config.isRandom !== undefined ? config.isRandom : true;

        this.pendingContracts = new Set();
        this.isTrading = false;
        this.loop = null;
        this.isCheckingExit = false;
        this.processedContracts = new Set();

        this.takeProfit = config.takeProfit || 100;
        this.stopLoss = config.stopLoss || -10;
        this.profit = 0;
    }

    onStart(bot) {
        this.bot = bot;
        console.log(`[Bot ${this.id}] ${this.name} Loaded`);
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.resetSession();
            console.log(`[Bot ${this.id}] STARTED.`);
            this.startLoop();
        }
    }

    stop() {
        this.isRunning = false;
        if (this.loop) clearInterval(this.loop);
        this.loop = null;
        console.log(`[Bot ${this.id}] STOPPED.`);
    }

    resetSession() {
        this.tradeCount = 0;
        this.sessionProfit = 0;
        this.profit = 0;
        this.totalStake = 0;
        this.pendingContracts = new Set();
        this.tradeIndex = 0;
        this.processedContracts.clear();
        this.isTrading = false;
    }

    startLoop() {
        console.log(`🚀 [Bot ${this.id}] Starting DIGIT EVEN/ODD trades...`);
        this.loop = setInterval(() => {
            if (this.isRunning) this.executeTrade();
        }, this.minInterval);
    }

    async onTick(tick, now) {
        if (!this.isRunning && this.pendingContracts.size === 0) return;
        if (tick.symbol && tick.symbol !== this.symbol) return;
        if (this.isCheckingExit || this.pendingContracts.size === 0) return;

        this.isCheckingExit = true;
        try {
            const contracts = Array.from(this.pendingContracts);
            for (const cid of contracts) {
                if (this.processedContracts.has(cid)) {
                    this.pendingContracts.delete(cid);
                    continue;
                }

                const c = await this.bot.checkContract(cid);
                if (c && c.is_sold) {
                    if (this.processedContracts.has(cid)) {
                        this.pendingContracts.delete(cid);
                        continue;
                    }
                    this.processedContracts.add(cid);
                    this.pendingContracts.delete(cid);

                    const p = parseFloat(c.profit);
                    this.sessionProfit += p;
                    this.profit = this.sessionProfit;

                    const result = p >= 0 ? "✅ PROFIT" : "❌ LOSS";
                    console.log(`🎯 [Bot ${this.id}] Trade ID: ${cid} → ${result} (${p.toFixed(2)} USD)`);

                    // Release active stake so trading runs unlimited
                    this.totalStake = Math.max(0, this.totalStake - this.stake);
                    // Unlimited: no auto-stop on stake or profit limits
                }
            }
        } catch (e) {
            if (!e.message || !e.message.includes('rate limit')) console.error(`[Bot ${this.id}] Error in Tick:`, e.message || e);
        } finally {
            this.isCheckingExit = false;
        }
    }

    async executeTrade() {
        if (!this.isRunning || this.isTrading) return;

        this.isTrading = true;

        // Manual timeout for isTrading to match logic
        setTimeout(() => { this.isTrading = false; }, this.minInterval);

        // Decision Logic
        let tradeType;
        if (this.isRandom || this.tradePattern.length === 0) {
            tradeType = Math.random() < 0.5 ? "DIGITEVEN" : "DIGITODD";
        } else {
            tradeType = this.tradePattern[this.tradeIndex % this.tradePattern.length];
        }

        console.log(`🎯 [Bot ${this.id}] Next Trade → ${tradeType}${this.isRandom ? " (Random)" : " (Pattern)"}`);

        try {
            const t = await this.bot.buy(tradeType, this.stake, this.duration, this.durationUnit, undefined, this.symbol);
            if (t && t.contract_id) {
                this.pendingContracts.add(t.contract_id);
                this.totalStake += this.stake;
                this.tradeCount++;
                this.tradeIndex++;
                console.log(`💰 [Bot ${this.id}] Trade Executed: ${tradeType} (ID: ${t.contract_id})`);
                console.log(`💵 [Bot ${this.id}] Total Stake: ${this.totalStake.toFixed(2)} / ${this.maxTotalStake}`);
            }
        } catch (e) {
            console.error(`[Bot ${this.id}] Buy Error:`, e.message || JSON.stringify(e));
        }
    }
}

class OverUnderPatternBot {
    constructor(id, config) {
        this.id = id;
        this.name = config.name;
        this.bot = null;
        this.isRunning = false;

        this.symbol = config.symbol || 'R_10';
        this.stake = config.stake || 0.35;
        this.duration = config.duration || 1;
        this.durationUnit = 't';

        this.sessionProfit = 0;
        this.tradeCount = 0;
        this.totalStake = 0;
        this.maxTotalStake = config.maxTotalStake || 9.5;
        this.minInterval = config.interval || 600;

        // Pattern and State
        this.tradePattern = config.pattern || [];
        this.tradeIndex = 0;
        this.barrier = config.barrier !== undefined ? parseInt(config.barrier) : 5;

        this.takeProfit = config.takeProfit || 100;
        this.stopLoss = config.stopLoss || -10;

        this.pendingContracts = new Set();
        this.isTrading = false;
        this.loop = null;
        this.isCheckingExit = false;
        this.processedContracts = new Set();
        this.openContractsInfo = new Map();
        this.profit = 0;
    }

    onStart(bot) {
        this.bot = bot;
        console.log(`[Bot ${this.id}] ${this.name} Loaded`);
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.resetSession();
            console.log(`[Bot ${this.id}] STARTED.`);
            this.startLoop();
        }
    }

    stop() {
        this.isRunning = false;
        if (this.loop) clearInterval(this.loop);
        this.loop = null;
        console.log(`[Bot ${this.id}] STOPPED.`);
    }

    resetSession() {
        this.tradeCount = 0;
        this.sessionProfit = 0;
        this.profit = 0;
        this.totalStake = 0;
        this.pendingContracts = new Set();
        this.tradeIndex = 0;
        this.processedContracts.clear();
        this.isTrading = false;
        this.openContractsInfo.clear();
    }

    startLoop() {
        console.log(`🚀 [Bot ${this.id}] Starting OVER/UNDER trades...`);
        this.loop = setInterval(() => {
            if (this.isRunning) this.executeTrade();
        }, this.minInterval);
    }

    async onTick(tick, now) {
        if (!this.isRunning && this.pendingContracts.size === 0) return;
        if (tick.symbol && tick.symbol !== this.symbol) return;
        if (this.isCheckingExit || this.pendingContracts.size === 0) return;

        this.isCheckingExit = true;
        try {
            const contracts = Array.from(this.pendingContracts);
            for (const cid of contracts) {
                if (this.processedContracts.has(cid)) {
                    this.pendingContracts.delete(cid);
                    continue;
                }

                const c = await this.bot.checkContract(cid);
                if (c && c.is_sold) {
                    if (this.processedContracts.has(cid)) {
                        this.pendingContracts.delete(cid);
                        continue;
                    }
                    this.processedContracts.add(cid);
                    this.pendingContracts.delete(cid);

                    const info = this.openContractsInfo.get(cid) || { type: 'UNKNOWN', barrier: '?' };
                    this.openContractsInfo.delete(cid);

                    const p = parseFloat(c.profit);
                    this.sessionProfit += p;
                    this.profit = this.sessionProfit;

                    const result = p >= 0 ? "✅ PROFIT" : "❌ LOSS";
                    console.log(`🎯 [Bot ${this.id}] ${info.type} ${info.barrier} → ${result} (${p.toFixed(2)} USD)`);

                    // Release active stake so trading runs unlimited
                    this.totalStake = Math.max(0, this.totalStake - this.stake);
                    // Unlimited: no auto-stop on stake or profit limits
                }
            }
        } catch (e) {
            if (!e.message || !e.message.includes('rate limit')) console.error(`[Bot ${this.id}] Error in Tick:`, e.message || e);
        } finally {
            this.isCheckingExit = false;
        }
    }

    async executeTrade() {
        if (!this.isRunning || this.isTrading) return;

        this.isTrading = true;
        setTimeout(() => { this.isTrading = false; }, this.minInterval);

        // Barrier Logic
        let currentBarrier = this.barrier;
        let isRandomBarrier = false;
        if (isNaN(currentBarrier) || currentBarrier === null) {
            currentBarrier = Math.floor(Math.random() * 8) + 1;
            isRandomBarrier = true;
        }

        // Trade Type Logic
        let tradeTypes = [];
        if (this.tradePattern && this.tradePattern.length > 0) {
            const type = this.tradePattern[this.tradeIndex % this.tradePattern.length];
            tradeTypes.push(type === "UNDER" ? "DIGITUNDER" : "DIGITOVER");
        } else {
            tradeTypes = ["DIGITOVER", "DIGITUNDER"];
        }

        console.log(`🎯 [Bot ${this.id}] turn ${this.tradeIndex + 1} | Barrier: ${currentBarrier}${isRandomBarrier ? " (Random)" : ""} | Mode: ${tradeTypes.length > 1 ? "BOTH" : tradeTypes[0]}`);

        for (const contractType of tradeTypes) {
            // Unlimited stake
            try {
                const t = await this.bot.buy(contractType, this.stake, this.duration, this.durationUnit, currentBarrier, this.symbol);
                if (t && t.contract_id) {
                    this.pendingContracts.add(t.contract_id);
                    this.openContractsInfo.set(t.contract_id, {
                        type: contractType === "DIGITOVER" ? "OVER" : "UNDER",
                        barrier: currentBarrier
                    });
                    this.totalStake += this.stake;
                    this.tradeCount++;
                    console.log(`💰 [Bot ${this.id}] Trade Executed: ${contractType} ${currentBarrier} (ID: ${t.contract_id})`);
                }
            } catch (e) {
                console.error(`[Bot ${this.id}] Buy Failed:`, e.message || e);
            }
        }

        this.tradeIndex++;
        console.log(`💵 [Bot ${this.id}] Total Stake: ${this.totalStake.toFixed(2)} / ${this.maxTotalStake}`);
    }
}

class HigherLowerPatternBot {
    constructor(id, config) {
        this.id = id;
        this.name = config.name;
        this.bot = null;
        this.isRunning = false;

        this.symbol = config.symbol || 'R_10';
        this.stake = config.stake || 0.35;
        this.duration = config.duration || 5;
        this.durationUnit = 't';

        this.sessionProfit = 0;
        this.tradeCount = 0;
        this.totalStake = 0;
        this.maxTotalStake = config.maxTotalStake || 9.5;
        this.minInterval = config.interval || 2000;

        // Pattern and State
        this.tradePattern = config.pattern || [];
        this.tradeIndex = 0;
        this.barrier = config.barrier || '+1';

        this.takeProfit = config.takeProfit || 100;
        this.stopLoss = config.stopLoss || -10;

        this.pendingContracts = new Set();
        this.isTrading = false;
        this.loop = null;
        this.isCheckingExit = false;
        this.processedContracts = new Set();
        this.openContractsInfo = new Map();
        this.profit = 0;
    }

    onStart(bot) {
        this.bot = bot;
        console.log(`[Bot ${this.id}] ${this.name} Loaded`);
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.resetSession();
            console.log(`[Bot ${this.id}] STARTED.`);
            this.startLoop();
        }
    }

    stop() {
        this.isRunning = false;
        if (this.loop) clearInterval(this.loop);
        this.loop = null;
        console.log(`[Bot ${this.id}] STOPPED.`);
    }

    resetSession() {
        this.tradeCount = 0;
        this.sessionProfit = 0;
        this.profit = 0;
        this.totalStake = 0;
        this.pendingContracts = new Set();
        this.tradeIndex = 0;
        this.processedContracts.clear();
        this.isTrading = false;
        this.openContractsInfo.clear();
    }

    startLoop() {
        console.log(`🚀 [Bot ${this.id}] Starting HIGHER/LOWER trades...`);
        this.loop = setInterval(() => {
            if (this.isRunning) this.executeTrade();
        }, this.minInterval);
    }

    async onTick(tick, now) {
        if (!this.isRunning && this.pendingContracts.size === 0) return;
        if (tick.symbol && tick.symbol !== this.symbol) return;
        if (this.isCheckingExit || this.pendingContracts.size === 0) return;

        this.isCheckingExit = true;
        try {
            const contracts = Array.from(this.pendingContracts);
            for (const cid of contracts) {
                if (this.processedContracts.has(cid)) {
                    this.pendingContracts.delete(cid);
                    continue;
                }

                const c = await this.bot.checkContract(cid);
                if (c && c.is_sold) {
                    if (this.processedContracts.has(cid)) {
                        this.pendingContracts.delete(cid);
                        continue;
                    }
                    this.processedContracts.add(cid);
                    this.pendingContracts.delete(cid);

                    const info = this.openContractsInfo.get(cid) || { type: 'UNKNOWN', barrier: '?' };
                    this.openContractsInfo.delete(cid);

                    const p = parseFloat(c.profit);
                    this.sessionProfit += p;
                    this.profit = this.sessionProfit;

                    const result = p >= 0 ? "✅ PROFIT" : "❌ LOSS";
                    console.log(`🎯 [Bot ${this.id}] ${info.type} → ${result} (${p.toFixed(2)} USD)`);

                    // Release active stake so trading runs unlimited
                    this.totalStake = Math.max(0, this.totalStake - this.stake);
                    // Unlimited: no auto-stop on stake or profit limits
                }
            }
        } catch (e) {
            if (!e.message || !e.message.includes('rate limit')) console.error(`[Bot ${this.id}] Error in Tick:`, e.message || e);
        } finally {
            this.isCheckingExit = false;
        }
    }

    async executeTrade() {
        if (!this.isRunning || this.isTrading) return;

        this.isTrading = true;
        setTimeout(() => { this.isTrading = false; }, this.minInterval);

        let tradeTypes = [];
        if (this.tradePattern && this.tradePattern.length > 0) {
            const type = this.tradePattern[this.tradeIndex % this.tradePattern.length];
            tradeTypes.push(type === "LOWER" ? "LOWER" : "HIGHER");
        } else {
            tradeTypes = ["HIGHER", "LOWER"];
        }

        console.log(`🎯 [Bot ${this.id}] turn ${this.tradeIndex + 1} | Barrier: ${this.barrier} | Mode: ${tradeTypes.length > 1 ? "BOTH" : tradeTypes[0]}`);

        for (const type of tradeTypes) {
            // Unlimited stake

            const contractType = type;
            const barrierVal = (this.barrier || '1').toString().replace(/^[+-]/, '') || '1';
            const tradeBarrier = (type === 'LOWER') ? `-${barrierVal}` : `+${barrierVal}`;

            try {
                const t = await this.bot.buy(contractType, this.stake, this.duration, this.durationUnit, tradeBarrier, this.symbol);
                if (t && t.contract_id) {
                    this.pendingContracts.add(t.contract_id);
                    this.openContractsInfo.set(t.contract_id, { type, barrier: this.barrier });
                    this.totalStake += this.stake;
                    this.tradeCount++;
                    console.log(`💰 [Bot ${this.id}] Trade Executed: ${type} (ID: ${t.contract_id})`);
                }
            } catch (e) {
                console.error(`[Bot ${this.id}] Buy Failed:`, e.message || e);
            }
        }

        this.tradeIndex++;
        console.log(`💵 [Bot ${this.id}] Total Stake: ${this.totalStake.toFixed(2)} / ${this.maxTotalStake}`);
    }
}

class RiseFallPatternBot {
    constructor(id, config) {
        this.id = id;
        this.name = config.name;
        this.bot = null;
        this.isRunning = false;

        this.symbol = config.symbol || 'R_10';
        this.stake = config.stake || 0.35;
        this.duration = config.duration || 5;
        this.durationUnit = 't';

        this.sessionProfit = 0;
        this.tradeCount = 0;
        this.totalStake = 0;
        this.maxTotalStake = config.maxTotalStake || 9.5;
        this.minInterval = config.interval || 600;

        // Pattern and State
        this.tradePattern = config.pattern || [];
        this.tradeIndex = 0;
        this.isRandom = config.isRandom !== undefined ? config.isRandom : true;

        this.pendingContracts = new Set();
        this.isTrading = false;
        this.loop = null;
        this.isCheckingExit = false;
        this.processedContracts = new Set();

        this.takeProfit = config.takeProfit || 100;
        this.stopLoss = config.stopLoss || -10;
        this.profit = 0;
    }

    onStart(bot) {
        this.bot = bot;
        console.log(`[Bot ${this.id}] ${this.name} Loaded`);
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.resetSession();
            console.log(`[Bot ${this.id}] STARTED.`);
            this.startLoop();
        }
    }

    stop() {
        this.isRunning = false;
        if (this.loop) clearInterval(this.loop);
        this.loop = null;
        console.log(`[Bot ${this.id}] STOPPED.`);
    }

    resetSession() {
        this.tradeCount = 0;
        this.sessionProfit = 0;
        this.profit = 0;
        this.totalStake = 0;
        this.pendingContracts = new Set();
        this.tradeIndex = 0;
        this.processedContracts.clear();
        this.isTrading = false;
    }

    startLoop() {
        console.log(`🚀 [Bot ${this.id}] Starting RISE/FALL trades...`);
        this.loop = setInterval(() => {
            if (this.isRunning) this.executeTrade();
        }, this.minInterval);
    }

    async onTick(tick, now) {
        if (!this.isRunning && this.pendingContracts.size === 0) return;
        if (tick.symbol && tick.symbol !== this.symbol) return;
        if (this.isCheckingExit || this.pendingContracts.size === 0) return;

        this.isCheckingExit = true;
        try {
            const contracts = Array.from(this.pendingContracts);
            for (const cid of contracts) {
                if (this.processedContracts.has(cid)) {
                    this.pendingContracts.delete(cid);
                    continue;
                }

                const c = await this.bot.checkContract(cid);
                if (c && c.is_sold) {
                    if (this.processedContracts.has(cid)) {
                        this.pendingContracts.delete(cid);
                        continue;
                    }
                    this.processedContracts.add(cid);
                    this.pendingContracts.delete(cid);

                    const p = parseFloat(c.profit);
                    this.sessionProfit += p;
                    this.profit = this.sessionProfit;

                    const result = p >= 0 ? "✅ PROFIT" : "❌ LOSS";
                    console.log(`🎯 [Bot ${this.id}] Trade ID: ${cid} → ${result} (${p.toFixed(2)} USD)`);

                    // Release active stake so trading runs unlimited
                    this.totalStake = Math.max(0, this.totalStake - this.stake);
                    // Unlimited: no auto-stop on stake or profit limits
                }
            }
        } catch (e) { } finally {
            this.isCheckingExit = false;
        }
    }

    async executeTrade() {
        if (!this.isRunning || this.isTrading) return;

        this.isTrading = true;

        // Manual timeout for isTrading to match logic
        setTimeout(() => { this.isTrading = false; }, this.minInterval);

        // Decision Logic
        let tradeType;
        if (this.isRandom || this.tradePattern.length === 0) {
            tradeType = Math.random() < 0.5 ? "RISE" : "FALL";
        } else {
            tradeType = this.tradePattern[this.tradeIndex % this.tradePattern.length];
        }

        console.log(`🎯 [Bot ${this.id}] Next Trade → ${tradeType}${this.isRandom ? " (Random)" : " (Pattern)"}`);

        try {
            const t = await this.bot.buy(tradeType, this.stake, this.duration, this.durationUnit, undefined, this.symbol);
            if (t && t.contract_id) {
                this.pendingContracts.add(t.contract_id);
                this.totalStake += this.stake;
                this.tradeCount++;
                this.tradeIndex++;
                console.log(`💰 [Bot ${this.id}] Trade Executed: ${tradeType} (ID: ${t.contract_id})`);
                console.log(`💵 [Bot ${this.id}] Total Stake: ${this.totalStake.toFixed(2)} / ${this.maxTotalStake}`);
            }
        } catch (e) {
            console.error(`[Bot ${this.id}] Buy Error:`, e.message || JSON.stringify(e));
        }
    }
}

class DigitDifferPatternBot {
    constructor(id, config) {
        this.id = id;
        this.name = config.name;
        this.bot = null;
        this.isRunning = false;

        this.symbol = config.symbol || 'R_100';
        this.baseStake = config.stake || 0.35;
        this.stake = this.baseStake;
        this.martingaleStakes = config.stakes || [0.35];
        this.martingaleLevel = 0;
        this.maxMartingaleLevel = this.martingaleStakes.length - 1;

        this.duration = 1;
        this.durationUnit = 't';

        this.sessionProfit = 0;
        this.tradeCount = 0;
        this.totalStake = 0;
        this.maxTotalStake = config.maxTotalStake || 100; // Differ bots usually have higher limits
        this.minInterval = config.interval || 1000;

        // Pattern and State
        this.consecutiveCount = config.consecutiveCount || 4;
        this.tickHistory = [];
        this.lastTradeTime = 0;

        this.takeProfit = config.takeProfit || 100;
        this.stopLoss = config.stopLoss || -10;
        this.barrier = config.barrier;

        this.pendingContracts = new Set();
        this.isTrading = false;
        this.isCheckingExit = false;
        this.processedContracts = new Set();
        this.profit = 0;
    }

    onStart(bot) {
        this.bot = bot;
        console.log(`[Bot ${this.id}] ${this.name} Loaded`);
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.resetSession();
            console.log(`[Bot ${this.id}] STARTED.`);
        }
    }

    stop() {
        this.isRunning = false;
        console.log(`[Bot ${this.id}] STOPPED.`);
    }

    resetSession() {
        this.tradeCount = 0;
        this.sessionProfit = 0;
        this.profit = 0;
        this.totalStake = 0;
        this.stake = this.baseStake;
        this.martingaleLevel = 0;
        this.pendingContracts = new Set();
        this.processedContracts.clear();
        this.tickHistory = [];
        this.isTrading = false;
    }

    async onTick(tick, now) {
        if (!this.isRunning && this.pendingContracts.size === 0) return;
        if (tick.symbol && tick.symbol !== this.symbol) return;

        // Check Exits
        if (this.pendingContracts.size > 0 && !this.isCheckingExit) {
            this.isCheckingExit = true;
            try {
                const contracts = Array.from(this.pendingContracts);
                for (const cid of contracts) {
                    if (this.processedContracts.has(cid)) {
                        this.pendingContracts.delete(cid);
                        continue;
                    }

                    const c = await this.bot.checkContract(cid);
                    if (c && c.is_sold) {
                        this.processedContracts.add(cid);
                        this.pendingContracts.delete(cid);

                        const p = parseFloat(c.profit);
                        this.sessionProfit += p;
                        this.profit = this.sessionProfit;

                        const result = p >= 0 ? "✅ PROFIT" : "❌ LOSS";
                        console.log(`🎯 [Bot ${this.id}] Differ Trade → ${result} (${p.toFixed(2)} USD) | Session: ${this.sessionProfit.toFixed(2)}`);

                        if (p > 0) {
                            this.stake = this.baseStake;
                            this.martingaleLevel = 0;
                        } else {
                            this.martingaleLevel++;
                            if (this.martingaleLevel > this.maxMartingaleLevel) this.martingaleLevel = 0;
                            this.stake = this.martingaleStakes[this.martingaleLevel];
                        }

                        // Unlimited: no auto-stop on profit/loss limits
                    }
                }
            } catch (e) {
                console.error(`[Bot ${this.id}] Error checking contract:`, e.message);
            } finally {
                this.isCheckingExit = false;
            }
        }

        if (!this.isRunning) return;

        // Pattern Logic
        const quoteStr = tick.quote.toString();
        const currentDigit = parseInt(quoteStr.charAt(quoteStr.length - 1));
        this.tickHistory.push(currentDigit);
        if (this.tickHistory.length > 20) this.tickHistory.shift();

        if (now - this.lastTradeTime < this.minInterval) return;
        if (this.isTrading || this.pendingContracts.size > 0) return;

        if (this.tickHistory.length >= this.consecutiveCount) {
            const recentTicks = this.tickHistory.slice(-this.consecutiveCount);
            const lastDigit = recentTicks[recentTicks.length - 1];
            const isPatternMatch = recentTicks.every(digit => digit === lastDigit);

            if (isPatternMatch) {
                this.executeTrade(lastDigit, now);
            }
        }
    }

    async executeTrade(digit, now) {
        this.isTrading = true;
        this.lastTradeTime = now;

        const tradeDigit = this.barrier !== undefined ? this.barrier : digit;

        console.log(`🔥 [Bot ${this.id}] Pattern Detected: ${this.consecutiveCount} consecutive ticks! Buying DIGITDIFF ${tradeDigit}...`);

        try {
            const t = await this.bot.buy('DIGITDIFF', this.stake, this.duration, this.durationUnit, tradeDigit, this.symbol);
            if (t && t.contract_id) {
                this.pendingContracts.add(t.contract_id);
                this.totalStake += this.stake;
                this.tradeCount++;
                console.log(`💰 [Bot ${this.id}] Differ Trade Executed (ID: ${t.contract_id}) at $${this.stake}`);
            }
        } catch (e) {
            console.error(`[Bot ${this.id}] Buy Error:`, e.message);
        } finally {
            this.isTrading = false;
        }
    }
}

// Odd/Even Bot Class (Supports Patterns)
class HedgeMatchBot {
    constructor(id, config) {
        this.id = id;
        this.name = config.name;
        this.bot = null;
        this.isRunning = false;

        this.symbol = config.symbol || 'R_100';
        this.stake = config.stake || 0.35;
        this.duration = config.duration || 10;
        this.durationUnit = 't';
        this.tradeInterval = config.tradeInterval || 1000;
        this.maxTotalStake = config.maxTotalStake || 9.5;
        this.predictionDigits = config.digits || [0, 3, 2, 4, 1, 9, 6, 8, 5, 7];

        this.appId = config.appId;
        this.apiToken = config.apiToken;

        this.sessionProfit = 0;
        this.tradeCount = 0;
        this.totalStake = 0;
        this.tradeIndex = 0;

        this.isTrading = false;
        this.loop = null;
        this.openContracts = new Set();
        this.profit = 0; // Cumulative profit for UI
    }

    onStart(bot) {
        this.bot = bot;
        console.log(`[Bot ${this.id}] ${this.name} Loaded`);
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.totalStake = 0;
            this.tradeIndex = 0;
            this.sessionProfit = 0;
            this.tradeCount = 0;
            this.openContracts.clear();
            this.beginTradingLoop();
            console.log(`[Bot ${this.id}] STARTED.`);
        }
    }

    stop() {
        this.isRunning = false;
        if (this.loop) {
            clearInterval(this.loop);
            this.loop = null;
        }
        console.log(`[Bot ${this.id}] STOPPED. Total Profit: ${this.sessionProfit.toFixed(2)}`);
    }

    beginTradingLoop() {
        this.loop = setInterval(async () => {
            if (!this.isRunning || this.isTrading || this.totalStake >= this.maxTotalStake) return;

            this.isTrading = true;
            const currentDigit = this.predictionDigits[this.tradeIndex % this.predictionDigits.length];
            console.log(`[Bot ${this.id}] Next Trade → Digit ${currentDigit}`);

            try {
                // Using our unified buy function
                const trade = await this.bot.buy('DIGITMATCH', this.stake, this.duration, this.durationUnit, currentDigit, this.symbol);

                if (trade && trade.contract_id) {
                    const id = trade.contract_id;
                    this.openContracts.add(id);
                    this.totalStake += this.stake;
                    this.tradeCount++;
                    console.log(`[Bot ${this.id}] Trade Executed: Match ${currentDigit} | Stake: ${this.totalStake.toFixed(2)} / ${this.maxTotalStake}`);

                    if (this.totalStake >= this.maxTotalStake) {
                        console.log(`[Bot ${this.id}] Max total stake reached. Waiting for contracts to close.`);
                    }

                    // Schedule checking this contract
                    this.monitorContract(id, currentDigit);
                }
            } catch (e) {
                console.error(`[Bot ${this.id}] Trade Error:`, e.message);
            } finally {
                this.tradeIndex++;
                setTimeout(() => { this.isTrading = false; }, this.tradeInterval);
            }
        }, this.tradeInterval);
    }

    async monitorContract(contractId, digit) {
        let sold = false;
        while (this.isRunning && !sold) {
            try {
                const contract = await this.bot.checkContract(contractId);
                if (contract && contract.is_sold) {
                    sold = true;
                    const profit = parseFloat(contract.profit);
                    this.sessionProfit += profit;
                    this.profit = this.sessionProfit; // Sync for status
                    const result = profit >= 0 ? "✅ PROFIT" : "❌ LOSS";
                    console.log(`[Bot ${this.id}] Result: Digit ${digit} → ${result} (${profit.toFixed(2)} USD) | Total: ${this.sessionProfit.toFixed(2)}`);
                    this.openContracts.delete(contractId);

                    // Unlimited: no auto-stop on max stake
                }
            } catch (e) {
                // Ignore small errors in monitoring
            }
            if (!sold) await new Promise(r => setTimeout(r, 2000));
        }
    }

    async onTick(tick, now) {
        // Interval-driven, so onTick is mostly for UI/status updates if needed
    }
}

class HedgeHigherLowerBot {
    constructor(id, config) {
        this.id = id;
        this.name = config.name;
        this.bot = null;
        this.isRunning = false;

        this.symbol = config.symbol || 'R_100';
        this.martingaleStakes = config.martingaleStakes || [config.stake || 0.35];
        this.martingaleLevel = 0;
        this.maxMartingaleLevel = this.martingaleStakes.length - 1;
        this.stake = this.martingaleStakes[0];

        this.duration = config.duration || 5;
        this.durationUnit = 't';

        this.higherBarrier = config.higherBarrier || '+1';
        this.lowerBarrier = config.lowerBarrier || '-1';

        this.triggerDigit = config.triggerDigit !== undefined ? config.triggerDigit : 5;
        this.triggerOperator = config.triggerOperator || '=';

        this.takeProfit = config.takeProfit || 100;
        this.stopLoss = config.stopLoss || -10;

        this.sessionProfit = 0;
        this.tradeCount = 0;
        this.totalStake = 0;
        this.pendingContracts = new Set();
        this.isTrading = false;
        this.isCheckingExit = false;
        this.processedContracts = new Set();
        this.batchResults = [];
        this.profit = 0;
    }

    onStart(bot) {
        this.bot = bot;
        console.log(`[Bot ${this.id}] ${this.name} Loaded`);
    }

    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            this.resetSession();
            console.log(`[Bot ${this.id}] STARTED.`);
        }
    }

    stop() {
        this.isRunning = false;
        console.log(`[Bot ${this.id}] STOPPED.`);
    }

    resetSession() {
        this.tradeCount = 0;
        this.sessionProfit = 0;
        this.profit = 0;
        this.isTrading = false;
        this.martingaleLevel = 0;
        this.stake = this.martingaleStakes[0];
        this.batchResults = [];
    }

    async onTick(tick, now) {
        if (!this.isRunning && this.pendingContracts.size === 0) return;
        if (tick.symbol && tick.symbol !== this.symbol) return;

        // Check Exits
        if (this.pendingContracts.size > 0 && !this.isCheckingExit) {
            this.isCheckingExit = true;
            try {
                const contracts = Array.from(this.pendingContracts);
                let batchFinished = true;

                for (const cid of contracts) {
                    if (this.processedContracts.has(cid)) {
                        this.pendingContracts.delete(cid);
                        continue;
                    }

                    const c = await this.bot.checkContract(cid);
                    if (c && c.is_sold) {
                        this.processedContracts.add(cid);
                        this.pendingContracts.delete(cid);
                        const p = parseFloat(c.profit);
                        this.sessionProfit += p;
                        this.profit = this.sessionProfit;
                        this.batchResults.push(p >= 0);

                        console.log(`🎯 [Bot ${this.id}] Contract ${cid} finished: ${p >= 0 ? '✅ PROFIT' : '❌ LOSS'} (${p.toFixed(2)} USD)`);
                    } else {
                        batchFinished = false;
                    }
                }

                if (batchFinished && this.pendingContracts.size === 0) {
                    // Evaluate Batch Result for Martingale
                    // Only increase if BOTH lost (meaning if length is 2 and both are false)
                    const allLost = this.batchResults.length === 2 && this.batchResults.every(r => r === false);

                    if (allLost) {
                        this.martingaleLevel++;
                        if (this.martingaleLevel > this.maxMartingaleLevel) this.martingaleLevel = this.maxMartingaleLevel;
                        console.log(`[Bot ${this.id}] BOTH LOST! Martingale Level: ${this.martingaleLevel}`);
                    } else {
                        this.martingaleLevel = 0;
                        console.log(`[Bot ${this.id}] RESET! ${this.batchResults.includes(true) ? 'At least one won.' : 'Incomplete batch result.'}`);
                    }

                    this.stake = this.martingaleStakes[this.martingaleLevel];
                    this.batchResults = []; // Reset for next trigger

                    // Decide if we should do martingale or stop
                    // Unlimited: no auto-stop on profit/loss limits
                }
            } catch (e) {
                console.error(`[Bot ${this.id}] Error checking contracts:`, e.message);
            } finally {
                this.isCheckingExit = false;
            }
        }

        if (!this.isRunning) return;

        // Trigger Logic
        const quoteStr = tick.quote.toString();
        const currentDigit = parseInt(quoteStr.charAt(quoteStr.length - 1));

        let match = false;
        if (this.triggerOperator === '=') match = currentDigit === this.triggerDigit;
        else if (this.triggerOperator === '>') match = currentDigit > this.triggerDigit;
        else if (this.triggerOperator === '<') match = currentDigit < this.triggerDigit;

        if (match && !this.isTrading && this.pendingContracts.size === 0) {
            this.executeTrades(now);
        }
    }

    async executeTrades(now) {
        this.isTrading = true;
        console.log(`🔥 [Bot ${this.id}] Trigger Match (${this.triggerOperator} ${this.triggerDigit})! Buying HIGHER and LOWER...`);

        const hVal = (this.higherBarrier || '1').toString().replace(/^[+-]/, '') || '1';
        const lVal = (this.lowerBarrier || '1').toString().replace(/^[+-]/, '') || '1';
        const hBarrier = `+${hVal}`;
        const lBarrier = `-${lVal}`;
        const duration = Math.max(5, parseInt(this.duration) || 5);

        let currentStake = this.stake;

        try {
            const results = await Promise.allSettled([
                this.bot.buy('HIGHER', currentStake, duration, this.durationUnit, hBarrier, this.symbol),
                this.bot.buy('LOWER', currentStake, duration, this.durationUnit, lBarrier, this.symbol)
            ]);

            results.forEach((res, index) => {
                const type = index === 0 ? 'HIGHER' : 'LOWER';
                const barrier = index === 0 ? hBarrier : lBarrier;

                if (res.status === 'fulfilled' && res.value && res.value.contract_id) {
                    const t = res.value;
                    this.pendingContracts.add(t.contract_id);
                    this.totalStake += currentStake;
                    this.tradeCount++;
                    console.log(`💰 [Bot ${this.id}] ${type} Trade Executed (ID: ${t.contract_id}) at ${barrier}`);
                } else {
                    const errorMsg = res.status === 'rejected' ? (res.reason.message || res.reason) : 'Unknown error';
                    console.error(`❌ [Bot ${this.id}] ${type} Buy Failed:`, errorMsg);
                }
            });

        } catch (e) {
            console.error(`[Bot ${this.id}] Simultaneous Buy Error:`, e.message);
        } finally {
            this.isTrading = false;
        }
    }
}


// ============================================================================
// ACCUMULATOR BOT ENGINE (Direct from desktop deriv-accumulator-bot working code)
// ============================================================================
class AccumulatorBotBase {
  constructor(id, initialConfig = {}) {
    this.id = id;
    this.name = initialConfig.name || `Accumulator Bot ${id - 85}`;
    this.client = null;
    this.isRunning = false;
    this.state = 'IDLE';

    this.config = {
      symbol: initialConfig.symbol || 'R_100',
      growthRate: parseFloat(initialConfig.growthRate) || 0.05,
      baseStake: parseFloat(initialConfig.stake) || 1.0,
      targetTicks: parseInt(initialConfig.targetTicks, 10) || 10,
      globalTakeProfit: parseFloat(initialConfig.takeProfit) || 50.0,
      globalStopLoss: Math.abs(parseFloat(initialConfig.stopLoss)) || 30.0,
      maxCycles: parseInt(initialConfig.maxCycles, 10) !== undefined ? parseInt(initialConfig.maxCycles, 10) : 10
    };

    // Compatibility fields for Hedge Bot dashboard
    this.baseStake = this.config.baseStake;
    this.stake = this.config.baseStake;
    this.symbol = this.config.symbol;
    this.growthRate = this.config.growthRate;
    this.targetTicks = this.config.targetTicks;
    this.maxCycles = this.config.maxCycles;
    this.takeProfit = this.config.globalTakeProfit;
    this.stopLoss = -this.config.globalStopLoss;

    this.currentStake = this.config.baseStake;
    this.activeProposalId = null;
    this.activeContractId = null;
    this.activeContract = null;
    this.cooldownTimer = null;
    this.crashPollTimer = null;
    this._crashBuyTriggered = false;
    this.isImmediateNextBuy = false;
    this.cyclesCompleted = 0;
    this.isSelling = false;
    this._processedContractId = null;

    this.stats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnL: 0.0,
      currentWinStreak: 0,
      currentLossStreak: 0,
      maxWinStreak: 0,
      maxLossStreak: 0,
      tradeHistory: []
    };
  }

  get sessionProfit() {
    return this.stats ? this.stats.totalPnL : 0;
  }
  set sessionProfit(val) {
    if (this.stats) this.stats.totalPnL = val;
  }
  get profit() {
    return this.stats ? this.stats.totalPnL : 0;
  }
  set profit(val) {
    if (this.stats) this.stats.totalPnL = val;
  }

  updateBadge(text, color = '#94a3b8') {
    const el = document.getElementById(`accu-badge-${this.id}`);
    if (el) {
      el.textContent = text;
      el.style.color = color;
    }
  }

  updateProfitDisplay() {
    const pEl = document.getElementById(`profit-${this.id}`);
    if (pEl) {
      const val = this.stats.totalPnL;
      pEl.textContent = `${val >= 0 ? '+' : ''}${val.toFixed(2)}`;
      pEl.className = `profit-display ${val >= 0 ? 'profit-pos' : 'profit-neg'}`;
    }
  }

  syncConfigFromUI() {
    const tEl = document.getElementById(`targetTicks-${this.id}`);
    if (tEl && !isNaN(parseInt(tEl.value, 10))) {
      this.config.targetTicks = parseInt(tEl.value, 10);
      this.targetTicks = this.config.targetTicks;
    }
    const mEl = document.getElementById(`maxCycles-${this.id}`);
    if (mEl && !isNaN(parseInt(mEl.value, 10))) {
      this.config.maxCycles = parseInt(mEl.value, 10);
      this.maxCycles = this.config.maxCycles;
    }
    const sEl = document.getElementById(`stake-${this.id}`);
    if (sEl && !isNaN(parseFloat(sEl.value))) {
      this.config.baseStake = parseFloat(sEl.value);
      this.baseStake = this.config.baseStake;
      this.stake = this.config.baseStake;
      this.currentStake = this.config.baseStake;
    }
    const gEl = document.getElementById(`growthRate-${this.id}`);
    if (gEl && !isNaN(parseFloat(gEl.value))) {
      this.config.growthRate = parseFloat(gEl.value);
      this.growthRate = this.config.growthRate;
    }
    const symEl = document.getElementById(`symbol-${this.id}`);
    if (symEl && symEl.value) {
      this.config.symbol = symEl.value;
      this.symbol = this.config.symbol;
    }
    const tpEl = document.getElementById(`takeProfit-${this.id}`);
    if (tpEl && !isNaN(parseFloat(tpEl.value))) {
      this.config.globalTakeProfit = parseFloat(tpEl.value);
      this.takeProfit = this.config.globalTakeProfit;
    }
    const slEl = document.getElementById(`stopLoss-${this.id}`);
    if (slEl && !isNaN(parseFloat(slEl.value))) {
      this.config.globalStopLoss = Math.abs(parseFloat(slEl.value));
      this.stopLoss = -this.config.globalStopLoss;
    }
  }

  updateConfig(newConfig = {}) {
    if (newConfig.symbol) { this.config.symbol = newConfig.symbol; this.symbol = newConfig.symbol; }
    if (newConfig.growthRate !== undefined) { this.config.growthRate = parseFloat(newConfig.growthRate); this.growthRate = this.config.growthRate; }
    if (newConfig.stake !== undefined) { this.config.baseStake = parseFloat(newConfig.stake); this.baseStake = this.config.baseStake; this.stake = this.config.baseStake; }
    if (newConfig.targetTicks !== undefined) { this.config.targetTicks = parseInt(newConfig.targetTicks, 10); this.targetTicks = this.config.targetTicks; }
    if (newConfig.maxCycles !== undefined) { this.config.maxCycles = parseInt(newConfig.maxCycles, 10); this.maxCycles = this.config.maxCycles; }
    if (newConfig.takeProfit !== undefined) { this.config.globalTakeProfit = parseFloat(newConfig.takeProfit); this.takeProfit = this.config.globalTakeProfit; }
    if (newConfig.stopLoss !== undefined) { this.config.globalStopLoss = Math.abs(parseFloat(newConfig.stopLoss)); this.stopLoss = -this.config.globalStopLoss; }

    if (this.state === 'IDLE') {
      this.currentStake = this.config.baseStake;
    }
  }

  onStart(client) {
    this.client = client;
    this.bindClientEvents();
    console.log(`[Bot ${this.id}] ${this.name} Engine initialized for ${this.config.symbol} (${(this.config.growthRate * 100).toFixed(0)}% Growth, Target ${this.config.targetTicks} Ticks).`);
  }

  bindClientEvents() {
    if (!this.client || this._boundClientEvents) return;
    this._boundClientEvents = true;

    this.client.on('proposal', (proposal) => this.onProposalReceived(proposal));
    this.client.on('proposalOpenContract', (poc) => this.onOpenContractUpdate(poc));
  }

  onContractUpdate(poc) {
    this.onOpenContractUpdate(poc);
  }

  start() {
    if (this.isRunning) return;
    this.syncConfigFromUI();

    if (!this.client && window.hedgeClient && window.hedgeClient.client) {
      this.client = window.hedgeClient.client;
      this.bindClientEvents();
    }

    if (!this.client || !this.client.isConnected) {
      console.error(`[Bot ${this.id}] Cannot start: Client is not connected.`);
      this.updateBadge(`⚠️ Not Connected`, '#ef4444');
      return;
    }

    this.isRunning = true;
    this.state = 'PREPARING';
    this.currentStake = this.config.baseStake;
    this.cyclesCompleted = 0;
    this._crashBuyTriggered = false;
    this.isImmediateNextBuy = false;
    this._processedContractId = null;
    this.isSelling = false;

    console.log(`[Bot ${this.id}] ${this.name} STARTED. Target: ${this.config.targetTicks} Ticks, Max Cycles: ${this.config.maxCycles || '∞'}`);
    this.updateBadge(`⏳ Waiting for Tick 0...`, '#f59e0b');

    // Subscribe ticks for symbol and trigger next trade
    this.client.subscribeTicks(this.config.symbol).catch(() => {});
    this.triggerNextTrade();
  }

  stop(reason = 'User Requested') {
    this.isRunning = false;
    this.state = 'STOPPED';
    this.stopCrashMonitoring();
    this.stopInContractPolling();
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
    this.updateBadge(`Stopped (Done: ${this.cyclesCompleted}/${this.config.maxCycles || '∞'})`, '#94a3b8');
    console.log(`[Bot ${this.id}] ${this.name} STOPPED (${reason}). Session PnL: ${this.stats.totalPnL.toFixed(2)}`);
  }

  startCrashMonitoring() {
    this.stopCrashMonitoring();
    this._crashBuyTriggered = false;
    this._lastRunTicks = null;
    this._lastStatsLen = null;
    this._isFirstCrashCheck = true;

    const cycleLabel = `Cyc ${this.cyclesCompleted + 1}/${this.config.maxCycles || '∞'}`;
    this.updateBadge(`⏳ Waiting for Tick 0 | ${cycleLabel}`, '#f59e0b');

    const poll = () => {
      if (this.state !== 'WAITING_FOR_CRASH' || !this.isRunning) {
        this.stopCrashMonitoring();
        return;
      }
      this.client.requestAccumulatorProposal({
        symbol: this.config.symbol,
        stake: this.currentStake,
        growthRate: this.config.growthRate,
        currency: this.client.currency || 'USD'
      }).then(res => {
        if (res && res.proposal && this.state === 'WAITING_FOR_CRASH' && this.isRunning) {
          this.onProposalReceived({
            ...res.proposal,
            echo_req: res.echo_req || { underlying_symbol: this.config.symbol }
          });
        }
      }).catch(err => {
        console.warn(`[Bot ${this.id}] Proposal check notice:`, err.message || err);
      });
    };

    // Stagger polls across the 10 bots so they don't fire at the exact same millisecond
    const staggerDelay = ((this.id - 86) % 10) * 180;
    setTimeout(() => {
      if (this.state === 'WAITING_FOR_CRASH' && this.isRunning) {
        poll();
      }
    }, staggerDelay);

    this.crashPollTimer = setInterval(poll, 2000);
  }

  stopCrashMonitoring() {
    if (this.crashPollTimer) {
      clearInterval(this.crashPollTimer);
      this.crashPollTimer = null;
    }
  }

  triggerNextTrade() {
    if (!this.isRunning) return;

    if (this.checkRiskLimits()) return;

    if (!this.client.isConnected) {
      console.error(`[Bot ${this.id}] Client disconnected. Pausing trade.`);
      return;
    }

    if (!this.isImmediateNextBuy && this.state !== 'WAITING_FOR_CRASH') {
      this.state = 'WAITING_FOR_CRASH';
      this._crashBuyTriggered = false;
      this._lastRunTicks = null;
      this._lastStatsLen = null;
      this._isFirstCrashCheck = true;
      console.log(`[Bot ${this.id}] ${this.name} Waiting for ${this.config.symbol} tick count to reset to 0...`);
      this.startCrashMonitoring();
      return;
    }

    this.isImmediateNextBuy = false;
    this.executeBuy();
  }

  executeBuy() {
    if (!this.isRunning) return;
    if (this.checkRiskLimits()) return;

    this.stopCrashMonitoring();
    this.state = 'PREPARING';
    this.isSelling = false;
    this._processedContractId = null;

    const growthPercent = (this.config.growthRate * 100).toFixed(0);
    const cycleLabel = `Cycle ${this.cyclesCompleted + 1}/${this.config.maxCycles || '∞'}`;
    console.log(`🚀 [Bot ${this.id}] ${this.name} Buying ACCU (${growthPercent}% Growth | ${this.config.symbol} | Stake: ${this.currentStake} | Target: ${this.config.targetTicks} Ticks | ${cycleLabel})...`);
    this.updateBadge(`🚀 Buying (${cycleLabel})...`, '#6366f1');

    this.client.buyAccumulatorDirect({
      symbol: this.config.symbol,
      stake: this.currentStake,
      growthRate: this.config.growthRate,
      currency: this.client.currency || 'USD'
    }).then(res => {
      if (res && res.buy && res.buy.contract_id) {
        console.log(`💰 [Bot ${this.id}] ${this.name} Buy order confirmed! Contract #${res.buy.contract_id}`);
        this.onBuyExecuted(res.buy);
      } else {
        throw new Error((res && res.error && res.error.message) || 'No contract_id in buy response');
      }
    }).catch(directErr => {
      console.warn(`⚠️ [Bot ${this.id}] Direct buy notice: ${directErr.message || directErr}. Trying proposal method...`);
      // Fallback 2-step Proposal -> Buy
      this.client.requestAccumulatorProposal({
        symbol: this.config.symbol,
        stake: this.currentStake,
        growthRate: this.config.growthRate,
        currency: this.client.currency || 'USD'
      }).then(propRes => {
        const propId = propRes.proposal ? propRes.proposal.id : this.activeProposalId;
        if (!propId) throw new Error('Proposal ID not received');
        return this.client.buyContract(propId, this.currentStake);
      }).then(buyRes => {
        if (buyRes && buyRes.buy && buyRes.buy.contract_id) {
          console.log(`💰 [Bot ${this.id}] ${this.name} Proposal buy confirmed! Contract #${buyRes.buy.contract_id}`);
          this.onBuyExecuted(buyRes.buy);
        } else {
          throw new Error('Buy response missing contract_id');
        }
      }).catch(buyErr => {
        console.error(`❌ [Bot ${this.id}] ${this.name} Buy Failed: ${buyErr.message || buyErr}`);
        this.updateBadge(`❌ Buy Failed`, '#ef4444');
        setTimeout(() => {
          if (this.isRunning) this.triggerNextTrade();
        }, 2500);
      });
    });
  }

  onProposalReceived(proposal) {
    if (proposal && proposal.id) {
      this.activeProposalId = proposal.id;
    }

    if (this.state !== 'WAITING_FOR_CRASH' || !this.isRunning) return;

    // Check that proposal matches this bot's symbol
    const reqSymbol = proposal?.echo_req?.underlying_symbol || 
                      proposal?.echo_req?.symbol || 
                      proposal?.contract_details?.underlying_symbol || 
                      proposal?.underlying_symbol;

    if (reqSymbol && String(reqSymbol).toUpperCase() !== String(this.config.symbol).toUpperCase()) {
      return;
    }

    const stats = proposal?.contract_details?.ticks_stayed_in || proposal?.ticks_stayed_in;
    if (!stats || !Array.isArray(stats) || stats.length === 0) return;

    const currentRunTicks = parseInt(stats[stats.length - 1], 10);
    if (isNaN(currentRunTicks)) return;

    const prevTicks = this._lastRunTicks;
    const prevStatsLen = this._lastStatsLen;

    this._lastRunTicks = currentRunTicks;
    this._lastStatsLen = stats.length;

    const cycleLabel = `Cyc ${this.cyclesCompleted + 1}/${this.config.maxCycles || '∞'}`;
    this.updateBadge(`⏳ Wait 0 (Curr: ${currentRunTicks}) | ${cycleLabel}`, '#f59e0b');

    // TICK 0 OR TICK COUNT RESET DETECTION:
    // 1. Tick is exactly 0
    const isZero = (currentRunTicks === 0);
    // 2. Tick count dropped/reset (e.g. was 15, now 1 or 2 or 0)
    const isReset = (prevTicks !== null && prevTicks !== undefined && currentRunTicks < prevTicks);
    // 3. New run added to stats array (previous run crashed)
    const isNewRun = (prevStatsLen !== null && prevStatsLen !== undefined && stats.length > prevStatsLen);
    // 4. On first poll after start, if market is already at fresh 0 or 1, start immediately!
    const isInitialFresh = (this._isFirstCrashCheck && currentRunTicks <= 1);
    this._isFirstCrashCheck = false;

    if (isZero || isReset || isNewRun || isInitialFresh) {
      if (this._crashBuyTriggered) return;
      this._crashBuyTriggered = true;

      this.stopCrashMonitoring();
      const prevRunVal = prevTicks !== null ? prevTicks : (stats.length >= 2 ? stats[stats.length - 2] : '?');
      console.log(`💥 [Bot ${this.id}] ${this.name} (${this.config.symbol}) Tick 0 / Reset Detected (Current: ${currentRunTicks}, Previous: ${prevRunVal}) — BUYING NOW!`);
      this.executeBuy();
    }
  }

  onBuyExecuted(buyInfo) {
    if (!this.isRunning) return;

    this.state = 'IN_CONTRACT';
    const contractId = buyInfo.contract_id;
    this.activeContractId = contractId;
    this.activeContract = null;
    this.isSelling = false;
    this._processedContractId = null;

    const cycleLabel = `Cycle ${this.cyclesCompleted + 1}/${this.config.maxCycles || '∞'}`;
    this.updateBadge(`⚡ Tick 0/${this.config.targetTicks} | ${cycleLabel}`, '#06b6d4');

    // Ensure global open contract push stream is active
    if (this.client && typeof this.client.subscribeOpenContract === 'function') {
      this.client.subscribeOpenContract().catch(() => {});
    }
  }

  startInContractPolling(contractId) {
    // Zero polling needed: Deriv pushes all open contracts via global proposal_open_contract stream
  }

  stopInContractPolling() {
    if (this.inContractPollTimer) {
      clearInterval(this.inContractPollTimer);
      this.inContractPollTimer = null;
    }
  }

  onOpenContractUpdate(poc) {
    if (!poc || !poc.contract_id) return;
    if (!this.isRunning || this.state !== 'IN_CONTRACT') return;
    if (!this.activeContractId || String(poc.contract_id) !== String(this.activeContractId)) {
      return;
    }

    this.activeContract = poc;

    // 1. Contract Finished Check (Sold / Won / Lost / Expired)
    if (poc.is_sold === 1 || poc.status === 'won' || poc.status === 'lost' || poc.status === 'sold' || poc.is_expired === 1) {
      if (this._processedContractId === poc.contract_id) return;
      this._processedContractId = poc.contract_id;

      this.stopInContractPolling();
      this.onContractCompleted(poc);
      return;
    }

    if (poc.status !== 'open') return;

    // 2. Accurate Ticks calculation
    let currentTicks = 0;
    const p = parseFloat(poc.profit || 0);
    const s = parseFloat(poc.buy_price || poc.stake || this.currentStake || 1.0);
    const g = parseFloat(poc.growth_rate || this.config.growthRate || 0.05);
    if (p > 0 && s > 0 && g > 0) {
      currentTicks = Math.round(Math.log((p + s) / s) / Math.log(1 + g));
    }
    if (poc.tick_stream && Array.isArray(poc.tick_stream)) {
      const st = Math.max(0, poc.tick_stream.length - 1);
      if (st > currentTicks) currentTicks = st;
    }
    if (poc.tick_passed !== undefined && poc.tick_passed !== null) {
      const tp = parseInt(poc.tick_passed, 10) || 0;
      if (tp > currentTicks) currentTicks = tp;
    }

    const cycleLabel = `Cyc ${this.cyclesCompleted + 1}/${this.config.maxCycles || '∞'}`;
    if (currentTicks > 0) {
      this.updateBadge(`⚡ Tick ${currentTicks}/${this.config.targetTicks} | ${cycleLabel}`, '#06b6d4');
    }

    // Guard: Do not attempt to sell at entry spot before first tick
    if (currentTicks === 0) return;

    // 3. TARGET TICKS AUTO CASHOUT:
    if (this.config.targetTicks > 0 && currentTicks >= this.config.targetTicks) {
      if (this.isSelling) {
        if (Date.now() - (this._sellAttemptTime || 0) > 1000) {
          this._sellAttemptTime = Date.now();
          console.warn(`[Bot ${this.id}] Retrying sell for contract #${poc.contract_id}...`);
          this.client.sellContract(poc.contract_id).catch(() => {});
        }
        return;
      }

      this.isSelling = true;
      this._sellAttemptTime = Date.now();
      console.log(`⚡ [Bot ${this.id}] ${this.name} Target REACHED (${currentTicks}/${this.config.targetTicks} ticks)! CASHING OUT NOW...`);
      this.updateBadge(`💰 Cashing Out (${currentTicks}/${this.config.targetTicks})...`, '#10b981');

      this.client.sellContract(poc.contract_id).then(res => {
        console.log(`✅ [Bot ${this.id}] ${this.name} Cashout SUCCESS for contract #${poc.contract_id}!`);
        const soldFor = (res && res.sell && parseFloat(res.sell.sold_for)) || 0;
        const stake = parseFloat(this.currentStake) || 1.0;
        this.stopInContractPolling();
        this.onContractCompleted({
          contract_id: poc.contract_id,
          status: 'sold',
          is_sold: 1,
          profit: soldFor > 0 ? (soldFor - stake) : parseFloat(poc.profit || 0),
          sell_price: soldFor,
          stake: stake,
          tick_passed: currentTicks,
          tick_count: currentTicks
        });
      }).catch(err => {
        console.error(`❌ [Bot ${this.id}] ${this.name} Cashout Error: ${err.message || err}`);
        setTimeout(() => {
          if (this.isRunning && String(this.activeContractId) === String(poc.contract_id)) {
            this.isSelling = false;
          }
        }, 500);
      });
      return;
    }
  }

  onContractCompleted(poc) {
    if (!poc || !poc.contract_id) return;
    if (this._processedContractId === poc.contract_id) return;
    this._processedContractId = poc.contract_id;

    this.stopInContractPolling();
    this.activeContract = null;
    this.activeContractId = null;
    this.isSelling = false;

    if (!poc) return;

    if (this.client && typeof this.client.unsubscribeOpenContract === 'function') {
      this.client.unsubscribeOpenContract(poc.contract_id);
    }

    const isWin = poc.status === 'won' || (parseFloat(poc.profit) > 0);
    const profitLoss = parseFloat(poc.profit || (isWin ? (poc.sell_price - poc.stake) : -poc.stake));
    const ticksSurvived = poc.tick_passed ?? poc.tick_count ?? 0;

    this.stats.totalTrades += 1;
    this.stats.totalPnL += profitLoss;

    if (isWin) {
      this.stats.wins += 1;
      this.stats.currentWinStreak += 1;
      this.stats.currentLossStreak = 0;
      this.isImmediateNextBuy = false; // After WIN: wait for ongoing market tick count to finish
      console.log(`🎯 [Bot ${this.id}] ${this.name} Contract #${poc.contract_id} ✅ WON (+$${profitLoss.toFixed(2)} | ${ticksSurvived} Ticks) | Total PnL: $${this.stats.totalPnL.toFixed(2)}`);
      this.updateBadge(`✅ Win +$${profitLoss.toFixed(2)} | Waiting 0...`, '#10b981');
    } else {
      this.stats.losses += 1;
      this.stats.currentLossStreak += 1;
      this.stats.currentWinStreak = 0;
      console.log(`🎯 [Bot ${this.id}] ${this.name} Contract #${poc.contract_id} ❌ LOSS (-$${Math.abs(profitLoss).toFixed(2)}) | Total PnL: $${this.stats.totalPnL.toFixed(2)}`);
      this.updateBadge(`❌ Crash (-$${Math.abs(profitLoss).toFixed(2)}) | Waiting 0...`, '#ef4444');
    }

    this.updateProfitDisplay();
    this.cyclesCompleted = (this.cyclesCompleted || 0) + 1;
    this.state = 'IDLE';

    // Check risk limits (TP, SL, Max Cycles)
    if (this.checkRiskLimits()) return;

    if (!this.isRunning) return;

    // Trigger next trade: wait for market reset to 0
    setTimeout(() => {
      if (this.isRunning && !this.activeContractId) {
        this.triggerNextTrade();
      }
    }, 1000);
  }

  checkRiskLimits() {
    if (this.config.globalTakeProfit > 0 && this.stats.totalPnL >= this.config.globalTakeProfit) {
      console.log(`🏆 [Bot ${this.id}] ${this.name} Global TP reached (+$${this.stats.totalPnL.toFixed(2)}). Stopping bot.`);
      this.updateBadge(`🏆 TP Reached (+$${this.stats.totalPnL.toFixed(2)})`, '#10b981');
      this.stop('Take Profit Reached');
      return true;
    }

    if (this.config.globalStopLoss > 0 && this.stats.totalPnL <= -Math.abs(this.config.globalStopLoss)) {
      console.log(`🛑 [Bot ${this.id}] ${this.name} Global SL reached (-$${Math.abs(this.stats.totalPnL).toFixed(2)}). Stopping bot.`);
      this.updateBadge(`🛑 SL Reached (-$${Math.abs(this.stats.totalPnL).toFixed(2)})`, '#ef4444');
      this.stop('Stop Loss Reached');
      return true;
    }

    if (this.config.maxCycles > 0 && (this.cyclesCompleted || 0) >= this.config.maxCycles) {
      console.log(`🏁 [Bot ${this.id}] ${this.name} Max cycles reached (${this.cyclesCompleted}/${this.config.maxCycles}). Stopping bot.`);
      this.updateBadge(`🏁 Completed: ${this.cyclesCompleted}/${this.config.maxCycles} Cycles`, '#10b981');
      this.stop('Max Cycles Reached');
      return true;
    }

    return false;
  }

  async onTick(tick) {
    // Tick event forwarder (optional backup)
  }
}

// ============================================================================
// 10 SEPARATE ACCUMULATOR BOTS (Bots 1 to 10 / IDs 86 to 95)
// ============================================================================
class AccumulatorBot1 extends AccumulatorBotBase {
  constructor(id = 86, config = {}) {
    super(id, { name: 'Accumulator Bot 1', symbol: 'R_100', ...config });
  }
}

class AccumulatorBot2 extends AccumulatorBotBase {
  constructor(id = 87, config = {}) {
    super(id, { name: 'Accumulator Bot 2', symbol: 'R_10', ...config });
  }
}

class AccumulatorBot3 extends AccumulatorBotBase {
  constructor(id = 88, config = {}) {
    super(id, { name: 'Accumulator Bot 3', symbol: 'R_75', ...config });
  }
}

class AccumulatorBot4 extends AccumulatorBotBase {
  constructor(id = 89, config = {}) {
    super(id, { name: 'Accumulator Bot 4', symbol: 'R_25', ...config });
  }
}

class AccumulatorBot5 extends AccumulatorBotBase {
  constructor(id = 90, config = {}) {
    super(id, { name: 'Accumulator Bot 5', symbol: 'R_50', ...config });
  }
}

class AccumulatorBot6 extends AccumulatorBotBase {
  constructor(id = 91, config = {}) {
    super(id, { name: 'Accumulator Bot 6', symbol: '1HZ100V', ...config });
  }
}

class AccumulatorBot7 extends AccumulatorBotBase {
  constructor(id = 92, config = {}) {
    super(id, { name: 'Accumulator Bot 7', symbol: '1HZ10V', ...config });
  }
}

class AccumulatorBot8 extends AccumulatorBotBase {
  constructor(id = 93, config = {}) {
    super(id, { name: 'Accumulator Bot 8', symbol: '1HZ75V', ...config });
  }
}

class AccumulatorBot9 extends AccumulatorBotBase {
  constructor(id = 94, config = {}) {
    super(id, { name: 'Accumulator Bot 9', symbol: '1HZ25V', ...config });
  }
}

class AccumulatorBot10 extends AccumulatorBotBase {
  constructor(id = 95, config = {}) {
    super(id, { name: 'Accumulator Bot 10', symbol: '1HZ50V', ...config });
  }
}

// ============================================================================
// BOOM & CRASH BOTS (Bots 96 to 109 - 14 Independent Bots)
// ============================================================================
class BoomBot50 extends AccumulatorBotBase {
  constructor(id = 96, config = {}) {
    super(id, { name: 'Boom 50 Bot', symbol: 'BOOM50', ...config });
  }
}

class BoomBot150 extends AccumulatorBotBase {
  constructor(id = 97, config = {}) {
    super(id, { name: 'Boom 150 Bot', symbol: 'BOOM150', ...config });
  }
}

class BoomBot300 extends AccumulatorBotBase {
  constructor(id = 98, config = {}) {
    super(id, { name: 'Boom 300 Bot', symbol: 'BOOM300', ...config });
  }
}

class BoomBot500 extends AccumulatorBotBase {
  constructor(id = 99, config = {}) {
    super(id, { name: 'Boom 500 Bot', symbol: 'BOOM500', ...config });
  }
}

class BoomBot600 extends AccumulatorBotBase {
  constructor(id = 100, config = {}) {
    super(id, { name: 'Boom 600 Bot', symbol: 'BOOM600', ...config });
  }
}

class BoomBot900 extends AccumulatorBotBase {
  constructor(id = 101, config = {}) {
    super(id, { name: 'Boom 900 Bot', symbol: 'BOOM900', ...config });
  }
}

class BoomBot1000 extends AccumulatorBotBase {
  constructor(id = 102, config = {}) {
    super(id, { name: 'Boom 1000 Bot', symbol: 'BOOM1000', ...config });
  }
}

class CrashBot50 extends AccumulatorBotBase {
  constructor(id = 103, config = {}) {
    super(id, { name: 'Crash 50 Bot', symbol: 'CRASH50', ...config });
  }
}

class CrashBot150 extends AccumulatorBotBase {
  constructor(id = 104, config = {}) {
    super(id, { name: 'Crash 150 Bot', symbol: 'CRASH150', ...config });
  }
}

class CrashBot300 extends AccumulatorBotBase {
  constructor(id = 105, config = {}) {
    super(id, { name: 'Crash 300 Bot', symbol: 'CRASH300', ...config });
  }
}

class CrashBot500 extends AccumulatorBotBase {
  constructor(id = 106, config = {}) {
    super(id, { name: 'Crash 500 Bot', symbol: 'CRASH500', ...config });
  }
}

class CrashBot600 extends AccumulatorBotBase {
  constructor(id = 107, config = {}) {
    super(id, { name: 'Crash 600 Bot', symbol: 'CRASH600', ...config });
  }
}

class CrashBot900 extends AccumulatorBotBase {
  constructor(id = 108, config = {}) {
    super(id, { name: 'Crash 900 Bot', symbol: 'CRASH900', ...config });
  }
}

class CrashBot1000 extends AccumulatorBotBase {
  constructor(id = 109, config = {}) {
    super(id, { name: 'Crash 1000 Bot', symbol: 'CRASH1000', ...config });
  }
}


class FourBotStrategy {
    constructor() {
        this.strategies = [];
        const defaultStakes = [0.35];

        // 1-10 Over
        for (let i = 1; i <= 10; i++) {
            const prediction = i === 10 ? 0 : i;
            this.strategies.push(new SubStrategy(i, {
                name: `Over Bot ${i}`,
                type: 'DIGITOVER',
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100'
            }));
        }

        // 11-20 Under
        for (let i = 1; i <= 10; i++) {
            const id = i + 10;
            const prediction = i === 10 ? 0 : i;
            this.strategies.push(new SubStrategy(id, {
                name: `Under Bot ${i}`,
                type: 'DIGITUNDER',
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100'
            }));
        }

        // 21-25 Odd Bots
        for (let i = 1; i <= 5; i++) {
            const id = i + 20;
            const prediction = i; // 1, 2, 3, 4, 5
            this.strategies.push(new SubStrategy(id, {
                name: `Odd Bot ${i}`,
                type: 'DIGITODD',
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100'
            }));
        }

        // 26-30 Even Bots
        for (let i = 1; i <= 5; i++) {
            const id = i + 25;
            const prediction = (i + 5) === 10 ? 0 : (i + 5); // 6, 7, 8, 9, 0
            this.strategies.push(new SubStrategy(id, {
                name: `Even Bot ${i}`,
                type: 'DIGITEVEN',
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100'
            }));
        }

        // 31 New Odd/Even Pattern Bot
        this.strategies.push(new OddEvenPatternBot(31, {
            name: 'New Odd/Even Pattern Bot',
            stake: 0.35,
            symbol: 'R_10',
            pattern: []
        }));

        // 32 New RISE/FALL Pattern Bot
        this.strategies.push(new RiseFallPatternBot(32, {
            name: 'New RISE/FALL Pattern Bot',
            stake: 0.35,
            symbol: 'R_10',
            pattern: [],
            duration: 5
        }));

        // 33 New OVER/UNDER Pattern Bot
        this.strategies.push(new OverUnderPatternBot(33, {
            name: 'New OVER/UNDER Pattern Bot',
            stake: 0.35,
            symbol: 'R_10',
            pattern: [],
            barrier: 5
        }));

        // 34 New HIGHER/LOWER Pattern Bot
        this.strategies.push(new HigherLowerPatternBot(34, {
            name: 'New HIGHER/LOWER Pattern Bot',
            stake: 0.35,
            symbol: 'R_10',
            pattern: [],
            barrier: '+1',
            duration: 5
        }));

        // 35-44 New Digit Differ Pattern Bots
        for (let i = 1; i <= 10; i++) {
            const id = i + 34;
            const prediction = i === 10 ? 0 : i;
            this.strategies.push(new DigitDifferPatternBot(id, {
                name: `Differ Bot ${i}`,
                stake: 0.35,
                stakes: defaultStakes,
                symbol: 'R_100',
                consecutiveCount: 3,
                takeProfit: 100,
                stopLoss: -50,
                barrier: prediction
            }));
        }

        // 45-54 New Digit Matches Bots
        for (let i = 1; i <= 10; i++) {
            const id = i + 44;
            const prediction = i === 10 ? 0 : i;
            this.strategies.push(new SubStrategy(id, {
                name: `Matches Bot ${i}`,
                type: 'DIGITMATCH',
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100',
                duration: 1
            }));
        }

        // 55-64 New Higher Bots (Barrier: +1 for all)
        for (let i = 1; i <= 10; i++) {
            const id = i + 54;
            const prediction = '+1'; // User requested: strictly 1 for all!
            this.strategies.push(new SubStrategy(id, {
                name: `Higher Bot ${i}`,
                type: 'HIGHER',
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100',
                duration: 5
            }));
        }

        // 65-74 New Lower Bots (Barrier: -1 for all)
        for (let i = 1; i <= 10; i++) {
            const id = i + 64;
            const prediction = '-1'; // User requested: strictly 1 (-1 for Lower)
            this.strategies.push(new SubStrategy(id, {
                name: `Lower Bot ${i}`,
                type: 'LOWER',
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100',
                duration: 5
            }));
        }


        // 75 Hedge Match Bot
        this.strategies.push(new HedgeMatchBot(75, {
            name: `Hedge Match Bot 1`,
            symbol: '1HZ100V',
            stake: 0.35,
            duration: 1,
            tradeInterval: 1000,
            maxTotalStake: 9.5,
            digits: [0, 3, 2, 4, 1, 9, 6, 8, 5, 7]
        }));

        // 76-85 Hedge Higher/Lower Bots (10 Instances)
        for (let i = 0; i < 10; i++) {
            const botId = 76 + i;
            this.strategies.push(new HedgeHigherLowerBot(botId, {
                name: `Hedge Hi/Lo Bot ${i + 1}`,
                symbol: 'R_100',
                stake: 0.35,
                duration: 5,
                higherBarrier: '+1',
                lowerBarrier: '-1',
                triggerDigit: 5,
                triggerOperator: '='
            }));
        }

        // 86-95 Accumulator Bots: 10 SEPARATE INDEPENDENT BOTS
        this.strategies.push(new AccumulatorBot1(86, { symbol: 'R_100', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot2(87, { symbol: 'R_10', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot3(88, { symbol: 'R_75', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot4(89, { symbol: 'R_25', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot5(90, { symbol: 'R_50', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot6(91, { symbol: '1HZ100V', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot7(92, { symbol: '1HZ10V', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot8(93, { symbol: '1HZ75V', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot9(94, { symbol: '1HZ25V', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new AccumulatorBot10(95, { symbol: '1HZ50V', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));

        // 96-102 Boom Bots (7 Dedicated Bots)
        this.strategies.push(new BoomBot50(96, { symbol: 'BOOM50', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new BoomBot150(97, { symbol: 'BOOM150', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new BoomBot300(98, { symbol: 'BOOM300', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new BoomBot500(99, { symbol: 'BOOM500', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new BoomBot600(100, { symbol: 'BOOM600', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new BoomBot900(101, { symbol: 'BOOM900', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new BoomBot1000(102, { symbol: 'BOOM1000', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));

        // 103-109 Crash Bots (7 Dedicated Bots)
        this.strategies.push(new CrashBot50(103, { symbol: 'CRASH50', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new CrashBot150(104, { symbol: 'CRASH150', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new CrashBot300(105, { symbol: 'CRASH300', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new CrashBot500(106, { symbol: 'CRASH500', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new CrashBot600(107, { symbol: 'CRASH600', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new CrashBot900(108, { symbol: 'CRASH900', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
        this.strategies.push(new CrashBot1000(109, { symbol: 'CRASH1000', growthRate: 0.05, stake: 1.0, targetTicks: 10, maxCycles: 10, takeProfit: 50, stopLoss: -30 }));
    }

    onStart(bot) {
        console.log('>>> ALL BOTS LOADED <<<');
        this.strategies.forEach(s => s.onStart(bot));
    }

    async onTick(tick) {
        const now = Date.now();
        this.strategies.forEach(s => {
            s.onTick(tick, now).catch(e => {
                if (e.message && e.message.indexOf('not running') === -1) {
                    console.error(`[Strategy Error] Bot ${s.id}:`, e.message);
                }
            });
        });
    }
}

window.FourBotStrategy = FourBotStrategy;
