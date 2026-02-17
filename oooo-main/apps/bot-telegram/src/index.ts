
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


const SCREEN_PARENTS: Record<string, string> = {
  SCREEN_BUY_INPUT: 'SCREEN_MAIN',
  SCREEN_BUY_PANEL: 'SCREEN_BUY_INPUT',
  SCREEN_BUY_SETTINGS: 'SCREEN_SETTINGS_MAIN',
  SCREEN_BUY_SLIPPAGE: 'SCREEN_BUY_SETTINGS',
  SCREEN_SELL_PANEL: 'SCREEN_POSITIONS',
  SCREEN_SELL_SETTINGS: 'SCREEN_SETTINGS_MAIN',
  SCREEN_SELL_SLIPPAGE: 'SCREEN_SELL_SETTINGS',
  SCREEN_ORDERS_MAIN: 'SCREEN_MAIN',
  SCREEN_LIMIT_ORDERS: 'SCREEN_ORDERS_MAIN',
  SCREEN_DCA_ORDERS: 'SCREEN_ORDERS_MAIN',
  SCREEN_SNIPER_MAIN: 'SCREEN_MAIN',
  SCREEN_COPY_MAIN: 'SCREEN_MAIN',
  SCREEN_WALLET_MAIN: 'SCREEN_MAIN',
  SCREEN_WITHDRAW_FLOW: 'SCREEN_WALLET_MAIN',
  SCREEN_SECURITY_MAIN: 'SCREEN_SETTINGS_MAIN',
  SCREEN_SETTINGS_MAIN: 'SCREEN_MAIN',
  SCREEN_POSITIONS: 'SCREEN_MAIN'
};

function setScreen(userId: string, screen: string) {
  const s = sessions.get(userId) || { step: 'IDLE', data: {} };
  s.data = s.data || {};
  s.data.screen = screen;
  sessions.set(userId, s);
}

async function navigateBack(ctx: any, userId: string) {
  const s = sessions.get(userId);
  const current = s?.data?.screen || 'SCREEN_MAIN';
  const parent = SCREEN_PARENTS[current] || 'SCREEN_MAIN';
  setScreen(userId, parent);
  if (parent === 'SCREEN_MAIN') return renderMainMenu(ctx, userId);
  if (parent === 'SCREEN_SETTINGS_MAIN') return renderSettingsMenu(ctx, userId);
  if (parent === 'SCREEN_POSITIONS') {
    return (bot as any).handleUpdate({ message: { text: '/positions', from: ctx.from, chat: ctx.chat } } as any, ctx.telegram);
  }
  if (parent === 'SCREEN_WALLET_MAIN') return renderWalletMenu(ctx, userId);
  if (parent === 'SCREEN_ORDERS_MAIN') {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('📈 Limit Orders', 'menu:limit_orders')],
      [Markup.button.callback('🔁 DCA Orders', 'menu:dca_orders')],
      [Markup.button.callback('← Back', 'menu:back')]
    ]);
    return ctx.reply('Orders menu', kb as any);
  }
  return renderMainMenu(ctx, userId);
}


type TerminalSettingsPayload = {
  buy_slippage_bps?: number;
  sell_slippage_bps?: number;
  exec_mode?: string;
  shield_enabled?: boolean;
  confirm_trades?: boolean;
  presets_json?: any;
};

async function fetchTerminalSettings(userId: string) {
  const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
  const j: any = await r.json();
  const settings = j.settings || {};
  const prefs = settings.presets_json
    ? (typeof settings.presets_json === 'string' ? JSON.parse(settings.presets_json) : settings.presets_json)
    : {};
  return { settings, prefs };
}

