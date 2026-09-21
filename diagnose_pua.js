const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs = require('fs');

async function diagnose(filePath) {
    const ab = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    const page = await pdf.getPage(1);
    const scale = 2;
    const vp = page.getViewport({ scale });
    const tc = await page.getTextContent();
    const pageItems = [];
    tc.items.forEach(function (it) {
        const s = (it.str == null ? '' : String(it.str));
        const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
        const th = Math.abs(it.height) || Math.hypot(it.transform[2], it.transform[3]) || 10;
        const tw = Math.abs(it.width) || Math.abs(it.transform[0]) || Math.max(1, s.length) * 4;
        pageItems.push({ s: s, x: tx[4], y: tx[5] - th, w: tw, h: th });
    });

    /* Band manually for y ~ 340-420 area where names should be */
    const sorted = pageItems.slice().sort((a,b) => Math.abs(a.y-b.y)<=3 ? a.x-b.x : a.y-b.y);
    /* Print every item with its Y coord and hex dump of s */
    let lastY = null;
    for (const it of sorted) {
        if (lastY !== null && Math.abs(it.y - lastY) > 6) console.log('');
        lastY = it.y;
        const hex = [...it.s].map(c => c.charCodeAt(0).toString(16).padStart(4,'0')).join(' ');
        const puacount = [...it.s].filter(c => {
            const cp = c.charCodeAt(0);
            return (cp>=0xE000 && cp<=0xF8FF) || (cp>=0xF0000 && cp<=0xFFFFF);
        }).length;
        const boxcount = [...it.s].filter(c => {
            const cp = c.charCodeAt(0);
            return cp===0xFFFD || (cp>=0x25A0 && cp<=0x25FF) || (cp>=0x2580 && cp<=0x259F);
        }).length;
        console.log(`y=${it.y.toFixed(0).padStart(4)} x=${it.x.toFixed(0).padStart(4)} s=[${it.s.padEnd(10)}] pua=${puacount} box=${boxcount} hex=[${hex}]`);
    }
}
diagnose(process.argv[2] || '/Users/singsys/Downloads/aadhar design/210164384605.pdf');
