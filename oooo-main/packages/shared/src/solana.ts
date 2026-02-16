import fetch from 'node-fetch';
import { Connection, Keypair, Transaction, sendAndConfirmTransaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { decryptPrivateKey } from './crypto';
import { query } from './db';

const JUPITER_API = process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6';
const DEFAULT_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const DEFAULT_DEVNET_RPC = 'https://api.devnet.solana.com';
const JITO_RELAY = process.env.JITO_RELAY_URL || null;

function getCluster() {
  return String(process.env.SOLANA_CLUSTER || 'mainnet').toLowerCase();
}

function getSolanaRpcUrl() {
  if (process.env.SOLANA_RPC_URL && String(process.env.SOLANA_RPC_URL).trim()) return String(process.env.SOLANA_RPC_URL).trim();
  return getCluster() === 'devnet' ? DEFAULT_DEVNET_RPC : DEFAULT_MAINNET_RPC;
}
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

function normalizeMint(mint: string) {
  const v = String(mint || '').trim();
  if (!v) return v;
  if (v.toUpperCase() === 'SOL') return WSOL_MINT;
  return v;
}

export async function getJupiterQuote(inputMint: string, outputMint: string, amount: number, slippageBps = 100) {
  try {
    const inMint = normalizeMint(inputMint);
    const outMint = normalizeMint(outputMint);
    const safeAmount = Math.max(1, Math.floor(Number(amount || 0)));
    const safeSlippage = Math.max(1, Math.floor(Number(slippageBps || 100)));
    const url = `${JUPITER_API}/quote?inputMint=${encodeURIComponent(inMint)}&outputMint=${encodeURIComponent(outMint)}&amount=${safeAmount}&slippageBps=${safeSlippage}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error('jupiter_quote_failed');
    const j: any = await r.json();
    return j;
  } catch (e) {
    return null;
  }
}

export async function getJupiterSwapTransactionFromQuote(quote: any) {
  try {
    // Jupiter v6 may include a swap transaction directly on the route or provide a swap endpoint
    if (!quote) return null;
    // common shapes: { data: [...routes] } or { routes: [...] } or quote.routes
    const routes = quote.data || quote.routes || quote.routesToShow || quote;
    const first = Array.isArray(routes) ? routes[0] : null;
    if (!first) return null;
    // some responses include `swapTransaction` or `swapTransactionB64` on the route
    const candidate = first.swapTransaction || first.swapTransactionB64 || first.swap_transaction || first.swapTransactionBase64;
    if (candidate && typeof candidate === 'string') return candidate;

    // fallback: attempt to call Jupiter swap endpoint to build transaction
    try {
      const body = { route: first };
      const r = await fetch(`${JUPITER_API}/swap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) return null;
      const j: any = await r.json();
      // Jupiter swap response may contain `swapTransaction` or `swapTx`
      const txB64 = j.swapTransaction || j.swap_tx || j.swapTransactionB64 || j.swapTx || j.swapTransaction;
      return typeof txB64 === 'string' ? txB64 : null;
    } catch (e) {
      return null;
    }
  } catch (e) {
    return null;
  }
}

