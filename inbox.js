// ============================================================
// 📮 報告克總（信箱）
// ============================================================
// 她寫的回報／問題、克總的回覆都在這裡。一則＝BIG-baozi 的一個 GitHub issue，
// 克總在 issue 底下留言，大包子拉回來（GET /club/inbox）。
// 克總不是一直在線：米米跟他說「看一下信箱」他才會來回。
// ============================================================

import { botFetch, isBotLoggedIn } from './bot.js';
import { localizeLive, t } from './i18n.js';
import { reportForm } from './report.js';

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

/** 克總的回覆是 markdown：只處理粗體、行內程式碼、連結，其他照原文。 */
function lightMarkdown(text) {
    return esc(text)
        .replace(/```[\s\S]*?```/g, m => `<pre>${m.slice(3, -3).replace(/^\w*\n/, '')}</pre>`)
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/\n/g, '<br>');
}

function when(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 未讀數（紅點、小包子用）；讀不到就當 0。 */
export async function inboxUnread() {
    if (!isBotLoggedIn()) return 0;
    try { return (await botFetch('/club/inbox?summary=1')).unread || 0; } catch { return 0; }
}

function threadHtml(th, open) {
    const badge = th.state === 'closed' ? '<span class="bz-ib-badge done">已解決</span>'
        : th.waiting ? '<span class="bz-ib-badge wait">等克總回</span>'
            : '<span class="bz-ib-badge">克總回了</span>';
    return `
        <div class="bz-ib-thread ${open ? 'open' : ''}" data-issue="${th.issue}">
            <div class="bz-ib-head" data-a="toggle">
                <span>${th.kind === 'ask' ? '💬' : '🐞'}</span>
                <span class="bz-ib-title" data-raw>${esc(th.title)}</span>
                ${th.unread ? `<span class="bz-ib-dot">${th.unread}</span>` : ''}
                ${badge}
            </div>
            ${open ? `
            <div class="bz-ib-body">
                ${th.messages.map(m => `
                    <div class="bz-ib-msg ${m.from}">
                        <div class="bz-ib-who">${m.from === 'me' ? '我' : '🤖 克總'} · ${when(m.at)}</div>
                        <div class="bz-ib-text" data-raw>${m.from === 'me' ? esc(m.text).replace(/\n/g, '<br>') : lightMarkdown(m.text)}</div>
                    </div>`).join('')}
                <div class="bz-ib-reply" data-k="reply"></div>
            </div>` : ''}
        </div>`;
}

/**
 * @param ui {back()}
 */
export async function renderInboxScreen(container, ui) {
    container.innerHTML = `
        <div class="baozi-screen">
            <div class="baozi-screen-header">
                <button class="baozi-back" id="baozi-back">← 回首頁</button>
                <h3>📮 報告克總</h3>
            </div>
            <details class="bz-ib-new">
                <summary>✏️ 寫給克總</summary>
                <div data-k="new"></div>
            </details>
            <div class="baozi-setup-hint">克總不是一直在線：寫好後跟他說「看一下信箱」，他回了這裡會亮紅點。</div>
            <div class="bz-ib-list" data-k="list"><div class="baozi-loading">載入中...</div></div>
        </div>`;
    container.querySelector('#baozi-back').addEventListener('click', ui.back);
    const list = container.querySelector('[data-k="list"]');
    let threads = [];
    let openIssue = null;

    const draw = () => {
        list.innerHTML = threads.length
            ? threads.map(th => threadHtml(th, th.issue === openIssue)).join('')
            : '<div class="baozi-empty">還沒寫過信～</div>';
        const box = list.querySelector('.bz-ib-thread.open [data-k="reply"]');
        if (box) {
            reportForm(box, {
                issue: openIssue,
                onDone: (res) => {
                    const i = threads.findIndex(x => x.issue === openIssue);
                    if (i >= 0 && res?.thread) threads[i] = res.thread;
                    setTimeout(draw, 800);
                },
            });
        }
        localizeLive(list);
    };

    const load = async () => {
        try {
            threads = (await botFetch('/club/inbox')).threads || [];
        } catch (e) {
            list.innerHTML = `<div class="baozi-error">${esc(t(e.message))}</div>`;
            return;
        }
        draw();
    };

    reportForm(container.querySelector('[data-k="new"]'), {
        kind: 'ask',
        onDone: () => setTimeout(() => {
            container.querySelector('.bz-ib-new').open = false;
            load();
        }, 1200),
    });
    localizeLive(container);

    list.addEventListener('click', async (ev) => {
        const head = ev.target.closest('[data-a="toggle"]');
        if (!head) return;
        const issue = Number(head.closest('[data-issue]').dataset.issue);
        openIssue = openIssue === issue ? null : issue;
        const th = threads.find(x => x.issue === issue);
        if (openIssue && th?.unread) {
            th.unread = 0;
            botFetch(`/club/inbox/${issue}/read`, { method: 'POST', body: {} }).catch(() => {});
        }
        draw();
    });

    await load();
}
