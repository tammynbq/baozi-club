// ============================================================
// ✨ 讓模型設計排版（自訂 API）
// ============================================================
// 模型讀她選的句子，挑一款骨架（六款之一），再決定配色、字體、標題。
// 不讓模型自由寫整頁：那樣常常跑版、字超出框、每次差很多；套骨架穩定、也好看。
//
// API 存在這支手機上（跟戀人手帳一樣，可以存好幾組）：名稱、網址、金鑰、模型。
// 用 OpenAI 相容的 /chat/completions。金鑰只在手機上，不會傳給大包子。
// ============================================================

import { t } from './i18n.js';

const KEY_PROFILES = 'baozi_ai_profiles';
const KEY_ACTIVE = 'baozi_ai_active';

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

export function loadProfiles() {
    try { return JSON.parse(localStorage.getItem(KEY_PROFILES) || '[]'); } catch { return []; }
}

function saveProfiles(list) {
    try { localStorage.setItem(KEY_PROFILES, JSON.stringify(list)); } catch { /* 存不了 */ }
}

export function activeProfile() {
    const list = loadProfiles();
    let id = null;
    try { id = localStorage.getItem(KEY_ACTIVE); } catch { /* 讀不到 */ }
    return list.find(p => p.id === id) || list[0] || null;
}

function maskKey(key) {
    return key ? '••••' + String(key).slice(-4) : '（沒填）';
}

/** 網址整理成 .../v1 這樣，後面接 /chat/completions。 */
function endpoint(base) {
    let url = String(base || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (/\/chat\/completions$/.test(url)) return url;
    if (!/\/v\d+$/.test(url)) url += '/v1';
    return url + '/chat/completions';
}

export async function callModel(profile, messages, { maxTokens = 600, temperature = 0.9 } = {}) {
    let res;
    try {
        res = await fetch(endpoint(profile.base), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + profile.key },
            body: JSON.stringify({ model: profile.model, messages, max_tokens: maxTokens, temperature }),
        });
    } catch {
        throw new Error('連不上這個 API（網址對嗎？）');
    }
    let data = null;
    try { data = await res.json(); } catch { /* 不是 JSON */ }
    if (!res.ok) throw new Error(data?.error?.message || `API 回了 ${res.status}`);
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error('模型回了空的內容');
    return text;
}


// ============================================================
// 設計
// ============================================================

const SKELETONS = {
    book: '書頁摘抄：米白紙、引號、署名，像從小說摘一段',
    polaroid: '拍立得手帳：圖片放進拍立得、手寫字，可愛日常',
    cinema: '電影字幕：圖片鋪滿當背景、白色字幕，氣氛強烈',
    ancient: '古風直排：宣紙、直排、毛筆標題、紅印章，適合古風',
    letter: '信箋：橫線信紙、手寫字、郵票郵戳，溫柔書信感',
    ticket: '電影票根：左邊句子右邊圖，俏皮',
};

const SYSTEM = `你是一位排版設計師，替一段角色扮演小劇場的摘錄設計分享圖。
只能從這六款骨架裡挑一款：
${Object.entries(SKELETONS).map(([k, v]) => `- ${k}：${v}`).join('\n')}

然後決定：
- palette：bg（底色）、text（主要文字）、muted（次要文字）、accent（點綴），都用 #RRGGBB；
  文字和底色要有足夠對比，讀得清楚。cinema 的底色會被圖蓋住，主要決定 accent。
- font：serif（宋體）、kai（楷體／手寫）、brush（毛筆，只適合古風）三選一
- title：替這段內容取一個 4～12 字的標題，貼合內容的氣氛，不要用引號

只回一個 JSON，不要其他文字：
{"base":"…","palette":{"bg":"#…","text":"#…","muted":"#…","accent":"#…"},"font":"…","title":"…","why":"一句話說為什麼這樣設計"}`;

function parseJson(text) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('模型沒有回 JSON');
    try { return JSON.parse(m[0]); } catch { throw new Error('模型回的 JSON 壞掉了'); }
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * 讓模型設計。回傳 { base, theme, title, why }，theme 可以直接丟給 renderTemplate。
 * @param data 截圖的 data（lines、charName、userName、title）
 * @param FONTS templates.js 的字體對照
 */
