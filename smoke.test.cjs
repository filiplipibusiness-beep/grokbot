const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8').replace(/\binit\(\);\s*$/,'');
const els=new Map();
const el=id=>{if(!els.has(id))els.set(id,{textContent:'',classList:{toggle(){},add(){}},value:'',innerHTML:'',addEventListener(){}});return els.get(id)};
const context={console,Date,Math,Number,String,JSON,Map,Set,Array,Promise,AbortController,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,document:{getElementById:el},localStorage:{getItem(){return null},setItem(){}},fetch:async()=>{throw Error('network disabled')}};
vm.createContext(context);vm.runInContext(src,context);
const run=expr=>vm.runInContext(expr,context);
assert.equal(run('dateKey(new Date(2026,0,5).getTime())'),'2026-01-05');
assert.equal(run('priceOf("missing")'),null);
assert.equal(run('openPosition({address:"x",price:1,liq:100000,symbol:"X"})'),false,'No trade on stale data');
const series=[
 {ts:0,price:1,score:90},{ts:45000,price:1.005,score:90},
 {ts:90000,price:1.02,score:90},{ts:135000,price:1.03,score:90},
 {ts:180000,price:1.04,score:90},{ts:225000,price:1.4,score:90}
];
context.testSeries=series;
assert.equal(run('backtestSeries(testSeries,70,8,16,0,6).trades'),1,'Entry is delayed and target closes');
assert.equal(run('backtestSeries(testSeries.slice(0,5),70,8,16,0,5).trades'),0,'Open position is not closed');
assert.ok(run('backtestSeries(testSeries.slice(0,5),70,8,16,0,5).profit')<0,'Open positions include execution costs');
assert.equal(run('backtestSeries(testSeries.slice(0,3),70,8,16,0,3).trades'),0,'No lookahead');
run('lastRefresh=Date.now();tokens=[{address:"x",name:"Test",price:1,liq:100000,symbol:"X",score:95,risks:[]}];');
assert.equal(run('openPosition(tokens[0])'),true);
assert.ok(run('state.positions[0].qty')<150);
assert.equal(run('closePosition(state.positions[0],1,"test")'),true);
assert.ok(run('state.trades.at(-1).pnl')<0,'Fees and slippage must be reflected');
assert.equal(run('signalCheck({address:"x",price:1,liq:1000,volume:100000,weight:100,score:90,risks:[]})'),'nízká likvidita');
assert.equal(run('signalCheck({address:"x",price:1,liq:100000,volume:100000,weight:100,score:90,risks:[]})'),'málo historických dat');
console.log('Smoke tests passed');
