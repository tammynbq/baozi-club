// ============================================================
// 🎨 生圖（NovelAI）
// ============================================================
// 老公回完 → 副 API 讀正文寫 Danbooru tag（一段一張小卡）→ 按「🎨 畫」送 NovelAI → 圖放在那則訊息底下。
//
// - 畫師串和參數不在包子存：每畫一張都去讀「智繪姬」現在選的預設（yusheid_novelai）和它的 NovelAI 參數。
//   所以在 NAI 切換助手雙擊、抽卡、套參數預設，包子都跟著換；包子裡切換也照切換助手雙擊的做法寫回智繪姬。
// - NovelAI 連線（官網 key／第三方站）、寫 tag 的提示詞、固定外貌、模式都是包子自己的。
//   key 只存在這支手機（localStorage）；其他放酒館的擴充設定（換瀏覽器也在）。
// - 一次只畫一張（NovelAI 同一把 key 同時送兩張會 429），排隊。
// - 圖存進酒館的圖片資料夾（跟酒館內建生圖一樣），訊息裡只記路徑；「🥟 存相簿」才傳到大包子。
// - 每張圖都記下當時的畫師串（名字＋內容）、tag、型號、步數、CFG、採樣器、尺寸、種子。
// ============================================================

import { bot } from './bot.js';
import { loadProfiles, activeProfile, callModel } from './aidesign.js';
import { localizeLive, t } from './i18n.js';
import { openViewer, saveAndTell } from './savefile.js';
import { addLog, listLogs, logFor, openLog } from './picslog.js';
import { drawPainter, painterHtml, showBubble, closeBubble } from './xiaobaozi.js';

const EXT = 'baozi-club';
const KEY_CONNS = 'baozi_nai_conns';
const KEY_CONN_ACTIVE = 'baozi_nai_active';
const OFFICIAL_URL = 'https://image.novelai.net/ai/generate-image';
const TIMEOUT_MS = 300_000;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function stx() {
    try { return globalThis.SillyTavern?.getContext?.() || null; } catch { return null; }
}

// ============================================================
// 設定
// ============================================================

/** NovelAI 連線（只在這支手機）：[{id, name, mode: official|custom, url, key, viaBot}] */
export function loadConns() {
    try { return JSON.parse(localStorage.getItem(KEY_CONNS) || '[]'); } catch { return []; }
}
export function saveConns(list) {
    try { localStorage.setItem(KEY_CONNS, JSON.stringify(list)); } catch { /* 存不了 */ }
}
export function activeConn() {
    const list = loadConns();
    let id = null;
    try { id = localStorage.getItem(KEY_CONN_ACTIVE); } catch { /* */ }
    return list.find(c => c.id === id) || list[0] || null;
}
export function setActiveConn(id) {
    try { localStorage.setItem(KEY_CONN_ACTIVE, id); } catch { /* */ }
}

const DEFAULT_PREFS = {
    auto: false,          // 回完自動寫 tag、排隊畫
    count: 1,             // （舊的）一則畫幾張
    countMin: 1,          // 一則畫幾到幾張
    countMax: 1,
    tagApi: '',           // 寫 tag 用哪組 API（aidesign 的），空＝用排版那組
    promptId: 'builtin',  // 寫 tag 的提示詞
    lastChip: true,       // 最後一則老公的回覆底下顯示「🎨 生圖」
    blockTags: '',        // 永遠不要出現的 tag（逗號或換行分開），畫之前拿掉
    cleanDays: 0,         // 🧹 幾天前的生圖自動刪掉（0＝不刪）
    ctxCount: 1,          // {{上下文}} 帶前面幾則 AI 訊息（一帆 11/25：智繪姬裡她設的是 1）
};

/** 不是祕密的東西放酒館的擴充設定：prefs、提示詞、固定外貌。 */
export function store() {
    const ctx = stx();
    const all = ctx?.extensionSettings || globalThis.extension_settings || {};
    all[EXT] ??= {};
    const s = all[EXT].pics ??= {};
    // 預設值補進同一個物件（不要換新的：設定頁拿著舊的那個在改，換掉就改不到了）
    s.prefs ??= {};
    for (const [k, v] of Object.entries(DEFAULT_PREFS)) if (!(k in s.prefs)) s.prefs[k] = v;
    if (!('countMin' in s.prefs)) { s.prefs.countMin = s.prefs.countMax = Number(s.prefs.count) || 1; }
    s.params ??= {};      // 沒裝智繪姬時，參數存這裡
    s.prompts ??= [];
    s.looks ??= { global: [], cards: {} };
    s.looks.global ??= [];
    s.looks.cards ??= {};
    return s;
}
export function saveStore() {
    const ctx = stx();
    (ctx?.saveSettingsDebounced || globalThis.saveSettingsDebounced)?.();
}
export const prefs = () => store().prefs;


// ============================================================
// 🖌️ 智繪姬（畫師串＋參數）和 NAI 切換助手
// ============================================================

const C8 = 'st-chatu8';
const NPS = 'nai_preset_switcher';
const NPS_DEFAULT_GROUP = '默认';

export function chatu8() {
    const ext = stx()?.extensionSettings || globalThis.extension_settings;
    const s = ext?.[C8];
    return s && typeof s === 'object' ? s : null;
}

const isOn = (v) => v === true || v === 'true';
const isOff = (v) => v === false || v === 'false';

/** 現在的畫師串：{name, fixedPrompt, fixedPrompt_end, negativePrompt}（沒裝智繪姬就是空的）。 */
export function currentArtist() {
    const c = chatu8();
    const name = c?.yusheid_novelai || '';
    const p = c?.yushe?.[name] || {};
    return { name, fixedPrompt: p.fixedPrompt || '', fixedPrompt_end: p.fixedPrompt_end || '', negativePrompt: p.negativePrompt || '' };
}

const FALLBACK = {
    novelaimode: 'nai-diffusion-4-5-full', novelai_steps: '28', nai3Scale: '5', cfg_rescale: '0',
    novelai_sampler: 'k_euler_ancestral', Schedule: 'karras', novelai_width: '832', novelai_height: '1216',
    novelai_seed: '0', UCP_novelai: 'Heavy', AQT_novelai: 'on', nai3Variety: 'false',
};

/** 現在的 NovelAI 參數（照智繪姬的欄位名；沒裝就用包子的預設）。 */
/** 參數存在哪：有智繪姬就是它的設定，沒有就是包子自己的。 */
function paramStore() {
    return chatu8() || store().params;
}

export function currentParams() {
    const c = paramStore();
    const g = (k) => (c[k] !== undefined && c[k] !== null && c[k] !== '' ? c[k] : FALLBACK[k]);
    return {
        model: String(g('novelaimode')),
        steps: Number(g('novelai_steps')) || 28,
        scale: Number(g('nai3Scale')) || 5,
        rescale: Number(g('cfg_rescale')) || 0,
        sampler: String(g('novelai_sampler')),
        schedule: String(g('Schedule') || ''),
        v5schedule: String(c.novelai_v5_schedule || ''),
        width: Number(g('novelai_width')) || 832,
        height: Number(g('novelai_height')) || 1216,
        seed: String(c.novelai_seed ?? '0'),
        ucp: String(g('UCP_novelai')),
        quality: c.AQT_novelai === undefined ? true : String(c.AQT_novelai) !== '',
        variety: !isOff(g('nai3Variety')),
        sm: !isOff(c.sm ?? 'false'),
        dyn: !isOff(c.dyn ?? 'false'),
        effort: String(c.novelai_v5_effort || ''),
        alpha: c.novelai_straight_alpha === true,
        hasChatu8: !!chatu8(),
    };
}

export function modelLabel(m) {
    const s = String(m || '');
    if (s.includes('diffusion-5')) return 'V5' + (s.includes('curated') ? ' curated' : '');
    if (s.includes('4-5')) return 'V4.5' + (s.includes('curated') ? ' curated' : '');
    if (s.includes('diffusion-4')) return 'V4' + (s.includes('curated') ? ' curated' : '');
    if (s.includes('diffusion-3')) return 'V3';
    return s || '?';
}

/** 「這次用：V5・28 步・CFG 5・Euler A・畫師串」 */
export function usingLine(params = currentParams(), artist = currentArtist()) {
    const sampler = String(params.sampler).replace(/^k_/, '').replace(/_ancestral$/, ' A');
    return `${modelLabel(params.model)}・${params.steps} 步・CFG ${params.scale}・${sampler}・${params.width}×${params.height}・${artist.name || '（沒選畫師串）'}`;
}

/** NAI 切換助手的收藏庫：[{id, name, positive, negative, thumb, category, naiParamGroup, naiParamsSelected, naiParams}] */
export async function npsEntries() {
    const ext = stx()?.extensionSettings || globalThis.extension_settings || {};
    const ns = ext[NPS];
    if (ns?.entries && typeof ns.entries === 'object') return Object.values(ns.entries).filter(e => e?.name);
    // 舊版切換助手存在 IndexedDB
    try {
        return await new Promise((resolve) => {
            const req = indexedDB.open('NAI_Prompt_Library_DB', 1);
            req.onupgradeneeded = () => { try { req.transaction.abort(); } catch { /* */ } resolve([]); };
            req.onsuccess = () => {
                try {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('entries')) { resolve([]); return; }
                    const all = db.transaction('entries', 'readonly').objectStore('entries').getAll();
                    all.onsuccess = () => resolve((all.result || []).filter(e => e?.name));
                    all.onerror = () => resolve([]);
                } catch { resolve([]); }
            };
            req.onerror = () => resolve([]);
        });
    } catch { return []; }
}

function npsParamGroups() {
    const ext = stx()?.extensionSettings || globalThis.extension_settings || {};
    return ext[NPS]?.paramGroups || {};
}

/** 照切換助手的規則找這個畫師串綁的參數。 */
function boundParams(entry) {
    if (!entry) return null;
    if (entry.naiParamsSelected) return entry.naiParams || null;
    const groups = npsParamGroups();
    const g = groups[entry.naiParamGroup || NPS_DEFAULT_GROUP];
    return g?.params || null;
}

function hostDoc() {
    try { return window.parent?.document || document; } catch { return document; }
}

