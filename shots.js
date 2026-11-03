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
// 選取模式：挑句子
// ============================================================
// 一進來就把每一樓的文字切成一句一句（遇到。！？…連同後面的右引號、或換行就切），
// 包成 <span class="baozi-sent" data-s="第幾句">。點一句就選那一句，同一句被斜體之類
// 切成好幾段時，點哪一段都是整句。離開時把每一樓的 HTML 還原，聊天紀錄不會被改到。

let selecting = false;
let bar = null;
// 原本的那一樓完全不動：只是先藏起來，旁邊放一份 club 自己的「選取用副本」。
// 以前是直接改寫那一樓再整段蓋回去 —— 智繪姬之類插件的摺疊框會被切碎、
// 自己再補畫一個（變成兩條），整段蓋回去也會讓它們的按鈕失效。
const hidden = [];               // [原本的 .mes_text, 它原本的 style.display]

const END_RE = /([。！？!?]+|…+|⋯+)([」』”’）)\]】》]*)/g;
const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TR']);

const IMG_URL_RE = /\.(png|jpe?g|webp|gif|avif)(\?|#|$)|^data:image\/|\/user\/images\//i;

function imgSrcOf(img) {
    return img.currentSrc || img.getAttribute('src') || img.dataset.src
        || img.dataset.original || img.getAttribute('data-lazy-src') || '';
}

/** 這一樓的圖（不管有沒有被摺疊起來）。頭像、小圖示不算。 */
function messageImageSrcs(mes) {
    const out = [];
    for (const img of mes.querySelectorAll('img')) {
        if (img.closest('.avatar, .baozi-sel-copy, .mes_buttons, .swipe_left, .swipe_right')) continue;
        const src = imgSrcOf(img);
        if (!src || out.includes(src)) continue;
        // 已經載好、但很小的（表情、圖示）不算；還沒載的（摺疊裡的）看網址像不像圖
        if (img.naturalWidth && img.naturalWidth < 64) continue;
        if (!img.naturalWidth && !IMG_URL_RE.test(src)) continue;
        out.push(src.startsWith('http') || src.startsWith('data:') ? src : new URL(src, location.href).href);
    }
    return out;
}

/** 做「選取用副本」：複製那一樓的文字，拿掉圖片和插件的按鈕、摺疊框之類的東西。 */
function makeCopy(textEl) {
    const copy = textEl.cloneNode(true);
    copy.removeAttribute('id');
    copy.className = 'mes_text baozi-sel-copy';
    copy.querySelectorAll('img, picture, video, audio, svg, canvas, iframe, button, script, style, '
        + 'summary, [role="button"], [onclick], input, textarea, select').forEach(el => el.remove());
    // 插件的摺疊框、標籤：拿掉圖片之後沒剩幾個字的，多半就是它們
    copy.querySelectorAll('[class*="fold"], [class*="collapse"], [class*="toggle"], [class*="expand"], '
        + '[class*="badge"], [class*="tag"]').forEach(el => {
        if ((el.textContent || '').trim().length <= 20) el.remove();
    });
    return copy;
}

/** 把一樓的文字切成句子。回傳句子總數。 */
function splitSentences(textEl) {
    let idx = 0;
    let started = false;      // 這一句已經有字了嗎
    let newline = false;      // 下一句前面要不要換行
    const startSentence = () => { if (started) { idx++; started = false; } };

    const walk = (node) => {
        for (const child of [...node.childNodes]) {
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.nodeValue;
                if (!text) continue;
                const frag = document.createDocumentFragment();
                // 先照換行切，再照句尾標點切
                const lines = text.split('\n');
                lines.forEach((line, li) => {
                    if (li > 0) { startSentence(); newline = true; }
                    let last = 0;
                    const pieces = [];
                    END_RE.lastIndex = 0;
                    let m;
                    while ((m = END_RE.exec(line))) {
                        pieces.push([line.slice(last, m.index + m[0].length), true]);
                        last = m.index + m[0].length;
                    }
                    if (last < line.length) pieces.push([line.slice(last), false]);
                    for (const [piece, ends] of pieces) {
                        if (!piece.trim()) { frag.append(piece); continue; }
                        const span = document.createElement('span');
                        span.className = 'baozi-sent';
                        span.dataset.s = String(idx);
                        if (!started && newline) span.dataset.nl = '1';
                        span.textContent = piece;
                        frag.append(span);
                        started = true;
                        newline = false;
                        if (ends) startSentence();
                    }
                });
                child.replaceWith(frag);
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                if (child.tagName === 'BR') { startSentence(); newline = true; continue; }
                if (child.tagName === 'IMG' || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
                const block = BLOCK_TAGS.has(child.tagName);
                if (block) { startSentence(); newline = true; }
                walk(child);
                if (block) { startSentence(); newline = true; }
            }
        }
    };
    walk(textEl);
    return idx + (started ? 1 : 0);
}

function pickedSentences(mes) {
    return new Set([...mes.querySelectorAll('.baozi-sent.picked')].map(s => s.dataset.s));
}

function counts() {
    let sents = 0, floors = 0;
    document.querySelectorAll('#chat .mes').forEach(mes => {
        const n = pickedSentences(mes).size;
        if (n) { sents += n; floors++; }
    });
    const imgs = document.querySelectorAll('#chat .baozi-sel-img.picked').length;
    return { sents, floors, imgs };
}

function refreshBar() {
    if (!bar) return;
    const { sents, floors, imgs } = counts();
    const parts = [];
    if (sents) parts.push(`${sents} 句（${floors} 樓）`);
    if (imgs) parts.push(`${imgs} 張圖`);
    bar.querySelector('[data-k="count"]').textContent =
        parts.length ? `已選 ${parts.join('、')}` : '點句子選起來；點圖片是選那張圖';
    bar.querySelector('[data-a="shot"]').disabled = !sents && !imgs;
    bar.querySelector('[data-a="images"]').disabled = !imgs;
    bar.querySelector('[data-a="fav"]').disabled = !floors && !imgs;
}

function setPicked(mes, s, on) {
    mes.querySelectorAll(`.baozi-sent[data-s="${s}"]`).forEach(el => el.classList.toggle('picked', on));
}

function onChatClick(ev) {
    if (!selecting) return;
    const mes = ev.target.closest('#chat .mes');
    if (!mes) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.target.closest('.baozi-pick-all')) {
        const all = [...new Set([...mes.querySelectorAll('.baozi-sent')].map(s => s.dataset.s))];
        const allOn = all.length && all.every(s => mes.querySelector(`.baozi-sent[data-s="${s}"]`).classList.contains('picked'));
        all.forEach(s => setPicked(mes, s, !allOn));
    } else if (ev.target.closest('.baozi-sel-img')) {
        ev.target.closest('.baozi-sel-img').classList.toggle('picked');
    } else {
        const sent = ev.target.closest('.baozi-sent');
        if (sent) setPicked(mes, sent.dataset.s, !sent.classList.contains('picked'));
    }
    mes.classList.toggle('baozi-picked', pickedSentences(mes).size > 0
        || !!mes.querySelector('.baozi-sel-img.picked'));
    refreshBar();
}

