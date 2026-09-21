const t = 'रमेश कुमार';
function _isGarbled_orig(t) {
    var clean = t.replace(/\s/g, '');
    console.log('t=', JSON.stringify(t), 'clean=', JSON.stringify(clean), 'len=', clean.length);
    if (!clean.length) return true;
    var bad_arr = clean.match(/[\uFFFD\u25A0-\u25FF\u2580-\u259F□■◻◼▪▫\uE000-\uF8FF\uF0000-\uFFFFF]/g);
    var bad = (bad_arr || []).length;
    console.log('bad=', bad, 'ratio=', bad/clean.length);
    return bad/clean.length > 0.3;
}
console.log('orig garbled?', _isGarbled_orig(t));

// Now on the actual full test with the t2 string with nulls
const t2 = '\u0000र\u0000मे\u0000श कु\u0000मार';
console.log('\nt2 with nulls:', JSON.stringify(t2));
console.log('t2 garbled orig?', _isGarbled_orig(t2));
// Ratio check:
