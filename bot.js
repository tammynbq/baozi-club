// ============================================================
// 🍞 包子club ↔ 大包子
// ============================================================
// 指令庫和標記跟 Discord 上的大包子共用同一份：
//   - 登入：Discord 上打 /club 登入 拿碼，在這裡輸入，換一把這支手機專用的鑰匙
//   - 指令庫：篩選（全部／沒玩過／玩過／喜歡／熱門／黑名單）、收藏、拉黑、記「跟誰玩過」
//   - 舊指令：Discord 的 /club 搬家（大包子自己去 Firebase 讀）
//
// 鑰匙存在這支手機的 localStorage；大包子那邊只存它的指紋。
// ============================================================

const KEY_URL = 'baozi_bot_url';
// 大包子在 Railway 的網址。寫死在這裡就不用每支手機自己填；
// 公開也沒關係 —— 沒有 /club 登入 換來的鑰匙什麼都讀不到。
export const DEFAULT_BOT_URL = 'https://big-baozi-production.up.railway.app';
const KEY_TOKEN = 'baozi_bot_token';
const KEY_ME = 'baozi_bot_me';

export const bot = {
    url: localStorage.getItem(KEY_URL) || DEFAULT_BOT_URL,
    token: localStorage.getItem(KEY_TOKEN) || '',
    me: readJson(localStorage.getItem(KEY_ME)),
};

function readJson(raw) {
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

export function isBotLoggedIn() {
    return !!(bot.url && bot.token && bot.me);
}

function normalizeUrl(raw) {
    let url = String(raw || '').trim().replace(/\/+$/, '');
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
}

export function botLogout() {
    bot.token = '';
    bot.me = null;
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_ME);
}

