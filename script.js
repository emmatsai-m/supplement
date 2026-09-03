// firebaseConfig 與 FAMILY_EMAIL 定義在 firebase-config.js（index.html 會在這個檔案之前載入它）
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let purchases = [];
let usages = [];
let purchasePage = 1;
const PAGE_SIZE = 10;

// 庫存總表的畫面狀態
let stockPage = 1;
const STOCK_PAGE_SIZE = 12;
let stockSearchTerm = '';
let compareSearchTerm = '';
let stockLocationFilter = '全部';
let stockExpiryFilter = 'all'; // 'all' | 'soon' | 'expired'
let compareLocationFilter = '全部';
let openDetailKeys = new Set();
let editingBatchId = null;
let editingBatchContext = null; // 目前只會是 'manage'（採購紀錄管理），保留參數是為了未來擴充

function showToast(message, isError){
  let toast = document.getElementById('toastMsg');
  if(!toast){
    toast = document.createElement('div');
    toast.id = 'toastMsg';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  void toast.offsetWidth; // 強制重新觸發動畫
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(()=>{ toast.classList.remove('show'); }, 2400);
}

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

// 舊版身體反應標籤，保留是為了讓「之前建立的心得」還能正常顯示，新資料不會再用這組
const reactionOptions = [
  { key: '精神良好', type: 'good' },
  { key: '無感', type: 'neutral-grey' },
  { key: '胃不適', type: 'bad' },
  { key: '嗜睡', type: 'neutral' },
  { key: '皮膚起疹', type: 'bad' },
  { key: '睡眠改善', type: 'good' },
];

// 新版：簡易量化的五等級滿意度
const satisfactionLevels = [
  { value: 5, label: '非常滿意', color: 'var(--teal-deep)' },
  { value: 4, label: '滿意', color: 'var(--teal)' },
  { value: 3, label: '普通／無意見', color: 'var(--grey-chip)' },
  { value: 2, label: '不滿意', color: 'var(--amber)' },
  { value: 1, label: '非常不滿意', color: 'var(--red)' },
];
let selectedSatisfaction = null;

function satisfactionLabel(value){
  const lv = satisfactionLevels.find(l => l.value === Number(value));
  return lv || null;
}

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

  if(!date || !itemName || !brand || unitsPerContainer <= 0 || containerQty <= 0 || !location){
    alert('請至少填寫日期、品項、品牌、每瓶顆數、購買數量與存放地點');
    return;
  }

  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('purchases').add({
      date, itemName, brand, spec, unitsPerContainer, containerQty, totalPrice,
      expiryMonth, location, buyer,
      usageStatus: '未開封', startDate: '', finishDate: '', satisfaction: 0, feedbackNote: '',
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
    document.querySelectorAll('#buyLocationButtons .loc-btn').forEach(btn=>btn.classList.remove('active'));
    document.getElementById('buy-buyer').value = '';
    updateBuyCalc();
    setSyncStatus('已同步雲端', false);
    showToast('✅ 已新增，可到「採購紀錄管理」查看');
  } catch(err){
    console.error('新增購買紀錄失敗', err);
    setSyncStatus('雲端寫入失敗，請確認網路與規則設定', true);
    showToast('❌ 新增失敗，請確認網路連線', true);
  }
}

async function deletePurchase(id){
  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('purchases').doc(id).delete();
    setSyncStatus('已同步雲端', false);
    showToast('🗑️ 已刪除這筆紀錄');
  } catch(err){
    console.error('刪除購買紀錄失敗', err);
    setSyncStatus('雲端刪除失敗', true);
    showToast('❌ 刪除失敗，請確認網路連線', true);
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

  if(!date || !itemName || !brand || unitsPerContainer <= 0 || containerQty <= 0 || !location){
    alert('請至少填寫日期、品項、品牌、每瓶顆數、購買數量與存放地點');
    return;
  }

  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('purchases').doc(id).update({
      date, itemName, brand, spec, unitsPerContainer, containerQty, totalPrice, expiryMonth, location, buyer
    });
    editingBatchId = null;
    editingBatchContext = null;
    renderPurchases();
    renderInventoryOverview();
    setSyncStatus('已同步雲端', false);
    showToast('✅ 已儲存修改');
  } catch(err){
    console.error('更新購買紀錄失敗', err);
    setSyncStatus('雲端更新失敗', true);
    showToast('❌ 儲存失敗，請確認網路或規則設定', true);
  }
}

