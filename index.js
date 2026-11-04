// ============================================================
// 🥟 包子同好會 SillyTavern 擴展
// ============================================================
// 作者：Tammy & Claude
// 功能：讓小圈子的朋友可以互相分享指令、對話和吐槽
//
// 💡 無需修改程式碼！首次打開擴展時會彈出設定視窗，
//    所有設定值會存在瀏覽器本地（localStorage）裡。
// ============================================================

import {
    bot, isBotLoggedIn, botLogout, refreshMe, renderBotLoginScreen,
    renderLibraryScreen, renderChatScreen, closeChat,
    rollDice, renderDiceSettings, DICE_EMPTY,
    fetchNotifications, renderNotificationsScreen, startAutoMark,
} from './bot.js';
import { localizeLive, refreshLocale, t } from './i18n.js';
import { enterSelectMode, renderAlbumScreen, renderFavsScreen } from './shots.js';
import { renderDesktop } from './desktop.js';
import { renderAiSettings } from './aidesign.js';
import { installErrorCapture, renderReport, openReportModal, trace } from './report.js';
import { announceVersion, mountVersionChip } from './version.js';
import { renderInboxScreen, inboxUnread } from './inbox.js';
import { renderGameScreen, closeGame } from './game.js';
import { mountMascot, greetIfNeeded, greetingEnabled, setGreetingEnabled, pokeMascot, showBubble, closeBubble } from './xiaobaozi.js';

const extensionName = "baozi-club";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// ============================================================
// 🏠 內建設定（讓所有裝置免手動設定，打開就只要輸「名字 + 暗號」）
// ============================================================
// Firebase 設定（apiKey 等）本來就是前端公開資訊，內建進來沒有安全疑慮，
// 真正的保護是暗號 + Firestore 規則。內建之後，任何裝置裝上這份插件，
// 打開就自帶「同好會地址」，不必再貼一大段 JSON。
const BUILTIN_FIREBASE_CONFIG = {
    apiKey: "AIzaSyCXUwNVL7GOp6nLpKyfc8vCZQniS9nLM48",
    authDomain: "bao-club-95563.firebaseapp.com",
    projectId: "bao-club-95563",
    storageBucket: "bao-club-95563.firebasestorage.app",
    messagingSenderId: "646431288090",
    appId: "1:646431288090:web:ddb0bf73428db8e6e55aa3",
};

// 圈內暗號「不」以明文存放（因為 repo 是公開的），這裡只放它的 SHA-256 雜湊值。
// 登入時把使用者輸入的暗號做同樣的雜湊再比對，路過的人看到這串也還原不出暗號。
// 要改暗號時，用 sha256Hex('新暗號') 算出新值換掉即可。
const BUILTIN_CLUB_SECRET_HASH = "c7d0cbbbc94bed2db7a26faeb870bfc2774ecd1cb6a129f9c7aad7c8c63862e2";

// ---------- 執行期用的設定值 ----------
// 有內建設定時直接沿用；沒有時才 fallback 到 localStorage（向後相容舊版）
let FIREBASE_CONFIG = null;
let CLUB_SECRET = null;   // 僅在「沒有內建雜湊、走 localStorage 舊流程」時才會用到明文


/**
 * 載入設定：內建優先，其次才讀 localStorage
 * 回傳 true 代表設定齊全，false 代表需要使用者手動填寫
 */
function loadConfig() {
    try {
        // 內建設定優先：新裝置裝上就自帶地址，只要輸名字+暗號即可
        if (BUILTIN_FIREBASE_CONFIG) {
            FIREBASE_CONFIG = BUILTIN_FIREBASE_CONFIG;
            return true;
        }

        const savedFirebase = localStorage.getItem('baozi_firebase_config');
        const savedSecret = localStorage.getItem('baozi_club_secret');

        if (savedFirebase && savedSecret) {
            FIREBASE_CONFIG = JSON.parse(savedFirebase);
            CLUB_SECRET = savedSecret;
            return true;
        }
        return false;
    } catch (err) {
        console.error('[包子同好會] 讀取設定失敗', err);
        return false;
    }
}


/**
 * 是否已完成基本設定（有地址 + 有暗號比對依據）
 */
function isConfigured() {
    return !!FIREBASE_CONFIG && (!!BUILTIN_CLUB_SECRET_HASH || !!CLUB_SECRET);
}


/**
 * 驗證暗號：有內建雜湊就比對雜湊，否則 fallback 比對 localStorage 明文
 */
function checkSecret(input) {
    if (BUILTIN_CLUB_SECRET_HASH) {
        return sha256Hex(input) === BUILTIN_CLUB_SECRET_HASH;
    }
    return input === CLUB_SECRET;
}


/**
 * 儲存設定到 localStorage
 */
