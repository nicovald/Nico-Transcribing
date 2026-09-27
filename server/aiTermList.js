// "Build with AI" for term lists: a ready-made prompt editors paste into whatever AI they use,
// and a forgiving parser for the answer they paste back. Shared by the UI (runs in the page).

export function buildTermListPrompt(game, notes = '') {
  const what = game.trim() || '[GAME OR MODPACK NAME]';
  return [
    `I'm building a term list for a subtitle app so that speech-to-text spells words from ${what} correctly in gameplay videos.`,
    notes.trim() ? `Extra context: ${notes.trim()}` : '',
    '',
    'Give me two lists:',
    '1. "terms": the 50 to 100 most important names that come up when people play and talk about it, and that speech-to-text is likely to mishear or misspell: items, blocks, creatures, enemies, bosses, characters, places, abilities, mechanics, mods, and slang players actually say. Most important first.',
    '2. "glossary": every specific name you reliably know from it (items, blocks, creatures, bosses, locations, abilities, mods, etc.), up to a few thousand.',
    '',
    'Rules:',
    '- Exact official spelling and capitalization, one name per entry.',
    '- No descriptions, no duplicates, and no names you are not sure exist.',
    '- If you can browse the web, use the official wiki or mod list, especially for modpacks and recent updates.',
    '',
    'Reply with only this JSON and nothing else:',
    `{"kind":"grok-transcriber-term-list","version":1,"name":"${what.replace(/"/g, "'")}","terms":["..."],"glossary":["..."]}`,
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n');
}

// Lists may arrive as arrays or text. Glossary names can contain commas ("Bucket of Salmon, Raw"),
// so glossary text only splits on new lines.
const clean = (list, split = /[\n,]/) => {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : String(list || '').split(split)) {
    const t = String(raw ?? '').trim();
    if (!t || t.length > 60 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
};

// Accepts the AI's reply as pasted: code fences, text around the JSON, lists or strings.
// Returns { name, terms, glossary } in the app's format, or throws a readable error.
export function parseTermListAnswer(text, fallbackName = '') {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  const cutOff = 'The answer was cut off or is not valid JSON. Ask the AI to "reply with only the JSON" (or to continue), then paste it again.';
  if (start < 0) throw new Error("That doesn't look like the AI's answer. Paste its whole reply, including the part in { }.");
  if (end <= start) throw new Error(cutOff);
  let data;
  try {
    data = JSON.parse(s.slice(start, end + 1));
  } catch {
    throw new Error(cutOff);
  }
  const terms = clean(data.terms);
  const glossary = clean(data.glossary, /\r?\n/);
  if (!terms.length && !glossary.length) throw new Error('The answer has no names in it. Try asking the AI again.');
  return {
    name: String(data.name || fallbackName || 'New list').trim().slice(0, 80),
    terms: terms.slice(0, 150).join(', '),
    glossary: [...new Set([...terms, ...glossary])].join('\n'),
  };
}
