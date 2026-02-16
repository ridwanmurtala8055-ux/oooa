import express from 'express';
import bodyParser from 'body-parser';
import { query, writeAudit, encryptPrivateKey, decryptPrivateKey, hashPin, verifyPin, enforceAll, getTradingCapital, getBalancePublicKey, getSolPriceUsd, estimateTransferFee, getJupiterQuote } from '@coinhunter/shared';
import { v4 as uuidv4 } from 'uuid';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';

const app = express();
app.use(bodyParser.json());
const SUBSCRIPTION_PRICES: Record<string, number> = {
  meme: 100,
  forex: 100,
  bundle: 170
};

function normalizePlan(plan: any): 'meme' | 'forex' | 'bundle' | null {
  const v = String(plan || '').trim().toLowerCase();
  if (v === 'meme' || v === 'forex' || v === 'bundle') return v;
  return null;
}


function isDevnetCluster() {
  return String(process.env.SOLANA_CLUSTER || '').toLowerCase() === 'devnet';
}


function computeReadiness() {
  const required = {
    infrastructure: ['DATABASE_URL'],
    security: ['WALLET_MASTER_KEY', 'PIN_HASH_PEPPER'],
    telegram: ['TELEGRAM_BOT_TOKEN'],
    solana: ['SOLANA_RPC_URL'],
    execution: ['USE_JUPITER'],
    forex: ['EA_SHARED_SECRET'],
    payments: ['PAYMENT_RECEIVER_WALLET']
  } as const;

  const missing: Record<string, string[]> = {};
  for (const [group, keys] of Object.entries(required)) {
    const missed = keys.filter((k) => !(process.env[k] && String(process.env[k]).trim().length > 0));
    if (missed.length) missing[group] = missed;
  }

  const warnings: string[] = [];
  if (process.env.USE_JUPITER !== 'true') warnings.push('USE_JUPITER is not true; swap execution may remain in simulation/fallback mode.');
  if ((process.env.SHIELD_MODE || 'false') !== 'true') warnings.push('SHIELD_MODE is disabled; private relay MEV protection is off.');

  return {
    ok: Object.keys(missing).length === 0,
    missing,
    warnings,
    required
  };
}

async function canReachDatabase() {
  try {
    await query('SELECT 1');
    return true;
  } catch (e) {
    return false;
  }
}


function parsePrivateKey(input: any) {
  if (!input) throw new Error('private_key_required');
  let bytes: Buffer | null = null;
  if (Array.isArray(input)) {
    bytes = Buffer.from(input.map((v) => Number(v)));
  } else {
    const raw = String(input).trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) bytes = Buffer.from(arr.map((v: any) => Number(v)));
      } catch {}
    }
    if (!bytes) {
      try {
        const b64 = Buffer.from(raw, 'base64');
        if (b64.length === 32 || b64.length === 64) bytes = b64;
      } catch {}
    }
    if (!bytes) {
      try {
        const b58 = Buffer.from(bs58.decode(raw));
        if (b58.length === 32 || b58.length === 64) bytes = b58;
      } catch {}
    }
  }
  if (!bytes || (bytes.length !== 32 && bytes.length !== 64)) throw new Error('invalid_private_key_format');
  return bytes;
}

function deriveSolanaKeypairFromMnemonic(mnemonic: string, passphrase = '', account = 0, index = 0) {
  const words = String(mnemonic || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 12 && words.length !== 24) throw new Error('mnemonic_must_be_12_or_24_words');
  const normalized = words.join(' ');
  const seed = crypto.pbkdf2Sync(normalized, `mnemonic${passphrase || ''}`, 2048, 64, 'sha512');
  const root = crypto.createHmac('sha512', 'ed25519 seed').update(seed).digest();
  let key = root.subarray(0, 32);
  let chain = root.subarray(32);
  const path = [44, 501, Number(account || 0), Number(index || 0)];
  for (const seg of path) {
    const idx = (seg | 0) + 0x80000000;
    const data = Buffer.alloc(1 + 32 + 4);
    data[0] = 0;
    key.copy(data, 1);
    data.writeUInt32BE(idx >>> 0, 33);
    const digest = crypto.createHmac('sha512', chain).update(data).digest();
    key = digest.subarray(0, 32);
    chain = digest.subarray(32);
  }
  return Keypair.fromSeed(Uint8Array.from(key));
}

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// Readiness endpoint for deployment validation
app.get('/admin/readiness', async (_req, res) => {
  const readiness = computeReadiness();
  const dbOk = await canReachDatabase();
  if (!dbOk) readiness.warnings.push('DATABASE_URL is set but database is not reachable.');
  const ok = readiness.ok && dbOk;
  res.status(ok ? 200 : 503).json({ ...readiness, ok, checks: { database: dbOk } });
});


// Create user (minimal)
app.post('/users', async (req, res) => {
  try {
    const { telegram_id } = req.body;
    const id = uuidv4();
    await query('INSERT INTO users(id, telegram_id, status, created_at) VALUES($1,$2,$3,now())', [id, telegram_id, 'active']);
    await writeAudit(id, 'user.create', { telegram_id });
    res.json({ id });
  } catch (e: any) {
    res.status(503).json({ error: 'database_unavailable', detail: String(e?.message || e) });
  }
});


// Security PIN management
app.post('/security/pin/set', async (req, res) => {
  try {
    const { user_id, pin } = req.body;
    if (!user_id || !pin || String(pin).length < 4) return res.status(400).json({ error: 'pin_min_length_4' });
    const hp = await hashPin(String(pin));
    await query('INSERT INTO security_pins(user_id,pin_hash,salt,created_at) VALUES($1,$2,$3,now()) ON CONFLICT (user_id) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, salt=EXCLUDED.salt, created_at=now()', [user_id, hp.hash, hp.salt]);
    await writeAudit(user_id, 'security.pin.set', {});
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || String(e) });
  }
});