function saveConfig(firebaseConfig, clubSecret) {
    try {
        localStorage.setItem('baozi_firebase_config', JSON.stringify(firebaseConfig));
        localStorage.setItem('baozi_club_secret', clubSecret);
        FIREBASE_CONFIG = firebaseConfig;
        CLUB_SECRET = clubSecret;
        return true;
    } catch (err) {
        console.error('[包子同好會] 儲存設定失敗', err);
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

async function initFirebase({ quiet = false } = {}) {
    try {
        // 從 CDN 載入 Firebase SDK（使用 ES 模組）
        const { initializeApp, getApps, getApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
        const { getAuth, signInAnonymously } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
        const { getFirestore } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

        // 初始化 Firebase（若先前已初始化過就直接沿用，
        // 避免連線失敗重試時再次 initializeApp 觸發「App already exists」而整個崩掉）
        state.firebase = getApps().length ? getApp() : initializeApp(FIREBASE_CONFIG);
        state.auth = getAuth(state.firebase);
        state.db = getFirestore(state.firebase);

        // 匿名登入
        const result = await signInAnonymously(state.auth);
        state.user = result.user;

        console.log('[包子同好會] Firebase 登入成功', state.user.uid);
        return true;
    } catch (err) {
        console.error('[包子同好會] Firebase 初始化失敗', err);
        if (!quiet) showError('連線失敗：' + err.message);
        return false;
    }
}


// ============================================================
// 🔐 圈內驗證（用暗號確認身份）
// ============================================================

async function verifyClubMember(inputSecret, inputNickname) {
    if (!checkSecret(inputSecret)) {
        return { ok: false, reason: '暗號不對喔～再試試！' };
    }

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
}


// ============================================================
// 📚 我的指令庫：新增、讀取、刪除
// ============================================================

async function addMyCommand(title, content, tags = []) {
    const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

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
}

async function getMyCommands() {
    // 只用 where 不用 orderBy，避免需要複合索引
    // 拿回來之後在前端排序
    const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

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
}

async function deleteCommand(id) {
    const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await deleteDoc(doc(state.db, 'commands', id));
}

async function shareCommand(id) {
    const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await updateDoc(doc(state.db, 'commands', id), { shared: true });
}

async function updateCommand(id, title, content, tags = []) {
    const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await updateDoc(doc(state.db, 'commands', id), { title, content, tags });
}


// ============================================================
// 😆 表情反應（指令和對話通用；取代原本單一的點讚）
// ============================================================

// 圈子可用的表情（第一個 ❤️ 用來相容舊的點讚資料）
const REACTION_EMOJIS = ['❤️', '🤣', '😭', '🥵', '👏'];

/**
 * 設定 / 切換我對某個目標的表情反應。
 * 一個人對一個目標只保留一種表情：沒按過→新增；按同一個→取消；按不同的→換成新的。
 * 用「刪除 + 新增」而不用 updateDoc，這樣不必動到 Firestore 規則（likes 不允許 update）。
 * @param {string} targetType - 'command' 或 'chat'
 * @param {string} targetId
 * @param {string} emoji
 * @returns {Promise<string|null>} 切換後我目前的表情（null = 沒有）
 */
async function setReaction(targetType, targetId, emoji) {
    const { collection, query, where, getDocs, addDoc, deleteDoc, doc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    const q = query(
        collection(state.db, 'likes'),
        where('targetType', '==', targetType),
        where('targetId', '==', targetId),
        where('userId', '==', state.user.uid)
    );
    const snapshot = await getDocs(q);

    // 我目前按的表情（舊資料沒有 reaction 欄位 → 當作 ❤️）；順便清掉舊的確保一人一則
    let mine = null;
    for (const d of snapshot.docs) {
        if (mine === null) mine = d.data().reaction || '❤️';
        await deleteDoc(doc(state.db, 'likes', d.id));
    }

    // 按的是同一個 → 取消（剛剛已刪掉）
    if (mine === emoji) return null;

    await addDoc(collection(state.db, 'likes'), {
        targetType,
        targetId,
        reaction: emoji,
        userId: state.user.uid,
        userNickname: state.nickname,
        createdAt: serverTimestamp(),
    });
    return emoji;
}

/**
 * 取得多個目標的表情統計和我自己按的表情
 * @returns {Promise<Object>} { [targetId]: { counts: {emoji:n}, mine: emoji|null, total } }
 */
async function getReactionsInfo(targetType, targetIds) {
    if (!targetIds || targetIds.length === 0) return {};

    const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    const q = query(
        collection(state.db, 'likes'),
        where('targetType', '==', targetType)
    );
    const snapshot = await getDocs(q);

    const result = {};
    targetIds.forEach(id => result[id] = { counts: {}, mine: null, total: 0 });

    snapshot.docs.forEach(d => {
        const data = d.data();
        const info = result[data.targetId];
        if (!info) return;
        const emoji = data.reaction || '❤️';   // 舊點讚沒有 reaction → 算成 ❤️
        info.counts[emoji] = (info.counts[emoji] || 0) + 1;
        info.total++;
        if (data.userId === state.user.uid) info.mine = emoji;
    });

    return result;
}

/** 建立一排表情反應按鈕的 HTML */
function reactionBarHtml(id, info) {
    const safe = info || { counts: {}, mine: null, total: 0 };
    return `<div class="baozi-reactions">` + REACTION_EMOJIS.map(e => {
        const n = safe.counts[e] || 0;
        const mineCls = safe.mine === e ? 'reacted' : '';
        return `<button class="baozi-btn-small baozi-btn-react ${mineCls}" data-action="react" data-id="${id}" data-emoji="${e}">${e}<span class="baozi-react-count">${n || ''}</span></button>`;
    }).join('') + `</div>`;
}

/** 就地更新一排表情按鈕（不重建 DOM，才不會弄丟事件監聽） */
function refreshReactionBar(barEl, info) {
    if (!barEl) return;
    barEl.querySelectorAll('.baozi-btn-react').forEach(b => {
        const e = b.dataset.emoji;
        b.classList.toggle('reacted', info.mine === e);
        const c = b.querySelector('.baozi-react-count');
        if (c) c.textContent = info.counts[e] || '';
    });
}

/** 樂觀更新本地表情統計：把我從舊表情移到新表情 */
function applyLocalReaction(info, newMine) {
    if (info.mine) {
        info.counts[info.mine] = Math.max(0, (info.counts[info.mine] || 0) - 1);
        info.total = Math.max(0, info.total - 1);
    }
    info.mine = newMine;
    if (newMine) {
        info.counts[newMine] = (info.counts[newMine] || 0) + 1;
        info.total++;
    }
    return info;
}


// ============================================================
// 🔔 通知系統（檢查有沒有新的點讚和留言，並記錄是哪一條）
// ============================================================

// 全域儲存目前的未讀資訊
const notifData = {
    totalCount: 0,
    unreadIds: new Set(),  // 「我的東西」中收到未讀的 id
    unreadInCommands: false,
    unreadInChats: false,
    myCmdIds: new Set(),   // 快取「我分享的指令 id」，省得每次互動都連線重查
    myChatIds: new Set(),  // 快取「我分享的對話 id」
    detailItems: [],       // 通知中心用：每則新互動的明細
};

/**
 * 取得未讀通知資訊（哪些東西有人按讚/留言）
 */
async function checkUnreadNotifications() {
    if (!state.user || !state.db) return;

    const { collection, query, where, getDocs, Timestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    const lastSeenStr = localStorage.getItem('baozi_last_seen_notif');
    // 加 || 0 防止 localStorage 壞掉時 parseInt 變 NaN，讓 Timestamp.fromMillis 出錯
    const lastSeenTime = (lastSeenStr ? parseInt(lastSeenStr) : 0) || 0;

    // 重設
    notifData.unreadIds = new Set();
    notifData.unreadInCommands = false;
    notifData.unreadInChats = false;
    notifData.detailItems = [];

    try {
        // 取得我自己分享的指令和對話（只有自己的，數量有限）
        const myCmdQ = query(
            collection(state.db, 'commands'),
            where('ownerId', '==', state.user.uid)
        );
        const myChatQ = query(
            collection(state.db, 'chats'),
            where('ownerId', '==', state.user.uid)
        );

        const [cmdSnap, chatSnap] = await Promise.all([getDocs(myCmdQ), getDocs(myChatQ)]);
        const mySharedCmdIds = new Set(cmdSnap.docs.filter(d => d.data().shared).map(d => d.id));
        const myChatIds = new Set(chatSnap.docs.map(d => d.id));
        // 快取起來，clearCardUnread / recalcSectionUnread 就不必再連線重查
        notifData.myCmdIds = mySharedCmdIds;
        notifData.myChatIds = myChatIds;

        // id → 標題 對照表（通知中心顯示用）
        const titleOf = {};
        cmdSnap.docs.forEach(d => titleOf[d.id] = d.data().title || '(無標題)');
        chatSnap.docs.forEach(d => titleOf[d.id] = d.data().title || '(無標題)');

        if (mySharedCmdIds.size > 0 || myChatIds.size > 0) {
            // 只撈「上次查看之後」新增的留言與點讚，
            // 不再每 30 秒把整個 comments / likes 集合搬回來（省流量也省 Firestore 讀取）
            const sinceTs = Timestamp.fromMillis(lastSeenTime);
            const newCommentsQ = query(
                collection(state.db, 'comments'),
                where('createdAt', '>', sinceTs)
            );
            const newLikesQ = query(
                collection(state.db, 'likes'),
                where('createdAt', '>', sinceTs)
            );
            const [commentsSnap, likesSnap] = await Promise.all([
                getDocs(newCommentsQ),
                getDocs(newLikesQ),
            ]);

            // 把新增的動作歸到對應的板塊（selfField 是「發動者」欄位，用來排除自己的動作）
            const tally = (snap, selfField, kind) => {
                snap.docs.forEach(d => {
                    const data = d.data();
                    if (data[selfField] === state.user.uid) return;
                    const section = mySharedCmdIds.has(data.targetId) ? 'command'
                                  : myChatIds.has(data.targetId) ? 'chat' : null;
                    if (!section) return;

                    notifData.unreadIds.add(data.targetId);
                    if (section === 'command') notifData.unreadInCommands = true;
                    else notifData.unreadInChats = true;

                    notifData.detailItems.push({
                        kind,                                   // 'like' | 'comment'
                        section,                                // 'command' | 'chat'
                        targetId: data.targetId,
                        title: titleOf[data.targetId] || '(某則分享)',
                        who: data.userNickname || data.authorNickname || '某人',
                        extra: kind === 'like' ? (data.reaction || '❤️') : (data.text || ''),
                        seconds: data.createdAt?.seconds || 0,
                    });
                });
            };
            tally(commentsSnap, 'authorId', 'comment');
            tally(likesSnap, 'userId', 'like');

            // 新到舊排序
            notifData.detailItems.sort((a, b) => b.seconds - a.seconds);
        }
    } catch (err) {
        console.warn('[包子同好會] 通知檢查失敗', err);
    }

    // 紅點數字 =「有未讀的項目數」，和逐張卡片清除時的遞減保持一致
    notifData.totalCount = notifData.unreadIds.size;
    updateAllBadges();
}

/**
 * 把所有通知標記為已讀
 */
function markNotificationsRead() {
    localStorage.setItem('baozi_last_seen_notif', Date.now().toString());
    notifData.totalCount = 0;
    notifData.unreadIds = new Set();
    notifData.unreadInCommands = false;
    notifData.unreadInChats = false;
    updateAllBadges();
}

/**
 * 更新所有紅點顯示（浮動按鈕、擴展選單、首頁選單按鈕、卡片）
 */
function updateAllBadges() {
    const count = notifData.totalCount;

    // 浮動按鈕的紅點
    const floatBtn = document.getElementById('baozi-float-btn');
    if (floatBtn) {
        let badge = floatBtn.querySelector('.baozi-notif-badge');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'baozi-notif-badge';
                floatBtn.appendChild(badge);
            }
            badge.textContent = count > 9 ? '9+' : count;
        } else if (badge) {
            badge.remove();
        }
    }

    // 擴展選單的紅點
    const extHeader = document.querySelector('#baozi-extension-settings .inline-drawer-header b');
    if (extHeader) {
        let badge = extHeader.querySelector('.baozi-notif-badge-inline');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'baozi-notif-badge-inline';
                extHeader.appendChild(badge);
            }
            badge.textContent = count > 9 ? '9+' : count;
        } else if (badge) {
            badge.remove();
        }
    }

    // 首頁選單按鈕的紅點（共享空間 / 分享對話）
    updateMenuBadges();
}

/**
 * 更新首頁選單按鈕上的紅點
 */
function updateMenuBadges() {
    document.querySelectorAll('.baozi-menu-btn').forEach(btn => {
        const target = btn.dataset.target;
        let dot = btn.querySelector('.baozi-menu-dot');
        const hasUnread = (target === 'shared-space' && notifData.unreadInCommands)
                       || (target === 'shared-chats' && notifData.unreadInChats);

        if (hasUnread) {
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'baozi-menu-dot';
                btn.appendChild(dot);
            }
        } else if (dot) {
            dot.remove();
        }
    });
}

/**
 * 清掉某張卡片的未讀標記（互動後呼叫）
 * 同時把那條從 notifData 中移除，並更新各種紅點顯示
 */
function clearCardUnread(id, cardEl) {
    if (!notifData.unreadIds.has(id)) return;

    notifData.unreadIds.delete(id);
    notifData.totalCount = notifData.unreadIds.size;

    // 移除卡片上的紅點
    if (cardEl) {
        cardEl.classList.remove('baozi-card-unread');
        const dot = cardEl.querySelector('.baozi-card-dot');
        if (dot) dot.remove();
    }

    // 重新計算此板塊還有沒有未讀（影響首頁紅點和總數）
    recalcSectionUnread();
    updateAllBadges();

    // 更新「上次查看」時間（不過要保留還沒看的卡片紅點，所以這裡不直接寫 localStorage
    // 改成全部都看完才更新時間）
    if (notifData.totalCount === 0) {
        localStorage.setItem('baozi_last_seen_notif', Date.now().toString());
    }
}

/**
 * 重新計算現在還有哪些板塊有未讀（用於首頁選單紅點）
 */
function recalcSectionUnread() {
    notifData.unreadInCommands = false;
    notifData.unreadInChats = false;

    if (notifData.unreadIds.size === 0) return;

    // 直接用上次 checkUnreadNotifications 快取的 id 集合，
    // 不必為了每一次卡片互動再連一次 Firestore（同步、即時、也不會卡）
    const cmdIds = notifData.myCmdIds || new Set();
    const chatIds = notifData.myChatIds || new Set();
    for (const id of notifData.unreadIds) {
        if (cmdIds.has(id)) notifData.unreadInCommands = true;
        if (chatIds.has(id)) notifData.unreadInChats = true;
    }
}


/**
 * 開始定期檢查通知（每 30 秒）
 */
function startNotificationPolling() {
    let running = false;
    const check = async () => {
        // 分頁在背景時就別去撈整個 comments/likes 集合，省得回到前景時卡一下；
        // running 旗標避免上一輪還沒跑完又重疊發查詢。
        if (!state.isReady || document.hidden || running) return;
        running = true;
        try {
            await checkUnreadNotifications();
        } finally {
            running = false;
        }
    };
    check();
    setInterval(check, 30 * 1000);
    // 從背景切回前景時補查一次，讓紅點即時更新
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) check();
    });
}


// ============================================================
// 🔄 自動刷新（有新內容時，靜默更新目前的清單）
// ============================================================

// 目前畫面提供的「靜默刷新」函式（清單畫面會設定它；其他畫面留著也沒關係，
// 因為函式自己會先檢查對應清單還在不在）
let activeLiveRefresh = null;

