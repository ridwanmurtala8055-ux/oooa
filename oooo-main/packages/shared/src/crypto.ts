import crypto from 'crypto';
import { getMasterKey } from './kms';

function deriveKey(master: string) {
  return crypto.createHash('sha256').update(master).digest();
}

export function encryptPrivateKey(plaintext: Buffer, aad: Buffer) {
  const MASTER_KEY = process.env.WALLET_MASTER_KEY || null;
  const iv = crypto.randomBytes(12);
  const mk = MASTER_KEY || null;
  const key = mk ? deriveKey(mk) : deriveKey('please-set-a-secure-master-key-in-env');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, iv, tag };
}

export function decryptPrivateKey(ciphertext: Buffer, iv: Buffer, tag: Buffer, aad: Buffer) {
  const MASTER_KEY = process.env.WALLET_MASTER_KEY || null;
  const mk = MASTER_KEY || null;
  const key = mk ? deriveKey(mk) : deriveKey('please-set-a-secure-master-key-in-env');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(aad);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain;
}
