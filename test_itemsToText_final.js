const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs = require('fs');
const path = require('path');

/* ===== itemsToText - exact copy from index.html ===== */
function itemsToText(items, vpWidth) {
    if (!items || !items.length) return '';
    var bands = [];
    var sorted = items.slice().sort(function (a, b) {
        var dy = a.y - b.y;
        if (Math.abs(dy) <= 3) return a.x - b.x;
        return dy;
    });
    for (var g = 0; g < sorted.length; g++) {
        var it = sorted[g];
        var placed = false;
        for (var bi = 0; bi < bands.length; bi++) {
            var brep = bands[bi][0];
            if (Math.abs(it.y - brep.y) <= 4) { bands[bi].push(it); placed = true; break; }
        }
        if (!placed) bands.push([it]);
    }
    var totalLines = [];
    var minColGap = Math.max(80, (vpWidth || 1200) * 0.06);
    for (var bi2 = 0; bi2 < bands.length; bi2++) {
        var band = bands[bi2];
        band.sort(function (a, b) { return a.x - b.x; });
        if (band.length >= 2) {
            var maxGap = 0, maxGapAt = -1, prevR = null;
            for (var xi = 0; xi < band.length; xi++) {
                var xit = band[xi];
                var xr = xit.x + Math.max(xit.w || 4, (xit.s || '').length * 4);
                if (prevR != null) {
                    var gg = xit.x - prevR;
                    if (gg > maxGap) { maxGap = gg; maxGapAt = xi; }
                }
                if (prevR == null || xr > prevR) prevR = xr;
            }
            if (maxGapAt > 0 && maxGap >= minColGap) {
                var leftChunk = '';
                for (var li = 0; li < maxGapAt; li++) leftChunk += (band[li].s || '');
                var rightChunk = '';
                for (var ri = maxGapAt; ri < band.length; ri++) rightChunk += (band[ri].s || '');
                totalLines.push(leftChunk);
                totalLines.push(rightChunk);
                continue;
            }
        }
        var single = '';
        for (var si = 0; si < band.length; si++) single += (band[si].s || '');
        totalLines.push(single);
    }
    return totalLines.map(function (ln) {
        return ln.replace(/[ \t\u00A0]+/g, ' ').replace(/^ | $/g, '');
    }).filter(function (ln) { return ln && ln.length > 0; }).join('\n');
}