async function saveTerminalSettings(userId: string, patch: TerminalSettingsPayload, prefsPatch?: any) {
  const { settings, prefs } = await fetchTerminalSettings(userId);
  const nextPrefs = prefsPatch ? { ...prefs, ...prefsPatch } : prefs;
  const payload: any = {
    ...settings,
    ...patch,
    presets_json: JSON.stringify(nextPrefs)
  };
  await fetch(`${API_BASE}/terminal/settings/${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return { settings: payload, prefs: nextPrefs };
}

function onOffDot(v: boolean) {
  return v ? '🟢' : '🔴';
}

function shortAddr(v?: string) {
  if (!v) return 'not set';
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
}

function buildSettingsHelpText() {
  return [
    '💡 Settings FAQ',
    '',
    '🚀 Fast/Turbo/Custom Fee: increase priority to reduce failed transactions during congestion.',
    '🔴 Confirm Trades OFF: tapping amount executes immediately.',
    '🟢 Confirm Trades ON: you must confirm before buy/sell execution.',
    '🛡 MEV Protection: routes tx privately (when available) to reduce frontrun/sandwich risk.',
    '🟢 Sell Protection ON: asks for confirmation on larger sells to avoid mistakes.',
    '📊 PnL Cards: controls what is displayed on your PnL share cards.'
  ].join('\n');
}

async function renderMainMenu(ctx: any, userId: string) {
  const wr = await fetch(`${API_BASE}/wallets/${userId}`);
  const wj: any = await wr.json();
  const wallets = wj.wallets || [];
  const active = wallets.find((w: any) => w.is_active) || wallets[0] || null;
  const { settings } = await fetchTerminalSettings(userId);
  const summary = [
    '🏹 Coin Hunter Solana Terminal',
    active
      ? `👛 Wallet: ${active.label || 'wallet'} (${shortAddr(active.pubkey)}) • ${active.balance_sol ?? 'N/A'} SOL`
      : '👛 Wallet: none (create/import Solana wallet)',
    `⚙️ Mode: ${settings.exec_mode || 'Normal'} • Shield ${settings.shield_enabled ? 'ON' : 'OFF'} • Confirm ${settings.confirm_trades === false ? 'OFF' : 'ON'}`,
    `🎯 Slippage: Buy ${Number(settings.buy_slippage_bps ?? 100) / 100}% • Sell ${Number(settings.sell_slippage_bps ?? 100) / 100}%`
  ].join('\n');
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Buy', 'menu:buy'), Markup.button.callback('💸 Sell', 'menu:sell')],
    [Markup.button.callback('📊 Positions', 'menu:positions'), Markup.button.callback('📑 Orders', 'menu:orders')],
    [Markup.button.callback('⚡ Sniper', 'menu:sniper'), Markup.button.callback('🤖 Copy Trade', 'menu:copy')],
    [Markup.button.callback('👛 Wallets', 'menu:wallets'), Markup.button.callback('📤 Withdraw', 'menu:withdraw')],
    [Markup.button.callback('👀 Watchlist', 'menu:watchlist'), Markup.button.callback('⚙️ Settings', 'menu:settings')],
    [Markup.button.callback('🆘 Help', 'menu:help'), Markup.button.callback('🔄 Refresh', 'menu:main')]
  ]);
  return ctx.reply(summary, keyboard as any);
}

async function renderSettingsMenu(ctx: any, userId: string) {
  const { settings, prefs } = await fetchTerminalSettings(userId);
  const fee = Number(prefs.priority_fee || 0).toFixed(4);
  const buyMev = !!(settings.shield_enabled || prefs.mev_protect_buys);
  const sellMev = !!prefs.mev_protect_sells;
  const confirm = settings.confirm_trades !== false;
  const mode = String(settings.exec_mode || 'Normal');
  const rows = Markup.inlineKeyboard([
    [Markup.button.callback('← Back', 'menu:main'), Markup.button.callback('English →', 'settings:lang:en')],
    [Markup.button.callback(`${mode === 'Fast' ? '🟢' : '⚪'} Fast 🐴`, 'settings:exec:fast'), Markup.button.callback(`${mode === 'Turbo' ? '🟢' : '⚪'} Turbo 🚀`, 'settings:exec:turbo'), Markup.button.callback(`✅ ${fee} SOL`, 'settings:fee')],
    [Markup.button.callback('Buy Settings', 'settings:buy_settings'), Markup.button.callback('Sell Settings', 'settings:sell_settings')],
    [Markup.button.callback(`${onOffDot(buyMev)} MEV Protect (Buys)`, 'settings:toggle:mev_protect_buys'), Markup.button.callback(`${onOffDot(sellMev)} MEV Protect (Sells)`, 'settings:toggle:mev_protect_sells')],
    [Markup.button.callback(`${onOffDot(!!prefs.auto_buy)} Auto Buy`, 'settings:toggle:auto_buy'), Markup.button.callback(`${onOffDot(!!prefs.auto_sell)} Auto Sell`, 'settings:toggle:auto_sell')],
    [Markup.button.callback(`${onOffDot(confirm)} Confirm Trades`, 'settings:toggle:confirm')],
    [Markup.button.callback('PnL Cards', 'settings:pnls'), Markup.button.callback(`${onOffDot(!!prefs.chart_previews)} Chart Previews`, 'settings:toggle:chart_previews')],
    [Markup.button.callback('Show/Hide Tokens', 'settings:toggle:show_tokens'), Markup.button.callback('Wallets', 'menu:wallets')],
    [Markup.button.callback('🔐 Account Security', 'settings:account_security'), Markup.button.callback(`${onOffDot(!!prefs.sell_protection)} Sell Protection`, 'settings:toggle:sell_protection')],
    [Markup.button.callback(`⚡ BOLT ${onOffDot(!!prefs.bolt_enabled)}`, 'settings:toggle:bolt_enabled'), Markup.button.callback(`${prefs.simple_mode ? 'Simple Mode →' : 'Advanced Mode →'}`, 'settings:toggle:simple_mode')]
  ]);
  const caption = [
    '⚙️ Terminal Settings',
    `Buy Slip: ${Number(settings.buy_slippage_bps ?? 100) / 100}% • Sell Slip: ${Number(settings.sell_slippage_bps ?? 100) / 100}%`,
    `Mode: ${mode} • Fee: ${fee} SOL • Shield: ${settings.shield_enabled ? 'ON' : 'OFF'}`
  ].join('\n');
  return ctx.reply(caption, rows as any);
}



async function renderWalletMenu(ctx: any, userId: string) {
  const r = await fetch(`${API_BASE}/wallets/${userId}`);
  const j: any = await r.json();
  const wallets = j.wallets || [];
  if (wallets.length === 0) {
    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('Create Solana Wallet', 'menu:wallet_create')],
      [Markup.button.callback('Import Solana Wallet', 'menu:wallet_import')],
      [Markup.button.callback('← Back', 'menu:main')]
    ]);
    return ctx.reply('Solana Wallets\n\nNo wallets found yet.', kb as any);
  }

  const lines = ['Solana Wallets'];
  for (const w of wallets) {
    const active = w.is_active ? '✅' : '☐';
    lines.push(`${w.label || 'W'} ${active}`);
    lines.push(`${w.pubkey}`);
    lines.push(`Balance: ${w.balance_sol ?? '0'} SOL (${w.balance_usd !== null && w.balance_usd !== undefined ? '$' + Number(w.balance_usd).toFixed(2) : '$0.00'})`);
    lines.push('');
  }

  const rows: any[] = wallets.map((w: any) => [Markup.button.callback(`${w.is_active ? '✅' : '☐'} ${w.label || w.id}`, `wallet:select:${w.id}`)]);
  rows.push([Markup.button.callback('Create Solana Wallet', 'menu:wallet_create'), Markup.button.callback('Import Solana Wallet', 'menu:wallet_import')]);
  rows.push([Markup.button.callback('Withdraw', 'menu:withdraw')]);
  rows.push([Markup.button.callback('← Back', 'menu:main')]);
  return ctx.reply(lines.join('\n'), Markup.inlineKeyboard(rows) as any);
}

async function renderPnlCardsMenu(ctx: any, userId: string) {
  const { prefs } = await fetchTerminalSettings(userId);
  const kb = Markup.inlineKeyboard([
    [Markup.button.callback(`${onOffDot(!!prefs.pnl_values)} PnL values`, 'settings:pnls:toggle:pnl_values'), Markup.button.callback(`${onOffDot(!!prefs.show_negative_cards)} Show negative cards`, 'settings:pnls:toggle:show_negative_cards')],
    [Markup.button.callback(`${onOffDot(!!prefs.community_cards)} Community cards`, 'settings:pnls:toggle:community_cards')],
    [Markup.button.callback(`${onOffDot(!!prefs.include_fees)} Include fees`, 'settings:pnls:toggle:include_fees')],
    [Markup.button.callback('← Back', 'menu:settings')]
  ]);
  const body = [
    '📊 PnL Cards',
    'Control what appears on PnL share cards for wins/losses.',
    '• PnL values: show/hide SOL or USD values.',
    '• Negative cards: allow cards for losing trades.',
    '• Community cards: use community card styles.',
    '• Include fees: include fees in PnL and average entry.'
  ].join('\n');
  return ctx.reply(body, kb as any);
}

function buildHelpText() {
  return [
    '📘 Coin Hunter Commands',
    '',
    '/start — onboarding message',
    '/menu — open terminal dashboard',
    '/buy — start buy flow',
    '/sell — start sell flow from open positions',
    '/positions — list open positions',
    '/orders — list all orders (limit/dca/copy)',
    '/limit <mint> <target_price> <amount_usd> [wallet_id] — create limit order',
    '/dca <mint> <amount_usd> <interval_minutes> [wallet_id] — create DCA order',
    '/sniper <start|stop> [amount_usd] [slippage_bps] [fee] [autosell:true|false] [migration:true|false] — control basic sniper',
    '/copy <source_wallet_or_id> [amount_usd] [mint] — create copy trade rule',
    '/watchlist — open inline watchlist manager',
    '/wallet or /wallets — list wallets',
    '/wallet_create [label] — create new custodial wallet',
    '/wallet_import <private_key|mnemonic> <value> — import wallet (supports base58/base64/JSON private key, 12/24 word mnemonic)',
    '/settings — view terminal settings',
    '/security — show PIN/security help',
    '/security set <pin> — set action PIN',
    '/security change <old_pin> <new_pin> — change action PIN',
    '/security verify <pin> — verify PIN',
    '/subscribe <meme|forex|bundle> [months] — activate plan',
    '/meme — meme entitlement status',
    '/forex — forex entitlement status',
    '/launch — start meme launch mode (requires Meme Pro)',
    '/pullback — pullback mode status (requires Meme Pro)',
    '/bind <terminal_id> <token> [platform] — bind EA terminal',
    '/status <trade_id> — check trade status',
    '/pnlcard <position_id> [svg|png] [neon|classic] — generate and send a PnL card image'
  ].join('\n');
}



function escapeXml(v: any) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function shortMint(mint: string) {
  const m = String(mint || 'N/A');
  if (m.length <= 12) return m;
  return `${m.slice(0, 6)}...${m.slice(-6)}`;
}

function buildPnlCardSvg(input: {
  theme?: string;
  title: string;
  mint: string;
  qty: number;
  entry: number;
  pnlUsd: number;
  pnlPct: number;
}) {
  const positive = Number(input.pnlUsd || 0) >= 0;
  const theme = input.theme || 'neon';
  const accent = positive ? '#5BFF8A' : '#FF5B7D';
  const bgA = theme === 'classic' ? '#101820' : '#0b1018';
  const bgB = theme === 'classic' ? '#1f2d3a' : '#152736';
  const pnlUsdText = `${positive ? '+' : ''}$${Number(input.pnlUsd || 0).toFixed(2)}`;
  const pnlPctText = `${positive ? '+' : ''}${Number(input.pnlPct || 0).toFixed(2)}%`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bgA}"/>
      <stop offset="100%" stop-color="${bgB}"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8CFF6B"/>
      <stop offset="100%" stop-color="#32E06B"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)" rx="30"/>
  <rect x="24" y="24" width="1152" height="627" rx="24" fill="none" stroke="#243a4a" stroke-width="2"/>
  <rect x="60" y="70" width="360" height="56" rx="12" fill="url(#glow)" opacity="0.95"/>
  <text x="80" y="106" fill="#082312" font-size="34" font-weight="700" font-family="Inter, Arial">Coin Hunter PnL Card</text>

  <text x="70" y="190" fill="#8BA5BC" font-size="30" font-family="Inter, Arial">Token</text>
  <text x="70" y="232" fill="#E7F2FF" font-size="46" font-weight="700" font-family="Inter, Arial">${escapeXml(shortMint(input.mint))}</text>

  <text x="70" y="300" fill="#8BA5BC" font-size="28" font-family="Inter, Arial">Qty: ${Number(input.qty || 0).toFixed(6)}</text>
  <text x="70" y="340" fill="#8BA5BC" font-size="28" font-family="Inter, Arial">Entry: $${Number(input.entry || 0).toFixed(6)}</text>

  <rect x="650" y="170" width="470" height="230" rx="20" fill="#0f1e2b" stroke="#2a4659" stroke-width="2"/>
  <text x="690" y="240" fill="#95b4cc" font-size="32" font-family="Inter, Arial">Realized/Unrealized PnL</text>
  <text x="690" y="320" fill="${accent}" font-size="74" font-weight="800" font-family="Inter, Arial">${escapeXml(pnlUsdText)}</text>
  <text x="690" y="370" fill="${accent}" font-size="42" font-weight="700" font-family="Inter, Arial">${escapeXml(pnlPctText)}</text>

  <text x="70" y="590" fill="#5f8097" font-size="22" font-family="Inter, Arial">${escapeXml(input.title)}</text>
</svg>`;
}

async function sendPnlCard(ctx: any, userId: string, positionId: string, format?: string, theme?: string) {
  const r = await fetch(`${API_BASE}/positions/${positionId}`);
  const j: any = await r.json();
  const p = j?.position;
  if (!p) return ctx.reply('Position not found for PnL card generation.');

  const { prefs } = await fetchTerminalSettings(userId);
  const chosenFormat = String(format || prefs?.pnl_format || 'svg').toLowerCase();
  const chosenTheme = String(theme || prefs?.pnl_theme || 'neon').toLowerCase();

  const qty = Number(p.qty || 0);
  const entry = Number(p.entry_price || 0);
  const pnlUsd = Number(p.pnl_usd || 0);
  const costBasis = Math.max(0.0000001, qty * entry);
  const pnlPct = (pnlUsd / costBasis) * 100;

  const svg = buildPnlCardSvg({
    title: `Generated for user ${userId} • position ${positionId}`,
    mint: String(p.mint || 'N/A'),
    qty,
    entry,
    pnlUsd,
    pnlPct,
    theme: chosenTheme
  });

  await writeAudit(userId, 'telegram.pnl.card.generate', { positionId, mint: p.mint, pnlUsd, pnlPct, format: chosenFormat, theme: chosenTheme });

  if (chosenFormat === 'png') {
    try {
      const sharpMod: any = await import('sharp');
      const sharp = sharpMod?.default || sharpMod;
      const png = await sharp(Buffer.from(svg, 'utf8')).png().toBuffer();
      const filename = `coinhunter-pnl-${positionId}.png`;
      return ctx.replyWithDocument({ source: png, filename }, { caption: `PnL Card • ${shortMint(String(p.mint || 'N/A'))}` } as any);
    } catch {
      await ctx.reply('PNG renderer unavailable in this environment. Sending SVG instead.');
    }
  }

  const filename = `coinhunter-pnl-${positionId}.svg`;
  return ctx.replyWithDocument({ source: Buffer.from(svg, 'utf8'), filename }, { caption: `PnL Card • ${shortMint(String(p.mint || 'N/A'))}` } as any);
}

async function createExecutionProgress(ctx: any, title: string) {
  const msg: any = await ctx.reply(`${title}
⏳ Quoting...`);
  const chatId = msg?.chat?.id;
  const messageId = msg?.message_id;

  async function edit(body: string) {
    if (chatId && messageId) {
      try {
        await ctx.telegram.editMessageText(chatId, messageId, undefined, body);
        return;
      } catch {}
    }
    await ctx.reply(body);
  }

  return { edit };
}

async function renderWatchlist(ctx: any, userId: string) {
  const r = await fetch(`${API_BASE}/watchlist/${userId}`);
  const j = await r.json();
  const list = j.watchlist || [];
  const kb = Markup.inlineKeyboard([
    ...(list.map((m: string) => [Markup.button.callback(`Remove ${m}`, `watchlist:remove:${m}`)])),
    [Markup.button.callback('Add item', 'watchlist:add')],
    [Markup.button.callback('Refresh', 'watchlist:refresh')]
  ]);
  return ctx.reply(`Watchlist:\n${list.join('\n') || '(empty)'}`, kb as any);
}

bot.start(async (ctx) => {
  const userId = String(ctx.from?.id || 'unknown');
  await writeAudit(userId, 'telegram.start', { username: ctx.from?.username });
  return ctx.reply('Welcome to Coin Hunter (Telegram UI). Use /menu to open the Terminal.');
});

bot.command('menu', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.menu', {});
  setScreen(userId, 'SCREEN_MAIN');
  return renderMainMenu(ctx, userId);
});

