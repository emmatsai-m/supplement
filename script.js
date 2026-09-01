// ===== 請貼上 Firebase 專案設定（在 Firebase 主控台「專案設定」裡拿得到）=====
const firebaseConfig = {
  apiKey: "AIzaSyAZXE94WwGYSiR2UrOxzhABmNt14zFaMjE",
  authDomain: "someee-a18ab.firebaseapp.com",
  projectId: "someee-a18ab",
  storageBucket: "someee-a18ab.firebasestorage.app",
  messagingSenderId: "212789693257",
  appId: "1:212789693257:web:939aea98f5692496182898"
};

// 要跟你在 Firebase Authentication「使用者」分頁建立的那組帳號 email 完全一樣
const FAMILY_EMAIL = 'someetest@gmail.com';

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let purchases = [];
let usages = [];
let purchasePage = 1;
const PAGE_SIZE = 20;

// 庫存總表的畫面狀態
let stockPage = 1;
const STOCK_PAGE_SIZE = 12;
let stockSearchTerm = '';
let compareSearchTerm = '';
let activeUsePanelIndex = null;
let openDetailKeys = new Set();
let editingBatchId = null;
let lastInventoryGroups = [];

function setSyncStatus(text, isError){
  const el = document.getElementById('syncBadge');
  el.textContent = text;
  el.style.color = isError ? 'var(--red)' : 'var(--ink-soft)';
}

function doLogout(){
  auth.signOut();
}

function tryLogin(){
  const code = document.getElementById('passcodeInput').value;
  const errEl = document.getElementById('loginError');
  if(!code){
    errEl.textContent = '請輸入通行碼';
    return;
  }
  errEl.textContent = '登入中…';
  auth.signInWithEmailAndPassword(FAMILY_EMAIL, code)
    .catch(err => {
      console.error('登入失敗', err);
      errEl.textContent = '通行碼錯誤，請再試一次';
    });
}

function attachListeners(){
  setSyncStatus('雲端同步中…', false);

  db.collection('family').doc('shared').collection('purchases')
    .onSnapshot(snap => {
      purchases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderPurchases();
      renderLocationSuggestions();
      renderInventoryOverview();
      renderCompare();
      setSyncStatus('已同步雲端', false);
    }, err => {
      console.error('讀取購買紀錄失敗', err);
      setSyncStatus('雲端讀取失敗，請確認 Firebase 設定與規則', true);
    });

  db.collection('family').doc('shared').collection('usages')
    .onSnapshot(snap => {
      usages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderInventoryOverview();
      setSyncStatus('已同步雲端', false);
    }, err => {
      console.error('讀取使用紀錄失敗', err);
      setSyncStatus('雲端讀取失敗，請確認 Firebase 設定與規則', true);
    });
}

auth.onAuthStateChanged(user => {
  if(user){
    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('appContent').style.display = 'block';
    attachListeners();
  } else {
    document.getElementById('loginGate').style.display = 'flex';
    document.getElementById('appContent').style.display = 'none';
  }
});

const reactionOptions = [
  { key: '精神良好', type: 'good' },
  { key: '無感', type: 'neutral-grey' },
  { key: '胃不適', type: 'bad' },
  { key: '嗜睡', type: 'neutral' },
  { key: '皮膚起疹', type: 'bad' },
  { key: '睡眠改善', type: 'good' },
];
let selectedReactions = new Set();

function badgeClass(type){
  if(type === 'good') return 'b-good';
  if(type === 'bad') return 'b-bad';
  if(type === 'neutral') return 'b-neutral';
  return 'b-grey';
}

