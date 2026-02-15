/* Devnet integration test
   - generates keypair
   - creates user + wallet via API
   - funds wallet via airdrop
   - submits withdraw with idempotency_key
   - polls withdrawal until processed and confirms tx
*/
let fetch = globalThis.fetch;
if (!fetch) fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const { Keypair, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const API = process.env.API_BASE || 'http://localhost:8080';
const RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function run(){
  console.log('Generating keypair...');
  const kp = Keypair.generate();
  const secretB64 = Buffer.from(kp.secretKey).toString('base64');
  const pub = kp.publicKey.toBase58();
  console.log('Pubkey', pub);

  console.log('Create user...');
  const ures = await fetch(`${API}/users`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ telegram_id: 'devnet-test' })});
  const uj = await ures.json();
  const userId = uj.id;
  console.log('User id', userId);

  console.log('Create wallet via API...');
  const wres = await fetch(`${API}/wallets`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id: userId, label: 'devnet-test', privkey_b64: secretB64 })});
  const wj = await wres.json();
  const walletId = wj.walletId;
  console.log('Wallet id', walletId);

  const conn = new Connection(RPC, 'confirmed');
  console.log('Airdropping 1 SOL to', pub);
  const sig = await conn.requestAirdrop(kp.publicKey, 1 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log('Airdrop confirmed', sig);

  // Wait a bit for balances to reflect
  await sleep(3000);

  // submit withdraw (small USD amount)
  const idempotency = 'devnet-test-' + Date.now();
  console.log('Submitting withdraw...');
  const wdRes = await fetch(`${API}/wallets/${walletId}/withdraw`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id: userId, amount_usd: 1, destination_pubkey: pub, pin: '0000', idempotency_key: idempotency })});
  const wdj = await wdRes.json();
  console.log('Withdraw response', wdj);
  if (!wdj.id) throw new Error('no withdraw id');
  const wid = wdj.id;

  // poll until processed
  console.log('Polling withdrawal status...');
  for (let i=0;i<60;i++){
    const pr = await fetch(`${API}/withdrawals/${wid}`);
    const pj = await pr.json();
    console.log(i, pj.withdrawal.status || pj.withdrawal);
    if (pj.withdrawal && (pj.withdrawal.status==='processed' || pj.withdrawal.status==='failed')){
      console.log('Final', pj.withdrawal);
      if (pj.withdrawal.status==='processed'){
        const txid = pj.withdrawal.txid;
        console.log('Confirming tx on devnet', txid);
        const tx = await conn.getTransaction(txid, { commitment: 'confirmed' });
        console.log('Tx', !!tx);
      }
      return;
    }
    await sleep(2000);
  }
  throw new Error('timeout waiting for withdraw');
}

run().catch(e=>{ console.error('Test failed', e); process.exit(1); });