// callback router for inline buttons
bot.on('callback_query', async (ctx) => {
  const cb: any = ctx.callbackQuery;
  const userId = String(cb?.from?.id || null);
  const rawData: string = cb?.data || '';
  let data: string = rawData;
  if (data.startsWith('f1:')) {
    const parts = data.split(':');
    const action = parts[1];
    const p2 = parts[2];
    if (data === 'f1:main') data = 'menu:main';
    else if (data === 'f1:buy') data = 'menu:buy';
    else if (data === 'f1:sell') data = 'menu:sell';
    else if (data === 'f1:positions') data = 'menu:positions';
    else if (data === 'f1:orders') data = 'menu:orders';
    else if (data === 'f1:sniper') data = 'menu:sniper';
    else if (data === 'f1:copy') data = 'menu:copy';
    else if (data === 'f1:wallet') data = 'menu:wallets';
    else if (data === 'f1:settings') data = 'menu:settings';
    else if (data === 'f1:help') data = 'menu:help';
    else if (action === 'buy' && p2 === 'refresh') data = 'menu:refresh';
    else if (action === 'buy' && p2 === 'custom') data = 'buy:custom';
    else if (action === 'buy' && p2 === 'settings') data = 'settings:buy_settings';
    else if (action === 'buy' && p2 === 'preset') data = `buy:preset:${parts[3]}`;
    else if (action === 'sell' && p2 === 'select') data = `sell:pos:${parts[3]}`;
    else if (action === 'sell' && p2 === 'preset') data = `sell:pct:${parts[3]}`;
    else if (action === 'sell' && p2 === 'custom') data = 'sell:custom';
    else if (action === 'sell' && p2 === 'execute') data = 'sell:execute';
    else if (action === 'sell' && p2 === 'confirm') data = 'sell:confirm';
    else if (action === 'sell' && p2 === 'cancel') data = 'sell:cancel';
    else if (action === 'sell' && p2 === 'settings') data = 'settings:sell_settings';
    else if (action === 'set' && p2 === 'confirm' && parts[3]) data = `settings:toggle:confirm`;
    else if (action === 'set' && p2 === 'shield' && parts[3]) data = 'settings:toggle:mev_protect_buys';
    else if (action === 'set' && p2 === 'mode' && parts[3] === 'normal') data = 'settings:exec:normal';
    else if (action === 'set' && p2 === 'mode' && parts[3] === 'fast') data = 'settings:exec:fast';
    else if (action === 'set' && p2 === 'mode' && parts[3] === 'turbo') data = 'settings:exec:turbo';
    else if (action === 'set' && p2 === 'mode' && parts[3] === 'custom') data = 'settings:fee';
    else if (action === 'set' && p2 === 'shield' && parts[3] === 'on') data = 'settings:set:shield:on';
    else if (action === 'set' && p2 === 'shield' && parts[3] === 'off') data = 'settings:set:shield:off';
    else if (action === 'set' && p2 === 'confirm' && parts[3] === 'on') data = 'settings:set:confirm:on';
    else if (action === 'set' && p2 === 'confirm' && parts[3] === 'off') data = 'settings:set:confirm:off';
    else if (action === 'orders' && p2 === 'limit') data = 'menu:limit_orders';
    else if (action === 'orders' && p2 === 'dca') data = 'menu:dca_orders';
    else if (action === 'sniper' && p2 === 'auto') data = 'menu:sniper';
    else if (action === 'copy' && p2 === 'list') data = 'menu:copy';
    else if (action === 'wallet' && p2 === 'withdraw') data = 'menu:withdraw';
    else if (action === 'wallet' && p2 === 'switch' && parts.length > 3) data = `wallet:select:${parts[3]}`;
    else if (action === 'wallet' && p2 === 'switch') data = 'menu:wallets';
  }
  await writeAudit(userId, 'telegram.callback', { rawData, normalized: data });
  try {
    if (data === 'menu:main') {
      await ctx.answerCbQuery();
      return renderMainMenu(ctx, userId);
    }
    if (data === 'menu:buy') {
      setScreen(userId, 'SCREEN_BUY_INPUT');
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
      // request quote using current buy slippage
      const tsr = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const tsj: any = await tsr.json();
      const slippageBps = Number(tsj?.settings?.buy_slippage_bps ?? 100);
      const qres = await fetch(`${API_BASE}/terminal/buy/quote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputMint: 'SOL', outputMint: s.data.mint, amount_usd: amt, slippageBps })
      });
      const qjson: any = await qres.json();
      s.data.quote = qjson.quote;
      await writeAudit(userId, 'telegram.buy.quote', { quote: qjson.quote, slippageBps });
      return ctx.reply(`Quote: expectedOut=${qjson.quote.expectedOut}, fees=${qjson.quote.fees}, slippage=${slippageBps}bps. Send PIN to confirm or 'cancel'.`);
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
      setScreen(userId, 'SCREEN_POSITIONS');
      // trigger sell command flow
      await ctx.answerCbQuery();
      return (bot as any).handleUpdate({ message: { text: '/sell', from: cb.from, chat: cb.message?.chat } } as any, ctx.telegram);
    }
    if (data.startsWith('sell:pct:')) {
      await ctx.answerCbQuery();
      const s = sessions.get(userId);
      if (!s || s.step !== 'SELL_PERCENT') return ctx.reply('Session expired. Start /sell again.');
      s.data.percent = Number(data.split(':')[2]);
      s.step = 'SELL_CONFIRM';
      sessions.set(userId, s);
      return ctx.reply(`Confirm sell ${s.data.percent}%? Reply with PIN to execute or 'cancel'.`);
    }
    if (data === 'sell:custom') {
      await ctx.answerCbQuery();
      const s = sessions.get(userId);
      if (!s) return ctx.reply('Session expired. Start /sell again.');
      s.step = 'SELL_PERCENT';
      sessions.set(userId, s);
      return ctx.reply('Enter sell percent (1-100):');
    }
    if (data === 'sell:cancel') {
      await ctx.answerCbQuery();
      sessions.delete(userId);
      return ctx.reply('Sell cancelled.');
    }
    if (data === 'menu:positions') {
      setScreen(userId, 'SCREEN_POSITIONS');
      await ctx.answerCbQuery();
      // show positions inline list
      const r = await fetch(`${API_BASE}/terminal/positions/${userId}`);
      const j = await r.json();
      const positions = j.positions || [];
      if (positions.length === 0) return ctx.reply('No open positions');
      for (const p of positions) {
        const btns = Markup.inlineKeyboard([
          [Markup.button.callback('Sell', `sell:pos:${p.id}`), Markup.button.callback('Details', `pos:detail:${p.id}`)],
          [Markup.button.callback('🖼 PnL Card', `pnl:card:${p.id}`)]
        ]);
        await ctx.reply(`Position ${p.mint} qty=${p.qty} entry=${p.entry_price}`, btns as any);
      }
      return;
    }

    if (data.startsWith('pos:detail:')) {
      await ctx.answerCbQuery();
      const id = data.split(':')[2];
      const r = await fetch(`${API_BASE}/positions/${id}`);
      const j: any = await r.json();
      const p = j?.position;
      if (!p) return ctx.reply('Position details unavailable.');
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Sell', `sell:pos:${p.id}`), Markup.button.callback('🖼 PnL Card', `pnl:card:${p.id}`)],
        [Markup.button.callback('← Back to Positions', 'menu:positions')]
      ]);
      return ctx.reply(`Position Details
Mint: ${p.mint}
Qty: ${p.qty}
Entry: ${p.entry_price}
PnL USD: ${p.pnl_usd ?? 0}`, kb as any);
    }

    if (data.startsWith('pnl:card:')) {
      await ctx.answerCbQuery();
      const id = data.split(':')[2];
      return sendPnlCard(ctx, userId, id);
    }
    if (data === 'menu:limit_orders') {
      setScreen(userId, 'SCREEN_LIMIT_ORDERS');
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/orders/${userId}`);
      const j = await r.json();
      const orders = (j.orders || []).filter((o: any) => o.type === 'limit');
      const topKb = Markup.inlineKeyboard([[Markup.button.callback('Create Limit', 'order:create_limit')]]);
      if (orders.length === 0) return ctx.reply('No limit orders', topKb as any);
      await ctx.reply('Limit orders', topKb as any);
      for (const o of orders) {
        const btns = Markup.inlineKeyboard([[Markup.button.callback('Cancel', `order:cancel:${o.id}`)]]);
        await ctx.reply(`Limit ${o.id} mint=${o.mint} status=${o.status}`, btns as any);
      }
      return;
    }

    if (data === 'order:create_limit') {
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'LIMIT_MINT', data: {} });
      await writeAudit(userId, 'telegram.limit.start.inline', {});
      return ctx.reply('Create Limit Order\n\nSend token mint address:');
    }

    if (data === 'order:create_dca') {
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'DCA_MINT', data: {} });
      await writeAudit(userId, 'telegram.dca.start.inline', {});
      return ctx.reply('Create DCA Order\n\nSend token mint address:');
    }
    if (data === 'menu:dca_orders') {
      setScreen(userId, 'SCREEN_DCA_ORDERS');
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/orders/${userId}`);
      const j = await r.json();
      const orders = (j.orders || []).filter((o: any) => o.type === 'dca');
      const topKb = Markup.inlineKeyboard([[Markup.button.callback('Create DCA', 'order:create_dca')]]);
      if (orders.length === 0) return ctx.reply('No DCA orders', topKb as any);
      await ctx.reply('DCA orders', topKb as any);
      for (const o of orders) {
        const btns = Markup.inlineKeyboard([[Markup.button.callback('Cancel', `order:cancel:${o.id}`)]]);
        await ctx.reply(`DCA ${o.id} mint=${o.mint} status=${o.status}`, btns as any);
      }
      return;
    }
    if (data === 'menu:copy') {
      setScreen(userId, 'SCREEN_COPY_MAIN');
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'COPY_INPUT', data: {} });
      await writeAudit(userId, 'telegram.copy.start', {});
      return ctx.reply('Copy Trade — paste target author username or trade id to follow:');
    }
    if (data === 'menu:sniper') {
      setScreen(userId, 'SCREEN_SNIPER_MAIN');
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
      return renderWatchlist(ctx, userId);
    }
    if (data === 'menu:withdraw') {
      setScreen(userId, 'SCREEN_WITHDRAW_FLOW');
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
      return ctx.reply(buildHelpText());
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
      setScreen(userId, 'SCREEN_WALLET_MAIN');
      await ctx.answerCbQuery();
      return renderWalletMenu(ctx, userId);
    }

    if (data === 'menu:wallet_create') {
      await ctx.answerCbQuery();
      const resp = await fetch(`${API_BASE}/wallets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, label: 'W' + Date.now().toString().slice(-4), set_active: true })
      });
      const out: any = await resp.json();
      if (resp.status !== 200) return ctx.reply('Wallet create failed: ' + JSON.stringify(out));
      await writeAudit(userId, 'telegram.wallet.create.inline', { walletId: out.walletId, pubkey: out.pubkey });
      await ctx.reply(`Created Solana wallet ${out.pubkey}`);
      return renderWalletMenu(ctx, userId);
    }

    if (data === 'menu:wallet_import') {
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'WALLET_IMPORT_TYPE', data: {} });
      return ctx.reply('Import Solana wallet: send "private_key" or "mnemonic".');
    }
    if (data === 'menu:settings') {
      setScreen(userId, 'SCREEN_SETTINGS_MAIN');
      await ctx.answerCbQuery();
      return renderSettingsMenu(ctx, userId);
    }

    // Buy settings submenu
    if (data === 'settings:buy_settings') {
      setScreen(userId, 'SCREEN_BUY_SETTINGS');
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const j = await r.json();
      const current = j.settings || { presets_json: null, buy_slippage_bps: 1500 };
      const intro = [
        'Buy Amounts:',
        'Click a button to set your default SOL buy amount.',
        '',
        'Buy Slippage:',
        'Changing slippage applies to your next buys.'
      ].join('\n');
      const presetButtons = Markup.inlineKeyboard([
        [Markup.button.callback('0.5 SOL ✏️', `settings:set:buy_amount:0.5`), Markup.button.callback('1 SOL ✏️', `settings:set:buy_amount:1`), Markup.button.callback('3 SOL ✏️', `settings:set:buy_amount:3`)],
        [Markup.button.callback('5 SOL ✏️', `settings:set:buy_amount:5`), Markup.button.callback('10 SOL ✏️', `settings:set:buy_amount:10`)],
        [Markup.button.callback(`Buy Slippage: ${Number(current.buy_slippage_bps || 1500)/100}% ✏️`, 'settings:buy_slippage_menu')],
        [Markup.button.callback('← Back', 'menu:settings')]
      ]);
      await ctx.reply(intro, presetButtons as any);
      return;
    }

    // Sell settings submenu
    if (data === 'settings:sell_settings') {
      setScreen(userId, 'SCREEN_SELL_SETTINGS');
      await ctx.answerCbQuery();
      const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
      const j = await r.json();
      const current = j.settings || { presets_json: null, sell_slippage_bps: 1500 };
      const intro = [
        'Sell Amounts:',
        'Set your default quick-sell percentage presets.',
        '',
        'Sell Slippage:',
        'Changing slippage applies to your next sells.'
      ].join('\n');
      const presetButtons = Markup.inlineKeyboard([
        [Markup.button.callback('25% ✏️', `settings:set:sell_pct:25`), Markup.button.callback('50% ✏️', `settings:set:sell_pct:50`)],
        [Markup.button.callback('75% ✏️', `settings:set:sell_pct:75`), Markup.button.callback('100% ✏️', `settings:set:sell_pct:100`)],
        [Markup.button.callback(`Sell Slippage: ${Number(current.sell_slippage_bps || 1500)/100}% ✏️`, 'settings:sell_slippage_menu')],
        [Markup.button.callback('← Back', 'menu:settings')]
      ]);
      await ctx.reply(intro, presetButtons as any);
      return;
    }

    if (data === 'settings:buy_slippage_menu') {
      setScreen(userId, 'SCREEN_BUY_SLIPPAGE');
      await ctx.answerCbQuery();
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('5%', 'settings:set:buy_slippage:500'), Markup.button.callback('10%', 'settings:set:buy_slippage:1000'), Markup.button.callback('15%', 'settings:set:buy_slippage:1500')],
        [Markup.button.callback('20%', 'settings:set:buy_slippage:2000'), Markup.button.callback('25%', 'settings:set:buy_slippage:2500')],
        [Markup.button.callback('← Back', 'settings:buy_settings')]
      ]);
      return ctx.reply('Choose Buy Slippage', kb as any);
    }

    if (data === 'settings:sell_slippage_menu') {
      setScreen(userId, 'SCREEN_SELL_SLIPPAGE');
      await ctx.answerCbQuery();
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('5%', 'settings:set:sell_slippage:500'), Markup.button.callback('10%', 'settings:set:sell_slippage:1000'), Markup.button.callback('15%', 'settings:set:sell_slippage:1500')],
        [Markup.button.callback('20%', 'settings:set:sell_slippage:2000'), Markup.button.callback('25%', 'settings:set:sell_slippage:2500')],
        [Markup.button.callback('← Back', 'settings:sell_settings')]
      ]);
      return ctx.reply('Choose Sell Slippage', kb as any);
    }

    // navigate back to main menu
    if (data === 'menu:back') {
      await ctx.answerCbQuery();
      return navigateBack(ctx, userId);
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
      return renderSettingsMenu(ctx, userId);
    }

    if (data.startsWith('settings:set:shield:')) {
      await ctx.answerCbQuery();
      const desired = data.endsWith(':on');
      await saveTerminalSettings(userId, { shield_enabled: desired }, { mev_protect_buys: desired });
      await writeAudit(userId, 'telegram.settings.shield.set', { shield_enabled: desired });
      return renderSettingsMenu(ctx, userId);
    }

    if (data.startsWith('settings:set:confirm:')) {
      await ctx.answerCbQuery();
      const desired = data.endsWith(':on');
      await saveTerminalSettings(userId, { confirm_trades: desired });
      await writeAudit(userId, 'telegram.settings.confirm.set', { confirm_trades: desired });
      return renderSettingsMenu(ctx, userId);
    }

    if (data === 'settings:fee') {
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'FEE_INPUT', data: {} });
      return ctx.reply('Enter priority fee in SOL (e.g. 0.0015) or type 0 to clear:');
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
    if (data === 'watchlist:refresh') {
      await ctx.answerCbQuery();
      return renderWatchlist(ctx, userId);
    }
    if (data.startsWith('watchlist:remove:')) {
      await ctx.answerCbQuery();
      const parts = data.split(':');
      const mint = parts[2];
      await fetch(`${API_BASE}/watchlist/${userId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mint }) });
      await writeAudit(userId, 'telegram.watchlist.remove', { mint });
      await ctx.reply(`Removed ${mint} from watchlist`);
      return renderWatchlist(ctx, userId);
    }

    if (data.startsWith('settings:lang:')) {
      await ctx.answerCbQuery('English selected');
      await writeAudit(userId, 'telegram.settings.language', { language: 'en' });
      return ctx.reply('Language set to English 🇬🇧');
    }

    // wallet select
    if (data.startsWith('wallet:select:')) {
      const parts = data.split(':');
      const wid = parts[2];
      const s = sessions.get(userId) || { step: 'IDLE', data: {} };
      s.data = s.data || {};
      await fetch(`${API_BASE}/wallets/${wid}/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) });
      s.data.selectedWallet = wid;
      s.step = 'BUY_INPUT';
      sessions.set(userId, s);
      await ctx.answerCbQuery('Wallet selected');
      await writeAudit(userId, 'telegram.wallet.select', { wallet: wid });
      return ctx.reply('Selected and activated wallet. Now paste token mint address:');
    }

    if (data === 'sell:execute' || data === 'sell:confirm') {
      await ctx.answerCbQuery();
      const s = sessions.get(userId);
      if (!s || s.step !== 'SELL_CONFIRM') return ctx.reply('Sell session expired. Start /sell again.');
      return ctx.reply('Send your PIN to execute this sell, or type cancel.');
    }

    // sell by callback (start percent prompt)
    if (data.startsWith('sell:pos:')) {
      const parts = data.split(':');
      const pid = parts[2];
      const r = await fetch(`${API_BASE}/terminal/positions/${userId}`);
      const j: any = await r.json();
      const positions = (j.positions || []).filter((p: any) => p.id === pid);
      if (positions.length === 0) {
        await ctx.answerCbQuery();
        return ctx.reply('Position not found. Use /sell to refresh positions.');
      }
      const state = { step: 'SELL_CHOOSE_POS', data: { positions } } as any;
      sessions.set(userId, state);
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

    if (data === 'settings:pnls') {
      await ctx.answerCbQuery();
      return renderPnlCardsMenu(ctx, userId);
    }

    if (data.startsWith('settings:pnls:toggle:')) {
      await ctx.answerCbQuery();
      const key = data.split(':')[3];
      const { prefs } = await fetchTerminalSettings(userId);
      await saveTerminalSettings(userId, {}, { [key]: !prefs[key] });
      await writeAudit(userId, 'telegram.settings.pnls.toggle', { [key]: !prefs[key] });
      return renderPnlCardsMenu(ctx, userId);
    }

    if (data === 'settings:account_security') {
      setScreen(userId, 'SCREEN_SECURITY_MAIN');
      await ctx.answerCbQuery();
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback('Set PIN', 'security:pin:set'), Markup.button.callback('Change PIN', 'security:pin:change')],
        [Markup.button.callback('Verify PIN', 'security:pin:verify')],
        [Markup.button.callback('← Back', 'menu:settings')]
      ]);
      return ctx.reply(buildSettingsHelpText(), kb as any);
    }

    if (data === 'security:pin:set') {
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'SECURITY_PIN_SET', data: {} });
      return ctx.reply('Enter new PIN (4-12 digits):');
    }

    if (data === 'security:pin:change') {
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'SECURITY_PIN_CHANGE_OLD', data: {} });
      return ctx.reply('Enter current PIN:');
    }

    if (data === 'security:pin:verify') {
      await ctx.answerCbQuery();
      sessions.set(userId, { step: 'SECURITY_PIN_VERIFY', data: {} });
      return ctx.reply('Enter PIN to verify:');
    }

    // generic settings toggles
    if (data.startsWith('settings:toggle:')) {
      const parts = data.split(':');
      const key = parts[2];
      await ctx.answerCbQuery();
      const { settings, prefs } = await fetchTerminalSettings(userId);
      if (key === 'confirm') {
        const next = !(settings.confirm_trades !== false);
        await saveTerminalSettings(userId, { confirm_trades: next });
        await writeAudit(userId, 'telegram.settings.toggle', { confirm_trades: next });
        return renderSettingsMenu(ctx, userId);
      }
      if (key === 'mev_protect_buys') {
        const next = !(settings.shield_enabled || prefs.mev_protect_buys);
        await saveTerminalSettings(userId, { shield_enabled: next }, { mev_protect_buys: next });
        await writeAudit(userId, 'telegram.settings.toggle', { shield_enabled: next, mev_protect_buys: next });
        return renderSettingsMenu(ctx, userId);
      }
      const next = !prefs[key];
      await saveTerminalSettings(userId, {}, { [key]: next });
      await writeAudit(userId, 'telegram.settings.toggle', { [key]: next });
      return renderSettingsMenu(ctx, userId);
    }

    // set buy/sell preset amounts and slippage
    if (data.startsWith('settings:set:buy_amount:') || data.startsWith('settings:set:sell_amount:') || data.startsWith('settings:set:sell_pct:') || data.startsWith('settings:set:buy_slippage:') || data.startsWith('settings:set:sell_slippage:')) {
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
      if (target === 'sell_pct') {
        prefs.sell_percent = Number(value);
        const updated = { ...current, presets_json: JSON.stringify(prefs) };
        await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        await writeAudit(userId, 'telegram.settings.sell_percent', { value: prefs.sell_percent });
        return ctx.reply(`Default sell quick amount set to ${prefs.sell_percent}%`);
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

bot.command('wallet_create', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const parts = ctx.message.text.trim().split(/\s+/);
  const label = parts.slice(1).join(' ') || 'wallet';
  const r = await fetch(`${API_BASE}/wallets`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, label, set_active: true })
  });
  const j = await r.json();
  if (r.status !== 200) return ctx.reply('Wallet create failed: ' + JSON.stringify(j));
  await writeAudit(userId, 'telegram.wallet.create', { walletId: j.walletId, pubkey: j.pubkey });
  return ctx.reply(`Wallet created: ${j.pubkey} (id=${j.walletId})`);
});

