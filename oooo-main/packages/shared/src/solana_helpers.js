const http = require('http');
const https = require('https');
const { URL } = require('url');

const JUPITER_API = process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6';

function postJson(urlStr, body) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const data = JSON.stringify(body);
      const opts = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + (url.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      };
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(opts, (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (chunks += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(chunks || '{}'); } catch (e) { return reject(e); }
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json: parsed });
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    } catch (e) { reject(e); }
  });
}

async function getJupiterSwapTransactionFromQuote(quote) {
  if (!quote) return null;
  const routes = quote.data || quote.routes || quote.routesToShow || quote;
  const first = Array.isArray(routes) ? routes[0] : null;
  if (!first) return null;
  const candidate = first.swapTransaction || first.swapTransactionB64 || first.swap_transaction || first.swapTransactionBase64;
  if (candidate && typeof candidate === 'string') return candidate;
  try {
    const routeObj = first.route || first;
    const body = { route: routeObj };
    const url = `${JUPITER_API}/swap`;
    console.log('DEBUG getJupiterSwapTransactionFromQuote POST', { url, body });
    const r = await postJson(url, body);
    console.log('DEBUG response status', r.status, 'ok', r.ok);
    const j = r.json;
    console.log('DEBUG response json', j);
    const txB64 = j.swapTransaction || j.swap_tx || j.swapTransactionB64 || j.swapTx || j.swapTransaction;
    return typeof txB64 === 'string' ? txB64 : null;
  } catch (e) {
    return null;
  }
}

async function getRaydiumSwapTransactionFromQuote(quote) {
  if (!quote) return null;
  const RAYDIUM_API = process.env.RAYDIUM_API_URL || null;
  if (RAYDIUM_API && quote && quote.route) {
    try {
      const r = await fetch(`${RAYDIUM_API}/swap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route: quote.route }) });
      if (!r.ok) return null;
      const j = await r.json();
      const txB64 = j.swapTransaction || j.swap_tx || j.swapTransactionB64 || j.swapTx;
      return typeof txB64 === 'string' ? txB64 : null;
    } catch (e) {
      return null;
    }
  }
  return null;
}

module.exports = { getJupiterSwapTransactionFromQuote, getRaydiumSwapTransactionFromQuote };
