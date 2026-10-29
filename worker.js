const CORS = {
 "Access-Control-Allow-Origin":"*",
 "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
 "Access-Control-Allow-Headers":"Content-Type",
 "Content-Type":"application/json; charset=utf-8"
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:CORS});
const enc=new TextEncoder();
async function sha256(s){const b=await crypto.subtle.digest("SHA-256",enc.encode(s));return [...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,"0")).join("");}
function randomHex(bytes=24){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return [...a].map(v=>v.toString(16).padStart(2,"0")).join("");}
function headerValue(headers,name){const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");const re=new RegExp("^"+escaped+":\\s*(.*(?:\\r?\\n[ \\t].*)*)","im");return (headers.match(re)||[])[1]?.replace(/\r?\n[ \t]+/g," ").trim()||"";}
function splitMessage(raw){const m=raw.match(/\r?\n\r?\n/);if(!m)return {headers:"",body:raw};const i=m.index;return {headers:raw.slice(0,i),body:raw.slice(i+m[0].length)};}
function qp(s){return s.replace(/=\r?\n/g,"").replace(/=([0-9a-f]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16)));}
function decodeBody(raw){
 const {headers,body}=splitMessage(raw);const ct=headerValue(headers,"Content-Type");let text=body;
 if(/multipart\//i.test(ct)){
  const boundary=(ct.match(/boundary="?([^";]+)"?/i)||[])[1];
  if(boundary){const parts=body.split("--"+boundary);const plain=parts.find(p=>/Content-Type:\s*text\/plain/i.test(p));
   if(plain)text=splitMessage(plain).body;
   else {const html=parts.find(p=>/Content-Type:\s*text\/html/i.test(p));if(html)text=splitMessage(html).body.replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">");}
  }
 }
 const transfer=headerValue(headers,"Content-Transfer-Encoding");
 if(/quoted-printable/i.test(transfer))text=qp(text);
 else if(/base64/i.test(transfer)){try{text=atob(text.replace(/\s/g,""));}catch{}}
 return {headers,body_text:text.replace(/\0/g,"").slice(0,20000)};
}
function decodeHeader(s){return s.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi,(_,v)=>{try{return decodeURIComponent(escape(atob(v)));}catch{return v;}}).replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi,(_,v)=>v.replace(/_/g," ").replace(/=([0-9a-f]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))));}
function findOtp(text){
 const patterns=[/(?:otp|verification code|one[- ]time password|security code|login code|passcode)[^\d]{0,40}(\d{4,8})/i,/\b(\d{6})\b/];
 for(const p of patterns){const m=text.match(p);if(m)return m[1];}
 return "";
}
async function getInbox(env,token){
 if(!/^[a-f0-9]{48}$/.test(token||""))return null;
 return env.DB.prepare("SELECT id,address,expires_at FROM inboxes WHERE token_hash=? AND expires_at>?").bind(await sha256(token),Date.now()).first();
}
async function api(request,env,url){
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(url.pathname==="/api/health")return json({ok:true,service:"IndiaTempMail API"});
 if(url.pathname==="/api/new"&&request.method==="POST"){
  const domain=String(env.MAIL_DOMAIN||"").toLowerCase().trim();
  if(!domain||!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain))return json({error:"Set MAIL_DOMAIN to your real domain in Worker variables."},500);
  const ip=request.headers.get("CF-Connecting-IP")||"unknown",now=Date.now();
  const rate=await env.DB.prepare("SELECT COUNT(*) AS n FROM create_events WHERE ip_hash=? AND created_at>?").bind(await sha256(ip),now-60*60*1000).first();
  if((rate?.n||0)>=30)return json({error:"Too many inboxes from this connection. Try again later."},429);
  const token=randomHex(24),address="inbox-"+randomHex(5)+"@"+domain,expires=now+(Math.max(1,Math.min(24,Number(env.INBOX_TTL_HOURS)||2))*3600000);
  await env.DB.prepare("INSERT INTO inboxes (address,token_hash,created_at,expires_at) VALUES (?,?,?,?)").bind(address,await sha256(token),now,expires).run();
  await env.DB.prepare("INSERT INTO create_events (ip_hash,created_at) VALUES (?,?)").bind(await sha256(ip),now).run();
  return json({address,token,expires_at:expires});
 }
 const list=url.pathname.match(/^\/api\/inbox\/([a-f0-9]+)$/);
 if(list&&request.method==="GET"){
  const box=await getInbox(env,list[1]);if(!box)return json({error:"Inbox expired or invalid. Generate a new address."},404);
  const rows=await env.DB.prepare("SELECT id,sender,subject,preview,otp,received_at FROM messages WHERE inbox_id=? AND expires_at>? ORDER BY received_at DESC LIMIT 50").bind(box.id,Date.now()).all();
  return json({address:box.address,expires_at:box.expires_at,messages:rows.results||[]});
 }
 const msg=url.pathname.match(/^\/api\/message\/([a-f0-9]+)\/(\d+)$/);
 if(msg&&request.method==="GET"){
  const box=await getInbox(env,msg[1]);if(!box)return json({error:"Inbox expired or invalid."},404);
  const m=await env.DB.prepare("SELECT id,sender,subject,body_text,otp,received_at FROM messages WHERE id=? AND inbox_id=? AND expires_at>?").bind(Number(msg[2]),box.id,Date.now()).first();
  return m?json(m):json({error:"Message not found."},404);
 }
 return json({error:"Not found"},404);
}
export default {
 async fetch(request,env){try{return await api(request,env,new URL(request.url));}catch(e){return json({error:"Server error. Check Worker logs and D1 setup."},500);}},
 async email(message,env){
  try{
   const recipient=String(message.to||"").toLowerCase();
   const box=await env.DB.prepare("SELECT id FROM inboxes WHERE lower(address)=? AND expires_at>?").bind(recipient,Date.now()).first();
   if(!box){message.setReject("Temporary inbox does not exist or has expired.");return;}
   const raw=await new Response(message.raw).text(),parsed=decodeBody(raw),subject=decodeHeader(headerValue(parsed.headers,"Subject")||"(No subject)");
   const sender=headerValue(parsed.headers,"From")||String(message.from||"Unknown sender");
   const body=parsed.body_text,otp=findOtp(body),preview=body.replace(/\s+/g," ").trim().slice(0,240);
   const now=Date.now(),ttl=Math.max(1,Math.min(24,Number(env.MESSAGE_TTL_HOURS)||2))*3600000;
   await env.DB.prepare("INSERT INTO messages (inbox_id,sender,subject,body_text,preview,otp,received_at,expires_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(box.id,sender.slice(0,320),subject.slice(0,500),body,preview,otp,now,now+ttl).run();
  }catch(e){message.setReject("Temporary inbox processing failed.");}
 },
 async scheduled(event,env,ctx){ctx.waitUntil((async()=>{const now=Date.now();await env.DB.prepare("DELETE FROM messages WHERE expires_at<=?").bind(now).run();await env.DB.prepare("DELETE FROM inboxes WHERE expires_at<=?").bind(now).run();await env.DB.prepare("DELETE FROM create_events WHERE created_at<?").bind(now-86400000).run();})());}
};