export async function getRaydiumSwapTransactionFromQuote(quote: any) {
  try {
    if (!quote) return null;
    // Allow env override for Raydium helper endpoint
    const RAYDIUM_API = process.env.RAYDIUM_API_URL || null;
    // If a Raydium API URL is configured, attempt to fetch a built swap transaction
    if (RAYDIUM_API && quote && quote.route) {
      try {
        const r = await fetch(`${RAYDIUM_API}/swap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ route: quote.route }) });
        if (!r.ok) return null;
        const j: any = await r.json();
        const txB64 = j.swapTransaction || j.swap_tx || j.swapTransactionB64 || j.swapTx;
        return typeof txB64 === 'string' ? txB64 : null;
      } catch (e) {
        return null;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

export async function getSolPriceUsd() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    if (!r.ok) throw new Error('price_fetch_failed');
    const j: any = await r.json();
    const price = j?.solana?.usd;
    if (!price) throw new Error('price_missing');
    return Number(price);
  } catch (e) {
    return null;
  }
}

export async function getBalancePublicKey(pubkey: string, connection?: Connection) {
  try {
    const conn = connection || new Connection(getSolanaRpcUrl());
    const pk = new PublicKey(pubkey);
    const lamports = await conn.getBalance(pk);
    return lamports / LAMPORTS_PER_SOL;
  } catch (e) {
    return null;
  }
}

export async function estimateTransferFee(opts: { fromPubkey: string; toPubkey: string; connection?: Connection; lamports?: number }) {
  try {
    const conn = opts.connection || new Connection(getSolanaRpcUrl());
    const from = new PublicKey(opts.fromPubkey);
    const to = new PublicKey(opts.toPubkey);
    const lamports = opts.lamports || 1;
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
    // compile message and request fee for message (may return null)
    //@ts-ignore
    const msg = tx.compileMessage();
    // getFeeForMessage exists in newer web3 versions
    if (typeof (conn as any).getFeeForMessage === 'function') {
      try {
        // @ts-ignore
        const fee = await (conn as any).getFeeForMessage(msg);
        if (fee && typeof fee === 'number') return Math.round(fee);
        if (fee && fee.value && typeof fee.value === 'number') return Math.round(fee.value);
      } catch (e) {
        // ignore and fallback
      }
    }
    // fallback: use a conservative default (5000 lamports)
    return 5000;
  } catch (e) {
    return 5000;
  }
}

// Send a SOL transfer for the given wallet. amountUsd is converted to lamports using price feed.
export async function sendSolTransfer(opts: { walletId: string; userId: string; destination: string; amountUsd: number; connection?: Connection }) {
  const conn = opts.connection || new Connection(getSolanaRpcUrl());
  const r = await query('SELECT enc_privkey, enc_iv, enc_tag FROM wallets WHERE id=$1', [opts.walletId]);
  if (r.rowCount === 0) throw new Error('wallet_not_found');
  const row = r.rows[0];
  const ciphertext = Buffer.from(row.enc_privkey, 'base64');
  const iv = Buffer.from(row.enc_iv, 'base64');
  const tag = Buffer.from(row.enc_tag, 'base64');
  const aad = Buffer.from(`${opts.walletId}:${opts.userId}`);
  const priv = decryptPrivateKey(ciphertext, iv, tag, aad);
  const kp = Keypair.fromSecretKey(priv);

  try {
    // fetch SOL price
    const price = await getSolPriceUsd();
    if (!price) throw new Error('sol_price_unavailable');
    let solAmount = Number(opts.amountUsd) / Number(price);
    if (isNaN(solAmount) || solAmount <= 0) throw new Error('invalid_amount_after_conversion');
    let lamports = Math.round(solAmount * LAMPORTS_PER_SOL);

    // compute fee estimate and buffer, ensure wallet has enough for fee
    const feeEstimate = await estimateTransferFee({ fromPubkey: kp.publicKey.toBase58(), toPubkey: opts.destination, lamports });
    const feeBufferSol = Number(process.env.WITHDRAW_FEE_BUFFER_SOL || '0.001');
    const feeBufferLamports = Math.round(feeBufferSol * LAMPORTS_PER_SOL);

    // check actual from-wallet balance
    const walletBalanceLamports = await conn.getBalance(kp.publicKey);
    const required = lamports + Math.round(feeEstimate || 5000) + feeBufferLamports;
    if (walletBalanceLamports < required) {
      // adjust amount down so that fee + buffer are preserved
      const maxSendable = walletBalanceLamports - Math.round(feeEstimate || 5000) - feeBufferLamports;
      if (maxSendable <= 0) throw new Error('insufficient_wallet_balance_for_fee');
      lamports = Math.max(0, maxSendable);
      solAmount = lamports / LAMPORTS_PER_SOL;
    }

    const to = new PublicKey(opts.destination);
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports }));

    // send & confirm
    const sig = await sendAndConfirmTransaction(conn, tx, [kp]);
    return { signature: sig, lamports, solAmount };
  } finally {
    try { if (priv && typeof priv.fill === 'function') priv.fill(0); } catch (e) {}
  }
}

// Build and send swap using either a prebuilt transaction present in the quote
// or a best-effort public send. Returns { signature, method } on success.
export async function buildAndSendSwap(opts: { walletId: string; userId: string; quote: any; useJito?: boolean; connection?: Connection }) {
  const conn = opts.connection || new Connection(getSolanaRpcUrl());
  const r = await query('SELECT enc_privkey, enc_iv, enc_tag FROM wallets WHERE id=$1', [opts.walletId]);
  if (r.rowCount === 0) throw new Error('wallet_not_found');
  const row = r.rows[0];
  const ciphertext = Buffer.from(row.enc_privkey, 'base64');
  const iv = Buffer.from(row.enc_iv, 'base64');
  const tag = Buffer.from(row.enc_tag, 'base64');
  const aad = Buffer.from(`${opts.walletId}:${opts.userId}`);
  const priv = decryptPrivateKey(ciphertext, iv, tag, aad);
  const kp = Keypair.fromSecretKey(priv);

  try {
    // If the quote already contains or can produce a base64 transaction (Jupiter responses sometimes include this), use it.
    let maybeTxB64 = null;
    try {
      maybeTxB64 = await getJupiterSwapTransactionFromQuote(opts.quote);
    } catch (e) {
      maybeTxB64 = null;
    }
    if (maybeTxB64 && typeof maybeTxB64 === 'string') {
      try {
        const raw = Buffer.from(maybeTxB64, 'base64');
        const tx = Transaction.from(raw);
        // Sign the transaction with the custodial key if necessary
        try {
          tx.partialSign(kp);
        } catch (e) {
          // ignore if the tx is already signed by required keys
        }
        // simulate before sending (deterministic check)
        try {
          const sim = await conn.simulateTransaction(tx);
          if (sim && sim.value && sim.value.err) {
            await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
              require('uuid').v4(), opts.userId, 'solana', 'error', 'simulation_failed', JSON.stringify({ err: sim.value.err })
            ]).catch(() => null);
            throw new Error('simulation_failed:' + JSON.stringify(sim.value.err));
          }
        } catch (simErr) {
          // treat simulation failure as transient for now and log, then attempt fallback
          await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
            require('uuid').v4(), opts.userId, 'solana', 'warn', 'simulation_error', JSON.stringify({ err: String(simErr) })
          ]).catch(() => null);
          throw simErr;
        }

        if (opts.useJito) {
          if (!JITO_RELAY) {
            await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
              require('uuid').v4(), opts.userId, 'solana', 'error', 'jito_requested_without_relay', JSON.stringify({ configured: false })
            ]).catch(() => null);
            throw new Error('jito_relay_not_configured');
          }
          // Strict mode: if Shield/Jito is requested, use relay-only path.
          const signedRaw = tx.serialize({ requireAllSignatures: false });
          const jr = await fetch(JITO_RELAY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx: signedRaw.toString('base64'), user_id: opts.userId, wallet_id: opts.walletId })
          });
          if (!jr.ok) {
            const body = await jr.text().catch(() => '');
            await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
              require('uuid').v4(), opts.userId, 'solana', 'error', 'jito_send_failed', JSON.stringify({ status: jr.status, body })
            ]).catch(() => null);
            throw new Error('jito_send_failed');
          }
          const out: any = await jr.json().catch(() => ({}));
          const relaySig = out?.signature || out?.txid || out?.result || null;
          if (!relaySig || typeof relaySig !== 'string') {
            throw new Error('jito_signature_missing');
          }
          await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
            require('uuid').v4(), opts.userId, 'solana', 'info', 'swap_sent', JSON.stringify({ method: 'jito', sig: relaySig, relay: JITO_RELAY })
          ]).catch(() => null);
          return { signature: relaySig, method: 'jito' };
        }

        const sig = await sendAndConfirmTransaction(conn, tx, [kp]);
        await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
          require('uuid').v4(), opts.userId, 'solana', 'info', 'swap_sent', JSON.stringify({ method: 'jupiter', sig })
        ]).catch(() => null);
        return { signature: sig, method: 'jupiter' };
      } catch (e) {
        // If using provided tx fails, fall through to building a dummy/public tx
        await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
          require('uuid').v4(), opts.userId, 'solana', 'error', 'jupiter_tx_send_failed', JSON.stringify({ error: String(e) })
        ]).catch(() => null);
      }
    }
    // If we reach here, try Raydium fallback (if available)
    try {
      const rayTxB64 = await getRaydiumSwapTransactionFromQuote(opts.quote);
      if (rayTxB64 && typeof rayTxB64 === 'string') {
        try {
          const raw = Buffer.from(rayTxB64, 'base64');
          const tx = Transaction.from(raw);
          try { tx.partialSign(kp); } catch (e) {}
          const sim = await conn.simulateTransaction(tx);
          if (sim && sim.value && sim.value.err) {
            await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
              require('uuid').v4(), opts.userId, 'solana', 'error', 'raydium_simulation_failed', JSON.stringify({ err: sim.value.err })
            ]).catch(() => null);
            throw new Error('raydium_simulation_failed');
          }
          const sig = await sendAndConfirmTransaction(conn, tx, [kp]);
          await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
            require('uuid').v4(), opts.userId, 'solana', 'info', 'raydium_swap_sent', JSON.stringify({ sig })
          ]).catch(() => null);
          return { signature: sig, method: 'raydium' };
        } catch (e) {
          await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
            require('uuid').v4(), opts.userId, 'solana', 'error', 'raydium_send_failed', JSON.stringify({ error: String(e) })
          ]).catch(() => null);
        }
      }

      // No Raydium tx built — emit event and fail
      await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [
        require('uuid').v4(), opts.userId, 'solana', 'error', 'no_swap_built', JSON.stringify({ quote: !!opts.quote })
      ]).catch(() => null);
      throw new Error('no_swap_built');
    } catch (e) {
      throw e;
    }
  } finally {
    // Best effort zeroing of secret key buffer
    try {
      if (priv && typeof priv.fill === 'function') priv.fill(0);
    } catch (e) {
      // ignore
    }
  }
}
