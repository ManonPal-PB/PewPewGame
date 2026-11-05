// Pew Pew offline cache. Bump VERSION whenever index.html changes.
const VERSION='pew-pew-v14';
const CORE=['./','index.html','manifest.webmanifest','icon-180.png','icon-192.png','icon-512.png',
  'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.core.js',
  'https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/environments/RoomEnvironment.js',
  'https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/utils/BufferGeometryUtils.js',
  'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/rapier.mjs'];
const FONT_CSS='https://fonts.googleapis.com/css2?family=Lilita+One&family=Nunito:wght@700;800;900&display=swap';

self.addEventListener('install',e=>{
  e.waitUntil((async()=>{
    const c=await caches.open(VERSION);
    await c.addAll(CORE.map(u=>new Request(u,{mode:u.startsWith('http')?'cors':'same-origin'})));
    try{
      const r=await fetch(FONT_CSS,{mode:'cors'});
      if(r.ok){
        const css=await r.clone().text();await c.put(FONT_CSS,r);
        const urls=[...css.matchAll(/url\((https:[^)]+)\)/g)].map(m=>m[1]);
        await Promise.all(urls.map(u=>fetch(u,{mode:'cors'}).then(f=>f.ok&&c.put(u,f)).catch(()=>{})));
      }
    }catch(_){/* fonts are optional; the game falls back to system fonts */}
    self.skipWaiting();
  })());
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    for(const k of await caches.keys())if(k!==VERSION)await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',e=>{
  const req=e.request;if(req.method!=='GET')return;
  const isPage=req.mode==='navigate';
  e.respondWith((async()=>{
    const c=await caches.open(VERSION);
    if(isPage){
      // online: get the latest game (gives up after 3s); offline: use the saved copy
      try{
        const net=await Promise.race([fetch(req),new Promise((_,rej)=>setTimeout(()=>rej('slow'),3000))]);
        if(net&&net.ok){c.put('index.html',net.clone());return net}
      }catch(_){}
      return (await c.match('index.html'))||(await c.match('./'))||Response.error();
    }
    const hit=await c.match(req,{ignoreSearch:false});
    if(hit)return hit;
    try{const net=await fetch(req);if(net&&(net.ok||net.type==='opaque'))c.put(req,net.clone());return net}
    catch(_){return Response.error()}
  })());
});
