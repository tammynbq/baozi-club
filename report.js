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
import { currentLocale, t } from './i18n.js';
import { installedVersion } from './version.js';

const LOG_KEY = 'baozi_errlog';
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
    };
}

/** 設定畫面裡的「🐞 回報問題」那一塊。 */
export function renderReport(box) {
    box.innerHTML = `
        <div class="baozi-setup-hint">哪裡怪怪的就寫一句，克總直接看得到。會一起帶上版本、現在開著的卡名和最近的錯誤訊息（不帶聊天內容）。</div>
        <textarea class="baozi-search baozi-report-text" rows="3" maxlength="2000" placeholder="例如：一帆的自動標記沒反應、按了截圖畫面變白…"></textarea>
        <div class="baozi-dice-pools">
            <button class="baozi-tag-chip active" id="baozi-report-send">🐞 送出</button>
            <button class="baozi-tag-chip" id="baozi-report-peek">看看會帶上什麼</button>
        </div>
        <pre class="baozi-report-peek" data-raw hidden></pre>
        <div class="baozi-setup-hint" id="baozi-report-msg"></div>`;
    const text = box.querySelector('.baozi-report-text');
    const msg = box.querySelector('#baozi-report-msg');
    const peek = box.querySelector('.baozi-report-peek');
    box.querySelector('#baozi-report-peek').onclick = async () => {
        peek.hidden = !peek.hidden;
        if (!peek.hidden) peek.textContent = JSON.stringify(await snapshot(), null, 1);
    };
    const send = box.querySelector('#baozi-report-send');
    send.onclick = async () => {
        const words = text.value.trim();
        if (!words) { msg.textContent = '先寫一句發生了什麼～'; return; }
        send.disabled = true;
        msg.textContent = '送出中…';
        try {
            const res = await botFetch('/club/report', { method: 'POST', body: { text: words, ...(await snapshot()) } });
            msg.innerHTML = `✓ 送出了（#${esc(res.number)}），跟克總說「看一下報錯」就好`;
            text.value = '';
            writeLog([]);
        } catch (e) {
            msg.textContent = '❌ ' + t(e.message);
        } finally {
            send.disabled = false;
        }
    };
}