function startEditBatch(id, context){
  editingBatchId = id;
  editingBatchContext = context || 'manage';
  renderPurchases();
  renderInventoryOverview();
}

function cancelEditBatch(){
  editingBatchId = null;
  editingBatchContext = null;
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
        <div class="field"><label>存放地點</label>
          <select id="edit-location-${b.id}">
            <option value="台北" ${b.location==='台北'?'selected':''}>台北</option>
            <option value="新竹" ${b.location==='新竹'?'selected':''}>新竹</option>
          </select>
        </div>
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
  const pageWrapTop = document.getElementById('buyPaginationTop');

  const sorted = purchases.slice().sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if(purchasePage > totalPages) purchasePage = totalPages;
  if(purchasePage < 1) purchasePage = 1;
  const startIdx = (purchasePage - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(startIdx, startIdx + PAGE_SIZE);

  if(sorted.length === 0){
    listWrap.innerHTML = '<div class="empty">還沒有購買紀錄，於上方表單新增第一筆吧。</div>';
    pageWrap.innerHTML = '';
    pageWrapTop.innerHTML = '';
  } else {
    listWrap.innerHTML = pageItems.map(p=>{
      if(editingBatchId === p.id && editingBatchContext === 'manage') return renderBatchEditForm(p);
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
          <button class="del-btn" onclick="startEditBatch('${p.id}','manage')">編輯</button>
          <button class="del-btn" onclick="deletePurchase('${p.id}')">刪除</button>
        </div>
      `;
    }).join('');

    const paginationHtml = `
      <button class="page-btn" onclick="changePurchasePage(-1)" ${purchasePage<=1?'disabled':''}>‹ 上一頁</button>
      <span class="page-info">第 ${purchasePage}／${totalPages} 頁（共 ${sorted.length} 筆）</span>
      <button class="page-btn" onclick="changePurchasePage(1)" ${purchasePage>=totalPages?'disabled':''}>下一頁 ›</button>
    `;
    pageWrap.innerHTML = paginationHtml;
    pageWrapTop.innerHTML = paginationHtml;
  }

  const itemCount = new Set(purchases.map(p=>p.itemName)).size;
  document.getElementById('buyStats').innerHTML = `
    <div class="stat"><div class="num">${itemCount}</div><div class="label">品項種類</div></div>
  `;
  document.getElementById('buyItemList').innerHTML = renderItemChips();
}

function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderItemChips(handlerFnName){
  const fn = handlerFnName || 'goToItemInStock';
  const items = Array.from(new Set(purchases.map(p=>p.itemName))).filter(Boolean).sort((a,b)=>a.localeCompare(b,'zh-Hant'));
  if(items.length === 0) return '<div class="lr-sub">尚未建立任何品項</div>';
  return `<div class="chip-row">` + items.map(name=>{
    const safe = escapeHtml(name);
    return `<span class="chip" data-item="${safe}" onclick="${fn}(this.dataset.item)">${safe}</span>`;
  }).join('') + `</div>`;
}

function goToItemInStock(name){
  document.getElementById('stockSearch').value = name;
  stockSearchTerm = name;
  stockPage = 1;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelector('.tab-btn[data-tab="stock"]').classList.add('active');
  document.getElementById('panel-stock').classList.add('active');
  renderInventoryOverview();
}

function filterCompareByItem(name){
  document.getElementById('compareSearch').value = name;
  compareSearchTerm = name;
  renderCompare();
}

function selectBuyLocation(loc){
  document.getElementById('buy-location').value = loc;
  document.querySelectorAll('#buyLocationButtons .loc-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.loc === loc);
  });
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
    if(!groups[key]) groups[key] = { itemName: p.itemName, location: loc, batches: [] };
    const units = Number(p.unitsPerContainer) || 0;
    const qty = Number(p.containerQty) || 0;
    const total = Number(p.totalPrice) || 0;
    const pieces = units * qty;
    const status = p.usageStatus || '未開封';
    groups[key].batches.push({ ...p, usageStatus: status, pieces, costPerPiece: pieces>0 ? total/pieces : 0 });
  });

  return Object.keys(groups).map(key=>{
    const g = groups[key];
    const totalContainers = g.batches.reduce((s,b)=> s + (Number(b.containerQty)||0), 0);
    const finishedContainers = g.batches.filter(b=>b.usageStatus==='已用完').reduce((s,b)=> s + (Number(b.containerQty)||0), 0);
    const remainContainers = totalContainers - finishedContainers;

    const sortedByDate = g.batches.slice().sort((a,b)=> (b.date||'').localeCompare(a.date||''));
    const latest = sortedByDate[0];

    // 效期狀態只看還沒用完的批次
    const activeExpiries = g.batches.filter(b=>b.usageStatus!=='已用完').map(b=>b.expiryMonth).filter(Boolean).sort();
    const nearestExpiry = activeExpiries[0] || null;

    const activeBatches = sortedByDate.filter(b=>b.usageStatus!=='已用完');
    const finishedBatches = sortedByDate.filter(b=>b.usageStatus==='已用完');

    return {
      key, itemName: g.itemName, location: g.location,
      totalContainers, finishedContainers, remainContainers,
      buyer: latest ? latest.buyer : '',
      nearestExpiry, activeBatches, finishedBatches
    };
  }).sort((a,b)=> a.itemName.localeCompare(b.itemName,'zh-Hant') || a.location.localeCompare(b.location,'zh-Hant'));
}

function setStockLocationFilter(loc){
  stockLocationFilter = loc;
  stockPage = 1;
  document.querySelectorAll('.loc-filter-btn').forEach(btn=>{
    if(btn.id.startsWith('stockLocBtn-')){
      btn.classList.toggle('active-filter', btn.id === 'stockLocBtn-' + loc);
    }
  });
  renderInventoryOverview();
}

function setStockExpiryFilter(type){
  stockExpiryFilter = type;
  stockPage = 1;
  if(type !== 'all'){
    stockLocationFilter = '全部';
    document.querySelectorAll('.loc-filter-btn').forEach(btn=>{
      if(btn.id.startsWith('stockLocBtn-')) btn.classList.toggle('active-filter', btn.id === 'stockLocBtn-全部');
    });
    stockSearchTerm = '';
    const searchInput = document.getElementById('stockSearch');
    if(searchInput) searchInput.value = '';
  }
  renderInventoryOverview();
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

let activeFinishPanelId = null;

async function startUsingBatch(id){
  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('purchases').doc(id).update({
      usageStatus: '使用中',
      startDate: new Date().toISOString().slice(0,10),
      finishDate: '',
      reactions: [],
      feedbackNote: ''
    });
    setSyncStatus('已同步雲端', false);
    showToast('▶️ 已開始使用這罐');
  } catch(err){
    console.error('更新使用狀態失敗', err);
    setSyncStatus('雲端更新失敗', true);
    showToast('❌ 更新失敗，請確認網路連線', true);
  }
}

function openFinishPanel(id){
  activeFinishPanelId = (activeFinishPanelId === id) ? null : id;
  const b = purchases.find(p => p.id === id);
  selectedSatisfaction = (b && b.satisfaction) || null;
  renderInventoryOverview();
}

function closeFinishPanel(){
  activeFinishPanelId = null;
  renderInventoryOverview();
}

function renderSatisfactionChips(){
  const row = document.getElementById('finishReactionChips');
  if(!row) return;
  row.innerHTML = '';
  satisfactionLevels.forEach(lv=>{
    const el = document.createElement('div');
    el.className = 'chip';
    el.textContent = lv.label;
    if(selectedSatisfaction === lv.value){
      el.style.background = lv.color;
      el.style.borderColor = lv.color;
      el.style.color = '#fff';
    }
    el.onclick = ()=>{
      selectedSatisfaction = lv.value;
      renderSatisfactionChips();
    };
    row.appendChild(el);
  });
}

async function confirmFinishBatch(id){
  const note = document.getElementById('finishNoteInput').value.trim();
  const finishDate = document.getElementById('finishDateInput').value || new Date().toISOString().slice(0,10);
  const existing = purchases.find(p => p.id === id);

  if(!selectedSatisfaction){
    alert('請選擇一個滿意度評分');
    return;
  }

  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('purchases').doc(id).update({
      usageStatus: '已用完',
      startDate: (existing && existing.startDate) || finishDate,
      finishDate,
      satisfaction: selectedSatisfaction,
      feedbackNote: note
    });
    activeFinishPanelId = null;
    setSyncStatus('已同步雲端', false);
    showToast('✅ 已記錄回饋，這罐用完了');
  } catch(err){
    console.error('標記用完失敗', err);
    setSyncStatus('雲端更新失敗', true);
    showToast('❌ 儲存失敗，請確認網路連線', true);
  }
}

function renderFinishPanel(b){
  const today = new Date().toISOString().slice(0,10);
  const dateVal = b.finishDate || today;
  const noteVal = escapeHtml(b.feedbackNote || '');
  const isEditingFeedback = b.usageStatus === '已用完';
  setTimeout(renderSatisfactionChips, 0);
  return `
    <div class="use-panel">
      <div class="form-grid">
        <div class="field">
          <label>用完日期</label>
          <input type="date" id="finishDateInput" value="${dateVal}">
        </div>
        <div class="chip-select">
          <label>整體滿意度（單選）</label>
          <div class="chip-row" id="finishReactionChips"></div>
        </div>
        <div class="field" style="grid-column:1/-1;">
          <label>心得備註（選填）</label>
          <input type="text" id="finishNoteInput" placeholder="這罐吃下來的整體感受" value="${noteVal}">
        </div>
      </div>
      <div class="actions">
        <button class="page-btn" onclick="closeFinishPanel()">取消</button>
        <button class="submit" onclick="confirmFinishBatch('${b.id}')">✅ ${isEditingFeedback ? '更新心得' : '確認用完並回報'}</button>
      </div>
    </div>
  `;
}

async function revertToInUse(id){
  if(!confirm('確定要刪除這筆使用心得嗎？這罐會退回「使用中」狀態，需要重新填寫心得。')) return;
  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('purchases').doc(id).update({
      usageStatus: '使用中',
      finishDate: '',
      satisfaction: 0,
      feedbackNote: ''
    });
    setSyncStatus('已同步雲端', false);
    showToast('🗑️ 已刪除心得，這罐退回使用中');
  } catch(err){
    console.error('刪除心得失敗', err);
    setSyncStatus('雲端更新失敗', true);
    showToast('❌ 刪除失敗，請確認網路連線', true);
  }
}

function renderActiveBatchRow(b){
  const exp = expiryStatus(b.expiryMonth);
  const statusCls = b.usageStatus === '使用中' ? 'status-inuse' : 'status-unopened';
  const isFinishOpen = activeFinishPanelId === b.id;
  return `
    <div class="list-row">
      <div class="lr-main">
        <div class="lr-title">${b.brand} <span class="lr-brand">・ ${b.spec || '—'}</span>
          <span class="status-badge ${statusCls}">${b.usageStatus}</span>
          ${exp.label ? ` <span class="expiry-badge ${exp.cls}">${exp.label}</span>` : ''}
        </div>
        <div class="lr-sub">購買 ${b.date} ・ ${b.containerQty} 罐 × ${b.unitsPerContainer} 顆${b.buyer ? ' ・ 🧑 ' + b.buyer : ''}</div>
        <div class="lr-sub">效期：${b.expiryMonth || '未設定'}</div>
      </div>
      <div>
        ${b.usageStatus === '未開封' ? `<button class="page-btn" onclick="startUsingBatch('${b.id}')">開始使用</button>` : ''}
        ${b.usageStatus === '使用中' ? `<button class="page-btn" onclick="openFinishPanel('${b.id}')">${isFinishOpen ? '收起' : '用完了，填寫心得'}</button>` : ''}
      </div>
    </div>
    ${isFinishOpen ? renderFinishPanel(b) : ''}
  `;
}

function renderFinishedBatchRow(b){
  const lv = satisfactionLabel(b.satisfaction);
  let feedbackHtml;
  if(lv){
    feedbackHtml = `<span class="badge" style="background:${lv.color};">${lv.label}</span>`;
  } else if((b.reactions||[]).length > 0){
    const legacyBadges = b.reactions.map(r=>{
      const opt = reactionOptions.find(o=>o.key===r);
      const cls = opt ? badgeClass(opt.type.replace('neutral-grey','grey')) : 'b-grey';
      return `<span class="badge ${cls}">${r}</span>`;
    }).join('');
    feedbackHtml = `${legacyBadges}<div style="font-size:11px; color:var(--ink-soft); margin-top:4px;">（舊版標籤，僅供參考，點「編輯心得」可改用新的滿意度評分）</div>`;
  } else {
    feedbackHtml = '<span style="color:var(--ink-soft); font-size:12px;">尚未評分</span>';
  }
  const isFinishOpen = activeFinishPanelId === b.id;
  return `
    <div class="list-row">
      <div class="lr-main">
        <div class="lr-title">${b.brand} <span class="lr-brand">・ ${b.spec || '—'}</span></div>
        <div class="lr-sub">${b.date} → 用完於 ${b.finishDate || '—'} ・ ${b.containerQty} 罐</div>
        <div class="lr-sub">${feedbackHtml}</div>
        ${b.feedbackNote ? `<div class="lr-sub">${b.feedbackNote}</div>` : ''}
      </div>
      <button class="del-btn" onclick="openFinishPanel('${b.id}')">${isFinishOpen ? '收起' : '編輯心得'}</button>
      <button class="del-btn" onclick="revertToInUse('${b.id}')">刪除心得</button>
    </div>
    ${isFinishOpen ? renderFinishPanel(b) : ''}
  `;
}

function renderDetailPanel(g){
  const finishedRows = g.finishedBatches.map(renderFinishedBatchRow).join('');
  return `
    <div class="stock-detail">
      <h3>使用歷史與心得</h3>
      ${finishedRows || '<div class="empty">還沒有用完的批次</div>'}
    </div>
  `;
}

function renderInventoryOverview(){
  const wrap = document.getElementById('stockWrap');
  const pageWrap = document.getElementById('stockPagination');
  const expiryStatsEl = document.getElementById('stockExpiryStats');
  if(!wrap) return;

  const itemListEl = document.getElementById('stockItemList');
  if(itemListEl) itemListEl.innerHTML = renderItemChips();

  const allGroups = buildInventoryGroups();

  // 效期統計永遠以全部庫存為基準計算，不受目前的搜尋／地點篩選影響
  if(expiryStatsEl){
    const soonCount = allGroups.filter(g => expiryStatus(g.nearestExpiry).cls === 'soon').length;
    const expiredCount = allGroups.filter(g => expiryStatus(g.nearestExpiry).cls === 'expired').length;
    expiryStatsEl.innerHTML = `
      <div class="stat stat-clickable ${stockExpiryFilter==='all' ? 'stat-active' : ''}" onclick="setStockExpiryFilter('all')">
        <div class="num">${allGroups.length}</div><div class="label">全部品項</div>
      </div>
      <div class="stat stat-clickable ${stockExpiryFilter==='soon' ? 'stat-active' : ''}" onclick="setStockExpiryFilter('soon')">
        <div class="num" style="color:var(--amber);">${soonCount}</div><div class="label">⚠️ 即期</div>
      </div>
      <div class="stat stat-clickable ${stockExpiryFilter==='expired' ? 'stat-active' : ''}" onclick="setStockExpiryFilter('expired')">
        <div class="num" style="color:var(--red);">${expiredCount}</div><div class="label">🔴 已過期</div>
      </div>
    `;
  }

  let groups = allGroups;

  if(stockSearchTerm){
    groups = groups.filter(g => g.itemName.includes(stockSearchTerm));
  }
  if(stockLocationFilter !== '全部'){
    groups = groups.filter(g => g.location === stockLocationFilter);
  }
  if(stockExpiryFilter !== 'all'){
    groups = groups.filter(g => expiryStatus(g.nearestExpiry).cls === stockExpiryFilter);
  }

  if(groups.length === 0){
    wrap.innerHTML = '<div class="card"><div class="empty">沒有符合條件的庫存資料。</div></div>';
    pageWrap.innerHTML = '';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(groups.length / STOCK_PAGE_SIZE));
  if(stockPage > totalPages) stockPage = totalPages;
  if(stockPage < 1) stockPage = 1;
  const startIdx = (stockPage - 1) * STOCK_PAGE_SIZE;
  const pageGroups = groups.slice(startIdx, startIdx + STOCK_PAGE_SIZE);

  wrap.innerHTML = pageGroups.map(g=>{
    const remainColor = g.remainContainers <= 0 ? 'var(--red)' : (g.remainContainers <= 1 ? 'var(--amber)' : 'var(--teal)');
    const exp = expiryStatus(g.nearestExpiry);
    const isDetailOpen = openDetailKeys.has(g.key);
    const activeRows = g.activeBatches.map(renderActiveBatchRow).join('') || '<div class="empty">這個品項目前沒有未用完的批次。</div>';
    return `
      <div class="card item-card">
        <div class="stock-card-head">
          <div>
            <div class="stock-card-title">${g.itemName} <span class="loc-tag">📍 ${g.location}</span></div>
            <div class="lr-sub">${g.nearestExpiry ? '最近效期：' + g.nearestExpiry : '未設定效期'}${g.buyer ? ' ・ 最近採購人：🧑 ' + g.buyer : ''}</div>
          </div>
          ${exp.label ? `<span class="expiry-badge ${exp.cls}">${exp.label}</span>` : ''}
        </div>
        <div class="stats">
          <div class="stat"><div class="num">${g.totalContainers}</div><div class="label">累計購買罐數</div></div>
          <div class="stat"><div class="num" style="color:${remainColor}">${g.remainContainers}</div><div class="label">剩餘罐數（未開封＋使用中）</div></div>
          <div class="stat"><div class="num">${g.finishedContainers}</div><div class="label">已用完罐數</div></div>
        </div>
        ${activeRows}
        <div class="actions" style="justify-content:flex-start; gap:10px; margin-top:10px;">
          <button class="page-btn" onclick="toggleDetail('${g.key}')">${isDetailOpen ? '收起使用歷史' : '📋 使用歷史與心得'}</button>
        </div>
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
function setCompareLocationFilter(loc){
  compareLocationFilter = loc;
  document.querySelectorAll('.loc-filter-btn').forEach(btn=>{
    if(btn.id.startsWith('compareLocBtn-')){
      btn.classList.toggle('active-filter', btn.id === 'compareLocBtn-' + loc);
    }
  });
  renderCompare();
}

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

  const itemListEl = document.getElementById('compareItemList');
  if(itemListEl) itemListEl.innerHTML = renderItemChips('filterCompareByItem');

  const itemMap = {};
  const filteredPurchases = compareLocationFilter === '全部'
    ? purchases
    : purchases.filter(p => p.location === compareLocationFilter);

  filteredPurchases.forEach(p=>{
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
