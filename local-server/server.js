// Local server for the saved CHARTIFY build.
// Serves the static site and replaces the broken Groq backend (/api/ai/*) with Claude,
// called the PaperMap way: the logged-in `claude` CLI run as a subprocess (no API key).
//
//   claude -p "say ok"      (must work first; run `claude` then /login if not)
//   node server.js          -> http://localhost:3000
//
// Optional env: PORT, CLAUDE_MODEL (default sonnet), CLAUDE_EFFORT (default low), CLAUDE_BIN

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'sonnet';
const EFFORT = process.env.CLAUDE_EFFORT || 'low';
const TIMEOUT_MS = 180000;
// Prefer the patched copy built by `node patch.js`; fall back to the untouched original.
const PATCHED = path.join(__dirname, 'public');
const ROOT = fs.existsSync(path.join(PATCHED, 'index.html'))
  ? PATCHED
  : path.join(__dirname, '..', 'client-theta-rust-77.vercel.app');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const npmBin = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  if (fs.existsSync(npmBin)) return npmBin;
  return 'claude'; // on PATH (macOS/Linux)
}

const cache = new Map(); // prompt hash -> answer, so repeats are instant and free

// One interface: ask(system, prompt, jsonSchema) -> parsed structured_output
function ask(system, prompt, schema) {
  const key = crypto.createHash('sha256').update(JSON.stringify([system, prompt, schema])).digest('hex');
  if (cache.has(key)) return Promise.resolve(cache.get(key));

  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema),
    '--tools', '', '--strict-mcp-config', '--no-session-persistence',
    '--model', MODEL, '--effort', EFFORT, '--system-prompt', system];
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'chartify-claude-')); // keep project files out of the prompt

  return new Promise((resolve, reject) => {
    const child = spawn(findClaude(), args, { cwd, env: { ...process.env, DISABLE_AUTOUPDATER: '1' }, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('claude CLI timed out')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => { clearTimeout(timer); reject(new Error('claude CLI not found - install it and run /login (' + e.message + ')')); });
    child.on('close', () => {
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      let env;
      try { env = JSON.parse(out); } catch { return reject(new Error(err.trim() || 'no JSON from claude CLI')); }
      if (env.is_error) return reject(new Error(env.result || 'claude CLI error (not logged in or usage limit?)'));
      if (env.structured_output == null) return reject(new Error('claude CLI returned no structured_output'));
      cache.set(key, env.structured_output);
      resolve(env.structured_output);
    });
    child.stdin.end(prompt);
  });
}

const TEXT_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string', description: 'The full answer, in markdown.' } },
  required: ['text'],
};
const askText = async (system, prompt) => (await ask(system, prompt, TEXT_SCHEMA)).text;

const RISK_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 1, maximum: 10, description: '10 = highest risk' },
    label: { type: 'string', enum: ['Low', 'Moderate', 'High', 'Extreme'] },
    color: { type: 'string', enum: ['green', 'yellow', 'orange', 'red'], description: 'Low=green, Moderate=yellow, High=orange, Extreme=red' },
    summary: { type: 'string' },
    factors: {
      type: 'array', minItems: 2, maxItems: 4,
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, detail: { type: 'string' }, impact: { type: 'string', enum: ['Low', 'Medium', 'High'] } },
        required: ['name', 'detail', 'impact'],
      },
    },
    advice: { type: 'string' },
  },
  required: ['score', 'label', 'color', 'summary', 'factors', 'advice'],
};

const STYLE =
  'Format with short markdown: "## " headings, "- " bullets, **bold** for key terms. ' +
  'No tables. Educational tone, never financial advice, remind that patterns are not guarantees.';

