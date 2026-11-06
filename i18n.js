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

const PHRASES = [["登入碼", "登录码"], ["登入", "登录"], ["登出", "退出登录"], ["設定", "设置"], ["訊息", "消息"], ["預設", "默认"], ["介面", "界面"], ["搜尋", "搜索"], ["載入", "加载"], ["連線", "连接"], ["帳號", "账号"], ["資料庫", "数据库"], ["程式", "程序"], ["檔案", "文件"], ["伺服器", "服务器"], ["裝置", "设备"], ["支援", "支持"], ["儲存", "保存"], ["貼上", "粘贴"], ["螢幕", "屏幕"], ["影片", "视频"], ["著", "着"], ["相簿", "相册"]];
const TRAD = "丟並乾亂併來係個們傘備傳僅價優儲兇兒內兩凍別刪則剛剝劇動務區員問啞啟單嗎嘗囉圍圓圖團執報場塊壇壓壞夠夾實寧寫寬專尋對屜層屬師帳帶幀幣幫幾庫廠廳張強彈後徑從復愛態慣慮憶應戀戲捲掃掛換摺撈撐擇擊擋據擴擾攔敗數斷於時暢暫曆書會東條棄極構樂樓標樣橋機橫檔檢欄權歡歲歷歸殘殼氣決沒淨減測湊湯準溫滾滿漸濾瀏為無煩熱燈爾牆狀現環畫異當疊癢癮發盡監睏睜確碼禮種稱積穩筆箋節範篩簡簽籠籤紀約紅紋純紙級細組結絕給統綁經綠維網綴線編緩縮總織繪續習聯聽肅脫腦膠臘與舊華葉蒐蓋薦藥處號螢衝補裝裡製複見規視覺覽觀觸訂計訊託記設許訴診詞詢試話該誌認語誤說誰請論謎講謝證譜譯護讀變讓讚貝負責貴買費貼賀資賞賴賺趕跡躍軌較載輕輪輯輸轉農這連進遊過達遞遠適選還邊邏郵釘鈕銜鋪錄錢錯鍵鐘鑰長門閃閉開閏間關陣陰陽隨險隱雙雜雞離難雲電霧靜響頁頂項順預領頭頻顆題顏類顯風飯飽飾餃餅館馬驗體鬧鹹麼點齊龍";
const SIMP = "丢并干乱并来系个们伞备传仅价优储凶儿内两冻别删则刚剥剧动务区员问哑启单吗尝啰围圆图团执报场块坛压坏够夹实宁写宽专寻对屉层属师帐带帧币帮几库厂厅张强弹后径从复爱态惯虑忆应恋戏卷扫挂换折捞撑择击挡据扩扰拦败数断于时畅暂历书会东条弃极构乐楼标样桥机横档检栏权欢岁历归残壳气决没净减测凑汤准温滚满渐滤浏为无烦热灯尔墙状现环画异当叠痒瘾发尽监困睁确码礼种称积稳笔笺节范筛简签笼签纪约红纹纯纸级细组结绝给统绑经绿维网缀线编缓缩总织绘续习联听肃脱脑胶腊与旧华叶搜盖荐药处号萤冲补装里制复见规视觉览观触订计讯托记设许诉诊词询试话该志认语误说谁请论谜讲谢证谱译护读变让赞贝负责贵买费贴贺资赏赖赚赶迹跃轨较载轻轮辑输转农这连进游过达递远适选还边逻邮钉钮衔铺录钱错键钟钥长门闪闭开闰间关阵阴阳随险隐双杂鸡离难云电雾静响页顶项顺预领头频颗题颜类显风饭饱饰饺饼馆马验体闹咸么点齐龙";
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
