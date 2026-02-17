#!/usr/bin/env node
const crypto = require('crypto');

function arg(name, fallback = '') {
  const p = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(p));
  return found ? found.slice(p.length) : fallback;
}

function rndHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function rndB64(bytes) {
  return crypto.randomBytes(bytes).toString('base64');
}

const botToken = arg('bot-token', 'replace_with_botfather_token');
const wallet = arg('wallet', 'replace_with_your_wallet_address');
const rpc = arg('rpc', 'https://api.devnet.solana.com');
const dbPass = arg('db-pass', rndB64(36));

const env = `# Generated .env (review before use)\n`
+ `DATABASE_URL=postgres://postgres:${dbPass}@localhost:5432/coinhunter\n`
+ `WALLET_MASTER_KEY=${rndHex(32)}\n`
+ `PIN_HASH_PEPPER=${rndHex(24)}\n`
+ `TELEGRAM_BOT_TOKEN=${botToken}\n`
+ `API_BASE=http://localhost:8080\n`
+ `SOLANA_CLUSTER=devnet\n`
+ `SOLANA_RPC_URL=${rpc}\n`
+ `USE_JUPITER=true\n`
+ `SHIELD_MODE=false\n`
+ `WITHDRAW_MIN_USD=10\n`
+ `WITHDRAW_FEE_BUFFER_SOL=0.001\n`
+ `EA_SHARED_SECRET=${rndB64(48)}\n`
+ `PAYMENT_RECEIVER_WALLET=${wallet}\n`;

console.log(env);