app.post('/security/pin/change', async (req, res) => {
  try {
    const { user_id, old_pin, new_pin } = req.body;
    if (!user_id || !old_pin || !new_pin || String(new_pin).length < 4) return res.status(400).json({ error: 'invalid_pin_change_payload' });
    const sp = await query('SELECT pin_hash, salt FROM security_pins WHERE user_id=$1', [user_id]);
    if (sp.rowCount === 0) return res.status(404).json({ error: 'pin_not_set' });
    const ok = await verifyPin(String(old_pin), sp.rows[0].salt, sp.rows[0].pin_hash);
    if (!ok) return res.status(403).json({ error: 'pin_invalid' });
    const hp = await hashPin(String(new_pin));
    await query('UPDATE security_pins SET pin_hash=$1,salt=$2,created_at=now() WHERE user_id=$3', [hp.hash, hp.salt, user_id]);
    await writeAudit(user_id, 'security.pin.change', {});
    res.json({ ok: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || String(e) });
  }
});

app.post('/security/pin/verify', async (req, res) => {
  try {
    const { user_id, pin } = req.body;
    if (!user_id || !pin) return res.status(400).json({ error: 'user_id_pin_required' });
    const sp = await query('SELECT pin_hash, salt FROM security_pins WHERE user_id=$1', [user_id]);
    if (sp.rowCount === 0) return res.status(404).json({ error: 'pin_not_set' });
    const ok = await verifyPin(String(pin), sp.rows[0].salt, sp.rows[0].pin_hash);
    await writeAudit(user_id, 'security.pin.verify', { ok });
    res.status(ok ? 200 : 403).json({ ok });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || String(e) });
  }
});

// Wallet create/import (custodial)
app.post('/wallets', async (req, res) => {
  try {
    const { user_id, label, privkey_b64, set_active = true } = req.body;
    let kp: Keypair;
    if (privkey_b64) {
      const raw = Buffer.from(privkey_b64, 'base64');
      if (raw.length === 64) kp = Keypair.fromSecretKey(Uint8Array.from(raw));
      else if (raw.length === 32) kp = Keypair.fromSeed(Uint8Array.from(raw));
      else return res.status(400).json({ error: 'invalid_privkey_b64_length' });
    } else {
      kp = Keypair.generate();
    }

    const walletId = uuidv4();
    const aad = Buffer.from(`${walletId}:${user_id}`);
    const secret = Buffer.from(kp.secretKey);
    const { ciphertext, iv, tag } = encryptPrivateKey(secret, aad);
    secret.fill(0);
    if (set_active) await query('UPDATE wallets SET is_active=false WHERE user_id=$1', [user_id]);
    await query(
      `INSERT INTO wallets(id, user_id, label, pubkey, enc_privkey, enc_iv, enc_tag, is_active, created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [walletId, user_id, label || 'wallet', kp.publicKey.toBase58(), ciphertext.toString('base64'), iv.toString('base64'), tag.toString('base64'), !!set_active]
    );
    await writeAudit(user_id, 'wallet.create', { walletId, label, pubkey: kp.publicKey.toBase58(), set_active: !!set_active });
    res.json({ walletId, pubkey: kp.publicKey.toBase58(), created: true });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || String(e) });
  }
});

app.post('/wallets/import', async (req, res) => {
  try {
    const { user_id, label, import_type, private_key, mnemonic, passphrase = '', account = 0, index = 0, set_active = true } = req.body;
    let kp: Keypair;
    if (import_type === 'private_key') {
      const raw = parsePrivateKey(private_key);
      kp = raw.length === 64 ? Keypair.fromSecretKey(Uint8Array.from(raw)) : Keypair.fromSeed(Uint8Array.from(raw));
      raw.fill(0);
    } else if (import_type === 'mnemonic') {
      kp = deriveSolanaKeypairFromMnemonic(String(mnemonic || ''), String(passphrase || ''), Number(account || 0), Number(index || 0));
    } else {
      return res.status(400).json({ error: 'import_type_must_be_private_key_or_mnemonic' });
    }

    const walletId = uuidv4();
    const aad = Buffer.from(`${walletId}:${user_id}`);
    const secret = Buffer.from(kp.secretKey);
    const { ciphertext, iv, tag } = encryptPrivateKey(secret, aad);
    secret.fill(0);
    if (set_active) await query('UPDATE wallets SET is_active=false WHERE user_id=$1', [user_id]);
    await query(
      `INSERT INTO wallets(id, user_id, label, pubkey, enc_privkey, enc_iv, enc_tag, is_active, created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [walletId, user_id, label || `imported-${import_type}`, kp.publicKey.toBase58(), ciphertext.toString('base64'), iv.toString('base64'), tag.toString('base64'), !!set_active]
    );
    await writeAudit(user_id, 'wallet.import', { walletId, import_type, pubkey: kp.publicKey.toBase58(), account: Number(account || 0), index: Number(index || 0), set_active: !!set_active });
    res.json({ walletId, pubkey: kp.publicKey.toBase58(), imported: true, import_type });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || String(e) });
  }
});

// Admin: create meme candidate (for testing/demo)
app.post('/admin/meme/candidates', async (req, res) => {
  const { mint } = req.body;
  const id = uuidv4();
  await query('INSERT INTO meme_candidates(id,mint,detected_at,status) VALUES($1,$2,now(),$3)', [id, mint, 'new']);
  await writeAudit(null, 'admin.meme.candidate.create', { id, mint });
  res.json({ id });
});

// Admin: toggle user kill switch
app.post('/admin/user/:user_id/kill_switch', async (req, res) => {
  const { user_id } = req.params;
  const { kill } = req.body;
  await query('INSERT INTO user_risk_states(user_id,kill_switch,last_reset) VALUES($1,$2,now()) ON CONFLICT (user_id) DO UPDATE SET kill_switch=EXCLUDED.kill_switch, last_reset=now()', [user_id, !!kill]);
  await writeAudit(null, 'admin.user.kill_switch', { user_id, kill });
  res.json({ ok: true });
});