function setField(id, value, checkbox = false) {
    const el = hostDoc().getElementById(id);
    if (!el) return false;
    const jq = window.jQuery || window.$;
    if (checkbox) {
        el.checked = !!value;
        if (jq) jq(el).prop('checked', !!value).trigger('change');
        else el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
        el.value = value;
        if (jq) jq(el).val(value).trigger('input').trigger('change');
        else { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    return true;
}

const CHECKBOX_FIELDS = new Set(['sm', 'dyn', 'nai3Variety', 'nai3Deceisp', 'novelai_straight_alpha']);

/** 參數寫回智繪姬：設定裡直接改（它沒載入也算數），畫面上的欄位也改（它自己會存）。 */
export function writeParams(params) {
    const c = paramStore();
    if (!params) return;
    const p = { ...params };
    const m = String(p.novelai_size || '').match(/^(\d+)x(\d+)$/);
    if (m) { p.novelai_width = m[1]; p.novelai_height = m[2]; }
    for (const [k, v] of Object.entries(p)) {
        if (v === undefined || v === null || k === 'novelai_size') continue;
        const box = CHECKBOX_FIELDS.has(k);
        c[k] = box ? String(isOn(v) || v === 1) : String(v);
        if (chatu8()) setField(k, box ? (isOn(v) || v === 1) : v, box);
    }
    if (p.novelai_size && chatu8()) setField('novelai_size', p.novelai_size);
    saveStore();
}

/** NAI 切換助手的參數預設：{名字: {params}} */
export function paramGroups() {
    return npsParamGroups();
}

/** 智繪姬「角色管理」裡的角色：[{key, name, sfw, nsfw}] */
export function chatu8Characters() {
    const c = chatu8();
    return Object.entries(c?.characterPresets || {})
        .filter(([, p]) => p && typeof p === 'object')
        .map(([key, p]) => ({ key, name: (p.nameCN || key).trim(), ...c8Looks(p) }))
        .filter(x => x.name && (x.sfw || x.nsfw));
}

function c8Looks(p) {
    return {
        sfw: join(p.characterTraits, p.facialFeatures, p.upperBodySFW, p.fullBodySFW),
        nsfw: join(p.upperBodyNSFW, p.fullBodyNSFW),
    };
}

/** 固定外貌連到智繪姬的角色：每次畫都讀它現在的（在智繪姬改了包子也跟著）。 */
export function linkedLooks(l) {
    if (!l?.c8) return null;
    const p = chatu8()?.characterPresets?.[l.c8];
    return p ? c8Looks(p) : { sfw: '', nsfw: '', missing: true };
}

/**
 * 切換畫師串（跟 NAI 切換助手雙擊一樣）：寫進智繪姬的預設清單、選它、套它綁的參數。
 * @param preset {name, fixedPrompt, fixedPrompt_end, negativePrompt}
 * @param params 要套的參數（智繪姬欄位名）；沒給就照切換助手的綁定找
 */
export async function switchArtist(preset, params = undefined) {
    const c = chatu8();
    if (!c) throw new Error('沒找到智繪姬（畫師串是讀它的），先裝上或打開它');
    const name = String(preset.name || '').trim();
    if (!name) throw new Error('畫師串沒有名字');
    c.yushe ??= {};
    c.yushe[name] = {
        fixedPrompt: preset.fixedPrompt || '',
        fixedPrompt_end: preset.fixedPrompt_end || '',
        negativePrompt: preset.negativePrompt || '',
    };
    c.yusheid_novelai = name;
    const sel = hostDoc().getElementById('yusheid_novelai');
    if (sel && ![...sel.options].some(o => o.value === name)) {
        const o = hostDoc().createElement('option');
        o.value = name; o.textContent = name; sel.appendChild(o);
    }
    setField('yusheid_novelai', name);
    setField('fixedPrompt_novelai', c.yushe[name].fixedPrompt);
    setField('fixedPrompt_end_novelai', c.yushe[name].fixedPrompt_end);
    setField('negativePrompt_novelai', c.yushe[name].negativePrompt);
    if (params === undefined) {
        const entry = (await npsEntries()).find(e => String(e.name).trim() === name);
        params = boundParams(entry);
    }
    if (params) writeParams(params);
    saveStore();
}

/** 從切換助手的收藏庫切換。 */
export async function switchToEntry(entry) {
    // 切換助手存的 positive 是整串（智繪姬的前＋後已經合在一起）
    await switchArtist({ name: entry.name, fixedPrompt: entry.positive || '', fixedPrompt_end: '', negativePrompt: entry.negative || '' },
        boundParams(entry));
}

/** 只有智繪姬自己的預設清單（切換助手讀不到時用）。 */
export function chatu8Presets() {
    const c = chatu8();
    return Object.entries(c?.yushe || {}).map(([name, p]) => ({ name, ...p }));
}


// ============================================================
// 🧾 組 NovelAI 的請求
// ============================================================

// NovelAI 官方的品質詞、負面預設（網頁版的那幾組）
const QUALITY = {
    'nai-diffusion-3': 'best quality, amazing quality, very aesthetic, absurdres',
    'nai-diffusion-4-full': 'no text, best quality, very aesthetic, absurdres',
    'nai-diffusion-4-curated-preview': 'rating:general, best quality, very aesthetic, absurdres',
    'nai-diffusion-4-5-full': 'very aesthetic, masterpiece, no text',
    'nai-diffusion-4-5-curated': 'very aesthetic, masterpiece, no text, -0.8::feet::, rating:general',
    'nai-diffusion-5-full': 'very aesthetic, masterpiece, no text',
    'nai-diffusion-5-curated': 'very aesthetic, masterpiece, no text',
};
const UC_V45 = {
    heavy: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page',
    light: 'lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page',
    humanfocus: 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy',
    furryfocus: '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic',
};
const UC = {
    'nai-diffusion-3': {
        heavy: 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]',
        light: 'lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing',
        humanfocus: 'lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes',
    },
    'nai-diffusion-4-full': {
        heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page',
        light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page',
    },
    'nai-diffusion-4-curated-preview': {
        heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page',
        light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page',
    },
    'nai-diffusion-4-5-full': UC_V45,
    'nai-diffusion-4-5-curated': {
        heavy: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page',
        light: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
        humanfocus: 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page',
    },
    v5: { ...UC_V45, light: 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::' },
};
const UCP_INT = { heavy: 1, furryfocus: 2, light: 3, humanfocus: 4 };

export const hasNsfw = (tags) => /(^|[,{\[(\s])nsfw([,}\])\s:]|$)/i.test(String(tags || ''));

const join = (...parts) => parts.map(p => String(p || '').trim().replace(/^,+|,+$/g, '').trim()).filter(Boolean).join(', ');

function ucText(model, ucp) {
    const key = String(ucp || '').toLowerCase().replace(/[\s_-]+/g, '');
    const table = model.includes('diffusion-5') ? UC.v5 : UC[model] || {};
    return table[key] || '';
}

function randomSeed() {
    return Math.floor(Math.random() * 4294967295);
}

/** 「中文註解」智繪姬的畫師串裡常有 // 或（）中文說明，NovelAI 看不懂，送出去前拿掉。 */
function stripNotes(text) {
    return String(text || '')
        .split('\n').map(l => l.replace(/\/\/.*$/, '')).join(', ')
        .replace(/[（(][^()（）]*[一-鿿][^()（）]*[)）]/g, '')
        .replace(/，/g, ',').replace(/\s*,\s*(,\s*)+/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '');
}

// ---------- 🧹 去重複、屏蔽（11/26 一帆：AI 寫的 tag 很多重複的） ----------
// 畫之前才做（🏷️ 裡看到的照原樣）。比較時不看大小寫、底線／空白、{} [] () 和加權寫法；
// 重複的留第一個，但後面那個有加權、前面沒有的話換成有加權的（跟智繪姬一樣）。

/** 照最外層的逗號切（{a, b} 這種括起來的一組不切開）。 */
function splitTop(s) {
    const out = [];
    let depth = 0;
    let cur = '';
    for (const ch of String(s || '')) {
        if ('{[('.includes(ch)) depth++;
        else if ('}])'.includes(ch)) depth = Math.max(0, depth - 1);
        if ((ch === ',' || ch === '，') && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    out.push(cur);
    return out;
}

export const tagKey = (t) => String(t || '').toLowerCase()
    .replace(/^\s*-?\d+(?:\.\d+)?::/, '').replace(/::\s*$/, '')
    .replace(/[{}\[\]()]/g, '')
    .replace(/:\s*-?\d+(?:\.\d+)?\s*$/, '')
    .replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
const weighted = (t) => /[{}\[\]()]|::/.test(t);

function blockSet() {
    return new Set(String(prefs().blockTags || '').split(/[,，\n]/).map(tagKey).filter(Boolean));
}

/** 一串 tag：拿掉重複的、拿掉屏蔽清單裡的（block 傳空的 Set＝不屏蔽，負面用）。 */
export function cleanList(text, block = blockSet()) {
    const out = [];
    const at = new Map();
    for (const raw of splitTop(text)) {
        const t = raw.trim();
        const k = tagKey(t);
        if (!k || block.has(k)) continue;
        if (at.has(k)) {
            const i = at.get(k);
            if (!weighted(out[i]) && weighted(t)) out[i] = t;
            continue;
        }
        at.set(k, out.length);
        out.push(t);
    }
    return out.join(', ');
}

/**
 * @param tags 這張的 tag（$名字$ 已經換好）
 * @param opt {params, artist, seed}：沒給就讀現在的（同種子重畫時給當時的）
 * @returns {body, meta}
 */
export function buildRequest(tags, opt = {}) {
    const p = opt.params || currentParams();
    const a = opt.artist || currentArtist();
    const model = p.model;
    const v5 = model.includes('diffusion-5');
    const v4 = model.includes('diffusion-4');
    const v3 = model === 'nai-diffusion-3';
    const quality = p.quality ? (QUALITY[model] || '') : '';
    // 🔞 NSFW 的圖：tag 裡沒有 nsfw 就補一個；不是的圖：負面加 nsfw（跟 NovelAI 官網一樣，curated 型號不用）
    const nsfw = !!opt.nsfw;
    // 分角色（V4 以上）：每個角色自己的 tag、位置、負面；角色 prompt 裡 1boy／1girl 寫成 boy／girl（NovelAI 建議的）
    const chars = (v4 || v5) ? (opt.chars || []).filter(c => c?.prompt) : [];
    const charText = (opt.chars || []).map(c => c.prompt).join(', ');
    const body0 = nsfw && !hasNsfw(tags) && !hasNsfw(charText) ? join('nsfw', tags) : tags;
    // V3 沒有分角色：角色的 tag 接在後面
    const block = blockSet();
    const positive = cleanList(join(stripNotes(a.fixedPrompt), body0, v3 ? charText : '', stripNotes(a.fixedPrompt_end), quality), block);
    const guard = !nsfw && !model.includes('curated') && !hasNsfw(positive) && !hasNsfw(charText) ? 'nsfw' : '';
    const negative = cleanList(join(guard, ucText(model, p.ucp), stripNotes(a.negativePrompt), opt.extraUC,
        v3 ? (opt.chars || []).map(c => c.uc).join(', ') : ''), new Set());
    const seed = opt.seed ?? (['0', '', '-1'].includes(String(p.seed)) ? randomSeed() : Number(p.seed));
    const parameters = {
        params_version: v5 ? 4 : 3,
        width: p.width, height: p.height, scale: p.scale, sampler: p.sampler, steps: p.steps, seed,
        n_samples: 1, ucPreset: 3, qualityToggle: !!quality,
        dynamic_thresholding: false, controlnet_strength: 1, legacy: false, legacy_uc: false,
        add_original_image: true, cfg_rescale: p.rescale, noise_schedule: p.schedule,
        legacy_v3_extend: false, negative_prompt: negative,
        deliberate_euler_ancestral_bug: false, prefer_brownian: true,
    };
    if (v3) {
        parameters.sm = p.sm;
        parameters.sm_dyn = p.sm && p.dyn;
    }
    if (v4 || v5) {
        const list = chars.map(c => ({
            prompt: cleanList(c.prompt.replace(/\b1(boy|girl|other)\b/gi, '$1'), block),
            uc: cleanList(c.uc || '', new Set()),
            center: { x: c.center?.x ?? 0.5, y: c.center?.y ?? 0.5 },
        }));
        const coords = chars.some(c => c.center?.set);
        parameters.use_coords = coords;
        parameters.characterPrompts = list.map(c => ({ prompt: c.prompt, uc: c.uc, center: c.center, enabled: true }));
        parameters.v4_prompt = { caption: { base_caption: positive, char_captions: list.map(c => ({ char_caption: c.prompt, centers: [c.center] })) }, use_coords: coords, use_order: true };
        parameters.v4_negative_prompt = { caption: { base_caption: negative, char_captions: list.map(c => ({ char_caption: c.uc, centers: [c.center] })) }, legacy_uc: false };
    }
    if (p.variety && !v5) {
        // Variety+：照官網的算法（V4.5 用 58，其他 19；跟畫面大小有關）
        const magic = model.includes('4-5') ? 58 : 19;
        parameters.skip_cfg_above_sigma = Math.sqrt((p.width * p.height) / 1011712) * magic;
    }
    let sendModel = model;
    if (v5) {
        parameters.tag_hint_uc_preset = UCP_INT[String(p.ucp).toLowerCase().replace(/[\s_-]+/g, '')] || 0;
        parameters.tag_hint_qt = 1;
        parameters.straight_alpha = p.alpha;
        if (p.alpha) parameters.tag_hint_transparent_background = true;
        if (!p.v5schedule || p.v5schedule === 'none') delete parameters.noise_schedule;
        else parameters.noise_schedule = p.v5schedule;
        if (parameters.sampler === 'ddim_v3') parameters.sampler = 'k_euler_ancestral';
        if (model === 'nai-diffusion-5-full' && p.effort === 'medium') {
            sendModel = 'nai-diffusion-5-full-medium';
            delete parameters.cfg_rescale;
            parameters.steps = 14;
            parameters.sampler = 'k_euler_ancestral';
        }
    }
    const body = { input: positive, model: sendModel, action: 'generate', parameters };
    const meta = {
        artist: { name: a.name, fixedPrompt: a.fixedPrompt, fixedPrompt_end: a.fixedPrompt_end, negativePrompt: a.negativePrompt },
        params: { ...p, seed: String(seed) },
        model: sendModel, seed, tags, positive, negative, nsfw,
        ...(chars.length ? { chars: chars.map(c => ({ prompt: c.prompt, uc: c.uc, center: c.center })) } : {}),
        at: new Date().toISOString(),
    };
    return { body, meta };
}


// ============================================================
// 📦 NovelAI 回的是 ZIP：自己拆（只要裡面那張 PNG）
// ============================================================

const isPng = (u8) => u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;

async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('這個瀏覽器拆不了 ZIP');
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzipPng(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    // 找中央目錄結尾（EOCD）
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
        if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 壞掉了');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    for (let n = 0; n < count; n++) {
        if (dv.getUint32(p, true) !== 0x02014b50) break;
        const method = dv.getUint16(p + 10, true);
        const csize = dv.getUint32(p + 20, true);
        const nameLen = dv.getUint16(p + 28, true);
        const extraLen = dv.getUint16(p + 30, true);
        const commentLen = dv.getUint16(p + 32, true);
        const local = dv.getUint32(p + 42, true);
        const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        if (!/\.png$/i.test(name)) continue;
        const lnameLen = dv.getUint16(local + 26, true);
        const lextraLen = dv.getUint16(local + 28, true);
        const start = local + 30 + lnameLen + lextraLen;
        const data = u8.subarray(start, start + csize);
        if (method === 0) return data;
        if (method === 8) return inflateRaw(data);
        throw new Error('ZIP 用了看不懂的壓縮');
    }
    throw new Error('ZIP 裡沒有圖');
}

function b64ToBytes(b64) {
    const bin = atob(String(b64).replace(/^data:[^,]+,/, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function toPng(buf) {
    const u8 = new Uint8Array(buf);
    if (!u8.length) throw new Error('NovelAI 回了空的');
    if (isPng(u8)) return u8;
    if (u8[0] === 0x50 && u8[1] === 0x4b) return unzipPng(u8);
    const text = new TextDecoder().decode(u8).trim();
    if (text.startsWith('{') || text.startsWith('[')) {
        let j = null;
        try { j = JSON.parse(text); } catch { /* */ }
        const img = j?.images?.[0] || j?.data?.[0]?.b64_json || j?.image;
        if (img) return b64ToBytes(img);
        throw new Error(j?.message || j?.error || '回了 JSON，但裡面沒有圖');
    }
    if (text.startsWith('<')) throw new Error('回了網頁，不是圖（網址對嗎？）');
    throw new Error('回的東西看不懂');
}


// ============================================================
// 🚚 送出去（官網直連／經大包子／第三方站）＋ 排隊
// ============================================================

function siteUrl(raw) {
    let url = String(raw || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (/generate-image(-stream)?$/.test(url)) return url;
    return url + '/ai/generate-image';
}

async function readError(res) {
    let text = '';
    try { text = await res.text(); } catch { /* */ }
    let j = null;
    try { j = JSON.parse(text); } catch { /* */ }
    return (j?.message || j?.error || text || '').slice(0, 200);
}

class HttpError extends Error {
    constructor(status, msg) { super(msg); this.status = status; }
}

async function send(conn, body, signal) {
    if (!conn) throw new Error('還沒設定 NovelAI 連線～到包子的「🎨 生圖」加一組');
    if (!conn.key) throw new Error('這組連線沒有 key');
    let url, headers;
    if (conn.mode === 'custom') {
        url = siteUrl(conn.url);
        headers = { Authorization: 'Bearer ' + conn.key, 'Content-Type': 'application/json' };
    } else if (conn.viaBot) {
        if (!bot.url || !bot.token) throw new Error('經大包子轉送要先登入包子');
        url = bot.url + '/club/nai/generate';
        headers = { Authorization: 'Bearer ' + bot.token, 'X-NAI-Key': conn.key, 'Content-Type': 'application/json' };
    } else {
        url = OFFICIAL_URL;
        headers = { Authorization: 'Bearer ' + conn.key, 'Content-Type': 'application/json' };
    }
    let res;
    try {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal, credentials: 'omit' });
    } catch (e) {
        if (signal?.aborted) throw new Error('等太久了，取消');
        throw new Error(conn.mode === 'custom' ? '連不上這個站' : conn.viaBot ? '連不上大包子' : '連不上 NovelAI（在大陸的話打開「經大包子轉送」）');
    }
    if (!res.ok) throw new HttpError(res.status, `${res.status}：${await readError(res) || '失敗'}`);
    return toPng(await res.arrayBuffer());
}

/** 測連線：官網／經大包子查訂閱（順便看 Anlas）；第三方站只能真的畫一張很小的。 */
export async function testConn(conn) {
    if (conn.mode === 'custom') return '第三方站沒辦法先測，畫一張看看就知道';
    const url = conn.viaBot ? bot.url + '/club/nai/subscription' : 'https://api.novelai.net/user/subscription';
    const headers = conn.viaBot
        ? { Authorization: 'Bearer ' + bot.token, 'X-NAI-Key': conn.key }
        : { Authorization: 'Bearer ' + conn.key };
    let res;
    try { res = await fetch(url, { headers, credentials: 'omit' }); } catch {
        throw new Error(conn.viaBot ? '連不上大包子' : '連不上 NovelAI（在大陸的話打開「經大包子轉送」）');
    }
    if (!res.ok) throw new Error(res.status === 401 ? 'key 不對' : `${res.status}：${await readError(res)}`);
    const j = await res.json();
    const tierName = ['免費', 'Tablet', 'Scroll', 'Opus'][j.tier] || '?';
    const anlas = j.anlas ?? ((j.trainingStepsLeft?.fixedTrainingStepsLeft || 0) + (j.trainingStepsLeft?.purchasedTrainingSteps || 0));
    return `✅ 通了・${tierName}・剩 ${anlas} Anlas`;
}

let queue = Promise.resolve();
let waiting = 0;
export const queueSize = () => waiting;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** 排隊畫一張：一次只送一張；429 等一下再試（最多三次）。回 PNG 的 bytes。 */
export function draw(body, onStatus = () => {}) {
    waiting++;
    const job = queue.then(async () => {
        const conn = activeConn();
        for (let attempt = 0; ; attempt++) {
            onStatus(attempt ? `NovelAI 很擠，第 ${attempt + 1} 次…` : '畫圖中…');
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
            try {
                return await send(conn, body, ctrl.signal);
            } catch (e) {
                if (e instanceof HttpError && e.status === 429 && attempt < 2) {
                    onStatus(`NovelAI 說太擠（429），${10 * (attempt + 1)} 秒後再試…`);
                    await sleep(10_000 * (attempt + 1));
                    continue;
                }
                throw e;
            } finally {
                clearTimeout(timer);
            }
        }
    });
    queue = job.catch(() => {}).then(() => sleep(1500));
    job.finally(() => { waiting--; }).catch(() => {});
    onStatus(waiting > 1 ? `排隊中（前面還有 ${waiting - 1} 張）…` : '準備畫…');
    return job;
}


// ============================================================
// ✍️ 副 API 寫 tag
// ============================================================

export const BUILTIN_PROMPT = {
    id: 'builtin',
    name: '包子預設',
    entries: [
        { name: '身分', role: 'system', enabled: true, content: `你是替角色扮演小說畫插圖的助手，很熟 NovelAI 和 Danbooru 標籤。
你的工作：讀下面這段正文，挑出最有畫面感的 {{張數}} 個瞬間，每個瞬間寫一組 NovelAI 看得懂的英文 Danbooru 標籤。` },
        { name: '人物資料', role: 'system', enabled: true, content: `【角色設定】
{{角色設定}}

【她（{{user}}）】
{{用戶人設}}

【固定外貌】
{{固定外貌}}` },
        { name: '規則', role: 'system', enabled: true, content: `規則：
1. 一張圖是一個定格的瞬間，不要把連續的動作塞在同一張。
2. 先寫人數（1boy、1girl、1boy 1girl…），再寫每個人的外貌、服裝、表情、動作，最後寫構圖、視角、背景、光線、氣氛。
3. 角色在「固定外貌」裡有的，外貌只寫 $名字$（例如 $白起$），程式會換成他的固定外貌；你只補這一刻的服裝、表情、動作。
4. 照正文如實描寫，不要自己加正文沒有的東西。
5. 只寫英文標籤、用逗號隔開，最多 60 個；可以用 {tag} 加重、[tag] 減輕。
6. 不要寫畫師名字、品質詞（masterpiece、best quality…），那些另外加。
7. 每張標分級：畫面露骨、跟性有關就是 nsfw，其他都是 sfw。
8. 每張寫它畫的是正文第幾段（每段前面的 [數字]），圖會放在那段後面。` },
        { name: '輸出格式', role: 'system', enabled: true, content: `只照這個格式回，不要其他文字：
<pic>
<after>畫的是第幾段（只寫數字）</after>
<rating>sfw 或 nsfw</rating>
<tags>英文標籤, 用逗號隔開</tags>
</pic>
要畫幾張就寫幾個 <pic>。` },
        { name: '正文', role: 'user', enabled: true, content: `正文（每段前面的 [數字] 是段號）：
{{正文}}` },
    ],
};

export function allPrompts() {
    return [BUILTIN_PROMPT, ...store().prompts];
}
export function currentPrompt() {
    const id = prefs().promptId;
    return allPrompts().find(p => p.id === id) || BUILTIN_PROMPT;
}

function tagApiProfile() {
    const id = prefs().tagApi;
    return loadProfiles().find(p => p.id === id) || activeProfile();
}

/** 現在這個聊天（記寫 tag 的紀錄用）。 */
export function chatKey() {
    const c = stx();
    try { return String(c?.getCurrentChatId?.() ?? c?.chatId ?? ''); } catch { return ''; }
}

export function cardKey() {
    const ctx = stx();
    const ch = ctx?.characters?.[ctx?.characterId];
    return ch?.avatar || ctx?.name2 || '';
}

/** 這張卡的固定外貌＋全部卡通用的（名字相同時這張卡的優先）。 */
export function looksFor(key = cardKey()) {
    const s = store();
    const card = s.looks.cards[key] || [];
    const names = new Set(card.map(l => l.name));
    return [...card, ...s.looks.global.filter(l => !names.has(l.name))].filter(l => l.name?.trim());
}

/** 第一次打開這張卡：先把他和她列上去（外貌留空給她填）。 */
export function seedLooks() {
    const ctx = stx();
    const key = cardKey();
    if (!key) return;
    const s = store();
    if (s.looks.cards[key]) return;
    s.looks.cards[key] = [{ name: ctx?.name2 || '', tags: '' }].filter(l => l.name);
    if (ctx?.name1 && !s.looks.global.some(l => l.name === ctx.name1)) s.looks.global.push({ name: ctx.name1, tags: '' });
    saveStore();
}

/** $名字$ → 外貌；NSFW 的圖再接上「🔞 補充」。 */
export function expandLooks(tags, key = cardKey(), nsfw = false) {
    return expandCalls(tags, key, nsfw).tags;
}

// ---------- 🎭 智繪姬的角色／服裝調用（11/25 一帆的預設） ----------
// 它的預設叫模型寫 $角色名-from front-sfw-upperBody-nsfw-lowerBody$、${"name":"角色名","angle":"from front","upperBody":"sfw","lowerBody":"hidden"}$、
// 服裝 $服裝名-upperBody-lowerBody$／${"name":"服裝名","upperBody":"visible"}$。照智繪姬「角色管理」裡的角色、服裝換成 tag：
// 上半身看得到才放五官＋上半身那欄，下半身照 sfw／nsfw 放那欄；角度有 from behind 就用背面那幾欄（沒填的用正面；服裝跟著前一個角色的角度）。

const normName = (s) => String(s || '').replace(/[\s\u3000_]+/g, '').toLowerCase();

/** 照名字找智繪姬的角色（kind=char）或服裝（kind=outfit）：一樣的優先，再來是互相包含的。 */
function c8Find(kind, name) {
    const c = chatu8();
    const pool = kind === 'char' ? c?.characterPresets : c?.outfitPresets;
    const want = normName(name);
    if (!pool || !want) return null;
    let best = null;
    let score = 0;
    for (const [id, p] of Object.entries(pool)) {
        if (!p || typeof p !== 'object') continue;
        const names = [id, ...String(p.nameCN || '').split('|'), ...String(p.nameEN || '').split('|')].map(normName).filter(Boolean);
        for (const n of names) {
            const sc = n === want ? 2 : (want.includes(n) || n.includes(want)) ? 1 : 0;
            if (sc > score) { score = sc; best = p; }
        }
    }
    return best;
}

function c8CharTags(p, angle, upper, lower) {
    const back = /from\s*behind/i.test(angle || '');
    // 背面那欄沒填就用正面的（智繪姬會直接空著，衣服就不見了）
    const f = (k) => (back && p[k + 'Back']) || p[k] || '';
    const parts = [p.characterTraits];
    if (upper && upper !== 'hidden') {
        parts.push(f('facialFeatures'));
        if (upper === 'sfw') parts.push(f('upperBodySFW'));
        if (upper === 'nsfw') parts.push(f('upperBodyNSFW'));
    }
    if (lower === 'sfw') parts.push(f('fullBodySFW'));
    if (lower === 'nsfw') parts.push(f('fullBodyNSFW'));
    return join(...parts);
}

function c8OutfitTags(o, behind, upper, lower) {
    const f = (k) => (behind && o[k + 'Back']) || o[k] || '';
    return join(upper ? f('upperBody') : '', lower ? f('fullBody') : '');
}

/** 包子自己的固定外貌（名字 → sfw 外貌、🔞 補充）。 */
function ownLooks(key) {
    const map = new Map();
    for (const l of looksFor(key)) {
        const c8 = linkedLooks(l);
        const sfw = join(c8?.sfw, l.tags);
        const more = join(c8?.nsfw, l.nsfw);
        if (sfw || more) map.set(l.name.trim(), { sfw, nsfw: more });
    }
    return map;
}

/**
 * 換掉 tag 裡所有 $…$：包子的 $名字$、智繪姬的角色／服裝調用。
 * @returns {tags, uc}：uc＝用到的智繪姬角色自己的負面
 */
export function expandCalls(tags, key = cardKey(), nsfw = false) {
    const own = ownLooks(key);
    const uc = [];
    let behind = false;
    const charCall = (name, angle, upper, lower) => {
        behind = /from\s*behind/i.test(angle || '');
        const p = c8Find('char', name);
        if (p) {
            if (p.negative) uc.push(p.negative);
            return c8CharTags(p, angle, upper, lower);
        }
        const l = own.get(String(name).trim());
        if (l) return join(l.sfw, upper === 'nsfw' || lower === 'nsfw' ? l.nsfw : '');
        return null;
    };
    const outfitCall = (name, upper, lower) => {
        const o = c8Find('outfit', name);
        return o ? c8OutfitTags(o, behind, upper, lower) : null;
    };
    const out = String(tags || '').replace(/\$([^$\n]{1,300})\$/g, (all, raw) => {
        const body = raw.trim();
        if (body.startsWith('{') && body.endsWith('}')) {
            let j = null;
            try { j = JSON.parse(body); } catch { /* 不是 JSON */ }
            if (j?.name) {
                const st = (v, dflt) => String(v || dflt).toLowerCase();
                const got = 'angle' in j
                    ? charCall(j.name, j.angle, st(j.upperBody, 'hidden'), st(j.lowerBody, 'hidden'))
                    : outfitCall(j.name, st(j.upperBody, 'hidden') === 'visible', st(j.lowerBody, 'hidden') === 'visible');
                return got ?? String(j.name);
            }
        }
        let m = body.match(/^(.+?)-(sfw|nsfw)-upperbody(?:-(sfw|nsfw)-(?:lowerbody|fullbody))?$/i)
            || body.match(/^(.+?)()-(sfw|nsfw)-lowerbody$/i);
        if (m) {
            const [, nameAngle, up, low] = m;
            const cut = nameAngle.indexOf('-');
            const name = cut > 0 ? nameAngle.slice(0, cut) : nameAngle;
            const angle = cut > 0 ? nameAngle.slice(cut + 1) : '';
            const got = charCall(name, angle, (up || '').toLowerCase() || null, (low || '').toLowerCase() || null)
                ?? (cut > 0 ? charCall(nameAngle, '', (up || '').toLowerCase() || null, (low || '').toLowerCase() || null) : null);
            return got ?? name.trim();
        }
        m = body.match(/^(.+?)-upperbody(-lowerbody)?$/i);
        if (m) return outfitCall(m[1], true, !!m[2]) ?? m[1].trim();
        m = body.match(/^(.+?)-lowerbody$/i);
        if (m) return outfitCall(m[1], false, true) ?? m[1].trim();
        // 包子的 $名字$
        const l = own.get(body);
        if (l) return join(l.sfw, nsfw ? l.nsfw : '');
        const p = c8Find('char', body);
        if (p) { if (p.negative) uc.push(p.negative); return c8CharTags(p, '', 'sfw', nsfw ? 'nsfw' : 'sfw'); }
        return body;
    });
    return { tags: out, uc: join(...uc) };
}

// ---------- 👥 NovelAI V4 的分角色：Scene Composition＋Character N Prompt／UC ----------
// 智繪姬的寫法：Scene Composition: …; Character 1 Prompt: … |centers:C3; Character 1 UC: …;
// 座標 A～E（左到右）、1～5（上到下）換成 0.1～0.9。

const END = '(?:;|(?=Character\\s+\\d+\\s+(?:Prompt|UC)\\s*:)|$)';
const tidy = (s) => String(s || '').replace(/\s*\n\s*/g, ', ').replace(/^[\s,;]+|[\s,;]+$/g, '').replace(/\s*,\s*(,\s*)+/g, ', ').trim();

function toCenter(s) {
    const t0 = String(s || '').trim();
    const g = t0.match(/([a-e])\s*([1-5])/i);
    if (g) return { x: [0.1, 0.3, 0.5, 0.7, 0.9]['abcde'.indexOf(g[1].toLowerCase())], y: [0.1, 0.3, 0.5, 0.7, 0.9][Number(g[2]) - 1], set: true };
    const n = t0.match(/([-+]?[0-9.]+)\s*[,，\s]\s*([-+]?[0-9.]+)/);
    if (n) {
        const c = (v) => Number(Math.min(1, Math.max(0, parseFloat(v))).toFixed(3));
        return { x: c(n[1]), y: c(n[2]), set: true };
    }
    return { x: 0.5, y: 0.5, set: false };
}

/** 分角色的 tag 拆開：{base, chars:[{prompt, uc, center}]}；不是這種寫法回 null。 */
export function splitScene(tags) {
    const s = String(tags || '');
    const first = s.search(/Character\s+\d+\s+Prompt\s*:/i);
    if (first < 0) return null;
    // 沒寫 Scene Composition 的話，第一個 Character 前面的就是共用的
    const base = s.match(new RegExp('Scene\\s*Composition\\s*:([\\s\\S]*?)' + END, 'i'))?.[1] ?? s.slice(0, first);
    const chars = new Map();
    for (const m of s.matchAll(new RegExp('Character\\s+(\\d+)\\s+Prompt\\s*:([\\s\\S]*?)(?:\\|\\s*centers?\\s*:\\s*([^;|]*?))?\\s*' + END, 'gi'))) {
        const prompt = tidy(m[2]);
        if (prompt) chars.set(Number(m[1]), { prompt, uc: '', center: toCenter(m[3]) });
    }
    for (const m of s.matchAll(new RegExp('Character\\s+(\\d+)\\s+UC\\s*:([\\s\\S]*?)' + END, 'gi'))) {
        const c = chars.get(Number(m[1]));
        if (c) c.uc = tidy(m[2]);
    }
    if (!chars.size) return null;
    return { base: tidy(base), chars: [...chars.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c) };
}

/** 畫之前：拆分角色、換掉 $…$。回 {base, chars, uc}。 */
export function prepTags(raw, key = cardKey(), nsfw = false) {
    const scene = splitScene(raw);
    if (!scene) {
        const r = expandCalls(raw, key, nsfw);
        return { base: r.tags, chars: [], uc: r.uc };
    }
    const base = expandCalls(scene.base, key, nsfw);
    const chars = scene.chars.map(c => {
        const r = expandCalls(c.prompt, key, nsfw);
        return { ...c, prompt: r.tags, uc: join(c.uc, r.uc) };
    });
    return { base: base.tags, chars, uc: base.uc };
}

function looksText(key = cardKey()) {
    const list = looksFor(key);
    if (!list.length) return '（沒有）';
    return list.map(l => `$${l.name}$${l.tags?.trim() || linkedLooks(l)?.sfw ? '' : '（還沒填外貌，照正文寫）'}`).join('、')
        + '\n畫到這些角色時，外貌寫 $名字$ 就好。';
}

function cardFields() {
    try { return stx()?.getCharacterCardFields?.() || null; } catch { return null; }
}

function characterText() {
    const f = cardFields();
    if (f) {
        const text = [f.description, f.personality, f.scenario].filter(x => x?.trim()).join('\n');
        if (text) return text.slice(0, 6000);
    }
    const ctx = stx();
    const ch = ctx?.characters?.[ctx?.characterId];
    if (!ch) return '（沒有）';
    const d = ch.data || ch;
    return [d.description, d.personality, d.scenario].filter(x => x?.trim()).join('\n').slice(0, 6000) || '（沒有）';
}

function personaText() {
    const f = cardFields();
    if (f?.persona?.trim()) return f.persona.slice(0, 2000);
    const ctx = stx();
    try {
        const pu = globalThis.power_user || ctx?.powerUserSettings;
        const text = pu?.persona_description;
        if (text?.trim()) return text.slice(0, 2000);
    } catch { /* */ }
    return '（沒有）';
}

function stripForTags(text) {
    return String(text || '')
        .replace(THINK, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// 一帆用簡體寫預設（11/24：{{角色设定}} 包子不認、原樣送出去了），所以每個變數簡繁都收
// 上下文、世界書觸發、用戶需求、三個啟用列表：照智繪姬的（11/25 一帆的預設用到）
const VAR_ALIASES = {
    正文: ['正文'],
    角色設定: ['角色設定', '角色设定'],
    用戶人設: ['用戶人設', '用户人设', '用户人設', '用戶人设'],
    固定外貌: ['固定外貌'],
    張數: ['張數', '张数'],
    上下文: ['上下文'],
    世界書觸發: ['世界書觸發', '世界书触发', '世界書', '世界书'],
    用戶需求: ['用戶需求', '用户需求'],
    角色啟用列表: ['角色啟用列表', '角色启用列表'],
    通用角色啟用列表: ['通用角色啟用列表', '通用角色启用列表'],
    通用服裝啟用列表: ['通用服裝啟用列表', '通用服装启用列表'],
};

const THINK = /<(think|thinking|reasoning|imgthink|tag_think|imagesthink)>[\s\S]*?<\/\1>/gi;

/** 這條提示詞有沒有用到某個變數（簡繁都算）。 */
function usesVar(text, k) {
    return (VAR_ALIASES[k] || [k]).some(n => String(text).includes(`{{${n}}}`));
}

/** 寫 tag 的提示詞有沒有 {{用户需求}}：有的話按「🎨 生圖」先問她想畫什麼。 */
export function wantsDemand() {
    return currentPrompt().entries.some(e => e.enabled && usesVar(e.content, '用戶需求'));
}

// ---------- 🔑 觸發詞（智繪姬的「有觸發詞才送」）：keys 任一個出現在正文才送；andKeys 有填的話也要有一個 ----------
function splitWords(s) {
    return String(s || '').split(/[,，]/).map(w => w.trim()).filter(Boolean);
}
export function entryOn(e, text) {
    const keys = splitWords(e.keys);
    if (!keys.length) return true;
    if (!keys.some(w => text.includes(w))) return false;
    const and = splitWords(e.andKeys);
    return !and.length || and.some(w => text.includes(w));
}

// ---------- 📜 上下文：畫的那一則前面的 AI 訊息（設定幾則，預設 1） ----------
function contextText(mesId) {
    const chat = stx()?.chat;
    const n = Math.max(0, Math.min(10, Number(prefs().ctxCount ?? 1)));
    if (!chat || !Number.isFinite(mesId) || !n) return '';
    const got = [];
    for (let i = mesId - 1; i >= 0 && got.length < n; i--) {
        if (isHusbandMes(chat[i])) got.unshift(stripForTags(chat[i].mes).slice(0, 6000));
    }
    return got.join('\n\n');
}

// ---------- 📖 世界書觸發：這張卡的世界書、聊天的世界書、全域開著的，關鍵字出現在正文的條目 ----------
async function worldText(trigger) {
    const ctx = stx();
    const names = new Set();
    const ch = ctx?.characters?.[ctx?.characterId];
    if (ch?.data?.extensions?.world) names.add(ch.data.extensions.world);
    if (ctx?.chatMetadata?.world_info) names.add(ctx.chatMetadata.world_info);
    try { document.querySelectorAll('#world_info option:checked').forEach(o => { if (o.textContent?.trim()) names.add(o.textContent.trim()); }); } catch { /* */ }
    if (!names.size || typeof ctx?.loadWorldInfo !== 'function') return '';
    const low = trigger.toLowerCase();
    const hit = (k) => {
        const w = String(k || '').trim();
        if (!w) return false;
        const re = w.match(/^\/(.+)\/([a-z]*)$/);
        if (re) { try { return new RegExp(re[1], re[2]).test(trigger); } catch { return false; } }
        return low.includes(w.toLowerCase());
    };
    const out = [];
    for (const name of names) {
        let data = null;
        try { data = await ctx.loadWorldInfo(name); } catch { /* 讀不到就跳過 */ }
        for (const e of Object.values(data?.entries || {})) {
            if (!e || e.disable || !String(e.content || '').trim()) continue;
            if (!e.constant) {
                if (!(e.key || []).some(hit)) continue;
                const sec = (e.keysecondary || []).filter(k => String(k).trim());
                if (e.selective && sec.length) {
                    const n = sec.filter(hit).length;
                    const logic = Number(e.selectiveLogic) || 0;   // 0 有任一、1 不是全部、2 一個都沒有、3 全部都有
                    const ok = logic === 0 ? n > 0 : logic === 1 ? n < sec.length : logic === 2 ? n === 0 : n === sec.length;
                    if (!ok) continue;
                }
            }
            out.push({ order: Number(e.order) || 0, content: e.content.trim() });
        }
    }
    return out.sort((a, b) => a.order - b.order).map(x => x.content).join('\n\n').slice(0, 12000);
}

// ---------- 🎭 智繪姬的三個啟用列表（照她在智繪姬選的「注入模板」，沒有就用智繪姬預設的那種排法） ----------
const C8_TPL = {
    char: ['中文名称：{nameCN}', '英文名称：{nameEN}', '角色特征：{traits}', '五官外貌（正面）：{facial}', '五官外貌（背面）：{facialBack}',
        '上半身SFW（正面）：{upperSFW}', '上半身SFW（背面）：{upperSFWBack}', '下半身SFW（正面）：{lowerSFW}', '下半身SFW（背面）：{lowerSFWBack}',
        '上半身NSFW（正面）：{upperNSFW}', '上半身NSFW（背面）：{upperNSFWBack}', '下半身NSFW（正面）：{lowerNSFW}', '下半身NSFW（背面）：{lowerNSFWBack}',
        '服装列表：{outfits}'].join('\n'),
    inner: ['  中文名称：{nameCN}', '  英文名称：{nameEN}', '  上半身（正面）：{upperBody}', '  上半身（背面）：{upperBodyBack}',
        '  下半身（正面）：{lowerBody}', '  下半身（背面）：{lowerBodyBack}'].join('\n'),
    common: '{nameCN} {nameEN}',
    outfit: ['中文名称：{nameCN}', '英文名称：{nameEN}', '上半身（正面）：{upperBody}', '上半身（背面）：{upperBodyBack}',
        '下半身（正面）：{lowerBody}', '下半身（背面）：{lowerBodyBack}'].join('\n'),
};

/** 一行裡的 {欄位} 都是空的就整行不要；全部都空就整段不要。 */
function applyTpl(tpl, data) {
    const lines = [];
    let withVars = 0;
    let kept = 0;
    for (const line of String(tpl || '').split(/\r?\n/)) {
        const keys = [...line.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]);
        if (!keys.length) { lines.push(line); continue; }
        withVars++;
        if (!keys.some(k => String(data[k] ?? '').trim())) continue;
        lines.push(line.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => String(data[k] ?? '')));
        kept++;
    }
    return withVars && !kept ? '' : lines.join('\n');
}

function c8Templates() {
    const c = chatu8();
    const it = c?.injectionTemplates;
    const p = it?.presets?.[it?.currentPresetId || '默认方案'] || {};
    const pick = (k, d) => (typeof p[k] === 'string' ? p[k] : d);
    return {
        char: pick('characterListTemplate', C8_TPL.char), inner: pick('innerOutfitTemplate', C8_TPL.inner),
        common: pick('commonCharacterListTemplate', C8_TPL.common), outfit: pick('enableOutfitListTemplate', C8_TPL.outfit),
    };
}

const firstName = (s) => String(s || '').split('|')[0].trim();

function c8OutfitData(o) {
    return { nameCN: o.nameCN || '', nameEN: firstName(o.nameEN), upperBody: o.upperBody || '', upperBodyBack: o.upperBodyBack || '',
        fullBody: o.fullBody || '', fullBodyBack: o.fullBodyBack || '', lowerBody: o.fullBody || '', lowerBodyBack: o.fullBodyBack || '' };
}

function c8CharData(p, outfits = '') {
    return { nameCN: p.nameCN || '', nameEN: firstName(p.nameEN), traits: p.characterTraits || '',
        facial: p.facialFeatures || '', facialBack: p.facialFeaturesBack || '',
        upperSFW: p.upperBodySFW || '', upperSFWBack: p.upperBodySFWBack || '',
        fullSFW: p.fullBodySFW || '', fullSFWBack: p.fullBodySFWBack || '', lowerSFW: p.fullBodySFW || '', lowerSFWBack: p.fullBodySFWBack || '',
        upperNSFW: p.upperBodyNSFW || '', upperNSFWBack: p.upperBodyNSFWBack || '',
        fullNSFW: p.fullBodyNSFW || '', fullNSFWBack: p.fullBodyNSFWBack || '', lowerNSFW: p.fullBodyNSFW || '', lowerNSFWBack: p.fullBodyNSFWBack || '',
        negative: p.negative || '', outfits };
}

const enableId = (x) => (typeof x === 'string' ? x : x?.characterPresetName || x?.name || x?.presetName || '');

/** 角色的名字（中英文、| 分開的別名）有出現在這段文字裡。 */
function c8Named(p, text) {
    const low = normName(text);
    return [...String(p.nameCN || '').split('|'), ...String(p.nameEN || '').split('|')].map(normName).some(n => n && low.includes(n));
}

/** {{角色启用列表}}：智繪姬啟用的角色裡，名字出現在正文（＋上下文、需求）的那幾位。 */
export function c8CharList(trigger) {
    const c = chatu8();
    const list = c?.characterEnablePresets?.[c?.characterEnablePresetId]?.characters;
    if (!Array.isArray(list) || !list.length) return '（暂无启用的角色）';
    const tpl = c8Templates();
    const out = [];
    for (const x of list) {
        const p = c.characterPresets?.[enableId(x)];
        if (!p || !c8Named(p, trigger)) continue;
        const outfits = (p.outfits || []).map(id => c.outfitPresets?.[id]).filter(Boolean)
            .map(o => applyTpl(tpl.inner, c8OutfitData(o))).filter(s => s.trim());
        const text = applyTpl(tpl.char, c8CharData(p, outfits.length ? '\n\n' + outfits.join('\n\n') : ''));
        if (text.trim()) out.push(text);
    }
    return out.length ? out.join('\n\n') : '（暂无被触发的角色）';
}

/** {{通用角色启用列表}} */
export function c8CommonList() {
    const c = chatu8();
    const list = c?.characterCommonPresets?.[c?.characterCommonPresetId]?.characters;
    if (!Array.isArray(list) || !list.length) return '暂未配置通用角色';
    const tpl = c8Templates();
    return list.map(x => c.characterPresets?.[enableId(x)]).filter(Boolean)
        .map(p => applyTpl(tpl.common, c8CharData(p)).trim()).filter(Boolean).join('\n');
}

/** {{通用服装启用列表}} */
export function c8OutfitList() {
    const c = chatu8();
    const list = c?.outfitEnablePresets?.[c?.outfitEnablePresetId]?.outfits;
    if (!Array.isArray(list) || !list.length) return '暂未配置通用服装';
    const tpl = c8Templates();
    return list.map(id => c.outfitPresets?.[id]).filter(Boolean)
        .map(o => applyTpl(tpl.outfit, c8OutfitData(o))).filter(s => s.trim()).join('\n\n');
}

function fill(content, vars) {
    let out = String(content || '');
    for (const [k, v] of Object.entries(vars)) {
        for (const name of VAR_ALIASES[k] || [k]) out = out.split(`{{${name}}}`).join(v);
    }
    const ctx = stx();
    try { if (ctx?.substituteParams) out = ctx.substituteParams(out); } catch { /* */ }
    return out;
}

export function parsePics(text) {
    const raw = String(text || '').replace(THINK, '');
    const out = [];
    for (const m of raw.matchAll(/<pic>([\s\S]*?)(?:<\/pic>|(?=<pic>)|$)/gi)) {
        const tags = m[1].match(/<tags>([\s\S]*?)(?:<\/tags>|$)/i)?.[1];
        if (!tags?.trim()) continue;
        const rating = (m[1].match(/<rating>([\s\S]*?)<\/rating>/i)?.[1] || '').trim().toLowerCase();
        const clean = cleanTags(tags);
        out.push({ scene: (m[1].match(/<scene>([\s\S]*?)<\/scene>/i)?.[1] || '').trim(), tags: clean,
            nsfw: rating ? rating.includes('nsfw') : hasNsfw(clean),
            after: Number(m[1].match(/<after>\D*(\d+)/i)?.[1]) || 0 });
    }
    if (!out.length) {
        // 智繪姬的：<image> regex:原文那一句 … image###tag### </image>（11/25 一帆的預設）；原文那句拿來找段落
        for (const m of raw.matchAll(/<image>([\s\S]*?)(?:<\/image>|(?=<image>)|$)/gi)) {
            const tags = m[1].match(/image###([\s\S]*?)###/)?.[1];
            if (!tags?.trim()) continue;
            const quote = (m[1].match(/^\s*regex\s*[:：]\s*(.+)$/im)?.[1] || '').trim();
            out.push({ scene: '', tags: cleanTags(tags), nsfw: hasNsfw(tags), quote });
        }
    }
    if (!out.length) {
        // 也認智繪姬／喵喵那種 image###tag### 的格式（匯入別人的提示詞時）
        for (const m of raw.matchAll(/image###([\s\S]*?)###/g)) {
            if (m[1].trim()) out.push({ scene: '', tags: cleanTags(m[1]), nsfw: hasNsfw(m[1]) });
        }
    }
    return out;
}

function cleanTags(s) {
    const line = (x) => String(x).replace(/，/g, ',').replace(/\s*,\s*(,\s*)*/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '');
    // 分角色的（Scene Composition／Character N Prompt）一段一行，比較好看好改
    if (/Character\s+\d+\s+Prompt\s*:/i.test(s)) return String(s).split(/\n+/).map(line).filter(Boolean).join('\n');
    return line(String(s).replace(/\n+/g, ', '));
}

/** 智繪姬的 regex:原文 → 第幾段（找不到是 0）。 */
function paraOfQuote(paras, quote) {
    const q = normText(String(quote || '').replace(/^\[\d+\]\s*/, ''));
    if (!q) return 0;
    const norm = paras.map(normText);
    let i = norm.findIndex(p => p.includes(q));
    if (i < 0 && q.length > 8) i = norm.findIndex(p => p.includes(q.slice(0, 8)) || p.includes(q.slice(-8)));
    return i + 1;
}

/** 「2」或「1～3」 */
export function countText() {
    const pr = prefs();
    let a = Math.max(1, Math.min(8, Number(pr.countMin) || 1));
    let b = Math.max(1, Math.min(8, Number(pr.countMax) || a));
    if (b < a) [a, b] = [b, a];
    return a === b ? String(a) : `${a}～${b}`;
}

/**
 * 讀這則正文，請副 API 寫 tag。回 [{scene, tags}]。
 * @param opt.mesId 這則是第幾樓（{{上下文}} 從它前面拿）
 * @param opt.demand 她這次想畫什麼（{{用户需求}}）
 */
export async function writeTags(mesText, opt = {}) {
    const profile = tagApiProfile();
    if (!profile) throw new Error('還沒有寫 tag 的 API～到「設定 → ✨ 排版模型」加一組，再到「🎨 生圖」選它');
    const paras = paragraphs(mesText);
    const prompt = currentPrompt();
    const vars = {
        正文: numbered(paras).slice(0, 9000),
        角色設定: characterText(),
        用戶人設: personaText(),
        固定外貌: looksText(),
        張數: countText(),
        上下文: contextText(opt.mesId),
        用戶需求: String(opt.demand || '').trim(),
    };
    // 觸發詞、啟用的角色、世界書都看「正文＋上下文＋她的需求」
    const trigger = [paras.join('\n'), vars.上下文, vars.用戶需求].filter(Boolean).join('\n');
    const live = prompt.entries.filter(e => e.enabled && String(e.content || '').trim());
    const entries = live.filter(e => entryOn(e, trigger));
    const skipped = live.filter(e => !entries.includes(e)).map(e => e.name || '（沒名字）');
    const all = entries.map(e => e.content).join('\n');
    if (usesVar(all, '世界書觸發')) vars.世界書觸發 = await worldText(trigger);
    if (usesVar(all, '角色啟用列表')) vars.角色啟用列表 = c8CharList(trigger);
    if (usesVar(all, '通用角色啟用列表')) vars.通用角色啟用列表 = c8CommonList();
    if (usesVar(all, '通用服裝啟用列表')) vars.通用服裝啟用列表 = c8OutfitList();
    const named = entries
        .map(e => ({ name: e.name || '', role: ['system', 'user', 'assistant'].includes(e.role) ? e.role : 'system', content: fill(e.content, vars).trim() }))
        .filter(m => m.content);
    // 沒有 user 的條目、而且整份都沒用到 {{正文}} 才補一段正文（一帆 #162：她的預設正文已經在條目裡，補了等於送兩次）
    if (!named.some(m => m.role === 'user') && !usesVar(all, '正文')) named.push({ name: '（正文）', role: 'user', content: vars.正文 });
    const msgs = named.map(({ role, content }) => ({ role, content }));
    // 📜 記下這次送了什麼、回了什麼（一帆 #162）
    const log = { chat: chatKey(), mesId: opt.mesId, prompt: prompt.name, api: `${profile.name || ''}・${profile.model || ''}`,
        demand: vars.用戶需求, sent: named, skipped };
    let reply = '';
    try {
        // 包子預設的回得短；匯入的（像一帆那份）每張圖前面還有一大段思考，給多一點
        reply = await callModel(profile, msgs, { maxTokens: prompt.id === 'builtin' ? 2000 : 8192, temperature: 0.8 });
    } catch (e) {
        addLog({ ...log, error: e.message }).catch(() => {});
        throw e;
    }
    const pics = parsePics(reply);
    addLog({ ...log, reply, count: pics.length, ...(pics.length ? {} : { error: '模型沒照格式回 tag' }) }).catch(() => {});
    if (!pics.length) throw new Error('模型沒照格式回 tag：' + reply.slice(0, 80));
    for (const pic of pics) {
        if (!pic.after && pic.quote) pic.after = paraOfQuote(paras, pic.quote);
        if (pic.after >= 1 && pic.after <= paras.length) pic.anchor = anchorOf(paras[pic.after - 1]);
    }
    return pics;
}

// ---------- 📍 段落：圖放在哪一段後面 ----------
// 寫 tag 時正文一行一段（空行不算）編號給副 API；它回「第幾段」，包子記下那段開頭十幾個字當記號。
// 畫面上找段落時先找記號（她改過正文、段落挪了也找得到），找不到才看段號，再不行放最底下。

export function paragraphs(text) {
    return stripForTags(text).split('\n').map(l => l.trim()).filter(Boolean);
}

function numbered(paras) {
    return paras.map((l, i) => `[${i + 1}] ${l}`).join('\n');
}

const normText = (x) => String(x || '').replace(/[\s*_~`>#"'“”‘’「」『』（）()\[\]【】《》<>,.，。、!！?？:：;；…—\-]/g, '');
export const anchorOf = (line) => normText(line).slice(0, 14);


// ============================================================
// 💾 存圖（酒館的圖片資料夾）
// ============================================================

function bytesToB64(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i += 32768) bin += String.fromCharCode(...u8.subarray(i, i + 32768));
    return btoa(bin);
}

async function saveLocal(png, charName) {
    const ctx = stx();
    const headers = ctx?.getRequestHeaders?.() || { 'Content-Type': 'application/json' };
    const filename = `baozi_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    try {
        const res = await fetch('/api/images/upload', {
            method: 'POST', headers,
            body: JSON.stringify({ image: bytesToB64(png), format: 'png', ch_name: charName || 'baozi', filename }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const j = await res.json();
        if (j?.path) return { src: j.path, saved: true };
    } catch (e) {
        console.warn('[包子同好會] 圖存不進酒館：', e);
    }
    // 存不進酒館：這次先用記憶體裡的，重新整理就沒了（提醒她存相簿）
    return { src: URL.createObjectURL(new Blob([png], { type: 'image/png' })), saved: false };
}


// ============================================================
// 💬 訊息底下的生圖區
// ============================================================
// 存在 chat[i].extra.baozi_pics = { [swipe_id]: [{id, scene, tags, img, meta, saved}] }，
// 也鏡一份到 swipe_info[swipe_id].extra（酒館換 swipe 時會拿那份蓋回 extra）

function swipeKey(mes) { return String(mes?.swipe_id ?? 0); }

export function itemsOf(mes) {
    const k = swipeKey(mes);
    const fromSwipe = mes?.swipe_info?.[mes.swipe_id]?.extra?.baozi_pics?.[k];
    return fromSwipe || mes?.extra?.baozi_pics?.[k] || [];
}

function setItems(mes, items) {
    const k = swipeKey(mes);
    mes.extra ??= {};
    mes.extra.baozi_pics ??= {};
    mes.extra.baozi_pics[k] = items;
    const sw = mes.swipe_info?.[mes.swipe_id];
    if (sw) {
        sw.extra ??= {};
        sw.extra.baozi_pics ??= {};
        sw.extra.baozi_pics[k] = items;
    }
}

function saveChat() {
    const ctx = stx();
    try { (ctx?.saveChatDebounced || ctx?.saveChat)?.(); } catch { /* */ }
}

const busy = new Map();     // 訊息 id → 寫 tag 中
const asking = new Map();   // 訊息 id → 「想畫什麼」框裡打的字（提示詞有 {{用户需求}} 時先問）
const status = new Map();   // 項目 id → 狀態字

function isHusbandMes(mes) {
    return mes && !mes.is_user && !mes.is_system && mes.mes !== undefined;
}

function lastHusbandId(chat) {
    for (let i = chat.length - 1; i >= 0; i--) if (isHusbandMes(chat[i])) return i;
    return -1;
}

// 打開的東西只記在記憶體：圖片每次都預設摺起來（米米：怕 🔞 的圖被人看到）
const openImg = new Set();
const openTag = new Set();
const seedMode = new Set();

function statusHtml(st) {
    return `<div class="bzp-status">${st.startsWith('❌') ? '' : painterHtml(1) + ' '}${esc(st)}</div>`;
}

/** 一張圖：摺起來的一條；打開才看到圖和按鈕。 */
function itemHtml(it, i) {
    const st = status.get(it.id) || '';
    const label = `第 ${i + 1} 張`;
    const working = st && !st.startsWith('❌');
    let head;
    if (working) head = `<div class="bzp-pill bzp-busy">${painterHtml(1)} ${label}<span class="bzp-pill-st">・${esc(st)}</span></div>`;
    else if (!it.img) head = `<button class="bzp-pill bzp-todo" data-p="draw">🎨 ${label}${it.cleared ? '<span class="bzp-pill-st">・圖清掉了，可以重畫</span>' : ''}</button>`;
    else head = `<button class="bzp-pill" data-p="fold">🖼️ ${label} <span class="bzp-caret">${openImg.has(it.id) ? '▾' : '▸'}</span></button>`;
    // 畫好的圖摺起來時 tag 也藏起來（tag 裡可能有 🔞 的字）
    const tagOpen = openTag.has(it.id) && (!it.img || openImg.has(it.id));
    const tagBtn = !it.img ? `<button class="bzp-pill-mini ${tagOpen ? 'on' : ''}" data-p="tagview" title="看／改 tag">🏷️</button>` : '';
    const body = it.img && openImg.has(it.id) ? `
        <img class="bzp-img" src="${esc(it.img)}" data-p="view" alt="">
        <div class="bzp-actions">
            <button data-p="draw">🔁 重畫</button>
            <button data-p="tagview" class="${tagOpen ? 'bzp-main' : ''}">🏷️ tag</button>
            <button data-p="info">ℹ️</button>
            <button data-p="dl" title="存到手機">⬇️</button>
            <button data-p="album">${it.album ? '✓ 已存相簿' : '🥟 存相簿'}</button>
            <button data-p="remove" title="拿掉這張">🗑️</button>
        </div>
        ${it.saved === false ? '<div class="bzp-hint">⚠️ 這張沒存進酒館，重新整理就不見了，喜歡的話先存相簿</div>' : ''}` : '';
    const tags = tagOpen ? `
        <div class="bzp-tags">
            <textarea class="bzp-tag-edit" data-raw rows="4">${esc(it.tags)}</textarea>
            <div class="bzp-hint">改了會自動存；$名字$ 畫的時候換成固定外貌</div>
            <div class="bzp-actions">
                ${seedMode.has(it.id) ? '<button data-p="seeddraw" class="bzp-main">🌱 同種子畫</button>' : `<button data-p="draw" class="bzp-main">${it.img ? '🔁 照這個 tag 重畫' : '🎨 畫'}</button>`}
                ${it.img ? '' : '<button data-p="remove" title="拿掉這張">🗑️</button>'}
            </div>
        </div>` : '';
    return `<div class="bzp-row">${head}${tagBtn}</div>${st.startsWith('❌') ? statusHtml(st) : ''}${body}${tags}`;
}

function askHtml(mesId) {
    if (!asking.has(mesId)) return '';
    return `<div class="bzp-ask">
        <textarea class="bzp-ask-text" rows="2" placeholder="這次想畫什麼？（可以不填，例如「多畫他的表情」）">${esc(asking.get(mesId))}</textarea>
        <div class="bzp-actions"><button data-p="askgo" class="bzp-main">✍️ 寫 tag</button><button data-p="askno">取消</button></div>
    </div>`;
}

function zoneHtml(mesId, mes, isLast, loose) {
    const items = itemsOf(mes);
    const writing = busy.get(mesId);
    if (!items.length && !writing) {
        if (asking.has(mesId)) return askHtml(mesId);
        return isLast && prefs().lastChip ? `<button class="bzp-chip" data-p="tags">🎨 生圖</button>` : '';
    }
    const head = `<div class="bzp-using" data-p="artist" title="點一下換畫師串">🖌️ 這次用：<span data-raw>${esc(usingLine())}</span> <span class="bzp-caret">▾</span></div>`;
    const rest = loose.map(({ it, i }) => `<div class="bzp-inline" data-item="${esc(it.id)}">${itemHtml(it, i)}</div>`).join('');
    return `${head}${rest}
        ${writing ? statusHtml(writing) : askHtml(mesId)}
        <div class="bzp-actions bzp-foot">
            <button data-p="tags">✍️ 重寫 tag</button>
            <button data-p="log" title="這次寫 tag 送了什麼、模型回了什麼">📜</button>
            ${items.some(it => !it.img) ? '<button data-p="drawall">🎨 全部畫</button>' : ''}
        </div>`;
}

const BLOCK = /^(P|DIV|LI|BLOCKQUOTE|H[1-6]|PRE|UL|OL|TABLE|DETAILS|SECTION|ARTICLE|FIGURE|CENTER)$/;

/** 畫面上的段落：一行一段（<br> 或區塊結尾就換段），記下圖要插在哪。 */
function domLines(root) {
    const lines = [];
    let text = '';
    let last = null;
    const flush = (target) => {
        if (normText(text)) lines.push({ text, target });
        text = '';
    };
    const walk = (node) => {
        for (const ch of [...node.childNodes]) {
            if (ch.nodeType === 3) { text += ch.nodeValue; last = ch; continue; }
            if (ch.nodeType !== 1) continue;
            if (ch.classList.contains('bzp-inline') || /^(SCRIPT|STYLE|TEMPLATE)$/.test(ch.tagName)) continue;
            if (ch.tagName === 'BR') { flush({ node: ch, where: 'after' }); last = ch; continue; }
            if (BLOCK.test(ch.tagName)) {
                if (normText(text)) flush({ node: last || ch, where: last ? 'after' : 'before' });
                walk(ch);
                flush({ node: ch, where: 'after' });
                last = ch;
                continue;
            }
            walk(ch);
            last = ch;
        }
    };
    walk(root);
    flush({ node: root, where: 'end' });
    return lines;
}

function findLine(lines, it, paraCount) {
    if (it.anchor) {
        let i = lines.findIndex(l => normText(l.text).startsWith(it.anchor));
        if (i < 0) i = lines.findIndex(l => normText(l.text).includes(it.anchor.slice(0, 8)));
        if (i >= 0) return lines[i];
    }
    // 沒有記號（舊的）或找不到：段數對得上才照段號放
    if (it.after >= 1 && lines.length === paraCount) return lines[it.after - 1];
    return null;
}

function insertAt(target, el) {
    const { node, where } = target;
    if (where === 'end') node.appendChild(el);
    else if (where === 'before') node.parentNode.insertBefore(el, node);
    else node.parentNode.insertBefore(el, node.nextSibling);
}

export function renderMes(mesId) {
    const ctx = stx();
    const mes = ctx?.chat?.[mesId];
    const el = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (!el) return;
    el.querySelectorAll('.bzp-inline').forEach(x => x.remove());
    let zone = el.querySelector('.bzp-zone');
    if (!isHusbandMes(mes)) { zone?.remove(); return; }
    const items = itemsOf(mes);
    // 先放進段落：同一段有好幾張就照順序排
    const textEl = el.querySelector('.mes_text');
    const loose = [];
    const lines = textEl && items.some(it => it.anchor || it.after) ? domLines(textEl) : [];
    const paraCount = lines.length ? paragraphs(mes.mes).length : 0;
    const lastAt = new Map();
    items.forEach((it, i) => {
        const line = lines.length ? findLine(lines, it, paraCount) : null;
        if (!line) { loose.push({ it, i }); return; }
        const box = document.createElement('div');
        box.className = 'bzp-inline';
        box.dataset.item = it.id;
        box.innerHTML = itemHtml(it, i);
        const prev = lastAt.get(line);
        if (prev) prev.after(box); else insertAt(line.target, box);
        lastAt.set(line, box);
        localizeLive(box);
    });
    const html = zoneHtml(mesId, mes, mesId === lastHusbandId(ctx.chat), loose);
    if (!html) { zone?.remove(); return; }
    if (!zone) {
        zone = document.createElement('div');
        zone.className = 'bzp-zone';
        (textEl?.parentElement || el).insertBefore(zone, textEl?.nextSibling || null);
    }
    zone.innerHTML = html;
    zone.dataset.mes = String(mesId);
    localizeLive(zone);
    watchGone(el, mesId);
    rememberAlbum(items);
}

// ---------- 🧹 清掉舊的生圖（2.26.0，一帆 #162 選 A：圖存在酒館的圖片資料夾，越積越多佔手機空間） ----------
// 包子存的檔名是 baozi_<時間>_xxxx，照時間刪 N 天前的（每個角色的資料夾都看）；存進相簿過的（store().keep）不刪。
// 刪掉的那張在聊天裡變回「🎨 畫」，tag 還在。別的聊天的打開時才發現（圖讀不到、檔案 404）再標成清掉了。

const normPath = (p) => String(p || '').replace(/^\/+/, '');

async function stPost(url, body) {
    const headers = stx()?.getRequestHeaders?.() || { 'Content-Type': 'application/json' };
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}) });
    if (!res.ok) throw new Error(`${url}：${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
}

function keepSet() {
    return new Set((store().keep || []).map(normPath));
}

/** 2.26.0 以前存進相簿的：打開聊天時看到就補記進 keep（別被 🧹 清掉）。 */
function rememberAlbum(items) {
    const st = store();
    const have = new Set((st.keep || []).map(normPath));
    const add = items.filter(it => it.album && it.img && !it.img.startsWith('blob:') && !have.has(normPath(it.img))).map(it => normPath(it.img));
    if (!add.length) return;
    st.keep = [...have, ...add].slice(-3000);
    saveStore();
}

const stamp = (path) => Number(String(path || '').split('/').pop().match(/^baozi_(\d{12,14})_/)?.[1]) || 0;

/** 刪掉 days 天前的生圖檔。回 {removed, kept, failed}。 */
export async function cleanOldImages(days = prefs().cleanDays) {
    const d = Number(days);
    if (!(d > 0)) return { removed: 0, kept: 0, failed: 0 };
    const cutoff = Date.now() - d * 86_400_000;
    for (const mes of stx()?.chat || []) if (isHusbandMes(mes)) rememberAlbum(itemsOf(mes));
    const keep = keepSet();
    let removed = 0, kept = 0, failed = 0;
    const folders = await stPost('/api/images/folders', {});
    for (const f of Array.isArray(folders) ? folders : []) {
        const folder = typeof f === 'string' ? f : (f?.name || '');
        if (!folder) continue;
        let files = [];
        try { files = await stPost('/api/images/list', { folder }); } catch { continue; }
        for (const it of Array.isArray(files) ? files : []) {
            const name = String(typeof it === 'string' ? it : (it?.name || it?.path || '')).split('/').pop();
            const when = stamp(name);
            if (!when || when >= cutoff) continue;
            const path = `user/images/${folder}/${name}`;
            if (keep.has(path)) { kept++; continue; }
            try { await stPost('/api/images/delete', { path }); removed++; } catch { failed++; }
        }
    }
    // 這個聊天裡被刪掉的那幾張：變回「🎨 畫」
    const chat = stx()?.chat || [];
    chat.forEach((mes, i) => {
        if (!isHusbandMes(mes)) return;
        const items = itemsOf(mes);
        let changed = false;
        for (const it of items) {
            if (it.img && !it.img.startsWith('blob:') && stamp(it.img) && stamp(it.img) < cutoff && !keep.has(normPath(it.img))) {
                it.img = null; it.cleared = true; it.album = false; changed = true;
            }
        }
        if (changed) { setItems(mes, items); renderMes(i); }
    });
    saveChat();
    return { removed, kept, failed };
}

/** 一天最多自動清一次（開著酒館 30 秒後）。 */
async function autoClean() {
    const days = Number(prefs().cleanDays);
    if (!(days > 0)) return;
    const today = new Date().toDateString();
    try { if (localStorage.getItem('baozi_pics_cleaned') === today) return; localStorage.setItem('baozi_pics_cleaned', today); } catch { /* */ }
    try {
        const r = await cleanOldImages(days);
        if (r.removed) toast(`🧹 清掉了 ${r.removed} 張 ${days} 天前的生圖`);
    } catch (e) {
        console.warn('[包子同好會] 自動清圖失敗', e);
    }
}

/** 打開的圖讀不到：檔案真的不在了（404）就標成清掉了。 */
function watchGone(el, mesId) {
    el.querySelectorAll('img.bzp-img').forEach(img => {
        if (img.dataset.chk) return;
        img.dataset.chk = '1';
        img.addEventListener('error', async () => {
            const src = img.getAttribute('src') || '';
            if (src.startsWith('blob:')) return;
            let gone = false;
            try { gone = (await fetch(src, { method: 'HEAD' })).status === 404; } catch { /* 連不上不算 */ }
            if (!gone) return;
            const { mes, items, item } = findItem(mesId, img.closest('[data-item]')?.dataset.item);
            if (!item || item.img !== src) return;
            item.img = null; item.cleared = true; item.album = false;
            setItems(mes, items);
            saveChat();
            renderMes(mesId);
        }, { once: true });
    });
}

export function renderAll() {
    const ctx = stx();
    if (!ctx?.chat) return;
    document.querySelectorAll('#chat .mes[mesid]').forEach(el => renderMes(Number(el.getAttribute('mesid'))));
}

function setStatus(mesId, itemId, text) {
    if (text) status.set(itemId, text); else status.delete(itemId);
    renderMes(mesId);
}

/** 按了「🎨 生圖」：提示詞要問她想畫什麼的話先跳出小框，不然直接寫。 */
export function askTags(mesId) {
    if (!wantsDemand()) { makeTags(mesId); return; }
    if (!asking.has(mesId)) asking.set(mesId, '');
    renderMes(mesId);
    document.querySelector(`#chat .mes[mesid="${mesId}"] .bzp-ask-text`)?.focus();
}

/** 寫 tag（取代這則現在的小卡）。 */
export async function makeTags(mesId, { thenDraw = false, demand = '' } = {}) {
    const ctx = stx();
    const mes = ctx?.chat?.[mesId];
    if (!isHusbandMes(mes) || busy.has(mesId)) return;
    asking.delete(mesId);
    busy.set(mesId, '副 API 在讀正文寫 tag…');
    renderMes(mesId);
    try {
        const pics = await writeTags(mes.mes, { mesId, demand });
        const items = pics.map(p => ({ id: Math.random().toString(36).slice(2, 10), scene: p.scene, tags: p.tags, nsfw: !!p.nsfw,
            after: p.after || 0, anchor: p.anchor || '' }));
        // 已經畫好的圖保留（重寫 tag 不會把圖丟掉）
        const kept = itemsOf(mes).filter(it => it.img);
        setItems(mes, [...kept, ...items]);
        saveChat();
        busy.delete(mesId);
        renderMes(mesId);
        if (thenDraw) for (const it of items) drawItem(mesId, it.id);
    } catch (e) {
        busy.delete(mesId);
        renderMes(mesId);
        toast('❌ 寫 tag 失敗：' + e.message, 'error');
    }
}

function findItem(mesId, itemId) {
    const mes = stx()?.chat?.[mesId];
    const items = itemsOf(mes);
    return { mes, items, item: items.find(it => it.id === itemId) };
}

/**
 * 畫一張。
 * @param opt.seedFrom 同種子重畫：拿這份 meta 的畫師串、參數、種子
 */
export async function drawItem(mesId, itemId, opt = {}) {
    let { mes, item } = findItem(mesId, itemId);
    if (!item || (status.has(itemId) && !status.get(itemId).startsWith('❌'))) return;
    const ctx = stx();
    const nsfw = !!item.nsfw;
    const prep = prepTags(item.tags, cardKey(), nsfw);
    const from = opt.seedFrom;
    const extra = { nsfw, chars: prep.chars, extraUC: prep.uc };
    const { body, meta } = buildRequest(prep.base, from ? { params: from.params, artist: from.artist, seed: from.seed, ...extra } : extra);
    meta.rawTags = item.tags;
    // 重畫（一帆 #162 選 B）：不用確認，直接顯示「重畫中」；畫好了小包子冒泡說一聲
    const redo = !!item.img;
    const say = (s) => setStatus(mesId, itemId, !redo ? s : s === '畫圖中…' ? '重畫中…' : `重畫・${s}`);
    try {
        say('畫圖中…');
        const png = await draw(body, say);
        say('存圖中…');
        const local = await saveLocal(png, ctx?.name2);
        ({ mes, item } = findItem(mesId, itemId));     // 畫的時候她可能換了 swipe、刪了卡
        if (item) {
            item.img = local.src;
            item.saved = local.saved;
            item.meta = meta;
            item.album = false;
            setItems(mes, itemsOf(mes));
            saveChat();
        }
        setStatus(mesId, itemId, '');
        if (redo && item) tellRedrawn(mesId, itemId);
    } catch (e) {
        setStatus(mesId, itemId, '❌ ' + e.message);
        setTimeout(() => { if (status.get(itemId)?.startsWith('❌')) setStatus(mesId, itemId, ''); }, 15_000);
    }
}

/** 重畫好了：小包子舉著畫冒泡，按「👀 看看」打開那張。 */
function tellRedrawn(mesId, itemId) {
    const n = itemsOf(stx()?.chat?.[mesId]).findIndex(it => it.id === itemId) + 1;
    let pose = null;
    try { pose = drawPainter('done', 3); } catch { /* 畫不出來就用平常那隻 */ }
    try {
        const bubble = showBubble(`<div class="xbz-say">🎨 第 ${n} 張重畫好了～</div><div class="baozi-toast-row"><button class="baozi-btn-small baozi-on" data-a="see">👀 看看</button><button class="baozi-btn-small" data-a="bye">好～</button></div>`, { pose });
        bubble.querySelector('[data-a="bye"]')?.addEventListener('click', closeBubble);
        bubble.querySelector('[data-a="see"]')?.addEventListener('click', () => {
            closeBubble();
            openImg.add(itemId);
            renderMes(mesId);
            document.querySelector(`#chat .mes[mesid="${mesId}"] .bzp-inline[data-item="${CSS.escape(itemId)}"], #chat .mes[mesid="${mesId}"] .bzp-zone`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
    } catch {
        toast(`🎨 第 ${n} 張重畫好了`, 'success');
    }
}

function toast(msg, kind = 'info') {
    const tt = globalThis.toastr;
    if (tt?.[kind]) tt[kind](t(msg)); else console.log('[包子同好會]', msg);
}


// ============================================================
// 🥟 存相簿、ℹ️ 看資料、🖌️ 換畫師串
// ============================================================

async function saveAlbum(mesId, itemId, btn) {
    const { mes, item } = findItem(mesId, itemId);
    if (!item?.img) return;
    if (!bot.url || !bot.token) { toast('先登入包子才能存相簿', 'warning'); return; }
    btn.disabled = true;
    btn.textContent = t('存相簿中…');
    try {
        const blob = await (await fetch(item.img)).blob();
        const ctx = stx();
        const q = new URLSearchParams({ kind: 'image', post: '0', character: ctx?.name2 || '' });
        const res = await fetch(bot.url + '/club/shots?' + q, {
            method: 'POST', headers: { Authorization: 'Bearer ' + bot.token, 'Content-Type': 'image/png' }, body: blob,
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error || ('大包子回了 ' + res.status));
        if (item.meta) {
            await fetch(`${bot.url}/club/shots/${j.shot.id}/meta`, {
                method: 'POST', headers: { Authorization: 'Bearer ' + bot.token, 'Content-Type': 'application/json' },
                body: JSON.stringify({ meta: { ...item.meta, scene: item.scene || '', card: ctx?.name2 || '' } }),
            }).catch(() => {});
        }
        item.album = true;
        // 存進相簿的不會被 🧹 清掉
        const st = store();
        st.keep = [...new Set([...(st.keep || []), normPath(item.img)])].slice(-3000);
        saveStore();
        setItems(mes, itemsOf(mes));
        saveChat();
        renderMes(mesId);
        toast('🥟 存進包子相簿了');
    } catch (e) {
        btn.disabled = false;
        btn.textContent = t('🥟 存相簿');
        toast('❌ 存相簿失敗：' + e.message, 'error');
    }
}

function modal(inner) {
    document.getElementById('bzp-modal')?.remove();
    const m = document.createElement('div');
    m.id = 'bzp-modal';
    m.className = 'bzp-modal';
    m.innerHTML = `<div class="bzp-modal-card">${inner}</div>`;
    document.body.appendChild(m);
    m.addEventListener('click', ev => { if (ev.target === m || ev.target.closest('[data-close]')) m.remove(); });
    localizeLive(m);
    return m;
}

/** ℹ️ 這張用了什麼（相簿也用這個）。 */
export function metaHtml(meta) {
    const p = meta.params || {};
    const a = meta.artist || {};
    const row = (k, v) => v === undefined || v === '' ? '' : `<div class="bzp-meta-row"><span>${k}</span><b data-raw>${esc(v)}</b></div>`;
    return `
        <div class="bzp-meta-title">🖌️ 畫師串：<span data-raw>${esc(a.name || '（沒有）')}</span></div>
        ${a.fixedPrompt ? `<div class="bzp-meta-label">前面</div><pre data-raw>${esc(a.fixedPrompt)}</pre>` : ''}
        ${a.fixedPrompt_end ? `<div class="bzp-meta-label">後面</div><pre data-raw>${esc(a.fixedPrompt_end)}</pre>` : ''}
        ${a.negativePrompt ? `<div class="bzp-meta-label">負面</div><pre data-raw>${esc(a.negativePrompt)}</pre>` : ''}
        <div class="bzp-meta-grid">
            ${row('型號', meta.model)}${row('步數', p.steps)}${row('CFG', p.scale)}${row('Rescale', p.rescale)}
            ${row('採樣器', p.sampler)}${row('噪點表', p.schedule)}${row('尺寸', p.width ? `${p.width}×${p.height}` : '')}
            ${row('種子', meta.seed)}${row('分級', meta.nsfw === undefined ? '' : meta.nsfw ? '🔞 NSFW' : 'SFW')}${row('Variety+', p.variety ? '開' : '關')}${row('時間', meta.at ? new Date(meta.at).toLocaleString() : '')}
        </div>
        <div class="bzp-meta-label">這張的 tag</div><pre data-raw>${esc(meta.rawTags || meta.tags || '')}</pre>
        <details><summary>實際送出去的完整正面／負面</summary>
            <div class="bzp-meta-label">正面</div><pre data-raw>${esc(meta.positive || '')}</pre>
            <div class="bzp-meta-label">負面</div><pre data-raw>${esc(meta.negative || '')}</pre>
        </details>`;
}

/** 把畫圖時的參數換回智繪姬的欄位名（換回這個串時一起套）。 */
function paramsToChatu8(p) {
    if (!p) return null;
    return {
        novelaimode: p.model, novelai_steps: p.steps, nai3Scale: p.scale, cfg_rescale: p.rescale,
        novelai_sampler: p.sampler, Schedule: p.schedule, novelai_width: p.width, novelai_height: p.height,
        UCP_novelai: p.ucp, nai3Variety: p.variety,
    };
}

export async function restoreArtist(meta) {
    await switchArtist(meta.artist, paramsToChatu8(meta.params));
}

function openInfo(mesId, itemId) {
    const { item } = findItem(mesId, itemId);
    if (!item?.meta) { toast('這張沒有記到資料'); return; }
    const m = modal(`
        <div class="bzp-modal-title">ℹ️ 這張用了什麼</div>
        ${metaHtml({ ...item.meta, rawTags: item.meta.rawTags || item.tags })}
        <div class="bzp-actions">
            <button data-i="restore">🎨 換回這個串</button>
            <button data-i="seed">🌱 同種子重畫</button>
            <button data-close>✕</button>
        </div>`);
    m.addEventListener('click', async (ev) => {
        const a = ev.target.closest('[data-i]')?.dataset.i;
        if (a === 'restore') {
            try { await restoreArtist(item.meta); toast('🎨 換回「' + (item.meta.artist?.name || '') + '」了'); renderAll(); m.remove(); } catch (e) { toast('❌ ' + e.message, 'error'); }
        }
        if (a === 'seed') {
            m.remove();
            // 打開 tag 框讓她改，改好按「🌱 同種子畫」
            seedMode.add(itemId);
            openTag.add(itemId);
            openImg.add(itemId);
            renderMes(mesId);
            document.querySelector(`#chat .mes[mesid="${mesId}"] .bzp-inline[data-item="${CSS.escape(itemId)}"] textarea`)?.focus();
        }
    });
}

export async function openArtistPicker(onDone = () => {}) {
    const entries = await npsEntries();
    const list = entries.length ? entries : chatu8Presets().map(p => ({ name: p.name, positive: join(p.fixedPrompt, p.fixedPrompt_end), negative: p.negativePrompt, _c8: p }));
    const cur = currentArtist().name;
    const cats = [...new Set(list.flatMap(e => Array.isArray(e.category) ? e.category : (e.category ? [e.category] : [])))];
    const m = modal(`
        <div class="bzp-modal-title">🖌️ 換畫師串</div>
        <div class="bzp-hint">${entries.length ? '讀的是 NAI 切換助手的收藏庫；換了智繪姬、切換助手也一起換' : '讀不到 NAI 切換助手，先列智繪姬自己的預設（沒有預覽圖和參數綁定）'}</div>
        <div class="bzp-hint" data-raw>現在：${esc(usingLine())}</div>
        <input type="text" class="baozi-search" data-f="q" placeholder="搜尋名字或內容">
        ${cats.length ? `<div class="bzp-cats"><button class="baozi-tag-chip active" data-cat="">全部</button>${cats.map(c => `<button class="baozi-tag-chip" data-cat="${esc(c)}" data-raw>${esc(c)}</button>`).join('')}</div>` : ''}
        <div class="bzp-artists"></div>
        <div class="bzp-actions"><button data-i="random">🎲 隨機</button><button data-close>✕</button></div>`);
    let cat = '';
    const grid = m.querySelector('.bzp-artists');
    const shown = () => {
        const q = m.querySelector('[data-f="q"]').value.trim().toLowerCase();
        return list.filter(e => (!cat || (Array.isArray(e.category) ? e.category : [e.category]).includes(cat))
            && (!q || `${e.name} ${e.positive || ''}`.toLowerCase().includes(q)));
    };
    const paint = () => {
        grid.innerHTML = shown().map((e, i) => `
            <div class="bzp-artist ${String(e.name).trim() === cur ? 'on' : ''}" data-n="${list.indexOf(e)}">
                ${e.thumb && /^(data:|https?:|\/)/.test(e.thumb) ? `<img src="${esc(e.thumb)}" alt="">` : '<div class="bzp-artist-ph">🖌️</div>'}
                <div class="bzp-artist-name" data-raw>${esc(e.name)}</div>
            </div>`).join('') || '<div class="bzp-hint">沒有符合的</div>';
    };
    paint();
    m.querySelector('[data-f="q"]').addEventListener('input', paint);
    const pick = async (e) => {
        try {
            if (e._c8) await switchArtist(e._c8); else await switchToEntry(e);
            toast('🖌️ 換成「' + e.name + '」');
            m.remove();
            onDone();
        } catch (err) { toast('❌ ' + err.message, 'error'); }
    };
    m.addEventListener('click', (ev) => {
        const c = ev.target.closest('[data-cat]');
        if (c) { cat = c.dataset.cat; m.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('active', x === c)); paint(); return; }
        const card = ev.target.closest('[data-n]');
        if (card) { pick(list[Number(card.dataset.n)]); return; }
        if (ev.target.closest('[data-i="random"]')) {
            const pool = shown().filter(e => String(e.name).trim() !== cur);
            if (pool.length) pick(pool[Math.floor(Math.random() * pool.length)]);
        }
    });
}

function viewImage(src) {
    openViewer(src, 'baozi-pic');
}


// ============================================================
// 🔌 掛上酒館
// ============================================================

function onZoneClick(ev) {
    const btn = ev.target.closest('[data-p]');
    const zone = ev.target.closest('.bzp-zone, .bzp-inline');
    if (!btn || !zone) return;
    ev.preventDefault();
    ev.stopPropagation();
    const mesId = Number(zone.closest('.mes')?.getAttribute('mesid'));
    const itemId = btn.closest('[data-item]')?.dataset.item;
    const a = btn.dataset.p;
    if (a === 'tags') { askTags(mesId); return; }
    if (a === 'askgo') { makeTags(mesId, { demand: asking.get(mesId) || '' }); return; }
    if (a === 'askno') { asking.delete(mesId); renderMes(mesId); return; }
    if (a === 'log') {
        logFor(chatKey(), mesId).then(l => (l ? openLog(l) : toast('這則還沒有寫 tag 的紀錄（從 2.26.0 開始記）')));
        return;
    }
    if (a === 'artist') { openArtistPicker(() => renderAll()); return; }
    if (a === 'drawall') { itemsOf(stx().chat[mesId]).filter(it => !it.img).forEach(it => drawItem(mesId, it.id)); return; }
    if (!itemId) return;
    if (a === 'draw') { drawItem(mesId, itemId); return; }
    if (a === 'seeddraw') { seedMode.delete(itemId); const { item } = findItem(mesId, itemId); drawItem(mesId, itemId, { seedFrom: item?.meta }); return; }
    if (a === 'fold') { if (openImg.has(itemId)) { openImg.delete(itemId); openTag.delete(itemId); } else openImg.add(itemId); renderMes(mesId); return; }
    if (a === 'tagview') { if (openTag.has(itemId)) { openTag.delete(itemId); seedMode.delete(itemId); } else openTag.add(itemId); renderMes(mesId); return; }
    if (a === 'info') { openInfo(mesId, itemId); return; }
    if (a === 'nsfw') {
        const { mes, items, item } = findItem(mesId, itemId);
        if (!item) return;
        item.nsfw = !item.nsfw;
        setItems(mes, items);
        saveChat();
        renderMes(mesId);
        return;
    }
    if (a === 'view') { viewImage(btn.getAttribute('src')); return; }
    if (a === 'dl') { const { item } = findItem(mesId, itemId); if (item?.img) saveAndTell(item.img, 'baozi-pic'); return; }
    if (a === 'album') { if (!findItem(mesId, itemId).item?.album) saveAlbum(mesId, itemId, btn); return; }
    if (a === 'remove') {
        if (!confirm(t('拿掉這張？（存在酒館的圖檔不會刪）'))) return;
        const { mes, items } = findItem(mesId, itemId);
        setItems(mes, items.filter(it => it.id !== itemId));
        saveChat();
        renderMes(mesId);
    }
}

/** 「想畫什麼」框打的字先記著（畫面重畫時不會不見）。 */
function onAskInput(ev) {
    const ta = ev.target.closest('.bzp-ask-text');
    if (!ta) return;
    asking.set(Number(ta.closest('.mes')?.getAttribute('mesid')), ta.value);
}

function onTagEdit(ev) {
    const ta = ev.target.closest('.bzp-tag-edit');
    if (!ta) return;
    const mesId = Number(ta.closest('.mes')?.getAttribute('mesid'));
    const itemId = ta.closest('[data-item]')?.dataset.item;
    const { mes, items, item } = findItem(mesId, itemId);
    if (!item) return;
    item.tags = ta.value;
    setItems(mes, items);
    saveChat();
}

/** 訊息的「…」選單裡也放一顆（每一則都能叫）。 */
function addMenuButtons() {
    document.querySelectorAll('#chat .mes:not([is_user="true"]) .extraMesButtons').forEach(box => {
        if (box.querySelector('.bzp-menu-btn')) return;
        const b = document.createElement('div');
        b.className = 'mes_button bzp-menu-btn fa-solid fa-palette';
        b.title = t('🎨 包子生圖');
        box.prepend(b);
    });
}

function onMenuClick(ev) {
    const b = ev.target.closest('.bzp-menu-btn');
    if (!b) return;
    const id = Number(b.closest('.mes')?.getAttribute('mesid'));
    if (Number.isFinite(id)) askTags(id);
}

let started = false;

export function startPics() {
    if (started) return;
    const ctx = stx();
    const src = ctx?.eventSource;
    const ev = ctx?.eventTypes || ctx?.event_types;
    if (!src || !ev) { console.warn('[包子同好會] 沒有酒館事件，生圖不開'); return; }
    started = true;
    const all = () => { setTimeout(() => { renderAll(); addMenuButtons(); }, 50); };
    src.on(ev.CHAT_CHANGED, () => { seedLooks(); all(); });
    for (const name of ['MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MORE_MESSAGES_LOADED']) {
        if (ev[name]) src.on(ev[name], all);
    }
    if (ev.USER_MESSAGE_RENDERED) src.on(ev.USER_MESSAGE_RENDERED, all);
    if (ev.CHARACTER_MESSAGE_RENDERED) {
        src.on(ev.CHARACTER_MESSAGE_RENDERED, (id) => {
            all();
            const mes = stx()?.chat?.[id];
            // 自動模式：最新這則、還沒寫過 tag 的才自動（打開舊聊天不會補跑）
            if (prefs().auto && isHusbandMes(mes) && Number(id) === stx().chat.length - 1 && !itemsOf(mes).length && !mes.is_system) {
                makeTags(Number(id), { thenDraw: true });
            }
        });
    }
    const chatEl = document.getElementById('chat');
    chatEl?.addEventListener('click', onZoneClick, true);
    chatEl?.addEventListener('click', onMenuClick);
    chatEl?.addEventListener('change', onTagEdit);
    chatEl?.addEventListener('input', onAskInput);
    chatEl?.addEventListener('focusout', onTagEdit);
    all();
    setTimeout(autoClean, 30_000);
}
