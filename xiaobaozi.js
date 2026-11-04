// ============================================================
// 🥟 小包子：住在右下角的小太監包子
// ============================================================
// - 浮動按鈕換成他（像素畫，canvas 畫的）：平常豆豆眼、偶爾眯眼笑；晚上 10 點到 6 點睡著冒泡
// - 每天第一次打開 tt，他從蒸籠冒出來打招呼：
//     一帆 → 「今天翻誰的牌子？」→ 一排蓋著的綠頭牌，翻到誰就打開誰的聊天
//     米米 → 「要把劇情時間推進到現在嗎？」→ 把現在的日期時間填進輸入框（不送出）
//     節日當天 → 招呼換成節日祝賀
// 造型是草稿第四版：不戴帽子的小籠包頭＋小太監的青色袍子。
// ============================================================

import { bot, botFetch, stContext, matchCharacter } from './bot.js';
import { t, localizeLive } from './i18n.js';

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}


// ============================================================
// 像素畫（32×32 格）
// ============================================================

const PAL = {
    b: '#fffaf0', B: '#f3e2c4', p: '#e8b77a', o: '#c98a4b', w: '#ffffff', e: '#3b2a20',
    m: '#f8a9b0', n: '#c0605a', d: '#a6dcf5', z: '#9fb0d6', t: '#ffffff',
    r: '#5b9bb0', q: '#40798d', R: '#d65a50', k: '#4a3a33', S: '#d8b182', s: '#b98c5e',
};
const HALF = { 4: 1, 5: 2, 6: 2, 7: 4, 8: 6, 9: 8, 10: 9, 11: 10, 12: 11, 13: 12, 14: 12, 15: 13, 16: 13, 17: 13, 18: 13, 19: 13, 20: 13, 21: 13, 22: 13, 23: 13, 24: 12, 25: 11, 26: 9 };

function grid() { return Array.from({ length: 32 }, () => Array(32).fill(null)); }
function put(g, x, y, c) { if (y >= 0 && y < 32 && x >= 0 && x < 32) g[y][x] = c; }
function rect(g, x0, y0, w, h, c) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(g, x, y, c); }
function line(g, x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) put(g, Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c);
}

function bun(g, dy = 0) {
    for (const [y, h] of Object.entries(HALF)) {
        for (let x = 16 - h; x < 16 + h; x++) put(g, x, +y + dy, +y >= 24 ? 'B' : 'b');
    }
    for (const [x1, y1] of [[8, 12], [11, 11], [14, 10], [17, 10], [20, 11], [23, 12]]) {
        line(g, 15.5 + (x1 < 16 ? -0.5 : 0.5), 5 + dy, x1, y1 + dy, 'p');
    }
    rect(g, 15, 4 + dy, 2, 2, 'p');
    put(g, 9, 15 + dy, 'w');
    put(g, 10, 14 + dy, 'w');
}

function body(g, hands = 'clasp') {
    const HW = { 23: 4, 24: 5, 25: 6, 26: 6, 27: 7, 28: 7, 29: 7 };
    for (const [y, h] of Object.entries(HW)) for (let x = 16 - h; x < 16 + h; x++) put(g, x, +y, 'r');
    line(g, 13, 23, 16, 26, 'q');
    line(g, 18, 23, 15, 26, 'q');
    rect(g, 9, 27, 14, 1, 'R');
    if (hands === 'clasp') rect(g, 14, 25, 4, 2, 'b');
    rect(g, 11, 30, 4, 2, 'k');
    rect(g, 17, 30, 4, 2, 'k');
}