bot.command('wallet_import', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) {
    sessions.set(userId, { step: 'WALLET_IMPORT_TYPE', data: {} });
    return ctx.reply('Choose import type: send "private_key" or "mnemonic".');
  }
  const importType = (parts[1] || '').toLowerCase();
  if (importType === 'private_key') {
    const value = parts.slice(2).join(' ').trim();
    if (!value) {
      sessions.set(userId, { step: 'WALLET_IMPORT_VALUE', data: { import_type: 'private_key' } });
      return ctx.reply('Send private key (base58/base64 or JSON array).');
    }
    const r = await fetch(`${API_BASE}/wallets/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, import_type: 'private_key', private_key: value, set_active: true })
    });
    const j = await r.json();
    if (r.status !== 200) return ctx.reply('Wallet import failed: ' + JSON.stringify(j));
    await writeAudit(userId, 'telegram.wallet.import', { import_type: 'private_key', walletId: j.walletId, pubkey: j.pubkey });
    return ctx.reply(`Wallet imported: ${j.pubkey} (id=${j.walletId})`);
  }
  if (importType === 'mnemonic') {
    const value = parts.slice(2).join(' ').trim();
    if (!value) {
      sessions.set(userId, { step: 'WALLET_IMPORT_VALUE', data: { import_type: 'mnemonic' } });
      return ctx.reply('Send mnemonic phrase (12 or 24 words).');
    }
    const r = await fetch(`${API_BASE}/wallets/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, import_type: 'mnemonic', mnemonic: value, set_active: true })
    });
    const j = await r.json();
    if (r.status !== 200) return ctx.reply('Wallet import failed: ' + JSON.stringify(j));
    await writeAudit(userId, 'telegram.wallet.import', { import_type: 'mnemonic', walletId: j.walletId, pubkey: j.pubkey });
    return ctx.reply(`Wallet imported: ${j.pubkey} (id=${j.walletId})`);
  }
  return ctx.reply('Usage: /wallet_import <private_key|mnemonic> <value>');
});

