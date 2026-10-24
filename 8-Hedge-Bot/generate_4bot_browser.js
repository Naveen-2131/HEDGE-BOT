const fs = require('fs');

const sourcePath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/4bot.js';
const targetPath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/js/4bot-browser.js';

let code = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');

// 1. Module export -> browser window export
code = code.replace('module.exports = FourBotStrategy;', 'window.FourBotStrategy = FourBotStrategy;');

// 2. SubStrategy: remove takeProfit / stopLoss auto stop
const subStrategyStop = `                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(\`[Bot \${this.id}] Target reached (\$\${this.sessionProfit.toFixed(2)}). Stopping.\`);
                        this.stop();
                        return;
                    }`;
if (code.includes(subStrategyStop)) {
  code = code.replace(subStrategyStop, '                    // Target profit/loss limits removed - runs unlimited');
  console.log('✅ SubStrategy profit stop removed');
}

// 3. OddEvenPatternBot:
// A. onTick: release stake on sold, remove auto-stops
const oddEvenOnTickOld = `                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(\`[Bot \${this.id}] Target reached (\$\${this.sessionProfit.toFixed(2)}). Stopping.\`);
                        this.stop();
                        return;
                    }

                    if (this.totalStake >= this.maxTotalStake && this.pendingContracts.size === 0) {
                        console.log(\`[Bot \${this.id}] Max total stake reached. Stopping.\`);
                        this.stop();
                    }`;

const oddEvenOnTickNew = `                    // Release active stake so trading runs unlimited
                    this.totalStake = Math.max(0, this.totalStake - this.stake);
                    // Unlimited: no auto-stop on stake or profit limits`;

if (code.includes(oddEvenOnTickOld)) {
  code = code.replace(oddEvenOnTickOld, oddEvenOnTickNew);
  console.log('✅ OddEvenPatternBot onTick stop removed');
}

// B. OddEvenPatternBot: executeTrade remove maxTotalStake guard
code = code.replace(
  'if (!this.isRunning || this.isTrading || this.totalStake >= this.maxTotalStake) return;',
  'if (!this.isRunning || this.isTrading) return;'
);

// 4. OverUnderPatternBot:
// A. onTick: release stake, remove stops
const overUnderOnTickOld = `                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(\`[Bot \${this.id}] Target reached (\$\${this.sessionProfit.toFixed(2)}). Stopping.\`);
                        this.stop();
                        return;
                    }

                    if (this.totalStake >= this.maxTotalStake && this.pendingContracts.size === 0) {
                        console.log(\`[Bot \${this.id}] Max total stake reached. Stopping.\`);
                        this.stop();
                    }`;

const overUnderOnTickNew = `                    // Release active stake so trading runs unlimited
                    this.totalStake = Math.max(0, this.totalStake - this.stake);
                    // Unlimited: no auto-stop on stake or profit limits`;

if (code.includes(overUnderOnTickOld)) {
  code = code.replace(overUnderOnTickOld, overUnderOnTickNew);
  console.log('✅ OverUnderPatternBot onTick stop removed');
}

// B. OverUnderPatternBot: executeTrade remove maxTotalStake guard
code = code.replace(
  'if (!this.isRunning || this.isTrading || this.totalStake >= this.maxTotalStake) return;',
  'if (!this.isRunning || this.isTrading) return;'
);
code = code.replace('if (this.totalStake >= this.maxTotalStake) break;', '// Unlimited stake');

// 5. HigherLowerPatternBot:
// A. Default barrier: '+1'
code = code.replace("this.barrier = config.barrier || '0.1';", "this.barrier = config.barrier || '+1';");
code = code.replace("this.barrier = config.barrier || '+0.1';", "this.barrier = config.barrier || '+1';");

// B. onTick: release stake, remove stops
const higherLowerOnTickOld = `                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(\`[Bot \${this.id}] Target reached (\$\${this.sessionProfit.toFixed(2)}). Stopping.\`);
                        this.stop();
                        return;
                    }

                    if (this.totalStake >= this.maxTotalStake && this.pendingContracts.size === 0) {
                        console.log(\`[Bot \${this.id}] Max total stake reached. Stopping.\`);
                        this.stop();
                    }`;

