#!/usr/bin/env node
// Simple admin CLI to list and update withdrawals
const { Client } = require('pg');
const argv = require('minimist')(process.argv.slice(2));
const dbUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/coinhunter';
const client = new Client({ connectionString: dbUrl });
(async function(){
  await client.connect();
  const cmd = argv._[0] || 'list';
  if (cmd === 'list') {
    const r = await client.query('SELECT id,user_id,wallet_id,amount_usd,destination,status,txid,error,created_at FROM withdrawals ORDER BY created_at DESC LIMIT 100');
    console.table(r.rows);
  } else if (cmd === 'set') {
    const id = argv.id || argv.i;
    const status = argv.status || argv.s;
    if (!id || !status) { console.error('Usage: set --id <id> --status <status>'); process.exit(2); }
    await client.query('UPDATE withdrawals SET status=$1, processed_at=now() WHERE id=$2', [status, id]);
    console.log('Updated');
  } else {
    console.error('Unknown command');
  }
  await client.end();
  process.exit(0);
})();
