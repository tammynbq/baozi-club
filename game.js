// ============================================================
// 🎮 小小世界（像素小遊戲）
// ============================================================
// 遊戲本身放在大包子（/game/），這裡只是在包子裡開一個全屏的框。
// 網址帶 ?who= 告訴遊戲是誰在玩，不用再選自己。
// 放大包子而不是插件：改遊戲只要大包子部署，不用她們去酒館按更新。
// ============================================================

import { bot } from './bot.js';

function who() {
    return bot.me?.name === '一帆' ? 'yifan' : 'mimi';
}

export function closeGame() {
    document.getElementById('baozi-body')?.classList.remove('baozi-body-game');
}

/** @param ui {back()} */
export function renderGameScreen(container, ui) {
    container.classList.add('baozi-body-game');
    const src = `${bot.url}/game/?who=${who()}`;
    container.innerHTML = `
        <div class="baozi-game">
            <div class="baozi-screen-header">
                <button class="baozi-back" data-a="back">← 回首頁</button>
                <h3>🎮 小小世界</h3>
                <button class="baozi-btn-small baozi-game-reload" data-a="reload" title="重新整理">↻</button>
            </div>
            <iframe class="baozi-game-frame" src="${src}" title="小小世界"></iframe>
        </div>`;
    const frame = container.querySelector('iframe');
    // 鑰匙用 postMessage 給遊戲（不放網址，免得留在紀錄裡）；遊戲用它讀寫包子幣錢包
    const origin = new URL(bot.url).origin;
    const sendKey = () => frame.contentWindow?.postMessage({ type: 'baozi-auth', token: bot.token }, origin);
    frame.addEventListener('load', sendKey);
    const onReady = (ev) => {
        if (!document.body.contains(frame)) { window.removeEventListener('message', onReady); return; }
        if (ev.source === frame.contentWindow && ev.data?.type === 'baozi-game-ready') sendKey();
    };
    window.addEventListener('message', onReady);
    container.querySelector('.baozi-game').addEventListener('click', (ev) => {
        const a = ev.target.closest('[data-a]')?.dataset.a;
        if (a === 'back') { closeGame(); ui.back(); }
        if (a === 'reload') frame.src = src + '&t=' + Date.now();
    });
}
