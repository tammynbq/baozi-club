// ============================================================
// 🎨 生圖的設定頁（包子裡的一個畫面）
// ============================================================

import { loadProfiles } from './aidesign.js';
import { localizeLive, t } from './i18n.js';
import {
    esc, stx, store, saveStore, prefs, loadConns, saveConns, activeConn, setActiveConn, testConn,
    currentParams, usingLine, openArtistPicker, allPrompts, currentPrompt, BUILTIN_PROMPT,
    cardKey, seedLooks, renderAll,
} from './pics.js';

const maskKey = (k) => (k ? '••••' + String(k).slice(-4) : '（沒填）');
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function renderPicsScreen(container, ui) {
    seedLooks();
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>🎨 生圖</h3>
            </div>
            <div class="baozi-setup-hint">老公回完，在他那則底下按「🎨 生圖」（或訊息「…」選單裡的 🎨）：副 API 讀正文寫 tag → 每張一張小卡 → 按「🎨 畫」送 NovelAI。</div>
            <div class="baozi-form">
                <div class="baozi-setup-section-title">🖌️ 畫師串（跟著智繪姬）</div>
                <div id="bzp-set-artist"></div>
                <hr class="bzp-hr">
                <div class="baozi-setup-section-title">🔌 NovelAI 連線</div>
                <div id="bzp-set-conn"></div>
                <hr class="bzp-hr">
                <div class="baozi-setup-section-title">✍️ 寫 tag</div>
                <div id="bzp-set-tag"></div>
                <hr class="bzp-hr">
                <div class="baozi-setup-section-title">📝 寫 tag 的提示詞</div>
                <div id="bzp-set-prompt"></div>
                <hr class="bzp-hr">
                <div class="baozi-setup-section-title">🧍 固定外貌</div>
                <div id="bzp-set-looks"></div>
            </div>
        </div>`;
    container.querySelector('#baozi-back').addEventListener('click', ui.back);
    renderArtist(container.querySelector('#bzp-set-artist'));
    renderConns(container.querySelector('#bzp-set-conn'));
    renderTagPrefs(container.querySelector('#bzp-set-tag'));
    renderPrompts(container.querySelector('#bzp-set-prompt'));
    renderLooks(container.querySelector('#bzp-set-looks'));
    localizeLive(container);
}


// ---------- 🖌️ 畫師串 ----------

function renderArtist(box) {
    const p = currentParams();
    box.innerHTML = `
        ${p.hasChatu8 ? '' : '<div class="baozi-error">沒找到智繪姬：畫師串和參數是讀它的。先用包子的預設參數（V4.5、28 步），沒有畫師串。</div>'}
        <div class="baozi-info" data-raw>${esc(usingLine())}</div>
        <button class="baozi-btn-small baozi-btn-full" data-a="pick">🖌️ 換畫師串（讀 NAI 切換助手的收藏）</button>
        <div class="baozi-setup-hint">在 NAI 切換助手雙擊、抽卡、套參數預設，包子都會跟著換。V4.5／V5 的步數那些，請在切換助手把畫師串綁上它的「參數預設」。</div>`;
    box.querySelector('[data-a="pick"]').addEventListener('click', () => openArtistPicker(() => { renderArtist(box); renderAll(); }));
    localizeLive(box);
}


// ---------- 🔌 連線 ----------

function renderConns(box) {
    const list = loadConns();
    const cur = activeConn();
    const label = (c) => c.mode === 'custom' ? `第三方站・${esc(c.url)}` : `官網${c.viaBot ? '・經大包子轉送' : ''}`;
    box.innerHTML = `
        <div class="baozi-ai-list">
            ${list.length ? list.map(c => `
                <div class="baozi-ai-item ${cur?.id === c.id ? 'on' : ''}" data-id="${esc(c.id)}">
                    <div><b data-raw>${esc(c.name)}</b>${cur?.id === c.id ? ' ✓' : ''}<br><span class="bzp-hint" data-raw>${label(c)}・${esc(maskKey(c.key))}</span></div>
                    <div class="bzp-actions">
                        ${cur?.id === c.id ? '' : '<button data-a="use">用這組</button>'}
                        <button data-a="edit">✏️</button><button data-a="del">🗑️</button>
                    </div>
                </div>`).join('') : '<div class="baozi-setup-hint">還沒有～加一組吧</div>'}
        </div>
        <button class="baozi-btn-small baozi-btn-full" data-a="add">＋ 加一組連線</button>
        <div class="bzp-form" hidden></div>
        <div class="baozi-setup-hint">key 只存在這支手機，不會傳給大包子（除非打開「經大包子轉送」：大包子只幫忙轉，不存）。</div>`;
    const form = box.querySelector('.bzp-form');
    const open = (c = null) => {
        form.hidden = false;
        form.dataset.editing = c?.id || '';
        const mode = c?.mode || 'official';
        form.innerHTML = `
            <input type="text" class="baozi-search" data-f="name" placeholder="名稱（自己看得懂就好）" value="${esc(c?.name || '')}">
            <div class="bzp-cats">
                <button class="baozi-tag-chip ${mode === 'official' ? 'active' : ''}" data-mode="official">官網 key</button>
                <button class="baozi-tag-chip ${mode === 'custom' ? 'active' : ''}" data-mode="custom">第三方站</button>
            </div>
            <input type="text" class="baozi-search" data-f="url" placeholder="站的網址，例如 https://xxx.com（會自動接 /ai/generate-image）" value="${esc(c?.url || '')}" autocapitalize="off" autocorrect="off" ${mode === 'custom' ? '' : 'hidden'}>
            <input type="password" class="baozi-search" data-f="key" placeholder="${c ? `key（不改就留空，現在是 ${esc(maskKey(c.key))}）` : 'key（官網的是 pst- 開頭那串）'}" autocomplete="off">
            <label class="bzp-check" ${mode === 'official' ? '' : 'hidden'}><input type="checkbox" data-f="viaBot" ${c?.viaBot ? 'checked' : ''}> 經大包子轉送（手機連不上 NovelAI 時打開）</label>
            <div class="bzp-actions">
                <button class="baozi-on" data-a="save">💾 存</button><button data-a="test">🔌 測試</button><button data-a="cancel">取消</button>
            </div>
            <div class="baozi-setup-hint" data-k="msg"></div>`;
        form.dataset.connMode = mode;
        localizeLive(form);
    };
    const read = () => {
        const editing = loadConns().find(x => x.id === form.dataset.editing);
        const v = (k) => form.querySelector(`[data-f="${k}"]`);
        const mode = form.dataset.connMode;
        return {
            id: editing?.id || newId(),
            name: v('name').value.trim() || (mode === 'custom' ? '第三方站' : 'NovelAI 官網'),
            mode,
            url: mode === 'custom' ? v('url').value.trim() : '',
            key: v('key').value.trim() || editing?.key || '',
            viaBot: mode === 'official' && v('viaBot').checked,
        };
    };
    box.onclick = async (ev) => {
        const m = ev.target.closest('button[data-mode]');
        if (m) {
            form.dataset.connMode = m.dataset.mode;
            form.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('active', x === m));
            form.querySelector('[data-f="url"]').hidden = m.dataset.mode !== 'custom';
            form.querySelector('.bzp-check').hidden = m.dataset.mode !== 'official';
            return;
        }
        const btn = ev.target.closest('[data-a]');
        if (!btn) return;
        const a = btn.dataset.a;
        const id = btn.closest('[data-id]')?.dataset.id;
        if (a === 'add') { open(); return; }
        if (a === 'cancel') { form.hidden = true; return; }
        if (a === 'use') { setActiveConn(id); renderConns(box); return; }
        if (a === 'edit') { open(loadConns().find(c => c.id === id)); return; }
        if (a === 'del') {
            if (!confirm(t('刪掉這組連線？'))) return;
            saveConns(loadConns().filter(c => c.id !== id));
            renderConns(box);
            return;
        }
        const msg = form.querySelector('[data-k="msg"]');
        const c = read();
        if (!c.key || (c.mode === 'custom' && !c.url)) { msg.textContent = t(c.mode === 'custom' ? '網址和 key 都要填' : 'key 要填'); return; }
        if (a === 'test') {
            msg.innerHTML = '<span class="baozi-chat-spin"></span> ' + t('測試中…');
            try { msg.textContent = t(await testConn(c)); } catch (e) { msg.textContent = '❌ ' + t(e.message); }
            return;
        }
        if (a === 'save') {
            const all = loadConns();
            const i = all.findIndex(x => x.id === c.id);
            if (i >= 0) all[i] = c; else all.push(c);
            saveConns(all);
            if (all.length === 1 || !activeConn()) setActiveConn(c.id);
            renderConns(box);
        }
    };
    localizeLive(box);
}


// ---------- ✍️ 寫 tag ----------

function renderTagPrefs(box) {
    const pr = prefs();
    const apis = loadProfiles();
    box.innerHTML = `
        <div class="bzp-label">用哪組 API 寫 tag（跟「✨ 排版模型」共用，在設定裡加）</div>
        <div class="bzp-cats">
            ${apis.length ? apis.map(p => `<button class="baozi-tag-chip ${(pr.tagApi || apis[0].id) === p.id ? 'active' : ''}" data-api="${esc(p.id)}" data-raw>${esc(p.name)}</button>`).join('')
                : '<span class="baozi-setup-hint">還沒有 API～到「⚙️ 設定 → ✨ 排版模型」加一組（包子中轉也可以）</span>'}
        </div>
        <div class="bzp-label">一則畫幾張</div>
        <div class="bzp-cats">${[1, 2, 3, 4].map(n => `<button class="baozi-tag-chip ${Number(pr.count) === n ? 'active' : ''}" data-count="${n}">${n} 張</button>`).join('')}</div>
        <div class="bzp-label">什麼時候畫</div>
        <div class="bzp-cats">
            <button class="baozi-tag-chip ${pr.auto ? '' : 'active'}" data-auto="0">✋ 手動：按了才寫 tag、按了才畫</button>
            <button class="baozi-tag-chip ${pr.auto ? 'active' : ''}" data-auto="1">⚡ 自動：回完就寫 tag，排隊一張張畫</button>
        </div>
        <button class="baozi-tag-chip baozi-toggle-chip ${pr.lastChip ? 'active' : ''}" data-a="chip">${pr.lastChip ? '✓' : '○'} 最後一則老公的回覆底下顯示「🎨 生圖」</button>`;
    box.onclick = (ev) => {
        const el = ev.target.closest('[data-api],[data-count],[data-auto],[data-a]');
        if (!el) return;
        if (el.dataset.api) pr.tagApi = el.dataset.api;
        if (el.dataset.count) pr.count = Number(el.dataset.count);
        if (el.dataset.auto) pr.auto = el.dataset.auto === '1';
        if (el.dataset.a === 'chip') pr.lastChip = !pr.lastChip;
        saveStore();
        renderTagPrefs(box);
        renderAll();
    };
    localizeLive(box);
}


// ---------- 📝 提示詞 ----------

const PROMPT_TYPE = 'baozi-pic-prompt';

function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** 匯入：包子自己的格式、或酒館預設 JSON（prompts＋prompt_order）。 */
function readPromptFile(text, fileName) {
    const j = JSON.parse(String(text).replace(/^﻿/, ''));
    if (j?.type === PROMPT_TYPE && Array.isArray(j.entries)) return { name: j.name || fileName, entries: j.entries };
    if (Array.isArray(j?.entries) && j.name) return { name: j.name, entries: j.entries };     // 喵喵的 v2 也是這個樣子
    if (Array.isArray(j?.prompts) && Array.isArray(j?.prompt_order)) {
        const byId = new Map(j.prompts.filter(p => p?.identifier).map(p => [p.identifier, p]));
        const order = j.prompt_order.find(o => String(o?.character_id) === '100001')?.order || j.prompt_order[0]?.order || [];
        const entries = [];
        const seen = new Set();
        for (const o of order) {
            const p = byId.get(o?.identifier);
            if (!p || seen.has(p.identifier)) continue;
            seen.add(p.identifier);
            if (p.marker) continue;      // 酒館的位置記號（聊天紀錄、角色卡…）不是文字
            entries.push({ name: p.name || p.identifier, role: p.role || 'system', content: p.content || '', enabled: o.enabled !== false });
        }
        return { name: j.name || fileName.replace(/\.json$/i, '') || '酒館預設', entries };
    }
    throw new Error('看不懂這個檔案（要包子匯出的、或酒館預設的 JSON）');
}

function renderPrompts(box) {
    const s = store();
    const cur = currentPrompt();
    box.innerHTML = `
        <div class="bzp-cats">
            ${allPrompts().map(p => `<button class="baozi-tag-chip ${p.id === cur.id ? 'active' : ''}" data-pid="${esc(p.id)}" data-raw>${esc(p.name)}</button>`).join('')}
        </div>
        <div class="bzp-actions">
            <button data-a="edit">✏️ ${cur.id === 'builtin' ? '複製一份來改' : '編輯'}</button>
            <button data-a="dup">📄 複製</button>
            ${cur.id === 'builtin' ? '' : '<button data-a="del">🗑️ 刪</button>'}
            <button data-a="export">⬆️ 匯出</button>
            <button data-a="import">⬇️ 匯入</button>
            <input type="file" accept=".json,application/json" hidden data-f="file">
        </div>
        <div class="baozi-setup-hint">可以用的位置：{{正文}} {{角色設定}} {{用戶人設}} {{固定外貌}} {{張數}}，還有酒館的 {{char}} {{user}}。
        模型要照 &lt;pic&gt;&lt;scene&gt;…&lt;/scene&gt;&lt;tags&gt;…&lt;/tags&gt;&lt;/pic&gt; 回（也認 image###tag### 的格式）。</div>`;
    const copyOf = (p, name) => {
        const n = { id: newId(), name, entries: structuredClone(p.entries) };
        s.prompts.push(n);
        prefs().promptId = n.id;
        saveStore();
        return n;
    };
    box.onclick = async (ev) => {
        const chip = ev.target.closest('[data-pid]');
        if (chip) { prefs().promptId = chip.dataset.pid; saveStore(); renderPrompts(box); return; }
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        if (a === 'edit') {
            const p = cur.id === 'builtin' ? copyOf(BUILTIN_PROMPT, t('我的提示詞')) : cur;
            openPromptEditor(p, () => renderPrompts(box));
        }
        if (a === 'dup') { copyOf(cur, cur.name + t('（複製）')); renderPrompts(box); }
        if (a === 'del') {
            if (!confirm(t('刪掉這份提示詞？'))) return;
            s.prompts = s.prompts.filter(p => p.id !== cur.id);
            prefs().promptId = 'builtin';
            saveStore();
            renderPrompts(box);
        }
        if (a === 'export') download(`包子生圖提示詞-${cur.name}.json`, JSON.stringify({ type: PROMPT_TYPE, version: 1, name: cur.name, entries: cur.entries }, null, 2));
        if (a === 'import') box.querySelector('[data-f="file"]').click();
    };
    box.querySelector('[data-f="file"]').addEventListener('change', async (ev) => {
        const f = ev.target.files?.[0];
        if (!f) return;
        try {
            const got = readPromptFile(await f.text(), f.name);
            if (!got.entries.length) throw new Error('裡面沒有條目');
            s.prompts.push({ id: newId(), name: got.name, entries: got.entries });
            prefs().promptId = s.prompts.at(-1).id;
            saveStore();
            renderPrompts(box);
            globalThis.toastr?.success?.(t(`匯入「${got.name}」了（${got.entries.length} 條）`));
        } catch (e) {
            alert(t('匯入失敗：' + e.message));
        }
        ev.target.value = '';
    });
    localizeLive(box);
}