bot.command('limit', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 4) return ctx.reply('Usage: /limit <mint> <target_price> <amount_usd> [wallet_id]');
  const mint = parts[1];
  const target_price = Number(parts[2]);
  const amount_usd = Number(parts[3]);
  const wallet_id = parts[4] || null;
  const r = await fetch(`${API_BASE}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, wallet_id, type: 'limit', mint, params: { target_price, amount_usd } })
  });
  const j = await r.json();
  if (r.status !== 200) return ctx.reply('Limit create failed: ' + JSON.stringify(j));
  await writeAudit(userId, 'telegram.limit.create', { id: j.id, mint, target_price, amount_usd });
  return ctx.reply(`Limit order created: ${j.id}`);
});

bot.command('dca', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 4) return ctx.reply('Usage: /dca <mint> <amount_usd> <interval_minutes> [wallet_id]');
  const mint = parts[1];
  const amount_usd = Number(parts[2]);
  const interval_minutes = Number(parts[3]);
  const wallet_id = parts[4] || null;
  const r = await fetch(`${API_BASE}/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, wallet_id, type: 'dca', mint, params: { amount_usd, interval_minutes } })
  });
  const j = await r.json();
  if (r.status !== 200) return ctx.reply('DCA create failed: ' + JSON.stringify(j));
  await writeAudit(userId, 'telegram.dca.create', { id: j.id, mint, amount_usd, interval_minutes });
  return ctx.reply(`DCA order created: ${j.id}`);
});

