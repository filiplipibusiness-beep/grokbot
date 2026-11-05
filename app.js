'use strict';
/* GROKBOT: browser-only paper trading. No wallet or blockchain write calls. */
const API='https://api.dexscreener.com';
const KEY='grokbot-v1';
const QUOTE_MAX_AGE=90000; // 90 s: fail closed on stale quotes
const FEE_RATE=0.0025; // illustrative 0.25% per side, not exchange-specific
const SLIPPAGE_RATE=0.005; // illustrative 0.50% per side
const MIN_LIQUIDITY=50000, MIN_VOLUME=20000, COOLDOWN_MS=6*60*60*1000;
let positionQuotes=new Map();
const DEFAULT={cash:10000,settings:{positionSize:150,maxPositions:3,dailyLimit:400,entryScore:70,stopLoss:8,takeProfit:16},positions:[],trades:[],history:{},running:false};
const $=id=>document.getElementById(id);
const clone=x=>JSON.parse(JSON.stringify(x));
function load(){try{const x=JSON.parse(localStorage.getItem(KEY));if(!x||typeof x!=='object')return clone(DEFAULT);return {...clone(DEFAULT),...x,settings:{...DEFAULT.settings,...x.settings},positions:Array.isArray(x.positions)?x.positions:[],trades:Array.isArray(x.trades)?x.trades:[],history:x.history&&typeof x.history==='object'?x.history:{}}}catch{return clone(DEFAULT)}}
let state=load(),tokens=[],selected=null,lastRefresh=0,busy=false;
// An auto-run setting never resumes trading before fresh data is fetched.
state.running=false;
const money=(n,d=2)=>Number.isFinite(n)?'$'+n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const fmt=(n)=>Number.isFinite(n)?n.toLocaleString('en-US',{maximumFractionDigits:2}):'—';
const pct=n=>Number.isFinite(n)?`${n>=0?'+':''}${n.toFixed(2)}%`:'—';
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=n=>Number.isFinite(Number(n))?Number(n):null;
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));return true}catch(e){notice('Úložiště je plné nebo nedostupné. Historii exportujte; poslední změny nemusí být uloženy.');return false}}
function notice(msg){$('notice').textContent=msg;$('notice').classList.toggle('show',!!msg)}
function scoreToken(p){
 const v=p.volume||{},tx=p.txns||{},chg=p.priceChange||{},liq=finite(p.liquidity?.usd),cap=finite(p.marketCap??p.fdv),price=finite(p.priceUsd);
 const buys=(tx.h24?.buys||0),sells=(tx.h24?.sells||0),total=buys+sells;
 const factors=[
  ['Volume momentum',v.h24>0&&v.h1!=null?Math.min(100,(v.h1/(v.h24/24))*30):null,20],
  ['Price momentum',chg.h1!=null?Math.max(0,Math.min(100,50+Number(chg.h1)*4)):null,20],
  ['Likvidita',liq!=null?Math.min(100,liq/1000):null,20],
  ['Buy / sell pressure',total>0?Math.min(100,buys/total*100):null,15],
  ['Transakce',total>0?Math.min(100,total/5):null,10],
  ['Market cap změna (proxy)',chg.h24!=null?Math.max(0,Math.min(100,50+Number(chg.h24))):null,5],
  ['Volatilita',chg.h24!=null?Math.max(0,100-Math.abs(Number(chg.h24))*1.5):null,10]
 ];
 // No historical market-cap series is provided: price change is explicitly a proxy, not actual cap change.
 const available=factors.filter(f=>f[1]!=null),weight=available.reduce((a,f)=>a+f[2],0);
 const score=weight?Math.round(available.reduce((a,f)=>a+f[1]*f[2],0)/weight):null;
 const risks=[];if(liq!=null&&liq<10000)risks.push('nízká likvidita');if(total>0&&buys/total<.4)risks.push('převaha prodejů');if(chg.h24!=null&&Math.abs(chg.h24)>40)risks.push('extrémní 24h pohyb');if(!price||!liq)risks.push('chybí cena nebo likvidita');if(weight<70)risks.push('neúplná tržní data');
 return {score,factors,risks,price,liq,cap,weight};
}
function normalize(p){if(p.chainId!=='solana'||!p.baseToken?.address)return null;const x=scoreToken(p);return {...x,address:p.baseToken.address,pairAddress:p.pairAddress,symbol:p.baseToken.symbol||'?',name:p.baseToken.name||'Unknown',volume:finite(p.volume?.h24),change:finite(p.priceChange?.h24),tx:(p.txns?.h24?.buys||0)+(p.txns?.h24?.sells||0),url:p.url,raw:p};}
async function json(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});if(r.status===429)throw Error('API rate limit (HTTP 429)');if(!r.ok)throw Error('HTTP '+r.status);return await r.json()}finally{clearTimeout(timer)}}
async function fetchMarkets(){if(busy)return;busy=true;$('apiStatus').textContent='● Načítání…';try{
 // Discovery lists are not a guaranteed complete Pump.fun new-launch feed.
 const results=await Promise.allSettled([json(`${API}/token-profiles/latest/v1`),json(`${API}/token-boosts/latest/v1`)]);
 const addresses=[...new Set(results.flatMap(r=>r.status==='fulfilled'&&Array.isArray(r.value)?r.value.filter(x=>x.chainId==='solana').map(x=>x.tokenAddress):[]).filter(Boolean))].slice(0,90);
 if(!addresses.length)throw Error('DEX Screener nevrátil žádné Solana adresy');
 const batches=[];for(let i=0;i<addresses.length;i+=30)batches.push(addresses.slice(i,i+30));
 let failedBatches=0;const pairs=[];for(const batch of batches){try{const data=await json(`${API}/tokens/v1/solana/${batch.join(',')}`);if(Array.isArray(data))pairs.push(...data)}catch(e){failedBatches++;console.warn('Batch API:',e.message)}}
 if(!pairs.length)throw Error('Nepodařilo se získat token páry');
 const best=new Map();for(const p of pairs){const t=normalize(p);if(!t||!t.price||t.price<=0)continue;const old=best.get(t.address);if(!old||(t.liq||0)>(old.liq||0))best.set(t.address,t)}
 tokens=[...best.values()].sort((a,b)=>(b.score??-1)-(a.score??-1));if(!tokens.length)throw Error('API nevrátilo použitelné ceny');
 lastRefresh=Date.now();await fetchPositionQuotes();$('apiStatus').textContent='● Live · '+new Date().toLocaleTimeString('cs-CZ');notice(results.some(r=>r.status==='rejected')||failedBatches?'Část API není dostupná; nové automatické vstupy jsou pozastaveny pro tento cyklus.':'');
 recordSnapshots();updatePositions();if(state.running&&failedBatches===0&&results.every(r=>r.status==='fulfilled'))autoTrade();renderAll();
 }catch(e){lastRefresh=0;positionQuotes.clear();state.running=false;save();$('apiStatus').textContent='● API nedostupné';notice(`Data se nepodařilo načíst: ${e.message}. Žádné ceny ani obchody se nevymýšlejí.`);renderAll()}finally{busy=false}}