async function analyze(type, data) {
  const ctx = JSON.stringify(data);
  if (type === 'pattern_explain') {
    return askText(
      `You are CHARTIFY's candlestick analyst. Explain a detected pattern to a beginner trader in under 220 words. ${STYLE}`,
      `Explain this detection (what it means, why it formed here, what confirmation to wait for, key risk):\n${ctx}`
    );
  }
  if (type === 'trade_journal') {
    return askText(
      `You are CHARTIFY's paper-trading coach. Review the user's simulated trades and portfolio in under 250 words. If there are no trades, say so and give 3 starter habits. ${STYLE}`,
      `Review this paper-trading journal:\n${ctx}`
    );
  }
  if (type === 'risk_score') {
    return ask(
      'You are a risk-scoring engine for a paper-trading app. Score how risky it is to open a position right now from the data given.',
      `Score the risk of taking a position now:\n${ctx}`,
      RISK_SCHEMA
    );
  }
  if (type === 'copilot') {
    const ind = indicators(data.candles || []);
    return ask(
      'You are the quant engine behind CHARTIFY\'s AI Market Copilot and Explainable-AI panel for a paper-trading app. ' +
        'Judge the setup from the candles, indicators and detected patterns provided. Be consistent: e.g. do not call RSI 37 "overbought". ' +
        'Entry/target/stopLoss must be realistic prices near the last close, on the correct side for the rating (BUY: stop < entry < target; SELL: target < entry < stop). ' +
        'Educational paper-trading context only.',
      `Symbol: ${data.symbol}\nTrend regime: ${data.trend}\nIndicators (computed): ${JSON.stringify(ind)}\n` +
        `Detected patterns: ${JSON.stringify(data.patterns || [])}\nLast 12 candles (o,h,l,c): ${JSON.stringify((data.candles || []).slice(-12).map((c) => [c.o, c.h, c.l, c.c]))}`,
      COPILOT_SCHEMA
    );
  }
  if (type === 'scan') return scanMarkets();
  if (type === 'correlation_insight') {
    return askText(
      'You explain a pattern-vs-news-sentiment correlation table in CHARTIFY to a beginner in under 180 words. ' +
        `Note that these figures are the app's built-in sample statistics, not live backtests; say so briefly. ${STYLE}`,
      `Lookback: ${data.lookback}. Summary stats: ${JSON.stringify(data.stats)}.\nPatterns (win rate %, trades, win rate by news regime): ${JSON.stringify(data.patterns)}`
    );
  }
  throw new Error(`Unknown analyze type: ${type}`);
}

const COPILOT_SCHEMA = {
  type: 'object',
  properties: {
    rating: { type: 'string', enum: ['BUY', 'SELL', 'HOLD'] },
    confidence: { type: 'integer', minimum: 25, maximum: 95 },
    entry: { type: 'number' },
    target: { type: 'number' },
    stopLoss: { type: 'number' },
    rationale: { type: 'string', description: 'One or two sentences citing the actual RSI/trend/pattern values.' },
    positive: { type: 'array', items: { type: 'string' }, description: 'Short bullish signal labels, or ["None detected"]' },
    negative: { type: 'array', items: { type: 'string' }, description: 'Short bearish signal labels, or ["None detected"]' },
    keyDrivers: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' }, description: 'Top 3 decision drivers, most important first' },
  },
  required: ['rating', 'confidence', 'entry', 'target', 'stopLoss', 'rationale', 'positive', 'negative', 'keyDrivers'],
};

function indicators(candles) {
  const closes = candles.map((c) => c.c);
  if (closes.length < 27) return {};
  let g = 0, l = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    d > 0 ? (g += d) : (l -= d);
  }
  const rsi = l === 0 ? 100 : Math.round(100 - 100 / (1 + g / l));
  const ema = (n) => {
    const k = 2 / (n + 1);
    return closes.reduce((e, c, i) => (i === 0 ? c : c * k + e * (1 - k)));
  };
  const e9 = ema(9), e21 = ema(21), macd = ema(12) - ema(26);
  return {
    lastClose: closes[closes.length - 1],
    rsi14: rsi,
    ema9: +e9.toFixed(2),
    ema21: +e21.toFixed(2),
    emaCross: e9 > e21 ? 'bullish (9 above 21)' : 'bearish (9 below 21)',
    macd: +macd.toFixed(2),
    macdSignal: macd > 0 ? 'bullish' : 'bearish',
  };
}

