/* Mimic _cleanLine, _isGarbled, _hasValidHindi from index.html */
function _cleanLine(t) {
    return (t || '').replace(/[\uFFFD\u25A0-\u25FF\u2580-\u259F\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/\s+/g, ' ').trim();
}
function _hasValidHindi(t) { return (t.match(/[\u0900-\u097F]/g) || []).length >= 2; }
function _isGarbled(t) { var c=t.replace(/\s/g,''); if(!c.length) return true; var p=(c.match(/[\uDB80-\uDBBF][\uDC00-\uDFFF]/g)||[]).length; var b=(c.match(/[\uFFFD\u25A0-\u25FF\u2580-\u259F\uE000-\uF8FF]/g)||[]).length; return (b+p)/c.length>0.3; }
function _hindiRatio(t) { var to=(t.match(/\S/g)||[]).length; if(!to) return 0; var h=(t.match(/[\u0900-\u097F]/g)||[]).length; return h/to; }
function _englishRatio(t) { var to=(t.match(/\S/g)||[]).length; if(!to) return 0; var e=(t.match(/[A-Za-z]/g)||[]).length; return e/to; }
function _hasAnyHindi(t) { return /[\u0900-\u097F]/.test(t||''); }

/* Copy of isHindiNameLine EXACT REPLICA from fixed index.html parseOCR */
function isHindiNameLine(L) {
    L = _cleanLine(L);
    if (!_hasValidHindi(L) || _isGarbled(L)) return false;
    if (L.length < 2 || L.length > 50) return false;
    if (/पता|पत्ता|address|\bDOB\b|male|female|पुरुष|महिला|लिंग|जन्म|नाम|नंबर|आधार|मेरा|पहचान|पहचान|सरकार|भारत|सत्यापित|असत्यापित|हस्ताक्षर|हस्ताक्षरित|यूनिक|ईकाई|प्राधिकरण|आवेदन|नामांकन|अंकित|वितरित|डाउनलोड|issued|details|ग्राम|पोस्ट|जिला|नगर|राज्य|प्रदेश|मोहल्ला|मकान|वार्ड|post|dist|pin|government|india|unique|authority|identification|downloaded|enrolment|W\/O|S\/O|D\/O|C\/O|अर्धांगिनी|पत्नी|पुत्र|पुत्री|डाकघर|विभाग|स्थान|निवास|^To$|^नमस्ते$/i.test(L)) return false;
    if (/\d{4}/.test(L)) return false;
    var hr = _hindiRatio(L);
    if (hr < 0.55) return false;
    var er = _englishRatio(L);
    if (er > 0.25) return false;
    return true;
}

/* Test cases */
const tests = [
    ['(user example WRONG) "मेरा आधार मेरी पहचान" - OFFICIAL TAGLINE - SHOULD REJECT', 'मेरा आधार मेरी पहचान', false],
    ['(user example WRONG) "आधार पहचान का प्रमाण है, नागरिकता या जन्मतिथि का नहीं" - FOOTER DISCLAIMER - SHOULD REJECT', 'आधार पहचान का प्रमाण है, नागरिकता या जन्मतिथि का नहीं', false],
    ['(REAL NAME from PDF) रमेश कुमार - SHOULD ACCEPT', 'रमेश कुमार', true],
    ['(REAL NAME from PDF) सीता देवी - SHOULD ACCEPT', 'सीता देवी', true],
    ['(REAL NAME) आशीष कुमार - SHOULD ACCEPT', 'आशीष कुमार', true],
    ['(REAL NAME) गौरी देवी - SHOULD ACCEPT', 'गौरी देवी', true],
    ['(LEAK NAME INTO ADDR) हर आशीष कुमार iF i ; ig जिउती - has garbage Latin er>0.22 - Hindi addr REJECT', 'हर आशीष कुमार iF i ; ig जिउती, भटौली रोड, पोस्ट संदवा, मीर्ज़ापुर, A PARC', false],
    ['(DISCLAIMER) इसका उपयोग सत्यापन ऑनलाइन प्रमाणीकरण या क्यूआर कोड - REJECT', 'इसका उपयोग सत्यापन (ऑनलाइन प्रमाणीकरण, या क्यूआर कोड)', false],
    ['(REAL ADDR LINE) सु न्दर, ाम महेवा पो स्ट हरहरपुर बेदौली, मज़ापुर, मज़ापुर - ACCEPT addr', 'सु न्दर, ाम महेवा पो स्ट हरहरपुर बेदौली, मज़ापुर, मज़ापुर,', false], /* this test for name filter, addr filter is separate */
    ['(REAL ADDR LINE) एस/ओ - नन् द लाल, जउती, भटौली रोड, पो स्ट संदवा, मीज़ापुर, - ACCEPT addr not name', 'एस/ओ - नन् द लाल, जउती, भटौली रोड, पो स्ट संदवा, मीज़ापुर,', false], /* name filter should reject (contains comma keywords post) */
];

console.log('\n=============================================');
console.log('  isHindiNameLine FILTER VALIDATION TESTS');
console.log('=============================================\n');

let passed = 0, failed = 0;
for (const [desc, line, expected] of tests) {
    const actual = isHindiNameLine(line);
    const ok = actual === expected;
    if (ok) passed++; else failed++;
    console.log(`${ok ? '✅ PASS' : '❌ FAIL'}: ${desc}`);
    console.log(`       Line: "${line.substring(0,80)}"`);
    console.log(`       Expected=${expected} Actual=${actual}  hr=${(_hindiRatio(line)*100).toFixed(0)}% er=${(_englishRatio(line)*100).toFixed(0)}% garbled=${_isGarbled(line)}`);
    if (!ok) {
        // Show which regex clause excluded it if it was wrongly rejected, or why wrongly accepted
        if (!actual) {
            const excl = L => /पता|पत्ता|address|\bDOB\b|male|female|पुरुष|महिला|लिंग|जन्म|नाम|नंबर|आधार|मेरा|पहचान|पहचान|सरकार|भारत|सत्यापित|असत्यापित|हस्ताक्षर|हस्ताक्षरित|यूनिक|ईकाई|प्राधिकरण|आवेदन|नामांकन|अंकित|वितरित|डाउनलोड|issued|details|ग्राम|पोस्ट|जिला|नगर|राज्य|प्रदेश|मोहल्ला|मकान|वार्ड|post|dist|pin|government|india|unique|authority|identification|downloaded|enrolment|W\/O|S\/O|D\/O|C\/O|अर्धांगिनी|पत्नी|पुत्र|पुत्री|डाकघर|विभाग|स्थान|निवास|^To$|^नमस्ते$/i.test(L);
            console.log(`       exclude regex hit = ${excl(_cleanLine(line))}`);
        }
    }
    console.log('');
}
console.log(`\nTOTAL: ${passed} passed, ${failed} failed out of ${tests.length}\n`);

/* Also quick Hindi addr filter test: er <= 0.22 */
console.log('\n--- Hindi Address er <= 0.22 filter check ---');
const addrTestLines = [
    ['LEAKED junk-latin line', 'हर आशीष कुमार iF i ; ig जिउती, भटौली रोड, पोस्ट संदवा, मीर्ज़ापुर, A PARC'],
    ['REAL address line', 'सु न्दर, ाम महेवा पो स्ट हरहरपुर बेदौली, मज़ापुर, मज़ापुर,'],
    ['REAL addr 2', 'उत्त र प्रदेश - 231001'],
    ['REAL addr 3 (from user example)', 'एस/ओ - नन् द लाल, जउती, भटौली रोड, पो स्ट संदवा, मीज़ापुर,'],
    ['DOB line garbled from user OCR', 'H जन्म तिथि/008: 7/06/999 । जि उत्तर प्रदेश 25000 कह ER'],
];
for (const [name, line] of addrTestLines) {
    const cl = _cleanLine(line);
    const hr = _hindiRatio(cl);
    const er = _englishRatio(cl);
    // Hindi addr filter gates
    const hasHi = _hasValidHindi(cl) && !_isGarbled(cl);
    const dobHit = /\bDOB\b|जन्म|जन्मतिथि|जन्म\s*तिथि|पुरुष|महिला|लिंग/i.test(cl);
    const disclaimerHit = /(Mobile|Phone|Tel|Email|Signature|Digitally|Identification|Authority|Date\s*:|^IST$|Aadhaar|issued|VID|Enrolment|^To$|आधार|पहचान|प्रमाण|नागरिकता|सत्यापन|प्रमाणीकरण|उपयोग|क्यूआर|ऑफलाइन|ऑनलाइन|यूनिक|यूआईडीएआई)/i.test(cl);
    const inHr = hr >= 0.45;
    const inEr = er <= 0.22;
    const ok = hasHi && !dobHit && !disclaimerHit && inHr && inEr;
    console.log(`${ok ? '✅ PASS addr' : '❌ FAIL addr'} [${name}]: hr=${(hr*100).toFixed(0)}% er=${(er*100).toFixed(0)}% dobHit=${dobHit} disclaimerHit=${disclaimerHit} hasHi=${hasHi}`);
    console.log(`      Line = ${cl.substring(0,90)}`);
}

/* English address filter tests */
console.log('\n--- English Address Disclaimer/Fragment check ---');
const engTests = [
    ['FOOTER DISCLAIMER from user example', 'authentication, or scanning of QR code / offline XML).'],
    ['ADHAAR NUMBER FRAGMENT from user example', '2015 2161 6'],
    ['REAL ENGLISH addr line', 'S/O- NAND LAL, JIUTI, BHATAULI ROAD, POST SANDWA, Mirzapur, PO: Mirzapur, DIST: Mirzapur,'],
    ['REAL ENGLISH state line', 'Uttar Pradesh - 231001'],
    ['JUNK Latin line OCR garbage', 'H Uttar Pradesh - 2300 HZ eT SARI a'],
];
for (const [name, line] of engTests) {
    const cl = _cleanLine(line);
    const hasAnyHi = _hasAnyHindi(cl);
    const aadhaarFrag1 = /^\d{4}\s?\d{3,}/.test(cl);
    const onlyDigits = cl.replace(/\s|\-|\./g,'');
    const aadhaarFrag2 = (/^\d/.test(cl) && onlyDigits.length >= 8);
    const disclaimerHit = /(Mobile|Phone|Tel|Email|Signature|Digitally|Identification|Authority|Date\s*:|^IST$|Aadhaar|issued|VID|Enrolment|^To$|Details|authentication|scanning|QR\s*code|offline|XML|Disclaimer|Citizenship|Birth|Proof|Verification|UIDAI|Identity|Card|Republic|National|Electronics|Ministry|Technology|Government|India)/i.test(cl);
    const passedFilter = !hasAnyHi && !aadhaarFrag1 && !aadhaarFrag2 && !disclaimerHit;
    console.log(`${passedFilter ? '✅ KEEP (address)' : '❌ REJECTED (junk)'} [${name}]: aadFrag1=${aadhaarFrag1} aadFrag2=${aadhaarFrag2} disclaimer=${disclaimerHit} hasHi=${hasAnyHi}`);
    console.log(`      Line = ${cl.substring(0,90)}`);
}
