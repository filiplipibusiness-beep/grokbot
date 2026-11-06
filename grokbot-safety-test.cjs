'use strict';

// GROKBOT safety test - no real trading
const CAPITAL_USD = 50;
const MAX_TRADE_USD = 5;
const LIVE_TRADING = false;

function checkTrade(amount) {
  return Number.isFinite(amount) &&
    amount > 0 &&
    amount <= MAX_TRADE_USD &&
    amount <= CAPITAL_USD;
}

const assert = require('node:assert/strict');
assert.equal(LIVE_TRADING, false);
assert.equal(checkTrade(5), true);
assert.equal(checkTrade(6), false);
assert.equal(checkTrade(-1), false);
assert.equal(checkTrade(NaN), false);
console.log('GROKBOT SAFETY TEST: OK - no real trades');
