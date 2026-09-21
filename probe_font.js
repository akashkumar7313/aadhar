const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '215270342984.pdf');

(async () => {
    const data = new Uint8Array(fs.readFileSync(file));
    const pdf = await pdfjsLib.getDocument({ data, verbosity: 0, disableFontFace: true }).promise;
    const page = await pdf.getPage(1);
    const tc = await page.getTextContent();

    console.log('--- STYLES ---');
    for (const k of Object.keys(tc.styles || {})) {
        console.log(k, JSON.stringify(tc.styles[k]));
    }

    // Try to fetch font objects
    const fontNames = new Set(tc.items.map(i => i.fontName));
    console.log('\n--- FONTS ---', [...fontNames]);
    for (const fn of fontNames) {
        try {
            const f = page.commonObjs.has(fn) ? page.commonObjs.get(fn) : null;
            if (!f) { console.log(fn, 'not in commonObjs'); continue; }
            console.log('\nFONT', fn, 'keys=', Object.keys(f));
            if (f.unicode) {
                const ent = Object.entries(f.unicode).slice(0, 60).map(([c, u]) =>
                    c + '=>u+' + Number(u).toString(16));
                console.log(' unicode sample:', ent.join(' '));
            }
            if (f.glyphMap) {
                const gm = Object.entries(f.glyphMap).slice(0, 60).map(([c, g]) => c + '=>' + g);
                console.log(' glyphMap:', gm.join(' '));
            }
        } catch (e) {
            console.log(fn, 'ERR', e.message);
        }
    }

    console.log('\n--- ALL DEVANAGARI/PUA ITEMS WITH COORDS ---');
    const vp = page.getViewport({ scale: 1 });
    const rows = [];
    tc.items.forEach(it => {
        const s = it.str == null ? '' : String(it.str);
        if (!s.trim()) return;
        const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
        rows.push({ x: tx[4], y: Math.round(tx[5]), s, fn: it.fontName });
    });
    rows.sort((a, b) => Math.abs(a.y - b.y) <= 3 ? a.x - b.x : a.y - b.y);
    let lastY = null;
    for (const r of rows) {
        if (lastY !== null && Math.abs(r.y - lastY) > 3) console.log('');
        lastY = r.y;
        const disp = [...r.s].map(c => {
            const cp = c.charCodeAt(0);
            return (cp >= 0xE000 && cp <= 0xF8FF) ? '«' + cp.toString(16) + '»' : c;
        }).join('');
        console.log(`  y=${r.y} x=${Math.round(r.x)} [${r.fn}] "${disp}"`);
    }
})();