export function exitSelectMode() {
    selecting = false;
    keepScroll(() => {
        document.body.classList.remove('baozi-selecting');
        document.querySelectorAll('#chat .baozi-sel-copy, #chat .baozi-sel-imgs, #chat .baozi-pick-all')
            .forEach(el => el.remove());
        for (const [el, display] of hidden) el.style.display = display;
        hidden.length = 0;
        document.querySelectorAll('#chat .baozi-picked').forEach(el => el.classList.remove('baozi-picked'));
    });
    document.removeEventListener('click', onChatClick, true);
    bar?.remove();
    bar = null;
}

/** 趁還沒還原之前，把選了什麼讀出來（還原之後那些 span 就不見了）。 */
function readSelection() {
    const out = [];
    document.querySelectorAll('#chat .mes').forEach(mes => {
        const picked = pickedSentences(mes);
        const imgs = [...mes.querySelectorAll('.baozi-sel-img.picked')];
        if (!picked.size && !imgs.length) return;
        // 照句子順序組起來：連續的接在一起（原本有換行就換行），跳過的地方放「……」
        const sentences = new Map();
        mes.querySelectorAll('.baozi-sent').forEach(span => {
            const s = Number(span.dataset.s);
            if (!picked.has(span.dataset.s)) return;
            const cur = sentences.get(s) || { text: '', nl: false };
            if (!cur.text && span.dataset.nl) cur.nl = true;
            cur.text += span.textContent;
            sentences.set(s, cur);
        });
        let text = '';
        let prev = null;
        for (const s of [...sentences.keys()].sort((a, b) => a - b)) {
            const { text: piece, nl } = sentences.get(s);
            if (prev === null) text = piece.trim();
            else if (s === prev + 1) text += (nl ? '\n' : '') + (nl ? piece.trim() : piece);
            else text += '\n……\n' + piece.trim();
            prev = s;
        }
        out.push({
            isUser: mes.getAttribute('is_user') === 'true' || mes.classList.contains('is_user'),
            name: mes.querySelector('.name_text')?.textContent?.trim() || '',
            avatarSrc: mes.querySelector('.avatar img')?.src || '',
            text: text.trim(),
            imageSrcs: imgs.map(el => el.dataset.src),
        });
    });
    return out;
}

