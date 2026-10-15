// "Same words, different spelling" and "cut-off word" rules for comparing two transcripts.
// Two services rarely agree on kinda/kind of, yeah/yep or 3x2/three by two; those are not misheard words,
// so compareWords uses this layer to decide whether a difference is worth showing an editor.

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

// Short real words: a 1-2 letter token that is NOT in here is treated as a cut-off fragment ("sl", "h", "C").
const REAL_SHORT = new Set('a i am an as at be by do go he hi if in is it me my no of oh on or so to up us we yo ya ok'.split(' '));

// Sounds and backchannels that one service writes and the other drops.
export const FILLERS = new Set('um umm uh uhh uhm er erm ah eh oh hm hmm mm mhm uhhuh uhuh uhhuhh yep yup yeah like'.split(' '));

const WORD_MAP = {
  kinda: 'kind of', kindof: 'kind of', sorta: 'sort of', wanna: 'want to', gonna: 'going to', gotta: 'got to',
  hafta: 'have to', lemme: 'let me', gimme: 'give me', dunno: 'do not know', "i'ma": 'i am going to', ima: 'i am going to',
  outta: 'out of', lotta: 'lot of', cuz: 'because', cause: 'because', "'cause": 'because', cos: 'because',
  freaking: 'freaking', fricking: 'freaking', frickin: 'freaking', friggin: 'freaking', freakin: 'freaking',
  yep: 'yeah', yup: 'yeah', yes: 'yeah', ye: 'yeah', yea: 'yeah', yeh: 'yeah', yah: 'yeah',
  ok: 'okay', okey: 'okay', o: 'oh', alright: 'alright', cannot: 'can not',
  til: 'until', "'til": 'until', tho: 'though', thru: 'through',
};
const CONTRACTIONS = {
  "won't": 'will not', "can't": 'can not', "shan't": 'shall not', "ain't": 'is not', "let's": 'let us',
};
const IRREGULAR_BE = { "i'm": 'i am' };

const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

function expandContraction(w) {
  if (CONTRACTIONS[w]) return CONTRACTIONS[w].split(' ');
  if (IRREGULAR_BE[w]) return IRREGULAR_BE[w].split(' ');
  let m;
  if ((m = w.match(/^(.+)n't$/))) return [m[1], 'not'];
  if ((m = w.match(/^(.+)'(re|ve|ll|d)$/))) return [m[1], { re: 'are', ve: 'have', ll: 'will', d: 'would' }[m[2]]];
  if ((m = w.match(/^(.+)'s$/))) return [m[1], 'is']; // "what's" ~ "what is" (possessives also land here, harmlessly)
  return [w];
}

// Lowercased words with spelling variants, contractions and numbers reduced to one canonical form.
export function canonWords(text) {
  const raw = String(text ?? '').toLowerCase().replace(/[’‘]/g, "'")
    .replace(/(?<![\p{L}\p{N}])all right(?![\p{L}\p{N}])/gu, 'alright')
    .replace(/(\d)\s*[x×]\s*(\d)/g, '$1 by $2')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .split(/[^\p{L}\p{N}']+/u).map((t) => t.replace(/^'+|'+$/g, '')).filter(Boolean);
  const words = [];
  for (const t of raw) {
    if (WORD_MAP[t]) { words.push(...WORD_MAP[t].split(' ')); continue; }
    for (const piece of expandContraction(t)) words.push(...(WORD_MAP[piece] || piece).split(' '));
  }
  // Number words -> digits ("twenty five" -> "25"), so "three" and "3" agree.
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (TENS[w]) {
      const nxt = ONES.indexOf(words[i + 1]);
      if (nxt > 0 && nxt < 10) { out.push(String(TENS[w] + nxt)); i++; } else out.push(String(TENS[w]));
    } else if (ONES.includes(w)) out.push(String(ONES.indexOf(w)));
    else out.push(w);
  }
  return out;
}

export const sameWords = (a, b) => {
  const x = canonWords(a);
  return x.length > 0 && x.join(' ') === canonWords(b).join(' ');
};

// A word that stopped half way ("ki-", "sl") rather than a word.
export function isFragment(rawWord) {
  const t = String(rawWord ?? '').trim().replace(/^[^\p{L}\p{N}-]+|[^\p{L}\p{N}-]+$/gu, '');
  if (!t) return false;
  if (/[\p{L}\p{N}]-$/u.test(t)) return true;
  const n = norm(t);
  return n.length > 0 && n.length <= 2 && !REAL_SHORT.has(n) && !FILLERS.has(n);
}

const splitWords = (text) => String(text ?? '').split(/[\s,.;:!?"()…]+/u).filter(Boolean);

export const isFillerWord = (w) => FILLERS.has(norm(w));
export const isFillerText = (text) => { const ws = splitWords(text); return ws.length > 0 && ws.every(isFillerWord); };

// True when `to` is only the start of `from` ("chill" -> "ch"), ends in a dash, or is nothing but fragments.
export function isTruncation(from, to) {
  const ts = splitWords(to);
  if (!ts.length) return false;
  if (/-\s*$/.test(String(to).trim())) return true;
  if (ts.every(isFragment)) return true;
  const f = norm(from), t = norm(to);
  return ts.length === 1 && splitWords(from).length === 1 && t.length < f.length && f.startsWith(t) && (t.length <= 3 || t.length / f.length <= 0.6); // "Craner" -> "Crane" is a real spelling choice, "chill" -> "ch" is not
}

// Words that carry meaning: no fillers, no cut-off fragments.
export const realWords = (ws) => ws.filter((w) => !isFillerWord(typeof w === 'string' ? w : w.text) && !isFragment(typeof w === 'string' ? w : w.text));