function fmtDate(){
  const d = new Date();
  const w = ['日','一','二','三','四','五','六'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（週${w}）`;
}
document.getElementById('todayBadge').textContent = fmtDate();

// ---- tabs ----
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.tab).classList.add('active');
  });
});

// ---- 效期狀態 ----
function expiryStatus(expiryMonth){
  if(!expiryMonth) return { label: '', cls: '' };
  const now = new Date();
  const curYM = now.getFullYear()*12 + now.getMonth();
  const parts = expiryMonth.split('-').map(Number);
  const expYM = parts[0]*12 + (parts[1]-1);
  const diff = expYM - curYM;
  if(diff < 0) return { label: '已過期', cls: 'expired' };
  if(diff <= 2) return { label: '即期', cls: 'soon' };
  return { label: '', cls: '' };
}

// ---- purchase ----
function updateBuyCalc(){
  const units = parseFloat(document.getElementById('buy-units').value) || 0;
  const qty = parseFloat(document.getElementById('buy-qty').value) || 0;
  const total = parseFloat(document.getElementById('buy-total').value) || 0;
  const unitPrice = qty > 0 ? total / qty : 0;
  const totalPieces = units * qty;
  const costPerPiece = totalPieces > 0 ? total / totalPieces : 0;
  document.getElementById('buy-unitprice-display').value = 'NT$ ' + unitPrice.toFixed(1);
  document.getElementById('buy-costperpiece-display').value = totalPieces > 0 ? ('NT$ ' + costPerPiece.toFixed(2) + ' /顆') : '—';
}

async function addPurchase(){
  const date = document.getElementById('buy-date').value;
  const itemName = document.getElementById('buy-item').value.trim();
  const brand = document.getElementById('buy-brand').value.trim();
  const spec = document.getElementById('buy-spec').value.trim();
  const unitsPerContainer = parseFloat(document.getElementById('buy-units').value) || 0;
  const containerQty = parseInt(document.getElementById('buy-qty').value) || 1;
  const totalPrice = parseFloat(document.getElementById('buy-total').value) || 0;
  const expiryMonth = document.getElementById('buy-expiry').value;
  const location = document.getElementById('buy-location').value.trim();
  const buyer = document.getElementById('buy-buyer').value.trim();

  if(!date || !itemName || !brand || unitsPerContainer <= 0 || containerQty <= 0){
    alert('請至少填寫日期、品項、品牌、每瓶顆數與購買數量');
    return;
  }

  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('purchases').add({
      date, itemName, brand, spec, unitsPerContainer, containerQty, totalPrice,
      expiryMonth, location, buyer,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('buy-item').value = '';
    document.getElementById('buy-brand').value = '';
    document.getElementById('buy-spec').value = '';
    document.getElementById('buy-units').value = '';
    document.getElementById('buy-qty').value = 1;
    document.getElementById('buy-total').value = '';
    document.getElementById('buy-expiry').value = '';
    document.getElementById('buy-location').value = '';
    document.getElementById('buy-buyer').value = '';
    updateBuyCalc();
    setSyncStatus('已同步雲端', false);
  } catch(err){
    console.error('新增購買紀錄失敗', err);
    setSyncStatus('雲端寫入失敗，請確認網路與規則設定', true);
  }
}

async function deletePurchase(id){
  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('purchases').doc(id).delete();
    setSyncStatus('已同步雲端', false);
  } catch(err){
    console.error('刪除購買紀錄失敗', err);
    setSyncStatus('雲端刪除失敗', true);
  }
}

async function saveEditBatch(id){
  const date = document.getElementById('edit-date-'+id).value;
  const itemName = document.getElementById('edit-item-'+id).value.trim();
  const brand = document.getElementById('edit-brand-'+id).value.trim();
  const spec = document.getElementById('edit-spec-'+id).value.trim();
  const unitsPerContainer = parseFloat(document.getElementById('edit-units-'+id).value) || 0;
  const containerQty = parseInt(document.getElementById('edit-qty-'+id).value) || 1;
  const totalPrice = parseFloat(document.getElementById('edit-total-'+id).value) || 0;
  const expiryMonth = document.getElementById('edit-expiry-'+id).value;
  const location = document.getElementById('edit-location-'+id).value.trim();
  const buyer = document.getElementById('edit-buyer-'+id).value.trim();

  if(!date || !itemName || !brand || unitsPerContainer <= 0 || containerQty <= 0){
    alert('請至少填寫日期、品項、品牌、每瓶顆數與購買數量');
    return;
  }

  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('purchases').doc(id).update({
      date, itemName, brand, spec, unitsPerContainer, containerQty, totalPrice, expiryMonth, location, buyer
    });
    editingBatchId = null;
    setSyncStatus('已同步雲端', false);
  } catch(err){
    console.error('更新購買紀錄失敗', err);
    setSyncStatus('雲端更新失敗', true);
  }
}

function startEditBatch(id){
  editingBatchId = id;
  renderPurchases();
  renderInventoryOverview();
}

function cancelEditBatch(){
  editingBatchId = null;
  renderPurchases();
  renderInventoryOverview();
}

function renderBatchEditForm(b){
  return `
    <div class="card" style="margin:8px 0;">
      <div class="form-grid">
        <div class="field"><label>日期</label><input type="date" id="edit-date-${b.id}" value="${b.date||''}"></div>
        <div class="field" style="grid-column:span 2;"><label>品項</label><input type="text" id="edit-item-${b.id}" value="${b.itemName||''}"></div>
        <div class="field"><label>品牌</label><input type="text" id="edit-brand-${b.id}" value="${b.brand||''}"></div>
        <div class="field" style="grid-column:span 2;"><label>規格</label><input type="text" id="edit-spec-${b.id}" value="${b.spec||''}"></div>
        <div class="field"><label>每瓶顆數</label><input type="number" id="edit-units-${b.id}" value="${b.unitsPerContainer||0}"></div>
        <div class="field"><label>購買瓶數</label><input type="number" id="edit-qty-${b.id}" value="${b.containerQty||1}"></div>
        <div class="field"><label>總價</label><input type="number" id="edit-total-${b.id}" value="${b.totalPrice||0}"></div>
        <div class="field"><label>效期（年月）</label><input type="month" id="edit-expiry-${b.id}" value="${b.expiryMonth||''}"></div>
        <div class="field"><label>存放地點</label><input type="text" id="edit-location-${b.id}" value="${b.location||''}"></div>
        <div class="field"><label>採購人</label><input type="text" id="edit-buyer-${b.id}" value="${b.buyer||''}"></div>
      </div>
      <div class="actions">
        <button class="page-btn" onclick="cancelEditBatch()">取消</button>
        <button class="submit" onclick="saveEditBatch('${b.id}')">儲存</button>
      </div>
    </div>
  `;
}

function changePurchasePage(delta){
  purchasePage += delta;
  renderPurchases();
}

function renderPurchases(){
  const listWrap = document.getElementById('buyListWrap');
  const pageWrap = document.getElementById('buyPagination');

  const sorted = purchases.slice().sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if(purchasePage > totalPages) purchasePage = totalPages;
  if(purchasePage < 1) purchasePage = 1;
  const startIdx = (purchasePage - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(startIdx, startIdx + PAGE_SIZE);

  if(sorted.length === 0){
    listWrap.innerHTML = '<div class="empty">還沒有購買紀錄，於上方表單新增第一筆吧。</div>';
    pageWrap.innerHTML = '';
  } else {
    listWrap.innerHTML = pageItems.map(p=>{
      if(editingBatchId === p.id) return renderBatchEditForm(p);
      const units = Number(p.unitsPerContainer) || 0;
      const qty = Number(p.containerQty) || 0;
      const total = Number(p.totalPrice) || 0;
      const pieces = units * qty;
      const costPerPiece = pieces > 0 ? total / pieces : 0;
      const exp = expiryStatus(p.expiryMonth);
      return `
        <div class="list-row">
          <div class="lr-main">
            <div class="lr-title">${p.itemName} <span class="lr-brand">・ ${p.brand}</span>${exp.label ? ` <span class="expiry-badge ${exp.cls}">${exp.label}</span>` : ''}</div>
            <div class="lr-sub">${p.date}${p.spec ? ' ・ ' + p.spec : ''}</div>
            <div class="lr-sub">${qty} 瓶 × ${units} 顆／瓶${p.location ? ' ・ 📍' + p.location : ''}${p.buyer ? ' ・ 🧑 ' + p.buyer : ''}</div>
          </div>
          <div class="lr-total">
            <div class="money">NT$ ${total.toLocaleString()}</div>
            <div class="lr-cost">${pieces>0 ? 'NT$ ' + costPerPiece.toFixed(2) + ' /顆' : ''}</div>
          </div>
          <button class="del-btn" onclick="startEditBatch('${p.id}')">編輯</button>
          <button class="del-btn" onclick="deletePurchase('${p.id}')">刪除</button>
        </div>
      `;
    }).join('');

    pageWrap.innerHTML = `
      <button class="page-btn" onclick="changePurchasePage(-1)" ${purchasePage<=1?'disabled':''}>‹ 上一頁</button>
      <span class="page-info">第 ${purchasePage}／${totalPages} 頁（共 ${sorted.length} 筆）</span>
      <button class="page-btn" onclick="changePurchasePage(1)" ${purchasePage>=totalPages?'disabled':''}>下一頁 ›</button>
    `;
  }

  const totalSpend = purchases.reduce((s,p)=> s + (Number(p.totalPrice)||0), 0);
  const itemCount = new Set(purchases.map(p=>p.itemName)).size;
  document.getElementById('buyStats').innerHTML = `
    <div class="stat"><div class="num">NT$ ${totalSpend.toLocaleString()}</div><div class="label">累計花費</div></div>
    <div class="stat"><div class="num">${purchases.length}</div><div class="label">採購筆數</div></div>
    <div class="stat"><div class="num">${itemCount}</div><div class="label">品項種類</div></div>
  `;
}

function renderLocationSuggestions(){
  const dl = document.getElementById('locationSuggestions');
  if(!dl) return;
  const locs = Array.from(new Set(purchases.map(p=>p.location).filter(Boolean)));
  dl.innerHTML = locs.map(l=>`<option value="${l}"></option>`).join('');
}

// ---- 庫存總表 ----
function groupKey(itemName, location){
  return itemName + '‖' + (location || '未指定');
}

function buildInventoryGroups(){
  const groups = {};
  purchases.forEach(p=>{
    const loc = p.location || '未指定';
    const key = groupKey(p.itemName, loc);
    if(!groups[key]) groups[key] = { itemName: p.itemName, location: loc, batches: [], totalPieces: 0 };
    const units = Number(p.unitsPerContainer) || 0;
    const qty = Number(p.containerQty) || 0;
    const total = Number(p.totalPrice) || 0;
    const pieces = units * qty;
    groups[key].batches.push({ ...p, pieces, costPerPiece: pieces>0 ? total/pieces : 0 });
    groups[key].totalPieces += pieces;
  });

  const usedMap = {};
  usages.forEach(u=>{
    const loc = u.location || '未指定';
    const key = groupKey(u.itemName, loc);
    usedMap[key] = (usedMap[key] || 0) + (Number(u.qty) || 1);
  });

  return Object.keys(groups).map(key=>{
    const g = groups[key];
    const used = usedMap[key] || 0;
    const remain = Math.round((g.totalPieces - used) * 10) / 10;
    const sortedByDate = g.batches.slice().sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    const latest = sortedByDate[0];
    const expiries = g.batches.map(b=>b.expiryMonth).filter(Boolean).sort();
    const nearestExpiry = expiries[0] || null;
    return {
      key, itemName: g.itemName, location: g.location,
      totalPieces: g.totalPieces, used, remain,
      buyer: latest ? latest.buyer : '',
      nearestExpiry, batches: sortedByDate
    };
  }).sort((a,b)=> a.itemName.localeCompare(b.itemName,'zh-Hant') || a.location.localeCompare(b.location,'zh-Hant'));
}

function clearStockSearch(){
  document.getElementById('stockSearch').value = '';
  stockSearchTerm = '';
  stockPage = 1;
  renderInventoryOverview();
}

function onStockSearchInput(){
  stockSearchTerm = document.getElementById('stockSearch').value.trim();
  stockPage = 1;
  renderInventoryOverview();
}

function changeStockPage(delta){
  stockPage += delta;
  renderInventoryOverview();
}

function toggleDetail(key){
  if(openDetailKeys.has(key)) openDetailKeys.delete(key);
  else openDetailKeys.add(key);
  renderInventoryOverview();
}

function openUseDialog(idx){
  activeUsePanelIndex = (activeUsePanelIndex === idx) ? null : idx;
  selectedReactions.clear();
  renderInventoryOverview();
}

function closeUsePanel(){
  activeUsePanelIndex = null;
  renderInventoryOverview();
}

function adjustUseQty(delta){
  const input = document.getElementById('useQtyInput');
  if(!input) return;
  let val = parseFloat(input.value) || 0;
  val = Math.max(0.5, Math.round((val + delta) * 2) / 2);
  input.value = val;
}

function renderUseReactionChips(){
  const row = document.getElementById('useReactionChips');
  if(!row) return;
  row.innerHTML = '';
  reactionOptions.forEach(opt=>{
    const el = document.createElement('div');
    el.className = 'chip';
    el.textContent = opt.key;
    if(selectedReactions.has(opt.key)){
      el.classList.add(opt.type === 'bad' ? 'on-bad' : opt.type === 'good' ? 'on-good' : 'on-neutral');
    }
    el.onclick = ()=>{
      if(selectedReactions.has(opt.key)) selectedReactions.delete(opt.key);
      else selectedReactions.add(opt.key);
      renderUseReactionChips();
    };
    row.appendChild(el);
  });
}

async function confirmUse(idx){
  const g = lastInventoryGroups[idx];
  if(!g) return;
  const qty = parseFloat(document.getElementById('useQtyInput').value) || 1;
  const date = document.getElementById('useDateInput').value;
  const note = document.getElementById('useNoteInput').value.trim();

  if(!date){
    alert('請選擇使用日期');
    return;
  }

  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('usages').add({
      date, time: '', itemName: g.itemName, location: g.location, qty,
      dose: '', note, reactions: Array.from(selectedReactions),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    activeUsePanelIndex = null;
    setSyncStatus('已同步雲端', false);
  } catch(err){
    console.error('新增使用紀錄失敗', err);
    setSyncStatus('雲端寫入失敗，請確認網路與規則設定', true);
  }
}

async function deleteUsageEntry(id){
  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('usages').doc(id).delete();
    setSyncStatus('已同步雲端', false);
  } catch(err){
    console.error('刪除使用紀錄失敗', err);
    setSyncStatus('雲端刪除失敗', true);
  }
}

function renderUsePanel(idx, g){
  const today = new Date().toISOString().slice(0,10);
  setTimeout(renderUseReactionChips, 0);
  return `
    <div class="use-panel">
      <div class="form-grid">
        <div class="field">
          <label>使用顆數</label>
          <div class="stepper">
            <button class="page-btn" onclick="adjustUseQty(-0.5)">−</button>
            <input type="number" id="useQtyInput" value="1" min="0.5" step="0.5">
            <button class="page-btn" onclick="adjustUseQty(0.5)">＋</button>
          </div>
        </div>
        <div class="field">
          <label>使用日期</label>
          <input type="date" id="useDateInput" value="${today}">
        </div>
        <div class="chip-select">
          <label>身體反應（可複選）</label>
          <div class="chip-row" id="useReactionChips"></div>
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>備註（選填）</label>
          <input type="text" id="useNoteInput" placeholder="其他感受描述">
        </div>
      </div>
      <div class="actions">
        <button class="page-btn" onclick="closeUsePanel()">取消</button>
        <button class="submit" onclick="confirmUse(${idx})">✅ 確認使用</button>
      </div>
    </div>
  `;
}

function renderDetailPanel(g){
  const batchRows = g.batches.map(b=>{
    if(editingBatchId === b.id) return renderBatchEditForm(b);
    const exp = expiryStatus(b.expiryMonth);
    return `
      <div class="list-row">
        <div class="lr-main">
          <div class="lr-title">${b.date} <span class="lr-brand">・ ${b.brand}</span>${exp.label ? ` <span class="expiry-badge ${exp.cls}">${exp.label}</span>` : ''}</div>
          <div class="lr-sub">${b.spec || '—'} ・ ${b.containerQty} 瓶 × ${b.unitsPerContainer} 顆${b.buyer ? ' ・ 🧑 ' + b.buyer : ''}</div>
        </div>
        <div class="lr-total">
          <div class="money">NT$ ${Number(b.totalPrice).toLocaleString()}</div>
        </div>
        <button class="del-btn" onclick="startEditBatch('${b.id}')">編輯</button>
        <button class="del-btn" onclick="deletePurchase('${b.id}')">刪除</button>
      </div>
    `;
  }).join('');

  const relatedUsages = usages
    .filter(u => u.itemName === g.itemName && (u.location || '未指定') === g.location)
    .sort((a,b)=> (b.date||'').localeCompare(a.date||''));

  const usageRows = relatedUsages.map(u=>{
    const badges = (u.reactions||[]).map(r=>{
      const opt = reactionOptions.find(o=>o.key===r);
      const cls = opt ? badgeClass(opt.type.replace('neutral-grey','grey')) : 'b-grey';
      return `<span class="badge ${cls}">${r}</span>`;
    }).join('');
    return `
      <div class="list-row">
        <div class="lr-main">
          <div class="lr-title">${u.date} ・ 使用 ${u.qty || 1} 顆</div>
          <div class="lr-sub">${badges}</div>
          ${u.note ? `<div class="lr-sub">${u.note}</div>` : ''}
        </div>
        <button class="del-btn" onclick="deleteUsageEntry('${u.id}')">刪除</button>
      </div>
    `;
  }).join('');

  return `
    <div class="stock-detail">
      <h3>採購批次</h3>
      ${batchRows || '<div class="empty">沒有採購批次</div>'}
      <h3 style="margin-top:14px;">使用紀錄</h3>
      ${usageRows || '<div class="empty">沒有使用紀錄</div>'}
    </div>
  `;
}

function renderInventoryOverview(){
  const wrap = document.getElementById('stockWrap');
  const pageWrap = document.getElementById('stockPagination');
  if(!wrap) return;

  let groups = buildInventoryGroups();
  lastInventoryGroups = groups;

  if(stockSearchTerm){
    groups = groups.filter(g => g.itemName.includes(stockSearchTerm));
  }

  if(groups.length === 0){
    wrap.innerHTML = '<div class="card"><div class="empty">還沒有庫存資料，先到「購買紀錄」新增第一筆吧。</div></div>';
    pageWrap.innerHTML = '';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(groups.length / STOCK_PAGE_SIZE));
  if(stockPage > totalPages) stockPage = totalPages;
  if(stockPage < 1) stockPage = 1;
  const startIdx = (stockPage - 1) * STOCK_PAGE_SIZE;
  const pageGroups = groups.slice(startIdx, startIdx + STOCK_PAGE_SIZE);

  wrap.innerHTML = pageGroups.map(g=>{
    const idx = lastInventoryGroups.indexOf(g);
    const remainColor = g.remain <= 0 ? 'var(--red)' : (g.remain <= 10 ? 'var(--amber)' : 'var(--teal)');
    const exp = expiryStatus(g.nearestExpiry);
    const isDetailOpen = openDetailKeys.has(g.key);
    const isUseOpen = activeUsePanelIndex === idx;
    return `
      <div class="card item-card">
        <div class="stock-card-head">
          <div>
            <div class="stock-card-title">${g.itemName} <span class="loc-tag">📍 ${g.location}</span></div>
            <div class="lr-sub">${g.buyer ? '最近採購人：🧑 ' + g.buyer : ''}</div>
          </div>
          ${exp.label ? `<span class="expiry-badge ${exp.cls}">${exp.label}</span>` : ''}
        </div>
        <div class="stats">
          <div class="stat"><div class="num">${Math.round(g.totalPieces)}</div><div class="label">累計購買顆數</div></div>
          <div class="stat"><div class="num">${g.used}</div><div class="label">已使用顆數</div></div>
          <div class="stat"><div class="num" style="color:${remainColor}">${g.remain}</div><div class="label">估算剩餘顆數</div></div>
        </div>
        <div class="actions" style="justify-content:flex-start; gap:10px;">
          <button class="page-btn" onclick="openUseDialog(${idx})">${isUseOpen ? '收起使用面板' : '使用'}</button>
          <button class="page-btn" onclick="toggleDetail('${g.key}')">${isDetailOpen ? '收起明細' : '📋 明細'}</button>
        </div>
        ${isUseOpen ? renderUsePanel(idx, g) : ''}
        ${isDetailOpen ? renderDetailPanel(g) : ''}
      </div>
    `;
  }).join('');

  pageWrap.innerHTML = `
    <button class="page-btn" onclick="changeStockPage(-1)" ${stockPage<=1?'disabled':''}>‹ 上一頁</button>
    <span class="page-info">第 ${stockPage}／${totalPages} 頁（共 ${groups.length} 組）</span>
    <button class="page-btn" onclick="changeStockPage(1)" ${stockPage>=totalPages?'disabled':''}>下一頁 ›</button>
  `;
}

// ---- 性價比比較 ----
function clearCompareSearch(){
  document.getElementById('compareSearch').value = '';
  compareSearchTerm = '';
  renderCompare();
}

function onCompareSearchInput(){
  compareSearchTerm = document.getElementById('compareSearch').value.trim();
  renderCompare();
}

function renderCompare(){
  const wrap = document.getElementById('compareWrap');
  if(!wrap) return;

  const itemMap = {};
  purchases.forEach(p=>{
    const units = Number(p.unitsPerContainer) || 0;
    const qty = Number(p.containerQty) || 0;
    const total = Number(p.totalPrice) || 0;
    const pieces = units * qty;
    const costPerPiece = pieces > 0 ? total / pieces : 0;
    if(!itemMap[p.itemName]) itemMap[p.itemName] = { batches: [] };
    itemMap[p.itemName].batches.push({ ...p, pieces, costPerPiece });
  });

  let names = Object.keys(itemMap);
  if(compareSearchTerm){
    names = names.filter(n => n.includes(compareSearchTerm));
  }

  if(names.length === 0){
    wrap.innerHTML = '<div class="card"><div class="empty">沒有符合的品項。</div></div>';
    return;
  }

  wrap.innerHTML = names.sort((a,b)=>a.localeCompare(b,'zh-Hant')).map(name=>{
    const info = itemMap[name];
    const sortedBatches = info.batches.slice().sort((a,b)=> a.costPerPiece - b.costPerPiece);
    const cheapest = sortedBatches.length ? sortedBatches[0].costPerPiece : null;

    const batchRows = sortedBatches.map(b=>`
      <tr class="${cheapest!==null && b.costPerPiece===cheapest ? 'best-row' : ''}">
        <td>${b.date}</td>
        <td>${b.brand}</td>
        <td>${b.spec || '—'}</td>
        <td>${b.containerQty} 瓶 × ${b.unitsPerContainer} 顆</td>
        <td class="money">NT$ ${Number(b.totalPrice).toLocaleString()}</td>
        <td class="money">${b.pieces>0 ? 'NT$ ' + b.costPerPiece.toFixed(2) + ' /顆' : '—'}${cheapest!==null && b.costPerPiece===cheapest ? ' 🏆' : ''}</td>
        <td>${b.buyer || '—'}</td>
      </tr>
    `).join('');

    return `
      <div class="card item-card">
        <h2><span class="dot"></span>${name}</h2>
        <div class="table-scroll">
          <table>
            <thead><tr><th>日期</th><th>品牌</th><th>規格</th><th>數量</th><th>總價</th><th>每顆成本</th><th>採購人</th></tr></thead>
            <tbody>${batchRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

// ---- init ----
(function initDates(){
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('buy-date').value = today;
})();

updateBuyCalc();