/**
 * 現在適不適合自動刷新？在使用者「正在操作」時就先別打擾：
 * 面板沒開 / 分頁在背景 / 正在打字 / 有展開的吐槽 / 有開著的彈窗 / 正在搜尋
 */
function canAutoRefresh() {
    const panel = document.getElementById('baozi-panel');
    if (!panel || !panel.classList.contains('baozi-open')) return false;
    if (document.hidden) return false;

    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return false;
    if (document.querySelector('.baozi-modal-overlay')) return false;
    if (document.querySelector('.baozi-comments[style*="block"]')) return false;

    const search = document.querySelector('.baozi-search');
    if (search && search.value.trim()) return false;

    return true;
}

/** 每 15 秒，若目前畫面可安全刷新就靜默更新 */
function startAutoRefresh() {
    let running = false;
    setInterval(async () => {
        if (running || !state.isReady || !activeLiveRefresh || !canAutoRefresh()) return;
        running = true;
        try {
            await activeLiveRefresh();
        } catch (err) {
            console.warn('[包子同好會] 自動刷新失敗', err);
        } finally {
            running = false;
        }
    }, 15 * 1000);
}




async function getSharedCommands() {
    const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

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
}

async function favoriteCommand(original) {
    // 把別人的指令複製一份到自己的庫
    return await addMyCommand(
        original.title + ' (收藏自 ' + original.ownerNickname + ')',
        original.content,
        original.tags || []
    );
}


// ============================================================
// 💬 分享對話
// ============================================================

async function shareChatSnippet(title, preface, content, maskedRanges = []) {
    const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

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
}

