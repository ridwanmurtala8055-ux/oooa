(// Use node-fetch import compatible form)
import fetch from 'node-fetch';
(async function(){
  const API = process.env.API_BASE || 'http://localhost:8080';
  console.log('Health ->', await (await fetch(`${API}/health`)).json());

  // create user
  const uRes = await fetch(`${API}/users`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({telegram_id: 'test-1'})});
  const uJson = await uRes.json();
  console.log('Created user', uJson);
  const userId = uJson.id;

  // Try buy with amount < 10
  const buyRes = await fetch(`${API}/terminal/buy/execute`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id: userId, wallet_id: null, mint: 'FAKE', amount_usd: 5, idempotency_key: 'test1', slippage_bps:100, exec_mode:'Normal', shield:false, pin: '0000' })});
  console.log('Buy <10 status', buyRes.status, await buyRes.json());

  // Try create limit order <10
  const ordRes = await fetch(`${API}/orders`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id: userId, wallet_id: null, type: 'limit', mint: 'FAKE', params: { amount_usd: 5, target_price: 1 } })});
  console.log('Order <10 status', ordRes.status, await ordRes.json());

  console.log('Tests finished');
})();
