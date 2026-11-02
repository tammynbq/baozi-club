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

import { t } from './i18n.js';

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
    ['recommended', '💌 力推'],
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
        ? `<div class="baozi-card-tags" data-raw>${cmd.topics.map(t => `<span class="baozi-card-tag">#${esc(t)}</span>`).join('')}</div>` : '';
    const badges = `${cmd.today ? '<span class="baozi-lib-badge">☀️ 今日</span>' : ''}${cmd.rec ? `<span class="baozi-lib-badge">💌 ${esc(cmd.rec.from)}推</span>` : ''}${cmd.status === 'saved' ? '<span class="baozi-lib-badge">⭐</span>' : ''}`;
    return `
    <div class="baozi-card baozi-card-compact baozi-lib-card ${open ? 'open' : ''} ${pinned ? 'pinned' : ''}" data-id="${cmd.id}">
        ${pinned ? `<div class="baozi-lib-pinned">${pinned}</div>` : ''}
        <div class="baozi-lib-head" data-a="toggle">
            <div class="baozi-card-owner">#${cmd.id} · ${esc(cmd.author)} 存的${cmd.mine ? ' <span class="baozi-tag-mine">我</span>' : ''} ${badges}</div>
            <div class="baozi-card-title"><span data-raw>${esc(cmd.title)}</span> <span class="baozi-lib-caret">${open ? '▴' : '▾'}</span></div>
            ${tags}
            ${played || friendBits ? `<div class="baozi-lib-status">${played}${friendBits}</div>` : ''}
        </div>
        <div class="baozi-lib-detail"></div>
    </div>`;
}

function friendName() {
    return bot.me?.friends?.[0]?.name || '朋友';
}

