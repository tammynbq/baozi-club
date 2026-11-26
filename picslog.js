// ============================================================
// 📜 寫 tag 的紀錄（2.26.0，一帆 #162：想看送了什麼給 Gemini、它回了什麼）
// ============================================================
// 每次寫 tag 記一筆：送出去的每一段（條目名稱、變數填好之後的內容）、觸發詞沒對上沒送的條目、回覆原文、錯誤。
// 存在這支手機的 IndexedDB（一次可能幾萬字，localStorage 放不下），只留最近 KEEP 筆；打不開就只記在記憶體。

import { localizeLive, t } from './i18n.js';

const KEEP = 10;
const DB = 'baozi-pics';
const STORE = 'logs';

let memory = [];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function openDb() {
    return new Promise((resolve) => {
        try {
            const req = indexedDB.open(DB, 1);
            req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

function tx(db, mode, fn) {
    return new Promise((resolve) => {
        try {
            const t0 = db.transaction(STORE, mode);
            const out = fn(t0.objectStore(STORE));
            t0.oncomplete = () => resolve(out?.result ?? null);
            t0.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

/** 記一筆（舊的超過 KEEP 筆就刪掉）。 */
export async function addLog(entry) {
    const e = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), ...entry };
    memory = [e, ...memory].slice(0, KEEP);
    const db = await openDb();
    if (!db) return e;
    await tx(db, 'readwrite', s => s.put(e));
    const all = await tx(db, 'readonly', s => s.getAll());
    const old = (all || []).sort((a, b) => b.at - a.at).slice(KEEP);
    if (old.length) await tx(db, 'readwrite', s => { for (const o of old) s.delete(o.id); });
    db.close();
    return e;
}

/** 最近的紀錄（新的在前）。 */
export async function listLogs() {
    const db = await openDb();
    if (!db) return memory;
    const all = await tx(db, 'readonly', s => s.getAll());
    db.close();
    const list = (all || []).sort((a, b) => b.at - a.at);
    return list.length ? list : memory;
}

/** 這一則（同一個聊天、同一樓）最近一次的紀錄。 */
export async function logFor(chatKey, mesId) {
    return (await listLogs()).find(l => l.chat === chatKey && l.mesId === mesId) || null;
}

const len = (s) => String(s || '').length.toLocaleString();

/** 紀錄的標題一行：時間・提示詞・幾張或錯誤。 */
export function logLine(l) {
    const when = new Date(l.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const how = l.error ? `❌ ${l.error}` : `${l.count ?? 0} 張`;
    return `${when}・${l.prompt || ''}・第 ${l.mesId} 樓・${how}`;
}

/** 打開一筆紀錄：送出去的每一段（摺起來）、沒送的條目、回覆原文。 */
export function openLog(l) {
    document.getElementById('bzp-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'bzp-modal';
    m.className = 'bzp-modal';
    const total = (l.sent || []).reduce((n, x) => n + String(x.content || '').length, 0);
    const parts = (l.sent || []).map((x, i) => `
        <details class="bzp-log-part">
            <summary><b>${i + 1}.</b> <span class="bzp-log-role">${esc(x.role)}</span> <span data-raw>${esc(x.name || '')}</span> <span class="bzp-hint">${len(x.content)} 字</span></summary>
            <pre class="bzp-log-pre" data-raw>${esc(x.content)}</pre>
        </details>`).join('');
    // 模型回的放最上面、送出去的摺起來（一帆 #162：68 段排在前面，回覆的框被擠成一條縫）
    m.innerHTML = `<div class="bzp-modal-card bzp-wide bzp-log-card">
        <div class="bzp-modal-title">📜 這次寫 tag 送了什麼</div>
        <div class="bzp-hint" data-raw>${esc(logLine(l))}</div>
        <div class="bzp-meta-row"><span>API</span><b data-raw>${esc(l.api || '')}</b></div>
        ${l.demand ? `<div class="bzp-meta-row"><span>這次的需求</span><b data-raw>${esc(l.demand)}</b></div>` : ''}
        <div class="bzp-label">模型回的（${len(l.reply)} 字）</div>
        ${l.error ? `<div class="baozi-error" data-raw>${esc(l.error)}</div>` : ''}
        <pre class="bzp-log-pre bzp-log-reply" data-raw>${esc(l.reply || '（沒有回覆）')}</pre>
        <details class="bzp-log-sent">
            <summary class="bzp-label">送給模型的（${(l.sent || []).length} 段，共 ${total.toLocaleString()} 字）▸ 點開看</summary>
            <div class="bzp-log-parts">${parts || '<div class="bzp-hint">（沒有）</div>'}</div>
        </details>
        ${l.skipped?.length ? `<div class="bzp-label">觸發詞沒對上、這次沒送的條目（${l.skipped.length}）</div><div class="bzp-hint" data-raw>${esc(l.skipped.join('、'))}</div>` : ''}
        <div class="bzp-actions"><button data-a="copy">📋 全部複製</button><button data-close>✕</button></div>
    </div>`;
    document.body.appendChild(m);
    localizeLive(m);
    m.addEventListener('click', async (ev) => {
        if (ev.target === m || ev.target.closest('[data-close]')) { m.remove(); return; }
        if (ev.target.closest('[data-a="copy"]')) {
            const text = [logLine(l), `API：${l.api || ''}`, l.demand ? `需求：${l.demand}` : '',
                ...(l.sent || []).map((x, i) => `===== ${i + 1}. [${x.role}] ${x.name || ''} =====\n${x.content}`),
                l.skipped?.length ? `===== 沒送的條目 =====\n${l.skipped.join('、')}` : '',
                `===== 模型回的 =====\n${l.reply || ''}`].filter(Boolean).join('\n\n');
            let ok = false;
            try { await navigator.clipboard.writeText(text); ok = true; } catch { /* 複製不了 */ }
            ev.target.closest('[data-a="copy"]').textContent = t(ok ? '✓ 複製了' : '❌ 複製不了');
        }
    });
    return m;
}