/** 呼叫大包子。鑰匙被撤掉（401）就自動登出，讓畫面回到輸入登入碼。 */
export async function botFetch(path, { method = 'GET', body } = {}) {
    if (!bot.url) throw new Error('還沒填大包子的網址');
    let res;
    try {
        res = await fetch(bot.url + path, {
            method,
            headers: {
                ...(bot.token ? { Authorization: 'Bearer ' + bot.token } : {}),
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });
    } catch (err) {
        throw new Error('連不上大包子（網址對嗎？大包子醒著嗎？）');
    }
    let data = null;
    try { data = await res.json(); } catch { /* 不是 JSON 就算了 */ }
    if (res.status === 401 && path !== '/club/login') {
        botLogout();
        throw new Error('登入失效了，請到 Discord 打 /club 登入 重新拿碼');
    }
    if (!res.ok) throw new Error(data?.error || ('大包子回了 ' + res.status));
    return data;
}

function deviceLabel() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android';
    if (/Mac/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'Windows';
    return '手機';
}

/** 重新跟大包子要一次「我是誰」（角色清單、別名表可能更新過）。 */
export async function refreshMe() {
    const me = await botFetch('/club/me');
    bot.me = me;
    localStorage.setItem(KEY_ME, JSON.stringify(me));
    return me;
}


// ============================================================
// 現在開著誰的聊天
// ============================================================

function stContext() {
    try {
        return globalThis.SillyTavern?.getContext?.() || null;
    } catch {
        return null;
    }
}

/** 酒館現在開著的角色卡名字（沒開就空字串）。 */
export function currentCardName() {
    const ctx = stContext();
    if (!ctx) return '';
    const char = ctx.characters?.[ctx.characterId];
    return (char?.name || ctx.name2 || '').trim();
}

/** 卡上的名字 → 大包子用的名字；不是自己的老公就回空字串。 */
export function currentCharacter() {
    if (!bot.me) return '';
    const card = currentCardName();
    const name = bot.me.aliases?.[card] || card;
    return (bot.me.characters || []).includes(name) ? name : '';
}


// ============================================================
// 登入畫面
// ============================================================

export function renderBotLoginScreen(container, { onDone, onLegacy } = {}) {
    container.innerHTML = `
        <div class="baozi-login">
            <div class="baozi-welcome">
                <div class="baozi-big-emoji">🍞</div>
                <h2>用大包子登入</h2>
                <p>到 Discord 打 <b>/club 登入</b>（一帆打 <b>/club 登录</b>），<br>大包子會給你一組碼，10 分鐘內有效。</p>
            </div>
            <div class="baozi-form">
                <label>登入碼</label>
                <input type="text" id="baozi-bot-code" placeholder="ABCD-EFGH" autocapitalize="characters" autocorrect="off">
                <button class="baozi-btn-primary" id="baozi-bot-login">進來 ✨</button>
                <div class="baozi-error" id="baozi-bot-error"></div>
                <details style="margin-top:14px; font-size:12px; opacity:.75;">
                    <summary>大包子換了網址？</summary>
                    <input type="text" id="baozi-bot-url" placeholder="${esc(DEFAULT_BOT_URL)}" value="${esc(bot.url)}" autocapitalize="off" autocorrect="off" style="margin-top:6px;">
                </details>
                ${onLegacy ? '<button class="baozi-btn-small baozi-btn-full" id="baozi-bot-legacy" style="margin-top:14px;">還是用舊的暗號登入</button>' : ''}
            </div>
        </div>
    `;
    const err = container.querySelector('#baozi-bot-error');
    container.querySelector('#baozi-bot-login').addEventListener('click', async () => {
        const url = normalizeUrl(container.querySelector('#baozi-bot-url').value) || DEFAULT_BOT_URL;
        const code = container.querySelector('#baozi-bot-code').value.trim();
        if (!url) { err.textContent = '要填大包子的網址～'; return; }
        if (!code) { err.textContent = '登入碼呢？'; return; }
        err.textContent = '登入中...';
        bot.url = url;
        localStorage.setItem(KEY_URL, url);
        try {
            const data = await botFetch('/club/login', {
                method: 'POST', body: { code, label: deviceLabel() },
            });
            bot.token = data.token;
            bot.me = data.me;
            localStorage.setItem(KEY_TOKEN, data.token);
            localStorage.setItem(KEY_ME, JSON.stringify(data.me));
            onDone?.();
        } catch (e) {
            err.textContent = '❌ ' + e.message;
        }
    });
    container.querySelector('#baozi-bot-legacy')?.addEventListener('click', () => onLegacy());
}


// ============================================================
// 指令庫
// ============================================================

const FILTERS = [
    ['all', '全部'],
    ['unplayed', '沒玩過'],
    ['played', '玩過'],
    ['saved', '⭐ 喜歡'],
    ['hot', '🔥 熱門'],
    ['blocked', '🚫 黑名單'],
];

// 這次打開 club 期間記住選過的篩選（關掉面板再開還在）
const view = { filter: 'all', character: null, q: '' };

/**
 * @param container 面板內容區
 * @param ui        {back, showFull(title, text), copy(text)}：用 index.js 現成的
 */
export async function renderLibraryScreen(container, ui) {
    const me = bot.me;
    const chars = me?.characters || [];
    if (view.character === null) view.character = currentCharacter() || '';
    const friendName = me?.friends?.[0]?.name || '朋友';

    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>📖 大包子指令庫</h3>
            </div>
            <div class="baozi-toolbar">
                <input type="text" class="baozi-search" id="baozi-lib-q" placeholder="🔍 搜標題 / 題材..." value="${esc(view.q)}">
                <div class="baozi-tagbar" id="baozi-lib-filters">
                    ${FILTERS.map(([key, label]) =>
                        `<button class="baozi-tag-chip ${view.filter === key ? 'active' : ''}" data-f="${key}">${label}</button>`
                    ).join('')}
                </div>
                ${chars.length > 1 || !chars.includes(view.character) ? `
                <div class="baozi-lib-char">
                    <span>角色：</span>
                    <select id="baozi-lib-char">
                        <option value="">（不分角色）</option>
                        ${chars.map(c => `<option value="${esc(c)}" ${c === view.character ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                    </select>
                </div>` : ''}
            </div>
            <div class="baozi-list" id="baozi-lib-list"><div class="baozi-loading">載入中...</div></div>
        </div>
    `;
    container.querySelector('#baozi-back').addEventListener('click', ui.back);

    const list = container.querySelector('#baozi-lib-list');
    let items = [];

    async function load() {
        list.innerHTML = '<div class="baozi-loading">載入中...</div>';
        const params = new URLSearchParams({ f: view.filter });
        if (view.character && (view.filter === 'played' || view.filter === 'unplayed')) {
            params.set('char', view.character);
        }
        if (view.q) params.set('q', view.q);
        try {
            const data = await botFetch('/club/commands?' + params);
            items = data.commands;
            draw();
        } catch (e) {
            list.innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
        }
    }

    function hint() {
        const who = view.character ? `跟${esc(view.character)}` : '';
        switch (view.filter) {
            case 'unplayed': return `🎉 ${who}全部都玩過了！`;
            case 'played': return `${who}還沒玩過任何一則～`;
            case 'saved': return '還沒有喜歡的～按 ⭐ 收藏';
            case 'blocked': return '黑名單是空的';
            case 'hot': return '還沒有人標過玩過～';
            default: return '指令庫是空的';
        }
    }

    function draw() {
        if (!items.length) {
            list.innerHTML = `<div class="baozi-empty">${hint()}</div>`;
            return;
        }
        list.innerHTML = items.map(cmd => {
            const played = cmd.characters.length
                ? `<span class="baozi-lib-played">✅ 我跟 ${cmd.characters.map(esc).join('、')} 玩過</span>` : '';
            const friendBits = Object.entries(cmd.friends || {})
                .filter(([, f]) => f.characters.length)
                .map(([name, f]) => `<span class="baozi-lib-friend">${esc(name)}跟 ${f.characters.map(esc).join('、')} 玩過</span>`)
                .join('');
            const tags = cmd.topics.length
                ? `<div class="baozi-card-tags">${cmd.topics.map(t => `<span class="baozi-card-tag">#${esc(t)}</span>`).join('')}</div>` : '';
            const usedNow = view.character && cmd.characters.includes(view.character);
            return `
            <div class="baozi-card baozi-card-compact" data-id="${cmd.id}">
                <div class="baozi-card-owner">#${cmd.id} · ${esc(cmd.author)} 存的${cmd.mine ? ' <span class="baozi-tag-mine">我</span>' : ''}</div>
                <div class="baozi-card-title">${esc(cmd.title)}</div>
                ${tags}
                ${played || friendBits ? `<div class="baozi-lib-status">${played}${friendBits}</div>` : ''}
                <div class="baozi-card-actions">
                    <button class="baozi-btn-small" data-a="view">👀 看全文</button>
                    <button class="baozi-btn-small" data-a="copy">📋 複製</button>
                    ${view.character ? `<button class="baozi-btn-small ${usedNow ? 'baozi-on' : ''}" data-a="used">${usedNow ? '✅' : '☑️'} ${esc(view.character)}玩過</button>` : ''}
                    <button class="baozi-btn-small ${cmd.status === 'saved' ? 'baozi-on' : ''}" data-a="saved">⭐</button>
                    <button class="baozi-btn-small ${cmd.status === 'blocked' ? 'baozi-on' : ''}" data-a="blocked">🚫</button>
                    ${cmd.url ? `<a class="baozi-btn-small" href="${esc(cmd.url)}" target="_blank" rel="noopener">💬 DC</a>` : ''}
                </div>
            </div>`;
        }).join('');
    }

    async function fullText(cmd) {
        return (await botFetch('/club/commands/' + cmd.id)).body;
    }

    list.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('button[data-a]');
        if (!btn) return;
        const card = btn.closest('.baozi-card');
        const cmd = items.find(c => String(c.id) === card.dataset.id);
        if (!cmd) return;
        btn.disabled = true;
        try {
            switch (btn.dataset.a) {
                case 'view':
                    ui.showFull(cmd.title, await fullText(cmd));
                    break;
                case 'copy':
                    await ui.copy(await fullText(cmd));
                    break;
                case 'saved':
                case 'blocked': {
                    const status = cmd.status === btn.dataset.a ? null : btn.dataset.a;
                    await botFetch(`/club/commands/${cmd.id}/mark`, { method: 'POST', body: { status } });
                    cmd.status = status;
                    // 收藏／拉黑跟「玩過」是同一欄，三選一
                    if (status) cmd.characters = [];
                    // 拉黑了就從一般清單消失；在黑名單裡取消也一樣
                    if ((status === 'blocked') !== (view.filter === 'blocked')
                        || (view.filter === 'saved' && status !== 'saved')) {
                        items = items.filter(c => c !== cmd);
                    }
                    draw();
                    break;
                }
                case 'used': {
                    const set = new Set(cmd.characters);
                    if (set.has(view.character)) set.delete(view.character);
                    else set.add(view.character);
                    const res = await botFetch(`/club/commands/${cmd.id}/used`, {
                        method: 'POST', body: { characters: [...set] },
                    });
                    cmd.characters = res.characters;
                    cmd.status = res.characters.length ? 'used' : null;
                    const nowUsed = cmd.characters.includes(view.character);
                    if ((view.filter === 'unplayed' && nowUsed) || (view.filter === 'played' && !nowUsed)) {
                        items = items.filter(c => c !== cmd);
                    }
                    draw();
                    break;
                }
            }
        } catch (e) {
            alert(e.message);
        } finally {
            btn.disabled = false;
        }
    });

    container.querySelectorAll('#baozi-lib-filters [data-f]').forEach(chip => {
        chip.addEventListener('click', () => {
            view.filter = chip.dataset.f;
            container.querySelectorAll('#baozi-lib-filters [data-f]').forEach(c =>
                c.classList.toggle('active', c === chip));
            load();
        });
    });
    container.querySelector('#baozi-lib-char')?.addEventListener('change', (ev) => {
        view.character = ev.target.value;
        load();
    });
    let typing = null;
    container.querySelector('#baozi-lib-q').addEventListener('input', (ev) => {
        clearTimeout(typing);
        typing = setTimeout(() => { view.q = ev.target.value.trim(); load(); }, 350);
    });

    load();
}


// ============================================================
// 💬 聊天室（跟 Discord 的一個頻道互通）
// ============================================================
// 打開時先拿最近 50 則，再開一條 WebSocket 等新訊息。
// 斷線（手機切背景之類）就自動重連，重連後用 ?after= 補漏掉的。
// 離開聊天畫面就把線關掉。

let chatSession = null;

export function closeChat() {
    if (chatSession) chatSession.stop();
    chatSession = null;
}

function fmtTime(iso) {
    const d = new Date(iso);
    const now = new Date();
    const hm = d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

function messageHtml(m) {
    const text = esc(m.text).replace(/\n/g, '<br>');
    const imgs = (m.images || []).map(u => `<img class="baozi-chat-img" src="${esc(u)}" loading="lazy">`).join('');
    const files = (m.files || []).map(f => `<a class="baozi-chat-file" href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>`).join('');
    return `
        <div class="baozi-chat-msg ${m.mine ? 'mine' : ''}" data-id="${esc(m.id)}">
            <img class="baozi-chat-avatar" src="${esc(m.avatar)}" alt="">
            <div class="baozi-chat-main">
                <div class="baozi-chat-meta"><b>${esc(m.author)}</b> <span>${fmtTime(m.ts)}</span></div>
                ${text ? `<div class="baozi-chat-bubble">${text}</div>` : ''}
                ${imgs}${files}
            </div>
        </div>`;
}

export async function renderChatScreen(container, ui) {
    closeChat();
    container.innerHTML = `
        <div class="baozi-screen baozi-chat" id="baozi-chat-root">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>💬 <span id="baozi-chat-title">聊天</span></h3>
                <span class="baozi-chat-dot" id="baozi-chat-dot" title="連線狀態"></span>
            </div>
            <div class="baozi-chat-list" id="baozi-chat-list"><div class="baozi-loading">載入中...</div></div>
            <div class="baozi-chat-input">
                <textarea id="baozi-chat-text" rows="1" placeholder="說點什麼…"></textarea>
                <button class="baozi-btn-primary" id="baozi-chat-send">送出</button>
            </div>
        </div>
    `;
    const list = container.querySelector('#baozi-chat-list');
    const dot = container.querySelector('#baozi-chat-dot');
    const input = container.querySelector('#baozi-chat-text');
    const sendBtn = container.querySelector('#baozi-chat-send');
    const seen = new Set();
    let lastId = '';
    let ws = null;
    let stopped = false;
    let retry = 0;
    let retryTimer = null;

    const alive = () => !stopped && document.body.contains(container.querySelector('#baozi-chat-root'));
    const setDot = (state) => { dot.dataset.state = state; };

    function append(messages) {
        const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
        if (list.querySelector('.baozi-loading, .baozi-empty')) list.innerHTML = '';
        let added = false;
        for (const m of messages) {
            if (seen.has(m.id)) continue;
            seen.add(m.id);
            list.insertAdjacentHTML('beforeend', messageHtml(m));
            if (BigInt(m.id) > BigInt(lastId || '0')) lastId = m.id;
            added = true;
        }
        if (added && (nearBottom || messages.some(m => m.mine))) list.scrollTop = list.scrollHeight;
        if (!list.children.length) list.innerHTML = '<div class="baozi-empty">還沒有人說話～</div>';
    }

    async function catchUp() {
        const data = await botFetch('/club/chat' + (lastId ? '?after=' + lastId : ''));
        container.querySelector('#baozi-chat-title').textContent = '#' + data.channel;
        append(data.messages);
    }

    function connect() {
        if (!alive()) return;
        setDot('connecting');
        ws = new WebSocket(bot.url.replace(/^http/i, 'ws') + '/club/ws');
        ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: bot.token }));
        ws.onmessage = (ev) => {
            if (!alive()) { stop(); return; }
            let data;
            try { data = JSON.parse(ev.data); } catch { return; }
            if (data.type === 'ready') {
                retry = 0;
                setDot('on');
                catchUp().catch(() => {});  // 連上之前漏掉的
            } else if (data.type === 'message') {
                append([data.message]);
            } else if (data.type === 'error') {
                setDot('off');
            }
        };
        ws.onclose = () => {
            ws = null;
            if (!alive()) return;
            setDot('off');
            const wait = [1000, 2000, 5000, 10000][Math.min(retry++, 3)];
            retryTimer = setTimeout(connect, wait);
        };
    }

    function stop() {
        stopped = true;
        clearTimeout(retryTimer);
        document.removeEventListener('visibilitychange', onVisible);
        if (ws) { ws.onclose = null; ws.close(); ws = null; }
    }

    // 從背景切回來：線斷了就馬上重連，不等倒數
    function onVisible() {
        if (document.hidden || !alive()) return;
        if (!ws) { clearTimeout(retryTimer); retry = 0; connect(); }
    }
    document.addEventListener('visibilitychange', onVisible);

    chatSession = { stop };

    async function send() {
        const text = input.value.trim();
        if (!text) return;
        sendBtn.disabled = true;
        try {
            await botFetch('/club/chat', { method: 'POST', body: { text } });
            input.value = '';
            input.style.height = '';
            if (!ws || ws.readyState !== WebSocket.OPEN) await catchUp();
        } catch (e) {
            alert(e.message);
        } finally {
            sendBtn.disabled = false;
            input.focus();
        }
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (ev) => {
        // 電腦上 Enter 送出、Shift+Enter 換行；手機上的 Enter 照常換行，用按鈕送
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && !/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
            ev.preventDefault();
            send();
        }
    });
    input.addEventListener('input', () => {
        input.style.height = '';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
    container.querySelector('#baozi-back').addEventListener('click', () => { closeChat(); ui.back(); });

    try {
        await catchUp();
        list.scrollTop = list.scrollHeight;
    } catch (e) {
        list.innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
        return;
    }
    connect();
}
