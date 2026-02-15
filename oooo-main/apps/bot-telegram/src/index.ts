
import { Telegraf, Markup } from 'telegraf';
import { writeAudit } from '@coinhunter/shared';
import fetch from 'node-fetch';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN not set');
}

const API_BASE = process.env.API_BASE || 'http://localhost:8080';

const bot = new Telegraf(token);

type Session = {
  step: string;
  data: any;
};

const sessions = new Map<string, Session>();

bot.start(async (ctx) => {
  const userId = String(ctx.from?.id || 'unknown');
  await writeAudit(userId, 'telegram.start', { username: ctx.from?.username });
  return ctx.reply('Welcome to Coin Hunter (Telegram UI). Use /menu to open the Terminal.');
});

bot.command('menu', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.menu', {});
  // Show inline main menu
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('Buy', 'menu:buy'), Markup.button.callback('Sell', 'menu:sell')],
    [Markup.button.callback('Positions', 'menu:positions'), Markup.button.callback('Limit Orders', 'menu:limit_orders'), Markup.button.callback('DCA Orders', 'menu:dca_orders')],
    [Markup.button.callback('Copy Trade', 'menu:copy'), Markup.button.callback('Sniper', 'menu:sniper'), Markup.button.callback('Trenches', 'menu:trenches')],
    [Markup.button.callback('Rewards', 'menu:rewards'), Markup.button.callback('Watchlist', 'menu:watchlist'), Markup.button.callback('Withdraw', 'menu:withdraw')],
    [Markup.button.callback('Settings', 'menu:settings'), Markup.button.callback('Help', 'menu:help'), Markup.button.callback('Refresh', 'menu:refresh')]
  ]);
  return ctx.reply('Terminal', keyboard);
});

