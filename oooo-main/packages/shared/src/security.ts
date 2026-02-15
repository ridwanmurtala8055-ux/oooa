import argon2 from 'argon2';
import crypto from 'crypto';

const PEPPER = process.env.PIN_HASH_PEPPER || '';

export async function hashPin(pin: string, salt?: string) {
  const perUserSalt = salt || crypto.randomBytes(16).toString('hex');
  const toHash = pin + PEPPER + perUserSalt;
  const hash = await argon2.hash(toHash, { type: argon2.argon2id });
  return { hash, salt: perUserSalt };
}

export async function verifyPin(pin: string, salt: string, hash: string) {
  const toVerify = pin + PEPPER + salt;
  return await argon2.verify(hash, toVerify);
}