function face(g, kind, dy = 0) {
    const y = 19 + dy;
    const blush = () => { rect(g, 7, y + 2, 3, 1, 'm'); rect(g, 22, y + 2, 3, 1, 'm'); };
    if (kind === 'dot') {
        rect(g, 10, y, 2, 2, 'e'); rect(g, 20, y, 2, 2, 'e'); put(g, 10, y, 'w'); put(g, 20, y, 'w');
        blush(); put(g, 15, y + 2, 'n'); put(g, 16, y + 2, 'n');
    }
    if (kind === 'smile') {
        for (const x of [9, 19]) { put(g, x, y + 1, 'e'); put(g, x + 1, y, 'e'); put(g, x + 2, y, 'e'); put(g, x + 3, y + 1, 'e'); }
        blush(); put(g, 15, y + 2, 'n'); put(g, 16, y + 2, 'n'); put(g, 14, y + 1, 'n'); put(g, 17, y + 1, 'n');
    }
    if (kind === 'pout') {
        // >  <  被戳煩了
        for (const [x0, dir] of [[9, 1], [22, -1]]) {
            put(g, x0, y - 1, 'e'); put(g, x0 + dir, y, 'e'); put(g, x0 + 2 * dir, y + 1, 'e');
            put(g, x0 + dir, y + 2, 'e'); put(g, x0, y + 3, 'e');
        }
        rect(g, 6, y + 3, 4, 1, 'm'); rect(g, 22, y + 3, 4, 1, 'm');
        rect(g, 14, y + 3, 4, 1, 'n');
    }
    if (kind === 'sleep') {
        for (const x of [9, 19]) { put(g, x, y, 'e'); put(g, x + 1, y + 1, 'e'); put(g, x + 2, y + 1, 'e'); put(g, x + 3, y, 'e'); }
        blush(); put(g, 16, y + 3, 'n');
        rect(g, 23, y + 3, 3, 3, 'd'); put(g, 24, y + 3, 't');
        for (const [x, yy] of [[25, 6], [26, 6], [26, 7], [25, 8], [26, 8], [28, 2], [29, 2], [29, 3], [28, 4], [29, 4]]) put(g, x, yy, 'z');
    }
}

const POSES = {
    idle: g => { body(g); bun(g, -4); face(g, 'dot', -4); },
    smile: g => { body(g); bun(g, -4); face(g, 'smile', -4); },
    sleep: g => { body(g); bun(g, -4); face(g, 'sleep', -4); },
    pout: g => { body(g); bun(g, -4); face(g, 'pout', -4); },
    steamer: g => {
        bun(g, 1); face(g, 'dot', -1);
        rect(g, 1, 24, 30, 8, 'S'); rect(g, 0, 23, 32, 1, 's'); rect(g, 1, 28, 30, 1, 's');
        for (let x = 1; x < 31; x += 5) rect(g, x, 24, 1, 8, 's');
        for (const [x, y] of [[6, 5], [7, 4], [6, 3], [7, 2], [25, 5], [26, 4], [25, 3], [26, 2]]) put(g, x, y, 'z');
    },
};

/** 畫成一張 canvas（每格 scale 像素），外框是暖棕色。 */
export function drawPose(name, scale = 2) {
    const g = grid();
    POSES[name](g);
    const c = document.createElement('canvas');
    c.width = 34 * scale;
    c.height = 34 * scale;
    c.className = 'xbz-canvas';
    const x = c.getContext('2d');
    const at = (r, q) => (r >= 0 && r < 32 && q >= 0 && q < 32 ? g[r][q] : null);
    const skip = v => v === 'z' || v === 'd' || v === 't';
    for (let r = -1; r <= 32; r++) for (let q = -1; q <= 32; q++) {
        if (at(r, q)) continue;
        if ([[0, 1], [0, -1], [1, 0], [-1, 0]].some(([a, b]) => { const v = at(r + a, q + b); return v && !skip(v); })) {
            x.fillStyle = PAL.o;
            x.fillRect((q + 1) * scale, (r + 1) * scale, scale, scale);
        }
    }
    g.forEach((row, r) => row.forEach((v, q) => {
        if (!v) return;
        x.fillStyle = PAL[v];
        x.fillRect((q + 1) * scale, (r + 1) * scale, scale, scale);
    }));
    return c;
}


// ============================================================
// 右下角的他
// ============================================================

const isNight = (d = new Date()) => d.getHours() >= 22 || d.getHours() < 6;
let btnRef = null;
let blinkTimer = null;

function setPose(name) {
    if (!btnRef) return;
    btnRef.querySelector('.xbz-canvas')?.remove();
    btnRef.appendChild(drawPose(name, 2));
    btnRef.dataset.pose = name;
}

/** 把浮動按鈕換成小包子。按鈕原本的點擊（打開 club）、拖曳都不動。 */
export function mountMascot(btn) {
    btnRef = btn;
    btn.classList.add('xbz-btn');
    btn.textContent = '';
    btn.title = t('小包子（點一下說話、按兩下打開包子同好會，按住可以拖）');
    setPose(isNight() ? 'sleep' : 'idle');
    clearInterval(blinkTimer);
    // 平常偶爾眯眼笑一下；晚上睡覺
    blinkTimer = setInterval(() => {
        if (isNight()) { if (btn.dataset.pose !== 'sleep') setPose('sleep'); return; }
        if (btn.dataset.pose === 'sleep') setPose('idle');
        if (Math.random() < 0.35) {
            setPose('smile');
            setTimeout(() => { if (!isNight()) setPose('idle'); }, 1200);
        }
    }, 5000);
}


// ============================================================
// 每天第一次：打招呼
// ============================================================