// callback router for inline buttons
bot.on('callback_query', async (ctx) => {
  const cb: any = ctx.callbackQuery;
  const userId = String(cb?.from?.id || null);
  const data: string = cb?.data || '';
  await writeAudit(userId, 'telegram.callback', { data });
  try {
    if (data === 'menu:buy') {
      sessions.set(userId, { step: 'BUY_INPUT', data: {} });
      await ctx.answerCbQuery();
      return ctx.reply('Paste token mint address:');
    }
    // buy preset selected
    if (data.startsWith('buy:preset:')) {
      await ctx.answerCbQuery();
      const parts = data.split(':');
      const amt = Number(parts[2]);
      const s = sessions.get(userId);
      if (!s) return ctx.reply('Session expired. Start /buy again.');
      s.data.amount_usd = amt;
      s.step = 'BUY_CONFIRM';
      sessions.set(userId, s);
      // request quote
      const qres = await fetch(`${API_BASE}/terminal/buy/quote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputMint: 'SOL', outputMint: s.data.mint, amount_usd: amt, slippageBps: 100 })
      });
      const qjson = await qres.json();
      s.data.quote = qjson.quote;
      await writeAudit(userId, 'telegram.buy.quote', { quote: qjson.quote });
      return ctx.reply(`Quote: expectedOut=${qjson.quote.expectedOut}, fees=${qjson.quote.fees}. Send PIN to confirm or 'cancel'.`);
    }
    if (data.startsWith('withdraw:wallet:')) {
      await ctx.answerCbQuery();
      const parts = data.split(':');
      const walletId = parts[2];
      sessions.set(userId, { step: 'WITHDRAW_AMOUNT', data: { wallet_id: walletId } });
      await writeAudit(userId, 'telegram.withdraw.wallet_choose', { wallet: walletId });
      return ctx.reply('Enter withdraw amount in USD:');
    }
    if (data === 'buy:custom' || data === 'buy:manual') {
      await ctx.answerCbQuery();
      const s = sessions.get(userId);
      if (!s) return ctx.reply('Session expired. Start /buy again.');
      s.step = 'BUY_CUSTOM';
      sessions.set(userId, s);
      return ctx.reply('Enter custom amount in USD:');
    }
    if (data === 'menu:sell') {
      // trigger sell command flow
      await ctx.answerCbQuery();
      return bot.handleUpdate({ message: { text: '/sell', from: cb.from, chat: cb.message?.chat } } as any, ctx.telegram);
    }
    if (data === 'menu:positions') {
      await ctx.answerCbQuery();
      // show positions inline list
      const r = await fetch(`${API_BASE}/terminal/positions/${userId}`);
      const j = await r.json();
      const positions = j.positions || [];
      if (positions.length === 0) return ctx.reply('No open positions');
      for (const p of positions) {
        const btns = Markup.inlineKeyboard([
          [Markup.button.callback('Sell', `sell:pos:${p.id}`), Markup.button.callback('Details', `pos:detail:${p.id}`)]
        ]);
        await ctx.reply(`Position ${p.mint} qty=${p.qty} entry=${p.entry_price}`, btns as any);
      }
      return;
    }
    if (data === 'menu:limit_orders') {
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/orders/${userId}`);
      const j = await r.json();
      const orders = (j.orders || []).filter((o: any) => o.type === 'limit');
      if (orders.length === 0) return ctx.reply('No limit orders');
      for (const o of orders) {
        const btns = Markup.inlineKeyboard([[Markup.button.callback('Cancel', `order:cancel:${o.id}`)]]);
        await ctx.reply(`Limit ${o.id} mint=${o.mint} status=${o.status}`, btns as any);
      }
      return;
    }
    if (data === 'menu:dca_orders') {
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/orders/${userId}`);
      const j = await r.json();
      const orders = (j.orders || []).filter((o: any) => o.type === 'dca');
      if (orders.length === 0) return ctx.reply('No DCA orders');
      for (const o of orders) {
        const btns = Markup.inlineKeyboard([[Markup.button.callback('Cancel', `order:cancel:${o.id}`)]]);
        await ctx.reply(`DCA ${o.id} mint=${o.mint} status=${o.status}`, btns as any);
      }
      return;
    }
    if (data === 'menu:copy') {
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'COPY_INPUT', data: {} });
      await writeAudit(userId, 'telegram.copy.start', {});
      return ctx.reply('Copy Trade — paste target author username or trade id to follow:');
    }
    if (data === 'menu:sniper') {
      await ctx.answerCbQuery();
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Start Sniper', 'sniper:start'), Markup.button.callback('Stop Sniper', 'sniper:stop')]
      ]);
      return ctx.reply('Sniper panel', kb as any);
    }
    if (data === 'menu:trenches') {
      await ctx.answerCbQuery();
      // show trenches from terminal settings if present
      try {
        const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
        const j = await r.json();
        const prefs = j.settings?.presets_json ? (typeof j.settings.presets_json === 'string' ? JSON.parse(j.settings.presets_json) : j.settings.presets_json) : {};
        const trenches = prefs.trenches || [];
        if (trenches.length === 0) return ctx.reply('No trenches defined');
        return ctx.reply(`Trenches:\n${trenches.map((t: any) => JSON.stringify(t)).join('\n')}`);
      } catch (e) {
        return ctx.reply('Trenches view unavailable');
      }
    }
    if (data === 'menu:rewards') {
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/rewards/${userId}`);
      const j = await r.json();
      const rewards = j.rewards || [];
      if (rewards.length === 0) return ctx.reply('No rewards yet');
      for (const rew of rewards) await ctx.reply(`Reward: ${rew.title || rew.body || JSON.stringify(rew)}`);
      return;
    }
    if (data === 'menu:watchlist') {
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/watchlist/${userId}`);
      const j = await r.json();
      const list = j.watchlist || [];
      const kb = Markup.inlineKeyboard([
        ...(list.map((m: string) => [Markup.button.callback(`Remove ${m}`, `watchlist:remove:${m}`)])),
        [Markup.button.callback('Add item', 'watchlist:add')]
      ]);
      return ctx.reply(`Watchlist:\n${list.join('\n') || '(empty)'}`, kb as any);
    }
    if (data === 'menu:withdraw') {
      await ctx.answerCbQuery();
      // Show wallet selection for withdrawal
      try {
        const r = await fetch(`${API_BASE}/wallets/${userId}`);
        const j = await r.json();
        const wallets = j.wallets || [];
        if (wallets.length === 0) return ctx.reply('No wallets found. Add a wallet via the API first.');
        const kb = Markup.inlineKeyboard(wallets.map((w: any) => [Markup.button.callback(`${w.label || w.id}`, `withdraw:wallet:${w.id}`)]));
        await writeAudit(userId, 'telegram.withdraw.start', {});
        return ctx.reply('Choose wallet to withdraw from:', kb as any);
      } catch (e) {
        return ctx.reply('Unable to start withdraw flow');
      }
    }
    if (data === 'menu:help') {
      await ctx.answerCbQuery();
      return ctx.reply('Help: Use /menu to open the terminal. For support, contact admin.');
    }
    if (data === 'menu:refresh') {
      await ctx.answerCbQuery();
      // attempt to refresh balance via API
      const r = await fetch(`${API_BASE}/wallets/${userId}`);
      const j = await r.json();
      const wallets = j.wallets || [];
      return ctx.reply(`Wallets refreshed: ${wallets.length} wallets`);
    }
    if (data === 'menu:orders') {
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/orders/${userId}`);
      const j = await r.json();
      const orders = j.orders || [];
      if (orders.length === 0) return ctx.reply('No orders');
      for (const o of orders) {
        const btns = Markup.inlineKeyboard([[Markup.button.callback('Cancel', `order:cancel:${o.id}`)]]);
        await ctx.reply(`Order ${o.id} type=${o.type} mint=${o.mint} status=${o.status}`, btns as any);
      }
      return;
    }
    if (data === 'menu:wallets') {
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/wallets/${userId}`);
      const j = await r.json();
      const wallets = j.wallets || [];
      if (wallets.length === 0) return ctx.reply('No wallets found. Use /create_wallet to add one via API.');
      const rows: any[] = [];
      for (const w of wallets) {
        rows.push([Markup.button.callback(w.label || w.id, `wallet:select:${w.id}`)]);
      }
      const kb = Markup.inlineKeyboard(rows);
      return ctx.reply('Select a wallet:', kb as any);
    }
    if (data === 'menu:settings') {
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const j = await r.json();
      const settings = j.settings || { confirm_trades: true, exec_mode: 'Normal', presets_json: null };
      const prefs = settings.presets_json ? (typeof settings.presets_json === 'string' ? JSON.parse(settings.presets_json) : settings.presets_json) : {};
      const confirmLabel = settings.confirm_trades ? '✅ Confirm Trades' : '❌ Confirm Trades';
      const mevBuy = prefs.mev_protect_buys ? '🟢 MEV Protect (Buys)' : '⚪ MEV Protect (Buys)';
      const mevSell = prefs.mev_protect_sells ? '🟢 MEV Protect (Sells)' : '⚪ MEV Protect (Sells)';
      const autoBuy = prefs.auto_buy ? '🔴 Auto Buy' : '⚪ Auto Buy';
      const autoSell = prefs.auto_sell ? '🔴 Auto Sell' : '⚪ Auto Sell';
      const chartPrev = prefs.chart_previews ? '🟢 Chart Previews' : '⚪ Chart Previews';
      const showTokens = prefs.show_tokens ? '🟢 Show Tokens' : '⚪ Show/Hide Tokens';
      const sellProt = prefs.sell_protection ? '🟢 Sell Protection' : '⚪ Sell Protection';
      const simpleMode = prefs.simple_mode ? 'Simple Mode ➡️' : 'Simple Mode';

      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('◀ Back', 'menu:back'), Markup.button.callback('English ➡', 'settings:lang:en')],
        [Markup.button.callback('Fast 🐴', 'settings:exec:fast'), Markup.button.callback('Turbo 🚀', 'settings:exec:turbo'), Markup.button.callback(`Fee: ${prefs.priority_fee || '0.0000'} SOL`, 'settings:fee')],
        [Markup.button.callback('Buy Settings', 'settings:buy_settings'), Markup.button.callback('Sell Settings', 'settings:sell_settings')],
        [Markup.button.callback(mevBuy, 'settings:toggle:mev_protect_buys'), Markup.button.callback(mevSell, 'settings:toggle:mev_protect_sells')],
        [Markup.button.callback(autoBuy, 'settings:toggle:auto_buy'), Markup.button.callback(autoSell, 'settings:toggle:auto_sell')],
        [Markup.button.callback(confirmLabel, 'settings:toggle:confirm')],
        [Markup.button.callback('PnL Cards', 'settings:pnls'), Markup.button.callback(chartPrev, 'settings:toggle:chart_previews')],
        [Markup.button.callback(showTokens, 'settings:toggle:show_tokens'), Markup.button.callback('Wallets', 'menu:wallets')],
        [Markup.button.callback('🔒 Account Security', 'settings:account_security'), Markup.button.callback(sellProt, 'settings:toggle:sell_protection')],
        [Markup.button.callback('⚡ BOLT', 'settings:bolt'), Markup.button.callback(simpleMode, 'settings:toggle:simple_mode')]
      ]);
      return ctx.reply('Terminal settings', kb as any);
    }

    // Buy settings submenu
    if (data === 'settings:buy_settings') {
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const j = await r.json();
      const current = j.settings || { presets_json: null, buy_slippage_bps: 1500 };
      const prefs = current.presets_json ? (typeof current.presets_json === 'string' ? JSON.parse(current.presets_json) : current.presets_json) : {};
      const presetButtons = Markup.inlineKeyboard([
        [Markup.button.callback('0.5 SOL ✏️', `settings:set:buy_amount:0.5`), Markup.button.callback('1 SOL ✏️', `settings:set:buy_amount:1`)],
        [Markup.button.callback('3 SOL ✏️', `settings:set:buy_amount:3`), Markup.button.callback('5 SOL ✏️', `settings:set:buy_amount:5`)],
        [Markup.button.callback('10 SOL ✏️', `settings:set:buy_amount:10`)]
      ]);
      const slippageKb = Markup.inlineKeyboard([
        [Markup.button.callback('Slippage: 5%', `settings:set:buy_slippage:500`), Markup.button.callback('Slippage: 10%', `settings:set:buy_slippage:1000`)],
        [Markup.button.callback('Slippage: 15%', `settings:set:buy_slippage:1500`), Markup.button.callback('Back', 'menu:settings')]
      ]);
      await ctx.reply('— Buy Amounts —', presetButtons as any);
      await ctx.reply(`Buy Slippage: ${Number(current.buy_slippage_bps || 1500)/100}%`, slippageKb as any);
      return;
    }

    // Sell settings submenu (mirror of buy)
    if (data === 'settings:sell_settings') {
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const j = await r.json();
      const current = j.settings || { presets_json: null, sell_slippage_bps: 1500 };
      const prefs = current.presets_json ? (typeof current.presets_json === 'string' ? JSON.parse(current.presets_json) : current.presets_json) : {};
      const presetButtons = Markup.inlineKeyboard([
        [Markup.button.callback('0.5 SOL ✏️', `settings:set:sell_amount:0.5`), Markup.button.callback('1 SOL ✏️', `settings:set:sell_amount:1`)],
        [Markup.button.callback('3 SOL ✏️', `settings:set:sell_amount:3`), Markup.button.callback('5 SOL ✏️', `settings:set:sell_amount:5`)],
        [Markup.button.callback('10 SOL ✏️', `settings:set:sell_amount:10`)]
      ]);
      const slippageKb = Markup.inlineKeyboard([
        [Markup.button.callback('Slippage: 5%', `settings:set:sell_slippage:500`), Markup.button.callback('Slippage: 10%', `settings:set:sell_slippage:1000`)],
        [Markup.button.callback('Slippage: 15%', `settings:set:sell_slippage:1500`), Markup.button.callback('Back', 'menu:settings')]
      ]);
      await ctx.reply('— Sell Amounts —', presetButtons as any);
      await ctx.reply(`Sell Slippage: ${Number(current.sell_slippage_bps || 1500)/100}%`, slippageKb as any);
      return;
    }

    // navigate back to main menu
    if (data === 'menu:back') {
      await ctx.answerCbQuery();
      return bot.handleUpdate({ message: { text: '/menu', from: cb.from, chat: cb.message?.chat } } as any, ctx.telegram);
    }

    // execution mode shortcuts
    if (data.startsWith('settings:exec:')) {
      await ctx.answerCbQuery();
      const parts = data.split(':');
      const mode = parts[2] === 'fast' ? 'Fast' : parts[2] === 'turbo' ? 'Turbo' : 'Normal';
      const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const j = await r.json();
      const current = j.settings || {};
      const updated = { ...current, exec_mode: mode };
      await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      await writeAudit(userId, 'telegram.settings.exec', { exec_mode: mode });
      return ctx.reply(`Execution mode set to ${mode}`);
    }

    if (data === 'settings:fee') {
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'FEE_INPUT', data: {} });
      return ctx.reply('Enter fee override in SOL (e.g. 0.0005) or type 0 to clear:');
    }

    // sniper actions
    if (data === 'sniper:start') {
      await ctx.answerCbQuery();
      const resp = await fetch(`${API_BASE}/sniper/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, profile: { created_by: userId } }) });
      const j = await resp.json();
      await writeAudit(userId, 'telegram.sniper.start', { resp: j });
      return ctx.reply('Sniper started: ' + JSON.stringify(j));
    }
    if (data === 'sniper:stop') {
      await ctx.answerCbQuery();
      const resp = await fetch(`${API_BASE}/sniper/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) });
      const j = await resp.json();
      await writeAudit(userId, 'telegram.sniper.stop', {});
      return ctx.reply('Sniper stopped');
    }

    // watchlist inline actions
    if (data === 'watchlist:add') {
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'WATCHLIST_ADD', data: {} });
      return ctx.reply('Paste mint to add to your watchlist:');
    }
    if (data.startsWith('watchlist:remove:')) {
      await ctx.answerCbQuery();
      const parts = data.split(':');
      const mint = parts[2];
      await fetch(`${API_BASE}/watchlist/${userId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mint }) });
      await writeAudit(userId, 'telegram.watchlist.remove', { mint });
      return ctx.reply(`Removed ${mint} from watchlist`);
    }

    if (data.startsWith('settings:lang:')) {
      await ctx.answerCbQuery();
      return ctx.reply('Language selection not implemented in demo.');
    }

    // wallet select
    if (data.startsWith('wallet:select:')) {
      const parts = data.split(':');
      const wid = parts[2];
      const s = sessions.get(userId) || { step: 'IDLE', data: {} };
      s.data = s.data || {};
      s.data.selectedWallet = wid;
      s.step = 'BUY_INPUT';
      sessions.set(userId, s);
      await ctx.answerCbQuery('Wallet selected');
      await writeAudit(userId, 'telegram.wallet.select', { wallet: wid });
      return ctx.reply('Selected wallet. Now paste token mint address:');
    }

    // sell by callback (start percent prompt)
    if (data.startsWith('sell:pos:')) {
      const parts = data.split(':');
      const pid = parts[2];
      const r = await fetch(`${API_BASE}/trades/pos/${pid}`);
      // if API doesn't have that endpoint, we just set session
      const s = { step: 'SELL_CHOOSE_POS', data: { positions: [{ id: pid }] } } as any;
      sessions.set(userId, s);
      await ctx.answerCbQuery();
      return ctx.reply('Enter percent to sell (25/50/75/100 or custom):');
    }

    // order cancel
    if (data.startsWith('order:cancel:')) {
      const parts = data.split(':');
      const oid = parts[2];
      await fetch(`${API_BASE}/orders/${oid}/cancel`, { method: 'POST' });
      await ctx.answerCbQuery('Order cancelled');
      await writeAudit(userId, 'telegram.order.cancel', { order: oid });
      return ctx.editMessageText?.(`Order ${oid} cancelled`) || ctx.reply(`Order ${oid} cancelled`);
    }

    // generic settings toggles
    if (data.startsWith('settings:toggle:')) {
      const parts = data.split(':');
      const key = parts[2];
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const j = await r.json();
      const current = j.settings || { confirm_trades: true, presets_json: null };
      if (key === 'confirm') {
        const updated = { ...current, confirm_trades: !current.confirm_trades };
        await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        await writeAudit(userId, 'telegram.settings.toggle', { confirm_trades: updated.confirm_trades });
        return ctx.reply(`Confirm trades set to ${updated.confirm_trades}`);
      }
      // other toggles stored in presets_json
      const prefs = current.presets_json ? (typeof current.presets_json === 'string' ? JSON.parse(current.presets_json) : current.presets_json) : {};
      const prev = !!prefs[key];
      prefs[key] = !prev;
      const updated = { ...current, presets_json: JSON.stringify(prefs) };
      await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      await writeAudit(userId, 'telegram.settings.toggle', { [key]: prefs[key] });
      return ctx.reply(`${key} set to ${prefs[key]}`);
    }

    // set buy/sell preset amounts and slippage
    if (data.startsWith('settings:set:buy_amount:') || data.startsWith('settings:set:sell_amount:') || data.startsWith('settings:set:buy_slippage:') || data.startsWith('settings:set:sell_slippage:')) {
      await ctx.answerCbQuery();
      const parts = data.split(':');
      // parts: ['settings','set','buy_amount','0.5']
      const target = parts[2];
      const value = parts[3];
      const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const j = await r.json();
      const current = j.settings || { presets_json: null };
      const prefs = current.presets_json ? (typeof current.presets_json === 'string' ? JSON.parse(current.presets_json) : current.presets_json) : {};
      if (target === 'buy_amount') {
        prefs.buy_amount = Number(value);
        const updated = { ...current, presets_json: JSON.stringify(prefs) };
        await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        await writeAudit(userId, 'telegram.settings.buy_amount', { value: prefs.buy_amount });
        return ctx.reply(`Buy amount set to ${prefs.buy_amount} SOL`);
      }
      if (target === 'sell_amount') {
        prefs.sell_amount = Number(value);
        const updated = { ...current, presets_json: JSON.stringify(prefs) };
        await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        await writeAudit(userId, 'telegram.settings.sell_amount', { value: prefs.sell_amount });
        return ctx.reply(`Sell amount set to ${prefs.sell_amount} SOL`);
      }
      if (target === 'buy_slippage') {
        const sl = Number(value);
        const updated = { ...current, buy_slippage_bps: sl };
        await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        await writeAudit(userId, 'telegram.settings.buy_slippage', { value: sl });
        return ctx.reply(`Buy slippage set to ${sl/100}%`);
      }
      if (target === 'sell_slippage') {
        const sl = Number(value);
        const updated = { ...current, sell_slippage_bps: sl };
        await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        await writeAudit(userId, 'telegram.settings.sell_slippage', { value: sl });
        return ctx.reply(`Sell slippage set to ${sl/100}%`);
      }
    }

    await ctx.answerCbQuery();
  } catch (e: any) {
    await ctx.answerCbQuery('Error handling action');
  }
});