const higherLowerOnTickNew = `                    // Release active stake so trading runs unlimited
                    this.totalStake = Math.max(0, this.totalStake - this.stake);
                    // Unlimited: no auto-stop on stake or profit limits`;

if (code.includes(higherLowerOnTickOld)) {
  code = code.replace(higherLowerOnTickOld, higherLowerOnTickNew);
  console.log('✅ HigherLowerPatternBot onTick stop removed');
}

// C. HigherLowerPatternBot: executeTrade remove maxTotalStake guard & ensure +1/-1 barrier
code = code.replace(
  'if (!this.isRunning || this.isTrading || this.totalStake >= this.maxTotalStake) return;',
  'if (!this.isRunning || this.isTrading) return;'
);
code = code.replace('if (this.totalStake + this.stake > this.maxTotalStake) break;', '// Unlimited stake');

const oldHlExecuteTradeInner = `            // Map types for the buy method (which maps HIGHER -> CALL, LOWER -> PUT)
            const contractType = type; // The buy wrapper in web-server handles HIGHER/LOWER already? Wait.

            try {
                // I need to check web-server.js buy wrapper for HIGHER/LOWER support
                const t = await this.bot.buy(contractType, this.stake, this.duration, this.durationUnit, this.barrier, this.symbol);`;

const newHlExecuteTradeInner = `            const contractType = type;
            const barrierVal = (this.barrier || '1').toString().replace(/^[+-]/, '') || '1';
            const tradeBarrier = (type === 'LOWER') ? \`-\${barrierVal}\` : \`+\${barrierVal}\`;

            try {
                const t = await this.bot.buy(contractType, this.stake, this.duration, this.durationUnit, tradeBarrier, this.symbol);`;

if (code.includes(oldHlExecuteTradeInner)) {
  code = code.replace(oldHlExecuteTradeInner, newHlExecuteTradeInner);
  console.log('✅ HigherLowerPatternBot barrier +1/-1 logic updated');
} else {
  console.log('❌ Could not find oldHlExecuteTradeInner');
}

// 6. RiseFallPatternBot:
// A. onTick: release stake, remove stops
const riseFallOnTickOld = `                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(\`[Bot \${this.id}] Target reached (\$\${this.sessionProfit.toFixed(2)}). Stopping.\`);
                        this.stop();
                        return;
                    }

                    if (this.totalStake >= this.maxTotalStake && this.pendingContracts.size === 0) {
                        console.log(\`[Bot \${this.id}] Max total stake reached. Stopping.\`);
                        this.stop();
                    }`;

const riseFallOnTickNew = `                    // Release active stake so trading runs unlimited
                    this.totalStake = Math.max(0, this.totalStake - this.stake);
                    // Unlimited: no auto-stop on stake or profit limits`;

if (code.includes(riseFallOnTickOld)) {
  code = code.replace(riseFallOnTickOld, riseFallOnTickNew);
  console.log('✅ RiseFallPatternBot onTick stop removed');
}

// B. RiseFallPatternBot: executeTrade remove maxTotalStake guard
code = code.replace(
  'if (!this.isRunning || this.isTrading || this.totalStake >= this.maxTotalStake) return;',
  'if (!this.isRunning || this.isTrading) return;'
);

// 7. DigitDifferPatternBot:
// Remove profit/loss auto stop
const differProfitStop = `                        if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                            console.log(\`[Bot \${this.id}] Target reached. Session Profit: \${this.sessionProfit.toFixed(2)}. Stopping.\`);
                            this.stop();
                        }`;
if (code.includes(differProfitStop)) {
  code = code.replace(differProfitStop, '                        // Unlimited: no auto-stop on profit/loss limits');
  console.log('✅ DigitDifferPatternBot profit stop removed');
}