const GREET_KEY = 'xbz_last_greet';
const GREET_ON_KEY = 'xbz_greet_on';
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

export function greetingEnabled() {
    try { return localStorage.getItem(GREET_ON_KEY) !== 'off'; } catch { return true; }
}
export function setGreetingEnabled(on) {
    try { localStorage.setItem(GREET_ON_KEY, on ? 'on' : 'off'); } catch { /* 存不了 */ }
}

function todayKey(d = new Date()) {
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function hello(name, d = new Date()) {
    const h = d.getHours();
    if (h < 6) return `${name}還沒睡呀……小包子陪你一下`;
    if (h < 11) return `${name}早安！小包子蒸好了～`;
    if (h < 14) return `${name}午安，吃飯了沒有？`;
    if (h < 18) return `${name}下午好，要不要歇一會兒？`;
    return `${name}晚上好，今天辛苦了～`;
}

export function closeBubble() {
    document.getElementById('xbz-bubble')?.remove();
    document.getElementById('xbz-pop')?.remove();
}

export function showBubble(html) {
    closeBubble();
    const pop = document.createElement('div');
    pop.id = 'xbz-pop';
    pop.className = 'xbz-pop';
    pop.appendChild(drawPose('steamer', 3));
    const bubble = document.createElement('div');
    bubble.id = 'xbz-bubble';
    bubble.className = 'xbz-bubble';
    bubble.innerHTML = html;
    document.body.append(pop, bubble);
    localizeLive(bubble);
    return bubble;
}

/** 「現在」的那段話，填進輸入框讓她推進劇情時間。 */
function nowLine(d = new Date()) {
    const h = d.getHours();
    const part = h < 5 ? '凌晨' : h < 11 ? '早上' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `（時間來到現在：${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}，${part}${hh}點${String(d.getMinutes()).padStart(2, '0')}分。）`;
}

function fillInput(text) {
    const box = document.getElementById('send_textarea');
    if (!box) return false;
    box.value = text + (box.value ? '\n' + box.value : '');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.focus();
    return true;
}

export async function greetIfNeeded({ force = false } = {}) {
    if (!bot.me) return;
    if (!force) {
        if (!greetingEnabled()) return;
        try { if (localStorage.getItem(GREET_KEY) === todayKey()) return; } catch { /* 讀不到就照樣打招呼 */ }
    }
    try { localStorage.setItem(GREET_KEY, todayKey()); } catch { /* 存不了 */ }

    let festival = null;
    try {
        const d = await botFetch('/club/desktop');
        if (d.festival && d.festival.days === 0) festival = d.festival.name;
    } catch { /* 拿不到就不祝了 */ }

    const me = bot.me;
    const many = (me.characters || []).length > 1;
    const line = festival
        ? `${me.name}，${festival}快樂！小包子給你拜節了 🏮`
        : hello(me.name);
    const action = many
        ? '<button class="baozi-btn-small baozi-on" data-a="flip">🀄 今天翻誰的牌子？</button>'
        : '<button class="baozi-btn-small baozi-on" data-a="now">⏩ 把劇情時間推進到現在</button>';
    const bubble = showBubble(`
        <div class="xbz-say">${esc(line)}</div>
        <div class="baozi-toast-row">${action}<button class="baozi-btn-small" data-a="bye">好～</button></div>`);
    bubble.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (a === 'bye') closeBubble();
        if (a === 'now') {
            if (fillInput(nowLine())) {
                bubble.querySelector('.xbz-say').textContent = t('填好了！送出前還可以改～');
                bubble.querySelector('.baozi-toast-row').innerHTML = '';
                setTimeout(closeBubble, 1800);
            } else {
                bubble.querySelector('.xbz-say').textContent = t('先打開一個聊天，小包子才知道要填在哪裡');
            }
        }
        if (a === 'flip') flipCards();
    });
}


// ============================================================
// 🀄 翻牌子
// ============================================================

function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** 大包子的角色名 → 酒館裡那張卡（卡上的名字可能不一樣：祂 = 柳玄、张文远 = 远子哥）。 */
function findCard(name) {
    const chars = stContext()?.characters || [];
    // 跟自動標記同一套比對：卡名多了 v2、emoji、寫成繁體也找得到
    const idx = chars.findIndex(c => matchCharacter(c?.name || '') === name);
    return idx >= 0 ? idx : null;
}