async function updateChatSnippet(id, title, preface, content, maskedRanges = []) {
    const { doc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await updateDoc(doc(state.db, 'chats', id), {
        title,
        preface,
        content,
        maskedRanges,
    });
}

async function deleteChatSnippet(id) {
    const { doc, deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    await deleteDoc(doc(state.db, 'chats', id));
}

async function getSharedChats() {
    const { collection, query, orderBy, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    const q = query(
        collection(state.db, 'chats'),
        orderBy('createdAt', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}


// ============================================================
// 💭 吐槽留言
// ============================================================

async function addComment(targetType, targetId, text) {
    // targetType: 'command' 或 'chat'
    const { collection, addDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

    await addDoc(collection(state.db, 'comments'), {
        targetType,
        targetId,
        text,
        authorId: state.user.uid,
        authorNickname: state.nickname,
        createdAt: serverTimestamp(),
    });
}

async function getComments(targetType, targetId) {
    const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

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
}


// ============================================================
// 👥 成員牆
// ============================================================

async function getMembers() {
    const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const snapshot = await getDocs(collection(state.db, 'members'));
    const items = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    // 依最後上線時間新到舊排
    items.sort((a, b) => (b.lastSeen?.seconds || 0) - (a.lastSeen?.seconds || 0));
    return items;
}

/** 更新自己的「最後上線時間」（開插件時呼叫，讓成員牆的活躍狀態準一點） */
async function touchLastSeen() {
    if (!state.user || !state.db) return;
    try {
        const { doc, setDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
        await setDoc(doc(state.db, 'members', state.user.uid), {
            nickname: state.nickname,
            lastSeen: serverTimestamp(),
        }, { merge: true });
    } catch (err) {
        console.warn('[包子同好會] 更新上線時間失敗', err);
    }
}


// ============================================================
// 🍞 用大包子的帳號進來
// ============================================================
// 不用暗號，暱稱就是大包子認得的名字（米米／一帆）。
// 1.7.0 起完全不連 Firebase：舊指令用 Discord 的 /club 搬家 搬過來，
// 吐槽、分享對話、成員牆之後在大包子上重做（Firebase 上的舊資料沒刪）。
function enterWithBot() {
    const name = bot.me?.name || '包子';
    state.nickname = name;
    state.isReady = true;
    updateExtStatus('✅ 已用大包子登入：' + name, 'ok');
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
    // 按一下＝小包子說話；按兩下＝打開包子（等 0.28 秒看有沒有第二下）
    let tapTimer = null;
    makeDraggable(floatBtn, {
        onClick: () => {
            trace(`float tap ${tapTimer ? 'second → open' : 'first'}`);
            if (tapTimer) {
                clearTimeout(tapTimer);
                tapTimer = null;
                openPanel();
                return;
            }
            tapTimer = setTimeout(() => {
                tapTimer = null;
                pokeMascot({ openPanel, report: () => openReportModal().catch(e => alert(e.message)) })
                    .catch(e => console.warn('[包子同好會] 小包子說話失敗', e));
            }, 280);
        },
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
            <span class="baozi-bell" id="baozi-bell" title="通知">🔔<span class="baozi-bell-dot" id="baozi-bell-dot" hidden></span></span>
            <span class="baozi-dice" id="baozi-dice" title="隨機抽一則">🎲</span>
            <span class="baozi-close" id="baozi-close">✕</span>
        </div>
        <div class="baozi-body" id="baozi-body">
            <div class="baozi-loading">正在蒸包子...</div>
        </div>
        <nav class="baozi-tabbar" id="baozi-tabbar">
            <button data-tab="home"><span>🏠</span>桌面</button>
            <button data-tab="library"><span>📖</span>指令庫</button>
            <button data-tab="chat"><span>💬</span>聊天</button>
            <button data-tab="album"><span>🖼️</span>相簿</button>
            <button data-tab="settings"><span>⚙️</span>設定</button>
        </nav>
    `;
    document.body.appendChild(panel);
    localizeLive(panel);
    mountVersionChip(panel.querySelector('#baozi-panel-header')).catch(e => console.warn('[包子同好會] 版本號', e));
    localizeLive(floatBtn);

    // 恢復之前儲存的面板位置（只在桌面版，手機版每次都置中）
    restorePanelPosition(panel);

    // 讓面板可以透過標題列拖曳
    makePanelDraggable(panel);

    // 事件綁定
    panel.querySelector('#baozi-close').addEventListener('click', closePanel);
    panel.querySelector('#baozi-tabbar').addEventListener('click', (ev) => {
        const tab = ev.target.closest('[data-tab]')?.dataset.tab;
        if (tab) go(tab);
    });
    panel.querySelector('#baozi-dice').addEventListener('click', (ev) => { ev.stopPropagation(); onDice(); });
    panel.querySelector('#baozi-bell').addEventListener('click', (ev) => { ev.stopPropagation(); openNotifications(); });
    overlay.addEventListener('click', closePanel);
}


/**
 * 讓元素可拖曳，同時支援點擊（透過移動距離判斷）
 * 支援滑鼠和觸控，適用於電腦、Android、iOS
 */
function makeDraggable(el, { onClick, saveKey } = {}) {
    let startX, startY, elStartX, elStartY;
    let moved = false;

    // 只在「按下～放開」這段期間才把 move/up 監聽掛到 document，
    // 放開後立即移除，避免一堆全域監聽長期殘留拖累整個頁面的觸控與滾動。
    const onMove = (e) => {
        const point = e.touches ? e.touches[0] : e;
        const dx = point.clientX - startX;
        const dy = point.clientY - startY;

        // 超過 5px 才算拖曳（避免一般點擊被誤判）
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved = true;
        if (!moved) return;

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

        // 拖曳中才擋掉頁面滾動（且事件可取消時才呼叫）
        if (e.cancelable && e.touches) e.preventDefault();
    };

    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        document.removeEventListener('touchcancel', onCancel);
        el.classList.remove('baozi-dragging');

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
    };

    let lastTouch = 0;
    const onDown = (e) => {
        // 手機點一下會先 touchstart、再補一個假的 mousedown —— 不擋掉的話一下會算成兩下
        if (e.touches) lastTouch = Date.now();
        else if (Date.now() - lastTouch < 800) return;
        // 取得觸控或滑鼠的座標
        const point = e.touches ? e.touches[0] : e;
        startX = point.clientX;
        startY = point.clientY;

        const rect = el.getBoundingClientRect();
        elStartX = rect.left;
        elStartY = rect.top;

        moved = false;
        el.classList.add('baozi-dragging');

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onCancel);
    };

    // iOS 有時候不給 touchend、改給 touchcancel：不收掉的話 touchmove 監聽會一直掛著、擋住整頁捲動
    const onCancel = () => {
        trace('float touchcancel');
        moved = true;                 // 當成沒點到
        onUp();
        document.removeEventListener('touchcancel', onCancel);
    };

    // 只在元素本身掛 down 事件；touchstart 用 passive 讓點擊/滾動維持流暢
    el.addEventListener('mousedown', onDown);
    el.addEventListener('touchstart', onDown, { passive: true });
}


/**
 * 讓主面板可以透過標題列拖曳（所有裝置都支援）
 */
function makePanelDraggable(panel) {
    const header = panel.querySelector('#baozi-panel-header');
    if (!header) return;

    let startX, startY, panelStartX, panelStartY;
    let moved = false;

    const onMove = (e) => {
        const point = e.touches ? e.touches[0] : e;
        const dx = point.clientX - startX;
        const dy = point.clientY - startY;

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

        if (e.cancelable && e.touches) e.preventDefault();
    };

    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        header.style.cursor = 'grab';

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
    };

    const onDown = (e) => {
        // 避免點到關閉按鈕時觸發
        if (e.target.closest('#baozi-close, #baozi-dice, #baozi-bell')) return;

        const point = e.touches ? e.touches[0] : e;
        startX = point.clientX;
        startY = point.clientY;

        const rect = panel.getBoundingClientRect();
        panelStartX = rect.left;
        panelStartY = rect.top;

        moved = false;
        header.style.cursor = 'grabbing';

        // 拖曳時切換成固定位置模式（取消 transform 置中）
        panel.classList.add('baozi-dragging');

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    };

    header.style.cursor = 'grab';
    header.addEventListener('mousedown', onDown);
    header.addEventListener('touchstart', onDown, { passive: true });
}


function restoreFloatBtnPosition(el) {
    try {
        const saved = localStorage.getItem('baozi_float_btn_pos');
        if (!saved) return;
        const pos = JSON.parse(saved);
        if (pos.left && pos.top) {
            el.style.left = pos.left;
            el.style.top = pos.top;
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        }
    } catch {}
}


function restorePanelPosition(panel) {
    // 手機版不恢復（每次置中）
    if (isMobileScreen()) return;
    try {
        const saved = localStorage.getItem('baozi_panel_pos');
        if (!saved) return;
        const pos = JSON.parse(saved);
        if (pos.left && pos.top) {
            panel.style.left = pos.left;
            panel.style.top = pos.top;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        }
    } catch {}
}


function isMobileScreen() {
    return window.innerWidth <= 700;
}


/**
 * 把設定區塊插入 SillyTavern 的擴展設定面板
 * 這樣使用者可以從擴展選單找到包子同好會，特別對手機使用者有幫助
 */
let insertRetryCount = 0;
const MAX_INSERT_RETRY = 30;  // 最多重試 30 次（= 30 秒）

function insertExtensionSettings() {
    try {
        // 嘗試多個可能的容器（不同版本 ST 結構略有差異）
        const container = document.getElementById('extensions_settings2')
            || document.getElementById('extensions_settings')
            || document.querySelector('#translation_container')?.parentElement
            || document.querySelector('.extensions_block')
            || document.querySelector('[id*="extensions_settings"]');

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
        localizeLive(settingsBlock);

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
}


/** 更新擴展區塊的狀態顯示 */
function updateExtStatus(text, type = 'info') {
    const el = document.getElementById('baozi-ext-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'baozi-ext-status baozi-ext-status-' + type;
}


/** 打開主面板 */
function openPanel() {
    refreshLocale();
    const panel = document.getElementById('baozi-panel');
    const overlay = document.getElementById('baozi-overlay');
    if (!panel) return;

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
    checkNotifications();
}


/**
 * 用 JS 精確計算面板置中位置（不依賴 CSS transform，iPhone 最穩定的做法）
 */
function centerPanel(panel) {
    // 先清除所有內聯定位
    panel.style.left = '';
    panel.style.top = '';
    panel.style.right = '';
    panel.style.bottom = '';
    panel.style.transform = 'none';

    // 取得視窗可用高度（考慮 iPhone Safari 工具列）
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const panelW = panel.offsetWidth;
    const panelH = panel.offsetHeight;

    // 計算置中位置
    const x = Math.max(0, (vw - panelW) / 2);
    const y = Math.max(10, (vh - panelH) / 2);

    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
}


/** 關閉主面板 */
function closePanel() {
    const panel = document.getElementById('baozi-panel');
    const overlay = document.getElementById('baozi-overlay');
    if (panel) panel.classList.remove('baozi-open');
    if (overlay) overlay.classList.remove('baozi-open');
}


// ============================================================
// 🎨 渲染主要內容（根據是否已驗證顯示不同畫面）
// ============================================================

async function renderMainContent() {
    const body = document.getElementById('baozi-body');
    closeChat();
    setActiveTab('home');
    if (isBotLoggedIn()) {
        enterWithBot();
        renderHomeScreen(body);
        return;
    }
    renderBotLoginScreen(body, {
        onDone: () => { enterWithBot(); renderHomeScreen(body); },
    });
}


/**
 * 首次設定畫面：讓使用者填入 Firebase 設定和圈內暗號
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

                <div class="baozi-setup-section">
                    <div class="baozi-setup-section-title">2️⃣ 圈內暗號</div>
                    <div class="baozi-setup-hint">朋友告訴你的那個秘密暗號</div>
                    <input type="password" id="baozi-setup-secret" placeholder="輸入暗號...">
                </div>

                <button class="baozi-btn-primary baozi-btn-full" id="baozi-save-setup">💾 儲存設定並開始使用</button>
                <div class="baozi-error" id="baozi-setup-error"></div>
            </div>
        </div>
    `;

    document.getElementById('baozi-save-setup').addEventListener('click', async () => {
        const firebaseInput = document.getElementById('baozi-firebase-input').value.trim();
        const secret = document.getElementById('baozi-setup-secret').value.trim();
        const errBox = document.getElementById('baozi-setup-error');

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
    });
}


function renderLoginScreen(container) {
    container.innerHTML = `
        <div class="baozi-login">
            <div class="baozi-welcome">
                <div class="baozi-big-emoji">🥟</div>
                <h2>歡迎來到包子同好會～</h2>
                <p>請輸入圈內暗號才能進來喔</p>
            </div>
            <div class="baozi-form">
                <label>你的暱稱</label>
                <input type="text" id="baozi-nickname-input" placeholder="例如：包子" value="${escapeHtml(localStorage.getItem('baozi_nickname') || '')}">
                <label>圈內暗號</label>
                <input type="password" id="baozi-secret-input" placeholder="只有圈內人知道的那個～">
                <button class="baozi-btn-primary" id="baozi-login-btn">進入同好會 ✨</button>
                <div class="baozi-error" id="baozi-login-error"></div>
            </div>
        </div>
    `;

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
}


// ---------- 🌈 主題 ----------
const THEME_KEY = 'baozi_theme';

function currentTheme() {
    try { return localStorage.getItem(THEME_KEY) || 'baozi'; } catch { return 'baozi'; }
}

/** baozi＝包子奶油色；st＝跟隨酒館主題。存在這支手機上（每支手機的酒館主題本來就不同）。 */
function applyTheme(theme = currentTheme()) {
    document.body.classList.toggle('baozi-theme-st', theme === 'st');
}


// ---------- 分頁列 + 桌面 ----------
function setActiveTab(tab) {
    document.querySelectorAll('#baozi-tabbar [data-tab]').forEach(b =>
        b.classList.toggle('on', b.dataset.tab === tab));
    const bar = document.getElementById('baozi-tabbar');
    if (bar) bar.hidden = !isBotLoggedIn();
}

/** 分頁列和桌面上的捷徑都走這裡。 */
function go(tab, opts = {}) {
    const body = document.getElementById('baozi-body');
    if (!isBotLoggedIn()) { renderMainContent(); return; }
    closeChat();
    closeGame();
    body.scrollTop = 0;
    switch (tab) {
        case 'home': renderHomeScreen(body); break;
        case 'library': openLibrary(body, { filter: 'all', ...opts }); break;
        case 'chat':
            setActiveTab('chat');
            renderChatScreen(body, { back: () => renderHomeScreen(body) });
            break;
        case 'album':
            setActiveTab('album');
            renderAlbumScreen(body, { back: () => renderHomeScreen(body), closePanel });
            break;
        case 'settings': setActiveTab('settings'); renderSettingsScreen(body); break;
        case 'game':
            setActiveTab('');
            renderGameScreen(body, { back: () => renderHomeScreen(body) });
            break;
        case 'inbox':
            setActiveTab('');
            renderInboxScreen(body, { back: () => renderHomeScreen(body) });
            break;
        case 'favs':
            setActiveTab('');
            renderFavsScreen(body, { back: () => renderHomeScreen(body), copy: copyToClipboard });
            break;
    }
}

/** 克總回信了：小包子說一句（一次只說一句，有說就不打招呼）。 */
async function announceInbox() {
    const n = await inboxUnread();
    if (!n) return false;
    const bubble = showBubble(`
        <div class="xbz-say">克總回你了～（${n} 則）</div>
        <div class="baozi-toast-row">
            <button class="baozi-btn-small baozi-on" data-a="go">📬 去看看</button>
            <button class="baozi-btn-small" data-a="bye">等一下</button>
        </div>`);
    bubble.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (a === 'bye') closeBubble();
        if (a === 'go') { closeBubble(); openPanel(); go('inbox'); }
    });
    return true;
}

function renderHomeScreen(container) {
    setActiveTab('home');
    renderDesktop(container, {
        go,
        openCommand: (cmd) => openLibrary(container, { pinned: cmd, pinLabel: cmd.rec ? '💌 力推' : '☀️ 今日推薦' }),
        dice: onDice,
        shot: () => { closePanel(); enterSelectMode(); },
        notifications: openNotifications,
    });
}


// ---------- 🔔 通知（標題列上那顆 + 浮動按鈕的紅點） ----------
const NOTIF_EVERY_MS = 2 * 60 * 1000;

function setUnread(n) {
    const dot = document.getElementById('baozi-bell-dot');
    if (dot) { dot.hidden = !n; dot.textContent = n > 9 ? '9+' : String(n || ''); }
    document.getElementById('baozi-float-btn')?.classList.toggle('baozi-has-notif', !!n);
}

async function checkNotifications() {
    if (!isBotLoggedIn() || document.hidden) return;
    try {
        setUnread((await fetchNotifications()).unread);
    } catch { /* 連不上就下次再看 */ }
}

function startNotifCheck() {
    checkNotifications();
    setInterval(checkNotifications, NOTIF_EVERY_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNotifications(); });
}

function openNotifications() {
    setActiveTab('');
    const panel = document.getElementById('baozi-panel');
    if (!panel.classList.contains('baozi-open')) openPanel();
    if (!isBotLoggedIn()) return;
    closeChat();
    const body = document.getElementById('baozi-body');
    renderNotificationsScreen(body, {
        back: () => renderHomeScreen(body),
        onRead: checkNotifications,
        openCommand: (cmd, label) => openLibrary(body, { pinned: cmd, pinLabel: label }),
    });
}


// ---------- 🎲 骰子（標題列上那顆） ----------
async function onDice() {
    const panel = document.getElementById('baozi-panel');
    if (!panel.classList.contains('baozi-open')) openPanel();
    const body = document.getElementById('baozi-body');
    if (!isBotLoggedIn()) { renderMainContent(); return; }
    closeChat();
    try {
        const res = await rollDice();
        if (!res.command) { alert(t(DICE_EMPTY)); return; }
        openLibrary(body, { pinned: res.command });
    } catch (err) {
        alert(t(err.message));
    }
}


// ---------- 大包子指令庫 ----------
function openLibrary(container, opts = {}) {
    setActiveTab('library');
    const show = () => renderLibraryScreen(container, {
        back: () => renderHomeScreen(container),
        copy: copyToClipboard,
        closePanel,
    }, opts);
    if (isBotLoggedIn()) {
        show();
        refreshMe().catch(() => { /* 舊的「我是誰」也能用，下次再更新 */ });
    } else {
        renderBotLoginScreen(container, { onDone: show });
    }
}


// ---------- 通知中心 ----------
function renderNotificationCenter(container) {
    const items = notifData.detailItems || [];
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>🔔 通知中心</h3>
            </div>
            ${items.length === 0
                ? '<div class="baozi-empty">🎉 目前沒有新通知～有人對你的分享按讚或吐槽時會出現在這</div>'
                : `<div class="baozi-list">
                    ${items.map(it => `
                        <div class="baozi-notif-item" data-section="${it.section}" data-id="${it.targetId}">
                            <span class="baozi-notif-icon">${it.kind === 'like' ? it.extra : '💭'}</span>
                            <div class="baozi-notif-body">
                                <div><b>${escapeHtml(it.who)}</b> ${it.kind === 'like' ? '對' : '吐槽了'}
                                    「${escapeHtml(it.title)}」${it.kind === 'like' ? ' 有反應' : ''}</div>
                                ${it.kind === 'comment' && it.extra ? `<div class="baozi-notif-text">${escapeHtml(it.extra)}</div>` : ''}
                                <div class="baozi-notif-time">${relativeTime(it.seconds)}・在${it.section === 'command' ? '共享空間' : '分享的對話'}</div>
                            </div>
                        </div>
                    `).join('')}
                   </div>
                   <button class="baozi-btn-small baozi-btn-full" id="baozi-mark-read" style="margin-top:12px;">✓ 全部標為已讀</button>`
            }
        </div>
    `;

    document.getElementById('baozi-back').addEventListener('click', () => renderHomeScreen(container));

    // 點一則通知 → 跳到對應板塊
    container.querySelectorAll('.baozi-notif-item').forEach(el => {
        el.addEventListener('click', () => {
            const section = el.dataset.section;
            if (section === 'command') renderSharedSpaceScreen(container);
            else renderSharedChatsScreen(container);
        });
    });

    document.getElementById('baozi-mark-read')?.addEventListener('click', () => {
        markNotificationsRead();
        notifData.detailItems = [];
        renderNotificationCenter(container);
    });
}


// ---------- 成員牆 ----------
async function renderMembersScreen(container) {
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>👥 成員牆</h3>
            </div>
            <div class="baozi-list" id="baozi-members-list">
                <div class="baozi-loading">載入中...</div>
            </div>
        </div>
    `;
    document.getElementById('baozi-back').addEventListener('click', () => renderHomeScreen(container));

    const list = document.getElementById('baozi-members-list');
    try {
        const members = await getMembers();
        if (members.length === 0) {
            list.innerHTML = '<div class="baozi-empty">👥 還沒有成員資料～</div>';
            return;
        }
        list.innerHTML = members.map(m => {
            const isMe = m.id === state.user.uid;
            const secs = m.lastSeen?.seconds || 0;
            const online = secs && (Date.now() / 1000 - secs) < 300;  // 5 分鐘內算在線
            return `
                <div class="baozi-member-card">
                    <span class="baozi-member-avatar">${online ? '🟢' : '🥟'}</span>
                    <div class="baozi-member-info">
                        <div class="baozi-member-name">${escapeHtml(m.nickname || '匿名')}${isMe ? ' <span class="baozi-tag-mine">我</span>' : ''}</div>
                        <div class="baozi-member-seen">${secs ? (online ? '剛剛還在線 🟢' : '最後上線 ' + relativeTime(secs)) : '還沒上線過'}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        list.innerHTML = '<div class="baozi-error">載入失敗：' + err.message + '</div>';
    }
}


// ---------- 隨機抽一篇（只從共享空間的指令抽） ----------
async function doRandomPick() {
    try {
        const commands = await getSharedCommands();
        if (commands.length === 0) {
            alert('共享空間還沒有指令可以抽～先去分享一個吧！');
            return;
        }
        const pick = commands[Math.floor(Math.random() * commands.length)];
        showFullTextModal('🎲 ' + (pick.title || '(無標題)'), pick.content);
    } catch (err) {
        alert('抽取失敗：' + err.message);
    }
}


// ---------- 我的指令庫畫面 ----------
async function renderMyCommandsScreen(container) {
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>📚 我的指令庫</h3>
            </div>
            <button class="baozi-btn-primary baozi-btn-full" id="baozi-add-cmd">+ 新增指令</button>
            <div class="baozi-toolbar" id="baozi-mycmd-toolbar" style="display:none;">
                <input type="text" class="baozi-search" id="baozi-mycmd-search" placeholder="🔍 搜尋標題 / 內容 / 標籤...">
            </div>
            <div class="baozi-list" id="baozi-cmd-list">
                <div class="baozi-loading">載入中...</div>
            </div>
        </div>
    `;

    document.getElementById('baozi-back').addEventListener('click', () => renderHomeScreen(container));
    document.getElementById('baozi-add-cmd').addEventListener('click', () => renderAddCommandScreen(container));

    const list = document.getElementById('baozi-cmd-list');
    try {
        const commands = await getMyCommands();
        if (commands.length === 0) {
            list.innerHTML = '<div class="baozi-empty">🥟 還沒有指令～點上面新增一個吧！</div>';
            return;
        }

        let searchText = '';
        document.getElementById('baozi-mycmd-toolbar').style.display = '';

        function renderList() {
            let items = commands;
            if (searchText) {
                const kw = searchText.toLowerCase();
                items = commands.filter(c =>
                    (c.title || '').toLowerCase().includes(kw) ||
                    (c.content || '').toLowerCase().includes(kw) ||
                    (c.tags || []).some(t => t.toLowerCase().includes(kw))
                );
            }
            if (items.length === 0) {
                list.innerHTML = '<div class="baozi-empty">🔍 沒有符合的指令～</div>';
                return;
            }
            list.innerHTML = items.map(cmd => {
                const tagsHtml = (cmd.tags || []).length
                    ? `<div class="baozi-card-tags">${cmd.tags.map(t => `<span class="baozi-card-tag">#${escapeHtml(t)}</span>`).join('')}</div>`
                    : '';
                return `
                <div class="baozi-card">
                    <div class="baozi-card-title">${escapeHtml(cmd.title)}</div>
                    <div class="baozi-card-content">${escapeHtml(cmd.content).substring(0, 120)}${cmd.content.length > 120 ? '...' : ''}</div>
                    ${tagsHtml}
                    <div class="baozi-card-actions">
                        ${cmd.shared
                            ? '<span class="baozi-tag-shared">✓ 已分享</span>'
                            : `<button class="baozi-btn-small" data-action="share" data-id="${cmd.id}">📤 分享</button>`}
                        <button class="baozi-btn-small" data-action="view" data-id="${cmd.id}">👀 看全文</button>
                        <button class="baozi-btn-small" data-action="copy" data-id="${cmd.id}">📋 複製</button>
                        <button class="baozi-btn-small" data-action="edit" data-id="${cmd.id}">✏️ 修改</button>
                        <button class="baozi-btn-small baozi-btn-danger" data-action="delete" data-id="${cmd.id}">🗑️</button>
                    </div>
                </div>
                `;
            }).join('');

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
                    } else if (action === 'edit') {
                        renderAddCommandScreen(container, cmd);
                    } else if (action === 'delete') {
                        if (confirm('確定要刪除「' + cmd.title + '」嗎？')) {
                            await deleteCommand(id);
                            renderMyCommandsScreen(container);
                        }
                    }
                });
            });
        }

        let searchRaf = null;
        document.getElementById('baozi-mycmd-search').addEventListener('input', (e) => {
            searchText = e.target.value.trim();
            if (searchRaf) return;
            searchRaf = requestAnimationFrame(() => { searchRaf = null; renderList(); });
        });

        renderList();
    } catch (err) {
        list.innerHTML = '<div class="baozi-error">載入失敗：' + err.message + '</div>';
    }
}


function renderAddCommandScreen(container, editingCommand = null) {
    const isEditing = !!editingCommand;
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 取消</button>
                <h3>${isEditing ? '✏️ 修改指令' : '+ 新增指令'}</h3>
            </div>
            <div class="baozi-form">
                <label>標題</label>
                <input type="text" id="baozi-new-title" placeholder="例如：雨夜咖啡廳場景" value="${escapeHtml(editingCommand?.title || '')}">
                <label>內容</label>
                <textarea id="baozi-new-content" rows="8" placeholder="貼上你的指令、劇本、prompt...">${escapeHtml(editingCommand?.content || '')}</textarea>
                <label>標籤（選填，用逗號分隔）</label>
                <input type="text" id="baozi-new-tags" placeholder="例如：雨天, 咖啡廳, 甜" value="${escapeHtml((editingCommand?.tags || []).join(', '))}">
                <button class="baozi-btn-primary baozi-btn-full" id="baozi-save-cmd">💾 ${isEditing ? '儲存修改' : '儲存'}</button>
                <div class="baozi-error" id="baozi-save-error"></div>
            </div>
        </div>
    `;

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
            if (isEditing) {
                await updateCommand(editingCommand.id, title, content, tags);
            } else {
                await addMyCommand(title, content, tags);
            }
            renderMyCommandsScreen(container);
        } catch (err) {
            errBox.textContent = '儲存失敗：' + err.message;
        }
    });
}


// ---------- 共享空間畫面 ----------
async function renderSharedSpaceScreen(container) {
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>🏠 共享空間</h3>
            </div>
            <div class="baozi-toolbar" id="baozi-shared-toolbar" style="display:none;">
                <input type="text" class="baozi-search" id="baozi-shared-search" placeholder="🔍 搜尋標題 / 內容 / 標籤...">
                <div class="baozi-tagbar" id="baozi-shared-tagbar"></div>
                <button class="baozi-btn-small baozi-sort-btn" id="baozi-shared-sort">🔀 最新</button>
            </div>
            <div class="baozi-list" id="baozi-shared-list">
                <div class="baozi-loading">載入中...</div>
            </div>
        </div>
    `;

    document.getElementById('baozi-back').addEventListener('click', () => renderHomeScreen(container));

    const list = document.getElementById('baozi-shared-list');
    try {
        let commands = await getSharedCommands();
        if (commands.length === 0) {
            list.innerHTML = '<div class="baozi-empty">🏠 還沒有人分享指令～趕快去分享一個吧！</div>';
            // 就算目前是空的，也讓自動刷新能在別人分享後把清單補上
            activeLiveRefresh = () => renderSharedSpaceScreen(container);
            return;
        }

        // 取得每個指令的表情反應資訊
        let reactInfo = await getReactionsInfo('command', commands.map(c => c.id));

        // ---- 篩選 / 排序狀態 ----
        let searchText = '';
        let activeTag = null;
        let sortMode = 'new';  // 'new' | 'hot'

        // 蒐集所有標籤（去重）
        const allTags = [...new Set(commands.flatMap(c => c.tags || []))];

        // 工具列（有資料才顯示）
        const toolbar = document.getElementById('baozi-shared-toolbar');
        toolbar.style.display = '';
        const tagbar = document.getElementById('baozi-shared-tagbar');
        tagbar.innerHTML = allTags.map(t =>
            `<button class="baozi-tag-chip" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
        ).join('');
        const sortBtn = document.getElementById('baozi-shared-sort');

        function renderList() {
            let items = commands.slice();

            // 搜尋
            if (searchText) {
                const kw = searchText.toLowerCase();
                items = items.filter(c =>
                    (c.title || '').toLowerCase().includes(kw) ||
                    (c.content || '').toLowerCase().includes(kw) ||
                    (c.tags || []).some(t => t.toLowerCase().includes(kw))
                );
            }
            // 標籤篩選
            if (activeTag) {
                items = items.filter(c => (c.tags || []).includes(activeTag));
            }
            // 排序
            if (sortMode === 'hot') {
                items.sort((a, b) => (reactInfo[b.id]?.total || 0) - (reactInfo[a.id]?.total || 0));
            } else {
                items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            }

            if (items.length === 0) {
                list.innerHTML = '<div class="baozi-empty">🔍 沒有符合的指令～換個關鍵字或標籤試試</div>';
                return;
            }

            list.innerHTML = items.map(cmd => {
                const isMine = cmd.ownerId === state.user.uid;
                const hasUnread = notifData.unreadIds.has(cmd.id);
                const tagsHtml = (cmd.tags || []).length
                    ? `<div class="baozi-card-tags">${cmd.tags.map(t => `<span class="baozi-card-tag">#${escapeHtml(t)}</span>`).join('')}</div>`
                    : '';
                return `
                <div class="baozi-card baozi-card-compact ${hasUnread ? 'baozi-card-unread' : ''}">
                    <div class="baozi-card-owner">
                        ${escapeHtml(cmd.ownerNickname || '匿名')} 分享了${isMine ? ' <span class="baozi-tag-mine">我</span>' : ''}
                        ${hasUnread ? '<span class="baozi-card-dot">🔴</span>' : ''}
                    </div>
                    <div class="baozi-card-title">${escapeHtml(cmd.title)}</div>
                    ${tagsHtml}
                    ${reactionBarHtml(cmd.id, reactInfo[cmd.id])}
                    <div class="baozi-card-actions">
                        <button class="baozi-btn-small" data-action="view" data-id="${cmd.id}">👀 看全文</button>
                        <button class="baozi-btn-small" data-action="copy" data-id="${cmd.id}">📋 複製</button>
                        ${!isMine
                            ? `<button class="baozi-btn-small" data-action="favorite" data-id="${cmd.id}">⭐ 收藏</button>`
                            : ''}
                        <button class="baozi-btn-small" data-action="comment" data-id="${cmd.id}">💭 吐槽</button>
                    </div>
                    <div class="baozi-comments" id="baozi-comments-${cmd.id}" style="display:none;"></div>
                </div>
                `;
            }).join('');

            bindCards();
        }

        function bindCards() {
            list.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const action = btn.dataset.action;
                    const id = btn.dataset.id;
                    const cmd = commands.find(c => c.id === id);

                    // 任何互動都把這條從未讀清掉
                    clearCardUnread(id, btn.closest('.baozi-card'));

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
                    } else if (action === 'react') {
                        const emoji = btn.dataset.emoji;
                        const bar = btn.closest('.baozi-reactions');
                        btn.disabled = true;
                        try {
                            const mine = await setReaction('command', id, emoji);
                            reactInfo[id] = applyLocalReaction(reactInfo[id] || { counts: {}, mine: null, total: 0 }, mine);
                            refreshReactionBar(bar, reactInfo[id]);
                        } catch (err) {
                            console.error('[包子同好會] 表情失敗', err);
                        } finally {
                            btn.disabled = false;
                        }
                    }
                });
            });
        }

        // 綁定工具列
        let searchRaf = null;
        document.getElementById('baozi-shared-search').addEventListener('input', (e) => {
            searchText = e.target.value.trim();
            if (searchRaf) return;
            searchRaf = requestAnimationFrame(() => { searchRaf = null; renderList(); });
        });
        tagbar.querySelectorAll('.baozi-tag-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const t = chip.dataset.tag;
                activeTag = (activeTag === t) ? null : t;
                tagbar.querySelectorAll('.baozi-tag-chip').forEach(c =>
                    c.classList.toggle('active', c.dataset.tag === activeTag));
                renderList();
            });
        });
        sortBtn.addEventListener('click', () => {
            sortMode = (sortMode === 'new') ? 'hot' : 'new';
            sortBtn.textContent = sortMode === 'hot' ? '🔥 最多反應' : '🔀 最新';
            renderList();
        });

        // 靜默刷新：重抓資料後只重建清單（保留搜尋/標籤/排序、不閃「載入中」）
        activeLiveRefresh = async () => {
            if (!document.getElementById('baozi-shared-list')) return;  // 已離開此畫面
            const fresh = await getSharedCommands();
            commands = fresh;
            reactInfo = await getReactionsInfo('command', fresh.map(c => c.id));
            const body = document.getElementById('baozi-body');
            const sc = body ? body.scrollTop : 0;
            renderList();
            if (body) body.scrollTop = sc;
        };

        renderList();
    } catch (err) {
        list.innerHTML = '<div class="baozi-error">載入失敗：' + err.message + '</div>';
    }
}


// ---------- 分享對話畫面 ----------
async function renderSharedChatsScreen(container) {
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>💬 分享的對話</h3>
            </div>
            <button class="baozi-btn-primary baozi-btn-full" id="baozi-new-chat">+ 分享一段對話</button>
            <div class="baozi-toolbar" id="baozi-chat-toolbar" style="display:none;">
                <input type="text" class="baozi-search" id="baozi-chat-search" placeholder="🔍 搜尋標題 / 前言 / 內容...">
            </div>
            <div class="baozi-list" id="baozi-chat-list">
                <div class="baozi-loading">載入中...</div>
            </div>
        </div>
    `;

    document.getElementById('baozi-back').addEventListener('click', () => renderHomeScreen(container));
    document.getElementById('baozi-new-chat').addEventListener('click', () => renderShareChatScreen(container));

    const list = document.getElementById('baozi-chat-list');
    try {
        let chats = await getSharedChats();
        if (chats.length === 0) {
            list.innerHTML = '<div class="baozi-empty">💬 還沒有分享的對話～</div>';
            activeLiveRefresh = () => renderSharedChatsScreen(container);
            return;
        }

        // 取得每個對話的表情反應資訊
        let reactInfo = await getReactionsInfo('chat', chats.map(c => c.id));

        let searchText = '';
        document.getElementById('baozi-chat-toolbar').style.display = '';

        function renderList() {
            let items = chats.slice();
            if (searchText) {
                const kw = searchText.toLowerCase();
                items = items.filter(c =>
                    (c.title || '').toLowerCase().includes(kw) ||
                    (c.preface || '').toLowerCase().includes(kw) ||
                    (c.content || '').toLowerCase().includes(kw)
                );
            }
            if (items.length === 0) {
                list.innerHTML = '<div class="baozi-empty">🔍 沒有符合的對話～換個關鍵字試試</div>';
                return;
            }

            list.innerHTML = items.map(chat => {
                const isMine = chat.ownerId === state.user.uid;
                const hasUnread = notifData.unreadIds.has(chat.id);
                return `
                <div class="baozi-card baozi-card-compact ${hasUnread ? 'baozi-card-unread' : ''}" data-chat-id="${chat.id}">
                    <div class="baozi-card-owner">
                        ${escapeHtml(chat.ownerNickname || '匿名')}${isMine ? ' <span class="baozi-tag-mine">我</span>' : ''}
                        ${hasUnread ? '<span class="baozi-card-dot">🔴</span>' : ''}
                    </div>
                    <div class="baozi-card-title">${escapeHtml(chat.title || '(無標題)')}</div>
                    ${chat.preface ? `<div class="baozi-card-preface">${escapeHtml(chat.preface)}</div>` : ''}
                    ${reactionBarHtml(chat.id, reactInfo[chat.id])}
                    <div class="baozi-card-actions">
                        <button class="baozi-btn-small" data-action="view" data-id="${chat.id}">👀 看全文</button>
                        <button class="baozi-btn-small" data-action="comment" data-id="${chat.id}">💭 吐槽</button>
                        ${isMine ? `
                            <button class="baozi-btn-small" data-action="edit" data-id="${chat.id}">✏️ 修改</button>
                            <button class="baozi-btn-small baozi-btn-danger" data-action="delete" data-id="${chat.id}">🗑️</button>
                        ` : ''}
                    </div>
                    <div class="baozi-comments" id="baozi-comments-${chat.id}" style="display:none;"></div>
                </div>
                `;
            }).join('');

            bindCards();
        }

        function bindCards() {
            list.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const action = btn.dataset.action;
                    const id = btn.dataset.id;
                    const chat = chats.find(c => c.id === id);

                    // 任何互動都把這條從未讀清掉
                    clearCardUnread(id, btn.closest('.baozi-card'));

                    if (action === 'comment') {
                        toggleCommentPanel('chat', id);
                    } else if (action === 'view') {
                        showFullChatModal(chat);
                    } else if (action === 'edit') {
                        renderShareChatScreen(container, chat);
                    } else if (action === 'delete') {
                        if (confirm('確定要刪除這個分享嗎？（其他人也會看不到）')) {
                            try {
                                await deleteChatSnippet(id);
                                renderSharedChatsScreen(container);
                            } catch (err) {
                                alert('刪除失敗：' + err.message);
                            }
                        }
                    } else if (action === 'react') {
                        const emoji = btn.dataset.emoji;
                        const bar = btn.closest('.baozi-reactions');
                        btn.disabled = true;
                        try {
                            const mine = await setReaction('chat', id, emoji);
                            reactInfo[id] = applyLocalReaction(reactInfo[id] || { counts: {}, mine: null, total: 0 }, mine);
                            refreshReactionBar(bar, reactInfo[id]);
                        } catch (err) {
                            console.error('[包子同好會] 表情失敗', err);
                        } finally {
                            btn.disabled = false;
                        }
                    }
                });
            });
        }

        let searchRaf = null;
        document.getElementById('baozi-chat-search').addEventListener('input', (e) => {
            searchText = e.target.value.trim();
            if (searchRaf) return;
            searchRaf = requestAnimationFrame(() => { searchRaf = null; renderList(); });
        });

        // 靜默刷新：重抓資料後只重建清單（保留搜尋、不閃「載入中」）
        activeLiveRefresh = async () => {
            if (!document.getElementById('baozi-chat-list')) return;  // 已離開此畫面
            const fresh = await getSharedChats();
            chats = fresh;
            reactInfo = await getReactionsInfo('chat', fresh.map(c => c.id));
            const body = document.getElementById('baozi-body');
            const sc = body ? body.scrollTop : 0;
            renderList();
            if (body) body.scrollTop = sc;
        };

        renderList();
    } catch (err) {
        list.innerHTML = '<div class="baozi-error">載入失敗：' + err.message + '</div>';
    }
}


/**
 * 分享/編輯對話畫面
 * @param {HTMLElement} container
 * @param {Object|null} editingChat - 如果有值就是編輯模式
 */
function renderShareChatScreen(container, editingChat = null) {
    const isEditing = !!editingChat;

    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 取消</button>
                <h3>${isEditing ? '✏️ 修改分享' : '💬 分享一段對話'}</h3>
            </div>
            <div class="baozi-form">
                <label>標題</label>
                <input type="text" id="baozi-chat-title" placeholder="例如：今天跟角色的離譜對話" value="${escapeHtml(editingChat?.title || '')}">

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
    `;

    // 深拷貝，避免 mergeMaskRanges 直接改到原始 editingChat 的範圍物件
    let maskedRanges = editingChat?.maskedRanges ? editingChat.maskedRanges.map(r => ({ ...r })) : [];

    const contentArea = document.getElementById('baozi-chat-content');
    const maskList = document.getElementById('baozi-mask-list');
    const previewBox = document.getElementById('baozi-preview-box');

    function updatePreview() {
        const content = contentArea.value;
        previewBox.innerHTML = renderMaskedText(content, maskedRanges);
        maskList.innerHTML = maskedRanges.map((r, i) =>
            `<span class="baozi-mask-chip">第 ${r.start}-${r.end} 字 <span class="baozi-mask-remove" data-idx="${i}">✕</span></span>`
        ).join('');
        maskList.querySelectorAll('.baozi-mask-remove').forEach(el => {
            el.addEventListener('click', () => {
                maskedRanges.splice(parseInt(el.dataset.idx), 1);
                updatePreview();
            });
        });
    }

    // 打字時不必每個按鍵都重繪整段預覽（長文會卡），用 rAF 合併成每幀最多一次
    let previewRaf = null;
    const schedulePreview = () => {
        if (previewRaf) return;
        previewRaf = requestAnimationFrame(() => {
            previewRaf = null;
            updatePreview();
        });
    };
    contentArea.addEventListener('input', schedulePreview);
    updatePreview();

    // 新增模式才顯示訊息選擇器
    if (!isEditing) {
        renderMessagePicker();
        const insertBtn = document.getElementById('baozi-insert-selected');
        if (insertBtn) {
            insertBtn.addEventListener('click', () => {
                const picker = document.getElementById('baozi-msg-picker');
                const selected = picker.querySelectorAll('input[type="checkbox"]:checked');
                if (selected.length === 0) {
                    alert('請至少勾選一則訊息～');
                    return;
                }
                const texts = Array.from(selected).map(cb => cb.dataset.msgText).filter(Boolean);
                const joined = texts.join('\n\n');
                // 追加或替換到內容區
                if (contentArea.value.trim()) {
                    contentArea.value = contentArea.value + '\n\n' + joined;
                } else {
                    contentArea.value = joined;
                }
                updatePreview();
                // 清除勾選
                selected.forEach(cb => cb.checked = false);
            });
        }
    }

    document.getElementById('baozi-add-mask').addEventListener('click', () => {
        const start = contentArea.selectionStart;
        const end = contentArea.selectionEnd;
        if (start === end) {
            alert('請先選取一段文字（用手指或滑鼠選取要打碼的字）');
            return;
        }
        maskedRanges.push({ start, end });
        maskedRanges = mergeMaskRanges(maskedRanges);
        updatePreview();
    });

    document.getElementById('baozi-clear-mask').addEventListener('click', () => {
        maskedRanges = [];
        updatePreview();
    });

    document.getElementById('baozi-back').addEventListener('click', () => renderSharedChatsScreen(container));

    document.getElementById('baozi-send-chat').addEventListener('click', async () => {
        const title = document.getElementById('baozi-chat-title').value.trim();
        const preface = document.getElementById('baozi-chat-preface').value.trim();
        const content = contentArea.value.trim();
        const errBox = document.getElementById('baozi-chat-error');

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
    });
}


/**
 * 渲染當前 SillyTavern 對話的訊息清單（可勾選）
 */
function renderMessagePicker() {
    const picker = document.getElementById('baozi-msg-picker');
    if (!picker) return;

    try {
        const messages = document.querySelectorAll('#chat .mes');
        if (!messages.length) {
            picker.innerHTML = '<div class="baozi-empty-small">目前沒有對話記錄～可以直接在下方輸入</div>';
            return;
        }

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
    } catch (err) {
        picker.innerHTML = '<div class="baozi-empty-small">無法讀取對話：' + err.message + '</div>';
    }
}


// ---------- 設定畫面 ----------
function renderSettingsScreen(container) {
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>⚙️ 設定</h3>
            </div>
            <div class="baozi-form">
                <div class="baozi-setup-section-title">🍞 大包子</div>
                <div class="baozi-info">
                    <div><b>已登入：</b>${escapeHtml(bot.me?.name || '')}</div>
                    <div style="font-size:11px; opacity:.6; word-break:break-all;">${escapeHtml(bot.url)}</div>
                </div>
                <hr style="margin: 18px 0; border-color: rgba(0,0,0,0.1);">
                <div class="baozi-setup-section-title">🥟 小包子</div>
                <div class="baozi-dice-pools">
                    <button class="baozi-tag-chip baozi-toggle-chip ${greetingEnabled() ? 'active' : ''}" id="xbz-greet-toggle">${greetingEnabled() ? '✓' : '○'} 每天第一次打開時出來打招呼</button>
                    <button class="baozi-tag-chip" id="xbz-call">📣 現在叫他出來</button>
                </div>
                <hr style="margin: 18px 0; border-color: rgba(0,0,0,0.1);">
                <div class="baozi-setup-section-title">🌈 主題</div>
                <div class="baozi-dice-pools" id="baozi-theme-pick">
                    <button class="baozi-tag-chip ${currentTheme() === 'baozi' ? 'active' : ''}" data-theme="baozi">🥟 包子奶油</button>
                    <button class="baozi-tag-chip ${currentTheme() === 'st' ? 'active' : ''}" data-theme="st">🍷 跟隨酒館</button>
                </div>
                <hr style="margin: 18px 0; border-color: rgba(0,0,0,0.1);">
                <div class="baozi-setup-section-title">🎲 骰子</div>
                <div id="baozi-dice-settings"></div>
                <hr style="margin: 18px 0; border-color: rgba(0,0,0,0.1);">
                <div class="baozi-setup-section-title">✨ 排版模型（自訂 API）</div>
                <div id="baozi-ai-settings"></div>
                <hr style="margin: 18px 0; border-color: rgba(0,0,0,0.1);">
                <div class="baozi-setup-section-title">📮 報告克總</div>
                <button class="baozi-tag-chip" id="baozi-open-inbox" style="margin-bottom:8px;">📬 看信箱（克總的回覆）</button>
                <div id="baozi-report"></div>
                <hr style="margin: 18px 0; border-color: rgba(0,0,0,0.1);">
                <div class="baozi-setup-hint" style="margin-top:10px;">
                    舊的指令要搬過來：到 Discord 打 <b>/club 搬家</b>，大包子會自己去舊的 Firebase 讀，先給你看預覽。
                </div>
                <button class="baozi-btn-danger baozi-btn-full" id="baozi-bot-logout" style="margin-top:16px;">登出</button>
            </div>
        </div>
    `;

    document.getElementById('baozi-back').addEventListener('click', () => renderHomeScreen(container));
    renderDiceSettings(document.getElementById('baozi-dice-settings'));
    document.getElementById('xbz-greet-toggle').addEventListener('click', (ev) => {
        const on = !greetingEnabled();
        setGreetingEnabled(on);
        ev.currentTarget.classList.toggle('active', on);
        ev.currentTarget.textContent = (on ? '✓' : '○') + ' 每天第一次打開時出來打招呼';
    });
    document.getElementById('xbz-call').addEventListener('click', () => {
        closePanel();
        greetIfNeeded({ force: true });
    });
    document.getElementById('baozi-theme-pick').addEventListener('click', (ev) => {
        const chip = ev.target.closest('[data-theme]');
        if (!chip) return;
        try { localStorage.setItem(THEME_KEY, chip.dataset.theme); } catch { /* 存不了 */ }
        applyTheme(chip.dataset.theme);
        document.querySelectorAll('#baozi-theme-pick [data-theme]').forEach(c => c.classList.toggle('active', c === chip));
    });
    renderAiSettings(document.getElementById('baozi-ai-settings'));
    renderReport(document.getElementById('baozi-report'));
    document.getElementById('baozi-open-inbox').addEventListener('click', () => go('inbox'));
    document.getElementById('baozi-bot-logout').addEventListener('click', () => {
        if (confirm(t('登出？之後要到 Discord 打 /club 登入 重新拿碼。'))) {
            botLogout();
            state.isReady = false;
            renderMainContent();
        }
    });
}


// ============================================================
// 💭 吐槽面板（可展開收合）
// ============================================================

async function toggleCommentPanel(targetType, targetId) {
    const panel = document.getElementById('baozi-comments-' + targetId);
    if (!panel) return;

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
}


// ============================================================
// 🛠️ 工具函式
// ============================================================

/**
 * 純 JS SHA-256（回傳小寫 hex 字串）
 * 不依賴 crypto.subtle，所以區網 http（非 secure context）也能用。
 * 只拿來把暗號雜湊後比對，不是拿來加密敏感資料。
 */
function sha256Hex(str) {
    const msg = new TextEncoder().encode(str);  // UTF-8 位元組
    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    const l = msg.length;
    const bitLen = l * 8;
    const withOne = l + 1;
    const total = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
    const buf = new Uint8Array(total);
    buf.set(msg, 0);
    buf[l] = 0x80;
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    buf[total - 8] = (hi >>> 24) & 0xff; buf[total - 7] = (hi >>> 16) & 0xff;
    buf[total - 6] = (hi >>> 8) & 0xff;  buf[total - 5] = hi & 0xff;
    buf[total - 4] = (lo >>> 24) & 0xff; buf[total - 3] = (lo >>> 16) & 0xff;
    buf[total - 2] = (lo >>> 8) & 0xff;  buf[total - 1] = lo & 0xff;

    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
        for (let i = 0; i < 16; i++) {
            w[i] = (buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) |
                   (buf[off + i * 4 + 2] << 8) | (buf[off + i * 4 + 3]);
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            h = g; g = f; f = e; e = (d + t1) | 0;
            d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    const hex = (x) => (x >>> 0).toString(16).padStart(8, '0');
    return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

/** 把秒級時間戳轉成「幾分鐘前」這種相對時間 */
function relativeTime(seconds) {
    if (!seconds) return '';
    const diff = Math.floor(Date.now() / 1000 - seconds);
    if (diff < 60) return '剛剛';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分鐘前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小時前';
    if (diff < 2592000) return Math.floor(diff / 86400) + ' 天前';
    const d = new Date(seconds * 1000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderMaskedText(text, ranges) {
    if (!text) return '';
    if (!ranges || ranges.length === 0) {
        return escapeHtml(text).replace(/\n/g, '<br>');
    }
    // 按 start 排序
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    let result = '';
    let cursor = 0;
    for (const r of sorted) {
        result += escapeHtml(text.substring(cursor, r.start));
        result += '<span class="baozi-masked" title="點一下顯示">' + escapeHtml(text.substring(r.start, r.end)) + '</span>';
        cursor = r.end;
    }
    result += escapeHtml(text.substring(cursor));
    return result.replace(/\n/g, '<br>');
}

function mergeMaskRanges(ranges) {
    if (ranges.length <= 1) return ranges;
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
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
        const messages = document.querySelectorAll('#chat .mes');
        if (!messages.length) return '';
        const recent = Array.from(messages).slice(-5);
        return recent.map(m => {
            const name = m.querySelector('.ch_name .name_text')?.textContent?.trim() || '???';
            const text = m.querySelector('.mes_text')?.innerText?.trim() || '';
            return `【${name}】\n${text}`;
        }).join('\n\n');
    } catch {
        return '';
    }
}

function showError(msg) {
    const existing = document.getElementById('baozi-global-error');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.id = 'baozi-global-error';
    el.className = 'baozi-global-error';
    el.textContent = '🥟 ' + msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
}


/**
 * 複製文字到剪貼簿（相容 HTTP/HTTPS、所有瀏覽器）
 * 回傳 Promise，成功時 resolve(true)，失敗時 resolve(false)
 */
async function copyToClipboard(text) {
    // 方法 1：現代 Clipboard API（需要 HTTPS）
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch (err) {
        console.warn('[包子同好會] Clipboard API 失敗，改用 fallback', err);
    }

    // 方法 2：舊版 execCommand（相容所有環境）
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, text.length);  // iOS 需要
        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        return ok;
    } catch (err) {
        console.error('[包子同好會] 複製失敗', err);
        return false;
    }
}


/**
 * 顯示「查看全文」的彈窗（內容可以手動選取複製）
 */
function showFullTextModal(title, content) {
    // 移除舊的彈窗
    const existing = document.getElementById('baozi-text-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'baozi-text-modal';
    modal.className = 'baozi-modal-overlay';
    modal.innerHTML = `
        <div class="baozi-modal">
            <div class="baozi-modal-header">
                <span class="baozi-modal-title">${escapeHtml(title || '查看全文')}</span>
                <span class="baozi-modal-close">✕</span>
            </div>
            <textarea class="baozi-modal-textarea" readonly></textarea>
            <div class="baozi-modal-footer">
                <button class="baozi-btn-small baozi-modal-copy">📋 複製全部</button>
                <button class="baozi-btn-small baozi-modal-dismiss">關閉</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 用 textarea 顯示內容，可以手動選取複製
    const textarea = modal.querySelector('.baozi-modal-textarea');
    textarea.value = content;

    const close = () => modal.remove();

    modal.querySelector('.baozi-modal-close').addEventListener('click', close);
    modal.querySelector('.baozi-modal-dismiss').addEventListener('click', close);
    modal.addEventListener('click', e => {
        if (e.target === modal) close();
    });

    const copyBtn = modal.querySelector('.baozi-modal-copy');
    copyBtn.addEventListener('click', async () => {
        const ok = await copyToClipboard(content);
        copyBtn.textContent = ok ? '✓ 已複製' : '❌ 複製失敗，請手動選取';
        setTimeout(() => copyBtn.textContent = '📋 複製全部', 2000);
    });

    // 讓彈窗可拖曳
    makeModalDraggable(modal);
}


/**
 * 顯示對話分享全文（包含打碼，可點擊揭露）
 */
function showFullChatModal(chat) {
    const existing = document.getElementById('baozi-chat-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'baozi-chat-modal';
    modal.className = 'baozi-modal-overlay';
    modal.innerHTML = `
        <div class="baozi-modal">
            <div class="baozi-modal-header">
                <span class="baozi-modal-title">${escapeHtml(chat.title || '查看全文')}</span>
                <span class="baozi-modal-close">✕</span>
            </div>
            <div class="baozi-modal-content">
                ${chat.preface ? `<div class="baozi-modal-preface">${escapeHtml(chat.preface)}</div>` : ''}
                <div class="baozi-modal-text">${renderMaskedText(chat.content, chat.maskedRanges || [])}</div>
            </div>
            <div class="baozi-modal-footer">
                <small class="baozi-mask-tip">💡 灰色塊是打碼的，點一下可以看到原文</small>
                <button class="baozi-btn-small baozi-modal-dismiss">關閉</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    const close = () => modal.remove();

    modal.querySelector('.baozi-modal-close').addEventListener('click', close);
    modal.querySelector('.baozi-modal-dismiss').addEventListener('click', close);
    modal.addEventListener('click', e => {
        if (e.target === modal) close();
    });

    // 讓打碼可以點擊顯示
    modal.querySelectorAll('.baozi-masked').forEach(el => {
        el.addEventListener('click', () => {
            el.classList.toggle('baozi-masked-revealed');
        });
    });

    // 讓彈窗可拖曳
    makeModalDraggable(modal);
}


/**
 * 讓彈窗可以拖曳（透過抓標題列）
 * 用 flex 容器置中作為起始位置，拖動時切換成絕對定位
 */
function makeModalDraggable(overlay) {
    const modal = overlay.querySelector('.baozi-modal');
    const header = overlay.querySelector('.baozi-modal-header');
    if (!modal || !header) return;

    let startX, startY, modalStartX, modalStartY;
    let moved = false;

    const onMove = (e) => {
        const point = e.touches ? e.touches[0] : e;
        const dx = point.clientX - startX;
        const dy = point.clientY - startY;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        if (!moved) return;

        let newX = modalStartX + dx;
        let newY = modalStartY + dy;

        // 限制不要拖出螢幕（保留至少 60px 在螢幕內）
        const padding = 60;
        newX = Math.max(-modal.offsetWidth + padding, Math.min(newX, window.innerWidth - padding));
        newY = Math.max(0, Math.min(newY, window.innerHeight - padding));

        modal.style.left = newX + 'px';
        modal.style.top = newY + 'px';

        if (e.cancelable && e.touches) e.preventDefault();
    };

    // 放開時把全域監聽移除。彈窗每次打開都會呼叫本函式，
    // 若不移除，開一次就多留一組 document 監聽，愈開愈卡。
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
    };

    const onDown = (e) => {
        // 點到關閉按鈕、按鈕、文字輸入區的話不拖曳
        const tag = (e.target.tagName || '').toUpperCase();
        if (e.target.classList.contains('baozi-modal-close')) return;
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA') return;

        const point = e.touches ? e.touches[0] : e;
        startX = point.clientX;
        startY = point.clientY;

        // 第一次拖曳前，從目前 flex 置中位置切換成絕對定位
        const rect = modal.getBoundingClientRect();
        modalStartX = rect.left;
        modalStartY = rect.top;

        // 把 modal 從 flex 容器中「脫離」出來，改成絕對定位
        if (!modal.classList.contains('baozi-modal-dragged')) {
            modal.classList.add('baozi-modal-dragged');
            modal.style.left = modalStartX + 'px';
            modal.style.top = modalStartY + 'px';
        }

        moved = false;

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    };

    header.addEventListener('mousedown', onDown);
    header.addEventListener('touchstart', onDown, { passive: true });
}


// ============================================================
// 🚀 啟動擴展
// ============================================================

(async function init() {
    console.log('[包子同好會] 正在啟動...');

    // 等待 DOM 準備好
    if (document.readyState === 'loading') {
        await new Promise(r => document.addEventListener('DOMContentLoaded', r));
    }

    // 等待 SillyTavern UI 載入（給 2 秒緩衝）
    await new Promise(r => setTimeout(r, 2000));

    buildUI();
    applyTheme();
    mountMascot(document.getElementById('baozi-float-btn'));

    if (isBotLoggedIn()) {
        enterWithBot();
    } else {
        updateExtStatus('✨ 點按鈕，用大包子的登入碼登入', 'ok');
    }
    startNotifCheck();
    installErrorCapture();
    startAutoMark();
    // 小包子一次只說一句：有更新要講就先講更新，今天的招呼留到下次打開
    if (isBotLoggedIn()) {
        setTimeout(async () => {
            try {
                if (await announceVersion()) return;
                if (await announceInbox()) return;
                await greetIfNeeded();
            } catch (e) { console.warn('[包子同好會] 小包子打招呼失敗', e); }
        }, 1500);
    }
    console.log('[包子同好會] 啟動完成 🥟');
})();