const SCAN_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOT', 'AVAX', 'DOGE', 'LINK'];
const PATTERN_LIST = 'Hammer, Doji, Bullish Engulfing, Bearish Engulfing, Morning Star, Evening Star, Shooting Star, Inverted Hammer, Hanging Man, Piercing Line, Dark Cloud Cover, Three White Soldiers, Three Black Crows, Spinning Top, Marubozu';
const SCAN_SCHEMA = {
  type: 'object',
  properties: {
    setups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          pattern: { type: 'string' },
          signal: { type: 'string', enum: ['bullish', 'bearish', 'neutral'] },
          confidence: { type: 'integer', minimum: 40, maximum: 95 },
          note: { type: 'string', description: 'One short sentence on why, citing the candles' },
        },
        required: ['symbol', 'pattern', 'signal', 'confidence', 'note'],
      },
    },
  },
  required: ['setups'],
};

async function scanMarkets() {
  const rows = await Promise.all(
    SCAN_SYMBOLS.map(async (s) => {
      for (const host of ['api.binance.com', 'data-api.binance.vision']) {
        try {
          const r = await fetch(`https://${host}/api/v3/klines?symbol=${s}USDT&interval=1d&limit=8`);
          if (!r.ok) continue;
          const k = await r.json();
          return { symbol: s, candles: k.map((c) => [+(+c[1]).toPrecision(6), +(+c[2]).toPrecision(6), +(+c[3]).toPrecision(6), +(+c[4]).toPrecision(6)]) };
        } catch { /* try next host */ }
      }
      return null;
    })
  );
  const ok = rows.filter(Boolean);
  if (!ok.length) throw new Error('Could not reach Binance to fetch candles for the scan.');
  const out = await ask(
    'You are CHARTIFY\'s candlestick scanner. For each symbol, look at the most recent 1-3 daily candles (the last row is the latest, possibly still forming) and report ' +
      `only clear matches from this list: ${PATTERN_LIST}. Skip symbols with no clear pattern. Use trend context from the earlier candles. Max 8 setups, strongest first.`,
    `Daily candles as [open, high, low, close], oldest to newest:\n${JSON.stringify(ok)}`,
    SCAN_SCHEMA
  );
  return { setups: out.setups, scanned: ok.length };
}

async function chat({ message, history = [], context = {} }) {
  const transcript = history.slice(-12).map((h) => `${h.sender === 'user' ? 'User' : 'ChartifyBot'}: ${h.text}`).join('\n');
  return askText(
    'You are ChartifyBot, the AI copilot inside CHARTIFY, a candlestick pattern detection app. ' +
      'Answer concisely (under 150 words) about technical patterns, indicators and simulated strategies, using the live context. ' +
      `Never give personalised financial advice; patterns are probabilistic. ${STYLE}\n\nLive context: ${JSON.stringify(context)}`,
    `${transcript ? 'Conversation so far:\n' + transcript + '\n\n' : ''}User: ${message}`
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); }
    });
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/api/ai/analyze') {
      try {
        const { type, data } = await readBody(req);
        send(res, 200, { success: true, data: await analyze(type, data) });
      } catch (e) {
        console.error('[analyze]', e.message);
        send(res, 500, { success: false, error: e.message });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ai/chat') {
      try {
        send(res, 200, { success: true, message: await chat(await readBody(req)) });
      } catch (e) {
        console.error('[chat]', e.message);
        send(res, 500, { success: false, error: e.message });
      }
      return;
    }

    // static files, with SPA fallback to index.html
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => {
    console.log(`CHARTIFY local: http://localhost:${PORT}  (claude model: ${MODEL}, effort: ${EFFORT})`);
    console.log('AI calls run through the logged-in claude CLI - first reply can take 10-30s.');
  });
