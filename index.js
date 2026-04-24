// ============================================================
// 🥟 包子同好會 SillyTavern 擴展
// ============================================================
// 作者：Tammy & Claude
// 功能：讓小圈子的朋友可以互相分享指令、對話和吐槽
//
// 💡 無需修改程式碼！首次打開擴展時會彈出設定視窗，
//    所有設定值會存在瀏覽器本地（localStorage）裡。
// ============================================================

const extensionName = “baozi-club”;
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// ––––– 設定值會從 localStorage 讀取 –––––
// 預設為 null，使用者需要在首次使用時填入
let FIREBASE_CONFIG = null;
let CLUB_SECRET = null;

/**

- 從瀏覽器的 localStorage 讀取設定
- 回傳 true 代表設定齊全，false 代表需要使用者填寫
  */
  function loadConfig() {
  try {
  const savedFirebase = localStorage.getItem(‘baozi_firebase_config’);
  const savedSecret = localStorage.getItem(‘baozi_club_secret’);
  
  ```
   if (savedFirebase && savedSecret) {
       FIREBASE_CONFIG = JSON.parse(savedFirebase);
       CLUB_SECRET = savedSecret;
       return true;
   }
   return false;
  ```
  
  } catch (err) {
  console.error(’[包子同好會] 讀取設定失敗’, err);
  return false;
  }
  }

/**

- 儲存設定到 localStorage
  */
  function saveConfig(firebaseConfig, clubSecret) {
  try {
  localStorage.setItem(‘baozi_firebase_config’, JSON.stringify(firebaseConfig));
  localStorage.setItem(‘baozi_club_secret’, clubSecret);
  FIREBASE_CONFIG = firebaseConfig;
  CLUB_SECRET = clubSecret;
  return true;
  } catch (err) {
  console.error(’[包子同好會] 儲存設定失敗’, err);
  return false;
  }
  }

// ============================================================
// 以下是程式邏輯，除非你想改功能，否則不用動～
// ============================================================

// 全域狀態（存在記憶體裡的資料）
const state = {
firebase: null,      // Firebase App 實例
db: null,            // Firestore 資料庫實例
auth: null,          // 驗證實例
user: null,          // 當前使用者
nickname: null,      // 當前使用者暱稱
isReady: false,      // 是否已登入成功
};

// ============================================================
// 🔥 Firebase 初始化與登入
// ============================================================

async function initFirebase() {
try {
// 從 CDN 載入 Firebase SDK（使用 ES 模組）
const { initializeApp } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js’);
const { getAuth, signInAnonymously } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js’);
const { getFirestore } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);

```
    // 初始化 Firebase
    state.firebase = initializeApp(FIREBASE_CONFIG);
    state.auth = getAuth(state.firebase);
    state.db = getFirestore(state.firebase);

    // 匿名登入
    const result = await signInAnonymously(state.auth);
    state.user = result.user;

    console.log('[包子同好會] Firebase 登入成功', state.user.uid);
    return true;
} catch (err) {
    console.error('[包子同好會] Firebase 初始化失敗', err);
    showError('連線失敗：' + err.message);
    return false;
}
```

}

// ============================================================
// 🔐 圈內驗證（用暗號確認身份）
// ============================================================

async function verifyClubMember(inputSecret, inputNickname) {
if (inputSecret !== CLUB_SECRET) {
return { ok: false, reason: ‘暗號不對喔～再試試！’ };
}

```
try {
    const { doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    // 把這個使用者記錄到 members 集合
    await setDoc(doc(state.db, 'members', state.user.uid), {
        nickname: inputNickname,
        joinedAt: serverTimestamp(),
        lastSeen: serverTimestamp(),
    }, { merge: true });

    state.nickname = inputNickname;
    state.isReady = true;

    // 把暱稱存到瀏覽器，下次不用再輸入
    localStorage.setItem('baozi_nickname', inputNickname);
    localStorage.setItem('baozi_verified', 'yes');

    updateExtStatus('✅ 已登入：' + inputNickname, 'ok');

    return { ok: true };
} catch (err) {
    console.error('[包子同好會] 驗證失敗', err);
    return { ok: false, reason: '連線出錯：' + err.message };
}
```

}

// ============================================================
// 📚 我的指令庫：新增、讀取、刪除
// ============================================================

async function addMyCommand(title, content, tags = []) {
const { collection, addDoc, serverTimestamp } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);

```
const docRef = await addDoc(collection(state.db, 'commands'), {
    title,
    content,
    tags,
    ownerId: state.user.uid,
    ownerNickname: state.nickname,
    shared: false,         // 預設不分享
    createdAt: serverTimestamp(),
    likes: 0,
});

return docRef.id;
```

}

async function getMyCommands() {
// 只用 where 不用 orderBy，避免需要複合索引
// 拿回來之後在前端排序
const { collection, query, where, getDocs } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);

```
const q = query(
    collection(state.db, 'commands'),
    where('ownerId', '==', state.user.uid)
);

const snapshot = await getDocs(q);
const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
// 前端按照 createdAt 反向排序（新的在上）
items.sort((a, b) => {
    const ta = a.createdAt?.seconds || 0;
    const tb = b.createdAt?.seconds || 0;
    return tb - ta;
});
return items;
```

}

async function deleteCommand(id) {
const { doc, deleteDoc } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);
await deleteDoc(doc(state.db, ‘commands’, id));
}

async function shareCommand(id) {
const { doc, updateDoc } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);
await updateDoc(doc(state.db, ‘commands’, id), { shared: true });
}

// ============================================================
// 🏠 共享空間：看大家分享的指令
// ============================================================

async function getSharedCommands() {
const { collection, query, where, getDocs } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);

```
const q = query(
    collection(state.db, 'commands'),
    where('shared', '==', true)
);

const snapshot = await getDocs(q);
const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
items.sort((a, b) => {
    const ta = a.createdAt?.seconds || 0;
    const tb = b.createdAt?.seconds || 0;
    return tb - ta;
});
return items;
```

}

async function favoriteCommand(original) {
// 把別人的指令複製一份到自己的庫
return await addMyCommand(
original.title + ’ (收藏自 ’ + original.ownerNickname + ‘)’,
original.content,
original.tags || []
);
}

// ============================================================
// 💬 分享對話
// ============================================================

async function shareChatSnippet(title, preface, content, maskedRanges = []) {
const { collection, addDoc, serverTimestamp } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);

```
const docRef = await addDoc(collection(state.db, 'chats'), {
    title,
    preface,               // 分享時的前言（例如「你看這段！」）
    content,               // 對話原文
    maskedRanges,          // 打碼的位置 [{start, end}, ...]
    ownerId: state.user.uid,
    ownerNickname: state.nickname,
    createdAt: serverTimestamp(),
});

return docRef.id;
```

}

async function updateChatSnippet(id, title, preface, content, maskedRanges = []) {
const { doc, updateDoc } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);
await updateDoc(doc(state.db, ‘chats’, id), {
title,
preface,
content,
maskedRanges,
});
}

async function deleteChatSnippet(id) {
const { doc, deleteDoc } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);
await deleteDoc(doc(state.db, ‘chats’, id));
}

async function getSharedChats() {
const { collection, query, orderBy, getDocs } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);

```
const q = query(
    collection(state.db, 'chats'),
    orderBy('createdAt', 'desc')
);

const snapshot = await getDocs(q);
return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
```

}

// ============================================================
// 💭 吐槽留言
// ============================================================

