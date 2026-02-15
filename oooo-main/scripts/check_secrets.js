#!/usr/bin/env node
const required = ['DATABASE_URL','WALLET_MASTER_KEY','PIN_HASH_PEPPER'];
const missing = required.filter(k=>!process.env[k]);
if(missing.length){
  console.error('Missing required env vars:', missing.join(','));
  process.exit(2);
}
console.log('All required env vars present');
process.exit(0);
