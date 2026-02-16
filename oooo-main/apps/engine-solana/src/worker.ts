import { query, writeAudit } from '@coinhunter/shared';
import { getJupiterQuote, buildAndSendSwap } from '@coinhunter/shared/src/solana';
import { v4 as uuidv4 } from 'uuid';
import { processMemeCandidates } from './meme_worker';
import { processAllCandidates } from './meme_engine';

const IS_DEVNET = String(process.env.SOLANA_CLUSTER || '').toLowerCase() === 'devnet';

function parseMeta(raw: any) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}

function quoteAmountOutFromJupiter(quote: any, fallback: number) {
  try {
    const route = Array.isArray(quote?.data) ? quote.data[0] : null;
    const outRaw = route?.outAmount || route?.out_amount || route?.amountOut || null;
    if (!outRaw) return fallback;
    return Number(outRaw);
  } catch {
    return fallback;
  }
}

async function upsertPositionOnBuy(row: any, amountOut: number) {
  const qty = amountOut;
  const entryPrice = qty > 0 ? Number(row.amount_in_usd || 0) / qty : 0;
  const existing = await query('SELECT * FROM sol_positions WHERE user_id=$1 AND wallet_id=$2 AND mint=$3 AND status=$4 ORDER BY opened_at DESC LIMIT 1', [
    row.user_id,
    row.wallet_id,
    row.mint,
    'open'
  ]);
  if (existing.rowCount > 0) {
    const pos = existing.rows[0];
    const prevQty = Number(pos.qty || 0);
    const nextQty = Number((prevQty + qty).toFixed(9));
    const nextEntry = nextQty > 0
      ? Number((((Number(pos.entry_price || 0) * prevQty) + Number(row.amount_in_usd || 0)) / nextQty).toFixed(9))
      : 0;
    await query('UPDATE sol_positions SET qty=$1, entry_price=$2 WHERE id=$3', [nextQty, nextEntry, pos.id]);
    return;
  }

  await query('INSERT INTO sol_positions(id, user_id, wallet_id, mint, qty, entry_price, status, opened_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())', [
    uuidv4(), row.user_id, row.wallet_id, row.mint, qty, entryPrice, 'open'
  ]);
}

async function applySellToPosition(row: any) {
  const meta = parseMeta(row.meta);
  const pct = meta.percent ? Number(meta.percent) : null;
  if (!pct) return;

  const loadByPositionId = async () => {
    if (!row.position_id) return null;
    const pres = await query('SELECT * FROM sol_positions WHERE id=$1 FOR UPDATE', [row.position_id]);
    return pres.rowCount ? pres.rows[0] : null;
  };

  const loadFallback = async () => {
    const pres = await query('SELECT * FROM sol_positions WHERE user_id=$1 AND mint=$2 AND status=$3 LIMIT 1', [row.user_id, row.mint, 'open']);
    return pres.rowCount ? pres.rows[0] : null;
  };

  const pos = (await loadByPositionId()) || (await loadFallback());
  if (!pos) return;

  const prevQty = Number(pos.qty || 0);
  const soldQty = Number((prevQty * (pct / 100)).toFixed(9));
  const remainQty = Number((prevQty - soldQty).toFixed(9));
  const entryPrice = Number(pos.entry_price || 0);
  const costBasis = soldQty * entryPrice;
  const realizedUsd = Number(row.amount_out ?? row.amount_in_usd || 0);
  const realizedPnl = Number((realizedUsd - costBasis).toFixed(9));

  if (remainQty <= 0.000000001 || pct === 100) {
    await query('UPDATE sol_positions SET qty=$1, status=$2, closed_at=now(), pnl_usd=COALESCE(pnl_usd,0)+$3 WHERE id=$4', [0, 'closed', realizedPnl, pos.id]);
  } else {
    await query('UPDATE sol_positions SET qty=$1, pnl_usd=COALESCE(pnl_usd,0)+$2 WHERE id=$3', [remainQty, realizedPnl, pos.id]);
  }
}