async function addComment(targetType, targetId, text) {
// targetType: ‘command’ 或 ‘chat’
const { collection, addDoc, serverTimestamp } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);

```
await addDoc(collection(state.db, 'comments'), {
    targetType,
    targetId,
    text,
    authorId: state.user.uid,
    authorNickname: state.nickname,
    createdAt: serverTimestamp(),
});
```

}

async function getComments(targetType, targetId) {
const { collection, query, where, getDocs } = await import(‘https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js’);

```
// 用兩個 where 條件（不搭配 orderBy 就不需要索引）
const q = query(
    collection(state.db, 'comments'),
    where('targetType', '==', targetType),
    where('targetId', '==', targetId)
);

const snapshot = await getDocs(q);
const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
// 前端按時間正序排（舊的在上）
items.sort((a, b) => {
    const ta = a.createdAt?.seconds || 0;
    const tb = b.createdAt?.seconds || 0;
    return ta - tb;
});
return items;
```

}

// ============================================================
// 🎨 UI：建立主面板
// ============================================================
// 新版：整合到 SillyTavern 的擴展選單 + 保留浮動按鈕
// 手機使用者可以從擴展選單打開，電腦使用者用浮動按鈕都可以
// ============================================================

function buildUI() {
// 1. 嘗試把設定區塊插入 SillyTavern 擴展選單
insertExtensionSettings();

```
// 2. 建立浮動按鈕（右下角，可拖曳）
const floatBtn = document.createElement('div');
floatBtn.id = 'baozi-float-btn';
floatBtn.innerHTML = '🥟';
floatBtn.title = '包子同好會（長按可拖曳）';

// 如果使用者之前選了隱藏，就不顯示
if (localStorage.getItem('baozi_float_hidden') === 'yes') {
    floatBtn.style.display = 'none';
}

document.body.appendChild(floatBtn);

// 恢復之前儲存的位置
restoreFloatBtnPosition(floatBtn);

// 讓按鈕可拖曳（同時保留點擊功能）
makeDraggable(floatBtn, {
    onClick: openPanel,
    saveKey: 'baozi_float_btn_pos',
});

// 3. 建立背景遮罩（點擊可關閉）
const overlay = document.createElement('div');
overlay.id = 'baozi-overlay';
document.body.appendChild(overlay);

// 4. 建立主面板（預設隱藏，標題列可拖曳）
const panel = document.createElement('div');
panel.id = 'baozi-panel';
panel.innerHTML = `
    <div class="baozi-header" id="baozi-panel-header">
        <span class="baozi-logo">🥟 包子同好會</span>
        <span class="baozi-drag-hint">⋮⋮</span>
        <span class="baozi-close" id="baozi-close">✕</span>
    </div>
    <div class="baozi-body" id="baozi-body">
        <div class="baozi-loading">正在蒸包子...</div>
    </div>
`;
document.body.appendChild(panel);

// 恢復之前儲存的面板位置（只在桌面版，手機版每次都置中）
restorePanelPosition(panel);

// 讓面板可以透過標題列拖曳
makePanelDraggable(panel);

// 事件綁定
panel.querySelector('#baozi-close').addEventListener('click', closePanel);
overlay.addEventListener('click', closePanel);
```

}

/**

- 讓元素可拖曳，同時支援點擊（透過移動距離判斷）
- 支援滑鼠和觸控，適用於電腦、Android、iOS
  */
  function makeDraggable(el, { onClick, saveKey } = {}) {
  let startX, startY, elStartX, elStartY;
  let dragging = false;
  let moved = false;
  
  const onDown = (e) => {
  // 取得觸控或滑鼠的座標
  const point = e.touches ? e.touches[0] : e;
  startX = point.clientX;
  startY = point.clientY;
  
  ```
   const rect = el.getBoundingClientRect();
   elStartX = rect.left;
   elStartY = rect.top;
  
   dragging = true;
   moved = false;
   el.classList.add('baozi-dragging');
  
   // 防止觸控時頁面滾動
   if (e.touches) e.preventDefault();
  ```
  
  };
  
  const onMove = (e) => {
  if (!dragging) return;
  const point = e.touches ? e.touches[0] : e;
  const dx = point.clientX - startX;
  const dy = point.clientY - startY;
  
  ```
   // 超過 5px 才算拖曳（避免一般點擊被誤判）
   if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
  
   if (moved) {
       let newX = elStartX + dx;
       let newY = elStartY + dy;
  
       // 限制不要拖出螢幕
       const maxX = window.innerWidth - el.offsetWidth;
       const maxY = window.innerHeight - el.offsetHeight;
       newX = Math.max(0, Math.min(newX, maxX));
       newY = Math.max(0, Math.min(newY, maxY));
  
       el.style.left = newX + 'px';
       el.style.top = newY + 'px';
       el.style.right = 'auto';
       el.style.bottom = 'auto';
  
       if (e.touches) e.preventDefault();
   }
  ```
  
  };
  
  const onUp = () => {
  if (!dragging) return;
  dragging = false;
  el.classList.remove(‘baozi-dragging’);
  
  ```
   if (!moved && onClick) {
       onClick();
   } else if (moved && saveKey) {
       // 儲存位置
       try {
           localStorage.setItem(saveKey, JSON.stringify({
               left: el.style.left,
               top: el.style.top,
           }));
       } catch {}
   }
  ```
  
  };
  
  // 滑鼠事件
  el.addEventListener(‘mousedown’, onDown);
  document.addEventListener(‘mousemove’, onMove);
  document.addEventListener(‘mouseup’, onUp);
  // 觸控事件（手機）
  el.addEventListener(‘touchstart’, onDown, { passive: false });
  document.addEventListener(‘touchmove’, onMove, { passive: false });
  document.addEventListener(‘touchend’, onUp);
  }

