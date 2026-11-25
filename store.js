window.pcStore=(()=>{
 const {url,key}=window.PC_CONFIG, base=url.replace(/\/$/,'');
 const configured=Boolean(base&&key);
 const root=new URL(document.currentScript.src);
 const seed=async()=>{const r=await fetch(new URL('catalog.json',root)); if(!r.ok)throw Error('Не удалось прочитать catalog.json');return r.json()};
 const media=path=>configured&&/^\d+\/[a-f0-9-]+\.(jpg|jpeg|png|webp|avif|pdf|csv|txt|zip)$/i.test(path||'')?`${base}/storage/v1/object/public/pedalcraft-media/${path}`:'';
 const request=async(path,{token,...opts}={})=>{
   const r=await fetch(base+path,{...opts,headers:{apikey:key,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json',...opts.headers}});
   const body=await r.text();let data;try{data=JSON.parse(body)}catch{data=body}
   if(!r.ok)throw Error(data?.msg||data?.message||data?.error_description||`Ошибка HTTP ${r.status}`);return data;
 };
 const load=async()=>{const data=configured?await request('/rest/v1/rpc/pc_public_catalog',{method:'POST',body:'{}'}):await seed();if(!data)throw Error('Каталог ещё не инициализирован.');return data;};
 return {configured,request,media,seed,load};
})();
