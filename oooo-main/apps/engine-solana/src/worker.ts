import { query, writeAudit } from '@coinhunter/shared';
import { getJupiterQuote, buildAndSendSwap } from '@coinhunter/shared/src/solana';
import { v4 as uuidv4 } from 'uuid';
import { processMemeCandidates } from './meme_worker';
import { processAllCandidates } from './meme_engine';

// Simple polling worker that processes pending sol_trades
async function processPending() {
  const res = await query('SELECT * FROM sol_trades WHERE status IN ($1,$2) LIMIT 5', ['pending','queued']);
  for (const row of res.rows) {
    const tradeId = row.id;
    try {
      // risk: check kill switch
      const kr = await query('SELECT kill_switch, daily_loss_usd FROM user_risk_states WHERE user_id=$1', [row.user_id]);
      if (kr.rowCount && kr.rows[0].kill_switch) {
        await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['failed', tradeId]);
        await writeAudit(row.user_id, 'engine.solana.blocked.kill_switch', { tradeId });
        continue;
      }
      await writeAudit(row.user_id, 'engine.solana.process.start', { tradeId });
      // Mark executing
      await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['executing', tradeId]);

      // Attempt Jupiter path if enabled
      let jupiterResult: any = null;
      if (process.env.USE_JUPITER === 'true' && row.wallet_id) {
        try {
          // request a quote and attempt to build/send swap
          const quote = await getJupiterQuote('SOL', row.mint, Math.round(Number(row.amount_in_usd) * 1000000));
          if (quote) {
            // build and send (this will decrypt wallet and attempt send) - in dev this may fail
            try {
              const sent = await buildAndSendSwap({ walletId: row.wallet_id, userId: row.user_id, quote, useJito: process.env.SHIELD_MODE === 'true' });
              if (sent && sent.signature) jupiterResult = sent;
            } catch (e) {
              // fallback to simulated path
              jupiterResult = null;
            }
          }
        } catch (e) {
          jupiterResult = null;
        }
      } else {
        // fallback to simulation when Jupiter disabled
        await new Promise((r) => setTimeout(r, 1000));
        if (Math.random() > 0.2) jupiterResult = { signature: 'SIM_' + uuidv4(), method: 'sim' };
      }
      if (jupiterResult) {
        // jupiter path returned success; use returned signature
        const txid = (jupiterResult.signature) ? jupiterResult.signature : 'JUPITER_TX_' + uuidv4();
        // try to use amount_out from row.quote if present
        const amountOut = (row.quote && row.quote.expectedAmount) ? row.quote.expectedAmount : Math.random() * 100;
        await query('UPDATE sol_trades SET status=$1, txid=$2, amount_out=$3, updated_at=now() WHERE id=$4', ['done', txid, amountOut, tradeId]);
        // if buy: create position; if sell: close or reduce existing position
        if (row.side === 'buy') {
            await query('INSERT INTO sol_positions(id, user_id, wallet_id, mint, qty, entry_price, status, opened_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())', [
              uuidv4(), row.user_id, row.wallet_id, row.mint, Math.random() * 10, Math.random() * 5, 'open'
            ]);
        } else if (row.side === 'sell') {
          // use meta.percent and position_id to update position
          try {
            const meta = row.meta || {};
            const pct = meta.percent ? Number(meta.percent) : null;
            if (row.position_id) {
              const pres = await query('SELECT * FROM sol_positions WHERE id=$1 FOR UPDATE', [row.position_id]);
              if (pres.rowCount) {
                const pos = pres.rows[0];
                if (pct === 100) {
                  await query('UPDATE sol_positions SET status=$1, closed_at=now(), pnl_usd=$2 WHERE id=$3', ['closed', Math.random() * 50, pos.id]);
                } else if (pct) {
                  const remainQty = Number(pos.qty) * (1 - pct / 100);
                  await query('UPDATE sol_positions SET qty=$1, updated_at=now() WHERE id=$2', [remainQty, pos.id]);
                }
              }
            } else {
              // fallback: find open position by user + mint
              const pres2 = await query('SELECT * FROM sol_positions WHERE user_id=$1 AND mint=$2 AND status=$3 LIMIT 1', [row.user_id, row.mint, 'open']);
              if (pres2.rowCount) {
                const pos = pres2.rows[0];
                if (pct === 100) {
                  await query('UPDATE sol_positions SET status=$1, closed_at=now(), pnl_usd=$2 WHERE id=$3', ['closed', Math.random() * 50, pos.id]);
                } else if (pct) {
                  const remainQty = Number(pos.qty) * (1 - pct / 100);
                  await query('UPDATE sol_positions SET qty=$1, updated_at=now() WHERE id=$2', [remainQty, pos.id]);
                }
              }
            }
          } catch (e) {
            await writeAudit(row.user_id, 'engine.solana.sell.position_update_error', { tradeId, error: String(e) });
          }
        }
        await writeAudit(row.user_id, 'engine.solana.process.success', { tradeId, txid });
      } else {
        // Raydium fallback
        const fallbackOk = Math.random() > 0.5;
          if (fallbackOk) {
            const txid = 'RAYDIUM_TX_' + uuidv4();
            await query('UPDATE sol_trades SET status=$1, txid=$2, amount_out=$3, updated_at=now() WHERE id=$4', ['done', txid, Math.random() * 100, tradeId]);
          if (row.side === 'buy') {
            await query('INSERT INTO sol_positions(id, user_id, wallet_id, mint, qty, entry_price, status, opened_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())', [
              uuidv4(), row.user_id, row.wallet_id, row.mint, Math.random() * 10, Math.random() * 5, 'open'
            ]);
          } else if (row.side === 'sell') {
            // handle sell close similarly to Jupiter path
            try {
              const meta = row.meta || {};
              const pct = meta.percent ? Number(meta.percent) : null;
              if (row.position_id) {
                const pres = await query('SELECT * FROM sol_positions WHERE id=$1 FOR UPDATE', [row.position_id]);
                if (pres.rowCount) {
                  const pos = pres.rows[0];
                  if (pct === 100) {
                    await query('UPDATE sol_positions SET status=$1, closed_at=now(), pnl_usd=$2 WHERE id=$3', ['closed', Math.random() * 50, pos.id]);
                  } else if (pct) {
                    const remainQty = Number(pos.qty) * (1 - pct / 100);
                    await query('UPDATE sol_positions SET qty=$1, updated_at=now() WHERE id=$2', [remainQty, pos.id]);
                  }
                }
              }
            } catch (e) {
              await writeAudit(row.user_id, 'engine.solana.sell.position_update_error', { tradeId, error: String(e) });
            }
          }
          await writeAudit(row.user_id, 'engine.solana.process.fallback', { tradeId });
        } else {
          await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['failed', tradeId]);
          await writeAudit(row.user_id, 'engine.solana.process.failed', { tradeId });
        }
      }
    } catch (err) {
      await query('UPDATE sol_trades SET status=$1, updated_at=now() WHERE id=$2', ['failed', tradeId]);
      await writeAudit(row.user_id, 'engine.solana.process.error', { tradeId, error: String(err) });
    }
  }
}