/**

- 讓主面板可以透過標題列拖曳（所有裝置都支援）
  */
  function makePanelDraggable(panel) {
  const header = panel.querySelector(’#baozi-panel-header’);
  if (!header) return;
  
  let startX, startY, panelStartX, panelStartY;
  let dragging = false;
  let moved = false;
  
  const onDown = (e) => {
  // 避免點到關閉按鈕時觸發
  if (e.target.id === ‘baozi-close’ || e.target.closest(’#baozi-close’)) return;
  
  ```
   const point = e.touches ? e.touches[0] : e;
   startX = point.clientX;
   startY = point.clientY;
  
   const rect = panel.getBoundingClientRect();
   panelStartX = rect.left;
   panelStartY = rect.top;
  
   dragging = true;
   moved = false;
   header.style.cursor = 'grabbing';
  
   // 拖曳時切換成固定位置模式（取消 transform 置中）
   panel.classList.add('baozi-dragging');
  ```
  
  };
  
  const onMove = (e) => {
  if (!dragging) return;
  const point = e.touches ? e.touches[0] : e;
  const dx = point.clientX - startX;
  const dy = point.clientY - startY;
  
  ```
   // 超過 5px 才算拖曳
   if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
   if (!moved) return;
  
   let newX = panelStartX + dx;
   let newY = panelStartY + dy;
  
   const maxX = window.innerWidth - panel.offsetWidth;
   const maxY = window.innerHeight - panel.offsetHeight;
   newX = Math.max(0, Math.min(newX, maxX));
   newY = Math.max(0, Math.min(newY, maxY));
  
   panel.style.left = newX + 'px';
   panel.style.top = newY + 'px';
   panel.style.right = 'auto';
   panel.style.bottom = 'auto';
   panel.style.transform = 'none';
  
   if (e.touches) e.preventDefault();
  ```
  
  };
  
  const onUp = () => {
  if (!dragging) return;
  dragging = false;
  header.style.cursor = ‘grab’;
  
  ```
   if (moved) {
       // 拖曳後儲存位置（只在桌面版儲存，手機版每次打開還是置中）
       if (!isMobileScreen()) {
           try {
               localStorage.setItem('baozi_panel_pos', JSON.stringify({
                   left: panel.style.left,
                   top: panel.style.top,
               }));
           } catch {}
       }
   }
  ```
  
  };
  
  header.style.cursor = ‘grab’;
  header.addEventListener(‘mousedown’, onDown);
  document.addEventListener(‘mousemove’, onMove);
  document.addEventListener(‘mouseup’, onUp);
  header.addEventListener(‘touchstart’, onDown, { passive: true });
  document.addEventListener(‘touchmove’, onMove, { passive: false });
  document.addEventListener(‘touchend’, onUp);
  }

function restoreFloatBtnPosition(el) {
try {
const saved = localStorage.getItem(‘baozi_float_btn_pos’);
if (!saved) return;
const pos = JSON.parse(saved);
if (pos.left && pos.top) {
el.style.left = pos.left;
el.style.top = pos.top;
el.style.right = ‘auto’;
el.style.bottom = ‘auto’;
}
} catch {}
}

function restorePanelPosition(panel) {
// 手機版不恢復（每次置中）
if (isMobileScreen()) return;
try {
const saved = localStorage.getItem(‘baozi_panel_pos’);
if (!saved) return;
const pos = JSON.parse(saved);
if (pos.left && pos.top) {
panel.style.left = pos.left;
panel.style.top = pos.top;
panel.style.right = ‘auto’;
panel.style.bottom = ‘auto’;
}
} catch {}
}

function isMobileScreen() {
return window.innerWidth <= 700;
}

/**

- 把設定區塊插入 SillyTavern 的擴展設定面板
- 這樣使用者可以從擴展選單找到包子同好會，特別對手機使用者有幫助
  */
  let insertRetryCount = 0;
  const MAX_INSERT_RETRY = 30;  // 最多重試 30 次（= 30 秒）

function insertExtensionSettings() {
try {
// 嘗試多個可能的容器（不同版本 ST 結構略有差異）
const container = document.getElementById(‘extensions_settings2’)
|| document.getElementById(‘extensions_settings’)
|| document.querySelector(’#translation_container’)?.parentElement
|| document.querySelector(’.extensions_block’)
|| document.querySelector(’[id*=“extensions_settings”]’);

```
    if (!container) {
        insertRetryCount++;
        if (insertRetryCount < MAX_INSERT_RETRY) {
            console.warn(`[包子同好會] 找不到擴展設定區，稍後重試 (${insertRetryCount}/${MAX_INSERT_RETRY})`);
            setTimeout(insertExtensionSettings, 1000);
        } else {
            console.error('[包子同好會] 放棄重試。SillyTavern 的 DOM 結構可能不同');
        }
        return;
    }

    // 避免重複插入
    if (document.getElementById('baozi-extension-settings')) {
        console.log('[包子同好會] 擴展設定區已存在，不重複插入');
        return;
    }

    const settingsBlock = document.createElement('div');
    settingsBlock.id = 'baozi-extension-settings';

    // 讀取浮動按鈕的顯示設定
    const floatHidden = localStorage.getItem('baozi_float_hidden') === 'yes';
    // 立刻套用
    const existingFloat = document.getElementById('baozi-float-btn');
    if (existingFloat && floatHidden) existingFloat.style.display = 'none';

    settingsBlock.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🥟 包子同好會</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="baozi-ext-settings">
                    <div id="baozi-ext-status" class="baozi-ext-status">⏳ 連線中...</div>
                    <button id="baozi-open-main" class="menu_button baozi-ext-btn">
                        🥟 打開包子同好會
                    </button>
                    <label class="baozi-ext-toggle">
                        <input type="checkbox" id="baozi-toggle-float" ${floatHidden ? 'checked' : ''}>
                        <span>隱藏右下角浮動包子按鈕</span>
                    </label>
                    <div class="baozi-ext-info">
                        <small>
                            💡 隱藏浮動按鈕後，可以用上面的按鈕打開面板
                        </small>
                    </div>
                </div>
            </div>
        </div>
    `;
    container.appendChild(settingsBlock);

    // 綁定按鈕（用 optional chaining 避免找不到元素時整個崩掉）
    document.getElementById('baozi-open-main')?.addEventListener('click', openPanel);

    // 綁定浮動按鈕顯示/隱藏開關
    document.getElementById('baozi-toggle-float')?.addEventListener('change', (e) => {
        const hide = e.target.checked;
        const btn = document.getElementById('baozi-float-btn');
        if (btn) btn.style.display = hide ? 'none' : '';
        localStorage.setItem('baozi_float_hidden', hide ? 'yes' : 'no');
    });

    console.log('[包子同好會] 擴展設定區已成功插入 ✅');
} catch (err) {
    console.error('[包子同好會] 插入擴展設定區時發生錯誤：', err);
    // 即使出錯也重試，可能是暫時性問題
    insertRetryCount++;
    if (insertRetryCount < MAX_INSERT_RETRY) {
        setTimeout(insertExtensionSettings, 1000);
    }
}
```

}

/** 更新擴展區塊的狀態顯示 */
function updateExtStatus(text, type = ‘info’) {
const el = document.getElementById(‘baozi-ext-status’);
if (!el) return;
el.textContent = text;
el.className = ‘baozi-ext-status baozi-ext-status-’ + type;
}

/** 打開主面板 */
function openPanel() {
const panel = document.getElementById(‘baozi-panel’);
const overlay = document.getElementById(‘baozi-overlay’);
if (!panel) return;

```
// 先顯示面板（要先加 class 才能計算尺寸）
panel.classList.remove('baozi-dragging');
panel.classList.add('baozi-open');
if (overlay) overlay.classList.add('baozi-open');

// 手機版 + 非拖曳狀態：用 JS 精確計算置中
if (isMobileScreen()) {
    centerPanel(panel);
}

// 關閉 SillyTavern 的擴展選單抽屜
const drawer = document.getElementById('rightNavDrawer');
if (drawer && drawer.classList.contains('openDrawer')) {
    drawer.classList.remove('openDrawer');
    drawer.classList.add('closedDrawer');
}

renderMainContent();
```

}

/**

- 用 JS 精確計算面板置中位置（不依賴 CSS transform，iPhone 最穩定的做法）
  */
  function centerPanel(panel) {
  // 先清除所有內聯定位
  panel.style.left = ‘’;
  panel.style.top = ‘’;
  panel.style.right = ‘’;
  panel.style.bottom = ‘’;
  panel.style.transform = ‘none’;
  
  // 取得視窗可用高度（考慮 iPhone Safari 工具列）
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const panelW = panel.offsetWidth;
  const panelH = panel.offsetHeight;
  
  // 計算置中位置
  const x = Math.max(0, (vw - panelW) / 2);
  const y = Math.max(10, (vh - panelH) / 2);
  
  panel.style.left = x + ‘px’;
  panel.style.top = y + ‘px’;
  panel.style.right = ‘auto’;
  panel.style.bottom = ‘auto’;
  }

/** 關閉主面板 */
function closePanel() {
const panel = document.getElementById(‘baozi-panel’);
const overlay = document.getElementById(‘baozi-overlay’);
if (panel) panel.classList.remove(‘baozi-open’);
if (overlay) overlay.classList.remove(‘baozi-open’);
}

// ============================================================
// 🎨 渲染主要內容（根據是否已驗證顯示不同畫面）
// ============================================================

async function renderMainContent() {
const body = document.getElementById(‘baozi-body’);

```
// 如果還沒設定 Firebase → 顯示設定畫面
if (!FIREBASE_CONFIG || !CLUB_SECRET) {
    renderSetupScreen(body);
    return;
}

// 如果還沒連上 Firebase → 提示連線中
if (!state.db) {
    body.innerHTML = '<div class="baozi-loading">🥟 正在連線 Firebase...</div>';
    const ok = await initFirebase();
    if (!ok) {
        body.innerHTML = '<div class="baozi-error">連線失敗，請檢查設定是否正確。<br><br><button class="baozi-btn-primary" id="baozi-reset-config">重新設定</button></div>';
        document.getElementById('baozi-reset-config')?.addEventListener('click', () => {
            if (confirm('確定要清除設定重新填寫嗎？')) {
                localStorage.removeItem('baozi_firebase_config');
                localStorage.removeItem('baozi_club_secret');
                FIREBASE_CONFIG = null;
                CLUB_SECRET = null;
                renderSetupScreen(body);
            }
        });
        return;
    }
}

if (!state.isReady) {
    renderLoginScreen(body);
} else {
    renderHomeScreen(body);
}
```

}

/**

- 首次設定畫面：讓使用者填入 Firebase 設定和圈內暗號
  */
  function renderSetupScreen(container) {
  container.innerHTML = `
  <div class="baozi-setup">
  <div class="baozi-welcome">
  <div class="baozi-big-emoji">🥟</div>
  <h2>歡迎～來設定一下！</h2>
  <p>第一次使用要填一些設定～放心，只要填一次，之後都不用再管！</p>
  </div>
  <div class="baozi-form">
  <div class="baozi-setup-section">
  <div class="baozi-setup-section-title">1️⃣ Firebase 設定值</div>
  <div class="baozi-setup-hint">從朋友那邊拿到的一串 JSON，整段貼進來就好～</div>
  <textarea id="baozi-firebase-input" rows="8" placeholder='貼上 firebaseConfig 整段，例如：&#10;&#10;{&#10;  "apiKey": "AIza...",&#10;  "authDomain": "...",&#10;  "projectId": "...",&#10;  ...&#10;}'></textarea>
  </div>
  
  ```
           <div class="baozi-setup-section">
               <div class="baozi-setup-section-title">2️⃣ 圈內暗號</div>
               <div class="baozi-setup-hint">朋友告訴你的那個秘密暗號</div>
               <input type="password" id="baozi-setup-secret" placeholder="輸入暗號...">
           </div>
  
           <button class="baozi-btn-primary baozi-btn-full" id="baozi-save-setup">💾 儲存設定並開始使用</button>
           <div class="baozi-error" id="baozi-setup-error"></div>
       </div>
   </div>
  ```
  
  `;
  
  document.getElementById(‘baozi-save-setup’).addEventListener(‘click’, async () => {
  const firebaseInput = document.getElementById(‘baozi-firebase-input’).value.trim();
  const secret = document.getElementById(‘baozi-setup-secret’).value.trim();
  const errBox = document.getElementById(‘baozi-setup-error’);
  
  ```
   if (!firebaseInput || !secret) {
       errBox.textContent = '兩個欄位都要填喔～';
       return;
   }
  
   // 解析 Firebase 設定
   let config;
   try {
       // 支援三種格式：
       // 1. 純 JSON：{ "apiKey": "...", ... }
       // 2. JavaScript 物件：{ apiKey: "...", ... }
       // 3. 整段 const firebaseConfig = { ... }
       let cleanInput = firebaseInput;
  
       // 如果包含 const / var / let 宣告，抽取物件部分
       const match = cleanInput.match(/\{[\s\S]*\}/);
       if (match) {
           cleanInput = match[0];
       }
  
       // 嘗試轉成 JSON 格式（把 key: 變成 "key":）
       const jsonStr = cleanInput
           .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')  // key 加引號
           .replace(/'/g, '"')                          // 單引號換雙引號
           .replace(/,(\s*[}\]])/g, '$1');              // 移除尾逗號
  
       config = JSON.parse(jsonStr);
  
       // 簡單驗證：至少要有 apiKey 和 projectId
       if (!config.apiKey || !config.projectId) {
           throw new Error('設定值不完整');
       }
   } catch (err) {
       errBox.textContent = '❌ Firebase 設定格式有問題～再檢查一下？（錯誤：' + err.message + '）';
       return;
   }
  
   // 儲存設定
   if (!saveConfig(config, secret)) {
       errBox.textContent = '❌ 儲存失敗，請檢查瀏覽器是否允許儲存資料';
       return;
   }
  
   // 重新載入主面板
   errBox.textContent = '';
   updateExtStatus('⏳ 連線中...');
   container.innerHTML = '<div class="baozi-loading">🥟 正在連線...</div>';
  
   const ok = await initFirebase();
   if (ok) {
       updateExtStatus('✨ 已連線，請登入', 'ok');
       renderLoginScreen(container);
   } else {
       errBox.textContent = '連線失敗，請檢查設定';
       renderSetupScreen(container);
   }
  ```
  
  });
  }

function renderLoginScreen(container) {
container.innerHTML = `<div class="baozi-login"> <div class="baozi-welcome"> <div class="baozi-big-emoji">🥟</div> <h2>歡迎來到包子同好會～</h2> <p>請輸入圈內暗號才能進來喔</p> </div> <div class="baozi-form"> <label>你的暱稱</label> <input type="text" id="baozi-nickname-input" placeholder="例如：包子" value="${localStorage.getItem('baozi_nickname') || ''}"> <label>圈內暗號</label> <input type="password" id="baozi-secret-input" placeholder="只有圈內人知道的那個～"> <button class="baozi-btn-primary" id="baozi-login-btn">進入同好會 ✨</button> <div class="baozi-error" id="baozi-login-error"></div> </div> </div>`;

```
document.getElementById('baozi-login-btn').addEventListener('click', async () => {
    const nickname = document.getElementById('baozi-nickname-input').value.trim();
    const secret = document.getElementById('baozi-secret-input').value.trim();
    const errBox = document.getElementById('baozi-login-error');

    if (!nickname) {
        errBox.textContent = '要填暱稱啦～';
        return;
    }
    if (!secret) {
        errBox.textContent = '暗號呢？';
        return;
    }

    errBox.textContent = '驗證中...';
    const result = await verifyClubMember(secret, nickname);
    if (result.ok) {
        renderHomeScreen(container);
    } else {
        errBox.textContent = '❌ ' + result.reason;
    }
});
```

}

function renderHomeScreen(container) {
container.innerHTML = `<div class="baozi-home"> <div class="baozi-greeting">你好，<b>${state.nickname}</b>～今天也辛苦啦 💕</div> <div class="baozi-menu"> <button class="baozi-menu-btn" data-target="my-commands"> <span class="baozi-menu-icon">📚</span> <span>我的指令庫</span> </button> <button class="baozi-menu-btn" data-target="shared-space"> <span class="baozi-menu-icon">🏠</span> <span>共享空間</span> </button> <button class="baozi-menu-btn" data-target="shared-chats"> <span class="baozi-menu-icon">💬</span> <span>分享的對話</span> </button> <button class="baozi-menu-btn" data-target="settings"> <span class="baozi-menu-icon">⚙️</span> <span>設定</span> </button> </div> </div>`;

```
container.querySelectorAll('.baozi-menu-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        switch (target) {
            case 'my-commands': renderMyCommandsScreen(container); break;
            case 'shared-space': renderSharedSpaceScreen(container); break;
            case 'shared-chats': renderSharedChatsScreen(container); break;
            case 'settings': renderSettingsScreen(container); break;
        }
    });
});
```

}

// ––––– 我的指令庫畫面 –––––
async function renderMyCommandsScreen(container) {
container.innerHTML = `<div class="baozi-screen"> <div class="baozi-screen-header"> <button class="baozi-back" id="baozi-back">← 回首頁</button> <h3>📚 我的指令庫</h3> </div> <button class="baozi-btn-primary baozi-btn-full" id="baozi-add-cmd">+ 新增指令</button> <div class="baozi-list" id="baozi-cmd-list"> <div class="baozi-loading">載入中...</div> </div> </div>`;

```
document.getElementById('baozi-back').addEventListener('click', () => renderHomeScreen(container));
document.getElementById('baozi-add-cmd').addEventListener('click', () => renderAddCommandScreen(container));

