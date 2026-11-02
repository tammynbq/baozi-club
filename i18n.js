// ============================================================
// 🀄 介面簡繁：跟著 tt 的語言
// ============================================================
// club 的介面字都用繁體寫；tt 是簡體時，畫面畫好後自動把介面字轉成簡體。
// 她們自己寫的東西（指令標題、內容、題材、備註、聊天訊息）放在 data-raw 的元素裡，
// 轉換時整塊跳過 —— 那是她們的原文，不該被動。
//
// 轉換表只收 club 自己用到的字（scripts 產生），先換詞（登入→登录、設定→设置…）再逐字換。
// 以後加了新字沒在表裡，就照原樣顯示繁體，不會壞，重新產生一次表就好。
// ============================================================

const PHRASES = [["登入碼", "登录码"], ["登入", "登录"], ["登出", "退出登录"], ["設定", "设置"], ["訊息", "消息"], ["預設", "默认"], ["介面", "界面"], ["搜尋", "搜索"], ["載入", "加载"], ["連線", "连接"], ["帳號", "账号"], ["資料庫", "数据库"], ["程式", "程序"], ["檔案", "文件"], ["伺服器", "服务器"], ["裝置", "设备"], ["支援", "支持"], ["儲存", "保存"], ["貼上", "粘贴"], ["螢幕", "屏幕"], ["影片", "视频"], ["著", "着"]];
const TRAD = "丟並併來係個們備傳僅優儲內兩別刪則剛剝劇動務區員問啟單嗎嘗圍圓圖執場塊壇壞夠實寫專尋對屜層屬帳帶幀幫幾庫廳張彈後徑從復態慮憶應掛換撈擇擊擋據擴擾攔敗數斷於時暢暫會東條棄構樂標樣橋機檔檢欄權歡歷歸殘殼決沒減湊準滾濾瀏為無熱牆狀現環畫異當疊發盡監確碼種稱積穩範篩簡籤紀約紅紋純級細組結絕給統綁經維網線編緩縮總繪聯聽脫腦與舊蒐蓋薦處號螢衝補裝裡製複見規視覽觀觸計訊記設許訴詢試話認誤說誰請論講證譜護讀變讓讚貝費貼資賴趕躍較載輪輯輸轉這連進過遞適選還邊邏釘鈕錄錯鍵鐘鑰長門閃閉開間關陣隨險隱雙雜離電靜響頁項順預頭頻顆題類顯館馬驗體麼點齊";
const SIMP = "丢并并来系个们备传仅优储内两别删则刚剥剧动务区员问启单吗尝围圆图执场块坛坏够实写专寻对屉层属帐带帧帮几库厅张弹后径从复态虑忆应挂换捞择击挡据扩扰拦败数断于时畅暂会东条弃构乐标样桥机档检栏权欢历归残壳决没减凑准滚滤浏为无热墙状现环画异当叠发尽监确码种称积稳范筛简签纪约红纹纯级细组结绝给统绑经维网线编缓缩总绘联听脱脑与旧搜盖荐处号萤冲补装里制复见规视览观触计讯记设许诉询试话认误说谁请论讲证谱护读变让赞贝费贴资赖赶跃较载轮辑输转这连进过递适选还边逻钉钮录错键钟钥长门闪闭开间关阵随险隐双杂离电静响页项顺预头频颗题类显馆马验体么点齐";
const CHAR_MAP = new Map([...TRAD].map((c, i) => [c, SIMP[i]]));

function normalizeLocale(code) {
    const c = String(code || '').toLowerCase().replace('_', '-');
    if (!c.startsWith('zh')) return null;
    return /(tw|hk|mo|hant)/.test(c) ? 'zh-TW' : 'zh-CN';
}

/** tt 現在的介面語言（簡體 → zh-CN，其他都當繁體）。 */
export function detectLocale() {
    const candidates = [];
    try { candidates.push(globalThis.SillyTavern?.getContext?.()?.getCurrentLocale?.()); } catch { /* 舊版沒有 */ }
    try { candidates.push(localStorage.getItem('language')); } catch { /* 被封鎖 */ }
    candidates.push(document.documentElement?.lang, navigator.language);
    for (const c of candidates) {
        const n = normalizeLocale(c);
        if (n) return n;
    }
    return 'zh-TW';
}

let locale = null;
export function currentLocale() {
    if (!locale) locale = detectLocale();
    return locale;
}
/** 打開面板時重新看一次（她可能在 tt 換了語言）。 */
export function refreshLocale() { locale = detectLocale(); }

export function toSimplified(text) {
    let out = String(text);
    for (const [a, b] of PHRASES) out = out.split(a).join(b);
    let res = '';
    for (const ch of out) res += CHAR_MAP.get(ch) || ch;
    return res;
}

/** 給 alert / confirm 這種不在畫面裡的字用。 */
export function t(text) {
    return currentLocale() === 'zh-CN' ? toSimplified(text) : text;
}

const ATTRS = ['placeholder', 'title', 'aria-label'];

function convertNode(node) {
    if (currentLocale() !== 'zh-CN') return;
    if (node.nodeType === Node.TEXT_NODE) {
        if (node.parentElement?.closest('[data-raw], textarea, script, style')) return;
        const next = toSimplified(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
        return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.closest('[data-raw]')) return;
    for (const attr of ATTRS) {
        const v = node.getAttribute?.(attr);
        if (v) {
            const next = toSimplified(v);
            if (next !== v) node.setAttribute(attr, next);
        }
    }
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: n => (n.nodeType === Node.ELEMENT_NODE && n.hasAttribute('data-raw'))
            ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let n = walker.nextNode();
    while (n) {
        if (n.nodeType === Node.TEXT_NODE) {
            if (!n.parentElement?.closest('textarea, script, style')) {
                const next = toSimplified(n.nodeValue);
                if (next !== n.nodeValue) n.nodeValue = next;
            }
        } else {
            for (const attr of ATTRS) {
                const v = n.getAttribute(attr);
                if (v) {
                    const next = toSimplified(v);
                    if (next !== v) n.setAttribute(attr, next);
                }
            }
        }
        n = walker.nextNode();
    }
}

/** 盯著這塊：之後畫上去的介面字都自動轉。 */
export function localizeLive(root) {
    if (!root || root.__baoziI18n) return;
    root.__baoziI18n = true;
    convertNode(root);
    new MutationObserver(records => {
        if (currentLocale() !== 'zh-CN') return;
        for (const r of records) {
            if (r.type === 'characterData') convertNode(r.target);
            else if (r.type === 'attributes') convertNode(r.target);
            else r.addedNodes.forEach(convertNode);
        }
    }).observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
