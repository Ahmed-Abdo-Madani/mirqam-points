export async function audit(db, req, action, target, data = {}) {
  await db.query('INSERT INTO audit_log (tenant_id, actor_user_id, action, target, data) VALUES ($1, $2, $3, $4, $5)', [
    req.auth.tenantId,
    req.auth.userId,
    action,
    target ?? null,
    JSON.stringify(data),
  ])
}
