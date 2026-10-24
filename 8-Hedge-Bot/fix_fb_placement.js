const fs = require('fs');

const fbPath = 'C:/Users/ADMIN/Desktop/HEDGE-BOT-main/8-Hedge-Bot/public/js/4bot-browser.js';
let fb = fs.readFileSync(fbPath, 'utf8').replace(/\r\n/g, '\n');

// 1. Remove misplaced accumulator loop from SubStrategy
const misplacedLoop = `        // 86-95 Accumulator Bots (10 Instances)
        for (let i = 1; i <= 10; i++) {
            const botId = 85 + i;
            this.strategies.push(new AccumulatorBot(botId, {
                name: \`Accumulator Bot \${i}\`,
                symbol: 'R_100',
                growthRate: 0.05,
                stake: 1.0,
                targetTicks: 10,
                maxCycles: 10,
                takeProfit: 50,
                stopLoss: -30
            }));
        }`;

fb = fb.replace(misplacedLoop, '');

// 2. Insert accumulator loop inside FourBotStrategy constructor after Hedge Hi/Lo bots
const hedgeHiLoLoop = `        // 76-85 Hedge Higher/Lower Bots (10 Instances)
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

const correctInsertion = hedgeHiLoLoop + `\n\n        // 86-95 Accumulator Bots (10 Instances)
        for (let i = 1; i <= 10; i++) {
            const botId = 85 + i;
            this.strategies.push(new AccumulatorBot(botId, {
                name: \`Accumulator Bot \${i}\`,
                symbol: 'R_100',
                growthRate: 0.05,
                stake: 1.0,
                targetTicks: 10,
                maxCycles: 10,
                takeProfit: 50,
                stopLoss: -30
            }));
        }`;

if (fb.includes(hedgeHiLoLoop)) {
  fb = fb.replace(hedgeHiLoLoop, correctInsertion);
  console.log('✅ Correctly placed Accumulator Bots in FourBotStrategy');
} else {
  console.log('❌ Could not find hedgeHiLoLoop in FourBotStrategy');
}

fs.writeFileSync(fbPath, fb, 'utf8');
