// Builds local-server/public/ = the saved CHARTIFY site with every "AI" panel wired to Claude.
// The original folder is never modified.  Run:  node patch.js
//
// Patched panels (all call the local server's /api/ai/analyze, which runs the `claude` CLI):
//   - AI Market Copilot + Explainable AI panel  (component MA)  -> type "copilot"
//   - AI Market Scanner                          (component LA)  -> type "scan"
//   - AI Correlation Analysis                    (component IA)  -> type "correlation_insight"
// Already served by the server without patching: chat, risk scorer, trade coach, pattern explainer.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'client-theta-rust-77.vercel.app');
const OUT = path.join(__dirname, 'public');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

const assets = path.join(OUT, 'assets');
const jsName = fs.readdirSync(assets).find((f) => /^index-.*\.js$/.test(f));
const jsPath = path.join(assets, jsName);
let js = fs.readFileSync(jsPath, 'utf8');

function patch(label, from, to) {
  const n = js.split(from).length - 1;
  if (n !== 1) throw new Error(`[${label}] expected exactly 1 match, found ${n}`);
  js = js.replace(from, () => to); // function form: no $ special-casing
  console.log('patched:', label);
}

// ---------- 1. AI Market Copilot + XAI panel (MA) ----------
patch(
  'copilot: fetch hook',
  'function MA({activeSymbol:t,candles:e,patterns:s,trend:n}){const[i,r]=k.useState(0);k.useEffect(()=>{const B=setInterval(()=>{r((Math.random()-.5)*2)},2e3);return()=>clearInterval(B)},[]);',
  'function MA({activeSymbol:t,candles:e,patterns:s,trend:n}){const[i,r]=k.useState(0);k.useEffect(()=>{const B=setInterval(()=>{r((Math.random()-.5)*2)},2e3);return()=>clearInterval(B)},[]);' +
    // ZZ: null = Claude thinking, false = failed (rule-based fallback), object = Claude result
    'const[ZZ,setZZ]=k.useState(null);k.useEffect(()=>{if(!e||e.length<30)return;let dead=!1;setZZ(null);' +
    'fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"copilot",data:{symbol:t,trend:n,' +
    'candles:e.slice(-60).map(x=>({o:x.open,h:x.high,l:x.low,c:x.close,v:x.volume})),' +
    'patterns:(s||[]).slice(0,3).map(p=>({pattern:p.pattern,signal:p.signal,confidence:p.confidence,successRate:p.successRate}))}})})' +
    '.then(r=>r.json()).then(j=>{if(!dead)setZZ(j.success?j.data:!1)}).catch(()=>{if(!dead)setZZ(!1)});return()=>{dead=!0}},' +
    '[t,e?e.length:0,s&&s[0]?s[0].pattern:""]);'
);
patch(
  'copilot: let A',
  'const A=Math.min(95,Math.max(25,Math.round(N+i))),T=[],L=[];',
  'let A=Math.min(95,Math.max(25,Math.round(N+i))),T=[],L=[];'
);
patch(
  'copilot: let Y + override',
  'const Y=y==="BUY"?"Key splits: RSI Oversold -> Bullish EMA Crossover -> Rising Volume Momentum":y==="SELL"?"Key splits: RSI Overbought -> Bearish MACD Momentum -> Declining Volatility Volume":"Key splits: RSI Neutral -> Consolidating EMA Crossover -> Stable Market Regime";',
  'let Y=y==="BUY"?"Key splits: RSI Oversold -> Bullish EMA Crossover -> Rising Volume Momentum":y==="SELL"?"Key splits: RSI Overbought -> Bearish MACD Momentum -> Declining Volatility Volume":"Key splits: RSI Neutral -> Consolidating EMA Crossover -> Stable Market Regime";' +
    'if(ZZ){y=ZZ.rating;w=y==="BUY"?"text-emerald-400 border-emerald-500/30 bg-emerald-500/10":y==="SELL"?"text-red-400 border-red-500/30 bg-red-500/10":"text-amber-500 border-amber-500/30 bg-amber-500/10";' +
    'A=ZZ.confidence;S=ZZ.entry;_=ZZ.target;j=ZZ.stopLoss;T.length=0;T.push(...ZZ.positive);L.length=0;L.push(...ZZ.negative);Y="Key drivers: "+ZZ.keyDrivers.join(" -> ")}'
);
patch(
  'copilot: rationale text',
  `children:['"Rule-based analysis indicates ',c.jsx("span",{className:"font-bold text-white",children:y})," based on RSI of ",c.jsx("span",{className:"font-bold text-brand-400",children:h})," and ",c.jsx("span",{className:"font-bold text-brand-400",children:n.toUpperCase()}),' market regime."']`,
  `children:ZZ?['"'+ZZ.rationale+'"']:ZZ===null?["Claude is analysing this chart\\u2026"]:['"Claude unavailable - rule-based fallback: ',c.jsx("span",{className:"font-bold text-white",children:y})," based on RSI of ",c.jsx("span",{className:"font-bold text-brand-400",children:h})," and ",c.jsx("span",{className:"font-bold text-brand-400",children:n.toUpperCase()}),' market regime."']`
);
patch('copilot: model label', '"v1.0.0 (Acc: 68.4%)"', 'ZZ?"Claude (live analysis)":ZZ===null?"Claude (thinking\\u2026)":"rule-based fallback"');
patch('copilot: win prob label', '"GBDT WIN PROBABILITY"', '"CLAUDE WIN PROBABILITY"');

