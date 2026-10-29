/* Palengke Express • browser client. Uses built-in EventSource for real-time synchronization. */
'use strict';
const $ = s => document.querySelector(s);
const money = n => '₱' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const STATUS_NAMES = { pending:'New Order', accepted:'Accepted', ready:'Ready for Pickup', awaiting_driver:'Booking Driver', driver_assigned:'Driver Assigned', picked_up:'Picked Up', en_route:'Out for Delivery', delivered:'Delivered', rejected:'Rejected' };
const STATUS_DETAILS = { pending:'Waiting for the market seller to accept', accepted:'Seller is preparing your groceries', ready:'Groceries are packed and ready', awaiting_driver:'Seller booked a driver; awaiting rider acceptance', driver_assigned:'Driver accepted the booking and is coming to the market', picked_up:'Driver collected your order at the market', en_route:'Driver is heading to your delivery address', delivered:'Successfully delivered to the customer', rejected:'The seller could not fulfill this order' };
const STAGES = ['pending','accepted','ready','awaiting_driver','driver_assigned','picked_up','en_route','delivered'];
const session=JSON.parse(sessionStorage.getItem('px-session')||'null');
const state = {
  role: session?.user?.role || 'customer', section:'shop', filter:'All', search:'', orders:[], products:[], stores:[], selectedStoreId:'', market:null, locations:[], rider:null,
  deliveryFee:40, cart:JSON.parse(localStorage.getItem('px-cart') || '{}'),
  customerId:session?.user?.id || '',
  customerName:session?.user?.name || '',
  accountMenuOpen:false, accountModalOpen:false,
  selectedOrderId:null, modalOpen:false, draftLocation:null, draftName:'', draftAddress:'', draftNotes:'',
  online:false, hasLoaded:false, signature:'', map:null, mapEpoch:0, riderMarker:null, routeCoords:[],
  demoTimer:null, demoOrderId:null, gpsWatchId:null, gpsOrderId:null, gpsEnabled:false, users:[]
};
let authSession=session;
let desiredRole=state.role;
let authMode='login';

