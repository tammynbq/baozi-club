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
    count: 1,             // 一則畫幾張（1～4）
    tagApi: '',           // 寫 tag 用哪組 API（aidesign 的），空＝用排版那組
    promptId: 'builtin',  // 寫 tag 的提示詞
    lastChip: true,       // 最後一則老公的回覆底下顯示「🎨 生圖」
};

/** 不是祕密的東西放酒館的擴充設定：prefs、提示詞、固定外貌。 */
export function store() {
    const ctx = stx();
    const all = ctx?.extensionSettings || globalThis.extension_settings || {};
    all[EXT] ??= {};
    const s = all[EXT].pics ??= {};
    s.prefs = { ...DEFAULT_PREFS, ...(s.prefs || {}) };
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
export function currentParams() {
    const c = chatu8() || {};
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
function writeParams(params) {
    const c = chatu8();
    if (!c || !params) return;
    const p = { ...params };
    const m = String(p.novelai_size || '').match(/^(\d+)x(\d+)$/);
    if (m) { p.novelai_width = m[1]; p.novelai_height = m[2]; }
    for (const [k, v] of Object.entries(p)) {
        if (v === undefined || v === null || k === 'novelai_size') continue;
        const box = CHECKBOX_FIELDS.has(k);
        c[k] = box ? String(isOn(v) || v === 1) : String(v);
        setField(k, box ? (isOn(v) || v === 1) : v, box);
    }
    if (p.novelai_size) setField('novelai_size', p.novelai_size);
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
    const positive = join(stripNotes(a.fixedPrompt), tags, stripNotes(a.fixedPrompt_end), quality);
    const negative = join(ucText(model, p.ucp), stripNotes(a.negativePrompt));
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
        parameters.use_coords = false;
        parameters.characterPrompts = [];
        parameters.v4_prompt = { caption: { base_caption: positive, char_captions: [] }, use_coords: false, use_order: true };
        parameters.v4_negative_prompt = { caption: { base_caption: negative, char_captions: [] }, legacy_uc: false };
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
        model: sendModel, seed, tags, positive, negative,
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
6. 不要寫畫師名字、品質詞（masterpiece、best quality…），那些另外加。` },
        { name: '輸出格式', role: 'system', enabled: true, content: `只照這個格式回，不要其他文字：
<pic>
<scene>用一句中文說這張畫的是什麼</scene>
<tags>英文標籤, 用逗號隔開</tags>
</pic>
要畫幾張就寫幾個 <pic>。` },
        { name: '正文', role: 'user', enabled: true, content: `正文：
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

export function expandLooks(tags, key = cardKey()) {
    const map = new Map(looksFor(key).filter(l => l.tags?.trim()).map(l => [l.name.trim(), l.tags.trim()]));
    return String(tags).replace(/\$([^$\n]{1,30})\$/g, (all, name) => map.get(name.trim()) ?? name.trim());
}

function looksText(key = cardKey()) {
    const list = looksFor(key);
    if (!list.length) return '（沒有）';
    return list.map(l => `$${l.name}$${l.tags?.trim() ? '' : '（還沒填外貌，照正文寫）'}`).join('、')
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
        .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function fill(content, vars) {
    let out = String(content || '');
    for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v);
    const ctx = stx();
    try { if (ctx?.substituteParams) out = ctx.substituteParams(out); } catch { /* */ }
    return out;
}

export function parsePics(text) {
    const raw = String(text || '').replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '');
    const out = [];
    for (const m of raw.matchAll(/<pic>([\s\S]*?)(?:<\/pic>|(?=<pic>)|$)/gi)) {
        const tags = m[1].match(/<tags>([\s\S]*?)(?:<\/tags>|$)/i)?.[1];
        if (!tags?.trim()) continue;
        out.push({ scene: (m[1].match(/<scene>([\s\S]*?)<\/scene>/i)?.[1] || '').trim(), tags: cleanTags(tags) });
    }
    if (!out.length) {
        // 也認智繪姬／喵喵那種 image###tag### 的格式（匯入別人的提示詞時）
        for (const m of raw.matchAll(/image###([\s\S]*?)###/g)) {
            if (m[1].trim()) out.push({ scene: '', tags: cleanTags(m[1]) });
        }
    }
    return out;
}

function cleanTags(s) {
    return String(s).replace(/\n+/g, ', ').replace(/，/g, ',').replace(/\s*,\s*(,\s*)*/g, ', ').replace(/^[\s,]+|[\s,]+$/g, '');
}

/** 讀這則正文，請副 API 寫 tag。回 [{scene, tags}]。 */
export async function writeTags(mesText) {
    const profile = tagApiProfile();
    if (!profile) throw new Error('還沒有寫 tag 的 API～到「設定 → ✨ 排版模型」加一組，再到「🎨 生圖」選它');
    const vars = {
        正文: stripForTags(mesText).slice(0, 8000),
        角色設定: characterText(),
        用戶人設: personaText(),
        固定外貌: looksText(),
        張數: String(Math.max(1, Math.min(4, Number(prefs().count) || 1))),
    };
    const msgs = currentPrompt().entries
        .filter(e => e.enabled && String(e.content || '').trim())
        .map(e => ({ role: ['system', 'user', 'assistant'].includes(e.role) ? e.role : 'system', content: fill(e.content, vars) }));
    if (!msgs.some(m => m.role === 'user')) msgs.push({ role: 'user', content: vars.正文 });
    const reply = await callModel(profile, msgs, { maxTokens: 2000, temperature: 0.8 });
    const pics = parsePics(reply);
    if (!pics.length) throw new Error('模型沒照格式回 tag：' + reply.slice(0, 80));
    return pics;
}


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
const status = new Map();   // 項目 id → 狀態字

function isHusbandMes(mes) {
    return mes && !mes.is_user && !mes.is_system && mes.mes !== undefined;
}

function lastHusbandId(chat) {
    for (let i = chat.length - 1; i >= 0; i--) if (isHusbandMes(chat[i])) return i;
    return -1;
}

function zoneHtml(mesId, mes, isLast) {
    const items = itemsOf(mes);
    const writing = busy.get(mesId);
    if (!items.length && !writing) {
        return isLast && prefs().lastChip ? `<button class="bzp-chip" data-p="tags">🎨 生圖</button>` : '';
    }
    const head = `<div class="bzp-using" data-p="artist" title="點一下換畫師串">🖌️ 這次用：<span data-raw>${esc(usingLine())}</span> <span class="bzp-caret">▾</span></div>`;
    const cards = items.map((it, i) => {
        const st = status.get(it.id) || '';
        return `
        <div class="bzp-card" data-item="${esc(it.id)}">
            <div class="bzp-card-head"><b>第 ${i + 1} 張</b>${it.scene ? `・<span data-raw>${esc(it.scene)}</span>` : ''}</div>
            ${it.img ? `<img class="bzp-img" src="${esc(it.img)}" data-p="view" alt="">` : ''}
            <div class="bzp-tags" hidden>
                <textarea class="bzp-tag-edit" data-raw rows="4">${esc(it.tags)}</textarea>
                <div class="bzp-hint">改了會自動存；$名字$ 畫的時候換成固定外貌</div>
            </div>
            <div class="bzp-actions">
                ${it.img
                    ? `<button data-p="draw">🔁 重畫</button><button data-p="tagview">🏷️ tag</button><button data-p="info">ℹ️</button><button data-p="album">${it.album ? '✓ 已存相簿' : '🥟 存相簿'}</button>`
                    : `<button data-p="draw" class="bzp-main">🎨 畫</button><button data-p="tagview">🏷️ 看 tag</button>`}
                <button data-p="remove" title="拿掉這張">🗑️</button>
            </div>
            ${st ? `<div class="bzp-status">${st.startsWith('❌') ? '' : '<span class="baozi-chat-spin"></span> '}${esc(st)}</div>` : ''}
            ${it.img && it.saved === false ? '<div class="bzp-hint">⚠️ 這張沒存進酒館，重新整理就不見了，喜歡的話先存相簿</div>' : ''}
        </div>`;
    }).join('');
    return `${head}${cards}
        ${writing ? `<div class="bzp-status"><span class="baozi-chat-spin"></span> ${esc(writing)}</div>` : ''}
        <div class="bzp-actions bzp-foot">
            <button data-p="tags">✍️ 重寫 tag</button>
            ${items.some(it => !it.img) ? '<button data-p="drawall">🎨 全部畫</button>' : ''}
        </div>`;
}

export function renderMes(mesId) {
    const ctx = stx();
    const mes = ctx?.chat?.[mesId];
    const el = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
    if (!el) return;
    let zone = el.querySelector('.bzp-zone');
    if (!isHusbandMes(mes)) { zone?.remove(); return; }
    const html = zoneHtml(mesId, mes, mesId === lastHusbandId(ctx.chat));
    if (!html) { zone?.remove(); return; }
    if (!zone) {
        zone = document.createElement('div');
        zone.className = 'bzp-zone';
        const text = el.querySelector('.mes_text');
        (text?.parentElement || el).insertBefore(zone, text?.nextSibling || null);
    }
    // 打開過的 tag 框重畫後保持打開
    const open = new Set([...zone.querySelectorAll('.bzp-card')].filter(c => !c.querySelector('.bzp-tags')?.hidden).map(c => c.dataset.item));
    zone.innerHTML = html;
    zone.dataset.mes = String(mesId);
    open.forEach(id => { const tg = zone.querySelector(`[data-item="${CSS.escape(id)}"] .bzp-tags`); if (tg) tg.hidden = false; });
    localizeLive(zone);
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

/** 寫 tag（取代這則現在的小卡）。 */
export async function makeTags(mesId, { thenDraw = false } = {}) {
    const ctx = stx();
    const mes = ctx?.chat?.[mesId];
    if (!isHusbandMes(mes) || busy.has(mesId)) return;
    busy.set(mesId, '副 API 在讀正文寫 tag…');
    renderMes(mesId);
    try {
        const pics = await writeTags(mes.mes);
        const items = pics.map(p => ({ id: Math.random().toString(36).slice(2, 10), scene: p.scene, tags: p.tags }));
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
    const tags = expandLooks(item.tags);
    const from = opt.seedFrom;
    const { body, meta } = buildRequest(tags, from ? { params: from.params, artist: from.artist, seed: from.seed } : {});
    meta.rawTags = item.tags;
    try {
        const png = await draw(body, (s) => setStatus(mesId, itemId, s));
        setStatus(mesId, itemId, '存圖中…');
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
    } catch (e) {
        setStatus(mesId, itemId, '❌ ' + e.message);
        setTimeout(() => { if (status.get(itemId)?.startsWith('❌')) setStatus(mesId, itemId, ''); }, 15_000);
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
        if (item.scene) q.set('caption', item.scene.slice(0, 300));
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
            ${row('種子', meta.seed)}${row('Variety+', p.variety ? '開' : '關')}${row('時間', meta.at ? new Date(meta.at).toLocaleString() : '')}
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
            // 打開 tag 框讓她改，改好按「🌱 畫」
            const card = document.querySelector(`.bzp-zone[data-mes="${mesId}"] [data-item="${CSS.escape(itemId)}"]`);
            card?.querySelector('.bzp-tags')?.removeAttribute('hidden');
            const acts = card?.querySelector('.bzp-actions');
            if (acts && !acts.querySelector('[data-p="seeddraw"]')) {
                acts.insertAdjacentHTML('afterbegin', `<button data-p="seeddraw" class="bzp-main">${t('🌱 同種子畫')}</button>`);
            }
            card?.querySelector('textarea')?.focus();
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
    const v = document.createElement('div');
    v.className = 'baozi-chat-viewer';
    v.innerHTML = `<img src="${esc(src)}" alt="">`;
    v.addEventListener('click', () => v.remove());
    document.body.appendChild(v);
}


// ============================================================
// 🔌 掛上酒館
// ============================================================

function onZoneClick(ev) {
    const btn = ev.target.closest('[data-p]');
    const zone = ev.target.closest('.bzp-zone');
    if (!btn || !zone) return;
    ev.preventDefault();
    ev.stopPropagation();
    const mesId = Number(zone.dataset.mes ?? zone.closest('.mes')?.getAttribute('mesid'));
    const itemId = btn.closest('[data-item]')?.dataset.item;
    const a = btn.dataset.p;
    if (a === 'tags') { makeTags(mesId); return; }
    if (a === 'artist') { openArtistPicker(() => renderAll()); return; }
    if (a === 'drawall') { itemsOf(stx().chat[mesId]).filter(it => !it.img).forEach(it => drawItem(mesId, it.id)); return; }
    if (!itemId) return;
    if (a === 'draw') { drawItem(mesId, itemId); return; }
    if (a === 'seeddraw') { const { item } = findItem(mesId, itemId); drawItem(mesId, itemId, { seedFrom: item?.meta }); return; }
    if (a === 'tagview') { const tg = btn.closest('.bzp-card').querySelector('.bzp-tags'); tg.hidden = !tg.hidden; return; }
    if (a === 'info') { openInfo(mesId, itemId); return; }
    if (a === 'view') { viewImage(btn.getAttribute('src')); return; }
    if (a === 'album') { if (!findItem(mesId, itemId).item?.album) saveAlbum(mesId, itemId, btn); return; }
    if (a === 'remove') {
        if (!confirm(t('拿掉這張？（存在酒館的圖檔不會刪）'))) return;
        const { mes, items } = findItem(mesId, itemId);
        setItems(mes, items.filter(it => it.id !== itemId));
        saveChat();
        renderMes(mesId);
    }
}

function onTagEdit(ev) {
    const ta = ev.target.closest('.bzp-tag-edit');
    if (!ta) return;
    const zone = ta.closest('.bzp-zone');
    const mesId = Number(zone?.dataset.mes);
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
    if (Number.isFinite(id)) makeTags(id);
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
    chatEl?.addEventListener('focusout', onTagEdit);
    all();
}