// 8. HedgeMatchBot:
// Remove maxTotalStake stop
const hedgeMatchStop = `                    if (!this.isRunning || (this.totalStake >= this.maxTotalStake && this.openContracts.size === 0)) {
                        console.log(\`[Bot \${this.id}] All contracts finished. Stopping.\`);
                        this.stop();
                    }`;
if (code.includes(hedgeMatchStop)) {
  code = code.replace(hedgeMatchStop, '                    // Unlimited: no auto-stop on max stake');
  console.log('✅ HedgeMatchBot maxTotalStake stop removed');
}

// 9. HedgeHigherLowerBot:
// A. Default barriers: '+1' and '-1'
code = code.replace("this.higherBarrier = config.higherBarrier || '+0.1';", "this.higherBarrier = config.higherBarrier || '+1';");
code = code.replace("this.lowerBarrier = config.lowerBarrier || '-0.1';", "this.lowerBarrier = config.lowerBarrier || '-1';");

// B. Remove profit/loss stop
const hedgeHiLoStop = `                    if (this.sessionProfit >= this.takeProfit || this.sessionProfit <= this.stopLoss) {
                        console.log(\`[Bot \${this.id}] Target reached. Session Profit: \${this.sessionProfit.toFixed(2)}. Stopping.\`);
                        this.stop();
                    }`;
if (code.includes(hedgeHiLoStop)) {
  code = code.replace(hedgeHiLoStop, '                    // Unlimited: no auto-stop on profit/loss limits');
  console.log('✅ HedgeHigherLowerBot profit stop removed');
}

// C. Buy HIGHER and LOWER (not CALL and PUT)
const oldHedgeHiLoBuy = `        const hBarrier = this.higherBarrier;
        const lBarrier = this.lowerBarrier;

        let currentStake = this.stake;

        try {
            const results = await Promise.allSettled([
                this.bot.buy('CALL', currentStake, this.duration, this.durationUnit, hBarrier, this.symbol),
                this.bot.buy('PUT', currentStake, this.duration, this.durationUnit, lBarrier, this.symbol)
            ]);`;

const newHedgeHiLoBuy = `        const hVal = (this.higherBarrier || '1').toString().replace(/^[+-]/, '') || '1';
        const lVal = (this.lowerBarrier || '1').toString().replace(/^[+-]/, '') || '1';
        const hBarrier = \`+\${hVal}\`;
        const lBarrier = \`-\${lVal}\`;
        const duration = Math.max(5, parseInt(this.duration) || 5);

        let currentStake = this.stake;

        try {
            const results = await Promise.allSettled([
                this.bot.buy('HIGHER', currentStake, duration, this.durationUnit, hBarrier, this.symbol),
                this.bot.buy('LOWER', currentStake, duration, this.durationUnit, lBarrier, this.symbol)
            ]);`;

if (code.includes(oldHedgeHiLoBuy)) {
  code = code.replace(oldHedgeHiLoBuy, newHedgeHiLoBuy);
  console.log('✅ HedgeHigherLowerBot buy updated to HIGHER/LOWER');
} else {
  console.log('❌ Could not find oldHedgeHiLoBuy');
}

// 10. FourBotStrategy:
// A. Bot 34 default barrier: '+1'
code = code.replace("barrier: '0.1',", "barrier: '+1',");
code = code.replace("barrier: '+0.1',", "barrier: '+1',");

// B. Differ bots: consecutiveCount: 3
code = code.replace(/consecutiveCount: 4,/g, 'consecutiveCount: 3,');

// C. Higher Bots (55-64): type HIGHER, prediction '+1'
const oldHigherLoop = `        // 55-64 New Higher Bots
        for (let i = 1; i <= 10; i++) {
            const id = i + 54;
            const prediction = i === 10 ? '+0' : \`+\${i}\`;
            this.strategies.push(new SubStrategy(id, {
                name: \`Higher Bot \${i}\`,
                type: 'CALL', // CALL is used for Higher when a barrier (+X) is provided
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100',
                duration: 5
            }));
        }`;