function selectedOrders() {
  if (state.role === 'admin') return state.orders;
  if (state.role === 'customer') return state.orders.filter(o => o.customerId === state.customerId);
  if (state.role === 'driver') return state.orders.filter(o => o.status==='awaiting_driver' || o.rider?.id===authSession?.user?.id);
  return state.orders;
}
function selectedOrder() {
  const group=selectedOrders();
  return group.find(o => o.id === state.selectedOrderId) || group[0] || null;
}
function currentRoleName(){ return state.role.charAt(0).toUpperCase() + state.role.slice(1); }
function statusBadge(status){return `<span class="status status-${esc(status)}">${esc(STATUS_NAMES[status] || status)}</span>`;}
function fmtTime(date){ return new Date(date).toLocaleString('en-PH', { dateStyle:'medium', timeStyle:'short' }); }
function contentHead(kicker, title, desc, extra=''){
  return `<div class="page-heading"><div><span class="eyebrow">${kicker}</span><h1>${title}</h1><p>${desc}</p></div>${extra ? `<div class="heading-actions">${extra}</div>` : ''}</div>`;
}
function empty(title, desc, emoji='📦'){
  return `<div class="empty"><div class="empty-art">${emoji}</div><h3>${title}</h3><p>${desc}</p></div>`;
}
function statCard(icon,label,value){return `<div class="stat-card"><span class="stat-icon">${icon}</span><small>${label}</small><strong>${value}</strong></div>`;}
function statStrip(items){return `<div class="stat-grid">${items.map(x => statCard(...x)).join('')}</div>`;}
function orderTile(order){return `<button type="button" data-order="${order.id}" class="order-tile ${selectedOrder()?.id === order.id ? 'selected':''}">
  <div class="order-tile-top"><h3>#${esc(order.id)}</h3>${statusBadge(order.status)}</div>
  <p>${esc(order.customerName)} · ${esc(order.storeName||'Market Seller')} · ${fmtTime(order.createdAt)}</p>
  <div class="order-tile-bottom"><span>📍 ${esc(order.destination.address)}</span><strong>${money(order.total)}</strong></div>
</button>`;}
function orderActions(order){
  const b = (action,label,style='btn-primary') => `<button type="button" class="btn ${style}" data-action="${action}" data-id="${order.id}">${label}</button>`;
  if (state.role === 'seller') {
    if (order.status === 'pending') return b('accept','✓ Accept Order') + b('reject','✕ Reject','btn-danger');
    if (order.status === 'accepted') return b('mark_ready','✓ Mark Ready for Pickup');
    if (order.status === 'ready') return b('book_driver','🛵 Book Driver Marco','btn-amber');
  }
  if (state.role === 'driver') {
    if (order.status === 'awaiting_driver') return b('accept_job','✓ Accept Delivery');
    if (order.status === 'driver_assigned') return b('pickup','📦 Confirm Pickup');
    if (order.status === 'picked_up') return b('start_delivery','🛵 Start Delivery');
    if (order.status === 'en_route') return b('delivered','✓ Mark as Delivered');
  }
  return '';
}
function orderTimeline(order){
  if (order.status === 'rejected') return `<div class="notice">This order was rejected by the seller. You can place a new order at any time.</div>`;
  const position=STAGES.indexOf(order.status);
  return `<ul class="timeline">${[
      ['pending','Order placed'],['accepted','Seller accepted'],['ready','Packed and ready'],['awaiting_driver','Driver booked'],
      ['driver_assigned','Driver confirmed'],['picked_up','Picked up from market'],['en_route','On the way'],['delivered','Delivered']
    ].map(([status,label],i)=>{
      const event=order.history.find(h=>h.status===status);
      return `<li class="${i<=position ? 'done':''}"><span class="step-dot"></span><div><strong>${label}</strong><small>${event ? fmtTime(event.time) : 'Pending'}</small></div></li>`;
    }).join('')}</ul>`;
}
function mapSection(order){
  if (!['awaiting_driver','driver_assigned','picked_up','en_route','delivered'].includes(order.status)) return '';
  return `<div class="small-label">Delivery route · Market → Customer</div>
    <div id="delivery-map" class="tracking-map" aria-label="Delivery tracking map from seller to customer"></div>
    <div class="map-legend"><span><i class="legend-market"></i> Seller</span><span><i class="legend-drop"></i> Customer</span>${order.riderLocation ? '<span><i class="legend-rider"></i> Driver</span>' : ''}</div>
    <div class="map-caption">${order.trackingMode === 'gps' ? '🟢 Driver GPS location (updates when device location is shared)' : order.trackingMode === 'simulation' ? '🧪 Simulated driver position — demo, not actual GPS' : 'Route shown for reference. Driver position appears when tracking starts.'} • Maps need an internet connection.</div>`;
}
function detailPanel(order){
  if (!order) return `<div class="panel">${empty('Select an order','New orders and active deliveries will appear here.','🧺')}</div>`;
  return `<div class="panel order-detail">
    <div class="detail-head"><div><div class="eyebrow">ORDER DETAILS</div><h3>#${esc(order.id)}</h3><div class="muted" style="font-size:11px;margin-top:6px">${fmtTime(order.createdAt)}</div></div>${statusBadge(order.status)}</div>
    <div class="detail-row"><span>Customer</span><strong>${esc(order.customerName)}</strong></div>
    <div class="detail-row"><span>Deliver to</span><strong>${esc(order.destination.address)}</strong></div>
    <div class="detail-row"><span>Seller store</span><strong>${esc(order.storeName||'Market Seller')}</strong></div>
    <div class="detail-row"><span>Seller pickup</span><strong>${esc(order.storeLocation||'Tanauan City Public Market')}</strong></div>
    ${order.rider ? `<div class="detail-row"><span>Assigned rider</span><strong>${esc(order.rider.name)} ${order.status==='awaiting_driver'?'(not yet accepted)':''}</strong></div>` : ''}
    ${order.notes ? `<div class="delivery-note">📝 Customer note: ${esc(order.notes)}</div>` : ''}
    <div class="small-label">Order items</div><div class="item-list">${order.items.map(i => `<div class="item-line"><span>${esc(i.emoji)} ${esc(i.name)} × ${i.quantity}</span><strong>${money(i.price*i.quantity)}</strong></div>`).join('')}</div>
    <div class="detail-row"><span>Items subtotal</span><strong>${money(order.subtotal)}</strong></div>
    <div class="detail-row"><span>Delivery fee</span><strong>${money(order.deliveryFee)}</strong></div>
    <div class="detail-row" style="font-size:15px"><strong>Total · COD</strong><strong style="font-size:17px;color:#157b52">${money(order.total)}</strong></div>
    <div class="delivery-note">${esc(STATUS_DETAILS[order.status] || '')}</div>
    ${orderActions(order) ? `<div class="action-group">${orderActions(order)}</div>` : ''}
    ${state.role==='driver' && order.status==='en_route' ? driverLocationActions(order) : ''}
    ${mapSection(order)}
    <div class="small-label">Order progress</div>${orderTimeline(order)}
  </div>`;
}
function driverLocationActions(order){
  return `<div class="small-label">Location sharing</div>
    <div class="gps-buttons">
      ${state.gpsEnabled && state.gpsOrderId===order.id ? '<button class="btn btn-danger btn-small" data-stop-gps>■ Stop GPS</button>' : '<button class="btn btn-soft btn-small" data-start-gps="'+order.id+'">📍 Share real GPS</button>'}
      ${state.demoTimer && state.demoOrderId===order.id ? '<button class="btn btn-danger btn-small" data-stop-demo>■ Stop simulation</button>' : '<button class="btn btn-ghost btn-small" data-start-demo="'+order.id+'">🧪 Simulate route</button>'}
    </div><p class="inline-note">Real GPS requires location permission and a secure connection (localhost or HTTPS). Simulation moves a test marker along the route; it is clearly labeled for all roles.</p>`;
}
function storePicker(){
  if(!state.stores.length) return `<div class="stores-empty">${empty('No approved sellers yet','Approved seller stores will appear here after the admin reviews their accounts.','🏪')}</div>`;
  const store=state.stores.find(x=>x.id===state.selectedStoreId)||state.stores[0];
  return `<div class="store-picker-panel">
    <div class="store-picker-copy"><span class="store-picker-label">SHOP FROM</span><strong>Choose a seller store</strong><small>${state.stores.length} approved ${state.stores.length===1?'store':'stores'} available</small></div>
    <div class="store-picker-control">
      <select id="store-select" aria-label="Choose seller store">${state.stores.map(s=>`<option value="${esc(s.id)}" ${s.id===state.selectedStoreId?'selected':''}>${s.isOpen?'🟢':'🔴'} ${esc(s.name)} — ${esc(s.location)}</option>`).join('')}</select>
      <span class="store-picker-status ${store?.isOpen?'open':'closed'}">${store?.isOpen?'OPEN NOW':'CLOSED'}</span>
    </div>
    ${store?`<div class="store-picker-meta"><span>🏪 ${esc(store.ownerName)}</span><span>📍 ${esc(store.location)}</span><span>🧺 ${Number(store.productCount||0)} item(s)</span><span>🕒 ${esc(store.openReason||'')}</span></div>`:''}
  </div>`;
}
function selectedStoreProducts(){return state.products.filter(p=>p.sellerId===state.selectedStoreId);}
function shopPage(){
  if(!state.selectedStoreId && state.stores[0]) state.selectedStoreId=state.stores[0].id;
  const store=state.stores.find(x=>x.id===state.selectedStoreId);
  const storeProducts=selectedStoreProducts();
  const filtered=storeProducts.filter(p => (state.filter==='All'||p.category===state.filter) && (`${p.name} ${p.category}`).toLowerCase().includes(state.search.toLowerCase()));
  return `${contentHead('WELCOME TO THE PALENGKE','Choose your seller store.','Every approved seller appears here as a separate store. Choose one to see only that seller’s items.',`<button class="btn btn-ghost" data-section="orders">📦 My orders (${selectedOrders().length})</button>`)}
    <section class="shop-hero"><div class="hero-content"><div class="hero-kicker">✨ Approved local sellers</div><h2>Choose a store,<br>then shop its items.</h2><p>${state.stores.length} approved seller ${state.stores.length===1?'store is':'stores are'} currently listed.</p><span class="hero-chip">🛵 Fast delivery · Cash on Delivery</span></div><div class="hero-circle"></div><span class="hero-art" aria-hidden="true">🏪</span></section>
    ${storePicker()}
    ${store ? `
    ${!store.isOpen?`<div class="notice">This store is currently closed. You can browse its items, but checkout is disabled until the seller opens the store or the automatic opening time begins.</div>`:''}
    <div class="section-head"><div><h2>Shop by category</h2><p>Items sold by ${esc(store.name)}</p></div></div>
    <div class="category-pills">${['All','Vegetables','Meat','Fish','Fruits','Pantry','Other'].map(c=>`<button class="pill ${c===state.filter?'active':''}" data-filter="${c}">${c==='All'?'🧺 ':''}${c}</button>`).join('')}</div>
    <div class="section-head"><div><h2>${esc(store.name)} items</h2><p id="products-count">${filtered.length} item(s) listed</p></div><div class="search-wrap">⌕ <input id="search-products" type="search" value="${esc(state.search)}" placeholder="Search this store…" aria-label="Search products"></div></div>
    <div class="product-grid" id="product-grid">${productCards(filtered,store)}</div>
    ${cartCount() ? `<button class="cart-fab" data-open-cart>🛍️ View Cart <span class="cart-bubble">${cartCount()}</span> ${money(cartSubtotal())}</button>`:''}` : ''}`;
}
function productCards(products,store=state.stores.find(x=>x.id===state.selectedStoreId)){
  if (!products.length) return `<div style="grid-column:1/-1">${empty('No items in this store yet','This seller has not added matching products yet.','🧺')}</div>`;
  return products.map(p=>{const inStock=Number(p.stock)>0,canBuy=inStock&&store?.isOpen;return `<article class="product-card ${canBuy?'':'product-disabled'}">
    <div class="product-art" style="--tone:${p.tone||'#eef7f1'}"><span class="fresh-tag">${inStock?'● IN STOCK':'● SOLD OUT'}</span><span aria-hidden="true">${esc(p.emoji||'🧺')}</span></div>
    <div class="category">${esc(p.category)}</div><h3>${esc(p.name)}</h3><div class="unit">${esc(p.unit)} · Stock: ${Number(p.stock||0)}</div>
    <div class="product-foot"><strong class="price">${money(p.price)}</strong><button type="button" class="add-btn" data-add="${p.id}" ${canBuy?'':'disabled'} aria-label="Add ${esc(p.name)} to cart">${canBuy?'+':'×'}</button></div>
  </article>`}).join('');
}
function sellerInventoryPanel(){
  const store=state.stores.find(x=>x.id===authSession?.user?.id);
  const settings=store?.storeSettings||{mode:'manual',manualOpen:true,openTime:'06:00',closeTime:'18:00',days:[0,1,2,3,4,5,6]};
  const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return `<div class="seller-commerce-grid">
    <div class="panel"><div class="panel-heading"><div><h2>My store status</h2><p class="panel-subtitle">Control when buyers are allowed to order.</p></div><span class="status ${store?.isOpen?'status-approved':'status-rejected'}">${store?.isOpen?'OPEN':'CLOSED'}</span></div>
      <form id="store-settings-form">
        <div class="field"><label>Store hours mode</label><select name="mode"><option value="manual" ${settings.mode==='manual'?'selected':''}>Manual open / close</option><option value="auto" ${settings.mode==='auto'?'selected':''}>Automatic schedule</option></select></div>
        <label class="toggle-row"><input type="checkbox" name="manualOpen" ${settings.manualOpen?'checked':''}><span>Manual status: Open</span></label>
        <div class="field-grid two"><div class="field"><label>Opening time</label><input type="time" name="openTime" value="${esc(settings.openTime||'06:00')}"></div><div class="field"><label>Closing time</label><input type="time" name="closeTime" value="${esc(settings.closeTime||'18:00')}"></div></div>
        <div class="day-picker">${days.map((d,i)=>`<label><input type="checkbox" name="days" value="${i}" ${(settings.days||[]).includes(i)?'checked':''}><span>${d}</span></label>`).join('')}</div>
        <button class="btn btn-primary" type="submit">Save store hours</button>
      </form><p class="inline-note">Manual mode uses the Open checkbox. Automatic mode opens/closes the store using the selected days and times in Philippine time.</p>
    </div>
    <div class="panel"><div class="panel-heading"><div><h2>Add item</h2><p class="panel-subtitle">Add something you currently sell.</p></div></div>
      <form id="add-product-form"><div class="field-grid two"><div class="field"><label>Item name</label><input name="name" required maxlength="100" placeholder="e.g. Fresh Tomatoes"></div><div class="field"><label>Category</label><select name="category"><option>Vegetables</option><option>Meat</option><option>Fish</option><option>Fruits</option><option>Pantry</option><option>Other</option></select></div></div>
      <div class="field-grid two"><div class="field"><label>Price (₱)</label><input name="price" type="number" min="1" step="1" required></div><div class="field"><label>Stock quantity</label><input name="stock" type="number" min="0" step="1" required></div></div>
      <div class="field-grid two"><div class="field"><label>Unit</label><input name="unit" required placeholder="1 kg / 1 bundle / piece"></div><div class="field"><label>Emoji</label><input name="emoji" maxlength="8" value="🧺"></div></div>
      <button class="btn btn-primary" type="submit">+ Add item</button></form>
    </div>
  </div>
  <div class="panel seller-products-panel"><div class="panel-heading"><div><h2>My store items</h2><p class="panel-subtitle">Edit price/stock or remove items. Customers see these changes live.</p></div><span class="count-chip">${state.products.length} items</span></div>
    ${state.products.length?`<div class="seller-product-list">${state.products.map(p=>`<div class="seller-product-row"><div class="seller-product-emoji">${esc(p.emoji||'🧺')}</div><div><strong>${esc(p.name)}</strong><small>${esc(p.category)} · ${esc(p.unit)} · Stock ${Number(p.stock||0)}</small></div><strong>${money(p.price)}</strong><div class="seller-product-actions"><button class="mini-action" data-edit-product="${p.id}">Edit</button><button class="mini-action reject" data-remove-product="${p.id}" data-product-name="${esc(p.name)}">Remove</button></div></div>`).join('')}</div>`:empty('No items yet','Use “Add item” above to create your store catalog.','🧺')}
  </div>`;
}
function customerOrdersPage(){
  const group=selectedOrders();
  return `${contentHead('TRACK YOUR DELIVERY','My orders','Follow every step, from the market stall to your door.',`<button class="btn btn-ghost" data-section="shop">← Back to market</button>`)}
    ${group.length ? `<div class="columns"><div class="panel"><div class="panel-heading"><div><h2>Order history</h2><p class="panel-subtitle">${group.length} placed order(s)</p></div><span class="count-chip">Live updates</span></div><div class="order-list">${group.map(orderTile).join('')}</div></div>${detailPanel(selectedOrder())}</div>` : empty('You haven’t placed an order yet','Add fresh items to your cart to see your order status and tracking here.','🛍️')}`;
}
function customerSettingsPage(){
  const u=authSession?.user||{};
  const address=u.profile?.deliveryAddress||'';
  return `${contentHead('CUSTOMER SETTINGS','Account settings','Update your contact information, default delivery address, and password.',`<button class="btn btn-ghost" data-section="shop">← Back to market</button>`)}
    <div class="seller-commerce-grid">
      <div class="panel"><div class="panel-heading"><div><h2>Contact & delivery details</h2><p class="panel-subtitle">These details are saved to your customer account.</p></div></div>
        <form id="customer-profile-form">
          <div class="field"><label>Full name</label><input value="${esc(u.name||'')}" disabled><small class="inline-note">Your registered name is shown for reference.</small></div>
          <div class="field-grid two"><div class="field"><label>Email address</label><input type="email" name="email" required value="${esc(u.email||'')}"></div><div class="field"><label>Mobile number</label><input type="tel" name="phone" required maxlength="20" value="${esc(u.phone||'')}"></div></div>
          <div class="field"><label>Default delivery address</label><textarea name="address" required maxlength="180" placeholder="House no., street, barangay, city">${esc(address)}</textarea></div>
          <button class="btn btn-primary" type="submit">Save account details</button>
        </form>
      </div>
      <div class="panel"><div class="panel-heading"><div><h2>Change password</h2><p class="panel-subtitle">Enter your current password before choosing a new one.</p></div></div>
        <form id="customer-password-form">
          <div class="field"><label>Current password</label><input type="password" name="currentPassword" required autocomplete="current-password"></div>
          <div class="field"><label>New password</label><input type="password" name="newPassword" minlength="7" required autocomplete="new-password" placeholder="At least 7 characters"></div>
          <div class="field"><label>Confirm new password</label><input type="password" name="confirmPassword" minlength="7" required autocomplete="new-password"></div>
          <button class="btn btn-primary" type="submit">Change password</button>
        </form>
        <p class="inline-note">For security, your password is never shown in the admin dashboard or Google Sheets.</p>
      </div>
    </div>`;
}
function sellerPage(){
  const group=state.orders;
  const pending=group.filter(o=>o.status==='pending').length;
  const active=group.filter(o=>!['delivered','rejected'].includes(o.status)).length;
  const shipped=group.filter(o=>o.status==='delivered').length;
  const myStore=state.stores.find(x=>x.id===authSession?.user?.id);
  return `${contentHead('SELLER PORTAL',esc(myStore?.name||'My Store'),'Manage your items, store hours, customer orders, and driver bookings.',`<span class="count-chip">${myStore?.isOpen?'🟢 Store open':'🔴 Store closed'}</span>`)}
    ${statStrip([['🧺','Total orders',group.length],['🔔','New orders',pending],['📦','Store items',state.products.length],['✅','Delivered',shipped]])}
    ${sellerInventoryPanel()}
    <div class="role-banner"><span class="banner-icon">📦</span><div><strong>Orders from your store appear here automatically</strong><p>Only customers who selected your store can send orders to this seller account.</p></div></div>
    <div class="columns"><div class="panel"><div class="panel-heading"><div><h2>Customer orders</h2><p class="panel-subtitle">Latest orders at the top</p></div><span class="count-chip">${group.length} total</span></div>
      ${group.length ? `<div class="order-list">${group.map(orderTile).join('')}</div>` : empty('Waiting for new orders','Customers can choose your approved store and order your listed items while you are open.','🔔')}
    </div>${detailPanel(selectedOrder())}</div>`;
}
function adminCredentialSummary(u){
  if(u.role==='seller') return `Store: ${esc(u.profile?.storeName||'—')}<br>Location: ${esc(u.profile?.storeLocation||'—')}<br>Registration: ${esc(u.profile?.registrationType||'—')} · ${esc(u.profile?.registrationNumber||'—')}`;
  if(u.role==='driver') return `License: ${esc(u.profile?.licenseType||'—')}<br>Motor: ${esc(u.profile?.vehicleModel||u.profile?.motorcycleType||'—')}<br>Plate: ${esc(u.profile?.plateNumber||'—')}`;
  return 'Customer account';
}
function adminAccountRow(u){
  const status=u.approvalStatus||'approved';
  const approval=['seller','driver'].includes(u.role)&&status==='pending' ? `<button class="mini-action approve" data-admin-user="${u.id}" data-decision="approved">Approve</button><button class="mini-action reject" data-admin-user="${u.id}" data-decision="rejected">Reject</button>` : '';
  const reset=u.role!=='admin' ? `<button class="mini-action" data-reset-password="${u.id}" data-reset-name="${esc(u.name)}">Reset password</button>` : '';
  const remove=u.role!=='admin' ? `<button class="mini-action reject" data-delete-account="${u.id}" data-delete-name="${esc(u.name)}" data-delete-role="${esc(u.role)}">Delete</button>` : '';
  return `<tr>
    <td><span class="sheet-id">${esc(u.id.slice(0,8))}</span></td>
    <td><strong>${esc(u.role.toUpperCase())}</strong></td>
    <td><strong>${esc(u.name)}</strong></td>
    <td>${esc(u.email)}</td>
    <td>${esc(u.phone||'—')}</td>
    <td><div class="password-cell"><span>••••••••••</span><small>Protected</small>${reset}</div></td>
    <td><span class="status status-${esc(status)}">${esc(status.toUpperCase())}</span></td>
    <td class="credentials-cell">${adminCredentialSummary(u)}</td>
    <td>${u.createdAt?fmtTime(u.createdAt):'—'}</td>
    <td><div class="sheet-actions">${approval}${remove || (!approval?'<span class="muted-dash">—</span>':'')}</div></td>
  </tr>`;
}
function adminPage(){
  const users=state.users||[];
  const pending=users.filter(u=>['seller','driver'].includes(u.role)&&u.approvalStatus==='pending').length;
  return `${contentHead('ADMIN CONTROL CENTER','Built-in account sheet','All registered Customer, Seller and Driver accounts are listed here. Original passwords stay protected; admins can reset a password and see the new temporary password once.',`<span class="count-chip">${pending} pending review</span>`)}
    ${statStrip([['👥','Registered accounts',users.length],['⏳','Pending approvals',pending],['🏪','Sellers',users.filter(u=>u.role==='seller').length],['🛵','Drivers',users.filter(u=>u.role==='driver').length]])}
    <div class="panel admin-sheet-panel"><div class="panel-heading"><div><h2>Account database</h2><p class="panel-subtitle">Live internal table connected to the same account database used by login and approvals.</p></div><span class="count-chip">${users.length} rows</span></div>
    ${users.length?`<div class="admin-sheet-wrap"><table class="admin-sheet"><thead><tr><th>Account ID</th><th>Role</th><th>Name</th><th>Email / Username</th><th>Phone</th><th>Password</th><th>Status</th><th>Credentials</th><th>Registered</th><th>Admin actions</th></tr></thead><tbody>${users.map(adminAccountRow).join('')}</tbody></table></div>`:empty('No accounts yet','Registered accounts will appear here.','👥')}
    <div class="admin-security-note">🔒 Original passwords are never stored in readable form. “Reset password” replaces the old password and shows the new temporary password once. “Delete” permanently removes the account and immediately invalidates its active login sessions.</div></div>`;
}
function driverPage(){
  const group=selectedOrders();
  const waiting=group.filter(o=>o.status==='awaiting_driver').length;
  const active=group.filter(o=>['driver_assigned','picked_up','en_route'].includes(o.status)).length;
  const done=group.filter(o=>o.status==='delivered').length;
  return `${contentHead('DRIVER PORTAL',`Let's ride, ${esc(state.rider?.name?.split(' ')[0] || 'Rider')}!`,'Accept bookings, pick up grocery orders and share your delivery location.',`<span class="count-chip">🛵 ${esc(state.rider?.vehicle || 'Motorcycle')} Rider</span>`)}
    ${statStrip([['🔔','Booking requests',waiting],['🚚','Active deliveries',active],['✅','Completed trips',done],['💵','COD to collect',money(group.filter(o=>['driver_assigned','picked_up','en_route'].includes(o.status)).reduce((sum,o)=>sum+o.total,0))]])}
    <div class="driver-banner"><div><strong>🛵 Driver dispatch center</strong><p>Once a seller books a driver, a new trip request is listed below.</p></div><span class="status status-driver_assigned">● Available</span></div>
    <div class="columns"><div class="panel"><div class="panel-heading"><div><h2>My delivery jobs</h2><p class="panel-subtitle">Tap an order to view your delivery instructions</p></div><span class="count-chip">${group.length} jobs</span></div>
      ${group.length ? `<div class="order-list">${group.map(orderTile).join('')}</div>` : empty('No delivery requests yet','When the seller books you for a grocery order, it will arrive here automatically.','🛵')}
    </div>${detailPanel(selectedOrder())}</div>`;
}
function syncAuthChrome(){
  const loggedIn=!!authSession;
  const roleRail=$('#role-rail');
  const mobileRoleTabs=$('#mobile-role-tabs');
  const railLabel=document.querySelector('.rail-label');
  const railNote=document.querySelector('.rail-note');
  const railBottom=document.querySelector('.rail-bottom');
  if(roleRail)roleRail.classList.toggle('hidden',loggedIn);
  if(mobileRoleTabs)mobileRoleTabs.classList.toggle('hidden',loggedIn);
  if(railLabel)railLabel.classList.toggle('hidden',loggedIn);
  if(railNote)railNote.classList.toggle('hidden',loggedIn);
  if(railBottom)railBottom.classList.toggle('hidden',loggedIn);
}
function updateCounters(){
  syncAuthChrome();
  const pending=state.orders.filter(o=>o.status==='pending').length;
  const jobs=state.orders.filter(o=>o.status==='awaiting_driver').length;
  const sc=$('#seller-count'), dc=$('#driver-count');
  if(sc){sc.textContent=pending;sc.classList.toggle('hidden',!pending)}
  if(dc){dc.textContent=jobs;dc.classList.toggle('hidden',!jobs)}
  if($('#mobile-seller-count'))$('#mobile-seller-count').textContent=pending?`(${pending})`:'';
  if($('#mobile-driver-count'))$('#mobile-driver-count').textContent=jobs?`(${jobs})`:'';
  const firstName=(authSession?.user?.name||'').trim().split(/\s+/)[0]||state.role||'User';
  const avatar=$('#role-avatar');
  if(avatar){avatar.textContent=firstName.charAt(0).toUpperCase();avatar.title=authSession?.user?.name||'Account';avatar.setAttribute('aria-expanded',state.accountMenuOpen?'true':'false');}
  const dropdown=$('#account-dropdown');if(dropdown)dropdown.classList.toggle('hidden',!state.accountMenuOpen || !authSession);
  document.querySelectorAll('[data-role]').forEach(el=>el.classList.toggle('active',el.dataset.role===state.role));
}
function render(){
  updateCounters();
  destroyMap();
  if(!state.hasLoaded){$('#app-content').innerHTML='<div class="loading-box">Connecting to your market…</div>';return;}
  const content=state.role==='admin' ? adminPage() : state.role==='customer' ? (state.section==='shop'?shopPage():state.section==='settings'?customerSettingsPage():customerOrdersPage()) : state.role==='seller' ? sellerPage() : driverPage();
  $('#app-content').innerHTML=content;
  renderModal();
  const o=selectedOrder();
  if(o && $('#delivery-map')) initMap(o);
}
function toast(message){
  const box=document.createElement('div');box.className='toast';box.textContent=message;
  $('#toast-container').append(box);setTimeout(()=>box.remove(),3800);
}
function cartCount(){return Object.values(state.cart).reduce((n,q)=>n+q,0);}
function cartSubtotal(){return state.products.reduce((sum,p)=>sum+(state.cart[p.id]||0)*p.price,0);}
function saveCart(){localStorage.setItem('px-cart',JSON.stringify(state.cart));}
function modifyCart(id,diff){
  const product=state.products.find(p=>p.id===id);if(!product)return;
  const qty=Math.max(0,Math.min(50,(state.cart[id]||0)+diff));
  if(qty)state.cart[id]=qty;else delete state.cart[id];
  saveCart();
  if(state.modalOpen) renderModal(); else render();
  if(diff>0) toast(`${product.name} added to your cart`);
}
function cartModal(){
  const cart=state.products.filter(p=>state.cart[p.id]>0);
  return `<div class="overlay" id="cart-overlay"><div class="modal-card" role="dialog" aria-modal="true" aria-label="Your shopping cart">
    <div class="modal-header"><div><div class="eyebrow">READY TO CHECK OUT?</div><h2 style="margin-top:5px">Your market basket</h2></div><button type="button" class="close-btn" data-close-cart aria-label="Close cart">×</button></div>
    ${cart.length ? `<div>${cart.map(p=>`<div class="cart-row"><div class="cart-emoji">${p.emoji}</div><div class="cart-info"><strong>${esc(p.name)}</strong><small>${money(p.price)} · ${p.unit}</small></div><div class="qty"><button type="button" data-adjust="-1" data-product="${p.id}" aria-label="Remove one">−</button><span>${state.cart[p.id]}</span><button type="button" data-adjust="1" data-product="${p.id}" aria-label="Add one">+</button></div></div>`).join('')}</div>
      <form id="checkout-form">
      <div class="field"><label for="customer-name">Your name</label><input id="customer-name" name="customerName" type="text" maxlength="70" value="${esc(state.draftName)}" placeholder="Juan Dela Cruz" required></div>
      <div class="field"><label for="customer-neighborhood">Delivery area</label><select id="customer-neighborhood" name="neighborhood">
        ${state.locations.map(l=>`<option value="${l.id}" ${state.draftLocation?.id===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}
        ${state.draftLocation?.id==='gps' ? '<option value="gps" selected>📍 My GPS location</option>' : ''}
        </select></div>
      <button type="button" class="btn btn-ghost btn-small" id="use-customer-gps">📍 Use my exact GPS location</button>
      <div class="field"><label for="delivery-address">House / street / complete delivery address</label><textarea id="delivery-address" name="address" maxlength="180" placeholder="Add your street and house number" required>${esc(state.draftAddress)}</textarea><small class="inline-note">Sample barangay pins are approximate. For correct navigation, use the GPS option or enter accurate coordinates in a production system.</small></div>
      <div class="field"><label for="delivery-notes">Order notes (optional)</label><textarea id="delivery-notes" name="notes" maxlength="350" placeholder="E.g., call upon arrival">${esc(state.draftNotes)}</textarea></div>
      <div class="checkout-total"><div class="line-between"><span>Subtotal</span><strong>${money(cartSubtotal())}</strong></div><div class="line-between"><span>Delivery fee</span><strong>${money(state.deliveryFee)}</strong></div><div class="line-between grand"><span>Total to pay (COD)</span><span>${money(cartSubtotal()+state.deliveryFee)}</span></div></div>
      <div class="checkout-actions"><button class="btn btn-primary btn-full" type="submit">Place order · ${money(cartSubtotal()+state.deliveryFee)}</button><span class="inline-note">Cash on Delivery only. This is a demonstration and will not charge you.</span></div></form>` : empty('Your basket is empty','Choose a few fresh products to place an order.','🧺')}
  </div></div>`;
}
function accountModal(){
  const u=authSession?.user||{};
  const p=u.profile||{};
  const role=u.role||state.role;
  const details=role==='seller'
    ? `<div class="detail-row"><span>Store</span><strong>${esc(p.storeName||'—')}</strong></div><div class="detail-row"><span>Location</span><strong>${esc(p.storeLocation||'—')}</strong></div>`
    : role==='driver'
      ? `<div class="detail-row"><span>License type</span><strong>${esc(p.licenseType||'—')}</strong></div><div class="detail-row"><span>Vehicle</span><strong>${esc(p.vehicleModel||p.motorcycleType||'—')}</strong></div>`
      : role==='customer'
        ? `<div class="detail-row"><span>Delivery address</span><strong>${esc(p.deliveryAddress||'Not set')}</strong></div>`
        : '';
  const initial=((u.name||role||'U').trim()[0]||'U').toUpperCase();
  return `<div class="overlay account-overlay" data-close-account-modal><div class="modal-card account-profile-card" role="dialog" aria-modal="true" aria-label="Account details"><div class="modal-header"><div><div class="eyebrow">MY ACCOUNT</div><h2 style="margin-top:5px">Account details</h2></div><button type="button" class="close-btn" data-close-account-modal aria-label="Close account details">×</button></div><div class="account-profile-head"><div class="account-profile-avatar">${initial}</div><div><h3>${esc(u.name||'User')}</h3><p>${esc((role||'user').charAt(0).toUpperCase()+(role||'user').slice(1))}</p></div></div><div class="account-profile-details"><div class="detail-row"><span>Email</span><strong>${esc(u.email||'—')}</strong></div><div class="detail-row"><span>Phone</span><strong>${esc(u.phone||'—')}</strong></div>${details}</div></div></div>`;
}
function renderModal(){
  $('#modal-root').innerHTML=state.accountModalOpen ? accountModal() : (state.modalOpen ? cartModal() : '');
}
function openCart(){
  state.modalOpen=true;
  if(!state.draftLocation)state.draftLocation=state.locations[0];
  if(!state.draftName)state.draftName=state.customerName;
  if(!state.draftAddress)state.draftAddress=authSession?.user?.profile?.deliveryAddress || state.draftLocation?.address || '';
  renderModal();
}
function closeCart(){state.modalOpen=false;renderModal();}
async function api(url,method='GET',body){
  const resp=await fetch(url,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(authSession?{Authorization:'Bearer '+authSession.token}:{})},body:body?JSON.stringify(body):undefined});
  let data;
  try{data=await resp.json()}catch(_){throw new Error('Unable to read response from the server.');}
  if(!resp.ok)throw new Error(data.error||`Request failed (${resp.status})`);
  return data;
}
function applyUpdate(data){
  const wasLoaded=state.hasLoaded;
  const previousIds=new Set(state.orders.map(o=>o.id));
  const previousBookings=new Set(state.orders.filter(o=>o.status==='awaiting_driver').map(o=>o.id));
  const signature=JSON.stringify(data.orders.map(o=>[o.id,o.status,o.rider?.id,o.customerName,o.total,o.history.length]));
  const movementOnly=wasLoaded && signature===state.signature;
  state.orders=data.orders;
  if(Array.isArray(data.users)) state.users=data.users;
  if(Array.isArray(data.products)) state.products=data.products;
  if(Array.isArray(data.stores)){state.stores=data.stores;if(!state.stores.some(x=>x.id===state.selectedStoreId))state.selectedStoreId=state.stores[0]?.id||'';}
  state.signature=signature;
  if(!movementOnly)render();else refreshMarker();
  updateCounters();
  if(wasLoaded){
    if(state.role==='seller' && data.orders.some(o=>o.status==='pending'&&!previousIds.has(o.id)))toast('🔔 New order received!');
    if(state.role==='driver' && data.orders.some(o=>o.status==='awaiting_driver'&&!previousBookings.has(o.id)))toast('🛵 Seller booked a new delivery!');
  }
}
async function init(){
  try{
    const data=await api('/api/state');
    state.products=data.products;state.stores=data.stores||[];if(!state.selectedStoreId&&state.stores[0])state.selectedStoreId=state.stores[0].id;state.market=data.market;state.locations=data.locations;state.rider=state.role==='driver'?{id:authSession.user.id,name:authSession.user.name,vehicle:'Motorcycle'}:data.rider;state.deliveryFee=data.deliveryFee;
    state.draftLocation=data.locations[0];state.draftAddress=data.locations[0].address;
    if(state.role==='admin'){try{const ud=await api('/api/admin/users');state.users=ud.users||[];}catch(e){console.error(e)}}
    state.hasLoaded=true;
    applyUpdate(data);
  }catch(err){$('#app-content').innerHTML=`<div class="notice">Could not connect to server: ${esc(err.message)}. Start it using <code>node server.js</code> and open <code>http://localhost:3000</code>.</div>`;setConnection(false);return;}
  if(window.pxEvents)window.pxEvents.close();
  const events=new EventSource('/api/events?token='+encodeURIComponent(authSession.token));window.pxEvents=events;
  events.addEventListener('update',event=>{try{applyUpdate(JSON.parse(event.data));setConnection(true);}catch(err){console.error('Stream error',err)}});
  events.onopen=()=>setConnection(true);
  events.onerror=()=>setConnection(false);
}
function setConnection(connected){
  state.online=connected;
  const el=$('#connection');el.classList.toggle('offline',!connected);
  el.innerHTML=`<span class="live-dot"></span>${connected?'Live · Connected':'Reconnecting…'}`;
}
function destroyMap(){state.mapEpoch++;if(state.map){state.map.remove();state.map=null;}state.riderMarker=null;state.routeCoords=[];}
function pointIcon(emoji){return L.divIcon({html:`<span style="font-size:27px;line-height:34px">${emoji}</span>`,className:'map-icon',iconSize:[34,34],iconAnchor:[17,29]});}
async function fetchRoute(from,to){
  const fallback=[[from.lat,from.lng],[to.lat,to.lng]];
  try{
    const url=`https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),4500);
    let response;
    try{response=await fetch(url,{signal:controller.signal})}finally{clearTimeout(timeout)}
    if(!response.ok)return fallback;
    const data=await response.json();
    const coordinates=data.routes?.[0]?.geometry?.coordinates;
    return Array.isArray(coordinates)&&coordinates.length>1?coordinates.map(([lng,lat])=>[lat,lng]):fallback;
  }catch(_){return fallback;}
}
async function initMap(order){
  const epoch=++state.mapEpoch;
  if(typeof L==='undefined'){
    $('#delivery-map').innerHTML='<div class="notice">Could not load the map library. Check your internet connection.</div>';return;
  }
  const market=state.market,drop=order.destination;
  const map=L.map('delivery-map',{scrollWheelZoom:false,zoomControl:false,attributionControl:true});
  state.map=map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',maxZoom:19}).addTo(map);
  L.marker([market.lat,market.lng],{icon:pointIcon('🏪')}).addTo(map).bindPopup('<strong>Seller pickup</strong><br>Tanauan Public Market');
  L.marker([drop.lat,drop.lng],{icon:pointIcon('🏠')}).addTo(map).bindPopup(`<strong>Customer drop-off</strong><br>${esc(drop.address)}`);
  if(order.riderLocation) state.riderMarker=L.marker([order.riderLocation.lat,order.riderLocation.lng],{icon:pointIcon('🛵')}).addTo(map).bindPopup('Rider location');
  let bounds=L.latLngBounds([[market.lat,market.lng],[drop.lat,drop.lng]]);
  map.fitBounds(bounds.pad(.25),{maxZoom:15});
  const points=await fetchRoute(market,drop);
  if(epoch!==state.mapEpoch)return;
  state.routeCoords=points;
  L.polyline(points,{color:'#1f9971',weight:5,opacity:.86,lineCap:'round'}).addTo(map);
  if(order.riderLocation)L.polyline([[order.riderLocation.lat,order.riderLocation.lng],[drop.lat,drop.lng]],{color:'#2a77d9',weight:3,dashArray:'7,7',opacity:.8}).addTo(map);
  setTimeout(()=>{if(epoch===state.mapEpoch)map.invalidateSize()},160);
}
function refreshMarker(){
  if(!state.map)return;
  const order=selectedOrder();if(!order?.riderLocation)return;
  const {lat,lng}=order.riderLocation;
  if(state.riderMarker)state.riderMarker.setLatLng([lat,lng]);
  else if(typeof L!=='undefined')state.riderMarker=L.marker([lat,lng],{icon:pointIcon('🛵')}).addTo(state.map);
  const el=$('.map-caption');
  if(el)el.textContent=(order.trackingMode==='gps'?'🟢 Real GPS coordinates':order.trackingMode==='simulation'?'🧪 Simulated driver position — not real GPS':'Driver position available')+' · Updated '+new Date(order.riderLocation.updatedAt).toLocaleTimeString('en-PH');
}
async function updateLocation(orderId,lat,lng,mode){
  await api(`/api/orders/${encodeURIComponent(orderId)}/location`,'POST',{role:'driver',lat,lng,mode});
}
function stopDemo(){if(state.demoTimer)clearInterval(state.demoTimer);state.demoTimer=null;state.demoOrderId=null;}
function stopGPS(){
  if(state.gpsWatchId!==null)navigator.geolocation.clearWatch(state.gpsWatchId);
  state.gpsWatchId=null;state.gpsEnabled=false;state.gpsOrderId=null;
}
async function startSimulation(orderId){
  stopGPS();stopDemo();
  const order=state.orders.find(o=>o.id===orderId);
  if(!order||order.status!=='en_route'){toast('Start delivery first.');return;}
  toast('🧪 Demo route started (simulated location)');
  state.demoOrderId=orderId;
  const points=state.routeCoords.length>1 ? [...state.routeCoords] : await fetchRoute(state.market,order.destination);
  let progress=0;
  // Interpolate by distance rather than array index to prevent abrupt jumps.
  const distances=[0];
  for(let i=1;i<points.length;i++){
    const dy=(points[i][0]-points[i-1][0])*111000;
    const dx=(points[i][1]-points[i-1][1])*108000;
    distances.push(distances.at(-1)+Math.hypot(dx,dy));
  }
  const length=distances.at(-1)||1;
  let posting=false;
  const tick=async()=>{
    if(posting)return;posting=true;
    progress=Math.min(1,progress+.035);
    const target=progress*length;
    let i=1;while(i<distances.length-1&&distances[i]<target)i++;
    const segment=distances[i]-distances[i-1]||1;
    const fraction=Math.max(0,Math.min(1,(target-distances[i-1])/segment));
    const lat=points[i-1][0]+(points[i][0]-points[i-1][0])*fraction;
    const lng=points[i-1][1]+(points[i][1]-points[i-1][1])*fraction;
    try{await updateLocation(orderId,lat,lng,'simulation')}catch(err){toast(err.message);stopDemo()}
    posting=false;
    if(progress>=1){stopDemo();toast('📍 Simulation arrived at destination. Mark delivered when ready.');render();}
  };
  await tick();
  if(progress<1)state.demoTimer=setInterval(tick,1100);
  render();
}
function startGPS(orderId){
  if(!navigator.geolocation){toast('Geolocation is not supported by your browser.');return;}
  stopDemo();stopGPS();
  state.gpsEnabled=true;state.gpsOrderId=orderId;
  const watchId=navigator.geolocation.watchPosition(
    position=>updateLocation(orderId,position.coords.latitude,position.coords.longitude,'gps').catch(e=>toast(e.message)),
    err=>{stopGPS();toast('GPS unavailable: '+err.message);render()},
    {enableHighAccuracy:true,maximumAge:2000,timeout:15000}
  );
  state.gpsWatchId=watchId;
  render();toast('📍 Real GPS sharing requested. Allow location access.');
}
async function takeAction(orderId,action){
  try{
    if(action==='delivered'){stopDemo();stopGPS();}
    const resp=await api(`/api/orders/${encodeURIComponent(orderId)}/action`,'POST',{role:state.role,action});
    state.selectedOrderId=orderId;
    toast(`✓ ${STATUS_NAMES[resp.order.status] || 'Updated'} successfully`);
    applyUpdate({orders:state.orders.map(o=>o.id===orderId?resp.order:o)});
  }catch(err){toast('⚠ '+err.message);render()}
}
function switchRole(role){
  if(!['customer','seller','driver','admin'].includes(role))return;
  if(authSession?.user?.role===role)return;
  desiredRole=role;authMode='login';renderAuth();
}

function roleSignupFields(role){
  if(role==='seller') return `
    <div class="credential-section"><div class="credential-title">Store & business credentials</div>
      <div class="field-grid two">
        <div class="field"><label>Store / stall name</label><input name="storeName" required maxlength="100" placeholder="e.g. Aling Nena Fresh Produce"></div>
        <div class="field"><label>Mobile number</label><input name="phone" type="tel" required maxlength="20" placeholder="09XXXXXXXXX"></div>
      </div>
      <div class="field"><label>Store / stall location</label><input name="storeLocation" required maxlength="180" placeholder="Stall no., section, Tanauan City Public Market"></div>
      <div class="field-grid two">
        <div class="field"><label>Business registration type</label><select name="registrationType" required><option value="">Choose</option><option>DTI</option><option>SEC</option><option>CDA</option><option>LGU / Market Stall Permit</option></select></div>
        <div class="field"><label>Registration / permit no.</label><input name="registrationNumber" required maxlength="80" placeholder="Registration number"></div>
      </div>
      <div class="field-grid two">
        <div class="field"><label>BIR TIN</label><input name="tin" required maxlength="30" placeholder="TIN"></div>
        <div class="field"><label>Mayor's / business permit no.</label><input name="businessPermit" required maxlength="80" placeholder="Permit number"></div>
      </div>
      <div class="field-grid two">
        <div class="field"><label>Valid ID type</label><select name="validIdType" required><option value="">Choose</option><option>PhilSys ID</option><option>Driver's License</option><option>Passport</option><option>UMID</option><option>PRC ID</option><option>Voter's ID</option><option>Other government ID</option></select></div>
        <div class="field"><label>Valid ID number</label><input name="validIdNumber" required maxlength="80" placeholder="ID number"></div>
      </div>
    </div>`;
  if(role==='driver') return `
    <div class="credential-section"><div class="credential-title">Driver & motorcycle credentials</div>
      <div class="field-grid two">
        <div class="field"><label>Mobile number</label><input name="phone" type="tel" required maxlength="20" placeholder="09XXXXXXXXX"></div>
        <div class="field"><label>Driver's license no.</label><input name="licenseNumber" required maxlength="80" placeholder="License number"></div>
      </div>
      <div class="field-grid two">
        <div class="field"><label>License type</label><select name="licenseType" required><option value="">Choose</option><option>Professional</option><option>Non-Professional</option></select></div>
        <div class="field"><label>License expiry</label><input name="licenseExpiry" type="date" required></div>
      </div>
      <div class="field-grid two">
        <div class="field"><label>Motorcycle type</label><select name="motorcycleType" required><option value="">Choose</option><option>Scooter</option><option>Underbone</option><option>Standard / Naked</option><option>Backbone</option><option>Electric motorcycle</option><option>Other</option></select></div>
        <div class="field"><label>Plate number</label><input name="plateNumber" required maxlength="30" placeholder="Plate number"></div>
      </div>
      <div class="field-grid two">
        <div class="field"><label>Motorcycle make / model</label><input name="vehicleModel" required maxlength="100" placeholder="e.g. Honda Click 125"></div>
        <div class="field"><label>OR/CR reference no.</label><input name="orcrNumber" required maxlength="80" placeholder="OR/CR reference"></div>
      </div>
    </div>`;
  return `<div class="field"><label>Mobile number</label><input name="phone" type="tel" required maxlength="20" placeholder="09XXXXXXXXX"></div>`;
}

function authMarkup(){
  const caps=desiredRole[0].toUpperCase()+desiredRole.slice(1);
  const adminOnly=desiredRole==='admin';
  return `<div class="auth-screen"><div class="auth-box">
    <div class="auth-logo">🛍️</div><span class="eyebrow">PALENGKE EXPRESS</span>
    <h1>${caps} ${authMode==='login'?'Login':'Sign Up'}</h1>
    <p>${desiredRole==='admin'?'Review accounts and approve sellers and drivers.':desiredRole==='customer'?'Shop fresh goods and follow your orders.':desiredRole==='seller'?'Manage purchases and arrange deliveries.':'Accept jobs and share your route.'}</p>
    ${adminOnly?'':`<div class="auth-tabs"><button type="button" class="${authMode==='login'?'selected':''}" data-auth-mode="login">Log in</button><button type="button" class="${authMode==='signup'?'selected':''}" data-auth-mode="signup">Sign up</button></div>`}
    <form id="auth-form" autocomplete="on">
    ${authMode==='signup'&&!adminOnly?'<div class="field"><label for="auth-name">Full name</label><input id="auth-name" name="name" required minlength="2" maxlength="80" autocomplete="name" placeholder="Your full name"></div>':''}
    ${authMode==='signup'&&!adminOnly ? roleSignupFields(desiredRole) : ''}
    <div class="field"><label for="auth-email">Email address</label><input id="auth-email" type="email" name="email" autocomplete="email" required placeholder="you@example.com"></div>
    <div class="field"><label for="auth-password">Password</label><input id="auth-password" type="password" name="password" minlength="${authMode==='signup'?10:1}" autocomplete="${authMode==='signup'?'new-password':'current-password'}" required placeholder="${authMode==='signup'?'At least 10 characters':'Your password'}"></div>
    <button type="submit" class="btn btn-primary btn-full">${adminOnly||authMode==='login'?'Log in':'Create account'} as ${caps}</button>
    <div class="auth-message" id="auth-message" role="alert"></div>
    </form><small>${adminOnly?'Admin accounts are created by the server administrator.':'Seller and driver registrations stay pending until an admin approves them. Passwords are never saved in Google Sheets.'}</small>
    ${authSession?'<button type="button" class="btn btn-ghost btn-full" data-auth-cancel>← Back to my dashboard</button>':''}
    </div></div>`;
}
function renderAuth(){ destroyMap();state.modalOpen=false;syncAuthChrome();$('#modal-root').innerHTML='';$('#app-content').innerHTML=authMarkup(); }
async function submitAuth(e){
  e.preventDefault();const form=e.target,button=form.querySelector('[type="submit"]');button.disabled=true;
  const payload={role:desiredRole,email:form.elements.namedItem('email').value.trim(),password:form.elements.namedItem('password').value};
  if(authMode==='signup' && desiredRole!=='admin'){
    payload.name=form.elements.namedItem('name').value.trim();
    payload.phone=form.elements.namedItem('phone')?.value.trim()||'';
    if(desiredRole==='seller') payload.credentials={
      storeName:form.elements.namedItem('storeName').value.trim(),storeLocation:form.elements.namedItem('storeLocation').value.trim(),
      registrationType:form.elements.namedItem('registrationType').value,registrationNumber:form.elements.namedItem('registrationNumber').value.trim(),
      tin:form.elements.namedItem('tin').value.trim(),businessPermit:form.elements.namedItem('businessPermit').value.trim(),
      validIdType:form.elements.namedItem('validIdType').value,validIdNumber:form.elements.namedItem('validIdNumber').value.trim()
    };
    if(desiredRole==='driver') payload.credentials={
      licenseNumber:form.elements.namedItem('licenseNumber').value.trim(),licenseType:form.elements.namedItem('licenseType').value,
      licenseExpiry:form.elements.namedItem('licenseExpiry').value,motorcycleType:form.elements.namedItem('motorcycleType').value,
      plateNumber:form.elements.namedItem('plateNumber').value.trim(),vehicleModel:form.elements.namedItem('vehicleModel').value.trim(),
      orcrNumber:form.elements.namedItem('orcrNumber').value.trim()
    };
  }
  try{
    const result=await api('/api/auth/'+(authMode==='signup'&&desiredRole!=='admin'?'signup':'login'),'POST',payload);
    if(result.pending){ const el=$('#auth-message'); if(el) el.textContent=result.message||'Registration submitted for admin approval.'; button.disabled=false; authMode='login'; return; }
    if(window.pxEvents)window.pxEvents.close();stopGPS();stopDemo();
    authSession=result;sessionStorage.setItem('px-session',JSON.stringify(result));
    state.role=result.user.role;state.customerId=result.user.id;state.customerName=result.user.name;
    state.rider=result.user.role==='driver'?{id:result.user.id,name:result.user.name,vehicle:'Motorcycle'}:null;
    state.orders=[];state.signature='';state.hasLoaded=false;state.section='shop';state.selectedOrderId=null;
    await init();toast('Welcome, '+result.user.name+'!');
  }catch(err){const el=$('#auth-message');if(el)el.textContent=err.message;button.disabled=false;}
}
async function logout(){
  if(authSession)try{await api('/api/auth/logout','POST',{});}catch(_){}
  if(window.pxEvents)window.pxEvents.close();stopGPS();stopDemo();authSession=null;state.accountMenuOpen=false;state.accountModalOpen=false;sessionStorage.removeItem('px-session');
  state.orders=[];state.hasLoaded=false;state.signature='';desiredRole=state.role;authMode='login';renderAuth();
}

function captureDraft(){
  if(!state.modalOpen)return;
  if($('#customer-name'))state.draftName=$('#customer-name').value;
  if($('#delivery-address'))state.draftAddress=$('#delivery-address').value;
  if($('#delivery-notes'))state.draftNotes=$('#delivery-notes').value;
}
async function useCustomerGPS(){
  if(!navigator.geolocation){toast('Location is not available in this browser.');return;}
  captureDraft();
  navigator.geolocation.getCurrentPosition(pos=>{
    state.draftLocation={id:'gps',name:'My GPS location',address:'My current GPS position, Tanauan',lat:pos.coords.latitude,lng:pos.coords.longitude};
    if(!state.draftAddress||state.locations.some(l=>l.address===state.draftAddress))state.draftAddress='My current GPS location — add house and street';
    renderModal();toast('📍 GPS pin added. Please check your delivery address.');
  },err=>toast('Could not get location: '+err.message),{enableHighAccuracy:true,timeout:13000});
}
async function placeOrder(event){
  event.preventDefault();captureDraft();
  const name=state.draftName.trim(),address=state.draftAddress.trim(),loc=state.draftLocation;
  if(!name||!address||!loc){toast('Provide your name and delivery location.');return;}
  const submit=$('#checkout-form button[type="submit"]');if(submit)submit.disabled=true;
  try{
    const result=await api('/api/orders','POST',{
      customerId:state.customerId,customerName:name,sellerId:state.selectedStoreId,destination:{lat:loc.lat,lng:loc.lng,address},notes:state.draftNotes,
      items:Object.entries(state.cart).filter(([,q])=>q>0).map(([productId,quantity])=>({productId,quantity}))
    });
    state.customerName=name;localStorage.setItem('px-customer-name',name);
    state.cart={};saveCart();state.selectedOrderId=result.order.id;state.section='orders';closeCart();
    applyUpdate({orders:[result.order,...state.orders.filter(o=>o.id!==result.order.id)]});
    toast('✅ Order placed! Seller will see it immediately.');
  }catch(err){toast('⚠ '+err.message);if(submit)submit.disabled=false;}
}
document.addEventListener('click',async event=>{
  if(event.target.matches('[data-close-account-modal]')){state.accountModalOpen=false;render();return;}
  const element=event.target.closest('button');if(!element)return;
  if(element.dataset.role){switchRole(element.dataset.role);return;}
  if(element.hasAttribute('data-account-menu')){state.accountMenuOpen=!state.accountMenuOpen;updateCounters();return;}
  if(element.dataset.accountAction){
    const action=element.dataset.accountAction;state.accountMenuOpen=false;
    if(action==='logout'){logout();return;}
    if(action==='account'){state.accountModalOpen=true;render();return;}
    if(action==='settings'){
      if(state.role==='customer'){state.section='settings';render();return;}
      if(state.role==='seller'){state.section='seller';render();setTimeout(()=>document.querySelector('#store-settings-form')?.scrollIntoView({behavior:'smooth',block:'start'}),0);return;}
      toast(state.role==='driver'?'Driver settings are managed from your account profile.':'Admin settings are managed from the admin dashboard.');render();return;
    }
  }
  if(element.hasAttribute('data-close-account-modal')){state.accountModalOpen=false;render();return;}
  if(element.dataset.authMode){authMode=element.dataset.authMode;renderAuth();return;}
  if(element.hasAttribute('data-auth-cancel')){render();return;}
  if(element.hasAttribute('data-logout')){logout();return;}
  if(element.dataset.adminUser && element.dataset.decision){
    element.disabled=true; try{await api(`/api/admin/users/${encodeURIComponent(element.dataset.adminUser)}/approval`,'POST',{decision:element.dataset.decision}); const ud=await api('/api/admin/users');state.users=ud.users||[];render();toast('Account '+element.dataset.decision+'.');}catch(err){toast('⚠ '+err.message);element.disabled=false;} return;
  }
  if(element.dataset.resetPassword){
    const name=element.dataset.resetName||'this account';
    const newPassword=window.prompt(`Set a new temporary password for ${name}.\nMinimum 10 characters:`);
    if(newPassword===null)return;
    if(newPassword.length<10){toast('⚠ Password must have at least 10 characters.');return;}
    element.disabled=true;
    try{
      const result=await api(`/api/admin/users/${encodeURIComponent(element.dataset.resetPassword)}/reset-password`,'POST',{newPassword});
      window.alert(`Temporary password for ${name}:\n\n${result.temporaryPassword || newPassword}\n\nCopy it now. It will not be shown again.`);
      toast('✓ Password reset. The temporary password was shown once.');
    }
    catch(err){toast('⚠ '+err.message);element.disabled=false;}
    return;
  }
  if(element.dataset.deleteAccount){
    const name=element.dataset.deleteName||'this account';
    const role=element.dataset.deleteRole||'user';
    if(!window.confirm(`Delete ${role} account “${name}”?\n\nThis removes the account and signs it out immediately. This action cannot be undone.`))return;
    element.disabled=true;
    try{
      await api(`/api/admin/users/${encodeURIComponent(element.dataset.deleteAccount)}`,'DELETE');
      const ud=await api('/api/admin/users');state.users=ud.users||[];render();toast('✓ Account deleted.');
    }catch(err){toast('⚠ '+err.message);element.disabled=false;}
    return;
  }
  
  if(element.dataset.editProduct){
    const p=state.products.find(x=>x.id===element.dataset.editProduct);if(!p)return;
    const name=window.prompt('Item name:',p.name);if(name===null)return;
    const price=window.prompt('Price (₱):',String(p.price));if(price===null)return;
    const stock=window.prompt('Stock quantity:',String(p.stock||0));if(stock===null)return;
    const unit=window.prompt('Unit:',p.unit);if(unit===null)return;
    try{await api(`/api/seller/products/${encodeURIComponent(p.id)}`,'PATCH',{name,price:Number(price),stock:Number(stock),unit});toast('✓ Item updated.');}catch(err){toast('⚠ '+err.message);}return;
  }
  if(element.dataset.removeProduct){
    if(!window.confirm(`Remove “${element.dataset.productName||'this item'}” from your store?`))return;
    try{await api(`/api/seller/products/${encodeURIComponent(element.dataset.removeProduct)}`,'DELETE');toast('✓ Item removed.');}catch(err){toast('⚠ '+err.message);}return;
  }
  if(element.dataset.section){state.section=element.dataset.section;state.selectedOrderId=null;render();return;}
  if(element.dataset.store){
    if(element.dataset.store===state.selectedStoreId)return;
    if(cartCount() && !window.confirm('Switch seller stores? Your current cart will be cleared so products are not mixed between sellers.'))return;
    state.cart={};saveCart();state.selectedStoreId=element.dataset.store;state.filter='All';state.search='';render();toast('🏪 Store selected');return;
  }
  if(element.dataset.filter){state.filter=element.dataset.filter;render();return;}
  if(element.dataset.order){state.selectedOrderId=element.dataset.order;render();return;}
  if(element.dataset.add){modifyCart(element.dataset.add,1);return;}
  if(element.hasAttribute('data-open-cart')){openCart();return;}
  if(element.hasAttribute('data-close-cart')){closeCart();return;}
  if(element.dataset.adjust){captureDraft();modifyCart(element.dataset.product,Number(element.dataset.adjust));return;}
  if(element.dataset.action){element.disabled=true;await takeAction(element.dataset.id,element.dataset.action);return;}
  if(element.id==='use-customer-gps'){useCustomerGPS();return;}
  if(element.hasAttribute('data-start-demo')){await startSimulation(element.dataset.startDemo);return;}
  if(element.hasAttribute('data-stop-demo')){stopDemo();render();toast('Simulation stopped');return;}
  if(element.hasAttribute('data-start-gps')){startGPS(element.dataset.startGps);return;}
  if(element.hasAttribute('data-stop-gps')){stopGPS();render();toast('GPS sharing stopped');return;}
});
document.addEventListener('input',event=>{
  if(event.target.id==='search-products'){
    state.search=event.target.value;
    const products=selectedStoreProducts().filter(p=>(state.filter==='All'||p.category===state.filter)&&(`${p.name} ${p.category}`).toLowerCase().includes(state.search.toLowerCase()));
    $('#product-grid').innerHTML=productCards(products,state.stores.find(x=>x.id===state.selectedStoreId));
    $('#products-count').textContent=products.length+' fresh products available';
  }
  if(['customer-name','delivery-address','delivery-notes'].includes(event.target.id))captureDraft();
});
document.addEventListener('change',event=>{
  if(event.target.id==='store-select'){
    const nextStore=event.target.value;
    if(nextStore===state.selectedStoreId)return;
    if(cartCount() && !window.confirm('Switch seller stores? Your current cart will be cleared so products are not mixed between sellers.')){event.target.value=state.selectedStoreId;return;}
    state.cart={};saveCart();state.selectedStoreId=nextStore;state.filter='All';state.search='';render();toast('🏪 Store selected');return;
  }
  if(event.target.id==='customer-neighborhood'){
    captureDraft();const loc=state.locations.find(l=>l.id===event.target.value);
    if(loc){state.draftLocation=loc;state.draftAddress=loc.address;if($('#delivery-address'))$('#delivery-address').value=loc.address;}
  }
});
async function addSellerProduct(event){
  event.preventDefault();const f=event.target;const button=f.querySelector('[type="submit"]');button.disabled=true;
  try{await api('/api/seller/products','POST',{name:f.name.value.trim(),category:f.category.value,price:Number(f.price.value),stock:Number(f.stock.value),unit:f.unit.value.trim(),emoji:f.emoji.value.trim()||'🧺'});f.reset();toast('✓ Item added to your store.');}catch(err){toast('⚠ '+err.message);button.disabled=false;}
}
async function saveStoreSettings(event){
  event.preventDefault();const f=event.target;const days=[...f.querySelectorAll('input[name="days"]:checked')].map(x=>Number(x.value));const button=f.querySelector('[type="submit"]');button.disabled=true;
  try{await api('/api/seller/store-settings','POST',{mode:f.mode.value,manualOpen:f.manualOpen.checked,openTime:f.openTime.value,closeTime:f.closeTime.value,days});toast('✓ Store hours updated.');}catch(err){toast('⚠ '+err.message);button.disabled=false;}
}
async function saveCustomerProfile(event){
  event.preventDefault(); const f=event.target,button=f.querySelector('[type="submit"]'); button.disabled=true;
  try{
    const result=await api('/api/account/profile','PATCH',{email:f.email.value.trim(),phone:f.phone.value.trim(),address:f.address.value.trim()});
    authSession.user=result.user; sessionStorage.setItem('px-session',JSON.stringify(authSession)); state.customerName=result.user.name; state.customerId=result.user.id; state.draftAddress=result.user.profile?.deliveryAddress||'';
    render(); toast('✓ Customer details updated.');
  }catch(err){toast('⚠ '+err.message);button.disabled=false;}
}
async function changeCustomerPassword(event){
  event.preventDefault(); const f=event.target,button=f.querySelector('[type="submit"]');
  if(f.newPassword.value!==f.confirmPassword.value){toast('⚠ New passwords do not match.');return;}
  button.disabled=true;
  try{await api('/api/account/change-password','POST',{currentPassword:f.currentPassword.value,newPassword:f.newPassword.value});f.reset();toast('✓ Password changed successfully.');}
  catch(err){toast('⚠ '+err.message);} finally{button.disabled=false;}
}
document.addEventListener('click',event=>{if(state.accountMenuOpen && !event.target.closest('.account-menu-wrap')){state.accountMenuOpen=false;updateCounters();}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(state.accountMenuOpen){state.accountMenuOpen=false;updateCounters();}if(state.accountModalOpen){state.accountModalOpen=false;render();}}});
document.addEventListener('submit',event=>{if(event.target.id==='checkout-form')placeOrder(event);if(event.target.id==='auth-form')submitAuth(event);if(event.target.id==='add-product-form')addSellerProduct(event);if(event.target.id==='store-settings-form')saveStoreSettings(event);if(event.target.id==='customer-profile-form')saveCustomerProfile(event);if(event.target.id==='customer-password-form')changeCustomerPassword(event);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&state.modalOpen)closeCart();});
window.addEventListener('beforeunload',()=>{stopDemo();stopGPS();});
if(authSession){api('/api/auth/me').then(()=>init()).catch(()=>{authSession=null;sessionStorage.removeItem('px-session');renderAuth();});}else renderAuth();