// ---------- 2. AI Market Scanner (LA) ----------
patch(
  'scanner: state',
  'function LA(){const[t,e]=k.useState("idle"),[s,n]=k.useState(""),[i,r]=k.useState(0);',
  'function LA(){const[t,e]=k.useState("idle"),[s,n]=k.useState(""),[i,r]=k.useState(0),[SR,setSR]=k.useState([]),[SE,setSE]=k.useState("");'
);
patch(
  'scanner: scan action',
  'const a=()=>{t!=="scanning"&&(e("scanning"),r(0),setTimeout(()=>{e("complete"),n(new Date().toTimeString().split(" ")[0]),r(Math.floor(Math.random()*6)+3)},1800))};',
  'const a=()=>{t!=="scanning"&&(e("scanning"),r(0),setSR([]),setSE(""),' +
    'fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"scan",data:{}})})' +
    '.then(q=>q.json()).then(j=>{if(!j.success)throw new Error(j.error||"Scan failed");setSR(j.data.setups);r(j.data.setups.length);n(new Date().toTimeString().split(" ")[0]);e("complete")})' +
    '.catch(er=>{setSE(er.message||"Scan failed");e("error")}))};'
);
patch(
  'scanner: error status',
  ':c.jsx("span",{className:"text-slate-400",children:"System Ready"})',
  ':t==="error"?c.jsx("span",{className:"text-red-400 font-bold text-right",children:SE}):c.jsx("span",{className:"text-slate-400",children:"System Ready"})'
);
patch(
  'scanner: results list + button label',
  'c.jsxs("button",{onClick:a,disabled:t==="scanning"',
  'SR.length>0&&c.jsx("div",{className:"flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1",children:SR.map((x,ix)=>c.jsxs("div",{className:"rounded-lg border px-3 py-2 text-[11px] "+(x.signal==="bullish"?"border-emerald-500/30 bg-emerald-500/5":x.signal==="bearish"?"border-red-500/30 bg-red-500/5":"border-slate-700/40 bg-slate-800/40"),children:[' +
    'c.jsxs("div",{className:"flex justify-between font-bold text-white",children:[c.jsxs("span",{children:[x.symbol," \\u00b7 ",x.pattern]}),c.jsxs("span",{className:x.signal==="bullish"?"text-emerald-400":x.signal==="bearish"?"text-red-400":"text-amber-400",children:[x.signal," ",x.confidence,"%"]})]}),' +
    'c.jsx("div",{className:"text-slate-400 mt-0.5 leading-snug",children:x.note})]},ix))}),' +
    'c.jsxs("button",{onClick:a,disabled:t==="scanning"'
);

// ---------- 3. AI Correlation Analysis (IA): "Ask Claude" insight ----------
patch(
  'correlation: insight component',
  'function IA(){',
  'function ZI({patterns:p,stats:st,lookback:lb}){const[tx,setTx]=k.useState(""),[ld,setLd]=k.useState(!1),[er,setEr]=k.useState("");' +
    'const go=()=>{setLd(!0);setEr("");setTx("");fetch("/api/ai/analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"correlation_insight",data:{lookback:lb,stats:st,' +
    'patterns:p.map(x=>({name:x.name,winRate:x.winRate,trades:x.trades,regimes:x.regimeRates}))}})}).then(r=>r.json()).then(j=>{if(!j.success)throw new Error(j.error);setTx(j.data)}).catch(e=>setEr(e.message||"Failed")).finally(()=>setLd(!1))};' +
    'return c.jsxs("div",{className:"bg-surface-800 border border-slate-800/80 rounded-xl p-4 shadow-md",children:[c.jsxs("div",{className:"flex items-center justify-between gap-3",children:[c.jsx("span",{className:"text-[10px] text-slate-500 font-bold uppercase tracking-wider",children:"Claude insight"}),' +
    'c.jsx("button",{onClick:go,disabled:ld,className:"text-[11px] font-bold text-brand-400 border border-brand-500/30 rounded-lg px-3 py-1.5 hover:bg-brand-500/10 disabled:opacity-50",children:ld?"Claude is reading the table\\u2026":tx?"Refresh":"Explain this table"})]}),' +
    'er&&c.jsx("p",{className:"text-red-400 text-xs mt-2",children:er}),tx&&c.jsx("div",{className:"mt-3 text-slate-300 text-xs leading-relaxed whitespace-pre-wrap",children:tx.replace(/^#+\\s*/gm,"").replace(/\\*\\*/g,"")})]})}function IA(){'
);
patch(
  'correlation: render insight under header',
  'c.jsx("p",{className:"text-slate-400 text-xs",children:"Analyze how real-time news sentiment impacts technical pattern success rates"})]}),',
  'c.jsx("p",{className:"text-slate-400 text-xs",children:"Analyze how real-time news sentiment impacts technical pattern success rates"})]}),c.jsx(ZI,{patterns:f,stats:b,lookback:s}),'
);

// ---------- 4. Bug fix: news modal "View <SYMBOL> Chart" ----------
// The original only switched the symbol and closed the modal, leaving you on the News tab.
// F = desktop tab setter, B = mobile bottom-nav tab setter.
patch(
  'news modal: View Chart switches to Terminal',
  'onClick:()=>{e(H.symbol),V(null)}',
  'onClick:()=>{e(H.symbol),F("terminal"),B("chart"),V(null)}'
);

fs.writeFileSync(jsPath, js);
console.log('\nDone. Patched copy at', OUT);