function recordSnapshots(){const ts=Date.now();for(const t of tokens){if(!t.price)continue;const arr=state.history[t.address]||(state.history[t.address]=[]);if(!arr.length||ts-arr[arr.length-1].ts>=45000)arr.push({ts,price:t.price,score:t.score,symbol:t.symbol});if(arr.length>2000)arr.splice(0,arr.length-2000)}const keys=Object.keys(state.history);if(keys.length>150){keys.sort((a,b)=>(state.history[a].at(-1)?.ts||0)-(state.history[b].at(-1)?.ts||0));for(const k of keys.slice(0,keys.length-150))delete state.history[k]}save()}
async function fetchPositionQuotes(){
 const addresses=[...new Set(state.positions.map(p=>p.address).filter(Boolean))];
 const next=new Map();let failed=false;
 for(let i=0;i<addresses.length;i+=30){
  try{
   const data=await json(`${API}/tokens/v1/solana/${addresses.slice(i,i+30).join(',')}`);
   if(!Array.isArray(data))throw Error('Neplatná odpověď cen');
   for(const pair of data){const t=normalize(pair);if(!t||!Number.isFinite(t.price)||t.price<=0)continue;
    const old=next.get(t.address);if(!old||t.liq>old.liq)next.set(t.address,{price:t.price,ts:Date.now(),liq:t.liq});
   }
  }catch(e){failed=true;console.warn('Position quotes:',e.message)}
 }
 positionQuotes=next;
 if(failed)notice('Některé ceny otevřených pozic nejsou dostupné; jejich automatické uzavření čeká na novou cenu.');
}
function quoteOf(address){
 const q=positionQuotes.get(address);
 if(q&&Date.now()-q.ts<=QUOTE_MAX_AGE)return q;
 const t=tokens.find(t=>t.address===address);
 if(t&&Date.now()-lastRefresh<=QUOTE_MAX_AGE)return {price:t.price,ts:lastRefresh,liq:t.liq};
 return null;
}
function priceOf(address){return quoteOf(address)?.price??null}
function freshMarket(){return lastRefresh>0&&Date.now()-lastRefresh<=QUOTE_MAX_AGE}
function liquidationValue(p,price){return p.qty*price*(1-SLIPPAGE_RATE)*(1-FEE_RATE)}
function unrealizedPnL(){return state.positions.reduce((a,p)=>a+liquidationValue(p,priceOf(p.address)??p.lastPrice??p.entry)-p.size,0)}
function dailyRiskPnL(){return dailyPnL()+unrealizedPnL()}
function riskBlocked(){return dailyRiskPnL()<=-state.settings.dailyLimit || state.positions.some(p=>!quoteOf(p.address))}