/**
 * 做 fn 的時候，畫面停在原地不要動。
 * 換成副本會讓每一樓的高度變一點點，酒館（或主題、其他插件）看到聊天的內容變了
 * 還會自己捲到最底。所以先記住畫面中間是哪一樓、離畫面頂端多遠，做完再捲回來，
 * 之後再補幾次（蓋掉酒館慢一拍的那次捲動）。
 */
function keepScroll(fn) {
    const chat = document.getElementById('chat');
    const anchor = currentFloor();
    if (!chat || !anchor) { fn(); return; }
    const before = anchor.getBoundingClientRect().top;
    fn();
    const fix = () => {
        if (!document.body.contains(anchor)) return;
        const delta = anchor.getBoundingClientRect().top - before;
        if (Math.abs(delta) > 1) chat.scrollTop += delta;
    };
    fix();
    requestAnimationFrame(fix);
    [80, 250, 600].forEach(ms => setTimeout(fix, ms));
}

/** 收藏用：有點到任何一句（或一張圖）的樓，整樓拿出來（全文 + 樓裡全部的圖）。 */
function readFavFloors() {
    const out = [];
    document.querySelectorAll('#chat .mes').forEach(mes => {
        if (!pickedSentences(mes).size && !mes.querySelector('.baozi-sel-img.picked')) return;
        const copy = mes.querySelector('.baozi-sel-copy');
        out.push({
            name: mes.querySelector('.name_text')?.textContent?.trim() || '',
            is_user: mes.getAttribute('is_user') === 'true' || mes.classList.contains('is_user'),
            text: (copy?.innerText || '').replace(/\n{3,}/g, '\n\n').trim(),
            srcs: [...mes.querySelectorAll('.baozi-sel-img')].map(el => el.dataset.src),
        });
    });
    return out;
}

async function saveFav(floors) {
    if (!floors.length) return;
    const toast = document.createElement('div');
    toast.className = 'baozi-toast';
    toast.innerHTML = '<div class="baozi-toast-title"><span class="baozi-chat-spin"></span> 收藏中…</div>';
    document.body.appendChild(toast);
    localizeLive(toast);
    try {
        let imgCount = 0;
        for (const f of floors) {
            f.shot_ids = [];
            for (const src of f.srcs) {
                try {
                    const blob = await imageBlob(src);
                    const res = await upload({ blob, kind: 'fav' }, { post: false });
                    f.shot_ids.push(res.shot.id);
                    imgCount++;
                } catch (e) { console.warn('[包子同好會] 收藏的圖存不了', e); }
            }
            delete f.srcs;
        }
        const prompt = activePrompt();
        await botFetch('/club/favs', {
            method: 'POST',
            body: { floors, character: currentCharacter(), prompt_id: prompt?.id || null },
        });
        toast.innerHTML = `<div class="baozi-toast-title">⭐ 收藏好了</div>
            <div>${floors.length} 樓${imgCount ? `、${imgCount} 張圖` : ''}・在桌面的「⭐ 收藏」看得到，只有你看得到</div>`;
    } catch (e) {
        toast.innerHTML = `<div class="baozi-toast-title">❌ 沒收藏成功</div><div>${esc(e.message)}</div>`;
    }
    setTimeout(() => toast.remove(), 3500);
}

