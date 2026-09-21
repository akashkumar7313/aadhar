const pdfjsLib = require('pdfjs-dist');
pdfjsLib.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/build/pdf.worker.entry');
const fs = require('fs');
const path = require('path');

const pdfs = [
  '210164384605.pdf',
  '212576167624.pdf',
  '215270342984.pdf',
  '215756525476.pdf',
  '216160700256.pdf'
];

/* ====== COPY-PASTED HELPERS + parseOCR from index.html ====== */
function _cleanLine(t) {
  return (t || '').replace(/[\uFFFD\u25A0-\u25FF\u2580-\u259F\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+/g, ' ').trim();
}
function _hasValidHindi(t) { return (t.match(/[\u0900-\u097F]/g) || []).length >= 2; }
function _isGarbled(t) {
  var clean = t.replace(/\s/g, '');
  if (!clean.length) return true;
  var bad = (clean.match(/[\uFFFD\u25A0-\u25FF\u2580-\u259F□■◻◼▪▫]/g) || []).length;
  return bad / clean.length > 0.3;
}
function _hindiRatio(t) {
  var total = (t.match(/\S/g) || []).length;
  if (!total) return 0;
  var hi = (t.match(/[\u0900-\u097F]/g) || []).length;
  return hi / total;
}
function _englishRatio(t) {
  var total = (t.match(/\S/g) || []).length;
  if (!total) return 0;
  var en = (t.match(/[A-Za-z]/g) || []).length;
  return en / total;
}
function _hasAnyHindi(t) { return /[\u0900-\u097F]/.test(t || ''); }

function extractIdNumbers(fullText, state) {
  if (!fullText) return;
  var aP = [
    /\b(\d{4}\s\d{4}\s\d{4})\b/,
    /\b(\d{4}\s?\d{4}\s?\d{4})\b/,
    /\b(\d{12})\b/,
    /(\d{4}[\s\-]\d{4}[\s\-]\d{4})/
  ];
  var ai, m;
  for (ai = 0; ai < aP.length; ai++) {
    m = fullText.match(aP[ai]);
    if (m) {
      var an = m[1].replace(/[\s\-]/g, '');
      if (an.length === 12) { state.aadhaarNo = an.replace(/(\d{4})(?=\d)/g, '$1 '); break; }
    }
  }
  var vP = [
    /\b(\d{4}\s\d{4}\s\d{4}\s\d{4})\b/,
    /\b(\d{16})\b/,
    /(\d{4}[\s\-]\d{4}[\s\-]\d{4}[\s\-]\d{4})/
  ];
  for (ai = 0; ai < vP.length; ai++) {
    m = fullText.match(vP[ai]);
    if (m) {
      var vn = m[1].replace(/[\s\-]/g, '');
      if (vn.length === 16) { state.vidNo = vn.replace(/(\d{4})(?=\d)/g, '$1 '); break; }
    }
  }
}

function parseOCR(text, state) {
  state = state || {};
  if (!text) return state;

  var lines = text.split(/[\n\r]+|[|]+/).map(function (l) { return l.trim(); }).filter(Boolean);
  var fullText = lines.join(' ');
  if (lines.length <= 2 && fullText.length > 60) {
    lines = text.split(/\s{2,}|\s(?=W\/O|S\/O|D\/O|C\/O|Address|पता)/i).map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 2; });
    if (lines.length > 2) fullText = lines.join(' ');
  }

  /* ---- DOB (pahle nikalo — DOB se pehle waali line name hone ki high chance hai) ---- */
  var dobIdx = -1;
  var dobM = fullText.match(/(?:DOB|जन्म\s*तिथि|Year\s+of\s+Birth)[^0-9]*(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
  if (dobM) {
    state.dob = 'जन्म तिथि / DOB: ' + dobM[1];
    for (var di2 = 0; di2 < lines.length; di2++) {
      if (lines[di2].indexOf(dobM[1]) > -1 || /जन्म\s*तिथि|DOB/i.test(lines[di2])) {
        dobIdx = di2; break;
      }
    }
  } else {
    var allDates = fullText.match(/\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}/g) || [];
    for (var di = 0; di < allDates.length; di++) {
      var before = fullText.split(allDates[di])[0].slice(-35);
      if (!/issued|details|as on/i.test(before)) {
        state.dob = 'जन्म तिथि / DOB: ' + allDates[di];
        for (var di3 = 0; di3 < lines.length; di3++) {
          if (lines[di3].indexOf(allDates[di]) > -1 && !/issued|details|as on/i.test(lines[di3])) {
            dobIdx = di3; break;
          }
        }
        break;
      }
    }
  }

  /* ---- Name (Hindi) — DOB se 2-3 lines pehle, ya first valid Hindi name line ---- */
  var nameHi = null;
  var nameHiScore = -1;

  function isHindiNameLine(L) {
    L = _cleanLine(L);
    if (!_hasValidHindi(L) || _isGarbled(L)) return false;
    if (L.length < 2 || L.length > 50) return false;
    if (/पता|पत्ता|address|\bDOB\b|male|female|पुरुष|महिला|जन्म|issued|details|ग्राम|पोस्ट|जिला|नगर|राज्य|प्रदेश|मोहल्ला|मकान|वार्ड|post|dist|pin|सरकार|भारत|government|india|W\/O|S\/O|D\/O|C\/O|अर्धांगिनी|पत्नी|पुत्र|पुत्री/i.test(L)) return false;
    if (/\d{4}/.test(L)) return false;
    var hr = _hindiRatio(L);
    if (hr < 0.55) return false;
    var er = _englishRatio(L);
    if (er > 0.25) return false;
    return true;
  }

  for (var ni = 0; ni < lines.length; ni++) {
    var L = _cleanLine(lines[ni]);
    if (!isHindiNameLine(L)) continue;
    var score = 0;
    if (dobIdx > -1 && ni < dobIdx && ni >= dobIdx - 3) score += 10;
    else if (dobIdx > -1 && ni < dobIdx) score += 5;
    if (ni < Math.min(lines.length, Math.floor(lines.length * 0.5))) score += 3;
    if (L.length >= 5 && L.length <= 30) score += 2;
    if (score > nameHiScore) { nameHiScore = score; nameHi = L; }
  }
  if (nameHi) state.nameHi = nameHi;

  /* ---- Name (English) — DOB ke paas, ya first pure English non-address line ---- */
  var nameEn = null;
  var nameEnScore = -1;
  var nameHiIdx = -1;
  if (nameHi) { for (var nhi = 0; nhi < lines.length; nhi++) { if (_cleanLine(lines[nhi]) === nameHi) { nameHiIdx = nhi; break; } } }

  function isEnglishNameLine(LE) {
    LE = _cleanLine(LE);
    if (_isGarbled(LE)) return false;
    if (_hasAnyHindi(LE)) return false;
    if (LE.length < 2 || LE.length > 50) return false;
    if (/ \d/.test(LE)) return false;
    if (!/^[A-Za-z][A-Za-z .'-]{1,49}$/.test(LE)) return false;
    if (/address|gram|post|dist|male|female|dob|issued|details|uttar|pradesh|bihar|maharashtra|rajasthan|delhi|punjab|village|w\/o|s\/o|d\/o|c\/o|government|india|unique|pin|code|city|state/i.test(LE)) return false;
    if (/^(DOB|DOB:|VID|VID:|AADHAAR|UID|UIDAI)$/i.test(LE)) return false;
    var er = _englishRatio(LE);
    if (er < 0.8) return false;
    return true;
  }

  for (var ei = 0; ei < lines.length; ei++) {
    var LE = _cleanLine(lines[ei]);
    if (!isEnglishNameLine(LE)) continue;
    var escore = 0;
    if (nameHiIdx > -1 && ei >= nameHiIdx && ei <= nameHiIdx + 3) escore += 15;
    else if (nameHiIdx > -1 && Math.abs(ei - nameHiIdx) <= 5) escore += 8;
    if (dobIdx > -1 && ei < dobIdx && ei >= dobIdx - 4) escore += 10;
    else if (dobIdx > -1 && ei < dobIdx) escore += 5;
    if (ei < Math.min(lines.length, Math.floor(lines.length * 0.55))) escore += 3;
    if (LE.length >= 6 && LE.length <= 35) escore += 2;
    if (escore > nameEnScore) { nameEnScore = escore; nameEn = LE; }
  }
  if (nameEn) state.nameEn = nameEn;

  /* ---- Gender ---- */
  if (/\bFEMALE\b/i.test(fullText)) state.gender = 'महिला / FEMALE';
  else if (/\bMALE\b/i.test(fullText)) state.gender = 'पुरुष / MALE';

  /* ---- Hindi Address — sirf lines jisme Devanagari ratio >= 0.45, English ratio <= 0.35 ---- */
  var hindiAddr = lines.filter(function (l) {
    var cl = _cleanLine(l);
    if (!_hasValidHindi(cl) || _isGarbled(cl)) return false;
    if (cl.length <= 5) return false;
    if (/\bDOB\b/i.test(cl)) return false;
    var hr = _hindiRatio(cl);
    var er = _englishRatio(cl);
    if (hr < 0.45) return false;
    if (er > 0.35) return false;
    return (cl.indexOf(',') > -1 || cl.indexOf('-') > -1 || /\d{6}/.test(cl) ||
      /ग्राम|पोस्ट|जिला|नगर|राज्य|प्रदेश|मोहल्ला|मकान|वार्ड|पता|अर्धांगिनी|पत्नी|पुत्र|पुत्री|पोस्ट|डाकघर/.test(cl));
  }).map(_cleanLine);
  if (!hindiAddr.length && _hasValidHindi(fullText)) {
    var fullHi = fullText.split(/\n|\. /).filter(function (seg) {
      return _hindiRatio(seg) >= 0.45 && _englishRatio(seg) <= 0.35;
    }).map(_cleanLine);
    if (fullHi.length) hindiAddr = fullHi.slice(0, 3);
    else hindiAddr = [_cleanLine(fullText)];
  }
  if (hindiAddr.length > 0) state.addressHi = 'पता:\n' + hindiAddr.join('\n');

  /* ---- English Address — ek bhi Devanagari char nahi chahiye ---- */
  var engAddr = lines.filter(function (l) {
    var cl = _cleanLine(l);
    if (_hasAnyHindi(cl)) return false;
    if (cl.length <= 5) return false;
    if (/^\d{4}\s?\d{4}/.test(cl)) return false;
    if (_isGarbled(cl)) return false;
    return /(W\/O|S\/O|D\/O|C\/O|Gram|Post|DIST|Village|City|State|Pin|Code|Uttar|Pradesh|Bihar|Maharashtra|Rajasthan|Delhi|Punjab|Haryana|Gujarat|Madhya|Karnataka|Tamil|Kerala|Andhra|Telangana|Odisha|West|Bengal|Jharkhand|Chhattisgarh|Assam|\d{6})/i.test(cl);
  }).map(_cleanLine);
  if (engAddr.length > 0) state.addressEn = 'Address:\n' + engAddr.join('\n');

  extractIdNumbers(fullText, state);
  return state;
}

/* ====== MAIN: simulate CARD REGION (bottom portion ~ y from 1100 to 1500) ====== */
(async () => {
  for (const pdfName of pdfs) {
    const pdfPath = path.join(__dirname, pdfName);
    if (!fs.existsSync(pdfPath)) { console.log(`\n=== ${pdfName}: MISSING ===\n`); continue; }
    console.log(`\n==================== ${pdfName} ====================`);
    try {
      const data = new Uint8Array(fs.readFileSync(pdfPath));
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      for (let i = 1; i <= Math.min(1, pdf.numPages); i++) {
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 2 });
        const tc = await page.getTextContent();
        const pageItems = [];
        let lastY = null;
        const pageLines = [];
        tc.items.forEach(function (it) {
          const s = (it.str == null ? '' : String(it.str));
          const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
          const th = Math.abs(it.height) || Math.hypot(it.transform[2], it.transform[3]) || 10;
          const tw = Math.abs(it.width) || Math.abs(it.transform[0]) || Math.max(1, s.length) * 4;
          const yTop = tx[5] - th;
          pageItems.push({ s: s, x: tx[4], y: yTop, w: tw, h: th });
          if (lastY !== null && Math.abs((it.transform[5] || 0) - lastY) > 3) pageLines.push('\n');
          pageLines.push(s);
          lastY = it.transform[5] || 0;
        });

        /* simulate crop to CARD AREA: user crops the "niche ke hisse" = lower card portion
           approx y range [1100, 1500] for scale=2 */
        const CROP_Y_MIN = 1100;
        const CROP_Y_MAX = 1500;
        const picked = pageItems.filter(it =>
          it.y + it.h >= CROP_Y_MIN && it.y <= CROP_Y_MAX
        );
        picked.sort((a, b) => a.y - b.y || a.x - b.x);
        const out = []; let lastLy = null;
        for (const p of picked) {
          if (lastLy !== null && Math.abs(p.y - lastLy) > 4) out.push('\n');
          out.push(p.s);
          lastLy = p.y;
        }
        const croppedText = out.join('').split('\n').map(ln =>
          ln.replace(/[ \t]+/g, ' ').replace(/^ | $/g, '')
        ).filter(Boolean).join('\n').trim();

        console.log('--- RAW CROPPED TEXT (card area) ---');
        console.log(croppedText);
        console.log('-----------------------------------');

        const st = {};
        parseOCR(croppedText, st);
        console.log('nameHi    :', JSON.stringify(st.nameHi));
        console.log('nameEn    :', JSON.stringify(st.nameEn));
        console.log('dob       :', JSON.stringify(st.dob));
        console.log('gender    :', JSON.stringify(st.gender));
        console.log('aadhaarNo :', JSON.stringify(st.aadhaarNo));
        console.log('vidNo     :', JSON.stringify(st.vidNo));
        console.log('addressHi :', JSON.stringify(st.addressHi));
        console.log('addressEn :', JSON.stringify(st.addressEn));
      }
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  }
})();