function dateKey(ts){const d=new Date(ts);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function dailyPnL(){const day=dateKey(Date.now());return state.trades.filter(t=>t.type==='SELL'&&dateKey(t.ts)===day).reduce((a,t)=>a+(t.pnl||0),0)}
function equity(){return state.cash+state.positions.reduce((a,p)=>a+liquidationValue(p,priceOf(p.address)??p.lastPrice??p.entry),0)}
function signalCheck(t,now=Date.now()){
 if(!t||!Number.isFinite(t.price)||t.price<=0)return 'neplatná cena';
 if(!Number.isFinite(t.liq)||t.liq<MIN_LIQUIDITY)return 'nízká likvidita';
 if(!Number.isFinite(t.volume)||t.volume<MIN_VOLUME)return 'nízký objem';
 if(t.weight<80||t.score==null||t.score<state.settings.entryScore)return 'nedostatečné skóre / data';
 if((t.risks||[]).length)return 'rizikový token';
 const history=(state.history[t.address]||[]).filter(x=>Number.isFinite(x.price)&&x.price>0&&Number.isFinite(x.ts)&&x.ts<=now).sort((a,b)=>a.ts-b.ts);
 if(history.length<4)return 'málo historických dat';
 const recent=history.slice(-4);
 if(now-recent.at(-1).ts>QUOTE_MAX_AGE||recent.at(-1).ts-recent[0].ts<120000)return 'neaktuální / krátký trend';
 const change=(recent.at(-1).price/recent[0].price-1)*100;
 if(change<0.5||change>12)return 'trend nepotvrzen nebo příliš prudký';
 if(recent.at(-1).price<recent.at(-2).price)return 'poslední tick klesá';
 if(state.trades.some(x=>x.address===t.address&&x.type==='SELL'&&now-x.ts<COOLDOWN_MS))return 'cooldown po prodeji';
 return null;
}
function openPosition(t,automatic=false){if(!freshMarket()||riskBlocked())return false;if(!t||!t.price||t.price<=0||!t.liq||t.liq<=0)return false;if(automatic&&signalCheck(t))return false;if(state.positions.some(p=>p.address===t.address))return false;if(state.positions.length>=state.settings.maxPositions)return false;if(dailyRiskPnL()<=-state.settings.dailyLimit)return false;const size=Math.min(state.settings.positionSize,state.cash);if(size<1)return false;
 const entry=t.price*(1+SLIPPAGE_RATE),fee=size*FEE_RATE,qty=(size-fee)/entry;const p={id:crypto.randomUUID(),address:t.address,symbol:t.symbol,entry,lastPrice:t.price,qty,size,ts:Date.now(),sl:state.settings.stopLoss,tp:state.settings.takeProfit};state.cash-=size;state.positions.push(p);state.trades.push({ts:p.ts,address:p.address,symbol:p.symbol,type:'BUY',price:p.entry,size,fee,reason:automatic?'AUTO signal '+t.score:'MANUAL paper entry'});save();renderAll();return true}
function closePosition(p,price,reason){if(!Number.isFinite(price)||price<=0)return false;const exit=price*(1-SLIPPAGE_RATE),gross=p.qty*exit,fee=gross*FEE_RATE,proceeds=gross-fee,pnl=proceeds-p.size;state.cash+=proceeds;state.positions=state.positions.filter(x=>x.id!==p.id);state.trades.push({ts:Date.now(),address:p.address,symbol:p.symbol,type:'SELL',price:exit,size:p.size,fee,pnl,reason});save();return true}
function updatePositions(){let changed=false;for(const p of [...state.positions]){const price=priceOf(p.address);if(price==null)continue;p.lastPrice=price;const change=(price/p.entry-1)*100;if(change<=-p.sl){changed=closePosition(p,price,'STOP LOSS')||changed}else if(change>=p.tp){changed=closePosition(p,price,'TAKE PROFIT')||changed}else changed=true}if(changed)save()}
function autoTrade(){if(!freshMarket()||riskBlocked()){state.running=false;notice('Bot pozastaven: denní riziko nebo nedostupné ceny otevřených pozic.');save();return}if(dailyRiskPnL()<=-state.settings.dailyLimit){state.running=false;notice('Denní limit ztráty dosažen. Bot pozastaven.');save();return}for(const t of tokens){if(state.positions.length>=state.settings.maxPositions)break;if(!signalCheck(t))openPosition(t,true)}}
function renderStats(){const sells=state.trades.filter(t=>t.type==='SELL'),wins=sells.filter(t=>t.pnl>0),pnl=sells.reduce((a,t)=>a+t.pnl,0);$('equity').textContent=money(equity());$('realized').textContent=money(pnl);$('realized').className=pnl>=0?'positive':'negative';$('winrate').textContent=sells.length?pct(wins.length/sells.length*100):'—';$('openCount').textContent=state.positions.length+'/'+state.settings.maxPositions;$('dailyLoss').textContent='Denní PnL včetně otevřených pozic: '+money(dailyRiskPnL());$('toggleBot').textContent=state.running?'⏸ Pozastavit bota':'▶ Spustit bota'}
function renderMarkets(){const q=$('search').value.toLowerCase().trim(),min=Number($('minScore').value);const arr=tokens.filter(t=>(t.symbol.toLowerCase().includes(q)||t.name.toLowerCase().includes(q)||t.address.toLowerCase().includes(q))&&(t.score??-1)>=min);$('marketRows').innerHTML=arr.length?arr.map(t=>`<tr><td><b>${safe(t.symbol)}</b><small title="${safe(t.address)}">${safe(t.name.slice(0,22))}</small></td><td>${t.price<.01?t.price.toPrecision(5):money(t.price,5)}</td><td>${money(t.cap,0)}</td><td>${money(t.liq,0)}</td><td>${money(t.volume,0)}</td><td class="${t.change>=0?'positive':'negative'}">${pct(t.change)}</td><td>${fmt(t.tx)}</td><td><span class="score">${t.score??'N/A'}</span></td><td><button class="mini" data-detail="${safe(t.address)}">Analýza</button> <button class="mini" data-buy="${safe(t.address)}" ${!t.liq||state.positions.some(p=>p.address===t.address)?'disabled':''}>Paper Buy</button></td></tr>`).join(''):`<tr><td colspan="9" class="empty">${tokens.length?'Žádné tokeny neodpovídají filtru.':'Žádná živá data. Zkuste obnovit.'}</td></tr>`}
function renderDetail(){const t=tokens.find(t=>t.address===selected);$('detailName').textContent=t?`${t.symbol} · ${t.address}`:'Vyber token v tabulce';$('signalDetail').innerHTML=t?`<div class="breakdown">${t.factors.map(([name,value,weight])=>`<div><small>${safe(name)} · váha ${weight}%</small><b>${value==null?'N/A':Math.round(value)+'/100'}</b></div>`).join('')}</div><p class="reason"><b>Score ${t.score??'N/A'}/100</b> · Pokrytí dat ${t.weight}% · ${t.risks.length?'Rizika: '+safe(t.risks.join(', ')):'Bez výrazných rizik podle dostupných metrik.'} Automatický vstup: ${safe(signalCheck(t)||'podmínky splněny')}. Market cap momentum je pouze proxy z cenové změny. Skóre je heuristické, nikoli AI predikce.</p>`:'<div class="empty">Vyber token a zobrazí se rozklad signálu.</div>'}
function renderPositions(){$('positionRows').innerHTML=state.positions.length?state.positions.map(p=>{const current=priceOf(p.address),mark=current??p.lastPrice??p.entry,pnl=p.qty*mark*(1-SLIPPAGE_RATE)*(1-FEE_RATE)-p.size;return `<tr><td><b>${safe(p.symbol)}</b><small>${safe(p.address.slice(0,12))}…</small></td><td>${p.entry.toPrecision(5)}</td><td>${current!=null?mark.toPrecision(5):'Stale: '+mark.toPrecision(5)}</td><td>${money(p.size)}</td><td class="${pnl>=0?'positive':'negative'}">${money(pnl)} (${pct(pnl/p.size*100)})</td><td>-${p.sl}% / +${p.tp}%</td><td><button class="mini" data-close="${safe(p.id)}" ${current==null?'disabled title="Čeká se na živou cenu"':''}>Close</button></td></tr>`}).join(''):'<tr><td colspan="7" class="empty">Zatím nejsou otevřené pozice.</td></tr>'}
function renderActivity(){$('activityRows').innerHTML=state.trades.length?[...state.trades].reverse().slice(0,300).map(t=>`<tr><td>${new Date(t.ts).toLocaleString('cs-CZ')}</td><td>${safe(t.symbol)}</td><td class="${t.type==='BUY'?'positive':'negative'}">${t.type}</td><td>${Number(t.price).toPrecision(5)}</td><td>${money(t.size)}</td><td>${t.pnl==null?'—':money(t.pnl)}</td><td>${safe(t.reason)}</td></tr>`).join(''):'<tr><td colspan="7" class="empty">Žádné paper obchody.</td></tr>'}
function renderHistory(){const series=Object.values(state.history);$('historyInfo').textContent=`${series.length} tokenů · ${series.reduce((a,s)=>a+s.length,0)} skutečných cenových snapshotů · snapshot nejvýše každých 45 sekund při otevřené aplikaci.`}
function renderAll(){renderStats();renderMarkets();renderDetail();renderPositions();renderActivity();renderHistory()}
function download(name,body,type){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([body],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
// Entry uses a signal at the preceding snapshot, executed at the next snapshot.
// Open positions are marked to liquidation value at the period boundary.
function backtestSeries(arr,score,sl,tp,from,to){
 let cash=1000,position=null,peak=1000,dd=0,wins=0,losses=0,gain=0,loss=0,trades=0;
 for(let i=from;i<to;i++){
  const tick=arr[i],prev=arr[i-1];
  if(!tick||!Number.isFinite(tick.price)||tick.price<=0)continue;
  if(position){
   const move=(tick.price/position.entry-1)*100;
   if(move<=-sl||move>=tp){
    const pnl=liquidationValue(position,tick.price)-position.amount;
    cash+=position.amount+pnl;trades++;
    if(pnl>0){wins++;gain+=pnl}else{losses++;loss+=-pnl}
    position=null;
   }
  }else if(prev&&prev.ts<tick.ts&&prev.score!=null&&prev.score>=score&&i>=from+1&&i>=3){
   const lookback=arr[i-3];
   const trend=lookback&&lookback.ts<prev.ts&&prev.price>lookback.price*1.005&&prev.price<=lookback.price*1.12&&prev.price>=arr[i-2].price;
   if(trend&&tick.ts-prev.ts<=QUOTE_MAX_AGE&&prev.ts-lookback.ts>=90000){
    const amount=Math.min(100,Math.max(0,cash));
    if(amount>=1){cash-=amount;position={entry:tick.price*(1+SLIPPAGE_RATE),amount,qty:amount*(1-FEE_RATE)/(tick.price*(1+SLIPPAGE_RATE))};}
   }
  }
  const eq=cash+(position?liquidationValue(position,tick.price):0);
  peak=Math.max(peak,eq);dd=Math.max(dd,(peak-eq)/peak*100);
 }
 const last=arr[to-1];
 const finalEquity=cash+(position&&last?liquidationValue(position,last.price):0);
 return {trades,wins,losses,profit:finalEquity-1000,realized:cash-1000+(position?position.amount:0),drawdown:dd,winrate:trades?wins/trades*100:null,pf:loss?gain/loss:gain>0?Infinity:null,open:!!position};
}
function runBacktest(){
 const score=Number($('btScore').value),sl=Number($('btSl').value),tp=Number($('btTp').value),train=Number($('btTrain').value);
 if(!Number.isFinite(score)||score<0||score>100||!Number.isFinite(sl)||sl<=0||sl>=100||!Number.isFinite(tp)||tp<=0||tp>1000||!Number.isFinite(train)||train<50||train>90){notice('Zkontrolujte parametry backtestu.');return}
 const series=Object.values(state.history).filter(s=>Array.isArray(s)&&s.length>=10).map(s=>[...s].sort((a,b)=>a.ts-b.ts));
 if(!series.length){$('backtestResult').textContent='Nedostatek zaznamenaných dat. Potřebujete alespoň 10 snapshotů tokenu.';return}
 const timestamps=series.flatMap(a=>a.map(t=>t.ts)).filter(Number.isFinite).sort((a,b)=>a-b);
 const cutoff=timestamps[Math.min(timestamps.length-1,Math.floor(timestamps.length*train/100))];
 const aggregate=part=>{let trades=0,wins=0,profit=0,drawdown=0,open=0;for(const arr of series){const split=arr.findIndex(t=>t.ts>=cutoff),n=split<0?arr.length:split;const from=part==='train'?0:n,to=part==='train'?n:arr.length;if(to-from<5)continue;const r=backtestSeries(arr,score,sl,tp,from,to);trades+=r.trades;wins+=r.wins;profit+=r.profit;drawdown=Math.max(drawdown,r.drawdown);open+=Number(r.open)}return {trades,wins,profit,drawdown,open}};
 const a=aggregate('train'),b=aggregate('holdout');
 $('backtestResult').innerHTML=`<b>Training</b> · ${a.trades} uzavřených obchodů · PnL včetně otevřených ${money(a.profit)} · Win rate ${a.trades?pct(a.wins/a.trades*100):'N/A'} · Max drawdown ${pct(-a.drawdown)} · otevřené ${a.open}<hr><b>Holdout</b> · ${b.trades} uzavřených obchodů · PnL včetně otevřených ${money(b.profit)} · Win rate ${b.trades?pct(b.wins/b.trades*100):'N/A'} · Max drawdown ${pct(-b.drawdown)} · otevřené ${b.open}<p>Společná časová hranice pro všechny tokeny. Vstupní signál z předchozího snapshotu, nákup na následujícím. Modelové poplatky 0,25 % a skluz 0,50 % na každé straně. Neuzavřené pozice oceněny konzervativně. Jednoduchý retrospektivní test bez záruky realizovatelnosti; nepokrývá plně filtry živého API, tržní dopad ani výpadky.</p>`;
}
function init(){document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===b.dataset.page));$('pageTitle').textContent=({markets:'Market Scanner',positions:'Paper Positions',activity:'Trade Activity',simulator:'Strategy Simulator',risk:'Risk Settings'})[b.dataset.page]}));
 $('refresh').addEventListener('click',fetchMarkets);$('toggleBot').addEventListener('click',()=>{state.running=!state.running;save();if(state.running&&freshMarket())autoTrade();renderAll()});$('search').addEventListener('input',renderMarkets);$('minScore').addEventListener('change',renderMarkets);
 $('marketRows').addEventListener('click',e=>{const d=e.target.closest('[data-detail]'),b=e.target.closest('[data-buy]');if(d){selected=d.dataset.detail;renderDetail();$('detailPanel').scrollIntoView({behavior:'smooth',block:'nearest'})}if(b){const t=tokens.find(x=>x.address===b.dataset.buy);if(!openPosition(t))notice('Paper nákup zamítnut: zkontrolujte hotovost, limity a aktuální data.')}});
 $('positionRows').addEventListener('click',e=>{const b=e.target.closest('[data-close]');if(!b)return;const p=state.positions.find(x=>x.id===b.dataset.close);if(p&&closePosition(p,priceOf(p.address),'MANUAL close'))renderAll()});
 for(const k of Object.keys(state.settings))$(k).value=state.settings[k];$('riskForm').addEventListener('submit',e=>{e.preventDefault();const s={};for(const k of Object.keys(state.settings)){const n=Number($(k).value);if(!Number.isFinite(n)||n<=0){notice('Nastavení musí být kladná čísla.');return}s[k]=n}if(s.entryScore>100||s.stopLoss>=100||s.takeProfit>1000||s.maxPositions>20||s.dailyLimit>10000||s.positionSize>10000||!Number.isInteger(s.maxPositions)){notice('Neplatné rizikové limity.');return}state.settings=s;save();renderAll();notice('Nastavení uloženo. Stop Loss a Take Profit již otevřených pozic zůstávají beze změny.')});
 $('resetAccount').addEventListener('click',()=>{if(!confirm('Opravdu resetovat virtuální účet a smazat všechny paper obchody?'))return;state.cash=10000;state.positions=[];state.trades=[];state.running=false;save();renderAll();notice('Paper účet byl resetován.')});
 $('exportTrades').addEventListener('click',()=>{const cols=['ts','address','symbol','type','price','size','pnl','reason'];const csv=[cols.join(','),...state.trades.map(t=>cols.map(k=>'"'+String(t[k]??'').replace(/"/g,'""')+'"').join(','))].join('\r\n');download('grokbot-trades.csv','\ufeff'+csv,'text/csv;charset=utf-8')});
 $('exportHistory').addEventListener('click',()=>download('grokbot-history.json',JSON.stringify(state.history,null,2),'application/json'));
 $('runBacktest').addEventListener('click',runBacktest);renderAll();fetchMarkets();setInterval(()=>{if(!document.hidden)fetchMarkets()},60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastRefresh>60000)fetchMarkets()});}
init();
