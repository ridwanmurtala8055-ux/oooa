import { query, writeAudit } from '@coinhunter/shared';
import { v4 as uuidv4 } from 'uuid';

// Feature 2 state machine for meme candidates
// States: new -> probing -> main_buy -> monitor -> exit -> complete | failed

async function ensureProbeBuy(candidate: any) {
  // check if a probe buy exists
  const probes = await query("SELECT * FROM sol_trades WHERE meta->>'candidate_id' = $1 AND meta->>'probe' = 'true' AND side='buy' ORDER BY created_at DESC LIMIT 1", [candidate.id]);
  if (probes.rowCount === 0) {
    const probeTradeId = uuidv4();
    await query('INSERT INTO sol_trades(id,user_id,wallet_id,mint,side,amount_in_usd,status,meta,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())', [
      probeTradeId, null, null, candidate.mint, 'buy', 10, 'queued', JSON.stringify({ probe: true, candidate_id: candidate.id })
    ]);
    await writeAudit(null, 'meme.probe_buy.created', { candidate: candidate.id, probeTradeId });
  }
}

async function ensureProbeSell(candidate: any) {
  // only create probe sell if a probe buy succeeded
  const probeBuy = await query("SELECT * FROM sol_trades WHERE meta->>'candidate_id' = $1 AND meta->>'probe' = 'true' AND side='buy' ORDER BY created_at DESC LIMIT 1", [candidate.id]);
  if (probeBuy.rowCount === 0) return;
  const pb = probeBuy.rows[0];
  if (pb.status !== 'done') return;
  // check if probe sell exists
  const probeSell = await query("SELECT * FROM sol_trades WHERE meta->>'candidate_id' = $1 AND meta->>'probe_sell' = 'true' ORDER BY created_at DESC LIMIT 1", [candidate.id]);
  if (probeSell.rowCount === 0) {
    const sellId = uuidv4();
    await query('INSERT INTO sol_trades(id,user_id,wallet_id,mint,side,amount_in_usd,status,meta,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())', [
      sellId, null, null, candidate.mint, 'sell', 10, 'queued', JSON.stringify({ probe_sell: true, candidate_id: candidate.id })
    ]);
    await writeAudit(null, 'meme.probe_sell.created', { candidate: candidate.id, sellId });
  }
}

async function ensureMainBuy(candidate: any) {
  // create a main buy if not present
  const main = await query("SELECT * FROM sol_trades WHERE meta->>'candidate_id' = $1 AND meta->>'meme_main' = 'true' ORDER BY created_at DESC LIMIT 1", [candidate.id]);
  if (main.rowCount === 0) {
    const mainId = uuidv4();
    await query('INSERT INTO sol_trades(id,user_id,wallet_id,mint,side,amount_in_usd,status,meta,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())', [
      mainId, null, null, candidate.mint, 'buy', 100, 'queued', JSON.stringify({ meme_main: true, candidate_id: candidate.id })
    ]);
    await writeAudit(null, 'meme.main_buy.created', { candidate: candidate.id, mainId });
  }
}

async function checkMonitorAndExit(candidate: any) {
  // find open positions for this mint
  const posRes = await query('SELECT * FROM sol_positions WHERE mint=$1 AND status=$2 LIMIT 1', [candidate.mint, 'open']);
  if (posRes.rowCount === 0) return;
  const pos = posRes.rows[0];
  // Simple monitor: exit when random profit > 10 USD or TTL > 30 minutes
  const pnl = Number(pos.pnl_usd || 0);
  const openedAt = new Date(pos.opened_at || new Date());
  const ageMin = (Date.now() - openedAt.getTime()) / 60000;
  if (pnl >= 10 || ageMin > 30) {
    // create sell to close
    const sellId = uuidv4();
    await query('INSERT INTO sol_trades(id,user_id,wallet_id,mint,side,amount_in_usd,status,position_id,meta,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())', [
      sellId, pos.user_id, pos.wallet_id, pos.mint, 'sell', Number(pos.entry_price || 0) * Number(pos.qty || 1), 'queued', pos.id, JSON.stringify({ exit_of: pos.id })
    ]);
    await writeAudit(null, 'meme.exit.created', { candidate: candidate.id, sellId, posId: pos.id });
  }
}

export async function processAllCandidates() {
  const res = await query("SELECT * FROM meme_candidates WHERE status IN ('new','probing','main_buy','monitor') ORDER BY detected_at ASC LIMIT 10");
  for (const c of res.rows) {
    try {
      if (c.status === 'new') {
        // move to probing and create probe buy
        await query('UPDATE meme_candidates SET status=$1 WHERE id=$2', ['probing', c.id]);
        await writeAudit(null, 'meme.candidate.probing', { id: c.id });
        await ensureProbeBuy(c);
      } else if (c.status === 'probing') {
        await ensureProbeSell(c);
        // if probe sell succeeded -> main_buy
        const probeSell = await query("SELECT * FROM sol_trades WHERE meta->>'candidate_id' = $1 AND meta->>'probe_sell' = 'true' ORDER BY created_at DESC LIMIT 1", [c.id]);
        if (probeSell.rowCount && probeSell.rows[0].status === 'done') {
          await query('UPDATE meme_candidates SET status=$1 WHERE id=$2', ['main_buy', c.id]);
          await writeAudit(null, 'meme.candidate.to_main', { id: c.id });
        }
        // if probe sell failed -> failed
        if (probeSell.rowCount && probeSell.rows[0].status === 'failed') {
          await query('UPDATE meme_candidates SET status=$1 WHERE id=$2', ['failed', c.id]);
          await writeAudit(null, 'meme.candidate.failed', { id: c.id });
        }
      } else if (c.status === 'main_buy') {
        await ensureMainBuy(c);
        // after scheduling main buy, move to monitor
        await query('UPDATE meme_candidates SET status=$1 WHERE id=$2', ['monitor', c.id]);
      } else if (c.status === 'monitor') {
        await checkMonitorAndExit(c);
        // if no open positions and main trades done -> complete
        const openPos = await query('SELECT 1 FROM sol_positions WHERE mint=$1 AND status=$2 LIMIT 1', [c.mint, 'open']);
        if (openPos.rowCount === 0) {
          const mains = await query("SELECT * FROM sol_trades WHERE meta->>'candidate_id' = $1 AND meta->>'meme_main' = 'true'", [c.id]);
          if (mains.rowCount > 0) {
            await query('UPDATE meme_candidates SET status=$1 WHERE id=$2', ['complete', c.id]);
            await writeAudit(null, 'meme.candidate.complete', { id: c.id });
          }
        }
      }
    } catch (e) {
      await writeAudit(null, 'meme.engine.error', { id: c.id, error: String(e) });
    }
  }
}
