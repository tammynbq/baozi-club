// ============================================================
// 🏷️ 版本號、更新紀錄、有新版的提醒
// ============================================================
// 裝著的版本＝插件資料夾裡的 manifest.json；每一版更新了什麼＝changelog.json。
// 最新版本跟大包子要（GET /club/version，大包子去 GitHub 抓）—— 一帆連不上 GitHub，
// 但連得上大包子。
//
// 打開酒館時小包子最多說一句：
//   有新版、這一版還沒提醒過 → 「有新版了，去擴充那邊更新」
//   剛更新完（比上次看過的新）→ 「更新好了！這次多了…」
// ============================================================

import { botFetch, isBotLoggedIn } from './bot.js';
import { localizeLive, t } from './i18n.js';
import { showBubble, closeBubble } from './xiaobaozi.js';

const SEEN_KEY = 'baozi_seen_version';       // 上次看過「更新了什麼」的版本
const NAGGED_KEY = 'baozi_nagged_version';   // 已經提醒過「有新版」的版本

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

function store(key, value) {
    try {
        if (value === undefined) return localStorage.getItem(key);
        localStorage.setItem(key, value);
    } catch { /* 存不了就算了 */ }
    return null;
}

/** 比版本：a 比 b 新就是正數。 */
export function cmpVer(a, b) {
    const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] || 0) - (pb[i] || 0);
        if (d) return d;
    }
    return 0;
}

async function localJson(name) {
    const res = await fetch(new URL(name, import.meta.url), { cache: 'no-store' });
    return res.json();
}

let installedCache = null;
/** 裝著的版本。 */
export async function installedVersion() {
    if (!installedCache) {
        try { installedCache = (await localJson('manifest.json')).version || '?'; } catch { installedCache = '?'; }
    }
    return installedCache;
}

let localLogCache = null;
async function localChangelog() {
    if (!localLogCache) {
        try { localLogCache = await localJson('changelog.json'); } catch { localLogCache = []; }
    }
    return Array.isArray(localLogCache) ? localLogCache : [];
}

let latestCache = null;
/** 大包子知道的最新版：{latest, changelog}；問不到就 null。 */
export async function latestInfo() {
    if (latestCache) return latestCache;
    if (!isBotLoggedIn()) return null;
    try {
        const data = await botFetch('/club/version');
        if (data?.latest) latestCache = data;
    } catch { /* 問不到就當沒有新版 */ }
    return latestCache;
}

/** 介於 from（不含）和 to（含）之間的每一版，新的在前。 */
function between(log, from, to) {
    return log.filter(v => cmpVer(v.version, from) > 0 && cmpVer(v.version, to) <= 0)
        .sort((a, b) => cmpVer(b.version, a.version));
}

function entryHtml(v) {
    return `
        <div class="baozi-ver-entry">
            <div class="baozi-ver-head"><b>${esc(v.version)}</b><span>${esc(v.date || '')}</span></div>
            <ul>${(v.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        </div>`;
}

/** 標題旁邊的版本號：有新版就多一個小紅點。 */
export async function mountVersionChip(header) {
    const logo = header.querySelector('.baozi-logo');
    if (!logo || header.querySelector('#baozi-ver')) return;
    const chip = document.createElement('button');
    chip.id = 'baozi-ver';
    chip.className = 'baozi-ver';
    chip.textContent = 'v' + await installedVersion();
    logo.after(chip);
    // 標題列可以拖，按版本號不要變成拖曳
    for (const type of ['mousedown', 'touchstart', 'pointerdown']) {
        chip.addEventListener(type, ev => ev.stopPropagation(), { passive: true });
    }
    chip.addEventListener('click', (ev) => { ev.stopPropagation(); openVersionModal(); });
    const info = await latestInfo();
    if (info && cmpVer(info.latest, await installedVersion()) > 0) chip.classList.add('has-new');
}

/** 點版本號打開的小視窗：有新版就寫在最上面，下面是從上次看過到現在的每一版。 */
export async function openVersionModal() {
    const mine = await installedVersion();
    const info = await latestInfo();
    const local = await localChangelog();
    const seen = store(SEEN_KEY);
    const hasNew = info && cmpVer(info.latest, mine) > 0;

    // 新版的內容只有大包子那份有；裝著的版本以前的用自己那份
    const upcoming = hasNew ? between(info.changelog || [], mine, info.latest) : [];
    const sinceSeen = seen && cmpVer(mine, seen) > 0 ? between(local, seen, mine) : [];
    const recent = sinceSeen.length ? sinceSeen : between(local, '0', mine).slice(0, 5);
    const older = between(local, '0', mine).filter(v => !recent.includes(v));

    const modal = document.createElement('div');
    modal.className = 'baozi-shot-modal';
    modal.innerHTML = `
        <div class="baozi-shot-card baozi-ver-card">
            <div class="baozi-shot-title">🥟 包子同好會 v${esc(mine)}</div>
            ${hasNew ? `
                <div class="baozi-ver-new">
                    ✨ 有新版 <b>${esc(info.latest)}</b> 可以更新：酒館的「擴充功能」→「管理擴充功能」→ 包子同好會旁邊的更新按鈕
                </div>
                ${upcoming.map(entryHtml).join('')}
                <div class="baozi-ver-sep">你現在用的</div>` : ''}
            ${sinceSeen.length ? `<div class="baozi-setup-hint">從 ${esc(seen)} 到現在更新了這些：</div>` : ''}
            ${recent.map(entryHtml).join('')}
            ${older.length ? `<details class="baozi-ver-older"><summary>更早的版本</summary>${older.map(entryHtml).join('')}</details>` : ''}
            <div class="baozi-shot-actions"><button class="baozi-btn-small baozi-on" data-a="close">好</button></div>
        </div>`;
    document.body.appendChild(modal);
    localizeLive(modal);
    store(SEEN_KEY, mine);
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal || ev.target.closest('[data-a="close"]')) modal.remove();
    });
}

/**
 * 打開酒館時呼叫：要提醒就讓小包子說一句，回傳 true（今天的招呼就不說了，免得連說兩句）。
 */
export async function announceVersion() {
    const mine = await installedVersion();
    if (mine === '?') return false;
    const seen = store(SEEN_KEY);
    const info = await latestInfo();

    if (info && cmpVer(info.latest, mine) > 0 && store(NAGGED_KEY) !== info.latest) {
        store(NAGGED_KEY, info.latest);
        sayBubble(`包子有新版 ${info.latest} 了～去「擴充功能」那邊按一下更新`, true);
        return true;
    }
    if (!seen) {            // 第一次裝：不用講「更新了什麼」，記下來就好
        store(SEEN_KEY, mine);
        return false;
    }
    if (cmpVer(mine, seen) > 0) {
        const first = between(await localChangelog(), seen, mine)[0]?.items?.[0];
        sayBubble(`更新好了！${first ? `這次多了：${first}` : `現在是 ${mine} 版`}`, true);
        return true;
    }
    return false;
}

function sayBubble(line, withMore) {
    const bubble = showBubble(`
        <div class="xbz-say">${esc(line)}</div>
        <div class="baozi-toast-row">
            ${withMore ? '<button class="baozi-btn-small baozi-on" data-a="more">看看更新了什麼</button>' : ''}
            <button class="baozi-btn-small" data-a="bye">好～</button>
        </div>`);
    bubble.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (a === 'bye') closeBubble();
        if (a === 'more') { closeBubble(); openVersionModal().catch(e => alert(t(e.message))); }
    });
}
