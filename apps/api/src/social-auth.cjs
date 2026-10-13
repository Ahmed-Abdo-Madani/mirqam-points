'use strict';
// Shared server-only OAuth implementation. No provider tokens reach the browser.
const {randomBytes,createHash,createPublicKey,verify,timingSafeEqual}=require('node:crypto');
const random=()=>randomBytes(32).toString('base64url');
const digest=s=>createHash('sha256').update(String(s)).digest('base64url');
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const normalizedEmail=v=>typeof v==='string'?v.trim().toLowerCase():'';
const validEmail=v=>v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const fail=(code='social_failed',status=400)=>Object.assign(new Error(code),{code,status});
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const publicMessages={social_failed:'لم يكتمل الدخول. أعد المحاولة.',social_unavailable:'الدخول بهذا المزوّد غير متاح الآن.',social_email_unverified:'أكمل توثيق بريدك لدى المزوّد أولاً.',social_email_proof:'هذا البريد ليس مُدارًا بواسطة Google. أنشئ حسابك بالبريد الإلكتروني أولًا، ثم استخدم Google وأكّد كلمة مرور مرقام مرة واحدة لربط الحساب.',social_conflict:'تعذر الربط التلقائي. ادخل إلى حسابك الحالي وتواصل مع الدعم؛ لم ننشئ حسابًا آخر.',social_denied:'الحساب غير متاح للدخول.',social_password:'كلمة المرور غير صحيحة. أعد المحاولة أو استخدم استعادة كلمة المرور.',social_expired:'انتهت محاولة الدخول. ابدأ مرة أخرى.',social_capacity:'محاولات كثيرة. حاول بعد قليل.'};
function page(title,content,back){return '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+' | مرقام</title><style>body{font-family:system-ui,sans-serif;background:#f4f7f9;color:#112c46;margin:0;padding:24px;line-height:1.8}main{max-width:440px;margin:8vh auto;background:white;border:1px solid #dce4e9;border-radius:20px;padding:28px}input,button{box-sizing:border-box;width:100%;padding:12px;font:inherit;margin-top:12px;border-radius:10px;border:1px solid #b9c8d2}button{background:#112c46;color:white;cursor:pointer}a{color:#087f86}label{display:block}</style><main><p>مرقام</p><h1>'+escape(title)+'</h1>'+content+'<p><a href="'+escape(back)+'">العودة إلى تسجيل الدخول</a></p></main></html>';}
function createSocialAuth({env=process.env,origin,base='/api/auth/social',loginPath='/auth',successPath='/app',resolve,startSession,fetcher=fetch,clock=Date.now,limit=2000}){
 origin=new URL(origin).origin;
 const secure=origin.startsWith('https://'),cookieName=(secure?'__Host-':'')+'mirqam-social';
 const flows=new Map();let keys=[],keysUntil=0,lastKeysAttempt=0;
 const config={google:{id:env.SOCIAL_GOOGLE_CLIENT_ID,secret:env.SOCIAL_GOOGLE_CLIENT_SECRET},github:{id:env.SOCIAL_GITHUB_CLIENT_ID,secret:env.SOCIAL_GITHUB_CLIENT_SECRET}};
 const enabled=p=>(env.NODE_ENV!=='production'||secure)&&env.SOCIAL_LOGIN_ENABLED==='true'&&!!(config[p]?.id&&config[p]?.secret);
 const providers=()=>['google','github'].filter(enabled);
 const prune=()=>{for(const [k,v]of flows)if(v.expires<=clock())flows.delete(k);};
 function put(row,ttl=600000){prune();if(flows.size>=limit)throw fail('social_capacity',429);const key=random();flows.set(digest(key),{...row,expires:clock()+ttl});return key;}
 const cookie=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
 function setCookie(res,value,maxAge=600){const header=cookieName+'='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+maxAge+(secure?'; Secure':'');const prior=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[...(Array.isArray(prior)?prior:prior?[prior]:[]),header]);}
 function take(req,key,kind){if(!/^[A-Za-z0-9_-]{43}$/.test(key||''))throw fail('social_expired');const id=digest(key),row=flows.get(id);if(!row||row.expires<=clock()||row.kind!==kind||!same(row.binding,digest(cookie(req))))throw fail('social_expired');flows.delete(id);return row;}
 function headers(res){res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");}
 function html(res,status,body){headers(res);res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(body);}
 function json(res,status,data){headers(res);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
 function redirect(res,to){headers(res);res.writeHead(303,{Location:to});res.end();}
 async function request(url,options={}){const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});if(!r.ok)throw fail();const text=await r.text();if(text.length>1000000)throw fail();try{return JSON.parse(text);}catch{throw fail();}}
 async function googleIdentity(token,nonce){
  if(typeof token!=='string'||token.length>20000)throw fail();const pieces=token.split('.');if(pieces.length!==3)throw fail();let h,p;try{h=JSON.parse(Buffer.from(pieces[0],'base64url'));p=JSON.parse(Buffer.from(pieces[1],'base64url'));}catch{throw fail();}
  if(h.alg!=='RS256'||typeof h.kid!=='string'||h.kid.length>200)throw fail();
  if(clock()>=keysUntil||(!keys.some(k=>k.kid===h.kid)&&clock()-lastKeysAttempt>60000)){lastKeysAttempt=clock();const jwks=await request('https://www.googleapis.com/oauth2/v3/certs');if(!Array.isArray(jwks.keys))throw fail();keys=jwks.keys.filter(k=>k.kty==='RSA'&&k.use==='sig'&&k.alg==='RS256');keysUntil=clock()+3600000;}
  const key=keys.find(k=>k.kid===h.kid);if(!key||!verify('RSA-SHA256',Buffer.from(pieces[0]+'.'+pieces[1]),createPublicKey({key,format:'jwk'}),Buffer.from(pieces[2],'base64url')))throw fail();
  const now=Math.floor(clock()/1000),aud=Array.isArray(p.aud)?p.aud:[p.aud];
  if(!['https://accounts.google.com','accounts.google.com'].includes(p.iss)||!aud.includes(config.google.id)||(aud.length>1&&p.azp!==config.google.id)||(p.azp&&p.azp!==config.google.id)||!Number.isFinite(p.exp)||p.exp<=now||!Number.isFinite(p.iat)||p.iat>now+60||p.iat<now-600||(p.nbf&&p.nbf>now+60)||!same(p.nonce,nonce)||typeof p.sub!=='string'||!p.sub||p.sub.length>255)throw fail();
  const email=normalizedEmail(p.email);if(p.email_verified!==true||!validEmail(email))throw fail('social_email_unverified');
  // Google is not authoritative for non-Gmail addresses without an hd claim.
  const emailAuthoritative=email.endsWith('@gmail.com')||(typeof p.hd==='string'&&p.hd.length>0);
  return {provider:'google',subject:p.sub,email,name:typeof p.name==='string'?p.name.slice(0,100):email.split('@')[0],emailVerified:true,emailAuthoritative};
 }
 async function exchange(provider,code,row){
  const c=config[provider],redirect_uri=origin+base+'/'+provider+'/callback';
  const fields={client_id:c.id,client_secret:c.secret,code,redirect_uri,code_verifier:row.verifier};if(provider==='google')fields.grant_type='authorization_code';
  const token=await request(provider==='google'?'https://oauth2.googleapis.com/token':'https://github.com/login/oauth/access_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams(fields).toString()});
  if(provider==='google')return googleIdentity(token.id_token,row.nonce);
  if(typeof token.access_token!=='string'||!token.access_token||token.error)throw fail();
  const headers={Authorization:'Bearer '+token.access_token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Mirqam-Sign-In'};
  const [user,emails]=await Promise.all([request('https://api.github.com/user',{headers}),request('https://api.github.com/user/emails',{headers})]);
  const primary=Array.isArray(emails)?emails.find(e=>e.primary===true&&e.verified===true):null;
  const email=normalizedEmail(primary?.email);if(!validEmail(email))throw fail('social_email_unverified');
  if(!Number.isSafeInteger(user.id)||user.id<=0)throw fail();
  return {provider:'github',subject:String(user.id),email,name:String(user.name||user.login||email.split('@')[0]).slice(0,100),emailVerified:true};
 }
 async function formBody(req){if(req.body&&typeof req.body==='object'&&(Object.keys(req.body).length>0||req.readableEnded))return req.body;let text='';for await(const chunk of req){text+=chunk;if(text.length>2048)throw fail();}if(String(req.headers['content-type']||'').split(';')[0]==='application/json'){let data;try{data=JSON.parse(text);}catch{throw fail();}if(!data||typeof data!=='object'||Array.isArray(data))throw fail();return data;}return Object.fromEntries(new URLSearchParams(text));}
 function proofPage(res,req,identity,attempt=0,error=''){
  const ticket=put({kind:'proof',binding:digest(cookie(req)),identity,attempt},300000);
  html(res,200,page('اربط حسابك الحالي', '<p>وجدنا حسابًا بهذا البريد. أكّد كلمة مروره مرة واحدة لحماية حسابك القديم؛ بعدها تقدر تدخل مباشرة بواسطة Google أو GitHub. لن يتم إنشاء حساب آخر.</p><p role="alert">'+escape(error)+'</p><form method="post" action="'+base+'/proof"><input type="hidden" name="ticket" value="'+ticket+'"><label>كلمة مرور حساب مرقام<input name="password" type="password" autocomplete="current-password" required minlength="1" maxlength="200" autofocus></label><button type="submit">تأكيد وربط الحساب</button></form>',loginPath));
 }
 async function finish(req,res,identity,proof,attempt=0){
  let result;try{result=await resolve(identity,proof);}catch(e){if(e.code==='social_password'&&attempt<4)return proofPage(res,req,identity,attempt+1,publicMessages.social_password);throw e;}
  if(result?.needsProof)return proofPage(res,req,identity,attempt);
  if(!result)throw fail('social_denied',403);
  // Cookie based apps start their normal session. Bearer apps receive a short
  // browser-bound, single-use handoff instead of putting a token in a URL.
  const handoff=await startSession(req,res,result);
  if(res.writableEnded)return;
  if(handoff){const ticket=put({kind:'handoff',binding:digest(cookie(req)),result:handoff},60000);return redirect(res,loginPath+'?social='+ticket);}
  setCookie(res,'',0);return redirect(res,successPath);
 }
 async function handle(req,res){
  const url=new URL(req.originalUrl||req.url,origin);if(!url.pathname.startsWith(base+'/'))return false;
  try{
   headers(res);prune();
   if(url.pathname===base+'/providers'&&req.method==='GET'){json(res,200,{providers:providers()});return true;}
   if(req.method==='POST'){
    if(req.headers.origin!==origin)throw fail('social_failed',403);
    if(url.pathname===base+'/complete'){const b=await formBody(req),row=take(req,b.ticket,'handoff');setCookie(res,'',0);json(res,200,row.result);return true;}
    if(url.pathname===base+'/proof'){const b=await formBody(req),row=take(req,b.ticket,'proof');if(typeof b.password!=='string'||b.password.length<1||b.password.length>200)throw fail('social_password');await finish(req,res,row.identity,b.password,row.attempt);return true;}
   }
   const match=url.pathname.slice(base.length).match(/^\/(google|github)(\/callback)?$/);if(!match||req.method!=='GET')throw fail();const provider=match[1];if(!enabled(provider))throw fail('social_unavailable',503);
   if(!match[2]){
    const binding=random(),verifier=random(),nonce=random();setCookie(res,binding);
    const state=put({kind:'oauth',provider,binding:digest(binding),verifier,nonce});
    const target=new URL(provider==='google'?'https://accounts.google.com/o/oauth2/v2/auth':'https://github.com/login/oauth/authorize');
    target.search=new URLSearchParams({client_id:config[provider].id,redirect_uri:origin+base+'/'+provider+'/callback',response_type:'code',scope:provider==='google'?'openid email profile':'read:user user:email',state,code_challenge:digest(verifier),code_challenge_method:'S256',...(provider==='google'?{nonce,prompt:'select_account'}:{})}).toString();redirect(res,target.href);return true;
   }
   const row=take(req,url.searchParams.get('state'),'oauth');if(row.provider!==provider||url.searchParams.has('error'))throw fail();const code=url.searchParams.get('code');if(typeof code!=='string'||code.length<1||code.length>2048)throw fail();
   const identity=await exchange(provider,code,row);await finish(req,res,identity);return true;
  }catch(e){const code=Object.hasOwn(publicMessages,e.code)?e.code:'social_failed';if((req.originalUrl||req.url).split('?')[0]===base+'/complete')json(res,e.status||400,{error:code});else html(res,e.status||400,page('تعذّر إكمال الدخول','<p>'+escape(publicMessages[code])+'</p>',loginPath));return true;}
 }
 return {handle,providers};
}
module.exports={createSocialAuth,normalizedEmail,fail};
