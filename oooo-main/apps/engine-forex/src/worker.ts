import { query, writeAudit } from '@coinhunter/shared';

// Forex engine placeholder: enforces risk caps periodically
async function enforceRisk() {
  const users = await query('SELECT id FROM users');
  for (const u of users.rows) {
    const open = await query('SELECT count(*) FROM forex_positions WHERE user_id=$1 AND status=$2', [u.id, 'open']);
    const count = parseInt(open.rows[0].count, 10);
    if (count > 3) {
      await writeAudit(u.id, 'forex.risk.violation', { open: count });
      // In production: send alerts/close positions
    }
  }
}

async function loop() {
  while (true) {
    try {
      await enforceRisk();
    } catch (e) {
      console.error('forex worker error', e);
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
}

loop();
