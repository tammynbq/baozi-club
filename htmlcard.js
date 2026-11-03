// ============================================================
// ✨ 模型自己做一張新的排版（HTML/CSS 卡片）
// ============================================================
// 流程：
//   1. 模型讀句子，寫一張 540px 寬的 HTML/CSS 卡片。她選的句子用空位 {{LINE_1}}… 表示，
//      club 再把原文一字不差填進去 —— 模型不會改到、翻譯到她們的內容
//   2. 清乾淨：拿掉 <script>、on… 事件、外部網址（只留 data: 圖片和我們的字體）
//   3. 在看不見的 shadow DOM 裡排一次：量高度、檢查有沒有字跑出卡片、句子有沒有都放進去、
//      字和底色夠不夠清楚。不合格就把問題告訴模型重做一次
//   4. 轉成圖片：SVG foreignObject，字體（只抓這張卡用到的字）和圖片都先變成 data: 包進去，
//      iOS 上才畫得出來
// ============================================================

import { bot } from './bot.js';
import { callModel, activeProfile } from './aidesign.js';

const CARD_W = 540;
const SCALE = 2;
const FONT_FAMILIES = ['Noto Serif TC', 'Noto Serif SC', 'LXGW WenKai TC', 'Ma Shan Zheng'];

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}


// ============================================================
// 1. 叫模型做
// ============================================================

const SYSTEM = `你是很有品味的平面設計師，替一段角色扮演小劇場的摘錄，設計一張「分享卡片」。
每次都要做出全新的、跟內容氣氛相配的設計：可以是雜誌內頁、手帳、老照片、古籍、票券、明信片、
報紙、電影海報、霓虹、水彩、極簡……你自己決定，越有巧思越好。

規則（一定要遵守）：
- 只輸出一段 HTML（放在 \`\`\`html 裡），最外層是 <div class="card">…</div>，裡面可以有一個 <style>
- 卡片寬度固定 540px，高度由內容撐開；所有內容都要在卡片裡面，不能超出左右邊界
- CSS 只能作用在 .card 裡面（選擇器一律以 .card 開頭）
- 不能用 <script>、不能用外部網址（圖片、字體、@import 都不行）；裝飾用 CSS（漸層、陰影、邊框、
  圖案）、inline SVG、emoji、符號自己做
- 字體只能用這幾個：'Noto Serif TC'（宋體）、'LXGW WenKai TC'（楷體／手寫感）、
  'Ma Shan Zheng'（毛筆，只適合大標題）、sans-serif
- 她選的句子用空位代替，每個空位都要出現、只能出現一次、順序不變；不要自己改寫或補寫那些句子：
  {{LINE_1}}、{{LINE_2}}… 每個要放在自己的元素裡，例如 <p class="line">{{LINE_1}}</p>
  標著「她說」的是使用者自己的話，排得淡一點、小一點；其他是角色說的，是主角
- 可以用的其他空位：{{CHAR}}（角色名）、{{USER}}（她的名字）、{{DATE}}（日期）、
  {{TITLE}}（小劇場名，可能是空的）、{{IMG_1}}…（圖片網址，放在 <img src="{{IMG_1}}"> 或
  background-image:url({{IMG_1}}) 裡；沒有給圖就不要放圖片的位置）
- 你也可以自己寫一個貼合內容的短標題（4～12 字）或一句小標語，直接寫在 HTML 裡
- 文字一定要讀得清楚：字色和背景要有明顯對比，內文至少 15px`;

function userPrompt(data, hint, feedback) {
    const lines = data.lines.map((l, i) => `{{LINE_${i + 1}}}（${l.who === 'user' ? '她說' : `${l.name}說`}）：${l.text}`).join('\n');
    return `角色：${data.charName}　她：${data.userName}　日期：${fmtDate(data.date)}${data.title ? `　小劇場：《${data.title}》` : ''}
圖片：${data.images.length ? data.images.map((_, i) => `{{IMG_${i + 1}}}`).join('、') : '沒有'}
${hint ? `她想要的感覺：${hint}\n` : ''}
選的句子（請用空位，不要抄原文）：
${lines.slice(0, 3000)}
${feedback ? `\n上一版的問題，請修正後重做：${feedback}` : ''}`;
}

