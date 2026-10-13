import {afterAll,beforeAll,expect,it} from 'vitest'
import {freshDb} from './testing.js'
import {socialResolver} from './social-login.js'
import {hashPassword} from './auth.js'
let db,resolve
beforeAll(async()=>{db=await freshDb();resolve=socialResolver(db)})
afterAll(()=>db.close())
const identity=(email,subject=email,provider='google')=>({provider,subject,email,name:'صاحب المنشأة',emailVerified:true})
it('same verified email and both providers resolve one user and one workspace, including concurrent callbacks',async()=>{
 const id=identity('same@gmail.com'),first=await resolve(id)
 const results=await Promise.all([resolve(id),resolve(identity(id.email,'github-1','github'))])
 for(const r of results)expect(r).toEqual(first)
 expect((await db.query('SELECT count(*)::int AS n FROM users WHERE email=$1',[id.email])).rows[0].n).toBe(1)
 expect((await db.query('SELECT count(*)::int AS n FROM memberships WHERE user_id=$1',[first.userId])).rows[0].n).toBe(1)
})
it('existing password account requires proof once, then keeps its ID, role and tenant',async()=>{
 const email='legacy@gmail.com',passwordHash=await hashPassword('existing-password')
 const {rows:[tenant]}=await db.query("INSERT INTO tenants(name,slug) VALUES('Original','original-social') RETURNING id")
 const {rows:[user]}=await db.query("INSERT INTO users(email,password_hash,name) VALUES($1,$2,'Legacy') RETURNING id",[email,passwordHash])
 await db.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'cashier')",[tenant.id,user.id])
 expect(await resolve(identity(email))).toEqual({needsProof:true})
 await expect(resolve(identity(email),'wrong')).rejects.toMatchObject({code:'social_password'})
 const result=await resolve(identity(email),'existing-password')
 expect(result).toEqual({userId:user.id,tenantId:tenant.id})
 expect(await resolve(identity(email))).toEqual(result)
 expect((await db.query('SELECT role FROM memberships WHERE user_id=$1',[user.id])).rows[0].role).toBe('cashier')
 expect((await db.query('SELECT password_hash FROM users WHERE id=$1',[user.id])).rows[0].password_hash).toBe(passwordHash)
})
it('changed provider email cannot transfer identity onto another existing account',async()=>{
 const one=await resolve(identity('one@gmail.com','subject-one'))
 await resolve(identity('two@gmail.com','subject-two'))
 await expect(resolve(identity('two@gmail.com','subject-one'))).rejects.toMatchObject({code:'social_conflict'})
 expect(await resolve(identity('new-email@gmail.com','subject-one'))).toEqual(one)
})
it('closed workspace blocks social login and does not create a replacement',async()=>{
 const ident=identity('closed@gmail.com'),u=await resolve(ident)
 await db.query('UPDATE tenants SET closed_at=now() WHERE id=$1',[u.tenantId])
 await expect(resolve(ident)).rejects.toMatchObject({code:'social_denied'})
 expect((await db.query('SELECT count(*)::int AS n FROM users WHERE email=$1',[ident.email])).rows[0].n).toBe(1)
})
