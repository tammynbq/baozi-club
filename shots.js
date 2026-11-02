// ============================================================
// 📸 截圖 + 🖼️ 文生圖分享 + 相簿
// ============================================================
// 選取模式：在酒館的聊天上點訊息就勾起來（點訊息裡的圖片是單選那張圖），
// 下面一條工具列：做成圖片／分享圖片／取消。
//
// 截圖不是照抄畫面（那種做法在 iOS 上常常字跑掉、圖片空白），
// 是自己用 canvas 重新排版：頭像、名字、泡泡、圖片、日期，底下一個小小的包子。
// 做好先預覽，再選「發到 DC」「只存不發」「存到手機」。
// ============================================================

import { bot, botFetch, currentCharacter, activePrompt } from './bot.js';
import { t, localizeLive } from './i18n.js';

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}


// ============================================================
// 選取模式
// ============================================================

let selecting = false;
let bar = null;

function messageImages(mes) {
    return [...mes.querySelectorAll('.mes_img, .mes_img_container img, .mes_text img')]
        .filter(img => img.naturalWidth > 0 || img.complete);
}

function counts() {
    const msgs = document.querySelectorAll('#chat .mes.baozi-picked').length;
    const imgs = document.querySelectorAll('#chat img.baozi-img-picked').length;
    return { msgs, imgs };
}

function refreshBar() {
    if (!bar) return;
    const { msgs, imgs } = counts();
    bar.querySelector('[data-k="count"]').textContent =
        msgs || imgs ? `已選 ${msgs} 則${imgs ? `、${imgs} 張圖` : ''}` : '點訊息勾起來；點圖片是選那張圖';
    bar.querySelector('[data-a="shot"]').disabled = !msgs;
    bar.querySelector('[data-a="images"]').disabled = !imgs;
}

function onChatClick(ev) {
    if (!selecting) return;
    const mes = ev.target.closest('#chat .mes');
    if (!mes) return;
    ev.preventDefault();
    ev.stopPropagation();
    const img = ev.target.closest('img');
    if (img && messageImages(mes).includes(img)) {
        img.classList.toggle('baozi-img-picked');
    } else {
        mes.classList.toggle('baozi-picked');
    }
    refreshBar();
}

export function exitSelectMode() {
    selecting = false;
    document.body.classList.remove('baozi-selecting');
    document.querySelectorAll('#chat .baozi-picked').forEach(el => el.classList.remove('baozi-picked'));
    document.querySelectorAll('#chat .baozi-img-picked').forEach(el => el.classList.remove('baozi-img-picked'));
    document.removeEventListener('click', onChatClick, true);
    bar?.remove();
    bar = null;
}

export function enterSelectMode() {
    if (selecting) return;
    if (!document.querySelector('#chat .mes')) { alert(t('先打開一個有對話的聊天～')); return; }
    selecting = true;
    document.body.classList.add('baozi-selecting');
    document.addEventListener('click', onChatClick, true);
    bar = document.createElement('div');
    bar.className = 'baozi-select-bar';
    bar.innerHTML = `
        <div class="baozi-select-count" data-k="count"></div>
        <div class="baozi-select-actions">
            <button class="baozi-btn-small baozi-on" data-a="shot">📸 做成圖片</button>
            <button class="baozi-btn-small" data-a="images">🖼️ 分享圖片</button>
            <button class="baozi-btn-small" data-a="cancel">✕ 取消</button>
        </div>`;
    document.body.appendChild(bar);
    localizeLive(bar);
    bar.addEventListener('click', async (ev) => {
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (a === 'cancel') exitSelectMode();
        if (a === 'shot') {
            const mesList = [...document.querySelectorAll('#chat .mes.baozi-picked')];
            exitSelectMode();
            await makeShot(mesList);
        }
        if (a === 'images') {
            const imgs = [...document.querySelectorAll('#chat img.baozi-img-picked')];
            exitSelectMode();
            await shareImages(imgs);
        }
    });
    refreshBar();
}


// ============================================================
// 截圖：自己排版畫成一張長圖
// ============================================================

