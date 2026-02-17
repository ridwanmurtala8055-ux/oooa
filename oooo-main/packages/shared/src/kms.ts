import fetch from 'node-fetch';

// Simple KMS wrapper: prefer environment variables; optional HTTP KMS endpoint
export async function getSecret(name: string) {
  const envVal = process.env[name];
  if (envVal && envVal.length > 0) return envVal;
  const kmsEndpoint = process.env.KMS_ENDPOINT;
  if (kmsEndpoint) {
    try {
      const r = await fetch(`${kmsEndpoint}/secrets/${encodeURIComponent(name)}`);
      if (r.ok) {
        const j: any = await r.json();
        if (j && j.value) return j.value;
      }
    } catch (e) {
      // fallthrough
    }
  }
  return null;
}

export async function getMasterKey() {
  const k = await getSecret('WALLET_MASTER_KEY');
  return k;
}
