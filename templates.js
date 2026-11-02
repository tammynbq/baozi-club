// ============================================================
// 🎨 摘要排版：六款（書頁摘抄、拍立得、電影字幕、古風直排、信箋、電影票根）
// ============================================================
// 每款都是一個畫圖函式：draw(ctx, data) 畫完回傳整張的高度。
// 先在一張 1×1 的假畫布上跑一次量高度，再開真的畫布畫一次（畫布外的東西不會畫出來，量的時候也不花多少時間）。
//
// data = {
//   lines: [{ who: 'user' | 'char', name, text }],   她選的句子，照順序
//   images: [Image],                                 選的圖（第一張當主圖）
//   title, charName, userName, date: Date,
// }
//
// 字體走大包子轉送的 Google Fonts（一帆在南京連不上 Google）：/club/fonts.css
// ============================================================

import { bot } from './bot.js';
import { wrap, roundRect } from './shots.js';

export const TEMPLATES = [
    ['bubble', '💬 對話泡泡'],
    ['book', '📖 書頁摘抄'],
    ['polaroid', '📷 拍立得'],
    ['cinema', '🎬 電影字幕'],
    ['ancient', '🏮 古風直排'],
    ['letter', '✉️ 信箋'],
    ['ticket', '🎟️ 電影票根'],
];

const W = 1080;
const SERIF = '"Noto Serif TC","Noto Serif SC","Songti TC","Songti SC",serif';
const KAI = '"LXGW WenKai TC","Kaiti TC","Kaiti SC","Noto Serif TC","Noto Serif SC",serif';
const BRUSH = '"Ma Shan Zheng","LXGW WenKai TC","Noto Serif TC",serif';


// ============================================================
// 字體
// ============================================================

let fontsLinked = false;

/** 把要用到的字先載好（只會抓這段文字用到的那幾塊）。最多等 8 秒，載不到就用手機自己的字。 */
export async function ensureFonts(text) {
    if (!fontsLinked && bot.url) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = bot.url + '/club/fonts.css';
        document.head.appendChild(link);
        fontsLinked = true;
        await new Promise(r => { link.onload = r; link.onerror = r; setTimeout(r, 5000); });
    }
    const sample = (text || '') + '包子劇場雨夜一二三四五六七八九十年月日場次主演座位';
    const loads = ['Noto Serif TC', 'Noto Serif SC', 'LXGW WenKai TC', 'Ma Shan Zheng'].flatMap(f => [
        document.fonts.load(`40px "${f}"`, sample).catch(() => {}),
        document.fonts.load(`bold 40px "${f}"`, sample).catch(() => {}),
    ]);
    await Promise.race([Promise.all(loads), new Promise(r => setTimeout(r, 8000))]);
}


// ============================================================
// 共用小工具
// ============================================================

function para(ctx, text, x, y, maxW, lineH, { align = 'left', draw = true } = {}) {
    const lines = wrap(ctx, text, maxW);
    lines.forEach((line, i) => {
        if (!draw) return;
        const lx = align === 'center' ? x + maxW / 2 : align === 'right' ? x + maxW : x;
        ctx.textAlign = align;
        ctx.fillText(line, lx, y + i * lineH);
        ctx.textAlign = 'left';
    });
    return lines.length * lineH;
}

/** 圖片填滿這個框（多的裁掉，不會畫到框外面）。 */
function cover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
}

/** 沒有圖的時候放一張柔和的漸層（顏色看標題算，同一則每次都一樣）。 */
function placeholder(ctx, x, y, w, h, seed = '') {
    let n = 0;
    for (const ch of seed) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    const palettes = [['#2c3a63', '#141a30'], ['#6b4a5e', '#2d1f2b'], ['#3f6158', '#18282a'], ['#7a5a3a', '#2b1d12']];
    const [a, b] = palettes[n % palettes.length];
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    const r = ctx.createRadialGradient(x + w * 0.7, y + h * 0.3, 0, x + w * 0.7, y + h * 0.3, w * 0.45);
    r.addColorStop(0, 'rgba(255,214,150,0.55)');
    r.addColorStop(1, 'rgba(255,214,150,0)');
    ctx.fillStyle = r;
    ctx.fillRect(x, y, w, h);
}

