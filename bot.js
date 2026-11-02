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
    ['today', '☀️ 今日'],
    ['unplayed', '沒玩過'],
    ['played', '玩過'],
    ['saved', '⭐ 喜歡'],
    ['hot', '🔥 熱門'],
    ['blocked', '🚫 黑名單'],
];

// 這次打開 club 期間記住選過的篩選（關掉面板再開還在）
const view = { filter: 'all', character: null, q: '' };

// 最近一次按「拿去玩」的是哪一則（之後自動標記要用）
export let lastPlayed = null;

/** 把指令填進酒館的輸入框（不送出），游標放到最後。 */
function fillChatInput(text) {
    const box = document.getElementById('send_textarea');
    if (!box) return false;
    box.value = text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
    try { box.setSelectionRange(text.length, text.length); } catch { /* 有些輸入框不支援 */ }
    return true;
}

function cardHtml(cmd, { open = false, pinned = '' } = {}) {
    const played = cmd.characters.length
        ? `<span class="baozi-lib-played">✅ 我跟 ${cmd.characters.map(esc).join('、')} 玩過</span>` : '';
    const friendBits = Object.entries(cmd.friends || {})
        .filter(([, f]) => f.characters.length)
        .map(([name, f]) => `<span class="baozi-lib-friend">${esc(name)}跟 ${f.characters.map(esc).join('、')} 玩過</span>`)
        .join('');
    const tags = cmd.topics.length
        ? `<div class="baozi-card-tags">${cmd.topics.map(t => `<span class="baozi-card-tag">#${esc(t)}</span>`).join('')}</div>` : '';
    const badges = `${cmd.today ? '<span class="baozi-lib-badge">☀️ 今日</span>' : ''}${cmd.status === 'saved' ? '<span class="baozi-lib-badge">⭐</span>' : ''}`;
    return `
    <div class="baozi-card baozi-card-compact baozi-lib-card ${open ? 'open' : ''} ${pinned ? 'pinned' : ''}" data-id="${cmd.id}">
        ${pinned ? `<div class="baozi-lib-pinned">${pinned}</div>` : ''}
        <div class="baozi-lib-head" data-a="toggle">
            <div class="baozi-card-owner">#${cmd.id} · ${esc(cmd.author)} 存的${cmd.mine ? ' <span class="baozi-tag-mine">我</span>' : ''} ${badges}</div>
            <div class="baozi-card-title">${esc(cmd.title)} <span class="baozi-lib-caret">${open ? '▴' : '▾'}</span></div>
            ${tags}
            ${played || friendBits ? `<div class="baozi-lib-status">${played}${friendBits}</div>` : ''}
        </div>
        <div class="baozi-lib-detail"></div>
    </div>`;
}

function detailHtml(cmd, character) {
    const usedNow = character && cmd.characters.includes(character);
    return `
        <div class="baozi-lib-body">${esc(cmd.body || '')}</div>
        ${cmd.note ? `<div class="baozi-lib-note">📝 ${esc(cmd.note)}</div>` : ''}
        <div class="baozi-card-actions">
            <button class="baozi-btn-small baozi-on" data-a="play">▶️ 拿去玩</button>
            <button class="baozi-btn-small" data-a="copy">📋 複製</button>
            ${character ? `<button class="baozi-btn-small ${usedNow ? 'baozi-on' : ''}" data-a="used">${usedNow ? '✅' : '☑️'} ${esc(character)}玩過</button>` : ''}
            <button class="baozi-btn-small ${cmd.status === 'saved' ? 'baozi-on' : ''}" data-a="saved">⭐</button>
            <button class="baozi-btn-small ${cmd.status === 'blocked' ? 'baozi-on' : ''}" data-a="blocked">🚫</button>
            ${cmd.url ? `<a class="baozi-btn-small" href="${esc(cmd.url)}" target="_blank" rel="noopener">💬 DC</a>` : ''}
        </div>`;
}

