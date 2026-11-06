'use strict';

// GROKBOT LIVE - bezpecny test
// Skutecne obchodovani je vypnute.
const LIVE_TRADING = false;
const CAPITAL_USD = 50;
const MAX_TRADE_USD = 5;

if (!LIVE_TRADING) {
  console.log('GROKBOT LIVE: TEST ONLY');
  console.log('Capital limit: $' + CAPITAL_USD);
  console.log('Trade limit: $' + MAX_TRADE_USD);
  console.log('No real transactions.');
}