function fmtDate(d, sep = '.') {
    return `${d.getFullYear()}${sep}${String(d.getMonth() + 1).padStart(2, '0')}${sep}${String(d.getDate()).padStart(2, '0')}`;
}

const CN_NUM = '〇一二三四五六七八九';
function cnNumber(n) {
    if (n <= 10) return n === 10 ? '十' : CN_NUM[n];
    if (n < 20) return '十' + CN_NUM[n - 10];
    return CN_NUM[Math.floor(n / 10)] + '十' + (n % 10 ? CN_NUM[n % 10] : '');
}
function cnDate(d) {
    const y = String(d.getFullYear()).split('').map(c => CN_NUM[c]).join('');
    return `${y}年${cnNumber(d.getMonth() + 1)}月${cnNumber(d.getDate())}日`;
}

function userLines(data) { return data.lines.filter(l => l.who === 'user'); }
function charLines(data) { return data.lines.filter(l => l.who !== 'user'); }


// ============================================================
// ① 書頁摘抄
// ============================================================
function book(ctx, data) {
    const T = data.theme;
    const PAD = 96, TW = W - PAD * 2;
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, 99999);
    ctx.textBaseline = 'top';
    let y = PAD;
    for (const l of userLines(data)) {
        ctx.font = `30px ${T.font}`;
        ctx.fillStyle = T.muted;
        const h = para(ctx, `${l.name}：${l.text}`, PAD + 26, y, TW - 26, 50);
        ctx.fillStyle = T.line;
        ctx.fillRect(PAD, y + 4, 6, h - 12);
        y += h + 24;
    }
    ctx.font = `180px ${T.font}`;
    ctx.fillStyle = T.accent;
    ctx.fillText('“', PAD - 6, y - 20);
    y += 110;
    ctx.font = `40px ${T.font}`;
    ctx.fillStyle = T.text;
    for (const l of charLines(data)) {
        y += para(ctx, l.text, PAD, y, TW, 80) + 26;
    }
    if (data.images[0]) {
        const img = data.images[0];
        const h = Math.min(Math.round(TW * img.height / img.width), 640);
        ctx.save();
        roundRect(ctx, PAD, y + 10, TW, h, 6);
        ctx.clip();
        cover(ctx, img, PAD, y + 10, TW, h);
        ctx.restore();
        y += h + 40;
    }
    ctx.font = `30px ${T.font}`;
    ctx.fillStyle = T.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`—— ${data.charName}${data.title ? `・《${data.title}》` : ''}`, W - PAD, y + 20);
    ctx.textAlign = 'center';
    ctx.font = `24px ${T.font}`;
    ctx.fillStyle = T.line2;
    ctx.fillText(`·  ${fmtDate(data.date)}  ·  包子club  ·`, W / 2, y + 100);
    ctx.textAlign = 'left';
    return y + 170;
}


