#!/usr/bin/env node
'use strict';

/* =====================================================================
   extract_aadhaar.js
   ---------------------------------------------------------------------
   Reads e-Aadhaar style PDFs and produces STRUCTURED output:
     - extracted/aadhaar_structured.json   (array of records)
     - extracted/aadhaar_structured.csv    (flat table)
     - console table / summary

   Uses pdf.js embedded text (no OCR). Node-safe legacy build.

   Usage:
     node extract_aadhaar.js                     # all *.pdf in cwd
     node extract_aadhaar.js a.pdf b.pdf         # specific files
   ===================================================================== */

const fs = require('fs');
const path = require('path');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

/* ------------------------------------------------------------------ */
/* DEFAULT INPUTS                                                     */
/* ------------------------------------------------------------------ */
const DEFAULT_PDFS = [
    '210164384605.pdf',
    '212576167624.pdf',
    '215270342984.pdf',
    '215756525476.pdf',
    '216160700256.pdf'
];

/* ------------------------------------------------------------------ */
/* TEXT HELPERS                                                       */
/* ------------------------------------------------------------------ */
function _cleanLine(t) {
    return (t || '')
        .replace(/[\uFFFD\u25A0-\u25FF\u2580-\u259F\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function _hindiRatio(t) {
    const total = (t.match(/\S/g) || []).length;
    if (!total) return 0;
    return (t.match(/[\u0900-\u097F]/g) || []).length / total;
}
function _englishRatio(t) {
    const total = (t.match(/\S/g) || []).length;
    if (!total) return 0;
    return (t.match(/[A-Za-z]/g) || []).length / total;
}
function _hasAnyHindi(t) { return /[\u0900-\u097F]/.test(t || ''); }
function _isGarbled(t) {
    const c = (t || '').replace(/\s/g, '');
    if (!c.length) return true;
    /* Supplementary PUA (surrogate pairs) + BMP garbage */
    const pua = (c.match(/[\uDB80-\uDBBF][\uDC00-\uDFFF]/g) || []).length;
    const bmp = (c.match(/[\uFFFD\u25A0-\u25FF\u2580-\u259F\uE000-\uF8FF]/g) || []).length;
    return (pua + bmp) / c.length > 0.3;
}

/* Safe, whole-phrase Hindi normalisations for common font-mapping
   degradations in these PDFs. Kept intentionally conservative so we
   never corrupt a person's actual name. */
function normalizeHindi(s) {
    if (!s) return s;
    let out = _cleanLine(s);
    const fixes = [
        [/उत्त\s*र\s*प्रदेश/g, 'उत्तर प्रदेश'],
        [/उतर\s*पदेश|उतर\s*प्रदेश|उत्तर\s*पदेश/g, 'उत्तर प्रदेश'],
        [/पु\s*रुष/g, 'पुरुष'],
        [/म\s*हला|महला/g, 'महिला'],
        [/अधागनी|अर्धागनी|अर्धांगनी|अधागिनी/g, 'अर्धांगिनी'],
        [/स्वगय/g, 'स्वर्गीय'],
        [/पो\s*स्ट/g, 'पोस्ट'],
        [/म\s*ज़ापुर|मी\s*ज़ापुर|मीज़ापुर/g, 'मिर्ज़ापुर']
    ];
    for (const [re, rep] of fixes) out = out.replace(re, rep);
    return out.replace(/\s{2,}/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* LAYOUT: text items -> reading-order lines                          */
/* ------------------------------------------------------------------ */
function itemsToLines(items, vpWidth) {
    if (!items || !items.length) return [];

    /* 1. group into Y bands (same visual line within ~4px) */
    const bands = [];
    const sorted = items.slice().sort((a, b) => {
        const dy = a.y - b.y;
        if (Math.abs(dy) <= 3) return a.x - b.x;
        return dy;
    });
    for (const it of sorted) {
        let placed = false;
        for (const band of bands) {
            if (Math.abs(it.y - band[0].y) <= 4) { band.push(it); placed = true; break; }
        }
        if (!placed) bands.push([it]);
    }

    /* 2. within a band sort by X; split into segments at large gaps */
    const minGap = Math.max(60, (vpWidth || 1200) * 0.05);
    const out = [];
    for (const band of bands) {
        band.sort((a, b) => a.x - b.x);
        let seg = '', prevRight = null;
        for (const it of band) {
            const w = it.w || Math.max(1, (it.s || '').length * 4);
            if (prevRight != null && (it.x - prevRight) >= minGap) {
                if (seg.trim()) out.push(_cleanLine(seg));
                seg = '';
            }
            seg += (it.s || '');
            prevRight = Math.max(prevRight == null ? it.x : prevRight, it.x + w);
        }
        if (seg.trim()) out.push(_cleanLine(seg));
    }
    return out.filter(l => l && l.length > 0);
}

/* ------------------------------------------------------------------ */
/* FIELD EXTRACTION                                                   */
/* ------------------------------------------------------------------ */
const NAME_KEYWORDS = /पता|पत्ता|address|\bDOB\b|male|female|पुरुष|महिला|स्त्री|लिंग|जन्म|नाम|नंबर|आधार|सरकार|भारत|सत्यापित|हस्ताक्षर|यूनिक|प्राधिकरण|आवेदन|नामांकन|अंकित|वितरित|डाउनलोड|issued|details|ग्राम|पोस्ट|पो\s*स्ट|जिला|नगर|राज्य|प्रदेश|पदेश|मोहल्ला|मकान|वार्ड|post|dist|pin|government|india|unique|authority|identification|downloaded|enrolment|W\/O|S\/O|D\/O|C\/O|अर्धांगिनी|अधागनी|पत्नी|पुत्र|पुत्री|डाकघर|विभाग|स्थान|निवास|^To$|^नमस्ते$/i;

function extractEnglishAddress(clean) {
    let start = -1;
    for (let i = 0; i < clean.length; i++) {
        if (/^(C\/O|W\/O|S\/O|D\/O)\b/i.test(clean[i])) { start = i; break; }
    }
    if (start < 0) return [];
    const out = [];
    for (let k = start; k < clean.length; k++) {
        const cl = clean[k];
        if (/[\u0900-\u097F]/.test(cl)) break;                       /* entered Hindi block */
        if (/^(Signature|Digitally|Identification Authority|Date\s*:|IST)/i.test(cl)) break;
        if (/^(Details as on|Aadhaar no\.?\s*issued)/i.test(cl)) break;
        if (/^Mobile\s*:/i.test(cl)) continue;
        if (/^Address\s*:?\s*$/i.test(cl)) continue;
        out.push(cl);
        if (/^PIN\s*Code/i.test(cl)) break;
    }
    return out;
}

/* The Hindi "पता:" label is rendered with a different embedded font whose
   glyphs interleave with the first address line (e.g. "पसुता न्दर:" =
   "पता:" + "सु न्दर:"). Remove the label's character set from the leading
   window only, using a per-character budget so real content is preserved. */
function stripPataLabel(line) {
    const chars = Array.from(line || '');
    const budget = { 'प': 1, 'त': 1, 'ा': 1, ':': 1 };
    const limit = Math.min(chars.length, 12);
    for (let i = 0; i < limit; i++) {
        const c = chars[i];
        if (budget[c] > 0) { budget[c]--; chars[i] = ''; }
    }
    return chars.join('').replace(/^[\s:]+/, '').replace(/\s{2,}/g, ' ').trim();
}

function extractHindiAddress(clean, nameHi) {
    const norm = s => (s || '').replace(/[\s\u0000-\u001F]/g, '');

    /* The Hindi name appears twice: once in the "To" salutation, once as
       the first line of the Hindi card block. The SECOND occurrence is the
       reliable anchor for the Hindi address block (the पता: label is often
       merged/garbled into the following line by the embedded font map). */
    let lastIdx = -1;
    if (nameHi) {
        for (let i = 0; i < clean.length; i++) {
            if (norm(clean[i]) === norm(nameHi)) lastIdx = i;
        }
    }
    let start = lastIdx + 1;

    /* Fallback anchor: first line carrying an address keyword */
    if (lastIdx < 0) {
        start = clean.length;
        for (let i = 0; i < clean.length; i++) {
            if (/पता|पसुता|पो\s*स्ट|ग्राम|जिला|प्रदेश|पदेश/.test(clean[i])) { start = i; break; }
        }
    }

    const out = [];
    for (let k = start; k < clean.length; k++) {
        const cl = _cleanLine(clean[k]);
        if (!cl) continue;
        /* Hard stop: English block / trailing metadata */
        if (/^Address\s*:?\s*$/i.test(cl)) break;
        if (/^Details\s*as\s*on/i.test(cl)) break;
        if (/Aadhaar\s*no\.?\s*issued/i.test(cl)) break;
        /* Skip (do NOT stop) noise inside the block */
        if (/DOB|जन्म|जन्\s*म|जनम/i.test(cl)) continue;
        if (/MALE|FEMALE|पु\s*रुष|म[हू]\s*ला|महिला|स्त्री|लिंग/i.test(cl)) continue;
        if (!_hasAnyHindi(cl) || _isGarbled(cl)) continue;
        if (_hindiRatio(cl) < 0.4) continue;
        if (nameHi && norm(cl) === norm(nameHi)) continue;
        const isAddr = cl.indexOf(',') > -1 || cl.indexOf('-') > -1 || /\d{6}/.test(cl) ||
            /ग्राम|पोस्ट|पो\s*स्ट|जिला|नगर|राज्य|प्रदेश|पदेश|मोहल्ला|मकान|वार्ड|अर्धांगिनी|अधागनी|पत्नी|पुत्र|डाकघर/.test(cl);
        if (isAddr) out.push(out.length === 0 ? stripPataLabel(cl) : cl);
    }
    return out;
}

function parseAadhaar(lines) {
    const clean = lines.map(_cleanLine).filter(Boolean);
    const flat = clean.join(' ');
    const res = {};
    let m;

    /* --- Enrolment --- */
    m = flat.match(/Enrolment\s*No\.?\s*[:：]?\s*([0-9\/\-]+)/i);
    if (m) res.enrolmentNo = m[1];

    /* --- Names via the letter's "To" salutation anchor --- */
    let toIdx = -1;
    for (let i = 0; i < clean.length; i++) { if (/^To$/i.test(clean[i])) { toIdx = i; break; } }
    if (toIdx >= 0) {
        for (let j = toIdx + 1; j < clean.length && j <= toIdx + 4; j++) {
            const cl = clean[j];
            if (cl.length < 2) continue;
            if (!res.nameHi && _hasAnyHindi(cl) && !_isGarbled(cl) && cl.length <= 60 && !NAME_KEYWORDS.test(cl)) {
                res.nameHi = cl; continue;
            }
            if (res.nameHi && !res.nameEn && !_hasAnyHindi(cl) && /^[A-Za-z][A-Za-z .'-]+$/.test(cl)) {
                res.nameEn = cl; break;
            }
        }
    }

    /* --- Name fallbacks (scoring) --- */
    if (!res.nameHi) {
        let best = null, bestScore = -1;
        for (let i = 0; i < clean.length; i++) {
            const cl = clean[i];
            if (!_hasAnyHindi(cl) || _isGarbled(cl)) continue;
            if (cl.length < 2 || cl.length > 40) continue;
            if (NAME_KEYWORDS.test(cl)) continue;
            if (/\d{4}/.test(cl)) continue;
            if (_hindiRatio(cl) < 0.75) continue;
            if (_englishRatio(cl) > 0.15) continue;
            const score = (cl.length >= 4 && cl.length <= 25 ? 2 : 0) + (i < clean.length * 0.5 ? 1 : 0);
            if (score > bestScore) { bestScore = score; best = cl; }
        }
        if (best) res.nameHi = best;
    }
    if (!res.nameEn) {
        let best = null, bestScore = -1;
        for (let i = 0; i < clean.length; i++) {
            const cl = clean[i];
            if (_hasAnyHindi(cl) || _isGarbled(cl)) continue;
            if (!/^[A-Za-z][A-Za-z .'-]{1,49}$/.test(cl)) continue;
            if (/\d/.test(cl)) continue;
            if (NAME_KEYWORDS.test(cl)) continue;
            if (_englishRatio(cl) < 0.9) continue;
            const score = (cl.length >= 4 && cl.length <= 30 ? 2 : 0) + (i < clean.length * 0.55 ? 1 : 0);
            if (score > bestScore) { bestScore = score; best = cl; }
        }
        if (best) res.nameEn = best;
    }

    /* --- DOB --- */
    m = flat.match(/DOB\s*[:：]?\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i) ||
        flat.match(/(?:जन्म\s*तिथि|जन्\s*म\s*तथ|Year\s+of\s+Birth)[^\d]{0,12}(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i);
    if (m) res.dob = m[1];

    /* --- Gender --- */
    if (/\bFEMALE\b/i.test(flat)) res.gender = 'FEMALE';
    else if (/\bMALE\b/i.test(flat)) res.gender = 'MALE';

    /* --- Aadhaar number (12 digits, 4-4-4) — prefer grouped form --- */
    m = flat.match(/\b(\d{4}\s\d{4}\s\d{4})\b/) || flat.match(/\b(\d{12})\b/);
    if (m) {
        const digits = m[1].replace(/\s/g, '');
        res.aadhaarNo = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
    }

    /* --- VID --- */
    m = flat.match(/VID\s*[:：]?\s*(\d{4}\s?\d{4}\s?\d{4}\s?\d{4})/i) ||
        flat.match(/\b(\d{4}\s\d{4}\s\d{4}\s\d{4})\b/);
    if (m) {
        const digits = m[1].replace(/\s/g, '');
        if (digits.length === 16) res.vid = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
    }

    /* --- Mobile / PIN --- */
    m = flat.match(/Mobile\s*[:：]?\s*(\d{10})/i); if (m) res.mobile = m[1];
    m = flat.match(/PIN\s*Code\s*[:：]?\s*(\d{6})/i); if (m) res.pin = m[1];

    /* --- Dates --- */
    m = flat.match(/Aadhaar\s*no\.?\s*issued\s*[:：]?\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i);
    if (m) res.issuedOn = m[1];
    m = flat.match(/Details\s*as\s*on\s*[:：]?\s*(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/i);
    if (m) res.detailsAsOn = m[1];
    m = flat.match(/Date\s*[:：]\s*([\d.]+\s+[\d:]+)/i);
    if (m) res.generatedOn = m[1].trim();

    /* --- Merge English address components ---
       Parse per labelled line to avoid substring bugs
       ("PO:" inside "Post", "District:" inside "Sub District"). */
    const engAddr = extractEnglishAddress(clean);
    if (engAddr.length) {
        res.addressEn = engAddr.join(' ').replace(/\s{2,}/g, ' ').trim();
        res.addressEnLines = engAddr;

        const strip = s => s.replace(/[,\s]+$/, '').trim();
        m = engAddr[0].match(/^(W\/O|S\/O|D\/O|C\/O)\s*[-:]?\s*(.+)$/i);
        if (m) res.relation = m[1].toUpperCase() + ': ' + strip(m[2]);

        for (const line of engAddr) {
            let mm;
            if ((mm = line.match(/^(?:Sub\s+District|SubDistrict)\s*[:：]\s*(.+)$/i))) res.subDistrict = strip(mm[1]);
            else if ((mm = line.match(/^District\s*[:：]\s*(.+)$/i))) res.district = strip(mm[1]);
            if ((mm = line.match(/^VTC\s*[:：]\s*(.+)$/i))) res.vtc = strip(mm[1]);
            if ((mm = line.match(/^PO\s*[:：]\s*(.+)$/i))) res.postOffice = strip(mm[1]);
            else if ((mm = line.match(/^Post\s+(.+)$/i))) res.postOffice = strip(mm[1]);
            if ((mm = line.match(/^State\s*[:：]\s*(.+)$/i))) res.state = strip(mm[1]);
            if ((mm = line.match(/^PIN\s*Code\s*[:：]\s*(\d{6})/i))) res.pin = mm[1];
        }
        if (!res.state) { m = res.addressEn.match(/(Uttar Pradesh|Bihar|Maharashtra|Rajasthan|Delhi|Punjab|Haryana|Gujarat|Madhya Pradesh|Karnataka|Tamil Nadu|Kerala|Andhra Pradesh|Telangana|Odisha|West Bengal|Jharkhand|Chhattisgarh|Assam)/i); if (m) res.state = m[1]; }
    }

    /* --- Hindi address --- */
    const hiAddr = extractHindiAddress(clean, res.nameHi);
    if (hiAddr.length) {
        res.addressHi = normalizeHindi(hiAddr.join('\n'));
        res.addressHiLines = hiAddr.map(normalizeHindi);
    }

    return res;
}

/* ------------------------------------------------------------------ */
/* PDF READING                                                        */
/* ------------------------------------------------------------------ */
async function extractOne(filePath) {
    const data = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await pdfjsLib.getDocument({
        data,
        verbosity: 0,
        useSystemFonts: false,
        disableFontFace: true,
        standardFontDataUrl: path.join(__dirname, 'node_modules/pdfjs-dist/standard_fonts/')
    }).promise;

    const allLines = [];
    const pages = Math.min(pdf.numPages, 3);
    for (let p = 1; p <= pages; p++) {
        const page = await pdf.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const items = [];
        for (const it of tc.items) {
            const s = it.str == null ? '' : String(it.str);
            const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
            const th = Math.abs(it.height) || Math.hypot(it.transform[2], it.transform[3]) || 10;
            const tw = Math.abs(it.width) || Math.abs(it.transform[0]) || Math.max(1, s.length) * 4;
            items.push({ s, x: tx[4], y: tx[5] - th, w: tw, h: th });
        }
        allLines.push(...itemsToLines(items, vp.width));
    }

    const rec = parseAadhaar(allLines);
    rec.file = path.basename(filePath);
    rec.pages = pdf.numPages;
    rec.rawLines = allLines;
    return rec;
}

/* ------------------------------------------------------------------ */
/* OUTPUT                                                             */
/* ------------------------------------------------------------------ */
function toCSV(records) {
    const cols = [
        'file', 'enrolmentNo', 'nameHi', 'nameEn', 'dob', 'gender',
        'aadhaarNo', 'vid', 'mobile', 'pin', 'relation', 'vtc', 'postOffice',
        'subDistrict', 'district', 'state', 'addressEn', 'addressHi',
        'issuedOn', 'detailsAsOn', 'generatedOn'
    ];
    const esc = v => {
        if (v == null) return '';
        const s = String(v).replace(/"/g, '""').replace(/\r?\n/g, ' | ');
        return /[",\n]/.test(s) ? '"' + s + '"' : s;
    };
    const head = cols.join(',');
    const rows = records.map(r => cols.map(c => esc(r[c])).join(','));
    return [head, ...rows].join('\n') + '\n';
}

function printRecord(r) {
    const W = 14;
    const row = (k, v) => console.log('  ' + (k + ':').padEnd(W) + (v == null || v === '' ? '—' : v));
    console.log('\n' + '='.repeat(70));
    console.log('FILE: ' + r.file + '   (' + r.pages + ' page' + (r.pages > 1 ? 's' : '') + ')');
    console.log('='.repeat(70));
    row('Enrolment', r.enrolmentNo);
    row('Name (Hindi)', r.nameHi);
    row('Name (English)', r.nameEn);
    row('DOB', r.dob);
    row('Gender', r.gender);
    row('Aadhaar No', r.aadhaarNo);
    row('VID', r.vid);
    row('Mobile', r.mobile);
    row('PIN', r.pin);
    row('Relation', r.relation);
    row('Post Office', r.postOffice);
    row('District', r.district);
    row('State', r.state);
    row('English Addr', r.addressEn);
    row('Hindi Addr', (r.addressHi || '').replace(/\n/g, ' / '));
    row('Issued On', r.issuedOn);
    row('Details as on', r.detailsAsOn);
    row('Generated', r.generatedOn);
}

/* ------------------------------------------------------------------ */
/* MAIN                                                               */
/* ------------------------------------------------------------------ */
(async function main() {
    const args = process.argv.slice(2);
    let files = args.length ? args : DEFAULT_PDFS;

    files = files.map(f => (path.isAbsolute(f) ? f : path.join(__dirname, f)));
    const found = files.filter(f => fs.existsSync(f));

    if (!found.length) {
        console.log('No PDF files found. Pass filenames or place PDFs next to this script.');
        process.exit(1);
    }

    const records = [];
    for (const f of found) {
        try {
            const rec = await extractOne(f);
            records.push(rec);
            printRecord(rec);
        } catch (e) {
            console.log('\n[ERROR] ' + path.basename(f) + ': ' + e.message);
        }
    }

    const outDir = path.join(__dirname, 'extracted');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const jsonPath = path.join(outDir, 'aadhaar_structured.json');
    const csvPath = path.join(outDir, 'aadhaar_structured.csv');
    fs.writeFileSync(jsonPath, JSON.stringify(records, null, 2), 'utf8');
    fs.writeFileSync(csvPath, toCSV(records), 'utf8');

    console.log('\n' + '='.repeat(70));
    console.log('DONE — ' + records.length + ' record(s) extracted');
    console.log('  JSON : ' + jsonPath);
    console.log('  CSV  : ' + csvPath);
    console.log('='.repeat(70));
})();