export async function design(data, FONTS) {
    const profile = activeProfile();
    if (!profile) throw new Error('還沒有設定自訂 API～到「設定 → ✨ 排版模型」加一組');
    const excerpt = data.lines.map(l => `${l.who === 'user' ? `（${l.name}）` : `${l.name}：`}${l.text}`).join('\n');
    const user = `角色：${data.charName}　她：${data.userName}${data.title ? `　小劇場：《${data.title}》` : ''}
有沒有圖片：${data.images.length ? '有' : '沒有'}

摘錄：
${excerpt.slice(0, 1500)}`;
    const raw = await callModel(profile, [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
    ]);
    const j = parseJson(raw);
    const base = SKELETONS[j.base] ? j.base : 'book';
    const theme = {};
    for (const k of ['bg', 'text', 'muted', 'accent']) {
        if (HEX.test(j.palette?.[k] || '')) theme[k] = j.palette[k];
    }
    if (theme.muted) { theme.line = theme.muted + '55'; theme.line2 = theme.muted + '99'; }
    const font = FONTS[j.font] || null;
    if (font) {
        theme.font = j.font === 'brush' ? FONTS.kai : font;      // 內文不用毛筆，太難讀
        if (j.font === 'brush') theme.titleFont = FONTS.brush;
    }
    const title = String(j.title || '').replace(/[「」『』《》"“”]/g, '').trim().slice(0, 16);
    return { base, theme, title, why: String(j.why || '').slice(0, 80) };
}


// ============================================================
// 設定畫面
// ============================================================

export function renderAiSettings(box) {
    const list = loadProfiles();
    const active = activeProfile();
    box.innerHTML = `
        <div class="baozi-setup-hint">截圖時按「✨ 讓模型設計」，模型會讀你選的句子，替它挑排版、配色、字體和標題。
            用 OpenAI 相容的 API；金鑰只存在這支手機上。</div>
        <div class="baozi-ai-list">
            ${list.length ? list.map(p => `
                <div class="baozi-ai-item ${active && p.id === active.id ? 'on' : ''}" data-id="${esc(p.id)}">
                    <div class="baozi-ai-main" data-a="use">
                        <b>${esc(p.name)}</b>${active && p.id === active.id ? ' <span class="baozi-lib-badge">使用中</span>' : ''}
                        <div class="baozi-ai-sub">${esc(p.model)} · ${esc(maskKey(p.key))}</div>
                    </div>
                    <button class="baozi-btn-small" data-a="edit">✏️</button>
                    <button class="baozi-btn-small" data-a="del">🗑️</button>
                </div>`).join('') : '<div class="baozi-setup-hint">還沒有～加一組吧</div>'}
        </div>
        <button class="baozi-btn-small baozi-btn-full" data-a="add">＋ 加一組 API</button>
        <div class="baozi-ai-form" hidden></div>`;

    const form = box.querySelector('.baozi-ai-form');
    const openForm = (p = null) => {
        form.hidden = false;
        form.innerHTML = `
            <input type="text" class="baozi-search" data-f="name" placeholder="名稱（自己看得懂就好）" value="${esc(p?.name || '')}">
            <input type="text" class="baozi-search" data-f="base" placeholder="API 網址，例如 https://xxx.com/v1" value="${esc(p?.base || '')}" autocapitalize="off" autocorrect="off">
            <input type="password" class="baozi-search" data-f="key" placeholder="${p ? `金鑰（不改就留空，現在是 ${esc(maskKey(p.key))}）` : '金鑰'}" autocomplete="off">
            <input type="text" class="baozi-search" data-f="model" placeholder="模型名稱" value="${esc(p?.model || '')}" autocapitalize="off" autocorrect="off">
            <div class="baozi-shot-actions">
                <button class="baozi-btn-small baozi-on" data-a="save">💾 存</button>
                <button class="baozi-btn-small" data-a="test">🔌 測試</button>
                <button class="baozi-btn-small" data-a="cancel">取消</button>
            </div>
            <div class="baozi-setup-hint" data-k="msg"></div>`;
        form.dataset.editing = p?.id || '';
    };
    const read = () => {
        const editing = loadProfiles().find(x => x.id === form.dataset.editing);
        const v = k => form.querySelector(`[data-f="${k}"]`).value.trim();
        return {
            id: editing?.id || String(Date.now()),
            name: v('name') || v('model') || 'API',
            base: v('base'),
            key: v('key') || editing?.key || '',
            model: v('model'),
        };
    };

    box.onclick = async (ev) => {
        const btn = ev.target.closest('[data-a]');
        if (!btn) return;
        const a = btn.dataset.a;
        const id = btn.closest('[data-id]')?.dataset.id;
        if (a === 'add') { openForm(); return; }
        if (a === 'cancel') { form.hidden = true; return; }
        if (a === 'use' && id) {
            try { localStorage.setItem(KEY_ACTIVE, id); } catch { /* 存不了 */ }
            renderAiSettings(box);
            return;
        }
        if (a === 'edit' && id) { openForm(loadProfiles().find(p => p.id === id)); return; }
        if (a === 'del' && id) {
            if (!confirm(t('刪掉這組 API？'))) return;
            saveProfiles(loadProfiles().filter(p => p.id !== id));
            renderAiSettings(box);
            return;
        }
        const msg = form.querySelector('[data-k="msg"]');
        if (a === 'test') {
            const p = read();
            if (!p.base || !p.key || !p.model) { msg.textContent = '網址、金鑰、模型都要填'; return; }
            msg.innerHTML = '<span class="baozi-chat-spin"></span> 測試中…';
            try {
                const reply = await callModel(p, [{ role: 'user', content: '回我「包子好香」四個字就好' }], { maxTokens: 20, temperature: 0 });
                msg.textContent = '✅ 通了：' + reply.slice(0, 30);
            } catch (e) {
                msg.textContent = '❌ ' + e.message;
            }
            return;
        }
        if (a === 'save') {
            const p = read();
            if (!p.base || !p.key || !p.model) { msg.textContent = '網址、金鑰、模型都要填'; return; }
            const all = loadProfiles();
            const i = all.findIndex(x => x.id === p.id);
            if (i >= 0) all[i] = p; else all.push(p);
            saveProfiles(all);
            if (!activeProfile() || all.length === 1) { try { localStorage.setItem(KEY_ACTIVE, p.id); } catch { /* */ } }
            renderAiSettings(box);
        }
    };
}