/** 畫面中間現在停著的那一樓。 */
function currentFloor() {
    const mid = window.innerHeight / 2;
    let best = null, bestDist = Infinity;
    for (const mes of document.querySelectorAll('#chat .mes')) {
        const r = mes.getBoundingClientRect();
        if (r.height === 0) continue;
        if (r.top <= mid && r.bottom >= mid) return mes;
        const d = Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
        if (d < bestDist) { bestDist = d; best = mes; }
    }
    return best;
}

/** 跳到這一樓的開頭或結尾（樓很長、一直滑很累的時候用）。 */
function jumpInFloor(where) {
    const mes = currentFloor();
    if (!mes) return;
    if (where === 'top') {
        mes.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } else {
        // 結尾要留一點空間，不然被底下的工具列蓋住
        mes.scrollIntoView({ block: 'end', behavior: 'smooth' });
        setTimeout(() => {
            const chat = document.getElementById('chat');
            const barH = bar?.offsetHeight || 0;
            if (chat) chat.scrollBy({ top: barH + 16, behavior: 'smooth' });
        }, 350);
    }
}

export function enterSelectMode() {
    if (selecting) return;
    if (!document.querySelector('#chat .mes')) { alert(t('先打開一個有對話的聊天～')); return; }
    selecting = true;
    keepScroll(() => {
    document.body.classList.add('baozi-selecting');
    document.querySelectorAll('#chat .mes').forEach(mes => {
        const textEl = mes.querySelector('.mes_text:not(.baozi-sel-copy)');
        if (!textEl) return;
        const srcs = messageImageSrcs(mes);
        const copy = makeCopy(textEl);
        const sentences = splitSentences(copy);
        hidden.push([textEl, textEl.style.display]);
        textEl.style.display = 'none';
        textEl.after(copy);
        if (srcs.length) {
            const row = document.createElement('div');
            row.className = 'baozi-sel-imgs';
            row.innerHTML = srcs.map(src => `<div class="baozi-sel-img" data-src="${esc(src)}"><img src="${esc(src)}" alt=""></div>`).join('');
            copy.after(row);
        }
        if (sentences > 0) {
            const btn = document.createElement('button');
            btn.className = 'baozi-pick-all';
            btn.textContent = '全選這樓';
            mes.appendChild(btn);
            localizeLive(btn);
        }
    });
    });
    document.addEventListener('click', onChatClick, true);
    bar = document.createElement('div');
    bar.className = 'baozi-select-bar';
    bar.innerHTML = `
        <div class="baozi-select-count" data-k="count"></div>
        <div class="baozi-select-actions">
            <button class="baozi-btn-small baozi-on" data-a="shot">📸 做成圖片</button>
            <button class="baozi-btn-small" data-a="images">🖼️ 分享圖片</button>
            <button class="baozi-btn-small" data-a="fav">⭐ 收藏整樓</button>
            <button class="baozi-btn-small" data-a="cancel">✕ 取消</button>
            <span class="baozi-select-jump">
                <button class="baozi-btn-small" data-a="top" title="這一樓的開頭">⤒ 樓頂</button>
                <button class="baozi-btn-small" data-a="bottom" title="這一樓的結尾">⤓ 樓底</button>
            </span>
        </div>`;
    document.body.appendChild(bar);
    localizeLive(bar);
    bar.addEventListener('click', async (ev) => {
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (a === 'cancel') exitSelectMode();
        if (a === 'top' || a === 'bottom') jumpInFloor(a);
        if (a === 'shot') {
            const picked = readSelection();
            exitSelectMode();
            await makeShot(picked);
        }
        if (a === 'fav') {
            const floors = readFavFloors();
            exitSelectMode();
            await saveFav(floors);
        }
        if (a === 'images') {
            const imgs = readSelection().flatMap(p => p.imageSrcs);
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
export function wrap(ctx, text, maxWidth) {
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

export function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

async function collect(picked) {
    const items = [];
    for (const p of picked) {
        const avatar = await loadImage(p.avatarSrc);
        const images = [];
        for (const src of p.imageSrcs) {
            const loaded = await loadImage(src);
            if (loaded) images.push(loaded);
        }
        items.push({ isUser: p.isUser, text: p.text, name: p.name, avatar, images });
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

const TPL_KEY = 'baozi_shot_template';
// 跟 templates.js 的 TEMPLATES 一樣（這裡寫一份，不用為了按鈕的字先把整個排版檔載進來）
const TEMPLATE_LIST = [
    ['bubble', '💬 對話泡泡'], ['book', '📖 書頁摘抄'], ['polaroid', '📷 拍立得'], ['cinema', '🎬 電影字幕'],
    ['ancient', '🏮 古風直排'], ['letter', '✉️ 信箋'], ['ticket', '🎟️ 電影票根'], ['ai', '✨ 讓模型設計'],
];

async function makeShot(picked) {
    if (!picked.length) return;
    const modal = openModal('<div class="baozi-loading">📸 畫圖中…</div>');
    try {
        const items = await collect(picked);
        const character = currentCharacter();
        const prompt = activePrompt();
        const charName = items.find(i => !i.isUser)?.name || character || '';
        const data = {
            lines: items.filter(i => i.text).map(i => ({ who: i.isUser ? 'user' : 'char', name: i.name, text: i.text })),
            images: items.flatMap(i => i.images),
            title: prompt?.title || '',
            charName,
            userName: items.find(i => i.isUser)?.name || bot.me?.name || '',
            date: new Date(),
        };
        // 每款排版都從同一份 data 畫；對話泡泡是原本那款
        const draw = async (id) => {
            if (id === 'bubble') {
                return await render(items, {
                    title: {
                        main: prompt ? `《${prompt.title}》` : (charName ? `和${charName}` : '包子club'),
                        sub: [charName && prompt ? `和${charName}` : '', today()].filter(Boolean).join(' · '),
                    },
                });
            }
            const { renderTemplate, FONTS, TEMPLATES } = await import('./templates.js');
            if (id === 'ai') {
                // 模型自己做一張新的（HTML 卡片）；兩次都做壞才退回六款骨架
                try {
                    const { makeHtmlCard } = await import('./htmlcard.js');
                    const card = await makeHtmlCard(data, draw.hint || '');
                    draw.note = card.note;
                    return card.blob;
                } catch (e) {
                    if (/還沒有設定自訂 API/.test(e.message)) throw e;
                    console.warn('[包子同好會] 模型做的卡片不行，退回六款', e);
                    const { design } = await import('./aidesign.js');
                    const d = await design(data, FONTS);
                    const name = TEMPLATES.find(([k]) => k === d.base)?.[1] || d.base;
                    draw.note = `⚠️ 模型這次沒做好（${e.message}），先用${name}代替；再按一次會重做`;
                    return await renderTemplate(d.base, { ...data, title: d.title || data.title }, d.theme);
                }
            }
            return await renderTemplate(id, data);
        };
        let tpl = 'bubble';
        try { tpl = localStorage.getItem(TPL_KEY) || 'bubble'; } catch { /* 存不了就用預設 */ }
        if (tpl === 'ai') tpl = 'bubble';   // 模型設計不當預設（每次截圖都叫模型太花錢）
        let blob;
        try { blob = await draw(tpl); } catch (e) { console.warn('[包子同好會] 排版畫不出來，改用對話泡泡', e); tpl = 'bubble'; blob = await draw('bubble'); }
        if (!blob) throw new Error('畫不出來（手機記憶體不夠？少選幾則試試）');
        showPreview(modal, [{ blob, kind: 'shot' }], { character, prompt, redraw: draw, template: tpl });
    } catch (e) {
        modal.querySelector('.baozi-shot-body').innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
    }
}


// ============================================================
// 文生圖：原圖直接傳
// ============================================================

/** 圖太大（> 8MB）就縮小轉 jpg，Discord 免費帳號上限 10MB。 */
async function imageBlob(src) {
    const res = await fetch(src);
    let blob = await res.blob();
    const okType = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(blob.type);
    if (okType && blob.size <= 8 * 1024 * 1024) return blob;
    const loaded = await loadImage(src);
    const scale = Math.min(1, Math.sqrt((6 * 1024 * 1024 * 4) / (loaded.width * loaded.height * 4)));
    const c = document.createElement('canvas');
    c.width = Math.round(loaded.width * scale);
    c.height = Math.round(loaded.height * scale);
    c.getContext('2d').drawImage(loaded, 0, 0, c.width, c.height);
    blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    return blob;
}

async function shareImages(srcs) {
    if (!srcs.length) return;
    const modal = openModal('<div class="baozi-loading">🖼️ 讀圖中…</div>');
    try {
        const blobs = [];
        for (const src of srcs) blobs.push({ blob: await imageBlob(src), kind: 'image' });
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

function showPreview(modal, items, { character, prompt, redraw = null, template = 'bubble' }) {
    const urls = items.map(i => URL.createObjectURL(i.blob));
    const body = modal.querySelector('.baozi-shot-body');
    const what = items[0].kind === 'shot' ? '截圖' : `${items.length} 張圖`;
    body.innerHTML = `
        <div class="baozi-shot-title">${items[0].kind === 'shot' ? '📸' : '🖼️'} ${what}</div>
        ${redraw ? `<div class="baozi-tpl-chips">${TEMPLATE_LIST.map(([id, label]) =>
            `<button class="baozi-tag-chip ${id === template ? 'active' : ''}" data-tpl="${id}">${label}</button>`).join('')}</div>
            <input type="text" class="baozi-search baozi-ai-hint" data-f="hint" maxlength="80" placeholder="✨ 想要的感覺？例如：古風一點、像雜誌（可以不寫）">` : ''}
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
        const chip = ev.target.closest('[data-tpl]');
        if (chip && redraw) {
            if (chip.dataset.tpl === 'ai') redraw.hint = body.querySelector('[data-f="hint"]')?.value.trim() || '';
            body.querySelectorAll('[data-tpl]').forEach(c => c.classList.toggle('active', c === chip));
            const img = body.querySelector('.baozi-shot-preview img');
            img.style.opacity = '0.4';
            status.innerHTML = chip.dataset.tpl === 'ai'
                ? '<span class="baozi-chat-spin"></span> 模型在設計新的排版…（大概 10～30 秒，好了再按一次會再做一款）'
                : '<span class="baozi-chat-spin"></span> 換排版中…';
            try {
                const blob = await redraw(chip.dataset.tpl);
                URL.revokeObjectURL(urls[0]);
                items[0] = { ...items[0], blob };
                urls[0] = URL.createObjectURL(blob);
                img.src = urls[0];
                status.textContent = chip.dataset.tpl === 'ai' ? (redraw.note || '') : '';
                if (chip.dataset.tpl !== 'ai') {
                    try { localStorage.setItem(TPL_KEY, chip.dataset.tpl); } catch { /* 記不住就算了 */ }
                }
            } catch (e) {
                status.textContent = '❌ ' + e.message;
            } finally {
                img.style.opacity = '';
            }
            return;
        }
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


// ============================================================
// ⭐ 收藏（club 裡的一個畫面）
// ============================================================

export async function renderFavsScreen(container, ui) {
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>⭐ 收藏</h3>
            </div>
            <div class="baozi-setup-hint">選取模式點到哪幾樓，按「⭐ 收藏整樓」就會整樓存到這裡。只有你看得到。</div>
            <div class="baozi-list" id="baozi-fav-list"><div class="baozi-loading">載入中...</div></div>
        </div>`;
    container.querySelector('#baozi-back').addEventListener('click', ui.back);
    const list = container.querySelector('#baozi-fav-list');
    let favs;
    try {
        favs = (await botFetch('/club/favs')).favs;
    } catch (e) {
        list.innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
        return;
    }
    if (!favs.length) {
        list.innerHTML = '<div class="baozi-empty">還沒有收藏～在聊天上進截圖模式，點幾句再按「⭐ 收藏整樓」</div>';
        return;
    }
    list.innerHTML = favs.map(f => `
        <div class="baozi-card baozi-fav-card" data-id="${f.id}">
            <div class="baozi-fav-head" data-a="toggle">
                <div class="baozi-card-owner">${esc(f.character || '')}${f.prompt_title ? ` · <span data-raw>《${esc(f.prompt_title)}》</span>` : ''} · ${new Date(f.created_at).toLocaleDateString()}</div>
                <div class="baozi-fav-preview" data-raw>${esc(f.preview)}</div>
                <div class="baozi-card-owner" style="opacity:.7">${f.floors} 樓${f.images ? `・${f.images} 張圖` : ''} <span class="baozi-lib-caret">▾</span></div>
            </div>
            <div class="baozi-fav-detail"></div>
        </div>`).join('');
    list.addEventListener('click', async (ev) => {
        const card = ev.target.closest('.baozi-fav-card');
        if (!card) return;
        const a = ev.target.closest('[data-a]')?.dataset.a;
        const detail = card.querySelector('.baozi-fav-detail');
        if (a === 'del') {
            if (!confirm(t('刪掉這筆收藏？'))) return;
            await botFetch(`/club/favs/${card.dataset.id}`, { method: 'DELETE' });
            card.remove();
            return;
        }
        if (a === 'copy') {
            const ok = await ui.copy(card._text || '');
            ev.target.textContent = ok ? '✓ 已複製' : '❌ 複製失敗';
            return;
        }
        if (a === 'img') {
            const viewer = document.createElement('div');
            viewer.className = 'baozi-chat-viewer';
            viewer.innerHTML = `<img src="${ev.target.closest('img').src}" alt="">`;
            viewer.addEventListener('click', () => viewer.remove());
            document.body.appendChild(viewer);
            return;
        }
        if (a !== 'toggle') return;
        if (card.classList.toggle('open') && !detail.innerHTML) {
            detail.innerHTML = '<div class="baozi-loading">載入中...</div>';
            try {
                const fav = await botFetch(`/club/favs/${card.dataset.id}`);
                card._text = fav.floors.map(f => `${f.name}：\n${f.text}`).join('\n\n');
                detail.innerHTML = fav.floors.map((f, i) => `
                    <div class="baozi-fav-floor ${f.is_user ? 'user' : ''}">
                        <div class="baozi-fav-name">${esc(f.name)}</div>
                        <div class="baozi-fav-text" data-raw>${esc(f.text)}</div>
                        <div class="baozi-fav-imgs" data-floor="${i}"></div>
                    </div>`).join('') + `
                    <div class="baozi-card-actions">
                        <button class="baozi-btn-small" data-a="copy">📋 複製全文</button>
                        <button class="baozi-btn-small" data-a="del">🗑️ 刪掉</button>
                    </div>`;
                fav.floors.forEach((f, i) => {
                    const box = detail.querySelector(`[data-floor="${i}"]`);
                    for (const sid of f.shot_ids) {
                        shotUrl(sid).then(u => { box.insertAdjacentHTML('beforeend', `<img src="${u}" data-a="img" alt="">`); })
                            .catch(() => {});
                    }
                });
            } catch (e) {
                detail.innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
            }
        }
        card.querySelector('.baozi-lib-caret').textContent = card.classList.contains('open') ? '▴' : '▾';
    });
}