// Wallet commands: /wallets to list and select
bot.command('wallets', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const r = await fetch(`${API_BASE}/wallets/${userId}`);
  const j = await r.json();
  const wallets = j.wallets || [];
  if (wallets.length === 0) return ctx.reply('No Solana wallets found. Use /wallet_create or /wallet_import.');
  let msg = 'Your Solana wallets:\n';
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

  async function loadTerminalSettings() {
    const r = await fetch(`${API_BASE}/terminal/settings/${userId}`);
    const j = await r.json();
    const settings = j.settings || {};
    const prefs = settings.presets_json ? (typeof settings.presets_json === 'string' ? JSON.parse(settings.presets_json) : settings.presets_json) : {};
    return { settings, prefs };
  }


  if (s.step === 'WALLET_IMPORT_TYPE') {
    const t = text.toLowerCase();
    if (t !== 'private_key' && t !== 'mnemonic') return ctx.reply('Send either "private_key" or "mnemonic"');
    s.step = 'WALLET_IMPORT_VALUE';
    s.data.import_type = t;
    sessions.set(userId, s);
    return ctx.reply(t === 'private_key' ? 'Send private key (base58/base64 or JSON array).' : 'Send mnemonic phrase (12 or 24 words).');
  }

  if (s.step === 'WALLET_IMPORT_VALUE') {
    const import_type = s.data.import_type;
    const payload: any = { user_id: userId, import_type, set_active: true };
    if (import_type === 'private_key') payload.private_key = text;
    else payload.mnemonic = text;
    const r = await fetch(`${API_BASE}/wallets/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const j = await r.json();
    if (r.status !== 200) return ctx.reply('Wallet import failed: ' + JSON.stringify(j));
    sessions.delete(userId);
    await writeAudit(userId, 'telegram.wallet.import', { import_type, walletId: j.walletId, pubkey: j.pubkey });
    return ctx.reply(`Wallet imported: ${j.pubkey} (id=${j.walletId})`);
  }

  if (s.step === 'LIMIT_MINT') {
    s.data.mint = text;
    s.step = 'LIMIT_TARGET';
    sessions.set(userId, s);
    return ctx.reply('Send target price (number):');
  }

  if (s.step === 'LIMIT_TARGET') {
    const v = Number(text);
    if (isNaN(v) || v <= 0) return ctx.reply('Invalid target price');
    s.data.target_price = v;
    s.step = 'LIMIT_AMOUNT';
    sessions.set(userId, s);
    return ctx.reply('Send amount_usd (>=10):');
  }

  if (s.step === 'LIMIT_AMOUNT') {
    const amount = Number(text);
    if (isNaN(amount) || amount < 10) return ctx.reply('Invalid amount (min 10)');
    const payload = { user_id: userId, wallet_id: s.data.selectedWallet || null, type: 'limit', mint: s.data.mint, params: { target_price: s.data.target_price, amount_usd: amount } };
    const r = await fetch(`${API_BASE}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json();
    sessions.delete(userId);
    if (r.status !== 200) return ctx.reply('Limit create failed: ' + JSON.stringify(j));
    await writeAudit(userId, 'telegram.limit.create', { id: j.id, mint: s.data.mint, target_price: s.data.target_price, amount_usd: amount });
    return ctx.reply(`Limit order created: ${j.id}`);
  }

  if (s.step === 'DCA_MINT') {
    s.data.mint = text;
    s.step = 'DCA_AMOUNT';
    sessions.set(userId, s);
    return ctx.reply('Send amount_usd (>=10):');
  }

  if (s.step === 'DCA_AMOUNT') {
    const amount = Number(text);
    if (isNaN(amount) || amount < 10) return ctx.reply('Invalid amount (min 10)');
    s.data.amount_usd = amount;
    s.step = 'DCA_INTERVAL';
    sessions.set(userId, s);
    return ctx.reply('Send interval_minutes (e.g. 60):');
  }

  if (s.step === 'DCA_INTERVAL') {
    const interval = Number(text);
    if (isNaN(interval) || interval <= 0) return ctx.reply('Invalid interval');
    const payload = { user_id: userId, wallet_id: s.data.selectedWallet || null, type: 'dca', mint: s.data.mint, params: { amount_usd: s.data.amount_usd, interval_minutes: interval } };
    const r = await fetch(`${API_BASE}/orders`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json();
    sessions.delete(userId);
    if (r.status !== 200) return ctx.reply('DCA create failed: ' + JSON.stringify(j));
    await writeAudit(userId, 'telegram.dca.create.inline', { id: j.id, mint: s.data.mint, amount_usd: s.data.amount_usd, interval_minutes: interval });
    return ctx.reply(`DCA order created: ${j.id}`);
  }

  if (s.step === 'BUY_INPUT') {
    s.data.mint = text;
    s.step = 'BUY_PANEL';
    sessions.set(userId, s);
    await writeAudit(userId, 'telegram.buy.mint', { mint: text });
    try {
      const { settings, prefs } = await loadTerminalSettings();
      const presets: number[] = prefs.buy_presets || (prefs.buy_amount ? [prefs.buy_amount] : []);
      const buttons: any[] = [];
      for (const p of presets) buttons.push([Markup.button.callback(`${p} USD`, `buy:preset:${p}`)]);
      buttons.push([Markup.button.callback('Custom amount', 'buy:custom'), Markup.button.callback('Enter manually', 'buy:manual')]);
      const kb = Markup.inlineKeyboard(buttons);
      return ctx.reply(`Select amount. Settings: slippage=${settings.buy_slippage_bps ?? 100}bps mode=${settings.exec_mode || 'Normal'} shield=${!!settings.shield_enabled} confirm=${settings.confirm_trades ?? true}`, kb as any);
    } catch {
      return ctx.reply('Enter buy amount in USD:');
    }
  }

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
    try {
      const estRes = await fetch(`${API_BASE}/wallets/${s.data.wallet_id}/estimate?amount_usd=${encodeURIComponent(s.data.amount_usd)}`);
      const est = await estRes.json();
      let msg = `Destination: ${dest}\nAmount (USD): ${s.data.amount_usd}\nEstimated SOL: ${est.solAmount?.toFixed ? est.solAmount.toFixed(6) : est.solAmount} SOL\nFee buffer: ${est.feeBufferSol} SOL`;
      if (est.balance_sol !== null) msg += `\nWallet balance: ${est.balance_sol.toFixed(6)} SOL (~$${est.balance_usd?.toFixed(2)})`;
      s.step = 'WITHDRAW_CONFIRM';
      sessions.set(userId, s);
      await writeAudit(userId, 'telegram.withdraw.dest', { destination: dest, estimate: est });
      return ctx.reply(msg + '\n\nSend PIN to confirm withdrawal or type cancel');
    } catch {
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
    await fetch(`${API_BASE}/wallets/${w.id}/activate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) });
    s.data.selectedWallet = w.id;
    s.step = 'BUY_INPUT';
    sessions.set(userId, s);
    await writeAudit(userId, 'telegram.wallets.choose', { wallet: w.id });
    return ctx.reply('Selected and activated wallet. Now paste token mint address:');
  }

  if (s.step === 'BUY_PANEL') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return ctx.reply('Invalid amount');
    s.data.amount_usd = amount;
    const { settings } = await loadTerminalSettings();
    const slippage = Number(settings.buy_slippage_bps ?? 100);
    const qres = await fetch(`${API_BASE}/terminal/buy/quote`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputMint: 'SOL', outputMint: s.data.mint, amount_usd: amount, slippageBps: slippage })
    });
    const qjson = await qres.json();
    s.data.quote = qjson.quote;
    s.step = 'BUY_CONFIRM';
    sessions.set(userId, s);
    await writeAudit(userId, 'telegram.buy.quote', { quote: qjson.quote, slippage_bps: slippage });
    return ctx.reply(`Quote: expectedOut=${qjson.quote.expectedOut}, fees=${qjson.quote.fees}, slippage=${slippage}bps. Send PIN to confirm or 'cancel'.`);
  }

  if (s.step === 'COPY_INPUT') {
    const parts = text.split(/\s+/);
    const source = parts[0];
    const amount = Number(parts[1] || 0);
    try {
      const resp = await fetch(`${API_BASE}/copy_trade`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, source, amount_usd: amount || undefined }) });
      const j = await resp.json();
      await writeAudit(userId, 'telegram.copy.create', { id: j.id, source, amount_usd: amount || null });
      sessions.delete(userId);
      return ctx.reply(`Copy trade started (id=${j.id}).`);
    } catch {
      sessions.delete(userId);
      return ctx.reply('Failed to start copy trade');
    }
  }

  if (s.step === 'FEE_INPUT') {
    const v = parseFloat(text);
    if (isNaN(v) || v < 0) return ctx.reply('Invalid fee');
    try {
      const { settings, prefs } = await loadTerminalSettings();
      prefs.priority_fee = v;
      const updated = { ...settings, presets_json: JSON.stringify(prefs) };
      await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
      await writeAudit(userId, 'telegram.settings.fee', { fee: v });
      sessions.delete(userId);
      await ctx.reply(`Priority fee set to ${v} SOL`);
      return renderSettingsMenu(ctx, userId);
    } catch {
      sessions.delete(userId);
      return ctx.reply('Failed to save fee override');
    }
  }

  if (s.step === 'WATCHLIST_ADD') {
    const mint = text.trim();
    if (!mint) return ctx.reply('Invalid mint');
    try {
      await fetch(`${API_BASE}/watchlist/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mint }) });
      await writeAudit(userId, 'telegram.watchlist.add', { mint });
      sessions.delete(userId);
      await ctx.reply(`Added ${mint} to watchlist`);
      return renderWatchlist(ctx, userId);
    } catch {
      sessions.delete(userId);
      return ctx.reply('Failed to add to watchlist');
    }
  }

  if (s.step === 'SECURITY_PIN_SET') {
    if (!/^\d{4,12}$/.test(text)) return ctx.reply('PIN must be 4-12 digits.');
    const r = await fetch(`${API_BASE}/security/pin/set`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, pin: text })
    });
    const j = await r.json();
    if (r.status !== 200) return ctx.reply('PIN set failed: ' + JSON.stringify(j));
    sessions.delete(userId);
    await writeAudit(userId, 'telegram.security.set', {});
    await ctx.reply('PIN set successfully ✅');
    return renderSettingsMenu(ctx, userId);
  }

  if (s.step === 'SECURITY_PIN_CHANGE_OLD') {
    if (!/^\d{4,12}$/.test(text)) return ctx.reply('Current PIN must be 4-12 digits.');
    s.data.old_pin = text;
    s.step = 'SECURITY_PIN_CHANGE_NEW';
    sessions.set(userId, s);
    return ctx.reply('Enter new PIN (4-12 digits):');
  }

  if (s.step === 'SECURITY_PIN_CHANGE_NEW') {
    if (!/^\d{4,12}$/.test(text)) return ctx.reply('New PIN must be 4-12 digits.');
    const r = await fetch(`${API_BASE}/security/pin/change`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, old_pin: s.data.old_pin, new_pin: text })
    });
    const j = await r.json();
    if (r.status !== 200) return ctx.reply('PIN change failed: ' + JSON.stringify(j));
    sessions.delete(userId);
    await writeAudit(userId, 'telegram.security.change', {});
    await ctx.reply('PIN changed successfully ✅');
    return renderSettingsMenu(ctx, userId);
  }

  if (s.step === 'SECURITY_PIN_VERIFY') {
    if (!/^\d{4,12}$/.test(text)) return ctx.reply('PIN must be 4-12 digits.');
    const r = await fetch(`${API_BASE}/security/pin/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, pin: text })
    });
    const j = await r.json();
    sessions.delete(userId);
    await writeAudit(userId, 'telegram.security.verify', { ok: !!j?.ok });
    await ctx.reply(j?.ok ? 'PIN verified ✅' : 'PIN invalid ❌');
    return renderSettingsMenu(ctx, userId);
  }

  if (s.step === 'BUY_CONFIRM') {
    if (text.toLowerCase() === 'cancel') {
      sessions.delete(userId);
      await writeAudit(userId, 'telegram.buy.cancel', {});
      return ctx.reply('Buy cancelled');
    }
    const pin = text;
    const idempotencyKey = 'tele:' + userId + ':' + Date.now();
    const { settings } = await loadTerminalSettings();
    const payload: any = {
      user_id: userId,
      wallet_id: s.data.selectedWallet || null,
      mint: s.data.mint,
      amount_usd: s.data.amount_usd,
      idempotency_key: idempotencyKey,
      slippage_bps: Number(settings.buy_slippage_bps ?? 100),
      exec_mode: settings.exec_mode || 'Normal',
      shield: !!settings.shield_enabled
    };
    if (settings.confirm_trades !== false) payload.pin = pin;
    const progress = await createExecutionProgress(ctx, '🟢 Buy Execution');
    await progress.edit(`🟢 Buy Execution
✅ Quoting...
⏳ Building...`);
    const execRes = await fetch(`${API_BASE}/terminal/buy/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    await progress.edit(`🟢 Buy Execution
✅ Quoting...
✅ Building...
⏳ Sending...`);
    const execJson = await execRes.json();
    if (execRes.status !== 200) {
      await writeAudit(userId, 'telegram.buy.execute.failed', { err: execJson });
      sessions.delete(userId);
      await progress.edit(`🟢 Buy Execution
❌ Failed`);
      return ctx.reply('Buy failed: ' + JSON.stringify(execJson));
    }
    await progress.edit(`🟢 Buy Execution
✅ Quoting...
✅ Building...
✅ Sending...
⏳ Confirming...`);
    await writeAudit(userId, 'telegram.buy.execute', { tradeId: execJson.tradeId });
    sessions.delete(userId);
    await progress.edit(`🟢 Buy Execution
✅ Completed
Trade queued: ${execJson.tradeId}`);
    return ctx.reply(`Buy queued: tradeId=${execJson.tradeId}. Use /status ${execJson.tradeId} to check.`);
  }

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
    const aliases: any = { quarter: 25, half: 50, all: 100 };
    const pct = aliases[text.toLowerCase()] ?? parseFloat(text);
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
    const pin = text;
    const idempotencyKey = 'tele:sell:' + userId + ':' + Date.now();
    const { settings } = await loadTerminalSettings();
    const payload: any = {
      user_id: userId,
      position_id: s.data.chosen.id,
      percent: s.data.percent,
      idempotency_key: idempotencyKey,
      slippage_bps: Number(settings.sell_slippage_bps ?? 100),
      exec_mode: settings.exec_mode || 'Normal',
      shield: !!settings.shield_enabled
    };
    if (settings.confirm_trades !== false) payload.pin = pin;
    const progress = await createExecutionProgress(ctx, '🔴 Sell Execution');
    await progress.edit(`🔴 Sell Execution
✅ Quoting...
⏳ Building...`);
    const execRes = await fetch(`${API_BASE}/terminal/sell/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    await progress.edit(`🔴 Sell Execution
✅ Quoting...
✅ Building...
⏳ Sending...`);
    const execJson = await execRes.json();
    if (execRes.status !== 200) {
      await writeAudit(userId, 'telegram.sell.execute.failed', { err: execJson });
      sessions.delete(userId);
      await progress.edit(`🔴 Sell Execution
❌ Failed`);
      return ctx.reply('Sell failed: ' + JSON.stringify(execJson));
    }
    await progress.edit(`🔴 Sell Execution
✅ Quoting...
✅ Building...
✅ Sending...
⏳ Confirming...`);
    await writeAudit(userId, 'telegram.sell.execute', { tradeId: execJson.tradeId });
    sessions.delete(userId);
    await progress.edit(`🔴 Sell Execution
✅ Completed
Trade queued: ${execJson.tradeId}`);
    return ctx.reply(`Sell queued: tradeId=${execJson.tradeId}. Use /status ${execJson.tradeId} to check.`);
  }

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
      try {
        const { settings, prefs } = await loadTerminalSettings();
        prefs.buy_presets = prefs.buy_presets || [];
        if (!prefs.buy_presets.includes(s.data.amount_usd)) prefs.buy_presets.push(s.data.amount_usd);
        const updated = { ...settings, presets_json: JSON.stringify(prefs) };
        await fetch(`${API_BASE}/terminal/settings/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) });
        await writeAudit(userId, 'telegram.buy.preset_saved', { amount: s.data.amount_usd });
        s.step = 'BUY_CONFIRM';
        sessions.set(userId, s);
        return ctx.reply(`Saved preset ${s.data.amount_usd} and ready. Send PIN to confirm buy.`);
      } catch {
        return ctx.reply('Failed to save preset');
      }
    }
    const pin = text;
    const idempotencyKey = 'tele:' + userId + ':' + Date.now();
    const { settings } = await loadTerminalSettings();
    const payload: any = {
      user_id: userId,
      wallet_id: s.data.selectedWallet || null,
      mint: s.data.mint,
      amount_usd: s.data.amount_usd,
      idempotency_key: idempotencyKey,
      slippage_bps: Number(settings.buy_slippage_bps ?? 100),
      exec_mode: settings.exec_mode || 'Normal',
      shield: !!settings.shield_enabled
    };
    if (settings.confirm_trades !== false) payload.pin = pin;
    const progress = await createExecutionProgress(ctx, '🟢 Buy Execution');
    await progress.edit(`🟢 Buy Execution
✅ Quoting...
⏳ Building...`);
    const execRes = await fetch(`${API_BASE}/terminal/buy/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    await progress.edit(`🟢 Buy Execution
✅ Quoting...
✅ Building...
⏳ Sending...`);
    const execJson = await execRes.json();
    if (execRes.status !== 200) {
      await writeAudit(userId, 'telegram.buy.execute.failed', { err: execJson });
      sessions.delete(userId);
      await progress.edit(`🟢 Buy Execution
❌ Failed`);
      return ctx.reply('Buy failed: ' + JSON.stringify(execJson));
    }
    await progress.edit(`🟢 Buy Execution
✅ Quoting...
✅ Building...
✅ Sending...
⏳ Confirming...`);
    await writeAudit(userId, 'telegram.buy.execute', { tradeId: execJson.tradeId });
    sessions.delete(userId);
    await progress.edit(`🟢 Buy Execution
✅ Completed
Trade queued: ${execJson.tradeId}`);
    return ctx.reply(`Buy queued: tradeId=${execJson.tradeId}. Use /status ${execJson.tradeId} to check.`);
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
  const lines = positions.map((p: any, i: number) => `${i + 1}) ${p.mint} qty=${p.qty} entry=${p.entry_price} id=${p.id}`);
  await writeAudit(userId, 'telegram.positions', {});
  return ctx.reply('Open positions\n' + lines.join('\n') + '\n\nUse /pnlcard <position_id> to generate a card.');
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
  const parts = ctx.message.text.trim().split(/\s+/);
  const action = (parts[1] || '').toLowerCase();
  if (!action) return ctx.reply('Usage: /sniper <start|stop> [amount_usd] [slippage_bps] [fee] [autosell:true|false] [migration:true|false]');
  if (action === 'stop') {
    await fetch(`${API_BASE}/sniper/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) });
    await writeAudit(userId, 'telegram.sniper.stop', {});
    return ctx.reply('Sniper stopped');
  }
  const amount_usd = Number(parts[2] || 10);
  const slippage_bps = Number(parts[3] || 1500);
  const fee = Number(parts[4] || 0);
  const autosell = (parts[5] || 'false') === 'true';
  const migration = (parts[6] || 'false') === 'true';
  const profile = { amount_usd, slippage_bps, fee, autosell, migration };
  const resp = await fetch(`${API_BASE}/sniper/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, profile }) });
  const j = await resp.json();
  await writeAudit(userId, 'telegram.sniper.start', profile);
  return ctx.reply(`Sniper started: ${j.id || 'ok'} with ${JSON.stringify(profile)}`);
});

bot.command('copy', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) return ctx.reply('Usage: /copy <source_wallet_or_id> [amount_usd] [mint]');
  const source = parts[1];
  const amount_usd = Number(parts[2] || 0);
  const mint = parts[3] || null;
  const resp = await fetch(`${API_BASE}/copy_trade`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, source, amount_usd: amount_usd || undefined, mint })
  });
  const j = await resp.json();
  if (resp.status !== 200) return ctx.reply('Copy trade failed: ' + JSON.stringify(j));
  await writeAudit(userId, 'telegram.copy.create', { source, amount_usd, mint, id: j.id });
  return ctx.reply(`Copy trade created: ${j.id}`);
});

bot.command('wallet', async (ctx) => {
  return (bot as any).handleUpdate({ message: { text: '/wallets', from: ctx.from, chat: (ctx.message as any).chat } } as any, ctx.telegram);
});

bot.command('settings', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.settings.view', {});
  return renderSettingsMenu(ctx, userId);
});

bot.command('security', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const parts = ctx.message.text.trim().split(/\s+/);
  const action = (parts[1] || '').toLowerCase();
  if (!action) {
    await writeAudit(userId, 'telegram.security.view', {});
    return ctx.reply('Security commands:\n/security set <pin>\n/security change <old_pin> <new_pin>\n/security verify <pin>');
  }
  if (action === 'set') {
    const pin = parts[2];
    if (!pin) return ctx.reply('Usage: /security set <pin>');
    const r = await fetch(`${API_BASE}/security/pin/set`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, pin }) });
    const j = await r.json();
    if (r.status !== 200) return ctx.reply('PIN set failed: ' + JSON.stringify(j));
    await writeAudit(userId, 'telegram.security.set', {});
    return ctx.reply('PIN set successfully.');
  }
  if (action === 'change') {
    const old_pin = parts[2];
    const new_pin = parts[3];
    if (!old_pin || !new_pin) return ctx.reply('Usage: /security change <old_pin> <new_pin>');
    const r = await fetch(`${API_BASE}/security/pin/change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, old_pin, new_pin }) });
    const j = await r.json();
    if (r.status !== 200) return ctx.reply('PIN change failed: ' + JSON.stringify(j));
    await writeAudit(userId, 'telegram.security.change', {});
    return ctx.reply('PIN changed successfully.');
  }
  if (action === 'verify') {
    const pin = parts[2];
    if (!pin) return ctx.reply('Usage: /security verify <pin>');
    const r = await fetch(`${API_BASE}/security/pin/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId, pin }) });
    const j = await r.json();
    await writeAudit(userId, 'telegram.security.verify', { ok: !!j?.ok });
    return ctx.reply(j?.ok ? 'PIN verified ✅' : 'PIN invalid ❌');
  }
  return ctx.reply('Usage: /security <set|change|verify> ...');
});

bot.command('subscribe', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const parts = ctx.message.text.trim().split(/\s+/);
  const plan = parts[1] || null;
  if (!plan) {
    await writeAudit(userId, 'telegram.subscribe.view', {});
    return ctx.reply('Usage: /subscribe <meme|forex|bundle> [months]. Example: /subscribe bundle 1');
  }
  const months = Number(parts[2] || 1);
  const resp = await fetch(`${API_BASE}/subscriptions/activate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, plan, months, reference: `telegram:${userId}:${Date.now()}` })
  });
  const j = await resp.json();
  if (resp.status !== 200) return ctx.reply('Subscription activation failed: ' + JSON.stringify(j));
  await writeAudit(userId, 'telegram.subscribe.activate', { plan, months, active_until: j.active_until });
  return ctx.reply(`Activated ${plan} for ${months} month(s). Active until: ${j.active_until}`);
});