/* ===== Ratio helpers ===== */
function _hindiRatio(t) { var total = (t.match(/\S/g) || []).length; if (!total) return 0; var hi = (t.match(/[\u0900-\u097F]/g) || []).length; return hi / total; }
function _englishRatio(t) { var total = (t.match(/\S/g) || []).length; if (!total) return 0; var en = (t.match(/[A-Za-z]/g) || []).length; return en / total; }
function _hasAnyHindi(t) { return /[\u0900-\u097F]/.test(t || ''); }
function _hasValidHindi(t) { return (t.match(/[\u0900-\u097F]/g) || []).length >= 2; }
function _isGarbled(t) { var c = (t || '').replace(/\s/g, ''); if (!c.length) return true; var puaSuppl = (c.match(/[\uDB80-\uDBBF][\uDC00-\uDFFF]/g) || []).length; var bmpBad = (c.match(/[\uFFFD\u25A0-\u25FF\u2580-\u259F\uE000-\uF8FF]/g) || []).length; return (bmpBad + puaSuppl) / c.length > 0.3; }
function _cleanLine(t) { return (t || '').replace(/[\uFFFD\u25A0-\u25FF\u2580-\u259F\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim(); }

/* ===== Simplified parseOCR (names + addresses) ===== */
function parseOCR(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l);
    console.log('\n--- EXTRACTED LINES (sorted by itemsToText 2-col split) ---');
    lines.forEach((l, i) => {
        const cl = _cleanLine(l);
        console.log(String(i + 1).padStart(3, ' ') + `: [hr${(_hindiRatio(cl) * 100).toFixed(0)}% er${(_englishRatio(cl) * 100).toFixed(0)}% ${_isGarbled(cl) ? 'GARBLED' : 'clean'}] ${cl.substring(0, 120)}`);
    });

    /* --- Name detection: find DOB line, then lines BEFORE it with names --- */
    let dobIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        const cl = _cleanLine(lines[i]);
        if (/जन्म|DOB|दिनांक|Birth|D\.?O\.?B/i.test(cl) && /\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/.test(cl)) { dobIdx = i; break; }
        if (/\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/.test(cl) && /(पुरुष|स्त्री|MALE|FEMALE)/i.test(cl)) { dobIdx = i; break; }
    }
    console.log('\nDOB index:', dobIdx);

    /* Search for Hindi Name: line with hr>=0.55, en<=0.2, no date/gender keywords */
    let nameHi = null, nameEn = null;
    const nameSearchEnd = dobIdx >= 0 ? dobIdx + 1 : lines.length;
    for (let i = 0; i < nameSearchEnd; i++) {
        const cl = _cleanLine(lines[i]);
        if (!cl || _isGarbled(cl) || cl.length < 4) continue;
        if (/(जन्म|तिथि|DOB|पुरुष|स्त्री|MALE|FEMALE|आधार|Aadhaar|issued|विकसित|UID|Mobile|Email)/i.test(cl)) continue;
        const hr = _hindiRatio(cl);
        const er = _englishRatio(cl);
        /* Hindi name line: mostly Devanagari, short (name-length not address) */
        if (!nameHi && hr >= 0.55 && er <= 0.20 && cl.length >= 4 && cl.length <= 60
            && !/ग्राम|पोस्ट|जिला|नगर|राज्य|प्रदेश|मोहल्ला|मकान|वार्ड|पता|अर्धांगिनी|पत्नी|पुत्र|पुत्री|डाकघर|,/.test(cl)) {
            nameHi = cl;
        }
        if (!nameEn && er >= 0.80 && hr === 0 && cl.length >= 4 && cl.length <= 60
            && !/W\/O|S\/O|D\/O|C\/O|Gram|Post|Dist|Village|City|State|Pin|Aadhaar|VID|issued/i.test(cl)
            && !/,\s*-?\s*\d/.test(cl)) {
            nameEn = cl;
        }
    }
    console.log('✓ Name (Hindi) :', nameHi || '(NOT FOUND)');
    console.log('✓ Name (English):', nameEn || '(NOT FOUND)');

    /* --- Hindi Address: hr>=0.45, en<=0.35 --- */
    const hindiAddr = lines.filter(l => {
        const cl = _cleanLine(l);
        if (!_hasValidHindi(cl) || _isGarbled(cl)) return false;
        if (cl.length <= 5) return false;
        const hr = _hindiRatio(cl);
        const er = _englishRatio(cl);
        if (hr < 0.45) return false;
        if (er > 0.35) return false;
        if (/(जन्म|तिथि|DOB|पुरुष|स्त्री|MALE|FEMALE|आधार)/i.test(cl)) return false;
        return (cl.includes(',') || cl.includes('-') || /\d{6}/.test(cl) ||
            /ग्राम|पोस्ट|जिला|नगर|राज्य|प्रदेश|मोहल्ला|मकान|वार्ड|पता|अर्धांगिनी|पत्नी|पुत्र|पुत्री|डाकघर|विभाग|स्थान|निवास/.test(cl));
    }).map(_cleanLine);
    console.log('\n✓ Hindi Address (पता) lines:\n   ', hindiAddr.length ? hindiAddr.join('\n    ') : '(NOT FOUND)');

    /* --- English Address: no Hindi chars at all --- */
    const engAddr = lines.filter(l => {
        const cl = _cleanLine(l);
        if (_hasAnyHindi(cl)) return false;
        if (_isGarbled(cl)) return false;
        if (/^\d{4}\s?\d{4}/.test(cl)) return false;
        if (cl.length <= 5) return false;
        if (/(DOB|जन्म|पुरुष|स्त्री|MALE|FEMALE|Aadhaar|VID|issued|Details)/i.test(cl)) return false;
        return /(W\/O|S\/O|D\/O|C\/O|Gram|Post|DIST|Village|City|State|Pin|Code|\d{6})/i.test(cl) ||
            (cl.includes(',') && _englishRatio(cl) >= 0.7);
    }).map(_cleanLine);
    console.log('\n✓ English Address lines:\n   ', engAddr.length ? engAddr.join('\n    ') : '(NOT FOUND)');

    /* DOB + Gender quick check */
    for (let i = 0; i < lines.length; i++) {
        const cl = _cleanLine(lines[i]);
        if (/\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/.test(cl)) {
            console.log('\n✓ DOB/Gender line:', cl.substring(0, 100));
            break;
        }
    }
}

async function processPDF(filePath) {
    console.log('\n' + '='.repeat(80));
    console.log('FILE:', path.basename(filePath));
    console.log('='.repeat(80));

    const ab = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    const numPages = Math.min(pdf.numPages, 2);
    let allText = '';

    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 2;
        const vp = page.getViewport({ scale });
        console.log('\n--- Page', i, '/ vp.width =', vp.width.toFixed(0), '---');
        const tc = await page.getTextContent();
        const pageItems = [];
        tc.items.forEach(function (it) {
            const s = (it.str == null ? '' : String(it.str));
            const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
            const th = Math.abs(it.height) || Math.hypot(it.transform[2], it.transform[3]) || 10;
            const tw = Math.abs(it.width) || Math.abs(it.transform[0]) || Math.max(1, s.length) * 4;
            pageItems.push({
                s: s,
                x: tx[4],
                y: tx[5] - th,
                w: tw,
                h: th
            });
        });
        const pageText = itemsToText(pageItems, vp.width);
        allText += pageText + '\n';
    }
    parseOCR(allText);
}

(async function main() {
    const files = [
        '/Users/singsys/Downloads/aadhar design/210164384605.pdf',
        '/Users/singsys/Downloads/aadhar design/212576167624.pdf',
        '/Users/singsys/Downloads/aadhar design/215270342984.pdf',
        '/Users/singsys/Downloads/aadhar design/215756525476.pdf',
        '/Users/singsys/Downloads/aadhar design/216160700256.pdf'
    ];
    for (const f of files) {
        if (fs.existsSync(f)) {
            try { await processPDF(f); }
            catch (e) { console.log('ERROR', path.basename(f), e.message); }
        } else { console.log('FILE NOT FOUND:', f); }
    }
})();