// Wallet commands: /wallets to list and select
bot.command('wallets', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const r = await fetch(`${API_BASE}/wallets/${userId}`);
  const j = await r.json();
  const wallets = j.wallets || [];
  if (wallets.length === 0) return ctx.reply('No wallets found. Use /create_wallet to add one via API.');
  let msg = 'Your wallets:\n';
  for (let i = 0; i < wallets.length; i++) {
    const w = wallets[i];
    msg += `${i+1}) ${w.label} id=${w.id} active=${w.is_active}\n`;
  }
  sessions.set(userId, { step: 'WALLET_CHOOSE', data: { wallets } });
  await writeAudit(userId, 'telegram.wallets.list', {});
  return ctx.reply(msg + '\nReply with the number to select as active wallet');
});


// Simple buy flow: /buy starts
bot.command('buy', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  sessions.set(userId, { step: 'BUY_INPUT', data: {} });
  await writeAudit(userId, 'telegram.buy.start', {});
  return ctx.reply('Paste token mint address:');
});

bot.on('text', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const s = sessions.get(userId);
  const text = ctx.message.text.trim();
  if (!s) return;
  if (s.step === 'BUY_INPUT') {
    s.data.mint = text;
    s.step = 'BUY_PANEL';
    sessions.set(userId, s);
    await writeAudit(userId, 'telegram.buy.mint', { mint: text });
    // fetch user presets and show quick-buy buttons
    try {
      const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const j = await r.json();
      const settings = j.settings || {};
      const prefs = settings.presets_json ? (typeof settings.presets_json === 'string' ? JSON.parse(settings.presets_json) : settings.presets_json) : {};
      const presets: number[] = prefs.buy_presets || (prefs.buy_amount ? [prefs.buy_amount] : []);
      const buttons: any[] = [];
      for (const p of presets) {
        buttons.push([Markup.button.callback(`${p} USD`, `buy:preset:${p}`)]);
      }
      // add custom and enter manually
      buttons.push([Markup.button.callback('Custom amount', 'buy:custom'), Markup.button.callback('Enter manually', 'buy:manual')]);
      const kb = Markup.inlineKeyboard(buttons);
      await ctx.reply('Select preset amount or choose Custom:', kb as any);
      return;
    } catch (e) {
      return ctx.reply('Enter buy amount in USD:');
    }
  }
  // Withdraw amount entry
  if (s.step === 'WITHDRAW_AMOUNT') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return ctx.reply('Invalid amount');
    s.data.amount_usd = amount;
    s.step = 'WITHDRAW_DEST';
    sessions.set(userId, s);
    await writeAudit(userId, 'telegram.withdraw.amount', { amount });
    return ctx.reply('Enter destination public key/address for withdrawal:');
  }
  if (s.step === 'WITHDRAW_DEST') {
    const dest = text;
    s.data.destination = dest;
    // fetch estimate from API to show estimated SOL and fee buffer
    try {
      const estRes = await fetch(`${API_BASE}/wallets/${s.data.wallet_id}/estimate?amount_usd=${encodeURIComponent(s.data.amount_usd)}`);
      const est = await estRes.json();
      let msg = `Destination: ${dest}\nAmount (USD): ${s.data.amount_usd}\nEstimated SOL: ${est.solAmount?.toFixed ? est.solAmount.toFixed(6) : est.solAmount} SOL\nFee buffer: ${est.feeBufferSol} SOL`;
      if (est.balance_sol !== null) msg += `\nWallet balance: ${est.balance_sol.toFixed(6)} SOL (~$${est.balance_usd?.toFixed(2)})`;
      s.step = 'WITHDRAW_CONFIRM';
      sessions.set(userId, s);
      await writeAudit(userId, 'telegram.withdraw.dest', { destination: dest, estimate: est });
      return ctx.reply(msg + '\n\nSend PIN to confirm withdrawal or type cancel');
    } catch (e) {
      s.step = 'WITHDRAW_CONFIRM';
      sessions.set(userId, s);
      await writeAudit(userId, 'telegram.withdraw.dest', { destination: dest });
      return ctx.reply('Send PIN to confirm withdrawal or type cancel');
    }
  }
  if (s.step === 'WITHDRAW_CONFIRM') {
    if (text.toLowerCase() === 'cancel') {
      sessions.delete(userId);
      await writeAudit(userId, 'telegram.withdraw.cancel', {});
      return ctx.reply('Withdrawal cancelled');
    }
    const pin = text;
    try {
      const resp = await fetch(`${API_BASE}/wallets/${s.data.wallet_id}/withdraw`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, amount_usd: s.data.amount_usd, destination_pubkey: s.data.destination, pin })
      });
      const j = await resp.json();
      if (resp.status !== 200) {
        await writeAudit(userId, 'telegram.withdraw.failed', { err: j });
        sessions.delete(userId);
        return ctx.reply('Withdrawal failed: ' + JSON.stringify(j));
      }
      await writeAudit(userId, 'telegram.withdraw.requested', { id: j.id });
      sessions.delete(userId);
      return ctx.reply(`Withdrawal requested (id=${j.id}). Processing will follow.`);
    } catch (e: any) {
      await writeAudit(userId, 'telegram.withdraw.error', { error: String(e) });
      sessions.delete(userId);
      return ctx.reply('Withdrawal failed to submit');
    }
  }
  if (s.step === 'WALLET_CHOOSE') {
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx)) return ctx.reply('Invalid selection');
    const w = s.data.wallets[idx];
    if (!w) return ctx.reply('Invalid selection');
    s.data.selectedWallet = w.id;
    s.step = 'BUY_INPUT';
    sessions.set(userId, s);
    await writeAudit(userId, 'telegram.wallets.choose', { wallet: w.id });
    return ctx.reply('Selected wallet. Now paste token mint address:');
  }
  if (s.step === 'BUY_PANEL') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return ctx.reply('Invalid amount');
    s.data.amount_usd = amount;
    // request quote
    const qres = await fetch(`${API_BASE}/terminal/buy/quote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputMint: 'SOL', outputMint: s.data.mint, amount_usd: amount, slippageBps: 100 })
    });
    const qjson = await qres.json();
    s.data.quote = qjson.quote;
    s.step = 'BUY_CONFIRM';
    sessions.set(userId, s);
    await writeAudit(userId, 'telegram.buy.quote', { quote: qjson.quote });
    return ctx.reply(`Quote: expectedOut=${qjson.quote.expectedOut}, fees=${qjson.quote.fees}. Send PIN to confirm or 'cancel'.`);
  }
  // Copy trade input flow
  if (s.step === 'COPY_INPUT') {
    const target = text;
    // call API to create a copy_trade subscription
    try {
      const resp = await fetch(`${API_BASE}/copy_trade`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, source: target }) });
      const j = await resp.json();
      await writeAudit(userId, 'telegram.copy.create', { id: j.id, source: target });
      sessions.delete(userId);
      return ctx.reply(`Copy trade started (id=${j.id}). You'll be notified of executions.`);
    } catch (e) {
      sessions.delete(userId);
      return ctx.reply('Failed to start copy trade');
    }
  }

  // Fee override input
  if (s.step === 'FEE_INPUT') {
    const v = parseFloat(text);
    if (isNaN(v) || v < 0) return ctx.reply('Invalid fee');
    try {
      const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const j = await r.json();
      const current = j.settings || { presets_json: null };
      const prefs = current.presets_json ? (typeof current.presets_json === 'string' ? JSON.parse(current.presets_json) : current.presets_json) : {};
      prefs.priority_fee = v;
      const updated = { ...current, presets_json: JSON.stringify(prefs) };
      await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      await writeAudit(userId, 'telegram.settings.fee', { fee: v });
      sessions.delete(userId);
      return ctx.reply(`Fee override set to ${v} SOL`);
    } catch (e) {
      sessions.delete(userId);
      return ctx.reply('Failed to save fee override');
    }
  }

  // Watchlist add flow
  if (s.step === 'WATCHLIST_ADD') {
    const mint = text.trim();
    if (!mint) return ctx.reply('Invalid mint');
    try {
      const resp = await fetch(`${API_BASE}/watchlist/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mint }) });
      const j = await resp.json();
      await writeAudit(userId, 'telegram.watchlist.add', { mint });
      sessions.delete(userId);
      return ctx.reply(`Added ${mint} to watchlist`);
    } catch (e) {
      sessions.delete(userId);
      return ctx.reply('Failed to add to watchlist');
    }
  }
  if (s.step === 'BUY_CONFIRM') {
    if (text.toLowerCase() === 'cancel') {
      sessions.delete(userId);
      await writeAudit(userId, 'telegram.buy.cancel', {});
      return ctx.reply('Buy cancelled');
    }
    const pin = text;
    // Execute buy
    const idempotencyKey = 'tele:' + userId + ':' + Date.now();
    const execRes = await fetch(`${API_BASE}/terminal/buy/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, wallet_id: null, mint: s.data.mint, amount_usd: s.data.amount_usd, idempotency_key: idempotencyKey, slippage_bps: 100, exec_mode: 'Normal', shield: false, pin })
    });
    const execJson = await execRes.json();
    if (execRes.status !== 200) {
      await writeAudit(userId, 'telegram.buy.execute.failed', { err: execJson });
      sessions.delete(userId);
      return ctx.reply('Buy failed: ' + JSON.stringify(execJson));
    }
    await writeAudit(userId, 'telegram.buy.execute', { tradeId: execJson.tradeId });
    sessions.delete(userId);
    return ctx.reply(`Buy queued: tradeId=${execJson.tradeId}. Use /status ${execJson.tradeId} to check.`);
  }
  // Sell flow continuation
  if (s.step === 'SELL_CHOOSE_POS') {
    const idx = parseInt(text, 10) - 1;
    if (isNaN(idx)) return ctx.reply('Invalid selection');
    const pos = s.data.positions[idx];
    if (!pos) return ctx.reply('Invalid selection');
    s.data.chosen = pos;
    s.step = 'SELL_PERCENT';
    sessions.set(userId, s);
    await writeAudit(userId, 'telegram.sell.choose', { position: pos.id });
    return ctx.reply('Enter percent to sell (25/50/75/100 or custom):');
  }
  if (s.step === 'SELL_PERCENT') {
    const pct = parseFloat(text);
    if (isNaN(pct) || pct <= 0 || pct > 100) return ctx.reply('Invalid percent');
    s.data.percent = pct;
    s.step = 'SELL_CONFIRM';
    sessions.set(userId, s);
    await writeAudit(userId, 'telegram.sell.percent', { percent: pct });
    return ctx.reply('Send PIN to confirm sell or type cancel');
  }
  if (s.step === 'SELL_CONFIRM') {
    if (text.toLowerCase() === 'cancel') {
      sessions.delete(userId);
      await writeAudit(userId, 'telegram.sell.cancel', {});
      return ctx.reply('Sell cancelled');
    }

  // custom buy entered amount flow
  if (s.step === 'BUY_CUSTOM') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return ctx.reply('Invalid amount');
    s.data.amount_usd = amount;
    s.step = 'BUY_CUSTOM_SAVE_PROMPT';
    sessions.set(userId, s);
    await writeAudit(userId, 'telegram.buy.custom_amount', { amount });
    return ctx.reply('Type "save" to add this amount to presets, or send your PIN to confirm buy now.');
  }

  if (s.step === 'BUY_CUSTOM_SAVE_PROMPT') {
    if (text.toLowerCase() === 'save') {
      // save preset
      try {
        const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
        const j = await r.json();
        const current = j.settings || { presets_json: null };
        const prefs = current.presets_json ? (typeof current.presets_json === 'string' ? JSON.parse(current.presets_json) : current.presets_json) : {};
        prefs.buy_presets = prefs.buy_presets || [];
        if (!prefs.buy_presets.includes(s.data.amount_usd)) prefs.buy_presets.push(s.data.amount_usd);
        const updated = { ...current, presets_json: JSON.stringify(prefs) };
        await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        await writeAudit(userId, 'telegram.buy.preset_saved', { amount: s.data.amount_usd });
        s.step = 'BUY_CONFIRM';
        sessions.set(userId, s);
        return ctx.reply(`Saved preset ${s.data.amount_usd} and ready. Send PIN to confirm buy.`);
      } catch (e) {
        return ctx.reply('Failed to save preset');
      }
    }
    // assume text is PIN -> proceed to execute buy
    const pin = text;
    const idempotencyKey = 'tele:' + userId + ':' + Date.now();
    const execRes = await fetch(`${API_BASE}/terminal/buy/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, wallet_id: s.data.selectedWallet || null, mint: s.data.mint, amount_usd: s.data.amount_usd, idempotency_key: idempotencyKey, slippage_bps: 100, exec_mode: 'Normal', shield: false, pin })
    });
    const execJson = await execRes.json();
    if (execRes.status !== 200) {
      await writeAudit(userId, 'telegram.buy.execute.failed', { err: execJson });
      sessions.delete(userId);
      return ctx.reply('Buy failed: ' + JSON.stringify(execJson));
    }
    await writeAudit(userId, 'telegram.buy.execute', { tradeId: execJson.tradeId });
    sessions.delete(userId);
    return ctx.reply(`Buy queued: tradeId=${execJson.tradeId}. Use /status ${execJson.tradeId} to check.`);
  }
    const pin = text;
    const idempotencyKey = 'tele:sell:' + userId + ':' + Date.now();
    const execRes = await fetch(`${API_BASE}/terminal/sell/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, position_id: s.data.chosen.id, percent: s.data.percent, idempotency_key: idempotencyKey, slippage_bps: 100, exec_mode: 'Normal', shield: false, pin })
    });
    const execJson = await execRes.json();
    if (execRes.status !== 200) {
      await writeAudit(userId, 'telegram.sell.execute.failed', { err: execJson });
      sessions.delete(userId);
      return ctx.reply('Sell failed: ' + JSON.stringify(execJson));
    }
    await writeAudit(userId, 'telegram.sell.execute', { tradeId: execJson.tradeId });
    sessions.delete(userId);
    return ctx.reply(`Sell queued: tradeId=${execJson.tradeId}. Use /status ${execJson.tradeId} to check.`);
  }
});

