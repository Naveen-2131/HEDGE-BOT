const express = require('express');
const path = require('path');
const DerivAPI = require('@deriv/deriv-api');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const FourBotStrategy = require('./4bot');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Mutable Credentials (defaults provided by user)
let APP_ID = process.env.APP_ID || 118515;
let TOKEN = process.env.DERIV_TOKEN || 'BwDAE6dzfr7FOak';

// --- Logger Setup ---
const logBuffer = [];
const liveBotLogBuffer = [];
const MAX_LOGS = 50;
const originalLog = console.log;
const originalError = console.error;

function logToBuffer(type, args) {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
    const time = new Date().toLocaleTimeString();
    const formatted = `[${time}] [${type}] ${msg}`;

    logBuffer.unshift(formatted);
    if (logBuffer.length > MAX_LOGS) logBuffer.pop();

    // Live Bot Buffer (All Bots 1-32)
    if (msg.includes('[Bot')) {
        liveBotLogBuffer.unshift(formatted);
        if (liveBotLogBuffer.length > MAX_LOGS) liveBotLogBuffer.pop();
    }
}

console.log = function (...args) {
    logToBuffer('INFO', args);
    originalLog.apply(console, args);
    if (typeof broadcastStatus === 'function') broadcastStatus();
};

console.error = function (...args) {
    logToBuffer('ERROR', args);
    originalError.apply(console, args);
    if (typeof broadcastStatus === 'function') broadcastStatus();
};
// --------------------

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global State
let strategy = null;
let api = null;
let connection = null;
let tickSubscription = null;
let isConnected = false;
let initTimer = null;

function debounceInitDeriv() {
    console.log('⏳ Update detected. Scheduling reconnection in 2s...');
    if (initTimer) clearTimeout(initTimer);
    initTimer = setTimeout(() => {
        initDeriv();
    }, 2000);
}