// ============================================================
// ② 拍立得手帳
// ============================================================
function polaroid(ctx, data) {
    const T = data.theme;
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, 99999);
    ctx.textBaseline = 'top';
    const FX = 90, FY = 100, FW = W - 180, IW = FW - 60, IH = Math.round(IW * 0.78), FH = IH + 190;
    ctx.save();
    ctx.translate(W / 2, FY + FH / 2);
    ctx.rotate(-2.2 * Math.PI / 180);
    ctx.translate(-W / 2, -(FY + FH / 2));
    ctx.shadowColor = 'rgba(120,80,70,0.28)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = '#fff';
    ctx.fillRect(FX, FY, FW, FH);
    ctx.shadowColor = 'transparent';
    if (data.images[0]) cover(ctx, data.images[0], FX + 30, FY + 30, IW, IH);
    else placeholder(ctx, FX + 30, FY + 30, IW, IH, data.title);
    if (!data.images[0]) {
        ctx.font = `bold 64px ${T.font}`;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.textAlign = 'center';
        ctx.fillText(data.title || data.charName, W / 2, FY + 30 + IH / 2 - 32);
        ctx.textAlign = 'left';
    }
    ctx.font = `46px ${T.font}`;
    ctx.fillStyle = T.text;
    ctx.fillText(`${data.title || `和${data.charName}`} ☂︎`, FX + 40, FY + 30 + IH + 56);
    // 膠帶
    ctx.translate(W / 2, FY);
    ctx.rotate(5 * Math.PI / 180);
    ctx.fillStyle = T.accent;
    ctx.fillRect(-130, -32, 260, 64);
    ctx.restore();

    let y = FY + FH + 80;
    const TX = 110, TW = W - 220;
    for (const l of data.lines) {
        const isUser = l.who === 'user';
        ctx.font = `${isUser ? 34 : 40}px ${T.font}`;
        ctx.fillStyle = isUser ? T.muted : T.text;
        y += para(ctx, isUser ? `${l.name}：${l.text}` : l.text, TX, y, TW, isUser ? 60 : 74) + 18;
    }
    ctx.font = `32px ${T.font}`;
    ctx.fillStyle = T.muted;
    ctx.textAlign = 'right';
    ctx.fillText(`和${data.charName} · ${data.date.getMonth() + 1}/${data.date.getDate()}`, W - TX, y + 14);
    ctx.textAlign = 'left';
    return y + 110;
}


// ============================================================
// ③ 電影字幕
// ============================================================
function cinema(ctx, data) {
    const T = data.theme;
    const BAR = 110;
    ctx.textBaseline = 'top';
    // 先量字幕要多高
    ctx.font = `42px ${T.font}`;
    const subW = W - 160;
    const subs = data.lines.map(l => {
        ctx.font = `${l.who === 'user' ? 34 : 42}px ${T.font}`;
        return { l, lines: wrap(ctx, l.text, subW) };
    });
    const subH = subs.reduce((s, x) => s + x.lines.length * (x.l.who === 'user' ? 54 : 66) + 18, 0);
    const SH = Math.max(1350, subH + 620);
    const H = BAR * 2 + SH;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (data.images[0]) cover(ctx, data.images[0], 0, BAR, W, SH);
    else placeholder(ctx, 0, BAR, W, SH, data.title);
    // 底部壓暗，字幕才看得清楚
    const g = ctx.createLinearGradient(0, BAR + SH - subH - 360, 0, BAR + SH);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, BAR, W, SH);
    const tg = ctx.createLinearGradient(0, BAR, 0, BAR + 300);
    tg.addColorStop(0, 'rgba(0,0,0,0.5)');
    tg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tg;
    ctx.fillRect(0, BAR, W, 300);

    ctx.font = `26px ${T.font}`;
    ctx.fillStyle = '#bbb';
    ctx.textAlign = 'center';
    ctx.fillText('B A O Z I   C L U B   P R E S E N T S', W / 2, 42);
    ctx.fillText(fmtDate(data.date, '  ·  '), W / 2, H - BAR + 42);
    ctx.textAlign = 'left';

    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 14;
    ctx.font = `bold 60px ${T.font}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(data.title || `和${data.charName}`, 60, BAR + 56);
    ctx.font = `26px ${T.font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`${data.charName}  ×  ${data.userName}`, 62, BAR + 136);

    let y = BAR + SH - subH - 50;
    for (const { l, lines } of subs) {
        const isUser = l.who === 'user';
        ctx.font = `${isUser ? 34 : 42}px ${T.font}`;
        ctx.fillStyle = isUser ? T.accent : '#fff';
        ctx.textAlign = 'center';
        lines.forEach((line, i) => ctx.fillText(line, W / 2, y + i * (isUser ? 54 : 66)));
        y += lines.length * (isUser ? 54 : 66) + 18;
    }
    ctx.textAlign = 'left';
    ctx.shadowColor = 'transparent';
    return H;
}