bot.command('status', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const parts = ctx.message.text.split(' ');
  if (parts.length < 2) return ctx.reply('Usage: /status <tradeId>');
  const tradeId = parts[1];
  const r = await fetch(`${API_BASE}/trades/${tradeId}`);
  const j = await r.json();
  await writeAudit(userId, 'telegram.status', { tradeId });
  return ctx.reply(`Trade ${tradeId}: ${JSON.stringify(j.trade)}`);
});

// Sell flow
bot.command('sell', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  // fetch positions
  const r = await fetch(`${API_BASE}/terminal/positions/${userId}`);
  const j = await r.json();
  const positions = j.positions || [];
  if (positions.length === 0) return ctx.reply('No open positions');
  // list positions with index
  let msg = 'Open positions:\n';
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    msg += `${i+1}) ${p.mint} qty=${p.qty} entry=${p.entry_price} id=${p.id}\n`;
  }
  sessions.set(userId, { step: 'SELL_CHOOSE_POS', data: { positions } });
  await writeAudit(userId, 'telegram.sell.start', {});
  return ctx.reply(msg + '\nReply with the number of the position to sell:');
});

// reuse text handler for sell flow
// In text handler above, add handling



bot.command('positions', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const r = await fetch(`${API_BASE}/terminal/positions/${userId}`);
  const j = await r.json();
  const positions = j.positions || [];
  if (positions.length === 0) return ctx.reply('No open positions');
  const lines = positions.map((p: any, i: number) => `${i + 1}) ${p.mint} qty=${p.qty} entry=${p.entry_price}`);
  await writeAudit(userId, 'telegram.positions', {});
  return ctx.reply('Open positions\n' + lines.join('\n'));
});