// Admin: set user financials (reserve/profit buffer)
app.post('/admin/user/:user_id/financials', async (req, res) => {
  const { user_id } = req.params;
  const { trading_capital, reserve_buffer, profit_buffer_enabled } = req.body;
  await query('INSERT INTO user_financials(user_id,trading_capital,reserve_buffer,profit_buffer_enabled,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT (user_id) DO UPDATE SET trading_capital=EXCLUDED.trading_capital, reserve_buffer=EXCLUDED.reserve_buffer, profit_buffer_enabled=EXCLUDED.profit_buffer_enabled, updated_at=now()', [user_id, trading_capital || 0, reserve_buffer || 0, !!profit_buffer_enabled]);
  await writeAudit(null, 'admin.user.financials.update', { user_id });
  res.json({ ok: true });
});

// Terminal screens renderer
app.get('/terminal/screens/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const screens = {
    SCREEN_MAIN: { title: 'Terminal', buttons: ['Buy','Sell','Positions','Orders','Wallets','Settings'] },
    SCREEN_BUY_INPUT: { title: 'Buy Token', fields: ['mint'] },
    SCREEN_BUY_PANEL: { title: 'Buy Panel', controls: ['presets','custom_amount','slippage','exec_mode','shield','confirm'] },
    SCREEN_BUY_SETTINGS: { title: 'Buy Settings' },
    SCREEN_BUY_SLIPPAGE: { title: 'Buy Slippage' },
    SCREEN_EXECUTION_MODE: { title: 'Execution Mode' },
    SCREEN_SHIELD_MODE: { title: 'Shield Mode' },
    SCREEN_BUY_PRESETS: { title: 'Buy Presets' },
    SCREEN_POSITIONS: { title: 'Positions' },
    SCREEN_SELL_PANEL: { title: 'Sell Panel' },
    SCREEN_SELL_SETTINGS: { title: 'Sell Settings' },
    SCREEN_SELL_SLIPPAGE: { title: 'Sell Slippage' },
    SCREEN_ORDERS_MAIN: { title: 'Orders' },
    SCREEN_LIMIT_ORDERS: { title: 'Limit Orders' },
    SCREEN_DCA_ORDERS: { title: 'DCA Orders' },
    SCREEN_SNIPER_MAIN: { title: 'Sniper' },
    SCREEN_COPY_MAIN: { title: 'Copy Trade' },
    SCREEN_WALLET_MAIN: { title: 'Wallets' },
    SCREEN_WITHDRAW_FLOW: { title: 'Withdraw' },
    SCREEN_SECURITY_MAIN: { title: 'Security' },
    SCREEN_SETTINGS_MAIN: { title: 'Settings' }
  };
  await writeAudit(user_id, 'terminal.screens.view', { screens: Object.keys(screens) });
  res.json({ screens });
});

// Terminal: get positions
app.get('/terminal/positions/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const r = await query('SELECT * FROM sol_positions WHERE user_id=$1', [user_id]);
  await writeAudit(user_id, 'terminal.positions.view', {});
  res.json({ positions: r.rows });
});

// List wallets for user
app.get('/wallets/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const r = await query('SELECT id,label,pubkey,is_active,created_at FROM wallets WHERE user_id=$1', [user_id]);
  const wallets = [];
  const price = await getSolPriceUsd();
  for (const w of r.rows) {
    let balance_sol: number | null = null;
    let balance_usd: number | null = null;
    if (w.pubkey) {
      try {
        balance_sol = await getBalancePublicKey(w.pubkey);
        if (balance_sol !== null && price !== null) balance_usd = balance_sol * price;
      } catch (e) {
        balance_sol = null;
      }
    }
    wallets.push({ ...w, balance_sol, balance_usd });
  }
  await writeAudit(user_id, 'wallets.list', {});
  res.json({ wallets });
});


app.post('/wallets/:wallet_id/activate', async (req, res) => {
  try {
    const { wallet_id } = req.params;
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id_required' });
    const own = await query('SELECT id FROM wallets WHERE id=$1 AND user_id=$2', [wallet_id, user_id]);
    if (own.rowCount === 0) return res.status(404).json({ error: 'wallet_not_found' });
    await query('UPDATE wallets SET is_active=false WHERE user_id=$1', [user_id]);
    await query('UPDATE wallets SET is_active=true WHERE id=$1', [wallet_id]);
    await writeAudit(user_id, 'wallet.activate', { wallet_id });
    res.json({ ok: true, wallet_id });
  } catch (e: any) {
    res.status(400).json({ error: e?.message || String(e) });
  }
});

// Admin endpoints for withdrawals
app.get('/admin/withdrawals', async (req, res) => {
  const limit = Number(req.query.limit || 100);
  const r = await query('SELECT id,user_id,wallet_id,amount_usd,destination,status,txid,error,created_at FROM withdrawals ORDER BY created_at DESC LIMIT $1', [limit]);
  res.json({ withdrawals: r.rows });
});

app.get('/withdrawals/:id', async (req, res) => {
  const { id } = req.params;
  const r = await query('SELECT * FROM withdrawals WHERE id=$1', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ withdrawal: r.rows[0] });
});

app.post('/admin/withdrawals/:id/retry', async (req, res) => {
  const { id } = req.params;
  // set back to requested for worker to pick up
  await query('UPDATE withdrawals SET status=$1, error=null, processed_at=null WHERE id=$2', ['requested', id]);
  await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [uuidv4(), null, 'admin', 'info', 'withdrawal_retry', JSON.stringify({ id })]);
  res.json({ ok: true });
});

app.post('/admin/withdrawals/:id/update', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  await query('UPDATE withdrawals SET status=$1, processed_at=now() WHERE id=$2', [status, id]);
  res.json({ ok: true });
});

