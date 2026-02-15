const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, '..', 'packages', 'shared', 'src', 'solana.ts');
const src = fs.readFileSync(p, 'utf8');
console.log('solana.ts size', src.length);
if (src.includes('getJupiterSwapTransactionFromQuote') && src.includes('getRaydiumSwapTransactionFromQuote')) {
  console.log('Smoke test: helpers present — OK');
  process.exit(0);
} else {
  console.error('Smoke test: helpers missing');
  process.exit(2);
}
