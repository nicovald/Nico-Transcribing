// Team setup: a studio hands editors a .env file with the API keys it pays for.
// Opened with Ctrl+Shift+T in the app. Values are stored like typed keys and never sent back.

// Common env names for each service's key.
const ENV_NAMES = {
  grok: ['XAI_API_KEY', 'GROK_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  deepgram: ['DEEPGRAM_API_KEY'],
  assemblyai: ['ASSEMBLYAI_API_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY', 'XI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
  typesafe: ['TYPESAFE_API_KEY'],
  github: ['GITHUB_TOKEN', 'GH_TOKEN'],
};
const SERVICE_NAMES = {
  grok: 'Grok (xAI)', openai: 'OpenAI', deepgram: 'Deepgram', assemblyai: 'AssemblyAI',
  elevenlabs: 'ElevenLabs', anthropic: 'Claude (Anthropic)', typesafe: 'TypeSafe (Jev)', github: 'App updates (GitHub)',
};
const byEnvName = new Map(Object.entries(ENV_NAMES).flatMap(([id, names]) => names.map((n) => [n, id])));

// KEY=value lines; blank lines, # comments, `export` prefixes and quotes are fine.
// Returns { keys: { grok: '…' }, services: ['Grok (xAI)'], ignored: ['SOME_OTHER_VAR'] }.
export function parseTeamEnv(text) {
  const keys = {};
  const ignored = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const name = m[1].toUpperCase();
    let value = m[2].trim();
    const quoted = value.match(/^(["'])(.*)\1$/);
    value = quoted ? quoted[2] : value.replace(/\s+#.*$/, '');
    const id = byEnvName.get(name);
    if (!id) ignored.push(m[1]);
    else if (value) keys[id] = value;
  }
  return { keys, services: Object.keys(keys).map((id) => SERVICE_NAMES[id]), ignored };
}

export const TEAM_ENV_NAMES = ENV_NAMES;
