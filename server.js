const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'doitforme.sqlite');
const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN || '';
const MAPBOX_PROFILE = process.env.MAPBOX_PROFILE || 'mapbox/driving-traffic';
const ROUTE_RECALC_METERS = Number(process.env.ROUTE_RECALC_METERS || 100);
const ROUTE_REFRESH_SECONDS = Number(process.env.ROUTE_REFRESH_SECONDS || 30);
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY || 'NGN';
const APP_BASE_URL = process.env.APP_BASE_URL || '';
const TERMII_API_KEY = process.env.TERMII_API_KEY || '';
const TERMII_BASE_URL = process.env.TERMII_BASE_URL || '';
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || 'DOITFORME';
const OTP_DEV_MODE = process.env.OTP_DEV_MODE !== 'false';
const PAYSTACK_DEV_MODE = process.env.PAYSTACK_DEV_MODE === 'true' || (!process.env.PAYSTACK_SECRET_KEY && process.env.NODE_ENV !== 'production');
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID || '';
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY || '';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM || '';
const TWILIO_WHATSAPP_CONTENT_SID = process.env.TWILIO_WHATSAPP_CONTENT_SID || '';
const TERMII_CHANNEL = process.env.TERMII_CHANNEL || 'generic';
const PUBLIC = __dirname;
const trackingClients = new Map();
const routeRefresh = new Map();
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','agent','admin')),
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS agent_profiles (
  user_id INTEGER PRIMARY KEY,
  vehicle_type TEXT NOT NULL DEFAULT 'motorbike',
  plate_number TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('offline','available','busy')),
  verified INTEGER NOT NULL DEFAULT 0,
  current_lat REAL,
  current_lng REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS wallets (
  user_id INTEGER PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  reference TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  agent_id INTEGER,
  service TEXT NOT NULL,
  pickup TEXT NOT NULL,
  destination TEXT NOT NULL,
  destination_lat REAL,
  destination_lng REAL,
  pickup_lat REAL,
  pickup_lng REAL,
  description TEXT NOT NULL,
  timing TEXT NOT NULL DEFAULT 'ASAP',
  distance_km REAL NOT NULL DEFAULT 0,
  price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','in_progress','completed','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(agent_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS agent_location_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL,
  order_id INTEGER,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  accuracy REAL,
  speed REAL,
  heading REAL,
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(agent_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_location_history_order_time ON agent_location_history(order_id, recorded_at);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  actor_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(actor_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS otp_challenges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('register','login','phone_change')),
  provider TEXT NOT NULL DEFAULT 'local',
  provider_ref TEXT,
  code_hash TEXT,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_challenges(phone,purpose,created_at);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  order_id INTEGER,
  purpose TEXT NOT NULL CHECK(purpose IN ('order','wallet')),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NGN',
  reference TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'paystack',
  status TEXT NOT NULL DEFAULT 'pending',
  authorization_url TEXT,
  provider_id TEXT,
  paid_at TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id,created_at);
CREATE TABLE IF NOT EXISTS agent_kyc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id INTEGER NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitted','approved','rejected')),
  nin TEXT,
  id_type TEXT,
  id_number TEXT,
  vehicle_type TEXT,
  plate_number TEXT,
  address TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  id_document_path TEXT,
  selfie_path TEXT,
  vehicle_document_path TEXT,
  rejection_reason TEXT,
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(agent_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, order_id INTEGER, channel TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, data TEXT, read_at TEXT, sent_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_time ON notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id INTEGER PRIMARY KEY, push_enabled INTEGER NOT NULL DEFAULT 1, sms_enabled INTEGER NOT NULL DEFAULT 1,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 1, in_app_enabled INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS delivery_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, agent_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('photo','signature','recipient_id')), file_path TEXT NOT NULL, mime_type TEXT NOT NULL,
  note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY(agent_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_delivery_proofs_order ON delivery_proofs(order_id, created_at);
CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, customer_id INTEGER NOT NULL,
  reason TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','resolved','rejected')),
  resolution TEXT, resolved_by INTEGER, resolved_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY(customer_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(resolved_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status,created_at DESC);
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER, payment_id INTEGER, user_id INTEGER NOT NULL, amount INTEGER NOT NULL,
  reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','refunded','failed')),
  provider TEXT NOT NULL DEFAULT 'paystack', provider_reference TEXT, provider_response TEXT, processed_by INTEGER, processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL, FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE SET NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(processed_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id,created_at DESC);
CREATE TABLE IF NOT EXISTS notification_delivery_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, notification_id INTEGER, user_id INTEGER NOT NULL, order_id INTEGER, channel TEXT NOT NULL,
  provider TEXT, status TEXT NOT NULL, provider_message_id TEXT, response TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(notification_id) REFERENCES notifications(id) ON DELETE SET NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_notification_delivery_logs_time ON notification_delivery_logs(created_at DESC);
`);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(hash, 'hex'));
}
function b64url(v) { return Buffer.from(v).toString('base64url'); }
function signToken(payload) {
  const header = b64url(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function verifyToken(token) {
  const [h,b,s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  if (s.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
  let payload; try { payload = JSON.parse(Buffer.from(b, 'base64url').toString()); } catch { return null; }
  if (!payload.exp || payload.exp < Math.floor(Date.now()/1000)) return null;
  return payload;
}
function publicUser(u) { return {id:u.id,name:u.name,phone:u.phone,email:u.email||'',role:u.role,verified:Boolean(u.verified),created_at:u.created_at}; }
function money(n) { return Math.round(Number(n) || 0); }
function estimate(service, km) {
  const base = {'Pick & Deliver':1500,'Buy & Deliver':1800,'Errand':1200,'Home Service':2500,'Food':1000,'Moving':5000}[service] || 1500;
  return base + Math.max(0, Number(km)||0) * 180;
}
function json(res, status, body) { const out=JSON.stringify(body); res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'}); res.end(out); }
function parseBody(req) { return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>12e6) req.destroy();});req.on('end',()=>{if(!raw)return resolve({});try{resolve(JSON.parse(raw))}catch(e){reject(e)}});req.on('error',reject);}); }
function auth(req) { const p=verifyToken(String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')); if(!p)return null; return db.prepare('SELECT * FROM users WHERE id=?').get(p.sub) || null; }
function requireAuth(req,res) { const u=auth(req); if(!u){json(res,401,{error:'Authentication required'});return null;} return u; }
function requireAdmin(req,res) { const u=requireAuth(req,res); if(u && u.role!=='admin'){json(res,403,{error:'Admin access required'});return null;} return u; }
function audit(actor,action,entity,entityId,metadata={}) { db.prepare('INSERT INTO audit_logs(actor_id,action,entity,entity_id,metadata) VALUES(?,?,?,?,?)').run(actor?.id||null,action,entity,String(entityId||''),JSON.stringify(metadata)); }
function seed() {
  const admin = db.prepare('SELECT id FROM users WHERE phone=?').get('08000000001');
  if (!admin) {
    const info = db.prepare('INSERT INTO users(name,phone,password_hash,role,verified) VALUES(?,?,?,?,1)').run('DO IT FOR ME Admin','08000000001',hashPassword('Admin123!'),'admin');
    db.prepare('INSERT INTO wallets(user_id,balance) VALUES(?,0)').run(info.lastInsertRowid);
  }
}
seed();
// Backfill agent profiles for any existing agent accounts.
db.exec(`INSERT OR IGNORE INTO agent_profiles(user_id) SELECT id FROM users WHERE role='agent'`);
db.exec(`INSERT OR IGNORE INTO agent_kyc(agent_id,status) SELECT id,'pending' FROM users WHERE role='agent'`);
for (const col of ['destination_lat REAL','destination_lng REAL','pickup_lat REAL','pickup_lng REAL']) { try { db.exec(`ALTER TABLE orders ADD COLUMN ${col}`); } catch {} }
try { db.exec("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'"); } catch {}
for (const col of ["review_status TEXT NOT NULL DEFAULT 'pending'",'review_note TEXT','reviewed_by INTEGER','reviewed_at TEXT']) { try { db.exec(`ALTER TABLE delivery_proofs ADD COLUMN ${col}`); } catch {} }
for (const col of ['completion_confirmed INTEGER NOT NULL DEFAULT 0','completion_confirmed_at TEXT','completion_confirmed_by INTEGER']) { try { db.exec(`ALTER TABLE orders ADD COLUMN ${col}`); } catch {} }

function haversineKm(lat1,lng1,lat2,lng2){
  const R=6371, toRad=v=>v*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function routeCacheKey(orderId){return Number(orderId);}
function cachedRoute(orderId){return routeRefresh.get(routeCacheKey(orderId)) || null;}
function shouldRecalculate(orderId, lat, lng, dlat, dlng){
  const c=cachedRoute(orderId); if(!c) return true;
  const moved=haversineKm(c.lat,c.lng,lat,lng)*1000;
  const destMoved=haversineKm(c.dlat,c.dlng,dlat,dlng)*1000;
  return moved>=ROUTE_RECALC_METERS || destMoved>=25 || (Date.now()-c.at)>=ROUTE_REFRESH_SECONDS*1000;
}
async function managedRouteEstimate(orderId,lat,lng,dlat,dlng){
  const fallback=haversineKm(lat,lng,dlat,dlng);
  if(!MAPBOX_ACCESS_TOKEN){
    return {distance_km:fallback,duration_min:(fallback/25)*60,typical_duration_min:null,source:'estimate',traffic_aware:false,geometry:null,congestion:null};
  }
  const c=cachedRoute(orderId);
  if(c && !shouldRecalculate(orderId,lat,lng,dlat,dlng)) return c.result;
  try{
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),5000);
    const params=new URLSearchParams({access_token:MAPBOX_ACCESS_TOKEN,alternatives:'false',overview:'full',geometries:'geojson',annotations:'duration,distance,congestion_numeric',depart_at:'now'});
    const u=`https://api.mapbox.com/directions/v5/${MAPBOX_PROFILE}/${lng},${lat};${dlng},${dlat}?${params}`;
    const r=await fetch(u,{signal:controller.signal,headers:{'User-Agent':'DO-IT-FOR-ME/1.0'}}); clearTimeout(timer);
    if(r.ok){
      const j=await r.json(); const rt=j?.routes?.[0];
      if(rt){
        const congestion=rt.legs?.flatMap(l=>l.annotation?.congestion_numeric||[]).filter(v=>v!=null) || [];
        const result={distance_km:rt.distance/1000,duration_min:rt.duration/60,typical_duration_min:rt.duration_typical!=null?rt.duration_typical/60:null,source:'mapbox',traffic_aware:MAPBOX_PROFILE==='mapbox/driving-traffic',geometry:rt.geometry||null,congestion_average:congestion.length?Math.round(congestion.reduce((a,b)=>a+b,0)/congestion.length):null,refreshed_at:new Date().toISOString()};
        routeRefresh.set(routeCacheKey(orderId),{lat,lng,dlat,dlng,at:Date.now(),result});
        return result;
      }
    }
  }catch{}
  const result={distance_km:fallback,duration_min:(fallback/25)*60,typical_duration_min:null,source:'estimate',traffic_aware:false,geometry:null,congestion_average:null,refreshed_at:new Date().toISOString()};
  routeRefresh.set(routeCacheKey(orderId),{lat,lng,dlat,dlng,at:Date.now(),result});
  return result;
}
async function getTrackingMetrics(order,agent,force=false){
  if(!agent || agent.current_lat==null || agent.current_lng==null || order.destination_lat==null || order.destination_lng==null) return {distance_remaining_km:null,eta_minutes:null,typical_eta_minutes:null,route_source:null,traffic_aware:false,route_geometry:null};
  const lat=Number(agent.current_lat),lng=Number(agent.current_lng),dlat=Number(order.destination_lat),dlng=Number(order.destination_lng);
  if(force) routeRefresh.delete(routeCacheKey(order.id));
  const m=await managedRouteEstimate(order.id,lat,lng,dlat,dlng);
  return {distance_remaining_km:Number(m.distance_km.toFixed(2)),eta_minutes:Math.max(1,Math.round(m.duration_min)),typical_eta_minutes:m.typical_duration_min==null?null:Math.max(1,Math.round(m.typical_duration_min)),route_source:m.source,traffic_aware:Boolean(m.traffic_aware),route_geometry:m.geometry,congestion_average:m.congestion_average,refreshed_at:m.refreshed_at};
}
function broadcastRoutePoint(orderId,payload){ broadcastTracking(orderId,'location',payload); }

function broadcastTracking(orderId, event, data) {
  const clients = trackingClients.get(Number(orderId));
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try { client.write(payload); } catch {}
  }
}
function addTrackingClient(orderId, res) {
  const id = Number(orderId);
  if (!trackingClients.has(id)) trackingClients.set(id, new Set());
  trackingClients.get(id).add(res);
  const cleanup = () => { const set=trackingClients.get(id); if(set){set.delete(res);if(!set.size)trackingClients.delete(id);} };
  res.on('close', cleanup);
  return cleanup;
}

function serveStatic(req,res) {
  let pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === '/') pathname='/index.html';
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) return json(res,403,{error:'Forbidden'});
  fs.readFile(file,(err,data)=>{if(err){json(res,404,{error:'Not found'});return;} const ext=path.extname(file); const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'}; res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'});res.end(data);});
}