const W = 1080;
const PAD = 44;
const AVATAR = 76;
const GAP = 18;
const FONT = '"PingFang TC","PingFang SC","Noto Sans CJK TC","Noto Sans CJK SC","Microsoft JhengHei",sans-serif';
const TEXT_SIZE = 34;
const LINE = Math.round(TEXT_SIZE * 1.6);
const MAX_AREA = 16_000_000;     // iOS 的 canvas 面積上限大約 16.7M 像素，超過會整張空白
const COLORS = {
    bg: '#FFF8EC', char: '#FFFFFF', user: '#FFD6CE', text: '#5E3B26',
    name: '#B88968', meta: '#C9A889', line: '#F5E6C8',
};

function loadImage(src) {
    return new Promise(resolve => {
        if (!src) { resolve(null); return; }
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

const NO_LINE_START = '。，、；：？！」』）】》〉…—～,.;:?!)]}\'"”’';
const NO_LINE_END = '「『（【《〈“‘([{';

/** 中文一個字一個字換行；英文單字盡量不拆；標點照中文排版的習慣。 */
function wrap(ctx, text, maxWidth) {
    const lines = [];
    for (const para of String(text).split('\n')) {
        let line = '';
        const tokens = para.match(/[A-Za-z0-9'’\-.,!?]+|\s+|./gu) || [''];
        for (const tok of tokens) {
            const next = line + tok;
            // 句號、逗號、右引號這類不放行首：寧可讓這一行稍微超出一點
            if (ctx.measureText(next).width <= maxWidth || !line || NO_LINE_START.includes(tok)) {
                line = next;
            } else {
                // 「（這類開頭的符號不留在行尾：跟著下一個字一起換行
                let carry = '';
                while (line && NO_LINE_END.includes(line[line.length - 1])) {
                    carry = line[line.length - 1] + carry;
                    line = line.slice(0, -1);
                }
                lines.push(line.trimEnd());
                line = carry + tok.trimStart();
                // 單一個超長英文字：硬切
                while (ctx.measureText(line).width > maxWidth) {
                    let cut = line.length - 1;
                    while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
                    lines.push(line.slice(0, cut));
                    line = line.slice(cut);
                }
            }
        }
        lines.push(line.trimEnd());
    }
    // 頭尾的空行拿掉
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

async function collect(mesList) {
    const items = [];
    for (const mes of mesList) {
        const isUser = mes.getAttribute('is_user') === 'true' || mes.classList.contains('is_user');
        const textEl = mes.querySelector('.mes_text');
        // 用畫面上顯示的文字（已經是排版後的樣子，沒有 * 之類的符號）
        const text = (textEl?.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
        const name = mes.querySelector('.name_text')?.textContent?.trim() || '';
        const avatar = await loadImage(mes.querySelector('.avatar img')?.src);
        const images = [];
        for (const img of messageImages(mes)) {
            const loaded = await loadImage(img.currentSrc || img.src);
            if (loaded) images.push(loaded);
        }
        items.push({ isUser, text, name, avatar, images });
    }
    return items;
}

/** 回傳一個 Blob（png，太大就 jpg）。 */
async function render(items, { title }) {
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `${TEXT_SIZE}px ${FONT}`;
    const bubbleMax = W - PAD * 2 - AVATAR - GAP - 60;
    const imgMax = bubbleMax;

    // 先量好每一則的高度
    const layout = items.map(it => {
        // 留一個字的空間給「不放行首」的標點掛在行尾
        const lines = it.text ? wrap(measure, it.text, bubbleMax - 48 - TEXT_SIZE) : [];
        const textW = lines.length ? Math.max(...lines.map(l => measure.measureText(l).width)) : 0;
        const imgs = it.images.map(img => {
            const scale = Math.min(1, imgMax / img.width, 900 / img.height);
            return { img, w: Math.round(img.width * scale), h: Math.round(img.height * scale) };
        });
        const bubbleW = lines.length ? Math.min(bubbleMax, textW + 48) : 0;
        const bubbleH = lines.length ? lines.length * LINE + 36 : 0;
        const imgsH = imgs.reduce((sum, i) => sum + i.h + 14, 0);
        const height = 40 + bubbleH + imgsH + 30;   // 名字 + 泡泡 + 圖 + 間距
        return { ...it, lines, bubbleW, bubbleH, imgs, height: Math.max(height, AVATAR + 30) };
    });
    const headerH = 130;
    const footerH = 110;
    const totalH = headerH + layout.reduce((s, l) => s + l.height, 0) + footerH;

    const scale = Math.min(1, Math.sqrt(MAX_AREA / (W * totalH)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(totalH * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, totalH);

    // 標題列
    ctx.fillStyle = COLORS.text;
    ctx.font = `bold 40px ${FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText(title.main, PAD, 40);
    ctx.font = `26px ${FONT}`;
    ctx.fillStyle = COLORS.meta;
    ctx.fillText(title.sub, PAD, 92);
    ctx.fillStyle = COLORS.line;
    ctx.fillRect(PAD, headerH - 6, W - PAD * 2, 3);

    let y = headerH + 20;
    for (const it of layout) {
        const right = it.isUser;
        const avX = right ? W - PAD - AVATAR : PAD;
        // 頭像（圓形）
        ctx.save();
        ctx.beginPath();
        ctx.arc(avX + AVATAR / 2, y + AVATAR / 2, AVATAR / 2, 0, Math.PI * 2);
        ctx.clip();
        if (it.avatar) {
            const s = Math.max(AVATAR / it.avatar.width, AVATAR / it.avatar.height);
            const w = it.avatar.width * s, h = it.avatar.height * s;
            ctx.drawImage(it.avatar, avX + (AVATAR - w) / 2, y + (AVATAR - h) / 2, w, h);
        } else {
            ctx.fillStyle = COLORS.line;
            ctx.fillRect(avX, y, AVATAR, AVATAR);
        }
        ctx.restore();

        const contentX = right ? W - PAD - AVATAR - GAP : PAD + AVATAR + GAP;
        // 名字
        ctx.font = `bold 26px ${FONT}`;
        ctx.fillStyle = COLORS.name;
        ctx.textAlign = right ? 'right' : 'left';
        ctx.fillText(it.name, contentX, y);
        ctx.textAlign = 'left';
        let cy = y + 40;
        // 泡泡
        if (it.lines.length) {
            const bx = right ? contentX - it.bubbleW : contentX;
            ctx.fillStyle = right ? COLORS.user : COLORS.char;
            ctx.shadowColor = 'rgba(139,90,60,0.12)';
            ctx.shadowBlur = 10;
            ctx.shadowOffsetY = 3;
            roundRect(ctx, bx, cy, it.bubbleW, it.bubbleH, 26);
            ctx.fill();
            ctx.shadowColor = 'transparent';
            ctx.fillStyle = COLORS.text;
            ctx.font = `${TEXT_SIZE}px ${FONT}`;
            it.lines.forEach((line, i) => ctx.fillText(line, bx + 24, cy + 18 + i * LINE + (LINE - TEXT_SIZE) / 2));
            cy += it.bubbleH + 14;
        }
        // 圖片
        for (const im of it.imgs) {
            const ix = right ? contentX - im.w : contentX;
            ctx.save();
            roundRect(ctx, ix, cy, im.w, im.h, 20);
            ctx.clip();
            ctx.drawImage(im.img, ix, cy, im.w, im.h);
            ctx.restore();
            cy += im.h + 14;
        }
        y += it.height;
    }

    // 底部
    ctx.fillStyle = COLORS.line;
    ctx.fillRect(PAD, totalH - footerH + 10, W - PAD * 2, 3);
    ctx.font = `26px ${FONT}`;
    ctx.fillStyle = COLORS.meta;
    ctx.textAlign = 'center';
    ctx.fillText('🥟 包子club', W / 2, totalH - footerH + 42);

    let blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (blob && blob.size > 4 * 1024 * 1024) {
        blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.88));
    }
    return blob;
}

function today() {
    const d = new Date();
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

async function makeShot(mesList) {
    if (!mesList.length) return;
    const modal = openModal('<div class="baozi-loading">📸 畫圖中…</div>');
    try {
        const items = await collect(mesList);
        const character = currentCharacter();
        const prompt = activePrompt();
        const charName = items.find(i => !i.isUser)?.name || character || '';
        const blob = await render(items, {
            title: {
                main: prompt ? `《${prompt.title}》` : (charName ? `和${charName}` : '包子club'),
                sub: [charName && prompt ? `和${charName}` : '', today()].filter(Boolean).join(' · '),
            },
        });
        if (!blob) throw new Error('畫不出來（手機記憶體不夠？少選幾則試試）');
        showPreview(modal, [{ blob, kind: 'shot' }], { character, prompt });
    } catch (e) {
        modal.querySelector('.baozi-shot-body').innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
    }
}


// ============================================================
// 文生圖：原圖直接傳
// ============================================================

/** 圖太大（> 8MB）就縮小轉 jpg，Discord 免費帳號上限 10MB。 */
async function imageBlob(img) {
    const res = await fetch(img.currentSrc || img.src);
    let blob = await res.blob();
    const okType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.type);
    if (okType && blob.size <= 8 * 1024 * 1024) return blob;
    const loaded = await loadImage(img.currentSrc || img.src);
    const scale = Math.min(1, Math.sqrt((6 * 1024 * 1024 * 4) / (loaded.width * loaded.height * 4)));
    const c = document.createElement('canvas');
    c.width = Math.round(loaded.width * scale);
    c.height = Math.round(loaded.height * scale);
    c.getContext('2d').drawImage(loaded, 0, 0, c.width, c.height);
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return blob;
}

async function shareImages(imgs) {
    if (!imgs.length) return;
    const modal = openModal('<div class="baozi-loading">🖼️ 讀圖中…</div>');
    try {
        const blobs = [];
        for (const img of imgs) blobs.push({ blob: await imageBlob(img), kind: 'image' });
        showPreview(modal, blobs, { character: currentCharacter(), prompt: activePrompt() });
    } catch (e) {
        modal.querySelector('.baozi-shot-body').innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
    }
}


// ============================================================
// 預覽 + 發到 DC／只存不發／存到手機
// ============================================================

function openModal(inner) {
    document.getElementById('baozi-shot-modal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'baozi-shot-modal';
    modal.className = 'baozi-shot-modal';
    modal.innerHTML = `<div class="baozi-shot-card"><div class="baozi-shot-body">${inner}</div></div>`;
    document.body.appendChild(modal);
    localizeLive(modal);
    modal.addEventListener('click', ev => { if (ev.target === modal) modal.remove(); });
    return modal;
}

async function upload(item, { character, prompt, caption, post }) {
    const params = new URLSearchParams({ kind: item.kind, post: post ? '1' : '0' });
    if (character) params.set('character', character);
    if (prompt) params.set('prompt_id', prompt.id);
    if (caption) params.set('caption', caption);
    const res = await fetch(bot.url + '/club/shots?' + params, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + bot.token, 'Content-Type': item.blob.type || 'image/png' },
        body: item.blob,
    });
    let data = null;
    try { data = await res.json(); } catch { /* 不是 JSON */ }
    if (!res.ok) throw new Error(data?.error || ('大包子回了 ' + res.status));
    return data;
}

function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function showPreview(modal, items, { character, prompt }) {
    const urls = items.map(i => URL.createObjectURL(i.blob));
    const body = modal.querySelector('.baozi-shot-body');
    const what = items[0].kind === 'shot' ? '截圖' : `${items.length} 張圖`;
    body.innerHTML = `
        <div class="baozi-shot-title">${items[0].kind === 'shot' ? '📸' : '🖼️'} ${what}</div>
        <div class="baozi-shot-preview">${urls.map(u => `<img src="${u}">`).join('')}</div>
        ${prompt ? `<div class="baozi-shot-meta">會附上：玩《<span data-raw>${esc(prompt.title)}</span>》${character ? `・${esc(character)}` : ''}<br>發到 DC 時也會貼到那則的論壇貼文底下</div>` : ''}
        <input type="text" class="baozi-search" data-f="caption" maxlength="300" placeholder="想說點什麼？（可以不寫）">
        <div class="baozi-shot-actions">
            <button class="baozi-btn-small baozi-on" data-a="post">📤 發到 DC</button>
            <button class="baozi-btn-small" data-a="save">💾 只存不發</button>
            <button class="baozi-btn-small" data-a="download">⬇️ 存到手機</button>
            <button class="baozi-btn-small" data-a="close">✕</button>
        </div>
        <div class="baozi-shot-status" data-k="status"></div>`;
    const status = body.querySelector('[data-k="status"]');
    body.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-a]');
        if (!btn) return;
        const a = btn.dataset.a;
        if (a === 'close') { modal.remove(); urls.forEach(u => URL.revokeObjectURL(u)); return; }
        if (a === 'download') {
            items.forEach((it, i) => download(it.blob, `baozi-${Date.now()}-${i + 1}.${it.blob.type === 'image/jpeg' ? 'jpg' : 'png'}`));
            status.textContent = '⬇️ 如果沒有跳出存檔，長按上面的圖也可以存';
            return;
        }
        body.querySelectorAll('[data-a="post"], [data-a="save"]').forEach(b => { b.disabled = true; });
        status.innerHTML = '<span class="baozi-chat-spin"></span> 上傳中…';
        const caption = body.querySelector('[data-f="caption"]').value.trim();
        try {
            for (const it of items) {
                await upload(it, { character, prompt, caption, post: a === 'post' });
            }
            status.textContent = a === 'post' ? '✅ 發到 DC 了，也存進相簿' : '✅ 存進相簿了，之後可以在「🖼️ 相簿」再發';
            setTimeout(() => { modal.remove(); urls.forEach(u => URL.revokeObjectURL(u)); }, 1800);
        } catch (e) {
            status.textContent = '❌ ' + e.message;
            body.querySelectorAll('[data-a="post"], [data-a="save"]').forEach(b => { b.disabled = false; });
        }
    });
}


// ============================================================
// 🖼️ 相簿（club 裡的一個畫面）
// ============================================================

async function shotUrl(id) {
    const res = await fetch(`${bot.url}/club/shots/${id}/image`, {
        headers: { Authorization: 'Bearer ' + bot.token },
    });
    if (!res.ok) throw new Error('讀不到圖');
    return URL.createObjectURL(await res.blob());
}

export async function renderAlbumScreen(container, ui) {
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>🖼️ 相簿</h3>
            </div>
            <button class="baozi-btn-small baozi-btn-full baozi-on" id="baozi-album-new">📸 去聊天裡選訊息截圖／分享圖片</button>
            <div class="baozi-album" id="baozi-album"><div class="baozi-loading">載入中...</div></div>
        </div>`;
    container.querySelector('#baozi-back').addEventListener('click', ui.back);
    container.querySelector('#baozi-album-new').addEventListener('click', () => { ui.closePanel(); enterSelectMode(); });
    const grid = container.querySelector('#baozi-album');
    let shots;
    try {
        shots = (await botFetch('/club/shots')).shots;
    } catch (e) {
        grid.innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
        return;
    }
    if (!shots.length) {
        grid.innerHTML = '<div class="baozi-empty">相簿還是空的～截圖或分享圖片時按「只存不發」或「發到 DC」都會存進來</div>';
        return;
    }
    grid.innerHTML = shots.map(s => `
        <div class="baozi-album-item" data-id="${s.id}">
            <div class="baozi-album-thumb"><span class="baozi-chat-spin"></span></div>
            <div class="baozi-album-meta">
                ${s.kind === 'shot' ? '📸' : '🖼️'} ${new Date(s.at).toLocaleDateString()}
                ${s.prompt_title ? `<br><span data-raw>《${esc(s.prompt_title)}》</span>` : ''}
            </div>
            <div class="baozi-album-actions">
                ${s.posted_url ? '<span class="baozi-lib-badge">已發</span>' : '<button class="baozi-btn-small" data-a="post">📤 發</button>'}
                <button class="baozi-btn-small" data-a="del">🗑️</button>
            </div>
        </div>`).join('');
    // 縮圖一張一張載（要帶鑰匙，不能直接放 <img src>）
    for (const s of shots) {
        const box = grid.querySelector(`[data-id="${s.id}"] .baozi-album-thumb`);
        shotUrl(s.id).then(u => { box.innerHTML = `<img src="${u}">`; }).catch(() => { box.textContent = '❌'; });
    }
    grid.addEventListener('click', async (ev) => {
        const item = ev.target.closest('.baozi-album-item');
        if (!item) return;
        const id = item.dataset.id;
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (a === 'del') {
            if (!confirm(t('刪掉這張？（已經發到 DC 的不會被收回）'))) return;
            await botFetch(`/club/shots/${id}`, { method: 'DELETE' });
            item.remove();
            return;
        }
        if (a === 'post') {
            const btn = ev.target.closest('button');
            btn.disabled = true;
            try {
                await botFetch(`/club/shots/${id}/post`, { method: 'POST', body: {} });
                btn.outerHTML = '<span class="baozi-lib-badge">已發</span>';
            } catch (e) {
                btn.disabled = false;
                alert(t(e.message));
            }
            return;
        }
        const img = item.querySelector('.baozi-album-thumb img');
        if (img) {
            const modal = openModal(`<div class="baozi-shot-preview"><img src="${img.src}"></div>
                <div class="baozi-shot-actions"><button class="baozi-btn-small" data-a="close">✕</button></div>`);
            modal.querySelector('[data-a="close"]').addEventListener('click', () => modal.remove());
        }
    });
}