async function openChatOf(name) {
    const ctx = stContext();
    const idx = findCard(name);
    if (idx === null) return false;
    try {
        if (typeof ctx.selectCharacterById === 'function') { await ctx.selectCharacterById(idx); return true; }
    } catch (e) { console.warn('[包子同好會] selectCharacterById 失敗，改點角色清單', e); }
    const el = document.querySelector(`.character_select[chid="${idx}"], #rm_print_characters_block [chid="${idx}"]`);
    if (el) { el.click(); return true; }
    return false;
}

function flipCards() {
    const names = shuffle(bot.me?.characters || []);
    closeBubble();
    const modal = document.createElement('div');
    modal.className = 'baozi-shot-modal xbz-flip';
    modal.innerHTML = `
        <div class="baozi-shot-card">
            <div class="baozi-shot-title">🀄 今天翻誰的牌子？</div>
            <div class="baozi-setup-hint">牌子都蓋著，點一張翻開～翻到誰就去找誰</div>
            <div class="xbz-cards">
                ${names.map((n, i) => `<button class="xbz-card" data-i="${i}"><span class="xbz-card-top"></span><span class="xbz-card-name">？</span></button>`).join('')}
            </div>
            <div class="baozi-shot-status" data-k="status"></div>
            <div class="baozi-shot-actions"><button class="baozi-btn-small" data-a="close">算了</button></div>
        </div>`;
    document.body.appendChild(modal);
    localizeLive(modal);
    let done = false;
    modal.addEventListener('click', async (ev) => {
        if (ev.target === modal || ev.target.closest('[data-a="close"]')) { modal.remove(); return; }
        const card = ev.target.closest('.xbz-card');
        if (!card || done) return;
        done = true;
        const name = names[Number(card.dataset.i)];
        card.classList.add('flipped');
        card.querySelector('.xbz-card-name').textContent = name;
        modal.querySelectorAll('.xbz-card:not(.flipped)').forEach(c => c.classList.add('dim'));
        const status = modal.querySelector('[data-k="status"]');
        status.textContent = t(`翻到${name}了！這就帶你去找他～`);
        setTimeout(async () => {
            const ok = await openChatOf(name);
            if (ok) modal.remove();
            else status.textContent = t(`在酒館裡找不到${name}的角色卡，要自己去打開喔`);
        }, 1100);
    });
}


// ============================================================
// 👆 按一下小包子：說一句話＋幾顆快捷按鈕
// ============================================================
// A：照時間說的話（深夜會趕人去睡，越戳越兇）
// B：跟她們有關的事（推薦沒玩、聊天室、節日、天氣、老公託話），資料用桌面那份，五分鐘拿一次
// 大部分說 A，大約三成說 B（B 太常出現會像在催）。
// 一直戳（每次間隔 2.5 秒內）會換表情、換台詞。

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const LINES = {
    morning: ['{n}早安～今天也要好好吃早餐', '早上好！小包子剛蒸好，熱乎乎的', '{n}醒啦？外面天亮了喔', '早安！今天想玩哪個小劇場？'],
    noon: ['{n}吃午飯了沒有？', '中午了，小包子肚子咕咕叫', '午安～吃飽了再來玩', '{n}記得喝水喔'],
    afternoon: ['下午好，要不要歇一會兒？', '{n}下午茶時間到了！', '小包子在這裡陪你～', '有點睏……{n}也是嗎？'],
    evening: ['{n}晚上好，今天辛苦了～', '晚飯吃了什麼？', '晚上最適合跟老公聊天了', '小包子在旁邊乖乖待著'],
    late: ['{n}還不睡嗎？', '快十二點了，小包子眼睛快睜不開了', '再玩一下下就要睡囉'],
};
// 凌晨：戳越多次越兇
const NIGHT = [
    ['{n}，已經很晚了……', '這個時間還醒著？', '小包子都睡了一覺了耶'],
    ['真的該睡了啦！', '明天會起不來的', '{n}，眼睛會累壞的'],
    ['{n}！！去！睡！覺！', '小包子要生氣了喔！！', '再不睡就把你的手機蒸了！'],
];
const POKED = [
    ['欸？', '怎麼啦？', '嗯嗯？'],
    ['別戳了……包子皮要破了', '癢癢的啦！', '戳上癮了是不是'],
    ['哼！', '不理你了！', '再戳就咬你喔！', '（假裝睡著）'],
];

function timeLine(name, d = new Date()) {
    const h = d.getHours();
    const pool = h < 5 ? null : h < 11 ? LINES.morning : h < 14 ? LINES.noon : h < 18 ? LINES.afternoon
        : h < 23 ? LINES.evening : LINES.late;
    return pool ? pick(pool).replaceAll('{n}', name) : null;
}