function openPromptEditor(p, onDone) {
    document.getElementById('bzp-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'bzp-modal';
    m.className = 'bzp-modal';
    const row = (e, i) => `
        <div class="bzp-entry" data-i="${i}">
            <div class="bzp-entry-head">
                <label class="bzp-check"><input type="checkbox" data-f="enabled" ${e.enabled ? 'checked' : ''}></label>
                <input type="text" class="baozi-search" data-f="name" value="${esc(e.name)}" data-raw>
                <select data-f="role">${['system', 'user', 'assistant'].map(r => `<option ${e.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
                <button data-a="up" title="往上">↑</button><button data-a="down" title="往下">↓</button><button data-a="rm" title="刪掉">🗑️</button>
            </div>
            <textarea data-f="content" rows="6" data-raw>${esc(e.content)}</textarea>
        </div>`;
    const paint = () => {
        m.innerHTML = `<div class="bzp-modal-card bzp-wide">
            <div class="bzp-modal-title">📝 編輯提示詞</div>
            <input type="text" class="baozi-search" data-f="title" value="${esc(p.name)}" placeholder="名稱" data-raw>
            <div class="bzp-entries">${p.entries.map(row).join('')}</div>
            <div class="bzp-actions"><button data-a="add">＋ 加一條</button><button class="baozi-on" data-a="done">💾 好了</button></div>
        </div>`;
        localizeLive(m);
    };
    const collect = () => {
        p.name = m.querySelector('[data-f="title"]').value.trim() || p.name;
        m.querySelectorAll('.bzp-entry').forEach(el => {
            const e = p.entries[Number(el.dataset.i)];
            e.enabled = el.querySelector('[data-f="enabled"]').checked;
            e.name = el.querySelector('[data-f="name"]').value;
            e.role = el.querySelector('[data-f="role"]').value;
            e.content = el.querySelector('[data-f="content"]').value;
        });
        saveStore();
    };
    paint();
    document.body.appendChild(m);
    m.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        collect();
        const i = Number(ev.target.closest('[data-i]')?.dataset.i);
        if (a === 'add') p.entries.push({ name: t('新的一條'), role: 'system', content: '', enabled: true });
        if (a === 'rm' && confirm(t('刪掉這一條？'))) p.entries.splice(i, 1);
        if (a === 'up' && i > 0) [p.entries[i - 1], p.entries[i]] = [p.entries[i], p.entries[i - 1]];
        if (a === 'down' && i < p.entries.length - 1) [p.entries[i + 1], p.entries[i]] = [p.entries[i], p.entries[i + 1]];
        saveStore();
        if (a === 'done') { m.remove(); onDone(); return; }
        paint();
    });
}


// ---------- 🧍 固定外貌 ----------

function renderLooks(box) {
    const s = store();
    const key = cardKey();
    const ctx = stx();
    const card = key ? (s.looks.cards[key] ??= []) : null;
    const list = (arr, scope) => `
        ${arr.map((l, i) => `
            <div class="bzp-look" data-scope="${scope}" data-i="${i}">
                <div class="bzp-look-head">
                    <input type="text" class="baozi-search" data-f="name" value="${esc(l.name)}" placeholder="名字（tag 裡寫 $名字$）" data-raw>
                    <button data-a="rm">🗑️</button>
                </div>
                <textarea data-f="tags" rows="2" placeholder="外貌 tag，例如 1boy, black hair, short hair, red eyes, tall" data-raw>${esc(l.tags)}</textarea>
                <textarea data-f="nsfw" rows="2" placeholder="🔞 補充（只有 NSFW 的圖才加上去，可以留空）" data-raw>${esc(l.nsfw || '')}</textarea>
            </div>`).join('') || '<div class="baozi-setup-hint">還沒有</div>'}
        <button class="baozi-btn-small" data-a="add" data-scope="${scope}">＋ 加一個角色</button>`;
    box.innerHTML = `
        <div class="baozi-setup-hint">副 API 畫到這些人時寫 $名字$，畫之前換成這裡的外貌 tag，每張圖的他才會長一樣。只寫不太會變的（髮色、瞳色、髮型、身材…），衣服表情讓副 API 照正文寫。「🔞 補充」只有 NSFW 的圖才加（小卡上的 🔞 亮著＝NSFW）。</div>
        ${card ? `<div class="bzp-label">這張卡（<span data-raw>${esc(ctx?.name2 || key)}</span>）</div>${list(card, 'card')}` : '<div class="baozi-setup-hint">開一個聊天，就能填這張卡的角色</div>'}
        <div class="bzp-label">每張卡都用（例如你自己）</div>
        ${list(s.looks.global, 'global')}`;
    const arrOf = (scope) => scope === 'card' ? card : s.looks.global;
    box.oninput = (ev) => {
        const row = ev.target.closest('.bzp-look');
        if (!row) return;
        const l = arrOf(row.dataset.scope)[Number(row.dataset.i)];
        l[ev.target.dataset.f] = ev.target.value;
        saveStore();
    };
    box.onclick = (ev) => {
        const btn = ev.target.closest('[data-a]');
        if (!btn) return;
        if (btn.dataset.a === 'add') { arrOf(btn.dataset.scope).push({ name: '', tags: '', nsfw: '' }); saveStore(); renderLooks(box); }
        if (btn.dataset.a === 'rm') {
            const row = btn.closest('.bzp-look');
            arrOf(row.dataset.scope).splice(Number(row.dataset.i), 1);
            saveStore();
            renderLooks(box);
        }
    };
    localizeLive(box);
}
