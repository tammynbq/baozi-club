// ============================================================
// 🏠 桌面（club 的首頁）
// ============================================================
// 時鐘、日期、農曆，下面一格一格的小組件：天氣、老公此刻、這個月、
// 今日推薦／力推、下一個節日、聊天室最新兩句；再下面是常用的 App 圖示。
// 資料一次跟大包子要（GET /club/desktop），每一塊各自讀不到也不影響其他塊。
// ============================================================

import { bot, botFetch } from './bot.js';
import { t } from './i18n.js';

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

function mediaUrl(u) {
    return u && u.startsWith('/') ? bot.url + u : (u || '');
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const SKY_ICON = [
    [/雷/, '⛈️'], [/雪/, '🌨️'], [/大雨|暴雨/, '🌧️'], [/雨/, '🌦️'], [/霧|霾/, '🌫️'],
    [/陰/, '☁️'], [/多雲|雲/, '⛅'], [/晴/, '☀️'],
];

function skyIcon(sky) {
    for (const [re, icon] of SKY_ICON) if (re.test(sky || '')) return icon;
    return '🌤️';
}

function clockText(d = new Date()) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateText(d, lunar) {
    return `${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}${lunar ? ` · 農曆${lunar}` : ''}`;
}

const deg = (n) => (n === null || n === undefined ? '–' : `${Math.round(n)}°`);

function weatherWidget(w) {
    if (!w) return `<div class="bz-w bz-weather"><div class="bz-t">天氣</div><div class="bz-sub">暫時查不到</div></div>`;
    const tm = w.tomorrow ? `明天 ${deg(w.tomorrow.low)}–${deg(w.tomorrow.high)}` : '';
    return `
        <div class="bz-w bz-weather">
            <div class="bz-t">${skyIcon(w.sky)} ${esc(w.city)}</div>
            <div class="bz-deg">${deg(w.now ?? w.high)}</div>
            <div class="bz-sub">${esc(w.sky)} · ${tm}</div>
            ${w.tip ? `<div class="bz-sub">${esc(w.tip)}</div>` : ''}
        </div>`;
}

function monthWidget(m, me) {
    const count = m?.count ?? 0;
    const multi = (me?.characters || []).length > 1;
    const line = !count ? '這個月還沒記過～'
        : multi && m.top ? `${esc(m.top)}玩得最多` : `跟${esc(m.top || '')}玩過`;
    return `
        <div class="bz-w bz-count" data-go="played">
            <div class="bz-t">📖 這個月</div>
            <div class="bz-big">${count}</div>
            <div class="bz-sub">則小劇場<br>${line}</div>
        </div>`;
}

function husbandWidget(h) {
    if (!h) return '';
    const doing = h.activity
        ? `<div class="bz-act">${esc(h.place ? `在${h.place}，` : '')}${esc(h.activity)}</div>
           <div class="bz-mood">${h.mood ? `心情：${esc(h.mood)} · ` : ''}${esc(h.ago)}</div>`
        : `<div class="bz-act">還不知道他在做什麼</div><div class="bz-mood">點一下看看</div>`;
    return `
        <div class="bz-w bz-wide bz-husband" data-husband="${esc(h.name)}">
            <img class="bz-av" src="${esc(mediaUrl(h.avatar))}" alt="">
            <div class="bz-hinfo">
                <div class="bz-name">${esc(h.name)} 此刻 <span class="bz-refresh">↻</span></div>
                ${doing}
            </div>
        </div>`;
}

function crewWidget(list, mainName) {
    if (list.length < 2) return '';
    return `
        <div class="bz-w bz-wide bz-crew">
            ${list.map(h => `
                <div class="bz-crew-one ${h.name === mainName ? 'on' : ''}" data-pick-husband="${esc(h.name)}">
                    <img class="bz-av bz-av-sm" src="${esc(mediaUrl(h.avatar))}" alt="">
                    <div>${esc(h.name)}</div>
                </div>`).join('')}
        </div>`;
}

function pickWidget(p) {
    if (!p) return `<div class="bz-w bz-pick"><div class="bz-t">☀️ 今日推薦</div><div class="bz-sub">今天的都玩過了 🎉</div></div>`;
    if (p.kind === 'rec') {
        return `
            <div class="bz-w bz-pick" data-open="${p.id}">
                <div class="bz-t">💌 ${esc(p.from)}力推</div>
                <div class="bz-ptitle" data-raw>${esc(p.title)}</div>
                ${p.note ? `<div class="bz-sub" data-raw>「${esc(p.note)}」</div>` : '<div class="bz-sub">點我拿去玩</div>'}
            </div>`;
    }
    return `
        <div class="bz-w bz-pick" data-open="${p.id}">
            <div class="bz-t">☀️ 今日推薦</div>
            <div class="bz-ptitle" data-raw>${esc(p.title)}</div>
            <div class="bz-sub">還有 ${p.left} 則沒玩 · 點我</div>
        </div>`;
}

function festivalWidget(f) {
    if (!f) return '';
    const when = f.days === 0 ? '就是今天！' : f.days === 1 ? '明天' : `還有 ${f.days} 天`;
    return `
        <div class="bz-w">
            <div class="bz-t">🏮 下一個節日</div>
            <div class="bz-fname">${esc(f.name)}</div>
            <div class="bz-sub">${when}</div>
        </div>`;
}

function chatWidget(lines) {
    return `
        <div class="bz-w bz-wide bz-chat" data-go="chat">
            <div class="bz-t">💬 聊天室</div>
            ${lines?.length
                ? lines.map(l => `<div class="bz-line"><b>${esc(l.author)}</b>：<span data-raw>${esc(l.text || '（圖片）')}</span></div>`).join('')
                : '<div class="bz-sub">還沒有人說話～</div>'}
        </div>`;
}

const APPS = [
    ['shot', '📸', '截圖', '#FFD6CE'],
    ['album', '🖼️', '相簿', '#E3D7F5'],
    ['dice', '🎲', '抽一則', '#C9E7DC'],
    ['notifications', '🔔', '通知', '#FFE9A8'],
];

let clockTimer = null;

/**
 * @param ui {go(tab, opts), openCommand(cmd), dice(), shot(), notifications()}
 */
export async function renderDesktop(container, ui) {
    const me = bot.me || {};
    const now = new Date();
    container.innerHTML = `
        <div class="bz-desk ${me.name === '一帆' ? 'bz-desk-alt' : ''}">
            <div class="bz-clock" id="bz-clock">${clockText(now)}</div>
            <div class="bz-date" id="bz-date">${dateText(now, '')}</div>
            <div class="bz-grid" id="bz-grid"><div class="baozi-loading">載入中...</div></div>
            <div class="bz-apps">
                ${APPS.map(([k, icon, label, color]) => `
                    <div class="bz-app" data-app="${k}"><div style="background:${color}">${icon}</div>${label}</div>`).join('')}
            </div>
        </div>`;

    clearInterval(clockTimer);
    clockTimer = setInterval(() => {
        const el = document.getElementById('bz-clock');
        if (!el) { clearInterval(clockTimer); return; }
        el.textContent = clockText();
    }, 20_000);

    // App 圖示一進來就要能按 —— 不等小組件的資料（資料讀不到也照樣能用）
    container.querySelector('.bz-apps').onclick = (ev) => {
        const app = ev.target.closest('[data-app]')?.dataset.app;
        if (app === 'shot') ui.shot();
        if (app === 'album') ui.go('album');
        if (app === 'dice') ui.dice();
        if (app === 'notifications') ui.notifications();
    };

    const grid = container.querySelector('#bz-grid');
    let data;
    try {
        data = await botFetch('/club/desktop');
    } catch (e) {
        grid.innerHTML = `<div class="baozi-error">${esc(e.message)}</div>`;
        return;
    }
    if (!document.body.contains(grid)) return;
    container.querySelector('#bz-date').textContent = dateText(new Date(), data.lunar);

    const husbands = data.husbands || [];
    // 老公此刻：多位的話，挑最近有動靜的那位當主角
    const ranked = [...husbands].sort((a, b) => (a.activity ? 0 : 1) - (b.activity ? 0 : 1));
    let main = ranked[0];

    const draw = () => {
        grid.innerHTML = [
            weatherWidget(data.weather),
            monthWidget(data.month, me),
            husbandWidget(main),
            crewWidget(husbands, main?.name),
            pickWidget(data.pick),
            festivalWidget(data.festival),
            chatWidget(data.chat),
        ].join('');
    };
    draw();

    grid.onclick = async (ev) => {
        const pickH = ev.target.closest('[data-pick-husband]');
        if (pickH) {
            main = husbands.find(h => h.name === pickH.dataset.pickHusband) || main;
            draw();
            return;
        }
        const hus = ev.target.closest('[data-husband]');
        if (hus) {
            const btn = hus.querySelector('.bz-refresh');
            btn.classList.add('spin');
            try {
                const fresh = await botFetch(`/club/husband/${encodeURIComponent(hus.dataset.husband)}/refresh`, { method: 'POST', body: {} });
                const i = husbands.findIndex(h => h.name === fresh.name);
                if (i >= 0) husbands[i] = fresh;
                main = fresh;
                draw();
            } catch (e) {
                btn.classList.remove('spin');
                alert(t(e.message));
            }
            return;
        }
        const open = ev.target.closest('[data-open]');
        if (open) {
            try {
                ui.openCommand(await botFetch('/club/commands/' + open.dataset.open));
            } catch (e) { alert(t(e.message)); }
            return;
        }
        const go = ev.target.closest('[data-go]');
        if (go) ui.go(go.dataset.go === 'played' ? 'library' : go.dataset.go,
            go.dataset.go === 'played' ? { filter: 'played' } : {});
    };

}
