const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs = require('fs');
const path = require('path');

const files = [
    '210164384605.pdf',
    '212576167624.pdf',
    '215270342984.pdf',
    '215756525476.pdf',
    '216160700256.pdf'
];

function hex(s) {
    return [...s].map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join(' ');
}

(async () => {
    for (const f of files) {
        const p = path.join(__dirname, f);
        if (!fs.existsSync(p)) continue;
        const data = new Uint8Array(fs.readFileSync(p));
        const pdf = await pdfjsLib.getDocument({ data, verbosity: 0, disableFontFace: true }).promise;
        const page = await pdf.getPage(1);
        const tc = await page.getTextContent();
        console.log('\n==================== ' + f + ' ====================');
        for (const it of tc.items) {
            const s = it.str == null ? '' : String(it.str);
            if (!/[\u0900-\u097F\uE000-\uF8FF]/.test(s)) continue;
            console.log('  [' + it.fontName + '] "' + s + '"');
            console.log('        hex=' + hex(s));
        }
    }
})();
