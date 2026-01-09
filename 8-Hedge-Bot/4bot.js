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
        this.takeProfit = config.takeProfit || 0.50;
        this.stopLoss = config.stopLoss || -10;
        this.triggerDigit = config.triggerDigit !== undefined ? config.triggerDigit : 5;
        this.triggerOperator = config.triggerOperator || '=';
        this.symbol = config.symbol || 'R_100';

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

                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(`[Bot ${this.id}] Target reached ($${this.sessionProfit.toFixed(2)}). Stopping.`);
                        this.stop();
                        return;
                    }

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

        this.takeProfit = config.takeProfit || 10;
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

                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(`[Bot ${this.id}] Target reached ($${this.sessionProfit.toFixed(2)}). Stopping.`);
                        this.stop();
                        return;
                    }

                    if (this.totalStake >= this.maxTotalStake && this.pendingContracts.size === 0) {
                        console.log(`[Bot ${this.id}] Max total stake reached. Stopping.`);
                        this.stop();
                    }
                }
            }
        } catch (e) {
            console.error(`[Bot ${this.id}] Error in Tick:`, e.message || e);
        } finally {
            this.isCheckingExit = false;
        }
    }

    async executeTrade() {
        if (!this.isRunning || this.isTrading || this.totalStake >= this.maxTotalStake) return;

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

        this.takeProfit = config.takeProfit || 10;
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

                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(`[Bot ${this.id}] Target reached ($${this.sessionProfit.toFixed(2)}). Stopping.`);
                        this.stop();
                        return;
                    }

                    if (this.totalStake >= this.maxTotalStake && this.pendingContracts.size === 0) {
                        console.log(`[Bot ${this.id}] Max total stake reached. Stopping.`);
                        this.stop();
                    }
                }
            }
        } catch (e) {
            console.error(`[Bot ${this.id}] Error in Tick:`, e.message || e);
        } finally {
            this.isCheckingExit = false;
        }
    }

    async executeTrade() {
        if (!this.isRunning || this.isTrading || this.totalStake >= this.maxTotalStake) return;

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
            if (this.totalStake >= this.maxTotalStake) break;
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
        this.barrier = config.barrier || '+0.1';

        this.takeProfit = config.takeProfit || 10;
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

                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(`[Bot ${this.id}] Target reached ($${this.sessionProfit.toFixed(2)}). Stopping.`);
                        this.stop();
                        return;
                    }

                    if (this.totalStake >= this.maxTotalStake && this.pendingContracts.size === 0) {
                        console.log(`[Bot ${this.id}] Max total stake reached. Stopping.`);
                        this.stop();
                    }
                }
            }
        } catch (e) {
            console.error(`[Bot ${this.id}] Error in Tick:`, e.message || e);
        } finally {
            this.isCheckingExit = false;
        }
    }

    async executeTrade() {
        if (!this.isRunning || this.isTrading || this.totalStake >= this.maxTotalStake) return;

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
            if (this.totalStake + this.stake > this.maxTotalStake) break;

            // Map types for the buy method (which maps HIGHER -> CALL, LOWER -> PUT)
            const contractType = type; // The buy wrapper in web-server handles HIGHER/LOWER already? Wait.

            try {
                // I need to check web-server.js buy wrapper for HIGHER/LOWER support
                const t = await this.bot.buy(contractType, this.stake, this.duration, this.durationUnit, this.barrier, this.symbol);
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

        this.takeProfit = config.takeProfit || 10;
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

                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(`[Bot ${this.id}] Target reached ($${this.sessionProfit.toFixed(2)}). Stopping.`);
                        this.stop();
                        return;
                    }

                    if (this.totalStake >= this.maxTotalStake && this.pendingContracts.size === 0) {
                        console.log(`[Bot ${this.id}] Max total stake reached. Stopping.`);
                        this.stop();
                    }
                }
            }
        } catch (e) { } finally {
            this.isCheckingExit = false;
        }
    }

    async executeTrade() {
        if (!this.isRunning || this.isTrading || this.totalStake >= this.maxTotalStake) return;

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

        this.takeProfit = config.takeProfit || 10;
        this.stopLoss = config.stopLoss || -10;

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

                        if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                            console.log(`[Bot ${this.id}] Target reached. Session Profit: ${this.sessionProfit.toFixed(2)}. Stopping.`);
                            this.stop();
                        }
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

        console.log(`🔥 [Bot ${this.id}] Pattern Detected: ${this.consecutiveCount} consecutive ${digit}'s! Buying DIGITDIFF ${digit}...`);

        try {
            const t = await this.bot.buy('DIGITDIFF', this.stake, this.duration, this.durationUnit, digit, this.symbol);
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
class FourBotStrategy {
    constructor() {
        this.strategies = [];
        const defaultStakes = [0.35, 0.40, 0.80, 1.64, 3.36, 6.88, 14.10, 28.90, 60];

        // 1-10 Over
        for (let i = 1; i <= 10; i++) {
            this.strategies.push(new SubStrategy(i, {
                name: `Over Bot ${i}`,
                type: 'DIGITOVER',
                prediction: 5,
                stakes: defaultStakes,
                symbol: 'R_100'
            }));
        }

        // 11-20 Under
        for (let i = 1; i <= 10; i++) {
            const id = i + 10;
            this.strategies.push(new SubStrategy(id, {
                name: `Under Bot ${i}`,
                type: 'DIGITUNDER',
                prediction: 4,
                stakes: defaultStakes,
                symbol: 'R_100'
            }));
        }

        // 21-25 Odd Bots
        for (let i = 1; i <= 5; i++) {
            const id = i + 20;
            this.strategies.push(new SubStrategy(id, {
                name: `Odd Bot ${i}`,
                type: 'DIGITODD',
                prediction: undefined,
                stakes: defaultStakes,
                symbol: 'R_100'
            }));
        }

        // 26-30 Even Bots
        for (let i = 1; i <= 5; i++) {
            const id = i + 25;
            this.strategies.push(new SubStrategy(id, {
                name: `Even Bot ${i}`,
                type: 'DIGITEVEN',
                prediction: undefined,
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
            barrier: '+0.1',
            duration: 5
        }));

        // 35-44 New Digit Differ Pattern Bots
        for (let i = 1; i <= 10; i++) {
            const id = i + 34;
            this.strategies.push(new DigitDifferPatternBot(id, {
                name: `Differ Bot ${i}`,
                stake: 0.35,
                stakes: defaultStakes,
                symbol: 'R_100',
                consecutiveCount: 4,
                takeProfit: 10,
                stopLoss: -50
            }));
        }

        // 45-54 New Digit Matches Bots
        for (let i = 1; i <= 10; i++) {
            const id = i + 44;
            this.strategies.push(new SubStrategy(id, {
                name: `Matches Bot ${i}`,
                type: 'DIGITMATCH',
                prediction: 5,
                stakes: defaultStakes,
                symbol: 'R_100',
                duration: 1
            }));
        }

        // 55-64 New Higher Bots
        for (let i = 1; i <= 10; i++) {
            const id = i + 54;
            this.strategies.push(new SubStrategy(id, {
                name: `Higher Bot ${i}`,
                type: 'CALL', // CALL is used for Higher when a barrier (+X) is provided
                prediction: '+0.1',
                stakes: defaultStakes,
                symbol: 'R_100',
                duration: 5
            }));
        }

        // 65-74 New Lower Bots
        for (let i = 1; i <= 10; i++) {
            const id = i + 64;
            this.strategies.push(new SubStrategy(id, {
                name: `Lower Bot ${i}`,
                type: 'PUT', // PUT is used for Lower when a barrier (-X) is provided
                prediction: '-0.1',
                stakes: defaultStakes,
                symbol: 'R_100',
                duration: 5
            }));
        }
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

module.exports = FourBotStrategy;
