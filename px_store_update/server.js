/**
 * Palengke Express: zero-dependency local demo backend.
 * Run: node server.js   then visit http://localhost:3000
 * This is a prototype: no authentication, authorization, or production-grade privacy protections.
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'orders.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const SHEET_URL = process.env.GOOGLE_SHEET_WEBHOOK_URL || '';
const SHEET_SECRET = process.env.GOOGLE_SHEET_WEBHOOK_SECRET || '';
let users = [];
try { users = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); if (!Array.isArray(users)) users=[]; } catch (_) {}
const sessions = new Map();
function saveUsers(){ const tmp=USERS_PATH+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(users,null,2),{mode:0o600}); fs.renameSync(tmp,USERS_PATH); }
function hashPassword(password,salt){ return crypto.pbkdf2Sync(password,salt,210000,32,'sha256').toString('hex'); }
function auth(req){ const token=(req.headers.authorization||'').match(/^Bearer ([a-f0-9]{64})$/)?.[1]; const item=token && sessions.get(token); return item && users.find(u=>u.id===item) || null; }
function userView(u){return {id:u.id,name:u.name,email:u.email,role:u.role,phone:u.phone||'',profile:u.profile||{},approvalStatus:u.approvalStatus||'approved',createdAt:u.createdAt||'',reviewedAt:u.reviewedAt||'',reviewedBy:u.reviewedBy||'',passwordProtected:true,passwordResetAt:u.passwordResetAt||''};}
function cookieFreeToken(user){ const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,user.id); return token; }

function ensureAdmin(){
  const email=(process.env.ADMIN_EMAIL||'admin@palengkeexpress.local').toLowerCase();
  const password=process.env.ADMIN_PASSWORD||'Admin12345!';
  let admin=users.find(u=>u.role==='admin');
  if(!admin){
    const salt=crypto.randomBytes(16).toString('hex');
    admin={id:crypto.randomUUID(),role:'admin',name:'Palengke Express Admin',email,phone:'',profile:{},approvalStatus:'approved',salt,passwordHash:hashPassword(password,salt),createdAt:new Date().toISOString()};
    users.push(admin);saveUsers();
    console.log('Demo admin created:',email,'(change ADMIN_EMAIL / ADMIN_PASSWORD for real use)');
  }
}
ensureAdmin();

function ensureTesterAccounts(){
  // Development-only tester accounts. If a tester account is deleted, it is recreated on the next server start.
  // All three use the password requested for this demo: Abc123!
  const password='Abc123!';
  const seeds=[
    {
      role:'customer', name:'Customer Tester', email:'customer@example.test', phone:'09171234567',
      profile:{}, approvalStatus:'approved'
    },
    {
      role:'seller', name:'Seller Tester', email:'seller@example.test', phone:'09181234567', approvalStatus:'approved',
      profile:{
        storeName:'Tester Fresh Market Stall', storeLocation:'Tanauan City Public Market',
        registrationType:'DTI', registrationNumber:'TEST-DTI-001', tin:'TEST-TIN-001',
        businessPermit:'TEST-PERMIT-001', validIdType:'PhilSys ID', validIdNumber:'TEST-ID-SELLER-001'
      }
    },
    {
      role:'driver', name:'Driver Tester', email:'driver@example.test', phone:'09191234567', approvalStatus:'approved',
      profile:{
        licenseNumber:'TEST-LICENSE-001', licenseType:'Professional', licenseExpiry:'2028-12-31',
        motorcycleType:'Motorcycle', plateNumber:'TEST-123', vehicleModel:'Honda Click 125', orcrNumber:'TEST-ORCR-001'
      }
    }
  ];
  let changed=false;
  for(const seed of seeds){
    let account=users.find(u=>u.email===seed.email && u.role===seed.role);
    if(!account){
      const salt=crypto.randomBytes(16).toString('hex');
      account={id:crypto.randomUUID(),...seed,salt,passwordHash:hashPassword(password,salt),createdAt:new Date().toISOString()};
      users.push(account); changed=true;
      continue;
    }
    // Keep tester credentials predictable for classroom/demo use.
    const salt=crypto.randomBytes(16).toString('hex');
    account.name=seed.name; account.phone=seed.phone; account.profile={...(account.profile||{}),...seed.profile};
    account.approvalStatus='approved'; account.salt=salt; account.passwordHash=hashPassword(password,salt);
    account.passwordResetAt=new Date().toISOString(); changed=true;
  }
  if(changed) saveUsers();
}
ensureTesterAccounts();

function ensureSellerCommerce(seller){
  if(!seller || seller.role!=='seller') return;
  seller.profile = seller.profile || {};
  let changed=false;
  if(!Array.isArray(seller.profile.products)){
    seller.profile.products = seller.email==='seller@example.test'
      ? PRODUCTS.slice(0,8).map((p,i)=>({...p,id:`${seller.id.slice(0,8)}-${p.id}`,stock:20+i*3,active:true}))
      : [];
    changed=true;
  }
  if(!seller.profile.storeSettings || typeof seller.profile.storeSettings!=='object'){
    seller.profile.storeSettings={mode:'manual',manualOpen:true,openTime:'06:00',closeTime:'18:00',days:[0,1,2,3,4,5,6]};
    changed=true;
  }
  if(seller.email==='seller@example.test' && !validateLocation(seller.profile.storeCoordinates)){
    seller.profile.storeCoordinates={lat:MARKET.lat,lng:MARKET.lng,updatedAt:new Date().toISOString()};
    changed=true;
  }
  if(changed) saveUsers();
}
function manilaClock(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const get=t=>parts.find(p=>p.type===t)?.value;
  const dayMap={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return {day:dayMap[get('weekday')],minutes:Number(get('hour'))*60+Number(get('minute'))};
}
function storeOpenInfo(seller){
  ensureSellerCommerce(seller);
  const st=seller.profile.storeSettings;
  if(st.mode!=='auto') return {isOpen:!!st.manualOpen,reason:st.manualOpen?'Open now':'Closed by seller'};
  const now=manilaClock();
  const toM=t=>{const [h,m]=String(t||'00:00').split(':').map(Number);return h*60+m;};
  const open=toM(st.openTime),close=toM(st.closeTime),days=Array.isArray(st.days)?st.days:[0,1,2,3,4,5,6];
  const scheduled=days.includes(now.day) && (close>open ? now.minutes>=open && now.minutes<close : (now.minutes>=open || now.minutes<close));
  return {isOpen:scheduled,reason:scheduled?'Open by schedule':`Closed · opens ${st.openTime||'06:00'}`};
}
function sellerProducts(seller){ ensureSellerCommerce(seller); return seller.profile.products.filter(p=>p && p.active!==false); }
function approvedStores(){ return users.filter(u=>u.role==='seller' && (u.approvalStatus||'pending')==='approved').map(u=>{const open=storeOpenInfo(u),products=sellerProducts(u),coords=validateLocation(u.profile?.storeCoordinates)||MARKET;return {id:u.id,name:u.profile?.storeName||u.name,ownerName:u.name,location:u.profile?.storeLocation||'Tanauan City Public Market',coordinates:coords,hasExactLocation:!!validateLocation(u.profile?.storeCoordinates),phone:u.phone||'',createdAt:u.createdAt||'',isOpen:open.isOpen,openReason:open.reason,productCount:products.filter(p=>Number(p.stock)>0).length,storeSettings:u.profile.storeSettings};}); }
function productsForUser(user){
  if(user.role==='seller'){ensureSellerCommerce(user);return user.profile.products.map(p=>({...p,sellerId:user.id}));}
  if(user.role==='customer') return users.filter(u=>u.role==='seller'&&(u.approvalStatus||'pending')==='approved').flatMap(u=>sellerProducts(u).map(p=>({...p,sellerId:u.id})));
  return [];
}
function sessionOrders(user){ if(user.role==='customer') return orders.filter(o=>o.customerId===user.id); if(user.role==='seller') return orders.filter(o=>!o.sellerId || o.sellerId===user.id); if(user.role==='driver') return orders.filter(o=>o.rider?.id===user.id || o.status==='awaiting_driver'); return orders; }
function userSnapshot(user){return {orders:sessionOrders(user),stores:approvedStores(),products:productsForUser(user),...(user.role==='admin'?{users:users.map(userView)}:{}),version,updatedAt:new Date().toISOString()};}
function sheetEvent(type,user,extra={}) {
  if(!SHEET_URL) return;
  const payload=JSON.stringify({secret:SHEET_SECRET,event:type,timestamp:new Date().toISOString(),userId:user.id,role:user.role,name:user.name,email:user.email,...extra});
  // No passwords, hashes, access tokens or location coordinates are sent to Sheets.
  fetch(SHEET_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:payload,signal:AbortSignal.timeout(12000)})
    .then(r=>{if(!r.ok)console.error('Sheets webhook HTTP',r.status);}).catch(e=>console.error('Sheets webhook failed:',e.message));
}


// Public Market pin cross-checked against public mapping listings. Sample drop-off pins are illustrative.
const MARKET = Object.freeze({ lat: 14.08204, lng: 121.14672, address: 'Tanauan City Public Market, Tanauan, Batangas' });
const LOCATIONS = Object.freeze([
  { id: 'poblacion', name: 'Poblacion, Tanauan', address: 'Poblacion 3, Tanauan City', lat: 14.0860, lng: 121.1518 },
  { id: 'darasa', name: 'Darasa', address: 'Brgy. Darasa, Tanauan City', lat: 14.1008, lng: 121.1492 },
  { id: 'sambat', name: 'Sambat', address: 'Brgy. Sambat, Tanauan City', lat: 14.0963, lng: 121.1408 },
  { id: 'janopol', name: 'Janopol', address: 'Brgy. Janopol, Tanauan City', lat: 14.0696, lng: 121.1207 },
  { id: 'banadero', name: 'Bañadero', address: 'Brgy. Bañadero, Tanauan City', lat: 14.1048, lng: 121.1301 }
]);
const PRODUCTS = Object.freeze([
  { id: 'tomato', name: 'Fresh Tomatoes', category: 'Vegetables', unit: '1 kg', price: 90, emoji: '🍅', tone: '#fcefeb' },
  { id: 'pechay', name: 'Fresh Pechay', category: 'Vegetables', unit: '1 bundle', price: 35, emoji: '🥬', tone: '#e8f5df' },
  { id: 'carrot', name: 'Carrots', category: 'Vegetables', unit: '1 kg', price: 100, emoji: '🥕', tone: '#fff1df' },
  { id: 'eggplant', name: 'Eggplant', category: 'Vegetables', unit: '1 kg', price: 85, emoji: '🍆', tone: '#eeeaf7' },
  { id: 'pork', name: 'Pork Kasim', category: 'Meat', unit: '1 kg', price: 330, emoji: '🥩', tone: '#faecea' },
  { id: 'chicken', name: 'Fresh Chicken', category: 'Meat', unit: '1 kg', price: 210, emoji: '🍗', tone: '#fff3e5' },
  { id: 'tilapia', name: 'Fresh Tilapia', category: 'Fish', unit: '1 kg', price: 160, emoji: '🐟', tone: '#e6f3fc' },
  { id: 'shrimp', name: 'Fresh Shrimp', category: 'Fish', unit: '500 g', price: 230, emoji: '🦐', tone: '#fff0e9' },
  { id: 'mango', name: 'Sweet Mangoes', category: 'Fruits', unit: '1 kg', price: 180, emoji: '🥭', tone: '#fff4d9' },
  { id: 'banana', name: 'Saba Bananas', category: 'Fruits', unit: '1 bunch', price: 85, emoji: '🍌', tone: '#fdf8df' },
  { id: 'rice', name: 'Premium Rice', category: 'Pantry', unit: '1 kg', price: 58, emoji: '🍚', tone: '#f2f1eb' },
  { id: 'eggs', name: 'Farm Fresh Eggs', category: 'Pantry', unit: '6 pieces', price: 60, emoji: '🥚', tone: '#fff1de' }
]);
const DELIVERY_FEE = 40;
const RIDER = Object.freeze({ id: 'rider-marco', name: 'Marco Santos', vehicle: 'Motorcycle' });
const STATUS = ['pending', 'accepted', 'ready', 'awaiting_driver', 'driver_assigned', 'picked_up', 'en_route', 'delivered', 'rejected'];
const ACTIONS = {
  accept: { role: 'seller', from: 'pending', to: 'accepted' },
  reject: { role: 'seller', from: 'pending', to: 'rejected' },
  mark_ready: { role: 'seller', from: 'accepted', to: 'ready' },
  book_driver: { role: 'seller', from: 'ready', to: 'awaiting_driver' },
  accept_job: { role: 'driver', from: 'awaiting_driver', to: 'driver_assigned' },
  pickup: { role: 'driver', from: 'driver_assigned', to: 'picked_up' },
  start_delivery: { role: 'driver', from: 'picked_up', to: 'en_route' },
  delivered: { role: 'driver', from: 'en_route', to: 'delivered' }
};
fs.mkdirSync(DATA_DIR, { recursive: true });
let orders = [];
try {
  if (fs.existsSync(DB_PATH)) {
    const loaded = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    orders = Array.isArray(loaded) ? loaded : [];
  }
} catch (err) { console.error('Could not read order data:', err.message); }
const subscribers = new Map();
let version = 0;
function persist() {
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, DB_PATH);
}
function snapshot() { return { orders, version, updatedAt: new Date().toISOString() }; }
function broadcast() {
  version++;
  for (const [s,userId] of subscribers) {
    try { const u=users.find(u=>u.id===userId); if(!u){subscribers.delete(s);continue;} s.write(`event: update\ndata: ${JSON.stringify(userSnapshot(u))}\n\n`); } catch (_) { subscribers.delete(s); }
  }
}
function respond(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function error(res, code, message) { respond(res, code, { error: message }); }
async function parseBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64_000) throw new Error('Request exceeds maximum size');
  }
  try { return JSON.parse(body || '{}'); } catch (_) { throw new Error('Invalid JSON'); }
}
function validateLocation(p) {
  const lat = Number(p?.lat), lng = Number(p?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 13.5 || lat > 14.5 || lng < 120.8 || lng > 121.6) return null;
  return { lat, lng };
}
function haversineMeters(a,b){
  if(!a||!b) return null;
  const R=6371000,toRad=d=>d*Math.PI/180;
  const dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng),lat1=toRad(a.lat),lat2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(h)));
}
const clean = (v, length = 120) => String(v || '').trim().slice(0, length);
function orderResponse(req, res, url) {
  if (req.method==='POST' && url.pathname==='/api/auth/signup') return parseBody(req).then(b=>{
    const role=clean(b.role,20),name=clean(b.name,80),email=clean(b.email,160).toLowerCase(),password=String(b.password||''),phone=clean(b.phone,20);
    if(!['customer','seller','driver'].includes(role)) return error(res,400,'Choose a valid account type.');
    if(name.length<2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<10 || password.length>128 || phone.length<7) return error(res,400,'Provide a name, mobile number, valid email and a password with at least 10 characters.');
    if(users.some(u=>u.email===email)) return error(res,409,'This email is already registered.');
    const c=b.credentials||{}; let profile={};
    if(role==='seller'){
      profile={storeName:clean(c.storeName,100),storeLocation:clean(c.storeLocation,180),registrationType:clean(c.registrationType,50),registrationNumber:clean(c.registrationNumber,80),tin:clean(c.tin,30),businessPermit:clean(c.businessPermit,80),validIdType:clean(c.validIdType,50),validIdNumber:clean(c.validIdNumber,80)};
      if(Object.values(profile).some(v=>!v)) return error(res,400,'Complete all seller business and ID credentials.');
    }
    if(role==='driver'){
      profile={licenseNumber:clean(c.licenseNumber,80),licenseType:clean(c.licenseType,30),licenseExpiry:clean(c.licenseExpiry,20),motorcycleType:clean(c.motorcycleType,50),plateNumber:clean(c.plateNumber,30),vehicleModel:clean(c.vehicleModel,100),orcrNumber:clean(c.orcrNumber,80)};
      if(Object.values(profile).some(v=>!v)) return error(res,400,'Complete all driver license and motorcycle credentials.');
    }
    const salt=crypto.randomBytes(16).toString('hex');
    const approvalStatus=role==='customer'?'approved':'pending';
    const user={id:crypto.randomUUID(),role,name,email,phone,profile,approvalStatus,salt,passwordHash:hashPassword(password,salt),createdAt:new Date().toISOString()};
    users.push(user);saveUsers();
    const sheetProfile=role==='seller'?{phone,storeName:profile.storeName,storeLocation:profile.storeLocation,registrationType:profile.registrationType}:role==='driver'?{phone,licenseType:profile.licenseType,motorcycleType:profile.motorcycleType,vehicleModel:profile.vehicleModel,plateNumber:profile.plateNumber}:{phone};
    sheetEvent('signup',user,{...sheetProfile,approvalStatus}); broadcast();
    if(approvalStatus==='pending') return respond(res,201,{pending:true,user:userView(user),message:'Registration submitted. Please wait for admin approval before logging in.'});
    const token=cookieFreeToken(user); return respond(res,201,{token,user:userView(user)});
  }).catch(e=>error(res,400,e.message));
  if (req.method==='POST' && url.pathname==='/api/auth/login') return parseBody(req).then(b=>{
    const email=clean(b.email,160).toLowerCase(),role=clean(b.role,20),password=String(b.password||'');
    const user=users.find(u=>u.email===email && u.role===role);
    if(!user || !crypto.timingSafeEqual(Buffer.from(user.passwordHash,'hex'),Buffer.from(hashPassword(password,user.salt),'hex'))) return error(res,401,'Incorrect account type, email or password.');
    if(['seller','driver'].includes(user.role) && (user.approvalStatus||'pending')!=='approved') return error(res,403,user.approvalStatus==='rejected'?'Your account was rejected by the admin. Please contact support or register again with corrected credentials.':'Your account is still pending admin approval.');
    const token=cookieFreeToken(user);sheetEvent('login',user);return respond(res,200,{token,user:userView(user)});
  }).catch(e=>error(res,400,e.message));
  const user=auth(req) || (url.pathname==='/api/events' && users.find(u=>u.id===sessions.get(url.searchParams.get('token'))));
  if(!user) return error(res,401,'Please log in first.');
  if(req.method==='POST' && url.pathname==='/api/auth/logout') {
    sessions.delete(req.headers.authorization.slice(7)); return respond(res,200,{ok:true});
  }
  if(req.method==='GET' && url.pathname==='/api/auth/me') return respond(res,200,{user:userView(user)});

  if(req.method==='PATCH' && url.pathname==='/api/account/profile') return parseBody(req).then(body=>{
    if(user.role!=='customer') return error(res,403,'Customer access required.');
    const email=clean(body.email,160).toLowerCase();
    const phone=clean(body.phone,20);
    const address=clean(body.address,180);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(res,400,'Enter a valid email address.');
    if(phone.length<7) return error(res,400,'Enter a valid mobile number.');
    if(address.length<5) return error(res,400,'Enter your delivery address.');
    if(users.some(u=>u.id!==user.id && u.email===email)) return error(res,409,'That email is already registered to another account.');
    user.email=email; user.phone=phone; user.profile=user.profile||{}; user.profile.deliveryAddress=address; user.updatedAt=new Date().toISOString();
    saveUsers(); sheetEvent('customer_profile_updated',user,{phone,addressUpdated:true}); broadcast();
    return respond(res,200,{user:userView(user)});
  }).catch(e=>error(res,400,e.message));

  if(req.method==='POST' && url.pathname==='/api/account/change-password') return parseBody(req).then(body=>{
    if(user.role!=='customer') return error(res,403,'Customer access required.');
    const currentPassword=String(body.currentPassword||'');
    const newPassword=String(body.newPassword||'');
    const currentHash=hashPassword(currentPassword,user.salt);
    if(!crypto.timingSafeEqual(Buffer.from(user.passwordHash,'hex'),Buffer.from(currentHash,'hex'))) return error(res,401,'Current password is incorrect.');
    if(newPassword.length<7 || newPassword.length>128) return error(res,400,'New password must contain at least 7 characters.');
    const salt=crypto.randomBytes(16).toString('hex'); user.salt=salt; user.passwordHash=hashPassword(newPassword,salt); user.passwordResetAt=new Date().toISOString();
    saveUsers(); sheetEvent('customer_password_changed',user);
    return respond(res,200,{ok:true,message:'Password changed successfully.'});
  }).catch(e=>error(res,400,e.message));

  if(req.method==='GET' && url.pathname==='/api/admin/users') {
    if(user.role!=='admin') return error(res,403,'Admin access required.');
    return respond(res,200,{users:users.map(userView).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))});
  }
  const approvalPath=url.pathname.match(/^\/api\/admin\/users\/([a-f0-9-]+)\/approval$/i);
  if(req.method==='POST' && approvalPath) return parseBody(req).then(body=>{
    if(user.role!=='admin') return error(res,403,'Admin access required.');
    const target=users.find(u=>u.id===approvalPath[1]);
    if(!target) return error(res,404,'Account not found.');
    if(!['seller','driver'].includes(target.role)) return error(res,400,'Only seller and driver accounts require approval.');
    const decision=clean(body.decision,20);
    if(!['approved','rejected'].includes(decision)) return error(res,400,'Decision must be approved or rejected.');
    target.approvalStatus=decision; target.reviewedAt=new Date().toISOString(); target.reviewedBy=user.id; saveUsers();
    sheetEvent('account_'+decision,target,{approvalStatus:decision,reviewedBy:user.email}); broadcast();
    return respond(res,200,{user:userView(target)});
  }).catch(e=>error(res,400,e.message));

  const passwordResetPath=url.pathname.match(/^\/api\/admin\/users\/([a-f0-9-]+)\/reset-password$/i);
  if(req.method==='POST' && passwordResetPath) return parseBody(req).then(body=>{
    if(user.role!=='admin') return error(res,403,'Admin access required.');
    const target=users.find(u=>u.id===passwordResetPath[1]);
    if(!target) return error(res,404,'Account not found.');
    if(target.role==='admin') return error(res,400,'Use ADMIN_PASSWORD on the server to change the administrator password.');
    const newPassword=String(body.newPassword||'');
    if(newPassword.length<10 || newPassword.length>128) return error(res,400,'New password must contain at least 10 characters.');
    const salt=crypto.randomBytes(16).toString('hex');
    target.salt=salt; target.passwordHash=hashPassword(newPassword,salt); target.passwordResetAt=new Date().toISOString();
    saveUsers();
    sheetEvent('password_reset_by_admin',target,{resetBy:user.email});
    // The temporary password is returned once in this response only. It is never stored in readable form.
    return respond(res,200,{ok:true,user:userView(target),temporaryPassword:newPassword,message:'Password reset. This temporary password is shown only now; the previous password can no longer be used.'});
  }).catch(e=>error(res,400,e.message));

  const deleteUserPath=url.pathname.match(/^\/api\/admin\/users\/([a-f0-9-]+)$/i);
  if(req.method==='DELETE' && deleteUserPath){
    if(user.role!=='admin') return error(res,403,'Admin access required.');
    const target=users.find(u=>u.id===deleteUserPath[1]);
    if(!target) return error(res,404,'Account not found.');
    if(target.role==='admin') return error(res,400,'The administrator account cannot be deleted from the dashboard.');
    const snapshotForLog={...target};
    users=users.filter(u=>u.id!==target.id);
    for(const [token,userId] of sessions){ if(userId===target.id) sessions.delete(token); }
    saveUsers();
    sheetEvent('account_deleted_by_admin',snapshotForLog,{deletedBy:user.email});
    broadcast();
    return respond(res,200,{ok:true,message:`${target.role} account deleted.`});
  }


  if(req.method==='POST' && url.pathname==='/api/seller/products') return parseBody(req).then(body=>{
    if(user.role!=='seller') return error(res,403,'Seller access required.');
    ensureSellerCommerce(user);
    const name=clean(body.name,100),category=clean(body.category,40),unit=clean(body.unit,40),emoji=clean(body.emoji,8)||'🧺';
    const price=Number(body.price),stock=Number(body.stock);
    if(!name||!category||!unit||!Number.isFinite(price)||price<=0||price>100000||!Number.isInteger(stock)||stock<0||stock>100000) return error(res,400,'Enter a valid product name, category, unit, price and stock.');
    const product={id:crypto.randomUUID(),name,category,unit,price:Math.round(price*100)/100,stock,emoji,tone:'#eef7f1',active:true,createdAt:new Date().toISOString()};
    user.profile.products.unshift(product);saveUsers();sheetEvent('seller_product_added',user,{productId:product.id,productName:name,price:product.price,stock});broadcast();
    return respond(res,201,{product});
  }).catch(e=>error(res,400,e.message));

  const sellerProductPath=url.pathname.match(/^\/api\/seller\/products\/([a-f0-9-]+)$/i);
  if(req.method==='PATCH' && sellerProductPath) return parseBody(req).then(body=>{
    if(user.role!=='seller') return error(res,403,'Seller access required.');
    ensureSellerCommerce(user); const product=user.profile.products.find(p=>p.id===sellerProductPath[1]);
    if(!product) return error(res,404,'Product not found.');
    if(body.name!==undefined){const v=clean(body.name,100);if(!v)return error(res,400,'Product name is required.');product.name=v;}
    if(body.category!==undefined) product.category=clean(body.category,40)||product.category;
    if(body.unit!==undefined) product.unit=clean(body.unit,40)||product.unit;
    if(body.emoji!==undefined) product.emoji=clean(body.emoji,8)||'🧺';
    if(body.price!==undefined){const v=Number(body.price);if(!Number.isFinite(v)||v<=0||v>100000)return error(res,400,'Invalid price.');product.price=Math.round(v*100)/100;}
    if(body.stock!==undefined){const v=Number(body.stock);if(!Number.isInteger(v)||v<0||v>100000)return error(res,400,'Invalid stock.');product.stock=v;}
    product.updatedAt=new Date().toISOString();saveUsers();sheetEvent('seller_product_updated',user,{productId:product.id,productName:product.name,price:product.price,stock:product.stock});broadcast();return respond(res,200,{product});
  }).catch(e=>error(res,400,e.message));
  if(req.method==='DELETE' && sellerProductPath){
    if(user.role!=='seller') return error(res,403,'Seller access required.');
    ensureSellerCommerce(user); const idx=user.profile.products.findIndex(p=>p.id===sellerProductPath[1]);if(idx<0)return error(res,404,'Product not found.');
    const [removed]=user.profile.products.splice(idx,1);saveUsers();sheetEvent('seller_product_removed',user,{productId:removed.id,productName:removed.name});broadcast();return respond(res,200,{ok:true});
  }
  if(req.method==='POST' && url.pathname==='/api/seller/store-settings') return parseBody(req).then(body=>{
    if(user.role!=='seller') return error(res,403,'Seller access required.'); ensureSellerCommerce(user);
    const mode=clean(body.mode,10); if(!['manual','auto'].includes(mode))return error(res,400,'Choose manual or automatic store hours.');
    const validTime=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v||''));
    const openTime=String(body.openTime||user.profile.storeSettings.openTime||'06:00'),closeTime=String(body.closeTime||user.profile.storeSettings.closeTime||'18:00');
    if(!validTime(openTime)||!validTime(closeTime))return error(res,400,'Use valid opening and closing times.');
    const days=Array.isArray(body.days)?[...new Set(body.days.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=6))]:user.profile.storeSettings.days;
    if(mode==='auto'&&!days.length)return error(res,400,'Choose at least one open day.');
    user.profile.storeSettings={mode,manualOpen:body.manualOpen!==undefined?!!body.manualOpen:!!user.profile.storeSettings.manualOpen,openTime,closeTime,days};saveUsers();
    const open=storeOpenInfo(user);sheetEvent('seller_store_settings',user,{mode,manualOpen:user.profile.storeSettings.manualOpen,openTime,closeTime,days:days.join(','),isOpen:open.isOpen});broadcast();return respond(res,200,{storeSettings:user.profile.storeSettings,isOpen:open.isOpen,openReason:open.reason});
  }).catch(e=>error(res,400,e.message));


  if(req.method==='POST' && url.pathname==='/api/seller/store-location') return parseBody(req).then(body=>{
    if(user.role!=='seller') return error(res,403,'Seller access required.');
    const pos=validateLocation(body); if(!pos) return error(res,400,'Could not save this store GPS position. Make sure location permission is enabled and you are within the service area.');
    user.profile=user.profile||{}; user.profile.storeCoordinates={...pos,updatedAt:new Date().toISOString()}; saveUsers();
    sheetEvent('seller_store_location_updated',user,{storeLocation:user.profile?.storeLocation||''}); broadcast();
    return respond(res,200,{coordinates:pos});
  }).catch(e=>error(res,400,e.message));

  if (req.method === 'GET' && url.pathname === '/api/state') {
    return respond(res, 200, { ...userSnapshot(user), market: MARKET, locations: LOCATIONS, rider: RIDER, deliveryFee: DELIVERY_FEE });
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 1800\n\nevent: update\ndata: ${JSON.stringify(userSnapshot(user))}\n\n`);
    subscribers.set(res,user.id);
    const ping = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch (_) { } }, 20000);
    req.on('close', () => { clearInterval(ping); subscribers.delete(res); });
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/orders') {
    return parseBody(req).then(body => {
      if(user.role!=='customer')return error(res,403,'Only customers can place orders.');
      const customerName=user.name;
      const customerId=user.id;
      const seller=users.find(u=>u.id===clean(body.sellerId,80) && u.role==='seller' && (u.approvalStatus||'pending')==='approved');
      if(!seller) return error(res,400,'Choose an approved seller store before placing your order.');
      const storeState=storeOpenInfo(seller); if(!storeState.isOpen) return error(res,409,'This store is currently closed. Please order during the seller’s opening hours.');
      ensureSellerCommerce(seller);
      const address = clean(body.destination?.address, 180);
      const coords = validateLocation(body.destination);
      if (!customerName || !customerId || !address || !coords) return error(res, 400, 'Name, customer ID and valid delivery destination are required.');
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) return error(res, 400, 'Choose at least one product.');
      const items = [];
      for (const i of body.items) {
        const product = seller.profile.products.find(p => p.id === i.productId && p.active!==false);
        const qty = Number(i.quantity);
        if (!product || !Number.isInteger(qty) || qty < 1 || qty > 50) return error(res, 400, 'Invalid product or quantity.');
        if(Number(product.stock)<qty) return error(res,409,`${product.name} only has ${product.stock} item(s) left in stock.`);
        const found = items.find(x => x.productId === product.id);
        if (found) {
          found.quantity += qty;
          if (found.quantity > 50) return error(res, 400, 'Too many items of one product.');
        } else items.push({ productId: product.id, name: product.name, emoji: product.emoji, unit: product.unit, quantity: qty, price: product.price });
      }
      const subtotal = items.reduce((n, i) => n + i.price * i.quantity, 0);
      const now = new Date().toISOString();
      const order = {
        id: `PX-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
        customerId, customerName, sellerId:seller.id, sellerName:seller.name, storeName:seller.profile?.storeName||seller.name, storeLocation:seller.profile?.storeLocation||MARKET.address,
        pickupLocation: validateLocation(seller.profile?.storeCoordinates)||MARKET,
        items, subtotal, deliveryFee: DELIVERY_FEE, total: subtotal + DELIVERY_FEE,
        destination: { ...coords, address }, notes: clean(body.notes, 350), status: 'pending',
        createdAt: now, updatedAt: now, rider: null, riderLocation: null, trackingMode: null, nearCustomerAt:null, distanceToTargetMeters:null, trackingTarget:'seller',
        history: [{ status: 'pending', time: now }]
      };
      orders.unshift(order);
      for(const item of items){ const p=seller.profile.products.find(x=>x.id===item.productId); if(p)p.stock=Math.max(0,Number(p.stock||0)-item.quantity); }
      saveUsers();
      persist();
      broadcast(); sheetEvent('order_placed',user,{orderId:order.id,status:order.status,total:order.total});
      return respond(res, 201, { order });
    }).catch(e => error(res, 400, e.message));
  }
  const actionPath = url.pathname.match(/^\/api\/orders\/([a-zA-Z0-9-]+)\/action$/);
  if (req.method === 'POST' && actionPath) {
    return parseBody(req).then(body => {
      const order = orders.find(o => o.id === actionPath[1]);
      if (!order) return error(res, 404, 'Order not found.');
      const rule = ACTIONS[body.action];
      if (!rule || rule.role !== user.role) return error(res, 403, 'Action not allowed for this account.');
      if(user.role==='seller' && order.sellerId && order.sellerId!==user.id) return error(res,403,'This order belongs to another seller store.');
      if(user.role==='driver' && body.action!=='accept_job' && order.rider?.id!==user.id) return error(res,403,'This delivery belongs to another driver.');
      if (order.status !== rule.from) return error(res, 409, `Order is currently ${order.status}. Refresh and try again.`);
      if (body.action === 'accept_job' && orders.some(o => o.id !== order.id && o.rider?.id === user.id && !['delivered', 'rejected'].includes(o.status))) {
        return error(res, 409, 'Rider already has an active delivery.');
      }
      order.status = rule.to;
      order.updatedAt = new Date().toISOString();
      order.history.push({ status: order.status, time: order.updatedAt });
      if (body.action === 'book_driver') {
        // A booking request is sent to the rider queue; rider must accept it explicitly.
        order.rider = null; // Unassigned booking is offered to all registered drivers.
      }
      if (body.action === 'accept_job') {
        order.rider = { id:user.id,name:user.name,vehicle:user.profile?.vehicleModel||user.profile?.motorcycleType||'Motorcycle' };
        order.riderLocation = null;
        order.trackingMode = 'waiting';
        order.trackingTarget = 'seller';
      }
      if (body.action === 'pickup') order.trackingTarget = 'seller';
      if (body.action === 'start_delivery') { order.trackingMode = order.trackingMode==='gps'?'gps':'waiting'; order.trackingTarget='customer'; }
      persist(); broadcast(); sheetEvent('order_status',user,{orderId:order.id,status:order.status,action:body.action});
      return respond(res, 200, { order });
    }).catch(e => error(res, 400, e.message));
  }
  const gpsPath = url.pathname.match(/^\/api\/orders\/([a-zA-Z0-9-]+)\/location$/);
  if (req.method === 'POST' && gpsPath) {
    return parseBody(req).then(body => {
      const order = orders.find(o => o.id === gpsPath[1]);
      if (!order) return error(res, 404, 'Order not found.');
      if (user.role !== 'driver' || order.rider?.id !== user.id) return error(res, 403, 'Rider assignment required.');
      if (!['driver_assigned', 'picked_up', 'en_route'].includes(order.status)) return error(res, 409, 'Tracking is not active for this order.');
      const pos = validateLocation(body);
      if (!pos) return error(res, 400, 'Invalid GPS coordinates or outside prototype service area.');
      order.riderLocation = { ...pos, accuracy:Number(body.accuracy)||null, heading:Number(body.heading)||null, speed:Number(body.speed)||null, updatedAt: new Date().toISOString() };
      order.trackingMode = body.mode === 'gps' ? 'gps' : 'simulation';
      order.updatedAt = order.riderLocation.updatedAt;
      const pickup=validateLocation(order.pickupLocation)||MARKET;
      const target=order.status==='en_route'?order.destination:pickup;
      order.trackingTarget=order.status==='en_route'?'customer':'seller';
      order.distanceToTargetMeters=Math.round(haversineMeters(pos,target)||0);
      if(order.status==='en_route' && order.distanceToTargetMeters<=500 && !order.nearCustomerAt){
        order.nearCustomerAt=order.updatedAt;
        order.history.push({status:'near_customer',time:order.updatedAt,distanceMeters:order.distanceToTargetMeters});
        sheetEvent('rider_near_customer',user,{orderId:order.id,distanceMeters:order.distanceToTargetMeters});
      }
      // Save every GPS update for this small demo; a production system should throttle & apply retention limits.
      persist(); broadcast();
      return respond(res, 200, { ok: true, distanceToTargetMeters:order.distanceToTargetMeters, nearCustomerAt:order.nearCustomerAt });
    }).catch(e => error(res, 400, e.message));
  }
  return error(res, 404, 'API endpoint not found.');
}
const PUBLIC_FILES = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return orderResponse(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return error(res, 405, 'Method not allowed');
  const entry = PUBLIC_FILES[url.pathname];
  if (!entry) return error(res, 404, 'Not found');
  const [name, mime] = entry;
  res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff' });
  const stream = fs.createReadStream(path.join(ROOT, name));
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});
server.listen(PORT, HOST, () => console.log(`Palengke Express demo: http://${HOST}:${PORT}`));
