import { query, writeAudit } from '@coinhunter/shared';
import { v4 as uuidv4 } from 'uuid';

// Simple meme candidate processor: probe small buys and optionally schedule main buys.
export async function processMemeCandidates() {
  // pick a candidate in 'new' state
  const r = await query("SELECT * FROM meme_candidates WHERE status IN ('new','probing') LIMIT 5");
  for (const c of r.rows) {
    try {
      if (c.status === 'new') {
        // mark as probing
        await query('UPDATE meme_candidates SET status=$1, meta=jsonb_set(meta, $2, $3::jsonb) WHERE id=$4', ['probing', '{probed}', 'true', c.id]);
        await writeAudit(null, 'meme.candidate.probe_start', { candidate: c.id, mint: c.mint });
        // create a probe trade (very small amount) -> sol_trades with side=buy and meta.probe=true
        const probeTradeId = uuidv4();
        await query('INSERT INTO sol_trades(id, user_id, wallet_id, mint, side, amount_in_usd, status, meta, created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())', [
          probeTradeId, null, null, c.mint, 'buy', 10, 'queued', JSON.stringify({ probe: true, candidate_id: c.id })
        ]);
        await query('INSERT INTO meme_runs(id,candidate_id,phase,payload) VALUES($1,$2,$3,$4)', [uuidv4(), c.id, 'probe_created', JSON.stringify({ probeTradeId })]);
      } else if (c.status === 'probing') {
        // check last probe trades for this candidate and decide to escalate
        const probes = await query("SELECT * FROM sol_trades WHERE meta->>'candidate_id' = $1 ORDER BY created_at DESC LIMIT 10", [c.id]);
        const last = probes.rows[0];
        if (!last) continue;
        // If last probe was a buy and completed, create a probe sell to test liquidity
        if (last.meta && last.meta.probe && last.side === 'buy' && last.status === 'done') {
          // create a small probe sell
          const probeSellId = uuidv4();
          await query('INSERT INTO sol_trades(id, user_id, wallet_id, mint, side, amount_in_usd, status, meta, created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())', [
            probeSellId, null, null, c.mint, 'sell', 10, 'queued', JSON.stringify({ probe: true, probe_sell: true, candidate_id: c.id })
          ]);
          await query('INSERT INTO meme_runs(id,candidate_id,phase,payload) VALUES($1,$2,$3,$4)', [uuidv4(), c.id, 'probe_sell_created', JSON.stringify({ probeSellId })]);
          continue;
        }
        // If a probe sell completed successfully, escalate to main_buy
        const lastSell = probes.find((p: any) => p.meta && p.meta.probe_sell);
        if (lastSell && lastSell.status === 'done') {
          await query('UPDATE meme_candidates SET status=$1 WHERE id=$2', ['main_buy', c.id]);
          await writeAudit(null, 'meme.candidate.escalate', { candidate: c.id });
          const mainTradeId = uuidv4();
          await query('INSERT INTO sol_trades(id, user_id, wallet_id, mint, side, amount_in_usd, status, meta, created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())', [
            mainTradeId, null, null, c.mint, 'buy', 100, 'queued', JSON.stringify({ candidate_id: c.id, meme_main: true })
          ]);
          await query('INSERT INTO meme_runs(id,candidate_id,phase,payload) VALUES($1,$2,$3,$4)', [uuidv4(), c.id, 'main_created', JSON.stringify({ mainTradeId })]);
          continue;
        }
        // If any probe sell failed, mark candidate failed
        const failedSell = probes.find((p: any) => p.meta && p.meta.probe_sell && p.status === 'failed');
        if (failedSell) {
          await query('UPDATE meme_candidates SET status=$1 WHERE id=$2', ['failed', c.id]);
          await writeAudit(null, 'meme.candidate.failed_probe_sell', { candidate: c.id });
          continue;
        }
      }
    } catch (e) {
      await writeAudit(null, 'meme.candidate.error', { id: c.id, error: String(e) });
      await query('UPDATE meme_candidates SET status=$1 WHERE id=$2', ['failed', c.id]);
    }
  }
}