// Initialize Deriv API
async function initDeriv() {
    console.log(`🚀 Initializing Deriv API (App ID: ${APP_ID})...`);
    isConnected = false;

    // Close existing connection/streams
    if (tickSubscription) {
        try { tickSubscription.unsubscribe(); } catch (e) { }
        tickSubscription = null;
    }
    if (connection) {
        try { connection.close(); } catch (e) { }
        connection = null;
    }

    connection = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`);

    connection.on('open', () => {
        console.log('✅ WebSocket Connected');
        isConnected = true;
    });

    connection.on('close', () => {
        isConnected = false;
        console.log('❌ WebSocket Disconnected');
    });

    connection.on('error', (err) => {
        console.error('❌ WebSocket Error:', err);
        isConnected = false;
    });

    api = new DerivAPI({ connection });

    try {
        console.log('🔑 Authorizing...');
        const auth = await api.basic.authorize({ authorize: TOKEN });

        if (auth.error) {
            console.error('❌ Auth Failed:', auth.error);
            return;
        }

        console.log(`✅ Authorized: ${auth.authorize.fullname} (${auth.authorize.loginid})`);
        const account = {
            currency: auth.authorize.currency,
            balance: auth.authorize.balance,
            fullname: auth.authorize.fullname
        };

        // Initialize Strategy if not exists
        if (!strategy) {
            strategy = new FourBotStrategy();
        }

        // Mock Bot Interface
        const botInterface = {
            api: api,
            balance: account.balance,
            checkContract: async (id) => {
                try {
                    const res = await api.basic.proposalOpenContract({ contract_id: id });
                    if (res.error) {
                        console.error('CheckContract Error:', res.error);
                        return null;
                    }
                    return res.proposal_open_contract ? {
                        is_sold: res.proposal_open_contract.is_sold,
                        profit: res.proposal_open_contract.profit,
                        status: res.proposal_open_contract.status
                    } : null;
                } catch (e) { console.error('CheckContract Exception:', e); return null; }
            },
            buy: async (type, amount, duration, unit, prediction, symbol) => {
                let contractType = type;
                if (type === 'RISE' || type === 'HIGHER') contractType = 'CALL';
                else if (type === 'FALL' || type === 'LOWER') contractType = 'PUT';

                const req = {
                    proposal: 1,
                    contract_type: contractType,
                    currency: account && account.currency ? account.currency : 'USD',
                    symbol: symbol || 'R_100',
                    duration: parseInt(duration),
                    duration_unit: unit || 't',
                    basis: 'stake',
                    amount: parseFloat(amount).toFixed(2) // Some Deriv types require string, others Number. toFixed returns string which is usually safest.
                };

                if (prediction !== undefined && prediction !== null && prediction !== "") {
                    // DIGITOVER, DIGITUNDER, and DIGITMATCH use 'barrier' for the prediction
                    if (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER' || contractType === 'DIGITMATCH') {
                        req.barrier = prediction.toString();
                    }
                    // DIGITDIFF uses 'last_digit_prediction'
                    else if (contractType === 'DIGITDIFF') {
                        req.last_digit_prediction = parseInt(prediction);
                    }
                    // Higher/Lower and other non-digit contracts use 'barrier'
                    else if (!contractType.includes('DIGIT')) {
                        req.barrier = prediction.toString();
                    }
                    // Note: DIGITODD and DIGITEVEN do not need a prediction field.
                }


                const proposal = await api.basic.proposal(req);
                if (proposal.error) {
                    console.error('Proposal Request:', JSON.stringify(req));
                    console.error('Proposal Error Response:', JSON.stringify(proposal));
                    const msg = proposal.error.message || proposal.error.code || "Unknown Proposal Error";
                    throw new Error(msg);
                }

                if (!proposal.proposal) {
                    console.error('Proposal Missing:', JSON.stringify(proposal));
                    throw new Error("Proposal not received from API");
                }

                const buy = await api.basic.buy({ buy: proposal.proposal.id, price: parseFloat(amount) });
                if (buy.error) {
                    console.error('Buy Error Response:', JSON.stringify(buy));
                    const msg = buy.error.message || buy.error.code || "Unknown Buy Error";
                    throw new Error(msg);
                }

                return { contract_id: buy.buy.contract_id };
            }
        };

        // Bind/Rebind Bot Interface
        strategy.onStart(botInterface);

        // Tick Stream (Dynamic Symbols)
        const symbols = [...new Set(strategy.strategies.map(s => s.symbol || 'R_100'))];
        console.log(`📡 Subscribing to ticks for: ${symbols.join(', ')}`);

        // Subscribe to each symbol individually to be safe
        symbols.forEach(symbol => {
            api.basic.ticks({ ticks: symbol }).catch(err => {
                console.error(`❌ Subscription Error (${symbol}):`, err.message || err);
            });
        });

        // Listen for ticks via the raw WebSocket connection for maximum reliability
        connection.on('message', (rawData) => {
            try {
                const data = JSON.parse(rawData);
                if (data.msg_type === 'tick' && strategy) {
                    const tick = {
                        quote: parseFloat(data.tick.quote),
                        symbol: data.tick.symbol,
                        epoch: data.tick.epoch
                    };
                    strategy.onTick(tick);
                }
            } catch (e) { }
        });

        isConnected = true;

    } catch (e) {
        console.error('Deriv Init Error:', e.message || e);
        isConnected = false;
    }
}

// API Routes
app.get('/api/status', (req, res) => {
    if (!strategy) return res.status(503).json({ error: 'Initializing' });

    const bots = strategy.strategies.map(s => {
        const baseConfig = {
            stake: s.baseStake || s.stake,
            symbol: s.symbol || 'R_100'
        };

        // specialized config for Bot 31
        const config = {
            ...baseConfig,
            prediction: s.prediction,
            stopLoss: s.stopLoss,
            takeProfit: s.takeProfit,
            martingaleStakes: s.martingaleStakes || [],
            cooldown: 0,
            triggerDigit: s.triggerDigit !== undefined ? s.triggerDigit : 5,
            triggerOperator: s.triggerOperator || '=',
            duration: s.duration || 1
        };

        if (s.id === 31 || s.id === 32 || s.id === 33 || s.id === 34) {
            config.pattern = (s.tradePattern || []).join(', ');
            config.interval = s.minInterval;
            config.maxTotalStake = s.maxTotalStake;
            config.isRandom = s.isRandom;
            if (s.id === 33 || s.id === 34) config.barrier = s.barrier;
        }

        if (s.id >= 35 && s.id <= 44) {
            config.consecutiveCount = s.consecutiveCount;
            config.martingaleStakes = (s.martingaleStakes || []).join(', ');
        }

        if (s.id === 75) {
            config.digits = (s.predictionDigits || []).join(', ');
            config.tradeInterval = s.tradeInterval;
            config.maxTotalStake = s.maxTotalStake;
            config.appId = s.appId;
            config.apiToken = s.apiToken;
            config.duration = s.duration;
        }

        if (s.id >= 76 && s.id <= 85) {
            config.higherBarrier = s.higherBarrier;
            config.lowerBarrier = s.lowerBarrier;
            config.triggerDigit = s.triggerDigit;
            config.triggerOperator = s.triggerOperator;
            config.martingaleStakes = s.martingaleStakes;
            config.duration = s.duration;
        }

        return {
            id: s.id,
            name: s.name,
            isRunning: s.isRunning,
            profit: s.sessionProfit,
            config
        };
    });
    res.json({
        bots,
        totalProfit: strategy.strategies.reduce((a, b) => a + b.sessionProfit, 0),
        balance: api && strategy && strategy.strategies[0] ? strategy.strategies[0].bot.balance : 0,
        settings: { appId: APP_ID, token: '******' },
        connected: isConnected
    });
});

app.post('/api/settings', (req, res) => {
    const { appId, token } = req.body;
    let changed = false;
    if (appId && appId != APP_ID) {
        APP_ID = appId;
        changed = true;
    }
    if (token && token !== TOKEN) {
        TOKEN = token;
        changed = true;
    }

    if (changed) {
        console.log('🔄 Credentials updated. Reconnecting...');
        initDeriv();
        res.json({ success: true, message: 'Reconnecting with new credentials...' });
    } else {
        res.json({ success: true, message: 'No changes detected.' });
    }
});

app.post('/api/start/:id', (req, res) => {
    if (!strategy) return res.status(503).json({ error: 'Bot not initialized' });
    const id = parseInt(req.params.id);
    const bot = strategy.strategies.find(s => s.id === id);
    if (bot) {
        bot.start();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Bot not found' });
    }
});

app.post('/api/stop/:id', (req, res) => {
    if (!strategy) return res.status(503).json({ error: 'Bot not initialized' });
    const id = parseInt(req.params.id);
    const bot = strategy.strategies.find(s => s.id === id);
    if (bot) {
        bot.stop();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Bot not found' });
    }
});

app.post('/api/update/:id', (req, res) => {
    if (!strategy) return res.status(503).json({ error: 'Bot not initialized' });
    const id = parseInt(req.params.id);
    const config = req.body;
    const bot = strategy.strategies.find(s => s.id === id);
    if (bot) {
        const {
            stake, prediction, stopLoss, takeProfit, martingaleStakes,
            triggerDigit, triggerOperator, symbol, duration,
            pattern, interval, maxTotalStake, barrier, consecutiveCount
        } = req.body;

        console.log(`\n[API] Updating Bot ${id}:`, JSON.stringify(req.body));

        // Basic fields
        if (stake !== undefined) {
            bot.stake = parseFloat(stake);
            bot.baseStake = bot.stake;
            if (bot.martingaleStakes && bot.martingaleStakes.length > 0) {
                bot.martingaleStakes[0] = bot.stake;
            }
        }

        if (prediction !== undefined) {
            if (id >= 55 && id <= 74) {
                bot.prediction = prediction.toString();
            } else {
                bot.prediction = parseInt(prediction);
            }
        }

        if (stopLoss !== undefined) bot.stopLoss = parseFloat(stopLoss);
        if (takeProfit !== undefined) bot.takeProfit = parseFloat(takeProfit);

        if (martingaleStakes !== undefined) {
            let stakesArr = [];
            if (Array.isArray(martingaleStakes)) {
                stakesArr = martingaleStakes;
            } else if (typeof martingaleStakes === 'string') {
                stakesArr = martingaleStakes.split(',').map(s => parseFloat(s.trim())).filter(s => !isNaN(s));
            }

            if (stakesArr.length > 0) {
                bot.martingaleStakes = stakesArr;
                bot.maxMartingaleLevel = bot.martingaleStakes.length - 1;
                bot.baseStake = bot.martingaleStakes[0]; // Martingale first index is always the reset stake
            }
        }

        if (triggerDigit !== undefined) bot.triggerDigit = parseInt(triggerDigit);
        if (triggerOperator !== undefined) bot.triggerOperator = triggerOperator;

        if (symbol !== undefined && symbol !== bot.symbol) {
            console.log(`[Bot ${id}] Symbol changed: ${bot.symbol} -> ${symbol}`);
            bot.symbol = symbol;
            debounceInitDeriv();
        }

        if (duration !== undefined) bot.duration = parseInt(duration);

        // Pattern Bot specific fields (31, 32, 33, 34)
        if (id === 31 || id === 32 || id === 33 || id === 34) {
            if (pattern !== undefined) {
                const arr = pattern.split(',').map(p => p.trim().toUpperCase()).filter(p => p !== "");
                bot.tradePattern = arr;
                bot.isRandom = (arr.length === 0);
            }
            if (interval !== undefined) bot.minInterval = parseInt(interval);
            if (maxTotalStake !== undefined) bot.maxTotalStake = parseFloat(maxTotalStake);
            if ((id === 33 || id === 34) && barrier !== undefined) bot.barrier = barrier;
            // Also update stake for pattern bots
            if (stake !== undefined) bot.stake = parseFloat(stake);
        }

        // Hedge Match Bot specific fields (75)
        if (id === 75) {
            const { digits, tradeInterval, maxTotalStake, appId, apiToken } = req.body;
            if (digits !== undefined) {
                bot.predictionDigits = digits.split(',').map(d => parseInt(d.trim())).filter(n => !isNaN(n));
            }
            if (tradeInterval !== undefined) bot.tradeInterval = parseInt(tradeInterval);
            if (maxTotalStake !== undefined) bot.maxTotalStake = parseFloat(maxTotalStake);
            if (appId !== undefined) bot.appId = appId;
            if (apiToken !== undefined) bot.apiToken = apiToken;
        }

        if (id >= 76 && id <= 85) {
            const { higherBarrier, lowerBarrier, martingaleStr, triggerDigit, triggerOperator } = req.body;
            if (higherBarrier !== undefined) bot.higherBarrier = higherBarrier;
            if (lowerBarrier !== undefined) bot.lowerBarrier = lowerBarrier;
            if (martingaleStr !== undefined) {
                bot.martingaleStakes = martingaleStr.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
                bot.maxMartingaleLevel = bot.martingaleStakes.length - 1;
            }
            if (triggerDigit !== undefined) bot.triggerDigit = parseInt(triggerDigit);
            if (triggerOperator !== undefined) bot.triggerOperator = triggerOperator;
        }

        console.log(`✅ [Bot ${id}] Configuration Applied. Stake: ${bot.stake}, BaseStake: ${bot.baseStake}, MartingaleLevels: ${bot.maxMartingaleLevel + 1}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Bot not found' });
    }
});

app.post('/api/start-all', (req, res) => {
    if (!strategy) return res.status(503).json({ error: 'Bot not initialized' });
    strategy.strategies.forEach(s => s.start());
    res.json({ success: true });
});

app.post('/api/stop-all', (req, res) => {
    if (!strategy) return res.status(503).json({ error: 'Bot not initialized' });
    strategy.strategies.forEach(s => s.stop());
    res.json({ success: true });
});

app.get('/api/logs', (req, res) => {
    res.json({ logs: logBuffer });
});

app.get('/api/logs/21', (req, res) => {
    res.json({ logs: liveBotLogBuffer });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    initDeriv();
});