bot.command('pnlcard', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 2) return ctx.reply('Usage: /pnlcard <position_id> [svg|png] [neon|classic]');
  return sendPnlCard(ctx, userId, parts[1], parts[2], parts[3]);
});

bot.command('help', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.help', {});
  return ctx.reply(buildHelpText());
});

bot.command('watchlist', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  await writeAudit(userId, 'telegram.watchlist.view', {});
  return renderWatchlist(ctx, userId);
});

bot.command('meme', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const r = await fetch(`${API_BASE}/subscriptions/status/${userId}`);
  const j = await r.json();
  await writeAudit(userId, 'telegram.meme.view', { entitled: !!j?.entitlements?.meme_pro });
  if (!j?.entitlements?.meme_pro) return ctx.reply('Meme Pro inactive. Use /subscribe meme 1 or /subscribe bundle 1');
  return ctx.reply('Meme Pro active ✅ Use /launch and /pullback');
});

bot.command('forex', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const r = await fetch(`${API_BASE}/subscriptions/status/${userId}`);
  const j = await r.json();
  await writeAudit(userId, 'telegram.forex.view', { entitled: !!j?.entitlements?.forex_pro });
  if (!j?.entitlements?.forex_pro) return ctx.reply('Forex Pro inactive. Use /subscribe forex 1 or /subscribe bundle 1');
  return ctx.reply('Forex Pro active ✅ Use /bind <terminal_id> <token> [platform]');
});