function ensureNotificationPrefs(userId){db.prepare('INSERT OR IGNORE INTO notification_preferences(user_id) VALUES(?)').run(userId);return db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(userId);}
function safeJson(v){try{return JSON.stringify(v||{});}catch{return '{}';}}
async function sendTermiiSms(to,message){if(!TERMII_API_KEY||!TERMII_BASE_URL)return {ok:false,provider:'termii',reason:'not_configured'};const r=await fetch(`${TERMII_BASE_URL.replace(/\/$/,'')}/api/sms/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:TERMII_API_KEY,to:normalizePhone(to),from:TERMII_SENDER_ID,sms:message,type:'plain',channel:TERMII_CHANNEL})});const j=await r.json().catch(()=>({}));return {ok:r.ok,provider:'termii',response:j};}
async function sendTwilioWhatsApp(to,message){if(!TWILIO_ACCOUNT_SID||!TWILIO_AUTH_TOKEN||!TWILIO_WHATSAPP_FROM)return {ok:false,provider:'twilio',reason:'not_configured'};const params=new URLSearchParams({From:TWILIO_WHATSAPP_FROM,To:`whatsapp:+${normalizePhone(to)}`});if(TWILIO_WHATSAPP_CONTENT_SID){params.set('ContentSid',TWILIO_WHATSAPP_CONTENT_SID);params.set('ContentVariables',JSON.stringify({'1':message}));}else params.set('Body',message);const auth=Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');const r=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,{method:'POST',headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/x-www-form-urlencoded'},body:params});const j=await r.json().catch(()=>({}));return {ok:r.ok,provider:'twilio',response:j};}
async function sendOneSignalPush(userId,title,body,data={}){if(!ONESIGNAL_APP_ID||!ONESIGNAL_API_KEY)return {ok:false,provider:'onesignal',reason:'not_configured'};const payload={app_id:ONESIGNAL_APP_ID,target_channel:'push',include_aliases:{external_id:[String(userId)]},headings:{en:title},contents:{en:body},data};const r=await fetch('https://api.onesignal.com/notifications',{method:'POST',headers:{Authorization:`Key ${ONESIGNAL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});const j=await r.json().catch(()=>({}));return {ok:r.ok,provider:'onesignal',response:j};}
function logNotificationDelivery(userId,orderId,channel,provider,status,notificationId=null,response=null,error=null){
  try{db.prepare('INSERT INTO notification_delivery_logs(notification_id,user_id,order_id,channel,provider,status,response,error) VALUES(?,?,?,?,?,?,?,?)').run(notificationId,userId,orderId,channel,provider,status,response?safeJson(response):null,error?String(error):null);}catch{}
}
async function notifyUser(userId,{title,body,orderId=null,data={},sms=true,whatsapp=true,push=true}){
  const prefs=ensureNotificationPrefs(userId),channels=[];
  if(prefs.in_app_enabled){const r=db.prepare('INSERT INTO notifications(user_id,order_id,channel,title,body,data,sent_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)').run(userId,orderId,'in_app',title,body,safeJson(data));channels.push({channel:'in_app',ok:true,id:r.lastInsertRowid});logNotificationDelivery(userId,orderId,'in_app','internal','sent',r.lastInsertRowid);}
  const user=db.prepare('SELECT id,phone FROM users WHERE id=?').get(userId);if(!user)return channels;
  if(sms&&prefs.sms_enabled){try{const r=await sendTermiiSms(user.phone,`${title}: ${body}`);const ir=db.prepare('INSERT INTO notifications(user_id,order_id,channel,title,body,data,sent_at) VALUES(?,?,?,?,?,?,?)').run(userId,orderId,'sms',title,body,safeJson(data),r.ok?new Date().toISOString():null);channels.push({channel:'sms',...r});logNotificationDelivery(userId,orderId,'sms','termii',r.ok?'sent':'failed',ir.lastInsertRowid,r.response,r.ok?null:r.reason||'provider_error');}catch(e){channels.push({channel:'sms',ok:false,error:e.message});logNotificationDelivery(userId,orderId,'sms','termii','failed',null,null,e.message);}}
  if(whatsapp&&prefs.whatsapp_enabled){try{const r=await sendTwilioWhatsApp(user.phone,`${title}: ${body}`);const ir=db.prepare('INSERT INTO notifications(user_id,order_id,channel,title,body,data,sent_at) VALUES(?,?,?,?,?,?,?)').run(userId,orderId,'whatsapp',title,body,safeJson(data),r.ok?new Date().toISOString():null);channels.push({channel:'whatsapp',...r});logNotificationDelivery(userId,orderId,'whatsapp','twilio',r.ok?'sent':'failed',ir.lastInsertRowid,r.response,r.ok?null:r.reason||'provider_error');}catch(e){channels.push({channel:'whatsapp',ok:false,error:e.message});logNotificationDelivery(userId,orderId,'whatsapp','twilio','failed',null,null,e.message);}}
  if(push&&prefs.push_enabled){try{const r=await sendOneSignalPush(userId,title,body,{...data,order_id:orderId});const ir=db.prepare('INSERT INTO notifications(user_id,order_id,channel,title,body,data,sent_at) VALUES(?,?,?,?,?,?,?)').run(userId,orderId,'push',title,body,safeJson(data),r.ok?new Date().toISOString():null);channels.push({channel:'push',...r});logNotificationDelivery(userId,orderId,'push','onesignal',r.ok?'sent':'failed',ir.lastInsertRowid,r.response,r.ok?null:r.reason||'provider_error');}catch(e){channels.push({channel:'push',ok:false,error:e.message});logNotificationDelivery(userId,orderId,'push','onesignal','failed',null,null,e.message);}}
  return channels;
}
async function notifyOrderParties(order,title,body,opts={}){const targets=[order.user_id];if(order.agent_id&&order.agent_id!==order.user_id)targets.push(order.agent_id);for(const uid of targets){try{await notifyUser(uid,{title,body,orderId:order.id,data:{public_id:order.public_id,status:order.status,...(opts.data||{})},sms:opts.sms!==false,whatsapp:opts.whatsapp!==false,push:opts.push!==false});}catch(e){console.error('notification error',e.message);}}}