/**
 * @param container 面板內容區
 * @param ui        {back, copy(text), closePanel()}：用 index.js 現成的
 * @param opts      {filter: 一打開就用哪個篩選, pinned: 釘在最上面展開的一則（骰子抽到的）}
 */
export async function renderLibraryScreen(container, ui, opts = {}) {
    const me = bot.me;
    const chars = me?.characters || [];
    if (view.character === null) view.character = currentCharacter() || '';
    if (opts.filter) view.filter = opts.filter;

    container.innerHTML = `
        <div class="baozi-screen baozi-lib">
            <div class="baozi-lib-sticky">
                <div class="baozi-screen-header">
                    <button class="baozi-back" id="baozi-back">← 回首頁</button>
                    <h3>📖 大包子指令庫</h3>
                </div>
                <input type="text" class="baozi-search" id="baozi-lib-q" placeholder="🔍 搜標題 / 題材..." value="${esc(view.q)}">
                <div class="baozi-lib-chips" id="baozi-lib-filters">
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
            <div id="baozi-lib-pin"></div>
            <div class="baozi-list" id="baozi-lib-list"><div class="baozi-loading">載入中...</div></div>
        </div>
    `;
    container.querySelector('#baozi-back').addEventListener('click', ui.back);

    const list = container.querySelector('#baozi-lib-list');
    const pinBox = container.querySelector('#baozi-lib-pin');
    let items = [];
    let pinned = opts.pinned || null;
    const isOpen = new Set();

    const all = () => (pinned ? [pinned, ...items] : items);
    const findCmd = (id) => all().find(c => String(c.id) === String(id));

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
            case 'today': return '今天的推薦都被拉黑了 🙈';
            default: return '指令庫是空的';
        }
    }

    function drawPin() {
        if (!pinned) { pinBox.innerHTML = ''; return; }
        pinBox.innerHTML = cardHtml(pinned, { open: true, pinned: '🎲 抽到這則！<button class="baozi-btn-small" data-a="reroll">再抽一次</button>' });
        pinBox.querySelector('.baozi-lib-detail').innerHTML = detailHtml(pinned, view.character);
    }

    function draw() {
        drawPin();
        const rest = pinned ? items.filter(c => c.id !== pinned.id) : items;
        if (!rest.length) {
            list.innerHTML = `<div class="baozi-empty">${hint()}</div>`;
            return;
        }
        list.innerHTML = rest.map(cmd => cardHtml(cmd, { open: isOpen.has(cmd.id) })).join('');
        list.querySelectorAll('.baozi-lib-card.open').forEach(card => {
            const cmd = findCmd(card.dataset.id);
            card.querySelector('.baozi-lib-detail').innerHTML = detailHtml(cmd, view.character);
        });
    }

    async function withBody(cmd) {
        if (cmd.body === undefined) {
            const full = await botFetch('/club/commands/' + cmd.id);
            cmd.body = full.body;
            cmd.note = full.note;
        }
        return cmd;
    }

    async function onClick(ev) {
        const target = ev.target.closest('[data-a]');
        if (!target) return;
        const action = target.dataset.a;
        if (action === 'reroll') {
            target.disabled = true;
            await reroll();
            return;
        }
        const card = target.closest('.baozi-lib-card');
        const cmd = card && findCmd(card.dataset.id);
        if (!cmd) return;
        if (target.tagName === 'BUTTON') target.disabled = true;
        try {
            switch (action) {
                case 'toggle':
                    if (card.classList.contains('pinned')) break;
                    if (isOpen.has(cmd.id)) isOpen.delete(cmd.id);
                    else { await withBody(cmd); isOpen.add(cmd.id); }
                    draw();
                    break;
                case 'play': {
                    await withBody(cmd);
                    if (!fillChatInput(cmd.body)) { alert('找不到酒館的輸入框～先打開一個聊天'); break; }
                    lastPlayed = { id: cmd.id, title: cmd.title, body: cmd.body, at: Date.now() };
                    ui.closePanel?.();
                    break;
                }
                case 'copy':
                    await ui.copy((await withBody(cmd)).body);
                    break;
                case 'saved':
                case 'blocked': {
                    const status = cmd.status === action ? null : action;
                    await botFetch(`/club/commands/${cmd.id}/mark`, { method: 'POST', body: { status } });
                    cmd.status = status;
                    if (status) cmd.characters = [];  // 收藏／拉黑跟「玩過」是同一欄，三選一
                    if ((status === 'blocked') !== (view.filter === 'blocked')
                        || (view.filter === 'saved' && status !== 'saved')) {
                        items = items.filter(c => c.id !== cmd.id);
                        isOpen.delete(cmd.id);
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
                        items = items.filter(c => c.id !== cmd.id);
                        isOpen.delete(cmd.id);
                    }
                    draw();
                    break;
                }
            }
        } catch (e) {
            alert(e.message);
        } finally {
            if (target.tagName === 'BUTTON' && document.body.contains(target)) target.disabled = false;
        }
    }

    async function reroll() {
        const res = await rollDice();
        if (!res.command) { alert(DICE_EMPTY); drawPin(); return; }
        pinned = res.command;
        draw();
        pinBox.scrollIntoView({ block: 'start' });
    }

    list.addEventListener('click', onClick);
    pinBox.addEventListener('click', onClick);

    container.querySelectorAll('#baozi-lib-filters [data-f]').forEach(chip => {
        chip.addEventListener('click', () => {
            view.filter = chip.dataset.f;
            container.querySelectorAll('#baozi-lib-filters [data-f]').forEach(c =>
                c.classList.toggle('active', c === chip));
            load();
        });
    });
    container.querySelector('#baozi-lib-filters .active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
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
// 🎲 骰子 + 設定
// ============================================================

export const DICE_EMPTY = '照你的骰子設定，現在沒有可以抽的～到「設定」多勾幾堆試試';

/** 照設定抽一則。「只看現在這個角色」要用到現在開著的卡。 */
export async function rollDice() {
    const params = new URLSearchParams();
    const card = currentCardName();
    if (card) params.set('char', card);
    return await botFetch('/club/random?' + params);
}

const POOL_LABELS = [
    ['unplayed', '沒玩過'],
    ['played', '玩過'],
    ['saved', '⭐ 喜歡'],
    ['today', '☀️ 今日推薦'],
];

/** 設定畫面裡的「🎲 骰子」那一塊。 */
export async function renderDiceSettings(box) {
    box.innerHTML = '<div class="baozi-loading">載入中...</div>';
    let prefs;
    try {
        prefs = await botFetch('/club/prefs');
    } catch (e) {
        box.innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
        return;
    }
    box.innerHTML = `
        <div class="baozi-setup-hint">骰子從哪幾堆抽（可以多選）。今日推薦裡沒玩過的，被抽到的機會比較大。</div>
        <div class="baozi-dice-pools">
            ${POOL_LABELS.map(([key, label]) => `
                <label class="baozi-check"><input type="checkbox" data-pool="${key}" ${prefs.random_pools.includes(key) ? 'checked' : ''}> ${label}</label>
            `).join('')}
        </div>
        <label class="baozi-check"><input type="checkbox" id="baozi-dice-char" ${prefs.random_by_character ? 'checked' : ''}> 玩過／沒玩過只看現在開著的角色</label>
        <div class="baozi-setup-hint" id="baozi-dice-saved"></div>
    `;
    const saved = box.querySelector('#baozi-dice-saved');
    box.addEventListener('change', async () => {
        const pools = [...box.querySelectorAll('[data-pool]:checked')].map(i => i.dataset.pool);
        if (!pools.length) {
            box.querySelector('[data-pool="unplayed"]').checked = true;
            pools.push('unplayed');
        }
        try {
            await botFetch('/club/prefs', {
                method: 'POST',
                body: { random_pools: pools, random_by_character: box.querySelector('#baozi-dice-char').checked },
            });
            saved.textContent = '✓ 存好了';
        } catch (e) {
            saved.textContent = '❌ ' + e.message;
        }
    });
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
