import assert from 'assert';
import { encryptPrivateKey, decryptPrivateKey } from '../packages/shared/src/crypto';
import { hashPin, verifyPin } from '../packages/shared/src/security';

async function testCrypto() {
  const priv = Buffer.from('a secret key material');
  const aad = Buffer.from('wallet1:user1');
  const { ciphertext, iv, tag } = encryptPrivateKey(priv, aad);
  const dec = decryptPrivateKey(ciphertext, iv, tag, aad);
  assert.strictEqual(dec.toString(), priv.toString());
}

async function testPin() {
  const { hash, salt } = await hashPin('1234');
  const ok = await verifyPin('1234', salt, hash);
  assert.ok(ok, 'pin should verify');
}

(async () => {
  try {
    await testCrypto();
    console.log('crypto tests passed');
    await testPin();
    console.log('pin tests passed');
    console.log('All shared tests passed');
    process.exit(0);
  } catch (e) {
    console.error('tests failed', e);
    process.exit(1);
  }
})();
