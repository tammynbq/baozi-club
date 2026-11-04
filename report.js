// ============================================================
// 🐞 回報問題
// ============================================================
// 設定裡寫一句話按送出 → 大包子代發成 GitHub issue（BIG-baozi，私人 repo），
// Claude 可以直接讀，不用米米轉達。手機上不放任何金鑰。
//
// 平常默默記下包子自己的錯誤（只記包子的，別的插件的不管），回報時一起帶上。
// 不帶聊天內容：只有版本、卡名、認到誰、錯誤訊息、手機型號。
// ============================================================

import { bot, botFetch, currentCardName, currentCharacter } from './bot.js';
import { currentLocale, localizeLive, t } from './i18n.js';
import { installedVersion } from './version.js';

const LOG_KEY = 'baozi_errlog';
const TRACE_KEY = 'baozi_trace';
const MAX_TRACE = 40;
const MAX_LOG = 20;
const BASE = new URL('.', import.meta.url).href;

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

function readLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
}

function writeLog(list) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-MAX_LOG))); } catch { /* 存不了就算了 */ }
}

/** 記一筆錯誤（同一句話連續出現只記一次、加次數）。 */
export function logError(where, err) {
    const msg = String(err?.message ?? err ?? '').slice(0, 300);
    if (!msg) return;
    const stack = String(err?.stack || '').split('\n').slice(1, 4)
        .map(l => l.trim().replace(BASE, '')).join(' | ').slice(0, 300);
    const list = readLog();
    const last = list[list.length - 1];
    if (last && last.msg === msg && last.where === where) {
        last.n = (last.n || 1) + 1;
        last.at = new Date().toISOString();
    } else {
        list.push({ at: new Date().toISOString(), where, msg, stack });
    }
    writeLog(list);
}

/** 記一筆操作軌跡（按了什麼、事件有沒有到），回報時一起帶上；iPhone 上的怪問題靠這個查。 */
export function trace(msg) {
    try {
        const list = JSON.parse(localStorage.getItem(TRACE_KEY) || '[]');
        const d = new Date();
        list.push(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')} ${String(msg).slice(0, 160)}`);
        localStorage.setItem(TRACE_KEY, JSON.stringify(list.slice(-MAX_TRACE)));
    } catch { /* 存不了就算了 */ }
}

function readTrace() {
    try { return JSON.parse(localStorage.getItem(TRACE_KEY) || '[]'); } catch { return []; }
}

const ours = (text) => String(text || '').includes(BASE);

/** 開機時呼叫一次。 */
export function installErrorCapture() {
    window.addEventListener('error', (ev) => {
        if (ours(ev.filename) || ours(ev.error?.stack)) logError('error', ev.error || ev.message);
    });
    window.addEventListener('unhandledrejection', (ev) => {
        if (ours(ev.reason?.stack)) logError('promise', ev.reason);
    });
    // 包子自己的 console.warn 都有「[包子同好會]」開頭（自動標記失敗之類），也記下來
    const warn = console.warn.bind(console);
    console.warn = (...args) => {
        if (typeof args[0] === 'string' && args[0].startsWith('[包子同好會]')) {
            const err = args.find(a => a instanceof Error);
            logError('warn', err ? { message: `${args[0]} ${err.message}`, stack: err.stack } : args.map(String).join(' '));
        }
        warn(...args);
    };
}

async function snapshot() {
    return {
        version: await installedVersion(),
        card: currentCardName(),
        recognized: currentCharacter(),
        characters: bot.me?.characters || [],
        locale: currentLocale(),
        ua: navigator.userAgent,
        screen: `${window.innerWidth}×${window.innerHeight}@${window.devicePixelRatio || 1}`,
        errors: readLog(),
        trace: readTrace(),
    };
}

function canvasToBlob(canvas, type = 'image/jpeg', q = 0.85) {
    return new Promise((resolve, reject) => {
        try { canvas.toBlob(b => (b ? resolve(b) : reject(new Error('轉不成圖片'))), type, q); } catch (e) { reject(e); }
    });
}

/** 相簿選的圖：iPhone 可能是 HEIC，大包子不收 —— 用 canvas 重畫成 JPEG，順便縮到 1600 寬以內。 */
async function normalizeImage(file) {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error('這張圖打不開'));
            im.src = url;
        });
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return await canvasToBlob(c);
    } finally {
        URL.revokeObjectURL(url);
    }
}

async function uploadImage(blob) {
    const res = await fetch(bot.url + '/club/shots?kind=report', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + bot.token, 'Content-Type': blob.type || 'image/jpeg' },
        body: blob,
    });
    let data = null;
    try { data = await res.json(); } catch { /* 不是 JSON */ }
    if (!res.ok) throw new Error(data?.error || ('大包子回了 ' + res.status));
    return data.shot.id;
}

const MAX_IMAGES = 3;

/**
 * 回報的表單（設定頁、小包子叫出來的視窗共用）。
 * @param onDone 送出成功後
 */