let deskCache = { at: 0, data: null };
async function deskData() {
    if (!bot.me) return null;
    if (deskCache.data && Date.now() - deskCache.at < 5 * 60_000) return deskCache.data;
    try {
        deskCache = { at: Date.now(), data: await botFetch('/club/desktop') };
    } catch { /* 拿不到就只說 A */ }
    return deskCache.data;
}

const RELAY_TAIL = ['叫你等一下過去找他', '說他想你了', '問你今天過得好不好', '要你記得吃飯', '說忙完就來陪你'];

function aboutLines(d, me) {
    const out = [];
    if (!d) return out;
    const p = d.pick;
    if (p?.kind === 'rec') out.push(`${p.from}力推了「${p.title}」給你，要不要去看看？`);
    else if (p?.left) out.push(`今天還有 ${p.left} 則推薦沒玩喔～`);
    const other = (d.chat || []).filter(l => l.author && l.author !== me.name).pop();
    if (other?.text) out.push(`${other.author}在聊天室說：「${other.text.slice(0, 24)}${other.text.length > 24 ? '…' : ''}」`);
    const f = d.festival;
    if (f && f.days === 0) out.push(`今天是${f.name}！`);
    else if (f && f.days <= 60) out.push(`${f.name}還有 ${f.days} 天～`);
    const w = d.weather;
    if (w?.tip) out.push(`${w.city}${w.sky || ''}，${w.tip}`);
    if (d.month?.count) out.push(`這個月已經玩了 ${d.month.count} 則小劇場了！`);
    // 老公託話：從她自己的老公裡挑一位有動靜的
    const busy = (d.husbands || []).filter(h => h.activity);
    if (busy.length) {
        const h = pick(busy);
        const doing = `${h.place ? `在${h.place}` : ''}${h.activity}`;
        out.push(`${h.name}託我跟你說：他${doing}，${pick(RELAY_TAIL)}`);
        out.push(`${h.name}託我帶話：${pick(RELAY_TAIL)}～`);
    }
    return out;
}

let pokes = { n: 0, at: 0 };

/**
 * 按一下小包子。
 * @param ui {openPanel(), report()}
 */
export async function pokeMascot(ui) {
    const now = Date.now();
    pokes = { n: now - pokes.at < 2500 ? pokes.n + 1 : 1, at: now };
    const name = bot.me?.name || '';
    const h = new Date().getHours();
    const night = h >= 1 && h < 5;
    let line;
    let pose = null;
    if (night) {
        line = pick(NIGHT[Math.min(pokes.n - 1, 2)]).replaceAll('{n}', name);
        pose = pokes.n >= 3 ? 'pout' : 'sleep';
    } else if (pokes.n >= 3) {
        line = pick(POKED[Math.min(pokes.n - 3, 2)]);
        pose = pokes.n >= 5 ? 'pout' : 'smile';
    } else {
        const b = Math.random() < 0.3 ? aboutLines(await deskData(), bot.me || {}) : [];
        line = b.length ? pick(b) : (timeLine(name) || pick(NIGHT[0]).replaceAll('{n}', name));
    }
    if (pose) {
        setPose(pose);
        setTimeout(() => setPose(isNight() ? 'sleep' : 'idle'), 2500);
    }

    const many = (bot.me?.characters || []).length > 1;
    const quick = !bot.me ? ''
        : many ? '<button class="baozi-btn-small" data-a="flip">🀄 翻牌子</button>'
            : '<button class="baozi-btn-small" data-a="now">⏩ 推進到現在</button>';
    const bubble = showBubble(`
        <div class="xbz-say">${esc(line)}</div>
        <div class="baozi-toast-row">
            <button class="baozi-btn-small baozi-on" data-a="open">🥟 打開包子</button>
            ${quick}
            ${bot.me ? '<button class="baozi-btn-small" data-a="report">🐞 回報問題</button>' : ''}
        </div>
        <div class="xbz-tip">按兩下小包子也能直接打開</div>`);
    bubble.addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (!a) return;
        if (a === 'open') { closeBubble(); ui.openPanel(); }
        if (a === 'report') { closeBubble(); ui.report(); }
        if (a === 'flip') flipCards();
        if (a === 'now') {
            if (fillInput(nowLine())) {
                bubble.querySelector('.xbz-say').textContent = t('填好了！送出前還可以改～');
                setTimeout(closeBubble, 1800);
            } else {
                bubble.querySelector('.xbz-say').textContent = t('先打開一個聊天，小包子才知道要填在哪裡');
            }
        }
    });
    clearTimeout(pokeMascot.timer);
    pokeMascot.timer = setTimeout(() => { if (document.getElementById('xbz-bubble') === bubble) closeBubble(); }, 12_000);
}