bot.command('orders', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const r = await fetch(`${API_BASE}/orders/${userId}`);
  const j = await r.json();
  const orders = j.orders || [];
  if (orders.length === 0) return ctx.reply('No orders');
  const lines = orders.map((o: any) => `${o.id} ${o.type} ${o.mint || '-'} ${o.status}`);
  await writeAudit(userId, 'telegram.orders', {});
  return ctx.reply('Orders\n' + lines.join('\n'));
});

bot.command('sniper', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.sniper.menu', {});
  return ctx.reply('Sniper menu: use inline menu -> Sniper, or API /sniper/start and /sniper/stop.');
});

bot.command('copy', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.copy.menu', {});
  return ctx.reply('Copy trade: use inline menu -> Copy Trade, or API /copy_trade endpoint.');
});

bot.command('wallet', async (ctx) => {
  return bot.handleUpdate({ message: { text: '/wallets', from: ctx.from, chat: (ctx.message as any).chat } } as any, ctx.telegram);
});

bot.command('settings', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
  const j = await r.json();
  await writeAudit(userId, 'telegram.settings.view', {});
  return ctx.reply('Settings: ' + JSON.stringify(j.settings || {}));
});

bot.command('security', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.security.view', {});
  return ctx.reply('Security: PIN is required for buy/sell confirmation and withdrawals.');
});

bot.command('subscribe', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.subscribe.view', {});
  return ctx.reply('Plans: Meme Pro $100, Forex Pro $100, Bundle $170. Use payment flow then /subscriptions/activate API.');
});

bot.command('help', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.help', {});
  return ctx.reply('Commands: /menu /buy /sell /positions /orders /sniper /copy /wallet /settings /security /subscribe /meme /forex /launch /pullback /bind');
});

bot.command('meme', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.meme.view', {});
  return ctx.reply('Meme Pro: Launch sniper + pullback features (requires active meme subscription).');
});

bot.command('forex', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.forex.view', {});
  return ctx.reply('Forex Pro: EA bridge signals (requires active forex subscription).');
});

bot.command('launch', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.launch.view', {});
  return ctx.reply('Launch Sniper: configure from sniper settings/profile and enable monitoring.');
});

bot.command('pullback', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.pullback.view', {});
  return ctx.reply('Single Meme Pullback: mode setup is available via profile APIs.');
});

bot.command('bind', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.bind.view', {});
  return ctx.reply('EA Bind: register terminal_id + token in ea_terminals, then use /ea/poll and /ea/report.');
});

bot.launch().then(() => console.log('Telegram bot started'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
