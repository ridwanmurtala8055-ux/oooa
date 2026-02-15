import { query, writeAudit } from '@coinhunter/shared';
import { v4 as uuidv4 } from 'uuid';
import { sendSolTransfer } from '@coinhunter/shared/src/solana';

async function processPending() {
  const res = await query("SELECT * FROM withdrawals WHERE status = $1 LIMIT 5", ['requested']);
  for (const row of res.rows) {
    const id = row.id;
    try {
      await query('UPDATE withdrawals SET status=$1, processed_at=now() WHERE id=$2', ['processing', id]);
      await writeAudit(row.user_id, 'engine.withdraw.processing', { id });
      // Perform real transfer on Solana (devnet expected) with retries and backoff
      if (!row.wallet_id) throw new Error('no_wallet_specified');
      const maxRetries = Number(process.env.WITHDRAW_MAX_RETRIES || 5);
      let attempt = 0;
      let done = false;
      let lastErr: any = null;
      while (attempt <= maxRetries && !done) {
        try {
          attempt++;
          const result = await sendSolTransfer({ walletId: row.wallet_id, userId: row.user_id, destination: row.destination, amountUsd: Number(row.amount_usd) });
          const sig = result.signature;
          await query('UPDATE withdrawals SET status=$1, txid=$2, processed_at=now() WHERE id=$3', ['processed', sig, id]);
          await writeAudit(row.user_id, 'engine.withdraw.success', { id, txid: sig, lamports: result.lamports, sol: result.solAmount });
          done = true;
        } catch (e: any) {
          lastErr = e;
          const msg = String(e || 'error');
          // classify permanent errors
          const permanent = /no_wallet|invalid|insufficient|invalid_pubkey|wallet_not_found|price_unavailable|insufficient_wallet_balance_for_fee/.test(msg.toLowerCase());
          // log engine event
          await query('INSERT INTO engine_events(id, user_id, engine, level, message, payload_json, created_at) VALUES($1,$2,$3,$4,$5,$6,now())', [uuidv4(), row.user_id, 'withdraw_worker', permanent ? 'error' : 'warn', 'withdraw_attempt_failed', JSON.stringify({ attempt, error: msg })]);
          if (permanent) {
            await query('UPDATE withdrawals SET status=$1, error=$2, processed_at=now() WHERE id=$3', ['failed', msg, id]);
            await writeAudit(row.user_id, 'engine.withdraw.failed', { id, error: msg });
            break;
          }
          // transient: sleep with exponential backoff
          const backoffMs = Math.min(30000, 500 * Math.pow(2, attempt));
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
      if (!done && lastErr) {
        await query('UPDATE withdrawals SET status=$1, error=$2, processed_at=now() WHERE id=$3', ['failed', String(lastErr), id]);
        await writeAudit(row.user_id, 'engine.withdraw.failed', { id, error: String(lastErr) });
      }
    } catch (e: any) {
      await query('UPDATE withdrawals SET status=$1, error=$2, processed_at=now() WHERE id=$3', ['failed', String(e || 'error'), id]);
      await writeAudit(row.user_id, 'engine.withdraw.error', { id, error: String(e) });
    }
  }
}

async function loop() {
  while (true) {
    try {
      await processPending();
    } catch (e) {
      console.error('withdraw worker error', e);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

loop();
