const nock = require('nock');
const { getJupiterSwapTransactionFromQuote } = require('../packages/shared/src/solana_helpers');

async function testDirectRoute() {
  const fakeTx = Buffer.from('deadbeef').toString('base64');
  const quote = { data: [{ swapTransaction: fakeTx }] };
  const res = await getJupiterSwapTransactionFromQuote(quote);
  if (res !== fakeTx) throw new Error('direct route extraction failed');
  console.log('direct route: OK');
}

async function testSwapEndpoint() {
  const fakeTx = Buffer.from('cafebabe').toString('base64');
  const api = 'https://quote-api.jup.ag';
  nock(api).post('/v6/swap').reply(200, { swapTransaction: fakeTx });
  // supply a route object that will trigger the POST
  const quote = { data: [{ route: { id: 'r' } }] };
  const res = await getJupiterSwapTransactionFromQuote(quote);
  if (res !== fakeTx) throw new Error('swap endpoint extraction failed');
  console.log('swap endpoint: OK');
}

async function run(){
  await testDirectRoute();
  await testSwapEndpoint();
  console.log('All Jupiter extraction tests passed');
}

run().catch(e=>{ console.error('Tests failed', e); process.exit(1); });
