// Integration smoke test for API Core endpoints.
(async function(){
  const API = process.env.API_BASE || 'http://localhost:8080';

  async function jfetch(path, opts) {
    const res = await fetch(`${API}${path}`, opts);
    const body = await res.json();
    return { status: res.status, body };
  }

  try {
    const health = await jfetch('/health');
    console.log('Health ->', health.body);

    const user = await jfetch('/users', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({telegram_id: 'test-1'})
    });
    console.log('Created user', user.body);
    if (user.status !== 200 || !user.body?.id) {
      throw new Error(`user_create_failed:${user.status}:${JSON.stringify(user.body)}`);
    }
    const userId = user.body.id;

    const buy = await jfetch('/terminal/buy/execute', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: userId, wallet_id: null, mint: 'FAKE', amount_usd: 5, idempotency_key: 'test1', slippage_bps:100, exec_mode:'Normal', shield:false, pin: '0000' })
    });
    console.log('Buy <10 status', buy.status, buy.body);

    const order = await jfetch('/orders', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user_id: userId, wallet_id: null, type: 'limit', mint: 'FAKE', params: { amount_usd: 5, target_price: 1 } })
    });
    console.log('Order <10 status', order.status, order.body);

    console.log('Tests finished');
  } catch (err) {
    console.error('Integration smoke test failed:', err.message || err);
    process.exit(1);
  }
})();
