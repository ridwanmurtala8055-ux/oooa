import { query } from './db';

// Risk enforcement utilities
export async function checkMinTrade(amountUsd: number) {
  if (Number(amountUsd) < 10) {
    throw new Error('min_trade_amount_10');
  }
}

export async function checkPositionCap(userId: string, maxOpen = 3) {
  const r = await query('SELECT count(*) FROM sol_positions WHERE user_id=$1 AND status=$2', [userId, 'open']);
  const count = parseInt(r.rows[0].count, 10);
  if (count >= maxOpen) throw new Error('position_cap_exceeded');
}

export async function checkDailyDrawdown(userId: string, capUsd = 500) {
  // Sum negative pnl for closed positions today
  const r = await query("SELECT COALESCE(SUM(CASE WHEN pnl_usd < 0 THEN pnl_usd ELSE 0 END),0) as loss FROM sol_positions WHERE user_id=$1 AND closed_at >= date_trunc('day', now())", [userId]);
  const loss = Math.abs(Number(r.rows[0].loss || 0));
  if (loss >= capUsd) throw new Error('daily_drawdown_exceeded');
}

export async function enforceAll(userId: string, amountUsd: number) {
  await checkMinTrade(amountUsd);
  // enforce profit-buffer aware trading capital and exposure cap
  const fin = await getTradingCapital(userId);
  const exposureCap = 0.7; // default: allow using up to 70% of trading capital
  const allowedAmount = Number(fin.tradingCapital || 0) * exposureCap;
  if (Number(amountUsd) > allowedAmount) throw new Error('exposure_cap_exceeded');
  await checkPositionCap(userId);
  await checkDailyDrawdown(userId);
}

export async function computeEquity(userId: string) {
  // Real equity should include wallet balances and market prices. We approximate:
  // realized pnl + open positions value (entry_price * qty)
  const closed = await query('SELECT COALESCE(SUM(COALESCE(pnl_usd,0)),0) as realized FROM sol_positions WHERE user_id=$1 AND status=$2', [userId, 'closed']);
  const realized = Number(closed.rows[0].realized || 0);
  const open = await query('SELECT COALESCE(SUM(COALESCE(entry_price*qty,0)),0) as openvalue FROM sol_positions WHERE user_id=$1 AND status=$2', [userId, 'open']);
  const openval = Number(open.rows[0].openvalue || 0);
  return realized + openval;
}

export async function getTradingCapital(userId: string) {
  const fin = await query('SELECT trading_capital, reserve_buffer, profit_buffer_enabled FROM user_financials WHERE user_id=$1', [userId]);
  if (fin.rowCount === 0) {
    // default: compute equity and reserve 0
    const equity = await computeEquity(userId);
    return { equity, tradingCapital: equity, reserve: 0, profitBufferEnabled: false };
  }
  const row = fin.rows[0];
  const equity = await computeEquity(userId);
  const reserve = Number(row.reserve_buffer || 0);
  const trading = row.profit_buffer_enabled ? Math.max(0, equity - reserve) : equity;
  return { equity, tradingCapital: trading, reserve, profitBufferEnabled: !!row.profit_buffer_enabled };
}