// Simple polling worker that processes pending sol_trades
async function processPending() {
  const res = await query('SELECT * FROM sol_trades WHERE status IN ($1,$2) ORDER BY created_at ASC LIMIT 10', ['pending', 'queued']);
  for (const row of res.rows) {
    const tradeId = row.id;
    try {
      const kr = await query('SELECT kill_switch FROM user_risk_states WHERE user_id=$1', [row.user_id]);
      if (kr.rowCount && kr.rows[0].kill_switch) {
        await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['failed', tradeId]);
        await writeAudit(row.user_id, 'engine.solana.blocked.kill_switch', { tradeId });
        continue;
      }

      await writeAudit(row.user_id, 'engine.solana.process.start', { tradeId });
      await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['executing', tradeId]);

      if (process.env.USE_JUPITER !== 'true') {
        await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['failed', tradeId]);
        await writeAudit(row.user_id, 'engine.solana.process.failed', { tradeId, reason: 'jupiter_disabled' });
        continue;
      }
      if (IS_DEVNET) {
        await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['failed', tradeId]);
        await writeAudit(row.user_id, 'engine.solana.process.failed', { tradeId, reason: 'devnet_execution_disabled_for_real_swaps' });
        continue;
      }
      if (!row.wallet_id) {
        await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['failed', tradeId]);
        await writeAudit(row.user_id, 'engine.solana.process.failed', { tradeId, reason: 'wallet_id_missing' });
        continue;
      }

      const tradeMeta = parseMeta(row.meta);
      const slippageBps = Number(tradeMeta?.slippage_bps || tradeMeta?.slippageBps || 100);
      const quote = await getJupiterQuote('SOL', row.mint, Math.round(Number(row.amount_in_usd || 0) * 1_000_000_000), slippageBps);
      if (!quote) {
        await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['failed', tradeId]);
        await writeAudit(row.user_id, 'engine.solana.process.failed', { tradeId, reason: 'quote_unavailable' });
        continue;
      }

      const execution = await buildAndSendSwap({ walletId: row.wallet_id, userId: row.user_id, quote, useJito: process.env.SHIELD_MODE === 'true' });
      if (!execution?.signature) {
        await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['failed', tradeId]);
        await writeAudit(row.user_id, 'engine.solana.process.failed', { tradeId, reason: 'no_execution_path' });
        continue;
      }

      const txid = execution.signature;
      const amountOut = quoteAmountOutFromJupiter(quote, Number(row.amount_in_usd || 0));
      await query('UPDATE sol_trades SET status=$1, txid=$2, amount_out=$3, updated_at=now() WHERE id=$4', ['done', txid, amountOut, tradeId]);

      if (row.side === 'buy') await upsertPositionOnBuy(row, amountOut);
      if (row.side === 'sell') await applySellToPosition(row);

      await writeAudit(row.user_id, 'engine.solana.process.success', { tradeId, txid, method: execution.method || 'live', side: row.side, amount_in_usd: Number(row.amount_in_usd || 0), amount_out: amountOut });
    } catch (err) {
      await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['failed', tradeId]);
      await writeAudit(row.user_id, 'engine.solana.process.error', { tradeId, error: String(err) });
    }
  }
}

// Process limit and DCA orders: deterministic trigger rules
async function processOrders() {
  const res = await query("SELECT * FROM orders WHERE status='open' ORDER BY created_at ASC LIMIT 25");
  for (const order of res.rows) {
    try {
      const params = order.params || {};
      let shouldFill = false;
      let idempotencyKey = `order:${order.id}`;

      if (order.type === 'limit') {
        const target = params.target_price ?? null;
        const market = params.current_price ?? null;
        if (target !== null && market !== null && Number(market) <= Number(target)) shouldFill = true;
      } else if (order.type === 'dca') {
        const intervalMin = Number(params.interval_minutes || 60);
        const basis = params.last_filled_at ? new Date(params.last_filled_at) : new Date(order.created_at);
        const elapsedMin = (Date.now() - basis.getTime()) / 60000;
        if (elapsedMin >= intervalMin) {
          shouldFill = true;
          idempotencyKey = `order:${order.id}:dca:${Math.floor(Date.now() / (intervalMin * 60 * 1000))}`;
        }
      }

      if (!shouldFill) continue;

      const openCountRes = await query('SELECT count(*) FROM sol_positions WHERE user_id=$1 AND status=$2', [order.user_id, 'open']);
      const openCount = parseInt(openCountRes.rows[0].count, 10);
      const MAX_POS = 3;
      if (openCount >= MAX_POS) {
        await writeAudit(order.user_id, 'orders.fill.blocked', { orderId: order.id, reason: 'position_cap' });
        continue;
      }

      const existed = await query('SELECT 1 FROM idempotency_keys WHERE key_value=$1', [idempotencyKey]);
      if (existed.rowCount > 0) continue;
      await query('INSERT INTO idempotency_keys(id, key_value, created_at) VALUES($1,$2,now())', [uuidv4(), idempotencyKey]);

      const tradeId = uuidv4();
      const amountUsd = Number(params.amount_usd || 0);
      await query('INSERT INTO sol_trades(id, user_id, wallet_id, mint, side, amount_in_usd, status, created_at, updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now(),now())', [
        tradeId, order.user_id, order.wallet_id, order.mint, 'buy', amountUsd, 'queued'
      ]);

      if (order.type === 'limit') {
        await query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', ['filled', order.id]);
      } else {
        const updatedParams = { ...params, last_filled_at: new Date().toISOString() };
        await query('UPDATE orders SET params=$1, updated_at=now() WHERE id=$2', [JSON.stringify(updatedParams), order.id]);
      }

      await writeAudit(order.user_id, 'orders.filled', { orderId: order.id, tradeId, type: order.type });
    } catch (err) {
      await writeAudit(order.user_id, 'orders.process.error', { orderId: order.id, error: String(err) });
    }
  }
}

async function loop() {
  while (true) {
    try {
      await processPending();
      await processOrders();
      await processMemeCandidates();
      await processAllCandidates();
    } catch (e) {
      console.error('worker error', e);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

loop();
