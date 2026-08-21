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
let usePage = 1;
const PAGE_SIZE = 20;

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
      renderUseItemOptions();
      renderStock();
      setSyncStatus('已同步雲端', false);
    }, err => {
      console.error('讀取購買紀錄失敗', err);
      setSyncStatus('雲端讀取失敗，請確認 Firebase 設定與規則', true);
    });

  db.collection('family').doc('shared').collection('usages')
    .onSnapshot(snap => {
      usages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderUsages();
      renderStock();
      setSyncStatus('已同步雲端', false);
    }, err => {
      console.error('讀取服用紀錄失敗', err);
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

// ---- reaction chips ----
function renderChips(){
  const row = document.getElementById('reactionChips');
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
      renderChips();
    };
    row.appendChild(el);
  });
}
renderChips();

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

  if(!date || !itemName || !brand || unitsPerContainer <= 0 || containerQty <= 0){
    alert('請至少填寫日期、品項、品牌、每瓶顆數與購買數量');
    return;
  }

  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('purchases').add({
      date, itemName, brand, spec, unitsPerContainer, containerQty, totalPrice,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('buy-item').value = '';
    document.getElementById('buy-brand').value = '';
    document.getElementById('buy-spec').value = '';
    document.getElementById('buy-units').value = '';
    document.getElementById('buy-qty').value = 1;
    document.getElementById('buy-total').value = '';
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
      const units = Number(p.unitsPerContainer) || 0;
      const qty = Number(p.containerQty) || 0;
      const total = Number(p.totalPrice) || 0;
      const pieces = units * qty;
      const costPerPiece = pieces > 0 ? total / pieces : 0;
      return `
        <div class="list-row">
          <div class="lr-main">
            <div class="lr-title">${p.itemName} <span class="lr-brand">・ ${p.brand}</span></div>
            <div class="lr-sub">${p.date}${p.spec ? ' ・ ' + p.spec : ''}</div>
            <div class="lr-sub">${qty} 瓶 × ${units} 顆／瓶</div>
          </div>
          <div class="lr-total">
            <div class="money">NT$ ${total.toLocaleString()}</div>
            <div class="lr-cost">${pieces>0 ? 'NT$ ' + costPerPiece.toFixed(2) + ' /顆' : ''}</div>
          </div>
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

function renderUseItemOptions(){
  const sel = document.getElementById('use-item');
  const prevValue = sel.value;
  if(purchases.length === 0){
    sel.innerHTML = '<option value="">請先於「購買紀錄」新增品項</option>';
    return;
  }
  const uniqueNames = [];
  const seen = new Set();
  purchases.slice().reverse().forEach(p=>{
    if(!seen.has(p.itemName)){ seen.add(p.itemName); uniqueNames.push(p.itemName); }
  });
  sel.innerHTML = uniqueNames.map(n=>`<option value="${n}">${n}</option>`).join('');
  if(uniqueNames.includes(prevValue)) sel.value = prevValue;
}

// ---- usage ----
async function addUsage(){
  const date = document.getElementById('use-date').value;
  const time = document.getElementById('use-time').value;
  const itemName = document.getElementById('use-item').value;
  const qty = parseFloat(document.getElementById('use-qty').value) || 1;
  const dose = document.getElementById('use-dose').value.trim();
  const note = document.getElementById('use-note').value.trim();

  if(!date || !itemName){
    alert('請至少填寫日期與品項');
    return;
  }

  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('usages').add({
      date, time, itemName, qty, dose, note,
      reactions: Array.from(selectedReactions),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    selectedReactions.clear();
    renderChips();
    document.getElementById('use-dose').value = '';
    document.getElementById('use-note').value = '';
    document.getElementById('use-qty').value = 1;
    setSyncStatus('已同步雲端', false);
  } catch(err){
    console.error('新增服用紀錄失敗', err);
    setSyncStatus('雲端寫入失敗，請確認網路與規則設定', true);
  }
}

async function deleteUsage(id){
  setSyncStatus('儲存中…', false);
  try {
    await db.collection('family').doc('shared').collection('usages').doc(id).delete();
    setSyncStatus('已同步雲端', false);
  } catch(err){
    console.error('刪除服用紀錄失敗', err);
    setSyncStatus('雲端刪除失敗', true);
  }
}

function changeUsePage(delta){
  usePage += delta;
  renderUsages();
}

function renderUsages(){
  const listWrap = document.getElementById('useListWrap');
  const pageWrap = document.getElementById('usePagination');

  const sorted = usages.slice().sort((a,b)=> (b.date||'').localeCompare(a.date||'') || (b.time||'').localeCompare(a.time||''));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if(usePage > totalPages) usePage = totalPages;
  if(usePage < 1) usePage = 1;
  const startIdx = (usePage - 1) * PAGE_SIZE;
  const pageItems = sorted.slice(startIdx, startIdx + PAGE_SIZE);

  if(sorted.length === 0){
    listWrap.innerHTML = '<div class="empty">還沒有服用紀錄，於上方表單新增第一筆吧。</div>';
    pageWrap.innerHTML = '';
  } else {
    listWrap.innerHTML = pageItems.map(u=>{
      const badges = (u.reactions||[]).map(r=>{
        const opt = reactionOptions.find(o=>o.key===r);
        const cls = opt ? badgeClass(opt.type.replace('neutral-grey','grey')) : 'b-grey';
        return `<span class="badge ${cls}">${r}</span>`;
      }).join('') || '<span style="color:var(--ink-soft); font-size:12px;">未記錄</span>';
      return `
        <div class="list-row">
          <div class="lr-main">
            <div class="lr-title">${u.itemName}${u.time ? ' ・ ' + u.time : ''}</div>
            <div class="lr-sub">${u.date} ・ ${u.qty || 1} 顆${u.dose ? ' ・ ' + u.dose : ''}</div>
            <div class="lr-sub">${badges}</div>
            ${u.note ? `<div class="lr-sub">${u.note}</div>` : ''}
          </div>
          <button class="del-btn" onclick="deleteUsage('${u.id}')">刪除</button>
        </div>
      `;
    }).join('');

    pageWrap.innerHTML = `
      <button class="page-btn" onclick="changeUsePage(-1)" ${usePage<=1?'disabled':''}>‹ 上一頁</button>
      <span class="page-info">第 ${usePage}／${totalPages} 頁（共 ${sorted.length} 筆）</span>
      <button class="page-btn" onclick="changeUsePage(1)" ${usePage>=totalPages?'disabled':''}>下一頁 ›</button>
    `;
  }

  const total = usages.length;
  const badCount = usages.filter(u=>(u.reactions||[]).some(r=>reactionOptions.find(o=>o.key===r)?.type==='bad')).length;
  const goodCount = usages.filter(u=>(u.reactions||[]).some(r=>reactionOptions.find(o=>o.key===r)?.type==='good')).length;
  const badRate = total ? Math.round(badCount/total*100) : 0;

  document.getElementById('useStats').innerHTML = `
    <div class="stat"><div class="num">${total}</div><div class="label">服用筆數</div></div>
    <div class="stat"><div class="num">${badRate}%</div><div class="label">不適發生率</div></div>
    <div class="stat"><div class="num">${goodCount}</div><div class="label">正向反應次數</div></div>
  `;
}

// ---- 庫存／比價 ----
function renderStock(){
  const wrap = document.getElementById('stockWrap');
  if(!wrap) return;

  const itemMap = {};
  purchases.forEach(p=>{
    const units = Number(p.unitsPerContainer) || 0;
    const qty = Number(p.containerQty) || 0;
    const total = Number(p.totalPrice) || 0;
    const pieces = units * qty;
    const costPerPiece = pieces > 0 ? total / pieces : 0;
    if(!itemMap[p.itemName]) itemMap[p.itemName] = { batches: [], totalPieces: 0 };
    itemMap[p.itemName].batches.push({ ...p, pieces, costPerPiece });
    itemMap[p.itemName].totalPieces += pieces;
  });

  const usedQtyMap = {};
  usages.forEach(u=>{
    usedQtyMap[u.itemName] = (usedQtyMap[u.itemName] || 0) + (Number(u.qty) || 1);
  });

  const names = Object.keys(itemMap);
  if(names.length === 0){
    wrap.innerHTML = '<div class="card"><div class="empty">還沒有購買紀錄，無法計算庫存與比價。</div></div>';
    return;
  }

  wrap.innerHTML = names.sort((a,b)=>a.localeCompare(b,'zh-Hant')).map(name=>{
    const info = itemMap[name];
    const used = usedQtyMap[name] || 0;
    const remain = Math.round((info.totalPieces - used) * 10) / 10;
    const remainColor = remain <= 0 ? 'var(--red)' : (remain <= 10 ? 'var(--amber)' : 'var(--teal)');
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
      </tr>
    `).join('');

    return `
      <div class="card item-card">
        <h2><span class="dot"></span>${name}</h2>
        <div class="stats">
          <div class="stat"><div class="num">${Math.round(info.totalPieces)}</div><div class="label">累計購買顆數</div></div>
          <div class="stat"><div class="num">${used}</div><div class="label">已服用顆數</div></div>
          <div class="stat"><div class="num" style="color:${remainColor}">${remain}</div><div class="label">估算剩餘顆數</div></div>
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>日期</th><th>品牌</th><th>規格</th><th>數量</th><th>總價</th><th>每顆成本</th></tr></thead>
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
  document.getElementById('use-date').value = today;
  const now = new Date();
  document.getElementById('use-time').value = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
})();

updateBuyCalc();