bot.command('launch', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const r = await fetch(`${API_BASE}/subscriptions/status/${userId}`);
  const j = await r.json();
  if (!j?.entitlements?.meme_pro) return ctx.reply('Launch requires Meme Pro. Use /subscribe meme 1');
  const resp = await fetch(`${API_BASE}/sniper/start`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, profile: { mode: 'launch', enabled: true } })
  });
  const out = await resp.json();
  await writeAudit(userId, 'telegram.launch.start', out);
  return ctx.reply(`Launch sniper started: ${out.id || 'ok'}`);
});

bot.command('pullback', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const r = await fetch(`${API_BASE}/subscriptions/status/${userId}`);
  const j = await r.json();
  if (!j?.entitlements?.meme_pro) return ctx.reply('Pullback requires Meme Pro. Use /subscribe meme 1');
  await writeAudit(userId, 'telegram.pullback.start', {});
  return ctx.reply('Pullback mode set. (Engine-side adaptive pullback remains in progress.)');
});

bot.command('bind', async (ctx) => {
  const userId = String(ctx.from?.id || null);
  const parts = ctx.message.text.trim().split(/\s+/);
  if (parts.length < 3) return ctx.reply('Usage: /bind <terminal_id> <token> [platform]');
  const terminal_id = parts[1];
  const token = parts[2];
  const platform = parts[3] || 'mt5';
  const r = await fetch(`${API_BASE}/ea/bind`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, terminal_id, token, platform })
  });
  const j = await r.json();
  if (r.status !== 200) return ctx.reply('Bind failed: ' + JSON.stringify(j));
  await writeAudit(userId, 'telegram.bind.done', { terminal_id, platform });
  return ctx.reply(`EA terminal bound: ${terminal_id} (${platform})`);
});

async function launchBotWithRetry() {
  try {
    await bot.launch();
    console.log('Telegram bot started');
  } catch (err) {
    console.error('Telegram launch failed, retrying in 10s:', err);
    setTimeout(launchBotWithRetry, 10_000);
  }
}

launchBotWithRetry();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