// Minimal admin UI
app.get('/admin/withdrawals/ui', async (req, res) => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Withdrawals Admin</title></head><body><h1>Withdrawals</h1><div id="list">Loading...</div><script>
async function load(){
 const r=await fetch('/admin/withdrawals');
 const j=await r.json();
 const out=document.getElementById('list'); out.innerHTML='';
 j.withdrawals.forEach(function(w){
   var d=document.createElement('div');
   d.innerHTML = '<b>'+w.id+'</b> user:'+w.user_id+' amt:'+w.amount_usd+' status:'+w.status+' tx:'+(w.txid||'')+' <button onclick="fetch(\'/admin/withdrawals/'+w.id+'/retry\',{method:\'POST\'}).then(function(){location.reload()})">Retry</button>';
   out.appendChild(d);
 });
}
load();
</script></body></html>`;
  res.setHeader('content-type','text/html');
  res.send(html);
});

// Estimate withdraw: return estimated SOL amount and fee buffer info
app.get('/wallets/:wallet_id/estimate', async (req, res) => {
  const { wallet_id } = req.params;
  const amountUsd = Number(req.query.amount_usd || 0);
  if (!amountUsd || amountUsd <= 0) return res.status(400).json({ error: 'invalid_amount' });
  const r = await query('SELECT pubkey FROM wallets WHERE id=$1', [wallet_id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'wallet_not_found' });
  const pubkey = r.rows[0].pubkey;
  const price = await getSolPriceUsd();
  if (!price) return res.status(500).json({ error: 'price_unavailable' });
  const solAmount = amountUsd / price;
  const lamports = Math.round(solAmount * 1e9);
  const feeBufferSol = Number(process.env.WITHDRAW_FEE_BUFFER_SOL || '0.001');
  const feeBufferLamports = Math.round(feeBufferSol * 1e9);
  let balance_sol = null;
  let balance_usd = null;
  try {
    balance_sol = pubkey ? await getBalancePublicKey(pubkey) : null;
    if (balance_sol !== null) balance_usd = balance_sol * price;
  } catch (e) {
    // ignore
  }
  res.json({ solAmount, lamports, feeBufferSol, feeBufferLamports, balance_sol, balance_usd });
});

// Terminal: buy quote (real routing only; no simulated fallback)
app.post('/terminal/buy/quote', async (req, res) => {
  const { inputMint = 'SOL', outputMint, amount_usd, slippageBps = 100 } = req.body;
  const amountUsd = Number(amount_usd || 0);
  if (!outputMint || amountUsd <= 0) return res.status(400).json({ error: 'invalid_quote_request' });

  if (process.env.USE_JUPITER !== 'true') return res.status(503).json({ error: 'routing_disabled_use_jupiter_false' });

  const lamportsIn = Math.max(1, Math.round(amountUsd * 1_000_000_000));
  const jup = await getJupiterQuote(inputMint, outputMint, lamportsIn, Number(slippageBps || 100));
  if (!jup) return res.status(503).json({ error: 'quote_unavailable' });
  const route = Array.isArray(jup?.data) ? jup.data[0] : null;
  if (!route) return res.status(503).json({ error: 'route_unavailable' });
  const expectedOutRaw = route?.outAmount || route?.out_amount || route?.amountOut || null;
  const priceImpactPct = Number(route?.priceImpactPct ?? route?.price_impact_pct ?? 0);
  const expectedOut = expectedOutRaw ? Number(expectedOutRaw) : null;
  return res.json({
    quote: {
      provider: 'jupiter',
      expectedOut,
      expectedOutRaw,
      priceImpactPct,
      slippageBps: Number(slippageBps || 100),
      route
    }
  });
});

// Helper: check subscription entitlement
async function hasEntitlement(userId: string, entitlement: 'meme_pro' | 'forex_pro' | 'terminal') {
  if (entitlement === 'terminal') return true;
  const s = await query('SELECT plan, active_until FROM subscriptions WHERE user_id=$1 ORDER BY active_until DESC LIMIT 1', [userId]);
  if (s.rowCount === 0) return false;
  const row = s.rows[0];
  const now = new Date();
  return new Date(row.active_until) > now && ((entitlement === 'meme_pro' && (row.plan === 'meme' || row.plan === 'bundle')) || (entitlement === 'forex_pro' && (row.plan === 'forex' || row.plan === 'bundle')));
}

// Terminal: execute buy with idempotency, gating, pin check, risk checks
app.post('/terminal/buy/execute', async (req, res) => {
  try {
    const { user_id, wallet_id, mint, amount_usd, idempotency_key, slippage_bps, exec_mode, shield, pin } = req.body;
    // idempotency
    const existed = await query('SELECT 1 FROM idempotency_keys WHERE key_value=$1', [idempotency_key]);
    if (existed.rowCount > 0) return res.status(409).json({ error: 'duplicate' });
    await query('INSERT INTO idempotency_keys(id, key_value, created_at) VALUES($1,$2,now())', [uuidv4(), idempotency_key]);

  // subscription/risk gating
  const allowed = await hasEntitlement(user_id, 'terminal');
  if (!allowed) {
    await writeAudit(user_id, 'terminal.buy.blocked', { reason: 'no_entitlement' });
    return res.status(403).json({ error: 'no_entitlement' });
  }

  // Terminal settings: confirm_trades/pin enforcement
  const ts = await query('SELECT confirm_trades FROM terminal_settings WHERE user_id=$1', [user_id]);
  const confirmTrades = ts.rowCount ? ts.rows[0].confirm_trades : true;
  if (confirmTrades) {
    if (!pin) return res.status(400).json({ error: 'pin_required' });
    const sp = await query('SELECT pin_hash, salt FROM security_pins WHERE user_id=$1', [user_id]);
    if (sp.rowCount === 0) return res.status(403).json({ error: 'pin_not_set' });
    const ok = await verifyPin(pin, sp.rows[0].salt, sp.rows[0].pin_hash);
    if (!ok) return res.status(403).json({ error: 'pin_invalid' });
  }

  // Risk: basic min trade
  try {
    await enforceAll(user_id, Number(amount_usd));
  } catch (e: any) {
    await writeAudit(user_id, 'terminal.buy.blocked', { reason: e.message });
    return res.status(400).json({ error: e.message });
  }

  let resolvedWalletId = wallet_id;
  if (!resolvedWalletId) {
    const wr = await query('SELECT id FROM wallets WHERE user_id=$1 AND is_active=true ORDER BY created_at DESC LIMIT 1', [user_id]);
    if (wr.rowCount === 0) return res.status(400).json({ error: 'wallet_required_no_active_wallet' });
    resolvedWalletId = wr.rows[0].id;
  }

  const tradeId = uuidv4();
  await query(
    `INSERT INTO sol_trades(id, user_id, wallet_id, mint, side, amount_in_usd, status, meta, created_at, updated_at)
     VALUES($1,$2,$3,$4,'buy',$5,'queued',$6,now(),now())`,
    [tradeId, user_id, resolvedWalletId, mint, amount_usd, JSON.stringify({ slippage_bps, exec_mode, shield })]
  );
    await writeAudit(user_id, 'terminal.buy.request', { tradeId, mint, amount_usd, exec_mode, shield, slippage_bps });
    res.json({ tradeId, status: 'queued' });
  } catch (e: any) {
    return res.status(503).json({ error: 'database_unavailable', detail: String(e?.message || e) });
  }
});

// Terminal: execute sell
app.post('/terminal/sell/execute', async (req, res) => {
  try {
    const { user_id, position_id, percent, idempotency_key, slippage_bps, exec_mode, shield, pin } = req.body;
    // idempotency
    const existed = await query('SELECT 1 FROM idempotency_keys WHERE key_value=$1', [idempotency_key]);
    if (existed.rowCount > 0) return res.status(409).json({ error: 'duplicate' });
    await query('INSERT INTO idempotency_keys(id, key_value, created_at) VALUES($1,$2,now())', [uuidv4(), idempotency_key]);

  // entitlement
  const allowed = await hasEntitlement(user_id, 'terminal');
  if (!allowed) {
    await writeAudit(user_id, 'terminal.sell.blocked', { reason: 'no_entitlement' });
    return res.status(403).json({ error: 'no_entitlement' });
  }

  // pin check if enabled
  const ts = await query('SELECT confirm_trades FROM terminal_settings WHERE user_id=$1', [user_id]);
  const confirmTrades = ts.rowCount ? ts.rows[0].confirm_trades : true;
  if (confirmTrades) {
    if (!pin) return res.status(400).json({ error: 'pin_required' });
    const sp = await query('SELECT pin_hash, salt FROM security_pins WHERE user_id=$1', [user_id]);
    if (sp.rowCount === 0) return res.status(403).json({ error: 'pin_not_set' });
    const ok = await verifyPin(pin, sp.rows[0].salt, sp.rows[0].pin_hash);
    if (!ok) return res.status(403).json({ error: 'pin_invalid' });
  }

  // load position
  const p = await query('SELECT * FROM sol_positions WHERE id=$1 AND user_id=$2 AND status=$3', [position_id, user_id, 'open']);
  if (p.rowCount === 0) return res.status(404).json({ error: 'position_not_found' });
  const pos = p.rows[0];
  const pct = Number(percent);
  if (isNaN(pct) || pct <= 0 || pct > 100) return res.status(400).json({ error: 'invalid_percent' });

  // compute USD value estimate (use entry_price * qty * pct)
  const amountUsd = Number(pos.entry_price || 0) * Number(pos.qty || 0) * (pct / 100);
  if (amountUsd < 10) return res.status(400).json({ error: 'minimum_sell_amount_10_required' });

  const tradeId = uuidv4();
  await query(
    `INSERT INTO sol_trades(id, user_id, wallet_id, mint, side, amount_in_usd, status, position_id, meta, created_at, updated_at)
     VALUES($1,$2,$3,$4,'sell',$5,'queued',$6,$7,now(),now())`,
    [tradeId, user_id, pos.wallet_id, pos.mint, amountUsd, position_id, JSON.stringify({ percent: pct, slippage_bps, exec_mode, shield })]
  );
    await writeAudit(user_id, 'terminal.sell.request', { tradeId, position_id, percent, amountUsd, exec_mode, shield, slippage_bps });
    res.json({ tradeId, status: 'queued' });
  } catch (e: any) {
    return res.status(503).json({ error: 'database_unavailable', detail: String(e?.message || e) });
  }
});

// Orders endpoints: create/list/cancel
app.post('/orders', async (req, res) => {
  try {
    const { user_id, wallet_id, type, mint, params } = req.body;
    // Basic validations for order types
    if (type === 'limit' || type === 'dca') {
      const amount = params?.amount_usd ?? null;
      if (!amount || Number(amount) < 10) {
        return res.status(400).json({ error: 'minimum_order_amount_10_required' });
      }
    }
    const id = uuidv4();
    if (type === 'limit' || type === 'dca') await enforceAll(user_id, Number(params.amount_usd || 0));
    await query('INSERT INTO orders(id,user_id,wallet_id,type,mint,params,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())', [id, user_id, wallet_id, type, mint, params, 'open']);
    await writeAudit(user_id, 'orders.create', { id, type, mint });
    res.json({ id });
  } catch (e: any) {
    if (e?.message) return res.status(400).json({ error: e.message });
    return res.status(503).json({ error: 'database_unavailable', detail: String(e?.message || e) });
  }
});

app.post('/subscriptions/activate', async (req, res) => {
  const { user_id, plan, months = 1, reference } = req.body;
  const normalizedPlan = normalizePlan(plan);
  if (!user_id) return res.status(400).json({ error: 'user_id_required' });
  if (!normalizedPlan) return res.status(400).json({ error: 'invalid_plan', allowed: ['meme', 'forex', 'bundle'] });
  const monthsN = Number(months || 1);
  if (!Number.isInteger(monthsN) || monthsN <= 0 || monthsN > 12) return res.status(400).json({ error: 'invalid_months' });

  const id = uuidv4();
  const now = new Date();
  const active_until = new Date(now.getTime() + monthsN * 30 * 24 * 60 * 60 * 1000).toISOString();
  const expectedAmount = Number(SUBSCRIPTION_PRICES[normalizedPlan]) * monthsN;
  await query('INSERT INTO payments(id,user_id,amount_usd,method,reference,status,created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [uuidv4(), user_id, expectedAmount, 'manual', reference || null, 'received']);
  await query('UPDATE subscriptions SET status=$1, updated_at=now() WHERE user_id=$2 AND status=$3', ['expired', user_id, 'active']);
  await query('INSERT INTO subscriptions(id,user_id,plan,status,active_until,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())', [id, user_id, normalizedPlan, 'active', active_until]);
  await writeAudit(user_id, 'subscription.activate', { plan: normalizedPlan, months: monthsN, expectedAmount, active_until, reference: reference || null });
  res.json({ id, active_until, plan: normalizedPlan, amount_usd: expectedAmount });
});

app.get('/subscriptions/status/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const s = await query('SELECT plan, status, active_until FROM subscriptions WHERE user_id=$1 ORDER BY active_until DESC LIMIT 1', [user_id]);
  if (s.rowCount === 0) return res.json({ active: false, entitlements: { terminal: true, meme_pro: false, forex_pro: false } });
  const row = s.rows[0];
  const active = new Date(row.active_until) > new Date() && row.status === 'active';
  const entitlements = {
    terminal: true,
    meme_pro: active && (row.plan === 'meme' || row.plan === 'bundle'),
    forex_pro: active && (row.plan === 'forex' || row.plan === 'bundle')
  };
  res.json({ active, subscription: row, entitlements });
});

app.get('/orders/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const r = await query('SELECT * FROM orders WHERE user_id=$1', [user_id]);
  await writeAudit(user_id, 'orders.list', {});
  res.json({ orders: r.rows });
});

// Get position by id
app.get('/positions/:id', async (req, res) => {
  const { id } = req.params;
  const r = await query('SELECT * FROM sol_positions WHERE id=$1', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ position: r.rows[0] });
});

// Copy trade: create a copy order
app.post('/copy_trade', async (req, res) => {
  const { user_id, source, mint, amount_usd } = req.body;
  if (!source || String(source).trim().length < 3) return res.status(400).json({ error: 'source_required' });
  const amt = Number(amount_usd || 0);
  if (amt > 0 && amt < 10) return res.status(400).json({ error: 'minimum_copy_amount_10_required' });
  const id = uuidv4();
  await query('INSERT INTO orders(id,user_id,wallet_id,type,mint,params,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())', [id, user_id, null, 'copy', mint || null, JSON.stringify({ source, amount_usd: amt > 0 ? amt : null }), 'open']);
  await writeAudit(user_id, 'copy_trade.create', { id, source, mint, amount_usd: amt > 0 ? amt : null });
  res.json({ id });
});

// Sniper control (start/stop)
app.post('/sniper/start', async (req, res) => {
  const { user_id, profile } = req.body;
  const id = uuidv4();
  await query('INSERT INTO meme_sniper_profiles(id,user_id,profile,created_at) VALUES($1,$2,$3,now())', [id, user_id, profile || {}]);
  await writeAudit(user_id, 'sniper.start', { id });
  res.json({ id, status: 'started' });
});

app.post('/sniper/stop', async (req, res) => {
  const { user_id } = req.body;
  // mark profiles as stopped by deleting (demo) or insert event
  await query('DELETE FROM meme_sniper_profiles WHERE user_id=$1', [user_id]);
  await writeAudit(user_id, 'sniper.stop', {});
  res.json({ ok: true });
});

// Watchlist stored in terminal_settings.presets_json.watchlist
app.get('/watchlist/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const r = await query('SELECT presets_json FROM terminal_settings WHERE user_id=$1', [user_id]);
  const prefs = r.rowCount ? (typeof r.rows[0].presets_json === 'string' ? JSON.parse(r.rows[0].presets_json) : r.rows[0].presets_json) : {};
  res.json({ watchlist: prefs.watchlist || [] });
});

app.post('/watchlist/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { mint } = req.body;
  const r = await query('SELECT presets_json FROM terminal_settings WHERE user_id=$1', [user_id]);
  const current = r.rowCount ? (typeof r.rows[0].presets_json === 'string' ? JSON.parse(r.rows[0].presets_json) : r.rows[0].presets_json) : {};
  const list = current.watchlist || [];
  if (!list.includes(mint)) list.push(mint);
  const updated = { ...current, watchlist: list };
  await query('INSERT INTO terminal_settings(user_id,presets_json,updated_at) VALUES($1,$2,now()) ON CONFLICT (user_id) DO UPDATE SET presets_json=EXCLUDED.presets_json, updated_at=now()', [user_id, JSON.stringify(updated)]);
  await writeAudit(user_id, 'watchlist.add', { mint });
  res.json({ watchlist: list });
});

app.delete('/watchlist/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { mint } = req.body;
  const r = await query('SELECT presets_json FROM terminal_settings WHERE user_id=$1', [user_id]);
  const current = r.rowCount ? (typeof r.rows[0].presets_json === 'string' ? JSON.parse(r.rows[0].presets_json) : r.rows[0].presets_json) : {};
  const list = (current.watchlist || []).filter((m: any) => m !== mint);
  const updated = { ...current, watchlist: list };
  await query('INSERT INTO terminal_settings(user_id,presets_json,updated_at) VALUES($1,$2,now()) ON CONFLICT (user_id) DO UPDATE SET presets_json=EXCLUDED.presets_json, updated_at=now()', [user_id, JSON.stringify(updated)]);
  await writeAudit(user_id, 'watchlist.remove', { mint });
  res.json({ watchlist: list });
});

// Rewards (simple list from notifications with channel=reward)
app.get('/rewards/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const r = await query('SELECT * FROM notifications WHERE user_id=$1 AND channel=$2 ORDER BY created_at DESC LIMIT 50', [user_id, 'reward']);
  res.json({ rewards: r.rows });
});

app.post('/orders/:id/cancel', async (req, res) => {
  const { id } = req.params;
  await query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', ['cancelled', id]);
  await writeAudit(null, 'orders.cancel', { id });
  // create a notification for the user (if order has user_id)
  try {
    const or = await query('SELECT user_id FROM orders WHERE id=$1', [id]);
    if (or.rowCount) {
      const uid = or.rows[0].user_id;
      await query('INSERT INTO notifications(id,user_id,channel,payload,created_at) VALUES($1,$2,$3,$4,now())', [uuidv4(), uid, 'telegram', JSON.stringify({ type: 'order_cancelled', order_id: id })]);
    }
  } catch (e) {
    // swallow
  }
  res.json({ ok: true });
});

// Terminal settings
app.get('/terminal/settings/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const r = await query('SELECT * FROM terminal_settings WHERE user_id=$1', [user_id]);
  res.json({ settings: r.rowCount ? r.rows[0] : null });
});

app.post('/terminal/settings/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { buy_slippage_bps, sell_slippage_bps, exec_mode, shield_enabled, confirm_trades, presets_json } = req.body;
  await query('INSERT INTO terminal_settings(user_id,buy_slippage_bps,sell_slippage_bps,exec_mode,shield_enabled,confirm_trades,presets_json,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (user_id) DO UPDATE SET buy_slippage_bps=EXCLUDED.buy_slippage_bps, sell_slippage_bps=EXCLUDED.sell_slippage_bps, exec_mode=EXCLUDED.exec_mode, shield_enabled=EXCLUDED.shield_enabled, confirm_trades=EXCLUDED.confirm_trades, presets_json=EXCLUDED.presets_json, updated_at=now()', [user_id, buy_slippage_bps, sell_slippage_bps, exec_mode, shield_enabled, confirm_trades, presets_json]);
  await writeAudit(user_id, 'terminal.settings.update', {});
  res.json({ ok: true });
});



// EA bind/register terminal token for a user
app.post('/ea/bind', async (req, res) => {
  const { user_id, platform = 'mt5', terminal_id, token } = req.body;
  if (!user_id || !terminal_id || !token) return res.status(400).json({ error: 'user_id_terminal_id_token_required' });
  const id = uuidv4();
  await query(
    `INSERT INTO ea_terminals(id,user_id,platform,terminal_id,token_hash,status,last_seen_at)
     VALUES($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (terminal_id)
     DO UPDATE SET user_id=EXCLUDED.user_id, platform=EXCLUDED.platform, token_hash=EXCLUDED.token_hash, status=EXCLUDED.status, last_seen_at=now()`,
    [id, user_id, platform, terminal_id, token, 'active']
  );
  await writeAudit(user_id, 'ea.bind', { terminal_id, platform });
  res.json({ ok: true, terminal_id });
});

// Endpoint: EA poll (Forex) - implements subscription + risk gating
app.post('/ea/poll', async (req, res) => {
  const { terminal_id, token, equity } = req.body;
  // Minimal validation: look up terminal
  const r = await query('SELECT user_id FROM ea_terminals WHERE terminal_id=$1 AND token_hash=$2', [terminal_id, token]);
  if (r.rowCount === 0) {
    return res.json({ status: 'NO_SIGNAL' });
  }
  const userId = r.rows[0].user_id;
  // Check subscription
  const s = await query('SELECT plan, active_until FROM subscriptions WHERE user_id=$1 ORDER BY active_until DESC LIMIT 1', [userId]);
  const active = s.rowCount > 0 && new Date(s.rows[0].active_until) > new Date();
  if (!active) {
    await writeAudit(userId, 'ea.poll.blocked', { reason: 'no_subscription' });
    return res.json({ status: 'NO_SIGNAL' });
  }
  // Simple risk check placeholder
  const maxOpen = 2;
  const open = await query('SELECT count(*) FROM forex_positions WHERE user_id=$1 AND status=$2', [userId, 'open']);
  if (parseInt(open.rows[0].count, 10) >= maxOpen) {
    await writeAudit(userId, 'ea.poll.blocked', { reason: 'max_open' });
    return res.json({ status: 'NO_SIGNAL' });
  }
  // Deterministic example signal (placeholder)
  const now = Date.now();
  const signal = {
    status: 'SIGNAL',
    symbol: 'EURUSD',
    side: 'BUY',
    lot: 0.01,
    sl: 1.0,
    tp: 1.5,
    idempotency_id: uuidv4(),
    expires_at: new Date(now + 60 * 1000).toISOString()
  };
  await writeAudit(userId, 'ea.poll.signal', signal);
  res.json(signal);
});

// EA report
app.post('/ea/report', async (req, res) => {
  const { idempotency_id, broker_ticket, filled_price, terminal_id } = req.body;
  await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
    uuidv4(), null, 'forex-ea', 'info', 'ea.report', JSON.stringify(req.body)
  ]);
  // Record idempotency
  await query('INSERT INTO idempotency_keys(id, key_value, created_at) VALUES($1,$2,now()) ON CONFLICT DO NOTHING', [uuidv4(), idempotency_id]);
  res.json({ ok: true });
});

// Webhook: payment notifications
app.post('/webhooks/payments', async (req, res) => {
  const { reference, user_id, amount_usd, status, plan = null, months = 1 } = req.body;
  if (!reference || !user_id) return res.status(400).json({ error: 'invalid' });
  const normalizedPlan = plan ? normalizePlan(plan) : null;
  const monthsN = Number(months || 1);
  const amountN = Number(amount_usd || 0);

  await query('INSERT INTO payments(id,user_id,amount_usd,method,reference,status,created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [uuidv4(), user_id, amountN, 'webhook', reference, status || 'pending']);

  if (status === 'received' || status === 'confirmed') {
    if (!normalizedPlan) return res.status(400).json({ error: 'plan_required_for_activation' });
    if (!Number.isInteger(monthsN) || monthsN <= 0 || monthsN > 12) return res.status(400).json({ error: 'invalid_months' });
    const expectedAmount = Number(SUBSCRIPTION_PRICES[normalizedPlan]) * monthsN;
    if (Math.abs(amountN - expectedAmount) > 0.000001) {
      await writeAudit(user_id, 'webhook.payment.mismatch', { reference, amount_usd: amountN, expectedAmount, plan: normalizedPlan, months: monthsN });
      return res.status(400).json({ error: 'amount_mismatch', expected_amount_usd: expectedAmount });
    }

    const subId = uuidv4();
    const now = new Date();
    const active_until = new Date(now.getTime() + monthsN * 30 * 24 * 60 * 60 * 1000).toISOString();
    await query('UPDATE subscriptions SET status=$1, updated_at=now() WHERE user_id=$2 AND status=$3', ['expired', user_id, 'active']);
    await query('INSERT INTO subscriptions(id,user_id,plan,status,active_until,created_at,updated_at) VALUES($1,$2,$3,$4,$5,now(),now())', [subId, user_id, normalizedPlan, 'active', active_until]);
    await writeAudit(user_id, 'webhook.payment.activated', { reference, active_until, plan: normalizedPlan, months: monthsN, amount_usd: amountN });
  }
  res.json({ ok: true });
});

// Withdraw request (simple custodial withdrawal request)
app.post('/wallets/:wallet_id/withdraw', async (req, res) => {
  const { wallet_id } = req.params;
  const { user_id, amount_usd, destination_pubkey, pin, idempotency_key } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id_required' });
  if (!pin) return res.status(400).json({ error: 'pin_required' });
  if (!destination_pubkey) return res.status(400).json({ error: 'destination_required' });
  // verify pin
  const sp = await query('SELECT pin_hash, salt FROM security_pins WHERE user_id=$1', [user_id]);
  if (sp.rowCount === 0) return res.status(403).json({ error: 'pin_not_set' });
  const ok = await verifyPin(pin, sp.rows[0].salt, sp.rows[0].pin_hash);
  if (!ok) return res.status(403).json({ error: 'pin_invalid' });

  // basic minimum amount check (configurable)
  const MIN_WITHDRAW = Number(process.env.WITHDRAW_MIN_USD || '10');
  if (Number(amount_usd) < MIN_WITHDRAW) return res.status(400).json({ error: 'minimum_withdraw_amount', minimum: MIN_WITHDRAW });

  // Check trading capital / balance before allowing withdrawal
  try {
    const fin = await getTradingCapital(user_id);
    const tradingCapital = Number(fin.tradingCapital || 0);
    if (Number(amount_usd) > tradingCapital) {
      await writeAudit(user_id, 'wallet.withdraw.blocked', { reason: 'insufficient_trading_capital', amount_usd, tradingCapital });
      return res.status(400).json({ error: 'insufficient_trading_capital', tradingCapital });
    }
  } catch (e) {
    // If trading capital check fails, block by default
    return res.status(500).json({ error: 'trading_capital_check_failed' });
  }
  // Validate destination pubkey format and compute required lamports
  try {
    const price = await getSolPriceUsd();
    if (!price) return res.status(500).json({ error: 'price_unavailable' });
    const solAmount = Number(amount_usd) / Number(price);
    const lamportsNeeded = Math.round(solAmount * 1e9);
    const feeBufferSol = Number(process.env.WITHDRAW_FEE_BUFFER_SOL || '0.001');
    const feeBufferLamports = Math.round(feeBufferSol * 1e9);

    // fetch wallet pubkey and balance
    const wr = await query('SELECT pubkey FROM wallets WHERE id=$1', [wallet_id]);
    if (wr.rowCount === 0) return res.status(404).json({ error: 'wallet_not_found' });
    const walletPubkey = wr.rows[0].pubkey;
    const walletBalanceSol = walletPubkey ? await getBalancePublicKey(walletPubkey) : null;
    if (walletBalanceSol === null) return res.status(500).json({ error: 'wallet_balance_unavailable' });
    const walletLamports = Math.round(walletBalanceSol * 1e9);

    // estimate actual transfer fee
    const feeEstimate = await estimateTransferFee({ fromPubkey: walletPubkey, toPubkey: destination_pubkey, lamports: lamportsNeeded });
    const required = lamportsNeeded + feeBufferLamports + Math.round(feeEstimate || 5000);
    if (walletLamports < required) {
      await writeAudit(user_id, 'wallet.withdraw.blocked', { reason: 'insufficient_wallet_balance', walletLamports, required });
      return res.status(400).json({ error: 'insufficient_wallet_balance', walletLamports, required });
    }

    // idempotency: if idempotency_key provided, check existing
    if (idempotency_key) {
      const ex = await query('SELECT id,status FROM withdrawals WHERE idempotency_key=$1', [idempotency_key]);
      if (ex.rowCount > 0) return res.json({ ok: true, id: ex.rows[0].id, status: ex.rows[0].status });
    }

    // persist withdrawal request in withdrawals table for worker processing
    const wid = uuidv4();
    await query('INSERT INTO withdrawals(id,user_id,wallet_id,amount_usd,destination,status,idempotency_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())', [wid, user_id, wallet_id, amount_usd, destination_pubkey, 'requested', idempotency_key || null]);
    await writeAudit(user_id, 'wallet.withdraw.request', { id: wid, wallet_id, amount_usd, destination_pubkey });
    res.json({ ok: true, id: wid, status: 'requested' });
  } catch (e: any) {
    await writeAudit(user_id, 'wallet.withdraw.error', { error: String(e) });
    return res.status(500).json({ error: 'withdraw_check_failed', detail: String(e) });
  }
});

// Simple trade execution request (Terminal buy) - enqueues into sol_trades and idempotency guard
app.post('/trades/sol/buy', async (req, res) => {
  const { user_id, wallet_id, mint, amount_usd, idempotency_key } = req.body;
  // Idempotency guard
  const existed = await query('SELECT 1 FROM idempotency_keys WHERE key_value=$1', [idempotency_key]);
  if (existed.rowCount > 0) return res.status(409).json({ error: 'duplicate' });
  await query('INSERT INTO idempotency_keys(id, key_value, created_at) VALUES($1,$2,now())', [uuidv4(), idempotency_key]);
  const tradeId = uuidv4();
  await query(
    `INSERT INTO sol_trades(id, user_id, wallet_id, mint, side, amount_in_usd, status, created_at)
     VALUES($1,$2,$3,$4,'buy',$5,'pending',now())`,
    [tradeId, user_id, wallet_id, mint, amount_usd]
  );
  await writeAudit(user_id, 'trade.request', { tradeId, mint, amount_usd });
  // In production, notify Solana engine via queue. Here we return pending.
  res.json({ tradeId, status: 'pending' });
});

// Get trade status
app.get('/trades/:id', async (req, res) => {
  const { id } = req.params;
  const r = await query('SELECT * FROM sol_trades WHERE id=$1', [id]);
  if (r.rowCount === 0) return res.status(404).json({ error: 'not_found' });
  res.json({ trade: r.rows[0] });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`API Core listening on ${PORT}`));