function fmtDate(d) {
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function extractHtml(text) {
    const m = String(text).match(/```html\s*([\s\S]*?)```/i) || String(text).match(/(<div[\s\S]*<\/div>)/i);
    if (!m) throw new Error('模型沒有回卡片的 HTML');
    return m[1].trim();
}


// ============================================================
// 2. 清乾淨 + 填空位
// ============================================================

function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    doc.querySelectorAll('script, iframe, object, embed, link, meta, base, form, input, button, textarea, video, audio')
        .forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
        for (const attr of [...el.attributes]) {
            const name = attr.name.toLowerCase();
            const val = attr.value;
            if (name.startsWith('on')) el.removeAttribute(attr.name);
            else if ((name === 'src' || name === 'href' || name === 'xlink:href') && !/^(\{\{IMG_\d+\}\}|data:image\/|#)/.test(val.trim())) {
                el.removeAttribute(attr.name);
            } else if (name === 'style' && /url\(\s*['"]?(?!data:|\{\{IMG_|#)/i.test(val)) {
                el.setAttribute('style', val.replace(/url\(\s*['"]?(?!data:|\{\{IMG_|#)[^)]*\)/gi, 'none'));
            }
        }
    });
    let out = doc.body.innerHTML;
    // <style> 裡也不准抓外面的東西
    out = out.replace(/@import[^;]+;/gi, '').replace(/url\(\s*['"]?(?!data:|\{\{IMG_|#)[^)]*\)/gi, 'none');
    return out;
}

function fill(html, data, imageUrls) {
    let out = html;
    data.lines.forEach((l, i) => {
        out = out.split(`{{LINE_${i + 1}}}`).join(`<span data-line="${i + 1}">${esc(l.text).replace(/\n/g, '<br>')}</span>`);
    });
    imageUrls.forEach((u, i) => { out = out.split(`{{IMG_${i + 1}}}`).join(u); });
    return out
        .split('{{CHAR}}').join(esc(data.charName))
        .split('{{USER}}').join(esc(data.userName))
        .split('{{DATE}}').join(esc(fmtDate(data.date)))
        .split('{{TITLE}}').join(esc(data.title || ''))
        .replace(/\{\{IMG_\d+\}\}/g, '')
        .replace(/\{\{[A-Z_0-9]+\}\}/g, '');
}


// ============================================================
// 3. 排一次、檢查
// ============================================================

function luminance(rgb) {
    const [r, g, b] = rgb.map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function parseColor(str) {
    const m = String(str).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
}

/** 找這個元素看起來的底色（往上找第一個不透明的純色底；遇到圖片或漸層就不判斷）。 */
function backgroundOf(el, root) {
    for (let node = el; node && node !== root; node = node.parentElement || node.host) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
        const c = parseColor(cs.backgroundColor);
        if (c && c.a > 0.85) return c.rgb;
        if (!node.parentElement) break;
    }
    return [255, 255, 255];
}

/** 在看不見的地方排出來，回傳 { height, problems } */
async function layout(html, fontCss, data) {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${CARD_W}px;pointer-events:none;`;
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${fontCss}:host{all:initial}*{box-sizing:border-box}</style><div class="wrap" style="width:${CARD_W}px">${html}</div>`;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all([...root.querySelectorAll('img')].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
    const wrap = root.querySelector('.wrap');
    const card = wrap.querySelector('.card') || wrap.firstElementChild;
    const problems = [];
    // 只量卡片本身（外面多量的部分會是透明的，存成圖會變一條黑邊）
    const height = Math.ceil(card ? card.getBoundingClientRect().height : wrap.scrollHeight);
    if (!card) problems.push('最外層要是 <div class="card">');
    if (wrap.scrollWidth > CARD_W + 4) problems.push(`有東西超出卡片左右邊界（內容寬到 ${wrap.scrollWidth}px，卡片只有 ${CARD_W}px）`);
    const missing = data.lines.map((_, i) => i + 1).filter(i => !root.querySelector(`[data-line="${i}"]`));
    if (missing.length) problems.push(`這幾個空位沒放進去：${missing.map(i => `{{LINE_${i}}}`).join('、')}`);
    for (const span of root.querySelectorAll('[data-line]')) {
        const r = span.getBoundingClientRect();
        const box = wrap.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) { problems.push(`{{LINE_${span.dataset.line}}} 被藏起來或大小是 0`); continue; }
        if (r.left < box.left - 2 || r.right > box.left + CARD_W + 2) problems.push(`{{LINE_${span.dataset.line}}} 的字跑出卡片外`);
        const fg = parseColor(getComputedStyle(span).color);
        const bg = backgroundOf(span, root);
        if (fg && bg) {
            const L1 = luminance(fg.rgb), L2 = luminance(bg);
            const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
            if (ratio < 3) problems.push(`{{LINE_${span.dataset.line}}} 的字色和底色太接近，看不清楚（對比 ${ratio.toFixed(1)}）`);
        }
        const size = parseFloat(getComputedStyle(span).fontSize);
        if (size < 13) problems.push(`{{LINE_${span.dataset.line}}} 的字太小（${size}px）`);
    }
    host.remove();
    return { height: Math.max(height, 200), problems: [...new Set(problems)] };
}


// ============================================================
// 4. 字體 + 圖片包進去，轉成圖片
// ============================================================

async function toDataUrl(blob) {
    return await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = rej;
        fr.readAsDataURL(blob);
    });
}

/** 圖片縮到 900px 以內再變成 data:（太大的話 SVG 會畫不出來）。 */
function imageToDataUrl(img) {
    const scale = Math.min(1, 900 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
}

let fontCssText = null;
async function fontCssSource() {
    if (fontCssText === null) {
        try { fontCssText = await (await fetch(bot.url + '/club/fonts.css')).text(); } catch { fontCssText = ''; }
    }
    return fontCssText;
}

function inRanges(cp, ranges) {
    return ranges.some(([a, b]) => cp >= a && cp <= b);
}

/** 只挑這張卡用到的字體分塊，抓下來變成 data:，組成一份可以塞進 SVG 的 @font-face。 */
async function embeddedFontCss(html, usedText) {
    const css = await fontCssSource();
    const families = FONT_FAMILIES.filter(f => html.includes(f));
    if (!css || !families.length) return '';
    const cps = new Set([...usedText].map(ch => ch.codePointAt(0)));
    const blocks = css.split('@font-face').slice(1).map(b => '@font-face' + b.slice(0, b.indexOf('}') + 1));
    const picked = blocks.filter(b => {
        const fam = (b.match(/font-family:\s*'([^']+)'/) || [])[1];
        if (!families.includes(fam)) return false;
        const ur = (b.match(/unicode-range:\s*([^;]+);/) || [])[1];
        if (!ur) return true;
        const ranges = ur.split(',').map(s => s.trim().replace(/^U\+/i, '')).map(s => {
            const [a, b2] = s.split('-');
            return [parseInt(a, 16), parseInt(b2 || a, 16)];
        });
        return [...cps].some(cp => inRanges(cp, ranges));
    }).slice(0, 80);
    const out = await Promise.all(picked.map(async b => {
        const url = (b.match(/url\(([^)]+)\)/) || [])[1];
        if (!url) return '';
        try {
            const data = await toDataUrl(await (await fetch(url.replace(/['"]/g, ''))).blob());
            return b.replace(/url\([^)]+\)/, `url(${data})`);
        } catch { return ''; }
    }));
    return out.join('\n');
}

function trimBottom(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let last = height - 1;
    outer: for (; last > 0; last--) {
        for (let x = 0; x < width; x += 4) {
            if (data[(last * width + x) * 4 + 3] > 8) break outer;
        }
    }
    if (last >= height - 2) return canvas;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = last + 1;
    c.getContext('2d').drawImage(canvas, 0, 0);
    return c;
}

async function rasterize(html, fontCss, height) {
    const xhtml = new XMLSerializer().serializeToString(
        new DOMParser().parseFromString(`<div xmlns="http://www.w3.org/1999/xhtml" style="width:${CARD_W}px">${html}</div>`, 'text/html').body.firstChild);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${height}" viewBox="0 0 ${CARD_W} ${height}">`
        + `<foreignObject x="0" y="0" width="${CARD_W}" height="${height}"><style>${fontCss}*{box-sizing:border-box}</style>${xhtml}</foreignObject></svg>`;
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('卡片畫不出來')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    // Safari 有時候第一次畫 foreignObject 會漏字，多畫一次比較穩
    ctx.drawImage(img, 0, 0);
    await new Promise(r => setTimeout(r, 60));
    ctx.clearRect(0, 0, CARD_W, height);
    ctx.drawImage(img, 0, 0);
    // 排版時量的高度和畫出來的可能差一點點，底下多出來的透明部分裁掉（不然存成圖是一條黑邊）
    const out = trimBottom(canvas);
    const blob = await new Promise(r => out.toBlob(r, 'image/png'));
    if (!blob) throw new Error('卡片轉不成圖片');
    return blob;
}


// ============================================================
// 對外：做一張
// ============================================================

/**
 * @returns {Promise<{ blob: Blob, note: string }>}
 * 失敗（模型兩次都做壞、或轉圖片失敗）會丟出錯誤，呼叫端退回六款排版。
 */
export async function makeHtmlCard(data, hint = '') {
    const profile = activeProfile();
    if (!profile) throw new Error('還沒有設定自訂 API～到「設定 → ✨ 排版模型」加一組');
    const imageUrls = data.images.map(imageToDataUrl);
    let feedback = '';
    let lastProblems = [];
    for (let attempt = 0; attempt < 2; attempt++) {
        const raw = await callModel(profile, [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: userPrompt(data, hint, feedback) },
        ], { maxTokens: 4000, temperature: 1 });
        const html = fill(sanitize(extractHtml(raw)), data, imageUrls);
        const usedText = html.replace(/<[^>]+>/g, '') + data.lines.map(l => l.text).join('');
        const fontCss = await embeddedFontCss(html, usedText);
        const { height, problems } = await layout(html, fontCss, data);
        if (!problems.length) {
            const blob = await rasterize(html, fontCss, height);
            return { blob, note: attempt ? '✨ 模型重做了一次，這是新設計的' : '✨ 模型設計的新排版' };
        }
        lastProblems = problems;
        feedback = problems.join('；');
    }
    throw new Error('模型兩次都沒做好（' + lastProblems.slice(0, 2).join('；') + '）');
}