// Process limit and DCA orders: simulate price and convert to trades when conditions met
async function processOrders() {
  const res = await query("SELECT * FROM orders WHERE status='open' LIMIT 10");
  for (const order of res.rows) {
    try {
      const params = order.params || {};
      // Simulate market price
      const marketPrice = Math.random() * 100; // placeholder
      let shouldFill = false;
      if (order.type === 'limit') {
        const target = params.target_price || null;
        if (target !== null && marketPrice <= Number(target)) shouldFill = true;
      } else if (order.type === 'dca') {
        // simple DCA: fill when marketPrice <= target_price
        const target = params.target_price || null;
        if (target !== null && marketPrice <= Number(target)) shouldFill = true;
      }

      if (!shouldFill) continue;

      // Position cap enforcement
      const openCountRes = await query('SELECT count(*) FROM sol_positions WHERE user_id=$1 AND status=$2', [order.user_id, 'open']);
      const openCount = parseInt(openCountRes.rows[0].count, 10);
      const MAX_POS = 3;
      if (openCount >= MAX_POS) {
        await writeAudit(order.user_id, 'orders.fill.blocked', { orderId: order.id, reason: 'position_cap' });
        continue;
      }

      // Idempotency per order
      const idempotencyKey = `order:${order.id}`;
      const existed = await query('SELECT 1 FROM idempotency_keys WHERE key_value=$1', [idempotencyKey]);
      if (existed.rowCount > 0) continue;
      await query('INSERT INTO idempotency_keys(id, key_value, created_at) VALUES($1,$2,now())', [uuidv4(), idempotencyKey]);

      // Create a sol_trade for this order
      const tradeId = uuidv4();
      const amountUsd = params.amount_usd || 0;
      await query('INSERT INTO sol_trades(id, user_id, wallet_id, mint, side, amount_in_usd, status, created_at, updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,now(),now())', [
        tradeId, order.user_id, order.wallet_id, order.mint, 'buy', amountUsd, 'queued'
      ]);
      await query('UPDATE orders SET status=$1, updated_at=now() WHERE id=$2', ['filled', order.id]);
      await writeAudit(order.user_id, 'orders.filled', { orderId: order.id, tradeId });
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