// ============================================================
// ④ 古風直排
// ============================================================
// 直排時標點要換成直式的寫法（「」→﹁﹂ 之類），不然看起來是橫倒的
const VERTICAL = {
    '，': '︐', '、': '︑', '。': '︒', '：': '︓', '；': '︔', '！': '︕', '？': '︖',
    '「': '﹁', '」': '﹂', '『': '﹃', '』': '﹄', '（': '︵', '）': '︶', '《': '︽', '》': '︾',
    '〈': '︿', '〉': '﹀', '【': '︻', '】': '︼', '…': '︙', '—': '︱', '～': '︴',
    '“': '﹁', '”': '﹂', '‘': '﹃', '’': '﹄', '(': '︵', ')': '︶', ',': '︐', '.': '︒', '!': '︕', '?': '︖',
};

function ancient(ctx, data) {
    const T = data.theme;
    const M = 80, STEP = 60, COL = 88, TITLE_W = 150;
    const hasImg = !!data.images[0];
    const IMG_W = hasImg ? 250 : 0;
    // 每一段（她說的話、他說的話）各自從新的一行開始；字一個一個排
    const blocks = data.lines.map(l => ({ user: l.who === 'user', chars: [...(l.who === 'user' ? `${l.name}：${l.text}` : l.text).replace(/\s+/g, '')] }));
    const availW = W - M * 2 - TITLE_W - (hasImg ? IMG_W + 40 : 0);
    const maxCols = Math.max(1, Math.floor(availW / COL));
    let H = 1500;
    const colsNeeded = (perCol) => blocks.reduce((s, b) => s + Math.ceil(b.chars.length / perCol), 0);
    while (colsNeeded(Math.floor((H - M * 2) / STEP)) > maxCols && H < 6000) H += 150;
    const perCol = Math.floor((H - M * 2) / STEP);

    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(150,120,80,0.07)';
    for (let yy = 0; yy < H; yy += 12) for (let xx = (yy / 12) % 2 ? 6 : 0; xx < W; xx += 12) ctx.fillRect(xx, yy, 2, 2);

    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    // 標題（最右邊一行，毛筆字）
    ctx.font = `96px ${T.titleFont}`;
    ctx.fillStyle = T.text;
    let tx = W - M - TITLE_W / 2, ty = M;
    for (const ch of [...(data.title || `和${data.charName}`)].slice(0, Math.floor((H - M * 2 - 260) / 110))) {
        ctx.fillText(VERTICAL[ch] || ch, tx, ty);
        ty += 110;
    }
    ctx.font = `26px ${T.font}`;
    ctx.fillStyle = T.muted;
    ty += 30;
    for (const ch of cnDate(data.date)) { ctx.fillText(ch, tx, ty); ty += 34; }

    // 內文
    let cx = W - M - TITLE_W - COL / 2 - 10;
    for (const b of blocks) {
        ctx.font = `${b.user ? 38 : 44}px ${T.font}`;
        ctx.fillStyle = b.user ? T.muted : T.text;
        for (let i = 0; i < b.chars.length; i += perCol) {
            b.chars.slice(i, i + perCol).forEach((ch, j) => {
                const v = VERTICAL[ch];
                // 直式標點放在字格的右上角，看起來比較自然
                ctx.fillText(v || ch, cx + (v ? 8 : 0), M + j * STEP - (v ? 6 : 0));
            });
            cx -= COL;
        }
    }

    // 圖（最左邊直直一條）
    if (hasImg) {
        const ix = M, iy = M, ih = H - M * 2;
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.15)';
        ctx.shadowBlur = 16;
        ctx.fillRect(ix - 12, iy - 12, IMG_W + 24, ih + 24);
        ctx.shadowColor = 'transparent';
        cover(ctx, data.images[0], ix, iy, IMG_W, ih);
    }
    // 印章
    ctx.save();
    ctx.translate(M + (hasImg ? IMG_W + 80 : 60), H - M - 70);
    ctx.rotate(-6 * Math.PI / 180);
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 6;
    roundRect(ctx, -60, -60, 120, 120, 12);
    ctx.stroke();
    ctx.fillStyle = T.accent;
    ctx.font = `52px ${T.titleFont}`;
    ctx.fillText('包', 0, -54);
    ctx.fillText('子', 0, 2);
    ctx.restore();
    ctx.textAlign = 'left';
    return H;
}


