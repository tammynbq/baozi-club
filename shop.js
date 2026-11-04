// ============================================================
// 🛍️ 商店、🎒 背包、🎁 送老公
// ============================================================
// 東西、價錢、每天上架什麼、老公收到怎麼反應，都在大包子（shop.py）。
// 這裡只負責畫面：今天的架子、背包、挑一位老公送出去、看他的反應。
// 錢包跟桌面、小世界、Discord 是同一份包子幣。
// ============================================================

import { bot, botFetch } from './bot.js';
import { localizeLive, t } from './i18n.js';

function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

let tab = 'shelf';

/** 送禮的小視窗：挑老公 → 送出 → 他的反應。 */
function giftModal(item, husbands, onDone) {
    const modal = document.createElement('div');
    modal.className = 'baozi-shot-modal';
    const free = item.name === '抱抱';
    modal.innerHTML = `
        <div class="baozi-shot-card bz-gift-card">
            <div class="baozi-shot-title">${free ? '🤗 給誰一個抱抱？' : `🎁 把${esc(item.icon)} ${esc(item.label)}送給…`}</div>
            <div class="bz-gift-who">
                ${husbands.map(h => `<button class="baozi-tag-chip" data-who="${esc(h)}">${esc(h)}</button>`).join('')}
            </div>
            <div class="bz-gift-say" data-k="say" hidden></div>
            <div class="baozi-shot-actions"><button class="baozi-btn-small" data-a="close">關掉</button></div>
        </div>`;
    document.body.appendChild(modal);
    localizeLive(modal);
    modal.addEventListener('click', async (ev) => {
        if (ev.target === modal || ev.target.closest('[data-a="close"]')) { modal.remove(); return; }
        const who = ev.target.closest('[data-who]');
        if (!who || who.disabled) return;
        modal.querySelectorAll('[data-who]').forEach(b => { b.disabled = true; });
        const say = modal.querySelector('[data-k="say"]');
        say.hidden = false;
        say.textContent = t('送出中…');
        try {
            const res = await botFetch('/club/gift', { method: 'POST', body: { character: who.dataset.who, item: item.name } });
            say.innerHTML = `<b>${esc(who.dataset.who)}</b>${res.ok ? '' : '（今天收夠了）'}<br>${esc(res.reaction).replace(/\n/g, '<br>')}`;
            if (res.ok) onDone?.(res);
            else modal.querySelectorAll('[data-who]').forEach(b => { b.disabled = false; });
        } catch (e) {
            say.textContent = '❌ ' + t(e.message);
            modal.querySelectorAll('[data-who]').forEach(b => { b.disabled = false; });
        }
    });
}

/** @param ui {back()} */
export async function renderShopScreen(container, ui) {
    container.innerHTML = `
        <div class="baozi-screen bz-shop">
            <div class="baozi-screen-header">
                <button class="baozi-back" data-a="back">← 回首頁</button>
                <h3>🛍️ 商店</h3>
                <span class="bz-shop-coins" data-k="coins"></span>
            </div>
            <div class="baozi-lib-chips">
                <button class="baozi-tag-chip" data-tab="shelf">🛍️ 今天上架</button>
                <button class="baozi-tag-chip" data-tab="bag">🎒 我的背包</button>
                <button class="baozi-tag-chip" data-tab="husbands">💰 老公們的錢包</button>
            </div>
            <div data-k="body"><div class="baozi-loading">載入中...</div></div>
        </div>`;
    const body = container.querySelector('[data-k="body"]');
    const coinsEl = container.querySelector('[data-k="coins"]');
    let shelf = [], bag = [], husbands = [], coins = 0;

    const setCoins = (n) => { coins = n; coinsEl.textContent = `🥟 ${n}`; };

    const draw = () => {
        container.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        if (tab === 'shelf') {
            body.innerHTML = `
                <div class="baozi-setup-hint">每天早上 6 點換一批。買了放進背包，可以送給老公。</div>
                <div class="bz-shop-grid">
                    ${shelf.map(it => `
                        <div class="bz-shop-item ${it.pick_by ? 'pick' : ''}">
                            ${it.pick_by ? `<div class="bz-shop-pick">${esc(it.pick_by)}推薦</div>` : ''}
                            <div class="bz-shop-icon">${esc(it.icon)}</div>
                            <div class="bz-shop-name">${esc(it.label)}</div>
                            <button class="baozi-btn-small ${coins >= it.price ? 'baozi-on' : ''}" data-buy="${esc(it.name)}">🥟 ${it.price}</button>
                        </div>`).join('')}
                </div>`;
        } else if (tab === 'bag') {
            const items = [{ name: '抱抱', label: '抱抱（不用錢）', icon: '🤗', qty: '∞' }, ...bag];
            body.innerHTML = `
                <div class="baozi-setup-hint">點一樣東西送給老公。一位老公一天收 3 件；在小世界裡也送得到。</div>
                <div class="bz-shop-grid">
                    ${items.map(it => `
                        <div class="bz-shop-item" data-give="${esc(it.name)}">
                            <div class="bz-shop-icon">${esc(it.icon)}</div>
                            <div class="bz-shop-name">${esc(it.label)}</div>
                            <div class="bz-shop-qty">×${esc(it.qty)}</div>
                        </div>`).join('')}
                </div>
                ${bag.length ? '' : '<div class="baozi-empty">背包還是空的～去「今天上架」逛逛</div>'}`;
        } else {
            body.innerHTML = `
                <div class="baozi-setup-hint">老公們每天會領薪水。早安的時候，他們有時候會給你零花錢～</div>
                <div class="bz-shop-wallets">
                    ${husbands.map(h => `<div class="bz-shop-wallet"><b>${esc(h.character)}</b><span>🥟 ${h.coins}</span></div>`).join('')}
                </div>`;
        }
        localizeLive(body);
    };

    const load = async () => {
        try {
            const [s, b] = await Promise.all([botFetch('/club/shop'), botFetch('/club/bag')]);
            shelf = s.shelf; setCoins(s.coins);
            bag = b.items; husbands = b.husbands.map(c => ({ character: c, coins: '…' }));
            draw();
            botFetch('/club/husbands').then(r => { husbands = r.husbands; if (tab === 'husbands') draw(); }).catch(() => {});
        } catch (e) {
            body.innerHTML = `<div class="baozi-error">${esc(t(e.message))}</div>`;
        }
    };

    container.querySelector('.bz-shop').addEventListener('click', async (ev) => {
        if (ev.target.closest('[data-a="back"]')) { ui.back(); return; }
        const tb = ev.target.closest('[data-tab]');
        if (tb) { tab = tb.dataset.tab; draw(); return; }
        const buy = ev.target.closest('[data-buy]');
        if (buy) {
            buy.disabled = true;
            try {
                const res = await botFetch('/club/shop/buy', { method: 'POST', body: { item: buy.dataset.buy } });
                setCoins(res.coins);
                bag = res.bag;
                buy.textContent = t('✓ 放進背包了');
                setTimeout(draw, 900);
            } catch (e) {
                buy.disabled = false;
                alert(t(e.message));
            }
            return;
        }
        const give = ev.target.closest('[data-give]');
        if (give) {
            const item = give.dataset.give === '抱抱'
                ? { name: '抱抱', label: '抱抱', icon: '🤗' }
                : bag.find(x => x.name === give.dataset.give);
            if (!item) return;
            giftModal(item, husbands.map(h => h.character), (res) => { bag = res.bag || bag; if (tab === 'bag') draw(); });
        }
    });

    localizeLive(container);
    await load();
}
