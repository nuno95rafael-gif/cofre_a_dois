/* Cofre a Dois — service worker: guarda os ficheiros da app para abrir sem internet.
   Os dados do cofre não passam por aqui (vão diretos ao Supabase); só ficheiros do próprio site. */
const VERSION='cofre-v3';
const SHELL=['/','/index.html','/css/app.css','/js/app.js','/js/cloud.js','/js/config.js','/js/vendor/supabase-2.119.2.js',
  '/manifest.webmanifest','/icons/favicon-32.png','/icons/favicon-64.png','/icons/apple-touch-icon.png','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==location.origin)return; // Supabase e outros: sempre pela rede
  const key=req.mode==='navigate'?'/index.html':url.pathname;
  // rede primeiro (para ter sempre a versão mais recente); sem rede, usa a cópia guardada
  e.respondWith((async()=>{
    const cache=await caches.open(VERSION);
    try{
      const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),4000);
      const res=await fetch(req,{signal:ctl.signal});clearTimeout(t);
      if(res.ok)cache.put(key,res.clone());
      return res;
    }catch(err){
      const hit=await cache.match(key);
      if(hit)return hit;
      throw err;
    }
  })());
});

/* ---------- notificações ---------- */
self.addEventListener('push',e=>{
  let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data&&e.data.text()}}
  e.waitUntil(self.registration.showNotification(d.title||'Cofre a Dois',{
    body:d.body||'',tag:d.tag,renotify:!!d.tag,icon:'/icons/icon-192.png',badge:'/icons/favicon-64.png',data:{url:d.url||'/'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||'/';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){if('focus' in c)return c.focus()}
    return self.clients.openWindow(url);
  }));
});