const newHigherLoop = `        // 55-64 New Higher Bots (Barrier: +1 for all)
        for (let i = 1; i <= 10; i++) {
            const id = i + 54;
            const prediction = '+1'; // User requested: strictly 1 for all!
            this.strategies.push(new SubStrategy(id, {
                name: \`Higher Bot \${i}\`,
                type: 'HIGHER',
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100',
                duration: 5
            }));
        }`;

if (code.includes(oldHigherLoop)) {
  code = code.replace(oldHigherLoop, newHigherLoop);
  console.log('✅ Higher Bots loop updated to HIGHER with +1');
} else {
  console.log('❌ Could not find oldHigherLoop');
}

// D. Lower Bots (65-74): type LOWER, prediction '-1'
const oldLowerLoop = `        // 65-74 New Lower Bots
        for (let i = 1; i <= 10; i++) {
            const id = i + 64;
            const prediction = i === 10 ? '-0' : \`-\${i}\`;
            this.strategies.push(new SubStrategy(id, {
                name: \`Lower Bot \${i}\`,
                type: 'PUT', // PUT is used for Lower when a barrier (-X) is provided
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100',
                duration: 5
            }));
        }`;

const newLowerLoop = `        // 65-74 New Lower Bots (Barrier: -1 for all)
        for (let i = 1; i <= 10; i++) {
            const id = i + 64;
            const prediction = '-1'; // User requested: strictly 1 (-1 for Lower)
            this.strategies.push(new SubStrategy(id, {
                name: \`Lower Bot \${i}\`,
                type: 'LOWER',
                prediction: prediction,
                stakes: defaultStakes,
                symbol: 'R_100',
                duration: 5
            }));
        }`;

if (code.includes(oldLowerLoop)) {
  code = code.replace(oldLowerLoop, newLowerLoop);
  console.log('✅ Lower Bots loop updated to LOWER with -1');
} else {
  console.log('❌ Could not find oldLowerLoop');
}

// E. Hedge Hi/Lo Bots (76-85): higherBarrier '+1', lowerBarrier '-1'
const oldHedgeLoop = `        // 76-85 Hedge Higher/Lower Bots (10 Instances)
        for (let i = 0; i < 10; i++) {
            const botId = 76 + i;
            this.strategies.push(new HedgeHigherLowerBot(botId, {
                name: \`Hedge Hi/Lo Bot \${i + 1}\`,
                symbol: 'R_100',
                stake: 0.35,
                duration: 5,
                higherBarrier: '+0.1',
                lowerBarrier: '-0.1',
                triggerDigit: 5,
                triggerOperator: '='
            }));
        }`;

const newHedgeLoop = `        // 76-85 Hedge Higher/Lower Bots (10 Instances)
        for (let i = 0; i < 10; i++) {
            const botId = 76 + i;
            this.strategies.push(new HedgeHigherLowerBot(botId, {
                name: \`Hedge Hi/Lo Bot \${i + 1}\`,
                symbol: 'R_100',
                stake: 0.35,
                duration: 5,
                higherBarrier: '+1',
                lowerBarrier: '-1',
                triggerDigit: 5,
                triggerOperator: '='
            }));
        }`;

if (code.includes(oldHedgeLoop)) {
  code = code.replace(oldHedgeLoop, newHedgeLoop);
  console.log('✅ Hedge Hi/Lo loop updated to +1 and -1');
} else {
  console.log('❌ Could not find oldHedgeLoop');
}

// 11. Clean error logging in tick handlers so rate limit errors never spam
code = code.replace(
  /console\.error\(`\[Bot \$\{this\.id\}\] Error in Tick:`, e\.message \|\| e\);/g,
  `if (!e.message || !e.message.includes('rate limit')) console.error(\`[Bot \${this.id}] Error in Tick:\`, e.message || e);`
);

fs.writeFileSync(targetPath, code, 'utf8');
console.log('🎉 4bot-browser.js generated successfully from 4bot.js!');