const list = document.getElementById('baozi-cmd-list');
try {
    const commands = await getMyCommands();
    if (commands.length === 0) {
        list.innerHTML = '<div class="baozi-empty">🥟 還沒有指令～點上面新增一個吧！</div>';
        return;
    }
    list.innerHTML = commands.map(cmd => `
        <div class="baozi-card">
            <div class="baozi-card-title">${escapeHtml(cmd.title)}</div>
            <div class="baozi-card-content">${escapeHtml(cmd.content).substring(0, 120)}${cmd.content.length > 120 ? '...' : ''}</div>
            <div class="baozi-card-actions">
                ${cmd.shared
                    ? '<span class="baozi-tag-shared">✓ 已分享</span>'
                    : `<button class="baozi-btn-small" data-action="share" data-id="${cmd.id}">📤 分享</button>`}
                <button class="baozi-btn-small" data-action="view" data-id="${cmd.id}">👀 看全文</button>
                <button class="baozi-btn-small" data-action="copy" data-id="${cmd.id}">📋 複製</button>
                <button class="baozi-btn-small baozi-btn-danger" data-action="delete" data-id="${cmd.id}">🗑️</button>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            const cmd = commands.find(c => c.id === id);

            if (action === 'share') {
                await shareCommand(id);
                renderMyCommandsScreen(container);
            } else if (action === 'copy') {
                const ok = await copyToClipboard(cmd.content);
                btn.textContent = ok ? '✓ 已複製' : '❌ 失敗';
                setTimeout(() => btn.textContent = '📋 複製', 1500);
            } else if (action === 'view') {
                showFullTextModal(cmd.title, cmd.content);
            } else if (action === 'delete') {
                if (confirm('確定要刪除「' + cmd.title + '」嗎？')) {
                    await deleteCommand(id);
                    renderMyCommandsScreen(container);
                }
            }
        });
    });
} catch (err) {
    list.innerHTML = '<div class="baozi-error">載入失敗：' + err.message + '</div>';
}
```

}

function renderAddCommandScreen(container) {
container.innerHTML = `<div class="baozi-screen"> <div class="baozi-screen-header"> <button class="baozi-back" id="baozi-back">← 取消</button> <h3>+ 新增指令</h3> </div> <div class="baozi-form"> <label>標題</label> <input type="text" id="baozi-new-title" placeholder="例如：雨夜咖啡廳場景"> <label>內容</label> <textarea id="baozi-new-content" rows="8" placeholder="貼上你的指令、劇本、prompt..."></textarea> <label>標籤（選填，用逗號分隔）</label> <input type="text" id="baozi-new-tags" placeholder="例如：雨天, 咖啡廳, 甜"> <button class="baozi-btn-primary baozi-btn-full" id="baozi-save-cmd">💾 儲存</button> <div class="baozi-error" id="baozi-save-error"></div> </div> </div>`;

```
document.getElementById('baozi-back').addEventListener('click', () => renderMyCommandsScreen(container));
document.getElementById('baozi-save-cmd').addEventListener('click', async () => {
    const title = document.getElementById('baozi-new-title').value.trim();
    const content = document.getElementById('baozi-new-content').value.trim();
    const tagsStr = document.getElementById('baozi-new-tags').value.trim();
    const errBox = document.getElementById('baozi-save-error');

    if (!title || !content) {
        errBox.textContent = '標題跟內容都要填喔～';
        return;
    }

    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

    try {
        await addMyCommand(title, content, tags);
        renderMyCommandsScreen(container);
    } catch (err) {
        errBox.textContent = '儲存失敗：' + err.message;
    }
});
```

}

// ––––– 共享空間畫面 –––––
async function renderSharedSpaceScreen(container) {
container.innerHTML = `<div class="baozi-screen"> <div class="baozi-screen-header"> <button class="baozi-back" id="baozi-back">← 回首頁</button> <h3>🏠 共享空間</h3> </div> <div class="baozi-list" id="baozi-shared-list"> <div class="baozi-loading">載入中...</div> </div> </div>`;

```
document.getElementById('baozi-back').addEventListener('click', () => renderHomeScreen(container));

const list = document.getElementById('baozi-shared-list');
try {
    const commands = await getSharedCommands();
    if (commands.length === 0) {
        list.innerHTML = '<div class="baozi-empty">🏠 還沒有人分享指令～趕快去分享一個吧！</div>';
        return;
    }

    list.innerHTML = commands.map(cmd => `
        <div class="baozi-card">
            <div class="baozi-card-owner">${escapeHtml(cmd.ownerNickname || '匿名')} 分享了</div>
            <div class="baozi-card-title">${escapeHtml(cmd.title)}</div>
            <div class="baozi-card-content">${escapeHtml(cmd.content).substring(0, 150)}${cmd.content.length > 150 ? '...' : ''}</div>
            <div class="baozi-card-actions">
                <button class="baozi-btn-small" data-action="view" data-id="${cmd.id}">👀 看全文</button>
                <button class="baozi-btn-small" data-action="copy" data-id="${cmd.id}">📋 複製</button>
                ${cmd.ownerId !== state.user.uid
                    ? `<button class="baozi-btn-small" data-action="favorite" data-id="${cmd.id}">⭐ 收藏</button>`
                    : '<span class="baozi-tag-mine">我分享的</span>'}
                <button class="baozi-btn-small" data-action="comment" data-id="${cmd.id}">💭 吐槽</button>
            </div>
            <div class="baozi-comments" id="baozi-comments-${cmd.id}" style="display:none;"></div>
        </div>
    `).join('');

    list.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            const cmd = commands.find(c => c.id === id);

            if (action === 'view') {
                showFullTextModal(cmd.title, cmd.content);
            } else if (action === 'favorite') {
                await favoriteCommand(cmd);
                btn.textContent = '✓ 已收藏';
                btn.disabled = true;
            } else if (action === 'copy') {
                const ok = await copyToClipboard(cmd.content);
                btn.textContent = ok ? '✓ 已複製' : '❌ 失敗';
                setTimeout(() => btn.textContent = '📋 複製', 1500);
            } else if (action === 'comment') {
                toggleCommentPanel('command', id);
            }
        });
    });
} catch (err) {
    list.innerHTML = '<div class="baozi-error">載入失敗：' + err.message + '</div>';
}
```

}

// ––––– 分享對話畫面 –––––
async function renderSharedChatsScreen(container) {
container.innerHTML = `<div class="baozi-screen"> <div class="baozi-screen-header"> <button class="baozi-back" id="baozi-back">← 回首頁</button> <h3>💬 分享的對話</h3> </div> <button class="baozi-btn-primary baozi-btn-full" id="baozi-new-chat">+ 分享一段對話</button> <div class="baozi-list" id="baozi-chat-list"> <div class="baozi-loading">載入中...</div> </div> </div>`;

```
document.getElementById('baozi-back').addEventListener('click', () => renderHomeScreen(container));
document.getElementById('baozi-new-chat').addEventListener('click', () => renderShareChatScreen(container));

const list = document.getElementById('baozi-chat-list');
try {
    const chats = await getSharedChats();
    if (chats.length === 0) {
        list.innerHTML = '<div class="baozi-empty">💬 還沒有分享的對話～</div>';
        return;
    }

    list.innerHTML = chats.map(chat => {
        const isMine = chat.ownerId === state.user.uid;
        return `
            <div class="baozi-card" data-chat-id="${chat.id}">
                <div class="baozi-card-owner">${escapeHtml(chat.ownerNickname || '匿名')}${isMine ? ' <span class="baozi-tag-mine">我分享的</span>' : ''}</div>
                <div class="baozi-card-title">${escapeHtml(chat.title || '(無標題)')}</div>
                <div class="baozi-card-preface">${escapeHtml(chat.preface || '')}</div>
                <div class="baozi-card-content">${renderMaskedText(chat.content, chat.maskedRanges || [])}</div>
                <div class="baozi-card-actions">
                    <button class="baozi-btn-small" data-action="comment" data-id="${chat.id}">💭 吐槽</button>
                    ${isMine ? `
                        <button class="baozi-btn-small" data-action="edit" data-id="${chat.id}">✏️ 修改</button>
                        <button class="baozi-btn-small baozi-btn-danger" data-action="delete" data-id="${chat.id}">🗑️ 刪除</button>
                    ` : ''}
                </div>
                <div class="baozi-comments" id="baozi-comments-${chat.id}" style="display:none;"></div>
            </div>
        `;
    }).join('');

    // 讓打碼可以點擊顯示
    list.querySelectorAll('.baozi-masked').forEach(el => {
        el.addEventListener('click', () => {
            el.classList.toggle('baozi-masked-revealed');
        });
    });

    // 綁定按鈕事件
    list.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            const chat = chats.find(c => c.id === id);

            if (action === 'comment') {
                toggleCommentPanel('chat', id);
            } else if (action === 'edit') {
                renderShareChatScreen(container, chat);  // 帶入現有資料編輯
            } else if (action === 'delete') {
                if (confirm('確定要刪除這個分享嗎？（其他人也會看不到）')) {
                    try {
                        await deleteChatSnippet(id);
                        renderSharedChatsScreen(container);
                    } catch (err) {
                        alert('刪除失敗：' + err.message);
                    }
                }
            }
        });
    });
} catch (err) {
    list.innerHTML = '<div class="baozi-error">載入失敗：' + err.message + '</div>';
}
```

}

/**

- 分享/編輯對話畫面
- @param {HTMLElement} container
- @param {Object|null} editingChat - 如果有值就是編輯模式
  */
  function renderShareChatScreen(container, editingChat = null) {
  const isEditing = !!editingChat;
  
  container.innerHTML = `
  <div class="baozi-screen">
  <div class="baozi-screen-header">
  <button class="baozi-back" id="baozi-back">← 取消</button>
  <h3>${isEditing ? ‘✏️ 修改分享’ : ‘💬 分享一段對話’}</h3>
  </div>
  <div class="baozi-form">
  <label>標題</label>
  <input type="text" id="baozi-chat-title" placeholder="例如：今天跟角色的離譜對話" value="${escapeHtml(editingChat?.title || '')}">
  
  ```
           <label>前言（吐槽、感想）</label>
           <textarea id="baozi-chat-preface" rows="2" placeholder="例如：你看這段！！真的笑死🤣">${escapeHtml(editingChat?.preface || '')}</textarea>
  
           ${isEditing ? '' : `
               <label>📥 從當前對話選取訊息</label>
               <div class="baozi-msg-picker-hint">勾選要分享的訊息，然後點「加入內容」</div>
               <div class="baozi-msg-picker" id="baozi-msg-picker">
                   <div class="baozi-loading">載入對話中...</div>
               </div>
               <button class="baozi-btn-small baozi-btn-full" id="baozi-insert-selected" style="margin-bottom:12px;">📥 把選中的訊息加入下方內容</button>
           `}
  
           <label>對話內容（可以直接編輯）</label>
           <textarea id="baozi-chat-content" rows="10" placeholder="貼上或從上方選擇要分享的對話...">${escapeHtml(editingChat?.content || '')}</textarea>
  
           <label>打碼（把要遮住的字選起來，然後點按鈕）</label>
           <div class="baozi-mask-controls">
               <button class="baozi-btn-small" id="baozi-add-mask">🙈 把選中的文字打碼</button>
               <button class="baozi-btn-small" id="baozi-clear-mask">清除所有打碼</button>
           </div>
           <div class="baozi-mask-list" id="baozi-mask-list"></div>
  
           <div class="baozi-preview">預覽：</div>
           <div class="baozi-preview-box" id="baozi-preview-box"></div>
  
           <button class="baozi-btn-primary baozi-btn-full" id="baozi-send-chat">
               ${isEditing ? '💾 儲存修改' : '📤 發送分享'}
           </button>
           <div class="baozi-error" id="baozi-chat-error"></div>
       </div>
   </div>
  ```
  
  `;
  
  let maskedRanges = editingChat?.maskedRanges ? […editingChat.maskedRanges] : [];
  
  const contentArea = document.getElementById(‘baozi-chat-content’);
  const maskList = document.getElementById(‘baozi-mask-list’);
  const previewBox = document.getElementById(‘baozi-preview-box’);
  
  function updatePreview() {
  const content = contentArea.value;
  previewBox.innerHTML = renderMaskedText(content, maskedRanges);
  maskList.innerHTML = maskedRanges.map((r, i) =>
  `<span class="baozi-mask-chip">第 ${r.start}-${r.end} 字 <span class="baozi-mask-remove" data-idx="${i}">✕</span></span>`
  ).join(’’);
  maskList.querySelectorAll(’.baozi-mask-remove’).forEach(el => {
  el.addEventListener(‘click’, () => {
  maskedRanges.splice(parseInt(el.dataset.idx), 1);
  updatePreview();
  });
  });
  }
  
  contentArea.addEventListener(‘input’, updatePreview);
  updatePreview();
  
  // 新增模式才顯示訊息選擇器
  if (!isEditing) {
  renderMessagePicker();
  const insertBtn = document.getElementById(‘baozi-insert-selected’);
  if (insertBtn) {
  insertBtn.addEventListener(‘click’, () => {
  const picker = document.getElementById(‘baozi-msg-picker’);
  const selected = picker.querySelectorAll(‘input[type=“checkbox”]:checked’);
  if (selected.length === 0) {
  alert(‘請至少勾選一則訊息～’);
  return;
  }
  const texts = Array.from(selected).map(cb => cb.dataset.msgText).filter(Boolean);
  const joined = texts.join(’\n\n’);
  // 追加或替換到內容區
  if (contentArea.value.trim()) {
  contentArea.value = contentArea.value + ‘\n\n’ + joined;
  } else {
  contentArea.value = joined;
  }
  updatePreview();
  // 清除勾選
  selected.forEach(cb => cb.checked = false);
  });
  }
  }
  
  document.getElementById(‘baozi-add-mask’).addEventListener(‘click’, () => {
  const start = contentArea.selectionStart;
  const end = contentArea.selectionEnd;
  if (start === end) {
  alert(‘請先選取一段文字（用手指或滑鼠選取要打碼的字）’);
  return;
  }
  maskedRanges.push({ start, end });
  maskedRanges = mergeMaskRanges(maskedRanges);
  updatePreview();
  });
  
  document.getElementById(‘baozi-clear-mask’).addEventListener(‘click’, () => {
  maskedRanges = [];
  updatePreview();
  });
  
  document.getElementById(‘baozi-back’).addEventListener(‘click’, () => renderSharedChatsScreen(container));
  
  document.getElementById(‘baozi-send-chat’).addEventListener(‘click’, async () => {
  const title = document.getElementById(‘baozi-chat-title’).value.trim();
  const preface = document.getElementById(‘baozi-chat-preface’).value.trim();
  const content = contentArea.value.trim();
  const errBox = document.getElementById(‘baozi-chat-error’);
  
  ```
   if (!content) {
       errBox.textContent = '內容不能空的啦～';
       return;
   }
  
   try {
       if (isEditing) {
           await updateChatSnippet(editingChat.id, title || '(無標題)', preface, content, maskedRanges);
       } else {
           await shareChatSnippet(title || '(無標題)', preface, content, maskedRanges);
       }
       renderSharedChatsScreen(container);
   } catch (err) {
       errBox.textContent = '失敗：' + err.message;
   }
  ```
  
  });
  }

/**

- 渲染當前 SillyTavern 對話的訊息清單（可勾選）
  */
  function renderMessagePicker() {
  const picker = document.getElementById(‘baozi-msg-picker’);
  if (!picker) return;
  
  try {
  const messages = document.querySelectorAll(’#chat .mes’);
  if (!messages.length) {
  picker.innerHTML = ‘<div class="baozi-empty-small">目前沒有對話記錄～可以直接在下方輸入</div>’;
  return;
  }
  
  ```
   // 只取最近 30 條避免清單太長
   const recent = Array.from(messages).slice(-30);
  
   picker.innerHTML = recent.map((m, i) => {
       const name = m.querySelector('.ch_name .name_text')?.textContent?.trim()
                 || m.querySelector('.name_text')?.textContent?.trim()
                 || '???';
       const text = m.querySelector('.mes_text')?.innerText?.trim() || '';
       if (!text) return '';
       const preview = text.length > 80 ? text.substring(0, 80) + '...' : text;
       const fullText = `【${name}】\n${text}`;
       return `
           <label class="baozi-msg-item">
               <input type="checkbox" data-msg-text="${escapeHtml(fullText)}">
               <div class="baozi-msg-preview">
                   <b>${escapeHtml(name)}</b>
                   <span>${escapeHtml(preview)}</span>
               </div>
           </label>
       `;
   }).filter(Boolean).join('');
  
   if (!picker.innerHTML.trim()) {
       picker.innerHTML = '<div class="baozi-empty-small">沒有可選擇的訊息～</div>';
   }
  ```
  
  } catch (err) {
  picker.innerHTML = ‘<div class="baozi-empty-small">無法讀取對話：’ + err.message + ‘</div>’;
  }
  }

// ––––– 設定畫面 –––––
function renderSettingsScreen(container) {
container.innerHTML = `<div class="baozi-screen"> <div class="baozi-screen-header"> <button class="baozi-back" id="baozi-back">← 回首頁</button> <h3>⚙️ 設定</h3> </div> <div class="baozi-form"> <label>你的暱稱</label> <input type="text" id="baozi-edit-nickname" value="${escapeHtml(state.nickname || '')}"> <button class="baozi-btn-primary" id="baozi-save-nickname">儲存暱稱</button> <hr style="margin: 20px 0; border-color: rgba(0,0,0,0.1);"> <div class="baozi-info"> <div><b>暱稱：</b>${escapeHtml(state.nickname)}</div> <div><b>使用者 ID：</b><span style="font-size:11px; opacity:.6;">${state.user.uid}</span></div> </div> <hr style="margin: 20px 0; border-color: rgba(0,0,0,0.1);"> <button class="baozi-btn-small baozi-btn-full" id="baozi-reset-all" style="margin-bottom:10px;">🔧 重新設定 Firebase / 暗號</button> <button class="baozi-btn-danger baozi-btn-full" id="baozi-logout">登出</button> </div> </div>`;

```
document.getElementById('baozi-back').addEventListener('click', () => renderHomeScreen(container));

document.getElementById('baozi-save-nickname').addEventListener('click', async () => {
    const newName = document.getElementById('baozi-edit-nickname').value.trim();
    if (!newName) return;
    state.nickname = newName;
    localStorage.setItem('baozi_nickname', newName);

    const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await updateDoc(doc(state.db, 'members', state.user.uid), { nickname: newName });
    alert('暱稱已更新～');
    renderHomeScreen(container);
});

document.getElementById('baozi-reset-all').addEventListener('click', () => {
    if (confirm('確定要重新設定嗎？\n\n這會清除 Firebase 設定和暗號，需要重新填寫。\n（你的暱稱、指令、分享內容都還會保留在雲端～）')) {
        localStorage.removeItem('baozi_firebase_config');
        localStorage.removeItem('baozi_club_secret');
        localStorage.removeItem('baozi_verified');
        FIREBASE_CONFIG = null;
        CLUB_SECRET = null;
        state.isReady = false;
        renderSetupScreen(container);
    }
});

document.getElementById('baozi-logout').addEventListener('click', () => {
    if (confirm('確定要登出嗎？下次要重新輸入暗號。')) {
        localStorage.removeItem('baozi_verified');
        localStorage.removeItem('baozi_nickname');
        state.isReady = false;
        state.nickname = null;
        renderLoginScreen(container);
    }
});
```

}

// ============================================================
// 💭 吐槽面板（可展開收合）
// ============================================================

async function toggleCommentPanel(targetType, targetId) {
const panel = document.getElementById(‘baozi-comments-’ + targetId);
if (!panel) return;

```
if (panel.style.display === 'none') {
    panel.style.display = 'block';
    panel.innerHTML = '<div class="baozi-loading">載入吐槽中...</div>';
    try {
        const comments = await getComments(targetType, targetId);
        panel.innerHTML = `
            ${comments.length === 0 ? '<div class="baozi-empty-small">還沒有人吐槽～</div>' : ''}
            ${comments.map(c => `
                <div class="baozi-comment">
                    <b>${escapeHtml(c.authorNickname || '匿名')}：</b>
                    <span>${escapeHtml(c.text)}</span>
                </div>
            `).join('')}
            <div class="baozi-comment-input">
                <input type="text" placeholder="留個吐槽..." class="baozi-new-comment">
                <button class="baozi-btn-small baozi-send-comment">發送</button>
            </div>
        `;
        const input = panel.querySelector('.baozi-new-comment');
        const sendBtn = panel.querySelector('.baozi-send-comment');
        const doSend = async () => {
            const text = input.value.trim();
            if (!text) return;
            await addComment(targetType, targetId, text);
            panel.style.display = 'none';
            toggleCommentPanel(targetType, targetId);
        };
        sendBtn.addEventListener('click', doSend);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
    } catch (err) {
        panel.innerHTML = '<div class="baozi-error">載入失敗：' + err.message + '</div>';
    }
} else {
    panel.style.display = 'none';
}
```

}

// ============================================================
// 🛠️ 工具函式
// ============================================================

function escapeHtml(str) {
if (str == null) return ‘’;
return String(str)
.replace(/&/g, ‘&’)
.replace(/</g, ‘<’)
.replace(/>/g, ‘>’)
.replace(/”/g, ‘"’)
.replace(/’/g, ‘'’);
}

function renderMaskedText(text, ranges) {
if (!text) return ‘’;
if (!ranges || ranges.length === 0) {
return escapeHtml(text).replace(/\n/g, ‘<br>’);
}
// 按 start 排序
const sorted = […ranges].sort((a, b) => a.start - b.start);
let result = ‘’;
let cursor = 0;
for (const r of sorted) {
result += escapeHtml(text.substring(cursor, r.start));
result += ‘<span class="baozi-masked" title="點一下顯示">’ + escapeHtml(text.substring(r.start, r.end)) + ‘</span>’;
cursor = r.end;
}
result += escapeHtml(text.substring(cursor));
return result.replace(/\n/g, ‘<br>’);
}

function mergeMaskRanges(ranges) {
if (ranges.length <= 1) return ranges;
const sorted = […ranges].sort((a, b) => a.start - b.start);
const merged = [sorted[0]];
for (let i = 1; i < sorted.length; i++) {
const last = merged[merged.length - 1];
if (sorted[i].start <= last.end) {
last.end = Math.max(last.end, sorted[i].end);
} else {
merged.push(sorted[i]);
}
}
return merged;
}

function extractCurrentChat() {
// 嘗試從 SillyTavern 抓當前對話（最近 5 條訊息）
try {
const messages = document.querySelectorAll(’#chat .mes’);
if (!messages.length) return ‘’;
const recent = Array.from(messages).slice(-5);
return recent.map(m => {
const name = m.querySelector(’.ch_name .name_text’)?.textContent?.trim() || ‘???’;
const text = m.querySelector(’.mes_text’)?.innerText?.trim() || ‘’;
return `【${name}】\n${text}`;
}).join(’\n\n’);
} catch {
return ‘’;
}
}

function showError(msg) {
const existing = document.getElementById(‘baozi-global-error’);
if (existing) existing.remove();
const el = document.createElement(‘div’);
el.id = ‘baozi-global-error’;
el.className = ‘baozi-global-error’;
el.textContent = ’🥟 ’ + msg;
document.body.appendChild(el);
setTimeout(() => el.remove(), 5000);
}

/**

- 複製文字到剪貼簿（相容 HTTP/HTTPS、所有瀏覽器）
- 回傳 Promise，成功時 resolve(true)，失敗時 resolve(false)
  */
  async function copyToClipboard(text) {
  // 方法 1：現代 Clipboard API（需要 HTTPS）
  try {
  if (navigator.clipboard && window.isSecureContext) {
  await navigator.clipboard.writeText(text);
  return true;
  }
  } catch (err) {
  console.warn(’[包子同好會] Clipboard API 失敗，改用 fallback’, err);
  }
  
  // 方法 2：舊版 execCommand（相容所有環境）
  try {
  const textarea = document.createElement(‘textarea’);
  textarea.value = text;
  textarea.style.position = ‘fixed’;
  textarea.style.top = ‘-9999px’;
  textarea.style.left = ‘-9999px’;
  textarea.style.opacity = ‘0’;
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);  // iOS 需要
  const ok = document.execCommand(‘copy’);
  document.body.removeChild(textarea);
  return ok;
  } catch (err) {
  console.error(’[包子同好會] 複製失敗’, err);
  return false;
  }
  }

/**

- 顯示「查看全文」的彈窗（內容可以手動選取複製）
  */
  function showFullTextModal(title, content) {
  // 移除舊的彈窗
  const existing = document.getElementById(‘baozi-text-modal’);
  if (existing) existing.remove();
  
  const modal = document.createElement(‘div’);
  modal.id = ‘baozi-text-modal’;
  modal.className = ‘baozi-modal-overlay’;
  modal.innerHTML = `<div class="baozi-modal"> <div class="baozi-modal-header"> <span class="baozi-modal-title">${escapeHtml(title || '查看全文')}</span> <span class="baozi-modal-close">✕</span> </div> <textarea class="baozi-modal-textarea" readonly></textarea> <div class="baozi-modal-footer"> <button class="baozi-btn-small baozi-modal-copy">📋 複製全部</button> <button class="baozi-btn-small baozi-modal-dismiss">關閉</button> </div> </div>`;
  document.body.appendChild(modal);
  
  // 用 textarea 顯示內容，可以手動選取複製
  const textarea = modal.querySelector(’.baozi-modal-textarea’);
  textarea.value = content;
  
  const close = () => modal.remove();
  
  modal.querySelector(’.baozi-modal-close’).addEventListener(‘click’, close);
  modal.querySelector(’.baozi-modal-dismiss’).addEventListener(‘click’, close);
  modal.addEventListener(‘click’, e => {
  if (e.target === modal) close();
  });
  
  const copyBtn = modal.querySelector(’.baozi-modal-copy’);
  copyBtn.addEventListener(‘click’, async () => {
  const ok = await copyToClipboard(content);
  copyBtn.textContent = ok ? ‘✓ 已複製’ : ‘❌ 複製失敗，請手動選取’;
  setTimeout(() => copyBtn.textContent = ‘📋 複製全部’, 2000);
  });
  }

// ============================================================
// 🚀 啟動擴展
// ============================================================

(async function init() {
console.log(’[包子同好會] 正在啟動…’);

```
// 等待 DOM 準備好
if (document.readyState === 'loading') {
    await new Promise(r => document.addEventListener('DOMContentLoaded', r));
}

// 等待 SillyTavern UI 載入（給 2 秒緩衝）
await new Promise(r => setTimeout(r, 2000));

// 建立 UI
buildUI();

// 嘗試從 localStorage 載入設定
const hasConfig = loadConfig();

if (!hasConfig) {
    updateExtStatus('⚠️ 尚未設定，請點按鈕進行首次設定', 'error');
    console.log('[包子同好會] 尚未設定，等待使用者填寫');
    return;
}

updateExtStatus('⏳ 連線 Firebase 中...');

// 初始化 Firebase
const ok = await initFirebase();
if (!ok) {
    updateExtStatus('❌ Firebase 連線失敗', 'error');
    return;
}

// 如果本地有記錄的驗證狀態，嘗試自動恢復
const savedNick = localStorage.getItem('baozi_nickname');
const savedVerified = localStorage.getItem('baozi_verified');
if (savedVerified === 'yes' && savedNick) {
    state.nickname = savedNick;
    state.isReady = true;
    updateExtStatus('✅ 已登入：' + savedNick, 'ok');
    console.log('[包子同好會] 自動恢復登入');
} else {
    updateExtStatus('✨ 已連線，請點擊按鈕登入', 'ok');
}

console.log('[包子同好會] 啟動完成 🥟');
```

})();
