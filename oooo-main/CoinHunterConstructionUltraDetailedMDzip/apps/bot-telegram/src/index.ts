import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || '');

bot.start((ctx) => {
  ctx.reply('Welcome to Coin Hunter. Secure, Fast, Reliable Trading.', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💳 Wallets', callback_data: 'wallets' }, { text: '📈 Positions', callback_data: 'positions' }],
        [{ text: '🎯 Sniper', callback_data: 'sniper' }, { text: '⚙️ Settings', callback_data: 'settings' }]
      ]
    }
  });
});

bot.action('wallets', (ctx) => {
  ctx.reply('Wallet Management Section');
});

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
