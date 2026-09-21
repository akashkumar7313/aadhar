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

(async () => {
    for (const pdfName of pdfs) {
        const pdfPath = path.join(__dirname, pdfName);
        if (!fs.existsSync(pdfPath)) { console.log(`\n=== ${pdfName}: MISSING ===\n`); continue; }
        console.log(`\n==================== ${pdfName} ====================`);
        try {
            const data = new Uint8Array(fs.readFileSync(pdfPath));
            const pdf = await pdfjsLib.getDocument({ data }).promise;
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const vp = page.getViewport({ scale: 2 });
                const tc = await page.getTextContent();
                console.log(`\n--- Page ${i} (direct text) ---`);
                tc.items.forEach(it => {
                    const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
                    console.log(`[x=${Math.round(tx[4])}, y=${Math.round(tx[5])}] "${it.str}"`);
                });
            }
        } catch (e) {
            console.log('ERROR:', e.message);
        }
    }
})();
