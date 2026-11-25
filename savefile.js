// ⬇️ 存到手機（2.23.0，米米 11/25：生圖存不下來）
//
// iPhone 上的酒館常常不給長按存圖，所以給一顆按鈕，依次試：
//   1. 分享選單：iPhone 有「儲存影像」，直接進「照片」
//   2. 下載（<a download>）：存到「檔案」或瀏覽器的下載
// 都不行的話，大圖還在畫面上，可以再試長按。

import { localizeLive, t } from './i18n.js';

function toast(msg, kind = 'info') {
    const tt = globalThis.toastr;
    if (tt?.[kind]) tt[kind](t(msg)); else console.log('[包子同好會]', msg);
}

const EXT = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * 把一張圖存到手機。
 * @param src 圖的網址（同網域、blob:）或 Blob
 * @returns 'share'｜'cancel'｜'download'
 */
export async function saveImage(src, base = 'baozi') {
    let blob = src instanceof Blob ? src : null;
    if (!blob) {
        const res = await fetch(src);
        if (!res.ok) throw new Error('讀不到這張圖');
        blob = await res.blob();
    }
    const type = blob.type || 'image/png';
    const name = `${base}-${Date.now()}.${EXT[type] || 'png'}`;
    try {
        const file = new File([blob], name, { type });
        if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file] });
            return 'share';
        }
    } catch (e) {
        if (e?.name === 'AbortError') return 'cancel';
        // NotAllowedError（讀圖花太久，分享選單不讓開）之類：改用下載
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'download';
}

/** 按鈕用：存，然後說一聲。 */
export async function saveAndTell(src, base) {
    try {
        const how = await saveImage(src, base);
        if (how === 'download') toast('⬇️ 下載了。沒看到的話，點開大圖再長按試試');
    } catch (e) {
        toast('❌ 存不了：' + e.message, 'error');
    }
}

/** 點開看大圖：點旁邊關掉，下面一顆「⬇️ 存到手機」。 */
export function openViewer(src, base) {
    const v = document.createElement('div');
    v.className = 'baozi-chat-viewer';
    v.innerHTML = `<img src="${String(src).replace(/"/g, '&quot;')}" alt=""><button class="baozi-viewer-save">⬇️ 存到手機</button>`;
    v.addEventListener('click', (ev) => {
        if (ev.target.closest('.baozi-viewer-save')) {
            ev.stopPropagation();
            saveAndTell(src, base);
            return;
        }
        v.remove();
    });
    document.body.appendChild(v);
    localizeLive(v);
    return v;
}