function normalizePhone(phone) {
  const raw=String(phone||'').trim().replace(/\s+/g,'');
  if(raw.startsWith('+')) return raw.slice(1);
  if(raw.startsWith('234')) return raw;
  if(raw.startsWith('0')) return '234'+raw.slice(1);
  return raw;
}
function hashOtp(code) { return crypto.createHash('sha256').update(String(code)).digest('hex'); }
async function sendOtp(phone) {
  const normalized=normalizePhone(phone);
  if(TERMII_API_KEY && TERMII_BASE_URL) {
    const r=await fetch(`${TERMII_BASE_URL.replace(/\/$/,'')}/api/sms/otp/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:TERMII_API_KEY,message_type:'NUMERIC',to:normalized,from:TERMII_SENDER_ID,channel:'generic',pin_attempts:5,pin_time_to_live:10,pin_length:6,pin_placeholder:'< 123456 >',message_text:'Your DO IT FOR ME verification code is < 123456 >',pin_type:'NUMERIC'})});
    const j=await r.json().catch(()=>({})); if(!r.ok || !j.pinId && !j.pin_id) throw new Error(j.message||'Unable to send OTP');
    return {provider:'termii',ref:j.pinId||j.pin_id};
  }
  const code=String(crypto.randomInt(100000,1000000));
  return {provider:'local',ref:null,code};
}
async function verifyTermii(ref,code) {
  const r=await fetch(`${TERMII_BASE_URL.replace(/\/$/,'')}/api/sms/otp/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:TERMII_API_KEY,pin_id:ref,pin:String(code)})});
  const j=await r.json().catch(()=>({})); return r.ok && String(j.verified).toLowerCase()==='true';
}
async function createOtpChallenge(userId,phone,purpose) {
  db.prepare("UPDATE otp_challenges SET consumed=1 WHERE phone=? AND purpose=? AND consumed=0").run(String(phone).trim(),purpose);
  const sent=await sendOtp(phone); const expires=new Date(Date.now()+10*60*1000).toISOString();
  const localHash=sent.provider==='local'?hashOtp(sent.code):null;
  const r=db.prepare('INSERT INTO otp_challenges(user_id,phone,purpose,provider,provider_ref,code_hash,expires_at) VALUES(?,?,?,?,?,?,?)').run(userId||null,String(phone).trim(),purpose,sent.provider,sent.ref,localHash,expires);
  audit(null,'otp.sent','otp',r.lastInsertRowid,{purpose,phone:normalizePhone(phone),provider:sent.provider});
  return {id:r.lastInsertRowid,provider:sent.provider,dev_code:sent.provider==='local'&&OTP_DEV_MODE?sent.code:undefined,expires_at:expires};
}
async function verifyOtpChallenge(phone,purpose,code) {
  const c=db.prepare('SELECT * FROM otp_challenges WHERE phone=? AND purpose=? AND consumed=0 ORDER BY id DESC LIMIT 1').get(String(phone).trim(),purpose);
  if(!c) return {ok:false,error:'No active OTP. Request a new code.'};
  if(new Date(c.expires_at).getTime()<Date.now()) return {ok:false,error:'OTP has expired. Request a new code.'};
  if(c.attempts>=5) return {ok:false,error:'Too many OTP attempts. Request a new code.'};
  db.prepare('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=?').run(c.id);
  let ok=false;
  if(c.provider==='termii') ok=await verifyTermii(c.provider_ref,code);
  else ok=crypto.timingSafeEqual(Buffer.from(hashOtp(code)),Buffer.from(c.code_hash||''));
  if(!ok) return {ok:false,error:'Invalid OTP'};
  db.prepare('UPDATE otp_challenges SET consumed=1 WHERE id=?').run(c.id); return {ok:true,user_id:c.user_id};
}
async function paystackInitialize({user,amount,purpose,orderId}) {
  const email=String(user.email||'').trim(); if(!email) throw new Error('Email is required for Paystack payment. Add email in Profile first.');
  if(!PAYSTACK_SECRET_KEY && !PAYSTACK_DEV_MODE) throw new Error('Paystack is not configured. Add PAYSTACK_SECRET_KEY to .env or set PAYSTACK_DEV_MODE=true for local testing.');
  const reference=`DIFM-${Date.now()}-${crypto.randomInt(1000,9999)}`;
  const amountKobo=Math.round(Number(amount)*100);
  if(!Number.isFinite(amountKobo) || amountKobo < 10000) throw new Error('Minimum payment amount is ₦100');
  const metadata={user_id:user.id,purpose,order_id:orderId||null};
  // Dev mock: no real Paystack call — returns local checkout URL that completes via verify
  if(PAYSTACK_DEV_MODE && !PAYSTACK_SECRET_KEY) {
    const authUrl=`/?payment=success&reference=${encodeURIComponent(reference)}&dev=1`;
    const pr=db.prepare('INSERT INTO payments(user_id,order_id,purpose,amount,currency,reference,provider,status,authorization_url,metadata) VALUES(?,?,?,?,?,?,?,?,?,?)').run(user.id,orderId||null,purpose,Math.round(Number(amount)),PAYSTACK_CURRENCY,reference,'paystack_dev','pending',authUrl,JSON.stringify(metadata));
    return {payment_id:pr.lastInsertRowid,reference,authorization_url:authUrl,access_code:'DEV_MODE',dev_mode:true};
  }
  const payload={email,amount:String(amountKobo),currency:PAYSTACK_CURRENCY,reference,metadata,...(APP_BASE_URL?{callback_url:`${APP_BASE_URL.replace(/\/$/,'')}/?payment=success&reference=${encodeURIComponent(reference)}`}:{})};
  const r=await fetch('https://api.paystack.co/transaction/initialize',{method:'POST',headers:{Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}); const j=await r.json().catch(()=>({}));
  if(!r.ok || !j.status) throw new Error(j.message||'Paystack initialization failed');
  const d=j.data; const pr=db.prepare('INSERT INTO payments(user_id,order_id,purpose,amount,currency,reference,provider,status,authorization_url,metadata) VALUES(?,?,?,?,?,?,?,?,?,?)').run(user.id,orderId||null,purpose,Math.round(Number(amount)),PAYSTACK_CURRENCY,reference,'paystack','pending',d.authorization_url,JSON.stringify(metadata));
  return {payment_id:pr.lastInsertRowid,reference,authorization_url:d.authorization_url,access_code:d.access_code};
}
async function verifyPaystack(reference) {
  const p=db.prepare('SELECT * FROM payments WHERE reference=?').get(reference); if(!p) throw new Error('Payment reference not found.');
  // Dev mock payments
  if(p.provider==='paystack_dev' || (PAYSTACK_DEV_MODE && !PAYSTACK_SECRET_KEY)) {
    if(p.status==='success') return {success:true,status:'success',payment:p,dev_mode:true};
    db.prepare('UPDATE payments SET status=?,paid_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run('success',new Date().toISOString(),p.id);
    if(p.purpose==='wallet') {
      const exists=db.prepare('SELECT id FROM wallet_transactions WHERE reference=?').get(reference);
      if(!exists) {
        db.prepare('INSERT OR IGNORE INTO wallets(user_id,balance) VALUES(?,0)').run(p.user_id);
        db.prepare('UPDATE wallets SET balance=balance+? WHERE user_id=?').run(p.amount,p.user_id);
        db.prepare('INSERT INTO wallet_transactions(user_id,amount,type,reference) VALUES(?,?,?,?)').run(p.user_id,p.amount,'paystack_topup',reference);
      }
    }
    if(p.purpose==='order' && p.order_id) db.prepare("UPDATE orders SET payment_status='paid',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(p.order_id);
    const fresh=db.prepare('SELECT * FROM payments WHERE id=?').get(p.id);
    return {success:true,status:'success',payment:fresh,dev_mode:true};
  }
  if(!PAYSTACK_SECRET_KEY) throw new Error('Paystack is not configured.');
  const r=await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`}}); const j=await r.json().catch(()=>({}));
  if(!r.ok || !j.status) throw new Error(j.message||'Payment verification failed');
  const d=j.data; const success=d.status==='success' && Number(d.amount)===p.amount*100 && String(d.currency||PAYSTACK_CURRENCY)===PAYSTACK_CURRENCY;
  db.prepare('UPDATE payments SET status=?,provider_id=?,paid_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(success?'success':d.status||'failed',d.id?String(d.id):null,success?new Date().toISOString():null,p.id);
  if(success) {
    if(p.purpose==='wallet') { const exists=db.prepare('SELECT id FROM wallet_transactions WHERE reference=?').get(reference); if(!exists){db.prepare('UPDATE wallets SET balance=balance+? WHERE user_id=?').run(p.amount,p.user_id);db.prepare('INSERT INTO wallet_transactions(user_id,amount,type,reference) VALUES(?,?,?,?)').run(p.user_id,p.amount,'paystack_topup',reference);} }
    if(p.purpose==='order' && p.order_id) db.prepare("UPDATE orders SET payment_status='paid',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(p.order_id);
  }
  return {success,status:success?'success':d.status,payment:p};
}

async function route(req,res) {
  if (req.method==='OPTIONS') {res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'});return res.end();}
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/')) return serveStatic(req,res);

  if (req.method==='GET' && url.pathname.match(/^\/api\/orders\/[^/]+\/stream$/)) {
    const token = url.searchParams.get('token') || '';
    const u = verifyToken(token);
    if (!u) return json(res,401,{error:'Authentication required'});
    const publicId = url.pathname.split('/')[3];
    const o = db.prepare('SELECT * FROM orders WHERE public_id=?').get(publicId);
    if (!o) return json(res,404,{error:'Order not found'});
    if (u.role!=='admin' && o.user_id!==Number(u.sub) && o.agent_id!==Number(u.sub)) return json(res,403,{error:'Forbidden'});
    const agent = o.agent_id ? db.prepare(`SELECT u.id,u.name,u.phone,p.vehicle_type,p.plate_number,p.status,p.current_lat,p.current_lng,p.updated_at FROM users u JOIN agent_profiles p ON p.user_id=u.id WHERE u.id=?`).get(o.agent_id) : null;
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','Access-Control-Allow-Origin':'*'});
    const metrics=await getTrackingMetrics(o,agent);
    const history=db.prepare('SELECT lat,lng,accuracy,speed,heading,recorded_at FROM agent_location_history WHERE order_id=? ORDER BY recorded_at ASC').all(o.id);
    const proofs=db.prepare('SELECT id,kind,mime_type,note,created_at FROM delivery_proofs WHERE order_id=? ORDER BY created_at ASC').all(o.id);
    res.write(`event: snapshot\ndata: ${JSON.stringify({order:o,agent,metrics,history,proofs})}\n\n`);
    const cleanup=addTrackingClient(o.id,res);
    const heartbeat=setInterval(()=>{try{res.write(': heartbeat\n\n')}catch{}},15000);
    res.on('close',()=>clearInterval(heartbeat));
    return;
  }
  if(req.method==='POST' && url.pathname==='/api/payments/webhook') {
    let raw=''; try { for await (const chunk of req) { raw+=chunk; if(raw.length>2e6) return json(res,413,{error:'Webhook too large'}); } } catch { return json(res,400,{error:'Invalid webhook body'}); }
    const signature=String(req.headers['x-paystack-signature']||''); if(!PAYSTACK_SECRET_KEY||!signature)return json(res,401,{error:'Invalid webhook'});
    const expected=crypto.createHmac('sha512',PAYSTACK_SECRET_KEY).update(raw).digest('hex'); if(signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return json(res,401,{error:'Invalid webhook signature'});
    let event; try{event=JSON.parse(raw)}catch{return json(res,400,{error:'Invalid webhook JSON'});}
    if(event.event==='charge.success'&&event.data?.reference){try{await verifyPaystack(event.data.reference);}catch{}}
    return json(res,200,{received:true});
  }
  let body={}; try { if(['POST','PATCH'].includes(req.method)) body=await parseBody(req); } catch { return json(res,400,{error:'Invalid JSON'}); }

  try {
    if (req.method==='GET' && url.pathname==='/api/health') return json(res,200,{ok:true,service:'DO IT FOR ME API',time:new Date().toISOString()});
    if (req.method==='POST' && url.pathname==='/api/auth/register') {
      const {name,phone,email='',password}=body; if(!name||!phone||!password||String(password).length<6)return json(res,400,{error:'Name, phone and a 6+ character password are required'});
      if(email && !/^\S+@\S+\.\S+$/.test(String(email))) return json(res,400,{error:'Enter a valid email address'});
      if(db.prepare('SELECT id FROM users WHERE phone=?').get(String(phone).trim()))return json(res,409,{error:'Phone number already registered'});
      const r=db.prepare('INSERT INTO users(name,phone,email,password_hash,verified) VALUES(?,?,?,?,0)').run(String(name).trim(),String(phone).trim(),String(email).trim(),hashPassword(String(password)));
      db.prepare('INSERT INTO wallets(user_id,balance) VALUES(?,0)').run(r.lastInsertRowid);
      const challenge=await createOtpChallenge(r.lastInsertRowid,String(phone).trim(),'register');
      const u=db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
      return json(res,201,{user:publicUser(u),requires_verification:true,otp:challenge});
    }
    if (req.method==='POST' && url.pathname==='/api/auth/verify-phone') {
      const {phone,code,purpose='register'}=body; if(!phone||!code)return json(res,400,{error:'Phone and OTP code are required'});
      const result=await verifyOtpChallenge(String(phone).trim(),purpose,String(code).trim()); if(!result.ok)return json(res,400,{error:result.error});
      const u=db.prepare('SELECT * FROM users WHERE phone=?').get(String(phone).trim()); if(!u)return json(res,404,{error:'User not found'});
      db.prepare('UPDATE users SET verified=1 WHERE id=?').run(u.id); const fresh=db.prepare('SELECT * FROM users WHERE id=?').get(u.id); const token=signToken({sub:fresh.id,role:fresh.role,exp:Math.floor(Date.now()/1000)+60*60*24*7}); return json(res,200,{user:publicUser(fresh),token});
    }
    if (req.method==='POST' && url.pathname==='/api/auth/resend-otp') {
      const {phone,purpose='register'}=body; const u=db.prepare('SELECT id FROM users WHERE phone=?').get(String(phone||'').trim()); if(!u)return json(res,404,{error:'User not found'}); const challenge=await createOtpChallenge(u.id,String(phone).trim(),purpose); return json(res,200,{message:'OTP sent',otp:challenge});
    }
    if (req.method==='POST' && url.pathname==='/api/auth/login') {
      const {phone,password}=body; const u=db.prepare('SELECT * FROM users WHERE phone=?').get(String(phone||'').trim());
      if(!u||!verifyPassword(String(password||''),u.password_hash))return json(res,401,{error:'Invalid phone number or password'});
      if(!u.verified) { const challenge=await createOtpChallenge(u.id,u.phone,'login'); return json(res,403,{error:'Phone verification required',requires_verification:true,otp:challenge}); }
      const token=signToken({sub:u.id,role:u.role,exp:Math.floor(Date.now()/1000)+60*60*24*7}); return json(res,200,{user:publicUser(u),token});
    }
    if (req.method==='GET' && url.pathname==='/api/me') { const u=requireAuth(req,res); if(!u)return; const w=db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(u.id); return json(res,200,{user:publicUser(u),wallet:w?.balance||0}); }
    if (req.method==='PATCH' && url.pathname==='/api/me') { const u=requireAuth(req,res);if(!u)return; const email=String(body.email||'').trim(); if(email && !/^\S+@\S+\.\S+$/.test(email))return json(res,400,{error:'Enter a valid email address'}); db.prepare('UPDATE users SET email=? WHERE id=?').run(email,u.id); return json(res,200,{user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id))}); }
    if (req.method==='GET' && url.pathname==='/api/services') return json(res,200,{services:['Pick & Deliver','Buy & Deliver','Errand','Home Service','Food','Moving']});
    if (req.method==='POST' && url.pathname==='/api/orders/estimate') { const {service,distance_km}=body; return json(res,200,{price:estimate(service,distance_km)}); }
    if (req.method==='POST' && url.pathname==='/api/orders') {
      const u=requireAuth(req,res); if(!u)return; if(!u.verified)return json(res,403,{error:'Verify your phone before creating requests'}); const {service,from,to,description,timing='ASAP',distance_km=0,destination_lat,destination_lng,pickup_lat,pickup_lng}=body;
      if(!service||!from||!to||!description)return json(res,400,{error:'service, from, to and description are required'});
      const price=estimate(service,distance_km); const publicId='DIFM-'+Date.now().toString().slice(-8)+'-'+crypto.randomInt(100,999);
      const r=db.prepare('INSERT INTO orders(public_id,user_id,service,pickup,destination,destination_lat,destination_lng,pickup_lat,pickup_lng,description,timing,distance_km,price) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(publicId,u.id,service,from,to,Number.isFinite(Number(destination_lat))?Number(destination_lat):null,Number.isFinite(Number(destination_lng))?Number(destination_lng):null,Number.isFinite(Number(pickup_lat))?Number(pickup_lat):null,Number.isFinite(Number(pickup_lng))?Number(pickup_lng):null,description,timing,Number(distance_km)||0,price);
      db.prepare('INSERT INTO order_events(order_id,status,note,actor_id) VALUES(?,?,?,?)').run(r.lastInsertRowid,'pending','Request received',u.id); audit(u,'order.created','order',r.lastInsertRowid,{public_id:publicId,price});
      const order=db.prepare('SELECT * FROM orders WHERE id=?').get(r.lastInsertRowid); await notifyUser(u.id,{title:'Request received',body:`Your request ${publicId} has been received and is waiting for an agent.`,orderId:order.id,data:{public_id:publicId,status:'pending'}}); return json(res,201,{order});
    }
    if (req.method==='GET' && url.pathname==='/api/orders') {
      const u=requireAuth(req,res); if(!u)return; const sql=u.role==='admin'?'SELECT * FROM orders ORDER BY created_at DESC':'SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC'; const orders=u.role==='admin'?db.prepare(sql).all():db.prepare(sql).all(u.id); return json(res,200,{orders});
    }
    const om=url.pathname.match(/^\/api\/orders\/([^/]+)$/);
    if(req.method==='GET' && om){const u=requireAuth(req,res);if(!u)return;const o=db.prepare('SELECT * FROM orders WHERE public_id=?').get(om[1]);if(!o)return json(res,404,{error:'Order not found'});if(u.role!=='admin'&&o.user_id!==u.id)return json(res,403,{error:'Forbidden'});const events=db.prepare(`SELECT e.*,u.name actor_name,u.role actor_role FROM order_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.order_id=? ORDER BY e.created_at ASC`).all(o.id);const agent=o.agent_id?db.prepare(`SELECT u.id,u.name,u.phone,p.vehicle_type,p.plate_number,p.status,p.current_lat,p.current_lng,p.updated_at FROM users u JOIN agent_profiles p ON p.user_id=u.id WHERE u.id=?`).get(o.agent_id):null;const metrics=await getTrackingMetrics(o,agent);const history=o.agent_id?db.prepare('SELECT lat,lng,accuracy,speed,heading,recorded_at FROM agent_location_history WHERE order_id=? ORDER BY recorded_at ASC').all(o.id):[];const proofs=db.prepare('SELECT id,kind,mime_type,note,created_at FROM delivery_proofs WHERE order_id=? ORDER BY created_at ASC').all(o.id);return json(res,200,{order:o,events,agent,metrics,history,proofs});}
    if(req.method==='POST' && om && om[1] && url.pathname.endsWith('/cancel')) { /* unreachable due pattern above */ }
    const sm=url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
    if(req.method==='PATCH' && sm){const u=requireAdmin(req,res);if(!u)return;const o=db.prepare('SELECT * FROM orders WHERE public_id=?').get(sm[1]);if(!o)return json(res,404,{error:'Order not found'});const allowed=['pending','accepted','in_progress','completed','cancelled'];if(!allowed.includes(body.status))return json(res,400,{error:'Invalid status'});db.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(body.status,o.id);db.prepare('INSERT INTO order_events(order_id,status,note,actor_id) VALUES(?,?,?,?)').run(o.id,body.status,body.note||'Status updated by admin',u.id);audit(u,'order.status_changed','order',o.id,{from:o.status,to:body.status});return json(res,200,{order:db.prepare('SELECT * FROM orders WHERE id=?').get(o.id)});}

    if(req.method==='POST' && url.pathname==='/api/payments/initialize') {
      const u=requireAuth(req,res); if(!u)return; const amount=Number(body.amount); const purpose=body.purpose||'wallet'; const orderId=body.order_id?String(body.order_id):null; if(!Number.isFinite(amount)||amount<100)return json(res,400,{error:'Minimum payment is ₦100'}); if(!['wallet','order'].includes(purpose))return json(res,400,{error:'Invalid payment purpose'});
      let dbOrder=null; if(purpose==='order'){dbOrder=db.prepare('SELECT * FROM orders WHERE public_id=? AND user_id=?').get(orderId,u.id);if(!dbOrder)return json(res,404,{error:'Order not found'});if(dbOrder.payment_status==='paid')return json(res,409,{error:'Order is already paid'});if(amount!==Number(dbOrder.price))return json(res,400,{error:'Payment amount must match the request price'});}
      try { const p=await paystackInitialize({user:u,amount,purpose,orderId:dbOrder?.id}); return json(res,200,p); } catch(e){return json(res,502,{error:e.message});}
    }
    if(req.method==='GET' && url.pathname==='/api/payments/verify') {
      const u=requireAuth(req,res); if(!u)return; const ref=url.searchParams.get('reference'); if(!ref)return json(res,400,{error:'reference is required'}); const p=db.prepare('SELECT * FROM payments WHERE reference=?').get(ref); if(!p || (u.role!=='admin'&&p.user_id!==u.id))return json(res,403,{error:'Forbidden'}); try{return json(res,200,await verifyPaystack(ref));}catch(e){return json(res,502,{error:e.message});}
    }
    if(req.method==='GET' && url.pathname==='/api/agent/kyc') { const u=requireAuth(req,res);if(!u)return;if(u.role!=='agent')return json(res,403,{error:'Agent access required'});const k=db.prepare('SELECT * FROM agent_kyc WHERE agent_id=?').get(u.id)||null;return json(res,200,{kyc:k}); }
    if(req.method==='POST' && url.pathname==='/api/agent/kyc') { const u=requireAuth(req,res);if(!u)return;if(u.role!=='agent')return json(res,403,{error:'Agent access required'});const {nin,id_type,id_number,vehicle_type,plate_number,address,emergency_name,emergency_phone,id_document,selfie,vehicle_document}=body;if(!nin||!id_type||!id_number||!vehicle_type||!plate_number||!address)return json(res,400,{error:'NIN, ID details, vehicle and address are required'});const dir=path.join(__dirname,'data','kyc');fs.mkdirSync(dir,{recursive:true});function saveDoc(data,label){if(!data)return null;const m=String(data).match(/^data:([\w/+.-]+);base64,(.+)$/);if(!m||m[2].length>8e6)throw new Error('Invalid or oversized document');const ext=(m[1].split('/')[1]||'bin').replace(/[^a-z0-9]/gi,'');const file=`${u.id}-${Date.now()}-${label}.${ext}`;fs.writeFileSync(path.join(dir,file),Buffer.from(m[2],'base64'));return path.relative(__dirname,path.join(dir,file));}let docs={};try{docs={id_document_path:saveDoc(id_document,'id'),selfie_path:saveDoc(selfie,'selfie'),vehicle_document_path:saveDoc(vehicle_document,'vehicle')};}catch(e){return json(res,400,{error:e.message});}db.prepare(`INSERT INTO agent_kyc(agent_id,status,nin,id_type,id_number,vehicle_type,plate_number,address,emergency_name,emergency_phone,id_document_path,selfie_path,vehicle_document_path,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(agent_id) DO UPDATE SET status='submitted',nin=excluded.nin,id_type=excluded.id_type,id_number=excluded.id_number,vehicle_type=excluded.vehicle_type,plate_number=excluded.plate_number,address=excluded.address,emergency_name=excluded.emergency_name,emergency_phone=excluded.emergency_phone,id_document_path=COALESCE(excluded.id_document_path,agent_kyc.id_document_path),selfie_path=COALESCE(excluded.selfie_path,agent_kyc.selfie_path),vehicle_document_path=COALESCE(excluded.vehicle_document_path,agent_kyc.vehicle_document_path),rejection_reason=NULL,submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).run(u.id,'submitted',String(nin),String(id_type),String(id_number),String(vehicle_type),String(plate_number),String(address),String(emergency_name||''),String(emergency_phone||''),docs.id_document_path,docs.selfie_path,docs.vehicle_document_path);db.prepare('UPDATE agent_profiles SET vehicle_type=?,plate_number=?,verified=0 WHERE user_id=?').run(String(vehicle_type),String(plate_number),u.id);return json(res,200,{message:'KYC submitted for review',kyc:db.prepare('SELECT * FROM agent_kyc WHERE agent_id=?').get(u.id)}); }
    if(req.method==='GET' && url.pathname==='/api/admin/kyc') { const u=requireAdmin(req,res);if(!u)return;const rows=db.prepare(`SELECT k.*,u.name,u.phone,u.verified phone_verified FROM agent_kyc k JOIN users u ON u.id=k.agent_id ORDER BY CASE k.status WHEN 'submitted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,k.created_at DESC`).all();return json(res,200,{kyc:rows}); }
    const kycReview=url.pathname.match(/^\/api\/admin\/kyc\/(\d+)$/); if(req.method==='PATCH'&&kycReview){const u=requireAdmin(req,res);if(!u)return;const id=Number(kycReview[1]);const k=db.prepare('SELECT * FROM agent_kyc WHERE agent_id=?').get(id);if(!k)return json(res,404,{error:'KYC record not found'});if(!['approved','rejected'].includes(body.status))return json(res,400,{error:'status must be approved or rejected'});db.prepare('UPDATE agent_kyc SET status=?,rejection_reason=?,reviewed_at=CURRENT_TIMESTAMP,reviewed_by=?,updated_at=CURRENT_TIMESTAMP WHERE agent_id=?').run(body.status,body.status==='rejected'?String(body.reason||'Not approved'):null,u.id,id);db.prepare('UPDATE agent_profiles SET verified=? WHERE user_id=?').run(body.status==='approved'?1:0,id);audit(u,'agent.kyc_reviewed','user',id,{status:body.status});await notifyUser(id,{title:body.status==='approved'?'KYC approved':'KYC needs attention',body:body.status==='approved'?'Your agent KYC has been approved. You can now go online.':`Your agent KYC was rejected. ${String(body.reason||'Please review and resubmit your documents.')}`,data:{kyc_status:body.status}});return json(res,200,{kyc:db.prepare('SELECT * FROM agent_kyc WHERE agent_id=?').get(id)});}
    if(req.method==='GET' && url.pathname==='/api/agents'){const u=requireAdmin(req,res);if(!u)return;const agents=db.prepare(`SELECT u.id,u.name,u.phone,u.verified,u.created_at,p.vehicle_type,p.plate_number,p.status,p.current_lat,p.current_lng,p.updated_at FROM users u JOIN agent_profiles p ON p.user_id=u.id WHERE u.role='agent' ORDER BY u.created_at DESC`).all();return json(res,200,{agents});}
    if(req.method==='POST' && url.pathname==='/api/admin/agents'){const u=requireAdmin(req,res);if(!u)return;const {name,phone,password,vehicle_type='motorbike',plate_number=''}=body;if(!name||!phone||!password||String(password).length<6)return json(res,400,{error:'name, phone and 6+ character password are required'});if(db.prepare('SELECT id FROM users WHERE phone=?').get(String(phone).trim()))return json(res,409,{error:'Phone number already registered'});const r=db.prepare('INSERT INTO users(name,phone,password_hash,role,verified) VALUES(?,?,?,?,0)').run(String(name).trim(),String(phone).trim(),hashPassword(String(password)),'agent');db.prepare('INSERT INTO wallets(user_id,balance) VALUES(?,0)').run(r.lastInsertRowid);db.prepare("INSERT OR IGNORE INTO agent_kyc(agent_id,status) VALUES(?,?)").run(r.lastInsertRowid,'pending');db.prepare('INSERT INTO agent_profiles(user_id,vehicle_type,plate_number,status,verified) VALUES(?,?,?,?,0)').run(r.lastInsertRowid,String(vehicle_type),String(plate_number),'offline');audit(u,'agent.created','user',r.lastInsertRowid,{phone});return json(res,201,{agent:db.prepare(`SELECT u.id,u.name,u.phone,u.verified,p.vehicle_type,p.plate_number,p.status FROM users u JOIN agent_profiles p ON p.user_id=u.id WHERE u.id=?`).get(r.lastInsertRowid)});}
    if(req.method==='PATCH' && url.pathname.match(/^\/api\/admin\/agents\/\d+$/)){const u=requireAdmin(req,res);if(!u)return;const id=Number(url.pathname.split('/').pop());const a=db.prepare('SELECT id FROM users WHERE id=? AND role=\'agent\'').get(id);if(!a)return json(res,404,{error:'Agent not found'});if(body.status&&!['offline','available','busy'].includes(body.status))return json(res,400,{error:'Invalid agent status'});db.prepare('UPDATE agent_profiles SET status=COALESCE(?,status),verified=COALESCE(?,verified),updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(body.status??null,body.verified==null?null:(body.verified?1:0),id);audit(u,'agent.updated','user',id,body);return json(res,200,{agent:db.prepare(`SELECT u.id,u.name,u.phone,u.verified,p.vehicle_type,p.plate_number,p.status FROM users u JOIN agent_profiles p ON p.user_id=u.id WHERE u.id=?`).get(id)});}
    if(req.method==='GET' && url.pathname==='/api/agent/me'){const u=requireAuth(req,res);if(!u)return;if(u.role!=='agent')return json(res,403,{error:'Agent access required'});const p=db.prepare('SELECT * FROM agent_profiles WHERE user_id=?').get(u.id);const k=db.prepare('SELECT * FROM agent_kyc WHERE agent_id=?').get(u.id)||null;return json(res,200,{agent:{...publicUser(u),...p},kyc:k});}
    if(req.method==='PATCH' && url.pathname==='/api/agent/status'){const u=requireAuth(req,res);if(!u)return;if(u.role!=='agent')return json(res,403,{error:'Agent access required'});const status=body.status;if(!['offline','available','busy'].includes(status))return json(res,400,{error:'Invalid agent status'});if(['available','busy'].includes(status)){const a=db.prepare('SELECT verified FROM agent_profiles WHERE user_id=?').get(u.id);if(!u.verified||!a?.verified)return json(res,403,{error:'Phone verification and approved KYC are required before going online'});}db.prepare('UPDATE agent_profiles SET status=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(status,u.id);audit(u,'agent.status_changed','user',u.id,{status});return json(res,200,{status});}
    if(req.method==='GET' && url.pathname==='/api/agent/orders'){const u=requireAuth(req,res);if(!u)return;if(u.role!=='agent')return json(res,403,{error:'Agent access required'});const orders=db.prepare(`SELECT o.*,u.name customer_name,u.phone customer_phone FROM orders o JOIN users u ON u.id=o.user_id WHERE o.agent_id=? ORDER BY o.created_at DESC`).all(u.id);return json(res,200,{orders});}
    if(req.method==='PATCH' && url.pathname.match(/^\/api\/agent\/orders\/[^/]+\/status$/)){const u=requireAuth(req,res);if(!u)return;if(u.role!=='agent')return json(res,403,{error:'Agent access required'});const publicId=url.pathname.split('/')[4];const o=db.prepare('SELECT * FROM orders WHERE public_id=? AND agent_id=?').get(publicId,u.id);if(!o)return json(res,404,{error:'Assigned request not found'});const allowed=['accepted','in_progress','completed','cancelled'];if(!allowed.includes(body.status))return json(res,400,{error:'Invalid agent status update'});if(body.status==='completed'&&db.prepare('SELECT COUNT(*) c FROM delivery_proofs WHERE order_id=?').get(o.id).c<1)return json(res,409,{error:'Upload at least one proof of delivery photo or signature before completing this request'});db.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(body.status,o.id);db.prepare('INSERT INTO order_events(order_id,status,note,actor_id) VALUES(?,?,?,?)').run(o.id,body.status,body.note||'Updated by agent',u.id);const busy=body.status==='completed'||body.status==='cancelled'?'available':'busy';db.prepare('UPDATE agent_profiles SET status=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(busy,u.id);audit(u,'agent.order_status_changed','order',o.id,{to:body.status});broadcastTracking(o.id,'status',{status:body.status,note:body.note||'Updated by agent',agent_id:u.id});await notifyOrderParties({...o,status:body.status},body.status==='completed'?'Delivery completed — confirmation needed':`Request ${body.status.replace('_',' ')}`,body.status==='completed'?`Your agent uploaded proof of delivery. Please review it and confirm completion.`:`Request ${o.public_id} is now ${body.status.replace('_',' ')}.`);return json(res,200,{order:db.prepare('SELECT * FROM orders WHERE id=?').get(o.id)});}
    if(req.method==='PATCH' && url.pathname.match(/^\/api\/agent\/location$/)){const u=requireAuth(req,res);if(!u)return;if(u.role!=='agent')return json(res,403,{error:'Agent access required'});const lat=Number(body.lat),lng=Number(body.lng),accuracy=body.accuracy==null?null:Number(body.accuracy),speed=body.speed==null?null:Number(body.speed),heading=body.heading==null?null:Number(body.heading);if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return json(res,400,{error:'Valid lat and lng are required'});db.prepare('UPDATE agent_profiles SET current_lat=?,current_lng=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(lat,lng,u.id);const active=db.prepare(`SELECT * FROM orders WHERE agent_id=? AND status IN ('accepted','in_progress') ORDER BY updated_at DESC LIMIT 1`).get(u.id);const acc=Number.isFinite(accuracy)?accuracy:null,spd=Number.isFinite(speed)?speed:null,hdg=Number.isFinite(heading)?heading:null;const payload={agent_id:u.id,lat,lng,accuracy:acc,speed:spd,heading:hdg,updated_at:new Date().toISOString()};if(active){db.prepare('INSERT INTO agent_location_history(agent_id,order_id,lat,lng,accuracy,speed,heading) VALUES(?,?,?,?,?,?,?)').run(u.id,active.id,lat,lng,acc,spd,hdg);const metrics=await getTrackingMetrics(active,{current_lat:lat,current_lng:lng});payload.metrics=metrics;broadcastRoutePoint(active.id,payload);broadcastTracking(active.id,'route',metrics);}return json(res,200,payload);}
    if(req.method==='PATCH' && url.pathname.match(/^\/api\/orders\/[^/]+\/destination-location$/)){const u=requireAuth(req,res);if(!u)return;const publicId=url.pathname.split('/')[3];const o=db.prepare('SELECT * FROM orders WHERE public_id=?').get(publicId);if(!o)return json(res,404,{error:'Order not found'});if(o.user_id!==u.id&&u.role!=='admin')return json(res,403,{error:'Forbidden'});const lat=Number(body.lat),lng=Number(body.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return json(res,400,{error:'Valid lat and lng are required'});db.prepare('UPDATE orders SET destination_lat=?,destination_lng=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(lat,lng,o.id);routeRefresh.delete(routeCacheKey(o.id));broadcastTracking(o.id,'destination',{destination_lat:lat,destination_lng:lng});return json(res,200,{destination_lat:lat,destination_lng:lng});}
    if(req.method==='GET' && url.pathname.match(/^\/api\/orders\/[^/]+\/route-history$/)){const u=requireAuth(req,res);if(!u)return;const publicId=url.pathname.split('/')[3];const o=db.prepare('SELECT * FROM orders WHERE public_id=?').get(publicId);if(!o)return json(res,404,{error:'Order not found'});if(u.role!=='admin'&&o.user_id!==u.id&&o.agent_id!==u.id)return json(res,403,{error:'Forbidden'});const history=db.prepare('SELECT lat,lng,accuracy,speed,heading,recorded_at FROM agent_location_history WHERE order_id=? ORDER BY recorded_at ASC').all(o.id);return json(res,200,{history});}
    if(req.method==='POST' && url.pathname.match(/^\/api\/admin\/orders\/[^/]+\/assign$/)){const u=requireAdmin(req,res);if(!u)return;const publicId=url.pathname.split('/')[4];const agentId=Number(body.agent_id);const o=db.prepare('SELECT * FROM orders WHERE public_id=?').get(publicId);const a=db.prepare(`SELECT u.id,u.name,p.status FROM users u JOIN agent_profiles p ON p.user_id=u.id WHERE u.id=? AND u.role='agent'`).get(agentId);if(!o)return json(res,404,{error:'Order not found'});if(!a)return json(res,404,{error:'Agent not found'});if(a.status==='offline')return json(res,409,{error:'Agent is offline'});db.prepare('UPDATE orders SET agent_id=?,status=\'accepted\',updated_at=CURRENT_TIMESTAMP WHERE id=?').run(agentId,o.id);db.prepare('UPDATE agent_profiles SET status=\'busy\',updated_at=CURRENT_TIMESTAMP WHERE user_id=?').run(agentId);db.prepare('INSERT INTO order_events(order_id,status,note,actor_id) VALUES(?,?,?,?)').run(o.id,'accepted',`Assigned to ${a.name}`,u.id);audit(u,'order.assigned','order',o.id,{agent_id:agentId});broadcastTracking(o.id,'status',{status:'accepted',note:`Assigned to ${a.name}`,agent:a});await notifyOrderParties({...o,agent_id:agentId,status:'accepted'},'Agent assigned',`Agent ${a.name} has been assigned to request ${o.public_id}.`);return json(res,200,{order:db.prepare('SELECT * FROM orders WHERE id=?').get(o.id),agent:a});}
    if(req.method==='GET' && url.pathname.match(/^\/api\/admin\/orders\/[^/]+\/available-agents$/)){const u=requireAdmin(req,res);if(!u)return;const agents=db.prepare(`SELECT u.id,u.name,u.phone,p.vehicle_type,p.plate_number,p.status,p.current_lat,p.current_lng FROM users u JOIN agent_profiles p ON p.user_id=u.id WHERE u.role='agent' AND p.status!='offline' ORDER BY p.status DESC,u.name`).all();return json(res,200,{agents});}
    if(req.method==='POST' && url.pathname==='/api/wallet/topup') {const u=requireAuth(req,res);if(!u)return;const amount=money(body.amount);if(amount<500)return json(res,400,{error:'Minimum top-up is ₦500'});db.prepare('UPDATE wallets SET balance=balance+? WHERE user_id=?').run(amount,u.id);db.prepare('INSERT INTO wallet_transactions(user_id,amount,type,reference) VALUES(?,?,?,?)').run(u.id,amount,'credit','DEMO-'+Date.now());audit(u,'wallet.topup','wallet',u.id,{amount});const w=db.prepare('SELECT balance FROM wallets WHERE user_id=?').get(u.id);return json(res,200,{balance:w.balance,mode:'demo'});}
    if(req.method==='GET' && url.pathname==='/api/notifications/config'){return json(res,200,{onesignal_app_id:ONESIGNAL_APP_ID||null});}
    if(req.method==='GET' && url.pathname==='/api/notifications'){const u=requireAuth(req,res);if(!u)return;const rows=db.prepare("SELECT * FROM notifications WHERE user_id=? AND channel='in_app' ORDER BY created_at DESC LIMIT 100").all(u.id);return json(res,200,{notifications:rows,unread:rows.filter(x=>!x.read_at).length});}
    if(req.method==='PATCH' && url.pathname==='/api/notifications/read-all'){const u=requireAuth(req,res);if(!u)return;db.prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND channel='in_app' AND read_at IS NULL").run(u.id);return json(res,200,{ok:true});}
    if(req.method==='GET' && url.pathname==='/api/notification-preferences'){const u=requireAuth(req,res);if(!u)return;return json(res,200,{preferences:ensureNotificationPrefs(u.id)});}
    if(req.method==='PATCH' && url.pathname==='/api/notification-preferences'){const u=requireAuth(req,res);if(!u)return;ensureNotificationPrefs(u.id);db.prepare('UPDATE notification_preferences SET push_enabled=COALESCE(?,push_enabled),sms_enabled=COALESCE(?,sms_enabled),whatsapp_enabled=COALESCE(?,whatsapp_enabled),in_app_enabled=COALESCE(?,in_app_enabled) WHERE user_id=?').run(body.push_enabled==null?null:(body.push_enabled?1:0),body.sms_enabled==null?null:(body.sms_enabled?1:0),body.whatsapp_enabled==null?null:(body.whatsapp_enabled?1:0),body.in_app_enabled==null?null:(body.in_app_enabled?1:0),u.id);return json(res,200,{preferences:db.prepare('SELECT * FROM notification_preferences WHERE user_id=?').get(u.id)});}
    if(req.method==='GET' && url.pathname.match(/^\/api\/orders\/[^/]+\/proof$/)){const u=requireAuth(req,res);if(!u)return;const publicId=url.pathname.split('/')[3];const o=db.prepare('SELECT * FROM orders WHERE public_id=?').get(publicId);if(!o)return json(res,404,{error:'Order not found'});if(u.role!=='admin'&&o.user_id!==u.id&&o.agent_id!==u.id)return json(res,403,{error:'Forbidden'});return json(res,200,{proofs:db.prepare('SELECT id,kind,mime_type,note,created_at FROM delivery_proofs WHERE order_id=? ORDER BY created_at ASC').all(o.id)});}
    if(req.method==='GET' && url.pathname.match(/^\/api\/orders\/[^/]+\/proof\/\d+$/)){const qtoken=url.searchParams.get('token'),u=qtoken?verifyToken(qtoken):auth(req);if(!u)return json(res,401,{error:'Authentication required'});const parts=url.pathname.split('/'),publicId=parts[3],proofId=Number(parts[5]);const o=db.prepare('SELECT * FROM orders WHERE public_id=?').get(publicId),pr=db.prepare('SELECT * FROM delivery_proofs WHERE id=? AND order_id=?').get(proofId,o?.id||0);if(!o||!pr)return json(res,404,{error:'Proof not found'});if(u.role!=='admin'&&o.user_id!==u.sub&&o.agent_id!==u.sub)return json(res,403,{error:'Forbidden'});const file=path.join(__dirname,pr.file_path);if(!fs.existsSync(file))return json(res,404,{error:'Proof file missing'});res.writeHead(200,{'Content-Type':pr.mime_type,'Cache-Control':'private,max-age=3600'});return fs.createReadStream(file).pipe(res);}
    if(req.method==='POST' && url.pathname.match(/^\/api\/agent\/orders\/[^/]+\/proof$/)){const u=requireAuth(req,res);if(!u)return;if(u.role!=='agent')return json(res,403,{error:'Agent access required'});const publicId=url.pathname.split('/')[4],o=db.prepare('SELECT * FROM orders WHERE public_id=? AND agent_id=?').get(publicId,u.id);if(!o)return json(res,404,{error:'Assigned request not found'});const {kind,file,note=''}=body;if(!['photo','signature','recipient_id'].includes(kind))return json(res,400,{error:'Invalid proof kind'});const m=String(file||'').match(/^data:([\w/+.-]+);base64,(.+)$/);if(!m)return json(res,400,{error:'Provide a base64 data URL'});if(m[2].length>10e6)return json(res,413,{error:'Proof file is too large'});const dir=path.join(__dirname,'data','proofs');fs.mkdirSync(dir,{recursive:true});const ext=(m[1].split('/')[1]||'bin').replace(/[^a-z0-9]/gi,'');const filename=`${o.id}-${u.id}-${Date.now()}-${kind}.${ext}`,abs=path.join(dir,filename);fs.writeFileSync(abs,Buffer.from(m[2],'base64'));const rel=path.relative(__dirname,abs),r=db.prepare('INSERT INTO delivery_proofs(order_id,agent_id,kind,file_path,mime_type,note) VALUES(?,?,?,?,?,?)').run(o.id,u.id,kind,rel,m[1],String(note));audit(u,'delivery.proof_uploaded','order',o.id,{kind,proof_id:r.lastInsertRowid});broadcastTracking(o.id,'proof',{proof_id:r.lastInsertRowid,kind});return json(res,201,{proof:{id:r.lastInsertRowid,kind,mime_type:m[1],note,created_at:new Date().toISOString()}});}
    if(req.method==='POST' && url.pathname.match(/^\/api\/orders\/[^/]+\/confirm-completion$/)){const u=requireAuth(req,res);if(!u)return;const publicId=url.pathname.split('/')[3],o=db.prepare('SELECT * FROM orders WHERE public_id=?').get(publicId);if(!o)return json(res,404,{error:'Order not found'});if(o.user_id!==u.id)return json(res,403,{error:'Customer access required'});if(o.status!=='completed')return json(res,409,{error:'Delivery has not been marked completed by the agent'});if(o.completion_confirmed)return json(res,200,{order:o,message:'Already confirmed'});const count=db.prepare('SELECT COUNT(*) c FROM delivery_proofs WHERE order_id=?').get(o.id).c;if(!count)return json(res,409,{error:'No proof of delivery is attached yet'});db.prepare('UPDATE orders SET completion_confirmed=1,completion_confirmed_at=CURRENT_TIMESTAMP,completion_confirmed_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(u.id,o.id);db.prepare('INSERT INTO order_events(order_id,status,note,actor_id) VALUES(?,?,?,?)').run(o.id,'completed','Customer confirmed delivery completion',u.id);audit(u,'delivery.completion_confirmed','order',o.id);await notifyOrderParties({...o,completion_confirmed:1},'Delivery confirmed',`Customer confirmed request ${o.public_id} as completed.`);broadcastTracking(o.id,'completion',{confirmed:true});return json(res,200,{order:db.prepare('SELECT * FROM orders WHERE id=?').get(o.id)});}
    if(req.method==='GET' && url.pathname==='/api/routing/config'){const u=requireAuth(req,res);if(!u)return;return json(res,200,{provider:MAPBOX_ACCESS_TOKEN?'mapbox':'fallback',profile:MAPBOX_PROFILE,recalc_meters:ROUTE_RECALC_METERS,refresh_seconds:ROUTE_REFRESH_SECONDS});}
    // Admin operations: cancellations, refunds, disputes, notification logs, proof review, audit trail.
    if(req.method==='POST' && url.pathname.match(/^\/api\/admin\/orders\/[^/]+\/cancel$/)){const u=requireAdmin(req,res);if(!u)return;const publicId=url.pathname.split('/')[4],o=db.prepare('SELECT * FROM orders WHERE public_id=?').get(publicId);if(!o)return json(res,404,{error:'Order not found'});if(['completed','cancelled'].includes(o.status))return json(res,409,{error:'Order cannot be cancelled in its current state'});const reason=String(body.reason||'Cancelled by admin');db.prepare("UPDATE orders SET status='cancelled',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id);db.prepare('INSERT INTO order_events(order_id,status,note,actor_id) VALUES(?,?,?,?)').run(o.id,'cancelled',reason,u.id);if(o.agent_id)db.prepare("UPDATE agent_profiles SET status='available',updated_at=CURRENT_TIMESTAMP WHERE user_id=?").run(o.agent_id);audit(u,'order.cancelled','order',o.id,{reason});await notifyOrderParties({...o,status:'cancelled'},'Request cancelled',`Request ${o.public_id} was cancelled. ${reason}`);broadcastTracking(o.id,'status',{status:'cancelled',note:reason});return json(res,200,{order:db.prepare('SELECT * FROM orders WHERE id=?').get(o.id)});}
    if(req.method==='GET' && url.pathname==='/api/admin/refunds'){const u=requireAdmin(req,res);if(!u)return;return json(res,200,{refunds:db.prepare(`SELECT r.*,o.public_id,u.name,u.phone,p.reference payment_reference FROM refunds r LEFT JOIN orders o ON o.id=r.order_id JOIN users u ON u.id=r.user_id LEFT JOIN payments p ON p.id=r.payment_id ORDER BY r.created_at DESC LIMIT 200`).all()});}
    if(req.method==='POST' && url.pathname.match(/^\/api\/admin\/orders\/[^/]+\/refund$/)){const u=requireAdmin(req,res);if(!u)return;const publicId=url.pathname.split('/')[4],o=db.prepare('SELECT * FROM orders WHERE public_id=?').get(publicId);if(!o)return json(res,404,{error:'Order not found'});const p=db.prepare("SELECT * FROM payments WHERE order_id=? AND status='success' ORDER BY created_at DESC LIMIT 1").get(o.id);if(!p)return json(res,409,{error:'No successful payment found for this request'});const amount=money(body.amount||p.amount);if(amount<1||amount>p.amount)return json(res,400,{error:'Refund amount must be between 1 and the paid amount'});const rr=db.prepare('INSERT INTO refunds(order_id,payment_id,user_id,amount,reason,status,provider) VALUES(?,?,?,?,?,?,?)').run(o.id,p.id,o.user_id,amount,String(body.reason||'Admin refund'),'processing','paystack');let result={ok:false};try{if(!PAYSTACK_SECRET_KEY)throw new Error('Paystack is not configured');const r=await fetch('https://api.paystack.co/refund',{method:'POST',headers:{Authorization:`Bearer ${PAYSTACK_SECRET_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({transaction:p.reference,amount:Math.round(amount*100)})});const j=await r.json().catch(()=>({}));result={ok:r.ok&&j.status!==false,response:j};db.prepare('UPDATE refunds SET status=?,provider_response=?,provider_reference=?,processed_by=?,processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(result.ok?'refunded':'failed',safeJson(j),j?.data?.id?String(j.data.id):null,u.id,rr.lastInsertRowid);}catch(e){result={ok:false,error:e.message};db.prepare('UPDATE refunds SET status=\'failed\',provider_response=?,processed_by=?,processed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(safeJson({error:e.message}),u.id,rr.lastInsertRowid);}audit(u,'refund.processed','order',o.id,{refund_id:rr.lastInsertRowid,amount,status:result.ok?'refunded':'failed'});if(result.ok){await notifyOrderParties({...o},'Refund processed',`A refund of ₦${amount.toLocaleString()} has been processed for request ${o.public_id}.`);}return json(res,result.ok?200:502,{refund:db.prepare('SELECT * FROM refunds WHERE id=?').get(rr.lastInsertRowid),provider:result});}
    if(req.method==='GET' && url.pathname==='/api/admin/disputes'){const u=requireAdmin(req,res);if(!u)return;return json(res,200,{disputes:db.prepare(`SELECT d.*,o.public_id,o.service,u.name,u.phone FROM disputes d JOIN orders o ON o.id=d.order_id JOIN users u ON u.id=d.customer_id ORDER BY CASE d.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END,d.created_at DESC LIMIT 200`).all()});}
    if(req.method==='PATCH' && url.pathname.match(/^\/api\/admin\/disputes\/\d+$/)){const u=requireAdmin(req,res);if(!u)return;const id=Number(url.pathname.split('/').pop()),d=db.prepare('SELECT * FROM disputes WHERE id=?').get(id);if(!d)return json(res,404,{error:'Dispute not found'});if(!['open','investigating','resolved','rejected'].includes(body.status))return json(res,400,{error:'Invalid dispute status'});db.prepare('UPDATE disputes SET status=?,resolution=?,resolved_by=?,resolved_at=CASE WHEN ? IN (\'resolved\',\'rejected\') THEN CURRENT_TIMESTAMP ELSE NULL END,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(body.status,String(body.resolution||''),u.id,body.status,id);audit(u,'dispute.updated','dispute',id,{status:body.status,resolution:body.resolution||''});const o=db.prepare('SELECT * FROM orders WHERE id=?').get(d.order_id);if(o)await notifyUser(d.customer_id,{title:'Dispute update',body:`Your dispute for ${o.public_id} is now ${body.status}. ${body.resolution||''}`,orderId:o.id,data:{dispute_id:id,status:body.status}});return json(res,200,{dispute:db.prepare('SELECT * FROM disputes WHERE id=?').get(id)});}
    if(req.method==='GET' && url.pathname==='/api/admin/notification-logs'){const u=requireAdmin(req,res);if(!u)return;return json(res,200,{logs:db.prepare(`SELECT l.*,u.name,u.phone,o.public_id FROM notification_delivery_logs l JOIN users u ON u.id=l.user_id LEFT JOIN orders o ON o.id=l.order_id ORDER BY l.created_at DESC LIMIT 300`).all()});}
    if(req.method==='GET' && url.pathname==='/api/admin/proofs'){const u=requireAdmin(req,res);if(!u)return;return json(res,200,{proofs:db.prepare(`SELECT p.*,o.public_id,o.service,u.name customer_name,a.name agent_name FROM delivery_proofs p JOIN orders o ON o.id=p.order_id JOIN users u ON u.id=o.user_id JOIN users a ON a.id=p.agent_id ORDER BY p.created_at DESC LIMIT 300`).all()});}
    if(req.method==='PATCH' && url.pathname.match(/^\/api\/admin\/proofs\/\d+$/)){const u=requireAdmin(req,res);if(!u)return;const id=Number(url.pathname.split('/').pop()),p=db.prepare('SELECT * FROM delivery_proofs WHERE id=?').get(id);if(!p)return json(res,404,{error:'Proof not found'});if(!['approved','rejected','pending'].includes(body.review_status))return json(res,400,{error:'Invalid review status'});db.prepare('UPDATE delivery_proofs SET review_status=?,review_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(body.review_status,String(body.note||''),u.id,id);audit(u,'delivery.proof_reviewed','proof',id,{status:body.review_status});const o=db.prepare('SELECT * FROM orders WHERE id=?').get(p.order_id);if(o)await notifyOrderParties({...o},'Proof of delivery review',`Proof #${id} was ${body.review_status} by operations.`);return json(res,200,{proof:db.prepare('SELECT * FROM delivery_proofs WHERE id=?').get(id)});}
    if(req.method==='GET' && url.pathname==='/api/admin/audit-logs'){const u=requireAdmin(req,res);if(!u)return;return json(res,200,{logs:db.prepare(`SELECT a.*,u.name actor_name,u.role actor_role FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 500`).all()});}
    if(req.method==='POST' && url.pathname.match(/^\/api\/orders\/[^/]+\/disputes$/)){const u=requireAuth(req,res);if(!u)return;const publicId=url.pathname.split('/')[4],o=db.prepare('SELECT * FROM orders WHERE public_id=? AND user_id=?').get(publicId,u.id);if(!o)return json(res,404,{error:'Order not found'});if(!body.reason)return json(res,400,{error:'Reason is required'});const r=db.prepare('INSERT INTO disputes(order_id,customer_id,reason,description) VALUES(?,?,?,?)').run(o.id,u.id,String(body.reason),String(body.description||''));audit(u,'dispute.created','order',o.id,{dispute_id:r.lastInsertRowid});await notifyUser(u.id,{title:'Dispute received',body:`Your dispute for ${o.public_id} has been submitted.`,orderId:o.id,data:{dispute_id:r.lastInsertRowid}});return json(res,201,{dispute:db.prepare('SELECT * FROM disputes WHERE id=?').get(r.lastInsertRowid)});}
    if(req.method==='GET' && url.pathname==='/api/admin/stats'){const u=requireAdmin(req,res);if(!u)return;const total=db.prepare('SELECT COUNT(*) c FROM orders').get().c;const active=db.prepare("SELECT COUNT(*) c FROM orders WHERE status NOT IN ('completed','cancelled')").get().c;const customers=db.prepare("SELECT COUNT(*) c FROM users WHERE role='customer'").get().c;return json(res,200,{totalOrders:total,activeOrders:active,customers});}
    if(req.method==='GET' && url.pathname==='/api/admin/users'){const u=requireAdmin(req,res);if(!u)return;return json(res,200,{users:db.prepare('SELECT id,name,phone,role,verified,created_at FROM users ORDER BY created_at DESC').all()});}
    return json(res,404,{error:'API route not found'});
  } catch(e) { console.error(e); return json(res,500,{error:'Server error',detail:process.env.NODE_ENV==='production'?undefined:e.message}); }
}

http.createServer(route).listen(PORT,HOST,()=>console.log(`DO IT FOR ME API running at http://localhost:${PORT}`));
process.on('SIGINT',()=>{db.close();process.exit(0)});
