/* Public-site measurement only. Never inspect forms, identity, or application data. */
(() => {
  'use strict';
  const script = document.currentScript;
  const container = script?.dataset.container;
  const measurement = script?.dataset.measurement;
  const publicPage = () => location.pathname === '/' || location.pathname === '/mirqam-marketing.html' || /^\/blog\/[a-z0-9-]+\.html$/.test(location.pathname);
  if (!container || !measurement || !publicPage()) return;
  const key = 'mirqam-analytics-consent-v1';
  let loaded = false;
  let granted = false;
  const read = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const save = value => { try { localStorage.setItem(key, value); } catch {} };
  const cleanReferrer = () => { try { return new URL(document.referrer).origin + '/'; } catch { return ''; } };
  window.dataLayer = window.dataLayer || [];
  const gtag = function () { window.dataLayer.push(arguments); };
  const load = () => {
    granted = true;
    if (loaded || !publicPage()) return;
    loaded = true;
    gtag('consent', 'default', {analytics_storage:'granted', ad_storage:'denied', ad_user_data:'denied', ad_personalization:'denied'});
    const page = new URL(location.origin + location.pathname);
    // Campaign labels are explicit marketing metadata, not arbitrary URL parameters.
    for (const name of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term']) {
      const value = new URLSearchParams(location.search).get(name);
      if (value && /^[a-zA-Z0-9_-]{1,80}$/.test(value)) page.searchParams.set(name,value);
    }
    gtag('set', {page_location:page.href, page_referrer:cleanReferrer(), cookie_domain:location.hostname, allow_google_signals:false, allow_ad_personalization_signals:false});
    window.dataLayer.push({'gtm.start':Date.now(), event:'gtm.js'});
    const tag = document.createElement('script');
    tag.async = true;
    tag.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(container);
    document.head.append(tag);
  };
  const panel = document.createElement('aside');
  panel.className = 'mq-consent'; panel.dir = 'rtl';
  panel.setAttribute('aria-label','خيارات قياس الزيارات');
  const text = document.createElement('p');
  text.textContent = 'نستخدم Google Analytics بعد موافقتك لفهم زيارات الصفحات العامة وتحسينها. يمكنك القبول أو الرفض وتغيير اختيارك لاحقًا.';
  const accept = document.createElement('button'); accept.type='button'; accept.textContent='قبول القياس';
  const reject = document.createElement('button'); reject.type='button'; reject.textContent='رفض القياس';
  const settings = document.createElement('button'); settings.type='button'; settings.className='mq-consent-settings'; settings.textContent='خصوصية القياس';
  settings.onclick = () => { panel.hidden = false; settings.hidden = true; };
  accept.onclick = () => { save('granted'); load(); panel.hidden=true; settings.hidden=false; };
  reject.onclick = () => {
    save('denied'); granted=false;
    window['ga-disable-' + measurement] = true;
    gtag('consent','update',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});
    for(const cookie of document.cookie.split(';')) { const name=cookie.trim().split('=')[0]; if(name==='_ga'||name.startsWith('_ga_')) document.cookie=name+'=; Max-Age=0; Path=/; Domain='+location.hostname+'; SameSite=Lax; Secure'; }
    panel.hidden=true; settings.hidden=false;
  };
  accept.addEventListener('click',()=>{window['ga-disable-'+measurement]=false; if(loaded)gtag('consent','update',{analytics_storage:'granted'});});
  panel.append(text,accept,reject);
  const mount = () => { document.body.append(panel,settings); const consent=read(); panel.hidden=Boolean(consent); settings.hidden=!consent; if(consent==='granted')load(); };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
  document.addEventListener('click',event=>{
    if(!granted||!publicPage())return;
    const anchor=event.target.closest?.('a[href]'); if(!anchor)return;
    let target;try{target=new URL(anchor.href);}catch{return;}
    let action;
    if(target.origin===location.origin && (['/register','/signup'].includes(target.pathname)||(target.pathname==='/auth'&&!target.searchParams.has('login'))||(target.pathname==='/login'&&target.searchParams.get('mode')==='signup')||(target.pathname==='/app'&&target.hash==='#register')))action='signup_click';
    else if(target.origin===location.origin && ['/auth','/login','/app'].includes(target.pathname))action='login_click';
    else if(target.protocol==='mailto:')action='contact_email_click';
    else if(['wa.me','api.whatsapp.com'].includes(target.hostname))action='contact_whatsapp_click';
    else if(target.origin===location.origin && target.pathname==='/blog/index.html')action='view_blog';
    if(action)gtag('event',action,{send_to:measurement, page_location:location.origin+location.pathname, page_referrer:cleanReferrer(), transport_type:'beacon'});
  });
})();
