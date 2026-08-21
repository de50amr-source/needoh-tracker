import webpush from "web-push";

const PRODUCTS = [
  { name:"Polar Glow Penguin", url:"https://schylling.com/product/needoh-polar-glow-penguin/", expectedPrice:5.99, priority:1 },
  { name:"Advent Calendar", url:"https://schylling.com/product/needoh-advent-calendar-2/", expectedPrice:29.99, priority:2 }
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({
        ok:true,
        service:"needoh-stock-worker",
        products:PRODUCTS.map(p=>p.name),
        pushConfigured:!!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT)
      });
    }
    if (url.pathname === "/check") {
      const auth=request.headers.get("authorization");
      if (!env.CHECK_TOKEN || auth !== `Bearer ${env.CHECK_TOKEN}`) return new Response("Unauthorized",{status:401});
      return Response.json(await checkAll(env));
    }
    return new Response("NeeDoh stock worker",{status:200});
  },
  async scheduled(event,env,ctx) { ctx.waitUntil(checkAll(env)); }
};

async function checkAll(env) {
  assertEnv(env);
  const retailerId=await ensureRetailer(env,{name:"Schylling",website:"https://schylling.com"});
  const results=[];
  for (const product of PRODUCTS) {
    try {
      const item=await getCatalogItem(env,product.name);
      if (!item) { results.push({product:product.name,ok:false,error:"Product missing from needoh_catalog"}); continue; }
      const checked=await checkSchyllingProduct(product);
      const saved=await saveInventory(env,{needohId:item.id,retailerId,product,checked});
      results.push({product:product.name,ok:true,availability:checked.availability,price:checked.price,changed:saved.changed});
    } catch(error) {
      results.push({product:product.name,ok:false,error:String(error?.message||error)});
    }
  }
  return {checked_at:new Date().toISOString(),results};
}

function assertEnv(env) {
  if (!env.SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
  if (!env.SUPABASE_SECRET_KEY) throw new Error("Missing SUPABASE_SECRET_KEY");
}

async function checkSchyllingProduct(product) {
  const response=await fetch(product.url,{headers:{"User-Agent":"NeeDohTracker/1.0 (+personal collector stock monitor)","Accept":"text/html,application/xhtml+xml"},redirect:"follow"});
  if (!response.ok) throw new Error(`Schylling returned HTTP ${response.status}`);
  const html=await response.text();
  const text=stripHtml(html);
  const explicitOut=/out\s+of\s+stock/i.test(text)||/sold\s+out/i.test(text);
  const addToCart=/add\s+to\s+cart/i.test(text)||/single_add_to_cart_button/i.test(html);
  const availability=explicitOut?"out_of_stock":addToCart?"in_stock":"unknown";
  return {availability,price:extractPrice(text,product.expectedPrice)};
}

function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();
}

function extractPrice(text,fallback) {
  const prices=[...text.matchAll(/\$\s?(\d{1,3}(?:\.\d{2})?)/g)].map(m=>Number(m[1])).filter(Number.isFinite);
  if (!prices.length) return fallback??null;
  if (fallback!=null) {
    const exact=prices.find(p=>Math.abs(p-fallback)<0.001);
    if (exact!=null) return exact;
  }
  return prices[0];
}

async function sb(env,path,options={}) {
  const res=await fetch(`${env.SUPABASE_URL}${path}`,{
    ...options,
    headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`,"Content-Type":"application/json",...(options.headers||{})}
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  if (res.status===204) return null;
  const body=await res.text(); return body?JSON.parse(body):null;
}

async function ensureRetailer(env,retailer) {
  let rows=await sb(env,`/rest/v1/retailers?name=eq.${encodeURIComponent(retailer.name)}&select=id&limit=1`);
  if (rows?.length) return rows[0].id;
  rows=await sb(env,"/rest/v1/retailers",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify(retailer)});
  return rows[0].id;
}

async function getCatalogItem(env,name) {
  const rows=await sb(env,`/rest/v1/needoh_catalog?name=eq.${encodeURIComponent(name)}&select=id,name&limit=1`);
  return rows?.[0]||null;
}

async function getExistingInventory(env,needohId,retailerId,url) {
  const rows=await sb(env,`/rest/v1/inventory?needoh_id=eq.${needohId}&retailer_id=eq.${retailerId}&purchase_url=eq.${encodeURIComponent(url)}&select=id,availability,price&limit=1`);
  return rows?.[0]||null;
}

async function saveInventory(env,{needohId,retailerId,product,checked}) {
  const existing=await getExistingInventory(env,needohId,retailerId,product.url);
  const now=new Date().toISOString();
  let id, changed=false, availabilityChanged=false;
  if (!existing) {
    const inserted=await sb(env,"/rest/v1/inventory",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({
      needoh_id:needohId,retailer_id:retailerId,store_name:"Schylling Official Store",location:"Online",price:checked.price,
      purchase_url:product.url,availability:checked.availability,stock_type:"online",verified_at:now
    })});
    id=inserted[0].id; changed=true; availabilityChanged=true;
    await addHistory(env,id,checked);
  } else {
    id=existing.id;
    const priceChanged=Number(existing.price??-1)!==Number(checked.price??-1);
    availabilityChanged=existing.availability!==checked.availability;
    changed=priceChanged||availabilityChanged;
    await sb(env,`/rest/v1/inventory?id=eq.${id}`,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({price:checked.price,availability:checked.availability,verified_at:now})});
    if (changed) await addHistory(env,id,checked);
  }
  if (availabilityChanged && checked.availability==="in_stock") await notifyPriorityCollectors(env,needohId,product,checked);
  return {changed,id};
}

async function notifyPriorityCollectors(env,needohId,product,checked) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return;
  const priorities=await sb(env,`/rest/v1/collection_items?needoh_id=eq.${needohId}&status=eq.priority&select=profile_id`);
  const ids=[...new Set((priorities||[]).map(r=>r.profile_id))];
  if (!ids.length) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);
  for (const profileId of ids) {
    const subs=await sb(env,`/rest/v1/push_subscriptions?profile_id=eq.${profileId}&enabled=eq.true&select=id,subscription`);
    for (const row of subs||[]) {
      try {
        await webpush.sendNotification(row.subscription,JSON.stringify({
          title:`🚨 ${product.name} is IN STOCK`,
          body:`${checked.price!=null?"$"+Number(checked.price).toFixed(2)+" • ":""}Schylling Official Store`,
          url:product.url,tag:`needoh-${needohId}`
        }));
      } catch(err) {
        if (err?.statusCode===404 || err?.statusCode===410) await sb(env,`/rest/v1/push_subscriptions?id=eq.${row.id}`,{method:"DELETE"});
      }
    }
  }
}

async function addHistory(env,inventoryId,checked) {
  await sb(env,"/rest/v1/stock_history",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({
    inventory_id:inventoryId,availability:checked.availability,price:checked.price,checked_at:new Date().toISOString()
  })});
}