// ============================================================
// ⑤ 信箋
// ============================================================
function letter(ctx, data) {
    const T = data.theme;
    const PAD = 90, LINE = 84, TOP = 420;   // 上面留給郵票和郵戳
    ctx.textBaseline = 'alphabetic';
    // 先排好每一行
    const rows = [];
    ctx.font = `bold 48px ${T.font}`;
    if (data.title) rows.push({ text: `《${data.title}》`, font: `bold 48px ${T.font}`, color: T.text });
    for (const l of data.lines) {
        const isUser = l.who === 'user';
        const font = `${isUser ? 36 : 42}px ${T.font}`;
        ctx.font = font;
        for (const line of wrap(ctx, isUser ? `${l.name}：${l.text}` : l.text, W - PAD * 2)) {
            rows.push({ text: line, font, color: isUser ? T.muted : T.text });
        }
    }
    rows.push({ text: `—— ${data.charName}`, font: `42px ${T.font}`, color: T.text, right: true });
    const H = TOP + rows.length * LINE + 120;

    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = T.line;
    for (let y = TOP + 18; y < H - 60; y += LINE) ctx.fillRect(PAD - 20, y, W - PAD * 2 + 40, 2);

    // 郵票（文生圖）+ 郵戳
    const SX = W - PAD - 210, SY = 60;
    ctx.save();
    ctx.translate(SX + 105, SY + 125);
    ctx.rotate(4 * Math.PI / 180);
    ctx.fillStyle = T.bg;
    ctx.fillRect(-105, -125, 210, 250);
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = T.line2;
    ctx.lineWidth = 4;
    ctx.strokeRect(-105, -125, 210, 250);
    ctx.setLineDash([]);
    if (data.images[0]) cover(ctx, data.images[0], -90, -110, 180, 220);
    else placeholder(ctx, -90, -110, 180, 220, data.title);
    ctx.restore();
    ctx.save();
    ctx.translate(SX - 40, SY + 160);
    ctx.rotate(-14 * Math.PI / 180);
    ctx.strokeStyle = T.accent;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 92, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = T.accent;
    ctx.font = `26px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.fillText('包子club', 0, -6);
    ctx.fillText(fmtDate(data.date), 0, 30);
    ctx.restore();

    rows.forEach((r, i) => {
        ctx.font = r.font;
        ctx.fillStyle = r.color;
        ctx.textAlign = r.right ? 'right' : 'left';
        ctx.fillText(r.text, r.right ? W - PAD : PAD, TOP + i * LINE);
    });
    ctx.textAlign = 'left';
    return H;
}


// ============================================================
// ⑥ 電影票根
// ============================================================
function ticket(ctx, data) {
    const T = data.theme;
    const OUT = 50, LW = 620, SW = W - OUT * 2 - LW;
    ctx.textBaseline = 'top';
    // 左半邊的字
    const rows = [];
    for (const l of data.lines) {
        const isUser = l.who === 'user';
        ctx.font = `${isUser ? 30 : 36}px ${T.font}`;
        rows.push({ isUser, lines: wrap(ctx, isUser ? `${l.name}：${l.text}` : l.text, LW - 100) });
    }
    const textH = rows.reduce((s, r) => s + r.lines.length * (r.isUser ? 50 : 62) + 16, 0);
    const TH = Math.max(900, 230 + textH + 80);
    const H = TH + OUT * 2;
    ctx.fillStyle = '#3a3a40';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = T.bg;
    roundRect(ctx, OUT, OUT, W - OUT * 2, TH, 24);
    ctx.fill();

    let y = OUT + 56;
    ctx.font = `24px ${T.font}`;
    ctx.fillStyle = T.accent;
    ctx.fillText('A D M I T   O N E   ·   小 劇 場', OUT + 50, y);
    y += 50;
    ctx.font = `bold 54px ${T.font}`;
    ctx.fillStyle = T.text;
    y += para(ctx, data.title || `和${data.charName}`, OUT + 50, y, LW - 100, 70) + 30;
    for (const r of rows) {
        ctx.font = `${r.isUser ? 30 : 36}px ${T.font}`;
        ctx.fillStyle = r.isUser ? T.muted : T.text;
        r.lines.forEach((line, i) => ctx.fillText(line, OUT + 50, y + i * (r.isUser ? 50 : 62)));
        y += r.lines.length * (r.isUser ? 50 : 62) + 16;
    }

    // 右邊票根：圖 + 場次資訊
    const sx = OUT + LW, infoH = 270;
    ctx.save();
    roundRect(ctx, sx, OUT, SW, TH, 24);
    ctx.clip();
    if (data.images[0]) cover(ctx, data.images[0], sx, OUT, SW, TH - infoH);
    else placeholder(ctx, sx, OUT, SW, TH - infoH, data.title);
    ctx.restore();
    ctx.font = `24px ${T.font}`;
    const info = [['場次', fmtDate(data.date)], ['主演', data.charName], ['座位', `${data.userName}的旁邊`]];
    info.forEach(([k, v], i) => {
        const iy = OUT + TH - infoH + 40 + i * 70;
        ctx.fillStyle = T.muted;
        ctx.font = `24px ${T.font}`;
        ctx.fillText(k, sx + 32, iy);
        ctx.fillStyle = T.text;
        ctx.font = `bold 32px ${T.font}`;
        ctx.fillText(v, sx + 100, iy - 4);
    });
    // 撕線 + 兩個半圓缺口
    ctx.setLineDash([14, 12]);
    ctx.strokeStyle = T.line;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(sx, OUT + 30);
    ctx.lineTo(sx, OUT + TH - 30);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#3a3a40';
    for (const cy of [OUT, OUT + TH]) {
        ctx.beginPath();
        ctx.arc(sx, cy, 28, 0, Math.PI * 2);
        ctx.fill();
    }
    return H;
}


const DRAW = { book, polaroid, cinema, ancient, letter, ticket };

// 每款的出廠配色和字體。模型設計時會蓋掉其中幾項（見 aidesign.js）。
export const THEMES = {
    book:     { bg: '#fbf6ec', text: '#3b2f27', muted: '#a08a75', accent: '#d9c3a5', line: '#ead9c2', line2: '#c4b29c', font: SERIF },
    polaroid: { bg: '#f3e7e3', text: '#6b4c43', muted: '#b0918a', accent: 'rgba(255, 205, 196, 0.8)', font: KAI },
    cinema:   { bg: '#000000', text: '#ffffff', muted: '#bbbbbb', accent: '#ffe7a8', font: SERIF },
    ancient:  { bg: '#f4ecdc', text: '#2d241c', muted: '#9b8566', accent: '#c0392b', font: SERIF, titleFont: BRUSH },
    letter:   { bg: '#fffdf7', text: '#4a3b33', muted: '#a48d7f', accent: 'rgba(192,57,43,0.65)', line: '#e9dccb', line2: '#e0b5a6', font: KAI },
    ticket:   { bg: '#fff6ef', text: '#4a3328', muted: '#b09484', accent: '#d08a72', line: '#e8c9b8', font: SERIF },
};
export const FONTS = { serif: SERIF, kai: KAI, brush: BRUSH };
const MAX_AREA = 16_000_000;

/** 用某一款畫出來，回傳 Blob。bubble（對話泡泡）不在這裡，那是 shots.js 原本的。 */
export async function renderTemplate(id, data, theme = {}) {
    const fn = DRAW[id];
    if (!fn) throw new Error('沒有這款排版：' + id);
    // 沒有指定的顏色就用這款原本的；line 系列沒指定時跟著 muted 走
    const base = THEMES[id];
    data = { ...data, theme: { ...base, line: base.line || base.muted, line2: base.line2 || base.muted, ...theme } };
    await ensureFonts(data.lines.map(l => l.text).join('') + data.title + data.charName + data.userName);
    const probe = document.createElement('canvas');
    probe.width = W;
    probe.height = 2;
    const height = Math.ceil(fn(probe.getContext('2d'), data));
    const scale = Math.min(1, Math.sqrt(MAX_AREA / (W * height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    fn(ctx, data);
    let blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (blob && blob.size > 4 * 1024 * 1024) blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
    return blob;
}
