import { randomBytes } from 'node:crypto'
import social from './social-auth.cjs'
import { createSession, hashPassword, sessionCookie, slugify, verifyPassword } from './auth.js'
const {createSocialAuth,fail}=social
export function socialResolver(db) {
 return async (identity,proof) => db.tx(async tx => {
  // Serialize both provider IDs against the account's existing unique email.
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['social:'+identity.email])
  const {rows:linked}=await tx.query('SELECT u.* FROM social_identities s JOIN users u ON u.id=s.user_id WHERE s.provider=$1 AND s.subject=$2',[identity.provider,identity.subject])
  const {rows:matches}=await tx.query('SELECT * FROM users WHERE lower(email)=$1 FOR UPDATE',[identity.email])
  if(matches.length>1 || (linked[0]&&matches[0]&&linked[0].id!==matches[0].id))throw fail('social_conflict',409)
  let user=linked[0]||matches[0]
  if(user&&!linked.length&&(!user.email_verified_at||identity.emailAuthoritative===false)){if(!proof)return {needsProof:true};if(!await verifyPassword(proof,user.password_hash))throw fail('social_password',401)}
  if(!user){
   if(identity.emailAuthoritative===false)throw fail('social_email_proof',403)
   const pw=await hashPassword(randomBytes(48).toString('hex'))
   const {rows:[created]}=await tx.query('INSERT INTO users(email,password_hash,name,locale,email_verified_at) VALUES($1,$2,$3,\'ar\',now()) RETURNING *',[identity.email,pw,identity.name||'مستخدم مرقام']);user=created
   const name='منشأة '+user.name
   const {rows:[tenant]}=await tx.query('INSERT INTO tenants(name,slug) VALUES($1,$2) RETURNING id',[name.slice(0,120),slugify(name)])
   await tx.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",[tenant.id,user.id])
   await tx.query("INSERT INTO audit_log(tenant_id,actor_user_id,action) VALUES($1,$2,'tenant.created')",[tenant.id,user.id])
  }
  const {rows:[membership]}=await tx.query('SELECT m.tenant_id,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND t.closed_at IS NULL ORDER BY m.created_at LIMIT 1',[user.id])
  if(!membership)throw fail('social_denied',403)
  if(!linked.length){
   const {rows:other}=await tx.query('SELECT subject FROM social_identities WHERE provider=$1 AND user_id=$2',[identity.provider,user.id])
   if(other.length&&other[0].subject!==identity.subject)throw fail('social_conflict',409)
   await tx.query('INSERT INTO social_identities(provider,subject,user_id) VALUES($1,$2,$3)',[identity.provider,identity.subject,user.id])
   await tx.query('UPDATE users SET email_verified_at=coalesce(email_verified_at,now()) WHERE id=$1',[user.id])
   await tx.query('DELETE FROM sessions WHERE user_id=$1',[user.id])
  }
  return {userId:user.id,tenantId:membership.tenant_id}
 })
}
export function installSocialLogin(app,{db,config,env=process.env}){
 const social=createSocialAuth({env,origin:config.publicUrl,loginPath:'/login',resolve:socialResolver(db),startSession:async(req,res,ids)=>{
  const token=await createSession(db,{...ids,userAgent:req.headers['user-agent'],ttlDays:config.sessionTtlDays})
  res.setHeader('Set-Cookie',sessionCookie(token,{production:config.production,ttlDays:config.sessionTtlDays}))
 }})
 app.use((req,res,next)=>{if(!req.path.startsWith('/api/auth/social/'))return next();social.handle(req,res).catch(next)})
}
