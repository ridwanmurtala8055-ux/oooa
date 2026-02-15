import { query } from './db';

export async function writeAudit(userId: string | null, action: string, payload: any) {
  await query(
    `INSERT INTO audit_logs(user_id, action, payload_json, created_at) VALUES($1,$2,$3,now())`,
    [userId, action, JSON.stringify(payload)]
  );
}