function detailHtml(cmd, character) {
    const usedNow = character && cmd.characters.includes(character);
    return `
        ${cmd.rec ? `<div class="baozi-lib-rec">💌 ${esc(cmd.rec.from)}推薦你來玩這個！${cmd.rec.note ? `<div class="baozi-lib-rec-note" data-raw>「${esc(cmd.rec.note)}」</div>` : ''}</div>` : ''}
        <div class="baozi-lib-body" data-raw>${esc(cmd.body || '')}</div>
        ${cmd.note ? `<div class="baozi-lib-note">📝 <span data-raw>${esc(cmd.note)}</span></div>` : ''}
        <div class="baozi-card-actions">
            <button class="baozi-btn-small baozi-on" data-a="play">▶️ 拿去玩</button>
            <button class="baozi-btn-small" data-a="copy">📋 複製</button>
            ${character ? `<button class="baozi-btn-small ${usedNow ? 'baozi-on' : ''}" data-a="used">${usedNow ? '✅' : '☑️'} ${esc(character)}玩過</button>` : ''}
            <button class="baozi-btn-small ${cmd.status === 'saved' ? 'baozi-on' : ''}" data-a="saved">⭐</button>
            <button class="baozi-btn-small ${cmd.status === 'blocked' ? 'baozi-on' : ''}" data-a="blocked">🚫</button>
            <button class="baozi-btn-small" data-a="recommend">💌 推給${esc(friendName())}</button>
            ${cmd.url ? `<a class="baozi-btn-small" href="${esc(cmd.url)}" target="_blank" rel="noopener">💬 DC</a>` : ''}
        </div>
        <div class="baozi-lib-recbox" hidden>
            <input type="text" class="baozi-search" maxlength="200" placeholder="想跟${esc(friendName())}說什麼？（可以不寫）">
            <button class="baozi-btn-small baozi-on" data-a="recommend-send">送出</button>
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
    let pinLabel = opts.pinLabel || null;    // 不是骰子抽的（例如從通知點進來）就用這個標題、沒有「再抽一次」
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
            case 'recommended': return `${esc(friendName())}推給你的都玩過了～`;
            default: return '指令庫是空的';
        }
    }

    function drawPin() {
        if (!pinned) { pinBox.innerHTML = ''; return; }
        pinBox.innerHTML = cardHtml(pinned, { open: true, pinned: pinLabel || '🎲 抽到這則！<button class="baozi-btn-small" data-a="reroll">再抽一次</button>' });
        pinBox.querySelector('.baozi-lib-detail').innerHTML = detailHtml(pinned, view.character);
    }

    function draw() {
        drawPin();
        const rest = pinned ? items.filter(c => c.id !== pinned.id) : items;
        if (!rest.length) {
            list.innerHTML = pinned ? '' : `<div class="baozi-empty">${hint()}</div>`;
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
                    if (!fillChatInput(cmd.body)) { alert(t('找不到酒館的輸入框～先打開一個聊天')); break; }
                    lastPlayed = { id: cmd.id, title: cmd.title, body: cmd.body, at: Date.now() };
                    ui.closePanel?.();
                    break;
                }
                case 'recommend': {
                    const box = card.querySelector('.baozi-lib-recbox');
                    box.hidden = !box.hidden;
                    if (!box.hidden) box.querySelector('input').focus();
                    break;
                }
                case 'recommend-send': {
                    const input = card.querySelector('.baozi-lib-recbox input');
                    const res = await botFetch(`/club/commands/${cmd.id}/recommend`, {
                        method: 'POST', body: { note: input.value.trim() },
                    });
                    card.querySelector('.baozi-lib-recbox').hidden = true;
                    input.value = '';
                    const btn = card.querySelector('[data-a="recommend"]');
                    btn.textContent = `✓ 推給${res.to}了`;
                    break;
                }
                case 'copy': {
                    const ok = await ui.copy((await withBody(cmd)).body);
                    target.textContent = ok ? '✓ 已複製' : '❌ 複製失敗';
                    setTimeout(() => { if (document.body.contains(target)) target.textContent = '📋 複製'; }, 1500);
                    break;
                }
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
            alert(t(e.message));
        } finally {
            if (target.tagName === 'BUTTON' && document.body.contains(target)) target.disabled = false;
        }
    }

    async function reroll() {
        const res = await rollDice();
        if (!res.command) { alert(t(DICE_EMPTY)); drawPin(); return; }
        pinned = res.command;
        pinLabel = null;
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
    ['recommended', '💌 力推'],
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
            ${POOL_LABELS.map(([key, label]) =>
                `<button class="baozi-tag-chip ${prefs.random_pools.includes(key) ? 'active' : ''}" data-pool="${key}">${label}</button>`
            ).join('')}
        </div>
        <button class="baozi-tag-chip baozi-toggle-chip ${prefs.random_by_character ? 'active' : ''}" id="baozi-dice-char">
            ${prefs.random_by_character ? '✓' : '○'} 玩過／沒玩過只看現在開著的角色
        </button>
        <div class="baozi-setup-section-title" style="margin-top:16px;">🔔 通知</div>
        <button class="baozi-tag-chip baozi-toggle-chip ${prefs.notify_discord ? 'active' : ''}" id="baozi-notify-dc">
            ${prefs.notify_discord ? '✓' : '○'} 被力推時，大包子也在 Discord 私訊我
        </button>
        <div class="baozi-setup-hint" id="baozi-dice-saved"></div>
    `;
    // 用按鈕當勾選框：tt 的主題會改寫原生 checkbox 的樣子（變成一條細線）
    const saved = box.querySelector('#baozi-dice-saved');
    box.addEventListener('click', async (ev) => {
        const chip = ev.target.closest('[data-pool], #baozi-dice-char, #baozi-notify-dc');
        if (!chip) return;
        chip.classList.toggle('active');
        if (chip.id === 'baozi-dice-char') {
            chip.textContent = (chip.classList.contains('active') ? '✓' : '○') + ' 玩過／沒玩過只看現在開著的角色';
        }
        if (chip.id === 'baozi-notify-dc') {
            chip.textContent = (chip.classList.contains('active') ? '✓' : '○') + ' 被力推時，大包子也在 Discord 私訊我';
        }
        let pools = [...box.querySelectorAll('[data-pool].active')].map(i => i.dataset.pool);
        if (!pools.length) {
            box.querySelector('[data-pool="unplayed"]').classList.add('active');
            pools = ['unplayed'];
        }
        try {
            await botFetch('/club/prefs', {
                method: 'POST',
                body: {
                    random_pools: pools,
                    random_by_character: box.querySelector('#baozi-dice-char').classList.contains('active'),
                    notify_discord: box.querySelector('#baozi-notify-dc').classList.contains('active'),
                },
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
    const files = (m.files || []).map(f => `<a class="baozi-chat-file" href="${esc(f.url)}" target="_blank" rel="noopener" data-raw>📎 ${esc(f.name)}</a>`).join('');
    return `
        <div class="baozi-chat-msg ${m.mine ? 'mine' : ''}" data-id="${esc(m.id)}">
            <img class="baozi-chat-avatar" src="${esc(m.avatar)}" alt="">
            <div class="baozi-chat-main">
                <div class="baozi-chat-meta"><b>${esc(m.author)}</b> <span>${fmtTime(m.ts)}</span></div>
                ${text ? `<div class="baozi-chat-bubble" data-raw>${text}</div>` : ''}
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
                <h3>💬 <span id="baozi-chat-title" data-raw>聊天</span></h3>
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
            // 自己剛送出、還在轉圈圈的那則先被推回來了：把轉圈圈的那份拿掉
            if (m.mine) {
                const dup = [...list.querySelectorAll('.baozi-chat-msg.pending')]
                    .find(el => el.querySelector('.baozi-chat-bubble')?.textContent === m.text);
                dup?.remove();
            }
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
        // 切到背景時線可能早就斷了、只是還沒發現：先補一次，不等它
        else catchUp().catch(() => {});
    }
    document.addEventListener('visibilitychange', onVisible);

    chatSession = { stop };

    // 按下送出就先把訊息放上去（轉圈圈），大包子貼好會把那則回傳，換成真的；
    // 不等 WebSocket 推回來 —— 手機的連線有時候其實斷了，等推送會看起來像按了沒反應。
    let pendingSeq = 0;

    function myAvatar() {
        const mine = list.querySelectorAll('.baozi-chat-msg.mine:not(.pending) .baozi-chat-avatar');
        return mine.length ? mine[mine.length - 1].getAttribute('src') : '';
    }

    async function sendText(text) {
        if (list.querySelector('.baozi-loading, .baozi-empty')) list.innerHTML = '';
        const tempId = 'pending-' + (++pendingSeq);
        list.insertAdjacentHTML('beforeend', messageHtml({
            id: tempId, author: bot.me?.name || '', avatar: myAvatar(), text,
            ts: new Date().toISOString(), mine: true,
        }));
        const el = list.querySelector(`[data-id="${tempId}"]`);
        el.classList.add('pending');
        el.querySelector('.baozi-chat-meta').insertAdjacentHTML('beforeend', '<span class="baozi-chat-spin"></span>');
        list.scrollTop = list.scrollHeight;
        try {
            const res = await botFetch('/club/chat', { method: 'POST', body: { text } });
            el.remove();
            if (res.message) append([res.message]);
            else await catchUp();
        } catch (e) {
            el.classList.remove('pending');
            el.classList.add('failed');
            el.querySelector('.baozi-chat-spin')?.remove();
            el.querySelector('.baozi-chat-main').insertAdjacentHTML('beforeend',
                `<button class="baozi-chat-retry">❌ ${esc(t('沒送出，點一下重送'))}</button>`);
            el.querySelector('.baozi-chat-retry').addEventListener('click', () => {
                el.remove();
                sendText(text);
            });
        }
        // 順便確認連線還活著：斷了就重連（重連會補上漏掉的）
        if (!ws || ws.readyState !== WebSocket.OPEN) { clearTimeout(retryTimer); retry = 0; connect(); }
    }

    function send() {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        input.style.height = '';
        input.focus();
        sendText(text);
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


// ============================================================
// 🔔 通知（目前只有朋友力推）
// ============================================================

export async function fetchNotifications() {
    return await botFetch('/club/notifications');
}

function timeAgo(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return '剛剛';
    if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
    return `${Math.floor(s / 86400)} 天前`;
}

/**
 * @param ui {back(), openCommand(cmd, label), onRead()}
 */
export async function renderNotificationsScreen(container, ui) {
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>🔔 通知</h3>
            </div>
            <div class="baozi-list" id="baozi-notif-list"><div class="baozi-loading">載入中...</div></div>
        </div>
    `;
    container.querySelector('#baozi-back').addEventListener('click', ui.back);
    const list = container.querySelector('#baozi-notif-list');
    let data;
    try {
        data = await fetchNotifications();
    } catch (e) {
        list.innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
        return;
    }
    if (!data.items.length) {
        list.innerHTML = '<div class="baozi-empty">還沒有通知～朋友推小劇場給你時會出現在這裡</div>';
        return;
    }
    list.innerHTML = data.items.map(n => `
        <div class="baozi-notif-item ${n.read ? '' : 'unread'}" data-id="${n.id}" data-prompt="${n.prompt_id}">
            <span class="baozi-notif-icon">💌</span>
            <div class="baozi-notif-body">
                <div><b>${esc(n.from)}</b>推薦你來玩這個！《<span data-raw>${esc(n.title)}</span>》</div>
                ${n.note ? `<div class="baozi-notif-text" data-raw>「${esc(n.note)}」</div>` : ''}
                <div class="baozi-notif-time">${timeAgo(n.at)}</div>
            </div>
        </div>`).join('') + (data.unread
        ? '<button class="baozi-btn-small baozi-btn-full" id="baozi-notif-all" style="margin-top:12px;">✓ 全部標為已讀</button>' : '');

    list.addEventListener('click', async (ev) => {
        if (ev.target.closest('#baozi-notif-all')) {
            await botFetch('/club/notifications/read', { method: 'POST', body: {} });
            ui.onRead?.();
            renderNotificationsScreen(container, ui);
            return;
        }
        const item = ev.target.closest('.baozi-notif-item');
        if (!item) return;
        try {
            botFetch('/club/notifications/read', { method: 'POST', body: { ids: [Number(item.dataset.id)] } })
                .then(() => ui.onRead?.()).catch(() => {});
            const cmd = await botFetch('/club/commands/' + item.dataset.prompt);
            const n = data.items.find(x => String(x.id) === item.dataset.id);
            ui.openCommand(cmd, '🔔 從通知打開');
        } catch (e) {
            alert(t(e.message));
        }
    });
}
