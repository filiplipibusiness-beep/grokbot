'use strict';
// GROKBOT scheduled PAPER runner. No wallet, keys, or blockchain writes.
const fs = require('node:fs');
const crypto = require('node:crypto');
const API = 'https://api.dexscreener.com';
const PATH = 'bot-state.json';
const FEE = 0.0025, SLIP = 0.005, MAX_AGE = 90_000, COOLDOWN = 6 * 3600_000;
const DEFAULT = {cash:10000,settings:{positionSize:150,maxPositions:3,dailyLimit:400,entryScore:70,stopLoss:8,takeProfit:16},positions:[],trades:[],history:{},running:true,lastRun:null,lastStatus:'Not run yet'};
const finite = x => x === null || x === undefined || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null;
const dateKey = ts => new Date(ts).toISOString().slice(0,10); // UTC day, consistent on GitHub
function load(){
 if(!fs.existsSync(PATH))return structuredClone(DEFAULT);
 const x=JSON.parse(fs.readFileSync(PATH,'utf8'));
 if(!x || !Number.isFinite(x.cash) || !Array.isArray(x.positions) || !Array.isArray(x.trades) || !x.history || typeof x.history!=='object')throw Error('Invalid saved state; refusing to reset account');
 return {...structuredClone(DEFAULT),...x,settings:{...DEFAULT.settings,...x.settings}};
}
function scoreToken(p){
 const v=p.volume||{},tx=p.txns||{},chg=p.priceChange||{},liq=finite(p.liquidity?.usd),price=finite(p.priceUsd);
 const buys=tx.h24?.buys||0,sells=tx.h24?.sells||0,total=buys+sells;
 const factors=[
 [v.h24>0&&v.h1!=null?Math.min(100,v.h1/(v.h24/24)*30):null,20],
 [chg.h1!=null?Math.max(0,Math.min(100,50+Number(chg.h1)*4)):null,20],
 [liq!=null?Math.min(100,liq/1000):null,20],
 [total>0?Math.min(100,buys/total*100):null,15],
 [total>0?Math.min(100,total/5):null,10],
 [chg.h24!=null?Math.max(0,Math.min(100,50+Number(chg.h24))):null,5],
 [chg.h24!=null?Math.max(0,100-Math.abs(Number(chg.h24))*1.5):null,10]
 ];
 const available=factors.filter(x=>x[0]!=null),weight=available.reduce((a,x)=>a+x[1],0);
 const score=weight?Math.round(available.reduce((a,x)=>a+x[0]*x[1],0)/weight):null;
 const risks=[];
 if(liq!=null&&liq<10000)risks.push('low liquidity');
 if(total>0&&buys/total<.4)risks.push('sell pressure');
 if(chg.h24!=null&&Math.abs(chg.h24)>40)risks.push('extreme 24h change');
 if(!price||!liq)risks.push('missing price/liquidity');
 if(weight<70)risks.push('incomplete data');
 return {score,weight,risks,price,liq};
}
function normalize(p){
 if(p.chainId!=='solana'||!p.baseToken?.address)return null;
 return {...scoreToken(p),address:p.baseToken.address,symbol:p.baseToken.symbol||'?',volume:finite(p.volume?.h24)};
}
async function json(url){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{const r=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});if(!r.ok)throw Error(`API HTTP ${r.status}`);return await r.json();}
 finally{clearTimeout(timer)}
}
async function batches(addresses){
 const out=[];
 for(let i=0;i<addresses.length;i+=30){
  const data=await json(`${API}/tokens/v1/solana/${addresses.slice(i,i+30).join(',')}`);
  if(!Array.isArray(data))throw Error('Invalid token pairs response');
  out.push(...data);
 }
 return out;
}
function bestTokens(pairs){
 const best=new Map();
 for(const p of pairs){const t=normalize(p);if(!t||!t.price||t.price<=0)continue;const old=best.get(t.address);if(!old||(t.liq||0)>(old.liq||0))best.set(t.address,t);}
 return [...best.values()].sort((a,b)=>(b.score??-1)-(a.score??-1));
}
function liquidation(p,price){return p.qty*price*(1-SLIP)*(1-FEE)}
function dailyRisk(state,quotes){
 const realized=state.trades.filter(t=>t.type==='SELL'&&dateKey(t.ts)===dateKey(Date.now())).reduce((a,t)=>a+(t.pnl||0),0);
 const unrealized=state.positions.reduce((a,p)=>a+liquidation(p,quotes.get(p.address)?.price??p.lastPrice??p.entry)-p.size,0);
 return realized+unrealized;
}
function signal(t,state,now){
 if(!t||!Number.isFinite(t.price)||t.price<=0)return false;
 if(!Number.isFinite(t.liq)||t.liq<50000||!Number.isFinite(t.volume)||t.volume<20000)return false;
 if(t.weight<80||t.score==null||t.score<state.settings.entryScore||t.risks.length)return false;
 const hist=(state.history[t.address]||[]).filter(x=>Number.isFinite(x.price)&&x.price>0&&Number.isFinite(x.ts)&&x.ts<=now).sort((a,b)=>a.ts-b.ts);
 if(hist.length<4)return false;
 const r=hist.slice(-4);
 if(now-r[3].ts>MAX_AGE||r[3].ts-r[0].ts<120000)return false;
 const change=(r[3].price/r[0].price-1)*100;
 if(change<.5||change>12||r[3].price<r[2].price)return false;
 if(state.trades.some(x=>x.address===t.address&&x.type==='SELL'&&now-x.ts<COOLDOWN))return false;
 return true;
}
function sell(state,p,price,reason,now){
 const exit=price*(1-SLIP),gross=p.qty*exit,fee=gross*FEE,proceeds=gross-fee,pnl=proceeds-p.size;
 state.cash+=proceeds;
 state.positions=state.positions.filter(x=>x.id!==p.id);
 state.trades.push({ts:now,address:p.address,symbol:p.symbol,type:'SELL',price:exit,size:p.size,fee,pnl,reason});
}
function buy(state,t,now){
 const size=Math.min(state.settings.positionSize,state.cash);
 if(size<1)return;
 const entry=t.price*(1+SLIP),fee=size*FEE,qty=(size-fee)/entry;
 state.cash-=size;
 state.positions.push({id:crypto.randomUUID(),address:t.address,symbol:t.symbol,entry,lastPrice:t.price,qty,size,ts:now,sl:state.settings.stopLoss,tp:state.settings.takeProfit});
 state.trades.push({ts:now,address:t.address,symbol:t.symbol,type:'BUY',price:entry,size,fee,reason:'AUTO signal '+t.score});
}
function snapshot(state,tokens,now){
 for(const t of tokens){const a=state.history[t.address]||(state.history[t.address]=[]);if(!a.length||now-a[a.length-1].ts>=45000)a.push({ts:now,price:t.price,score:t.score,symbol:t.symbol});if(a.length>200)a.splice(0,a.length-200);}
 const keys=Object.keys(state.history);
 if(keys.length>150){keys.sort((a,b)=>(state.history[a].at(-1)?.ts||0)-(state.history[b].at(-1)?.ts||0));for(const k of keys.slice(0,keys.length-150))delete state.history[k];}
}
async function run(){
 const state=load(),now=Date.now();
 // Fail closed: if any required market API fails, don't simulate trades.
 try{
  const [profiles,boosts]=await Promise.all([json(`${API}/token-profiles/latest/v1`),json(`${API}/token-boosts/latest/v1`)]);
  if(!Array.isArray(profiles)||!Array.isArray(boosts))throw Error('Invalid discovery response');
  const addresses=[...new Set([...profiles,...boosts].filter(x=>x.chainId==='solana').map(x=>x.tokenAddress).filter(Boolean))].slice(0,90);
  if(!addresses.length)throw Error('No Solana tokens discovered');
  const tokens=bestTokens(await batches(addresses));
  if(!tokens.length)throw Error('No usable token prices');
  const positionAddresses=[...new Set(state.positions.map(p=>p.address))];
  const positionTokens=positionAddresses.length?bestTokens(await batches(positionAddresses)):[];
  const quotes=new Map(positionTokens.map(t=>[t.address,{price:t.price,ts:Date.now()}]));
  snapshot(state,tokens,now);
  // Exit management runs even when new entries are paused.
  for(const p of [...state.positions]){
   const q=quotes.get(p.address);
   if(!q||Date.now()-q.ts>MAX_AGE)continue;
   p.lastPrice=q.price;
   const change=(q.price/p.entry-1)*100;
   if(change<=-p.sl)sell(state,p,q.price,'STOP LOSS',now);
   else if(change>=p.tp)sell(state,p,q.price,'TAKE PROFIT',now);
  }
  const missing=state.positions.some(p=>!quotes.has(p.address));
  if(state.running&&!missing&&dailyRisk(state,quotes)>-state.settings.dailyLimit){
   for(const t of tokens){
    if(state.positions.length>=state.settings.maxPositions)break;
    if(state.positions.some(p=>p.address===t.address))continue;
    if(!signal(t,state,now))continue;
    if(dailyRisk(state,quotes)<=-state.settings.dailyLimit)break;
    buy(state,t,now);
   }
  }
  state.lastStatus=missing?'Partial quotes; entries paused':'OK';
  console.log(`GROKBOT PAPER: ${state.lastStatus}; candidates=${tokens.length}; positions=${state.positions.length}; trades=${state.trades.length}; cash=${state.cash.toFixed(2)}`);
 }catch(e){state.lastStatus=`PAUSED: ${String(e.message).slice(0,180)}`;console.error(state.lastStatus);}
 state.lastRun=new Date(now).toISOString();
 fs.writeFileSync(PATH,JSON.stringify(state,null,2)+'\n');
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
module.exports={scoreToken,normalize,signal,load};
