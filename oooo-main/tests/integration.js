const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
(async function(){
  const API = process.env.API_BASE || 'http://localhost:8080';
  console.log('Pinging API health...');
  try {
    const h = await (await fetch(`${API}/health`)).json();
    console.log('Health:', h);
  } catch (e) {
    console.log('API not reachable at', API, ' - skipping integration calls');
    process.exit(0);
  }

  // Create a user
  const uRes = await fetch(`${API}/users`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({telegram_id: 'int-test'})});
  const u = await uRes.json();
  console.log('Created user:', u);
  const userId = u.id;

  // Activate subscription (demo)
  const sub = await (await fetch(`${API}/subscriptions/activate`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id: userId, plan: 'meme', months: 1 })})).json();
  console.log('Activated subscription:', sub);

  // Create meme candidate via admin
  const mc = await (await fetch(`${API}/admin/meme/candidates`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ mint: 'FAKE_MINT_123' })})).json();
  console.log('Created meme candidate:', mc);

  // Create a simple order and then cancel it to exercise notifications
  const ord = await (await fetch(`${API}/orders`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user_id: userId, wallet_id: null, type: 'limit', mint: 'FAKE', params: { amount_usd: 20, target_price: 1 } })})).json();
  console.log('Created order:', ord);
  // Cancel order
  const cancel = await (await fetch(`${API}/orders/${ord.id}/cancel`, {method:'POST'})).json();
  console.log('Cancelled order response:', cancel);

  console.log('Integration smoke tests complete. If API is running and DB reachable, actions were executed.');
  process.exit(0);
})();