function reportForm(box, { onDone } = {}) {
    const list = [];
    box.innerHTML = `
        <div class="baozi-setup-hint">哪裡怪怪的就寫一句，克總直接看得到。會一起帶上版本、現在開著的卡名和最近的錯誤訊息；附的圖只有克總看得到，30 天後刪掉。</div>
        <textarea class="baozi-search baozi-report-text" rows="3" maxlength="2000" placeholder="例如：一帆的自動標記沒反應、按了截圖畫面變白…"></textarea>
        <div class="baozi-report-imgs"></div>
        <div class="baozi-dice-pools">
            <button class="baozi-tag-chip active" data-a="send">🐞 送出</button>
            <label class="baozi-tag-chip baozi-report-pick">📷 從相簿選<input type="file" accept="image/*" multiple hidden></label>
            <button class="baozi-tag-chip" data-a="peek">看看會帶上什麼</button>
        </div>
        <pre class="baozi-report-peek" data-raw hidden></pre>
        <div class="baozi-setup-hint" data-k="msg"></div>`;
    const text = box.querySelector('.baozi-report-text');
    const msg = box.querySelector('[data-k="msg"]');
    const peek = box.querySelector('.baozi-report-peek');
    const imgs = box.querySelector('.baozi-report-imgs');
    const send = box.querySelector('[data-a="send"]');

    const drawImgs = () => {
        imgs.innerHTML = list.map((it, i) => `
            <div class="baozi-report-img"><img src="${it.url}" alt=""><button data-del="${i}">✕</button></div>`).join('');
        box.querySelector('.baozi-report-pick').hidden = list.length >= MAX_IMAGES;
    };
    drawImgs();

    imgs.addEventListener('click', (ev) => {
        const i = ev.target.closest('[data-del]')?.dataset.del;
        if (i === undefined) return;
        URL.revokeObjectURL(list[i].url);
        list.splice(Number(i), 1);
        drawImgs();
    });
    box.querySelector('.baozi-report-pick input').addEventListener('change', async (ev) => {
        for (const file of [...ev.target.files].slice(0, MAX_IMAGES - list.length)) {
            try {
                const blob = await normalizeImage(file);
                list.push({ blob, url: URL.createObjectURL(blob) });
            } catch (e) { msg.textContent = '❌ ' + t(e.message); }
        }
        ev.target.value = '';
        drawImgs();
    });
    box.querySelector('[data-a="peek"]').onclick = async () => {
        peek.hidden = !peek.hidden;
        if (!peek.hidden) peek.textContent = JSON.stringify(await snapshot(), null, 1);
    };
    send.onclick = async () => {
        const words = text.value.trim();
        if (!words) { msg.textContent = t('先寫一句發生了什麼～'); return; }
        send.disabled = true;
        try {
            const shotIds = [];
            for (const [i, it] of list.entries()) {
                msg.textContent = t(`傳圖中（${i + 1}/${list.length}）…`);
                shotIds.push(await uploadImage(it.blob));
            }
            msg.textContent = t('送出中…');
            const res = await botFetch('/club/report', {
                method: 'POST', body: { text: words, shot_ids: shotIds, ...(await snapshot()) },
            });
            msg.innerHTML = t(`✓ 送出了（#${esc(res.number)}），跟克總說「看一下報錯」就好`);
            text.value = '';
            list.splice(0).forEach(it => URL.revokeObjectURL(it.url));
            drawImgs();
            writeLog([]);
            try { localStorage.removeItem(TRACE_KEY); } catch { /* */ }
            onDone?.();
        } catch (e) {
            msg.textContent = '❌ ' + t(e.message);
        } finally {
            send.disabled = false;
        }
    };
    return text;
}

/** 設定畫面裡的「🐞 回報問題」那一塊。 */
export function renderReport(box) {
    reportForm(box);
}

/**
 * 小包子的「🐞 回報問題」：直接跳出回報視窗。
 * 不自動截圖 —— html2canvas 要把整頁酒館複製重畫，iPhone 上整個網頁會卡死（米米回報）。
 */
export async function openReportModal() {
    const modal = document.createElement('div');
    modal.className = 'baozi-shot-modal baozi-report-modal';
    modal.innerHTML = `
        <div class="baozi-shot-card">
            <div class="baozi-shot-title">🐞 回報問題</div>
            <div class="baozi-setup-hint">要附畫面的話：先用手機截圖，再按「📷 從相簿選」</div>
            <div data-k="form"></div>
            <div class="baozi-shot-actions"><button class="baozi-btn-small" data-a="close">關掉</button></div>
        </div>`;
    document.body.appendChild(modal);
    reportForm(modal.querySelector('[data-k="form"]'), {
        onDone: () => setTimeout(() => modal.remove(), 1800),
    });
    localizeLive(modal);
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal || ev.target.closest('[data-a="close"]')) modal.remove();
    });
}
