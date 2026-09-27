import { useEffect, useRef, useState } from 'react';
import { buildTermListPrompt, parseTermListAnswer } from '../../server/aiTermList.js';
import { Icon } from './shared.jsx';

// Build a term list with any AI: copy a ready-made prompt, paste the answer back.
export default function AiTermListDialog({ onClose, onCreate }) {
  const dialog = useRef();
  const promptBox = useRef();
  const [game, setGame] = useState('');
  const [notes, setNotes] = useState('');
  const [answer, setAnswer] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { dialog.current.showModal(); }, []);
  const prompt = buildTermListPrompt(game, notes);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      promptBox.current.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const create = () => {
    setError(null);
    try {
      onCreate(parseTermListAnswer(answer, game));
      onClose();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <dialog ref={dialog} className="export-dialog ai-dialog" aria-labelledby="ai-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="stack">
        <div>
          <h2 id="ai-title">Build a term list with AI</h2>
          <p className="muted">Works with ChatGPT, Claude, Grok or any other AI. One that can search the web does best with modpacks and new updates.</p>
        </div>

        <div className="ai-step">
          <span className="step-num">1</span>
          <div className="stack-tight grow">
            <div className="grid-2">
              <label>Game or modpack<input autoFocus value={game} placeholder="ATM10 To The Sky" onChange={(e) => setGame(e.target.value)} /></label>
              <label>Anything else? (optional)<input value={notes} placeholder="Minecraft 1.21 modpack, lots of Create and Mekanism" onChange={(e) => setNotes(e.target.value)} /></label>
            </div>
            <textarea ref={promptBox} className="ai-prompt" readOnly rows={6} value={prompt} aria-label="Prompt to copy" onFocus={(e) => e.target.select()} />
            <div className="row">
              <button type="button" className="soft" disabled={!game.trim()} onClick={copy}><Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy prompt'}</button>
              <span className="muted small">Paste it into your AI and send.</span>
            </div>
          </div>
        </div>

        <div className="ai-step">
          <span className="step-num">2</span>
          <label className="grow">
            Paste the AI's answer
            <textarea rows={5} value={answer} placeholder={'{"kind":"grok-transcriber-term-list", ... }'} onChange={(e) => { setAnswer(e.target.value); setError(null); }} />
          </label>
        </div>

        {error && <div className="error" role="alert">{error}</div>}
        <div className="row">
          <span className="grow muted small">You can edit the list afterwards like any other.</span>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!answer.trim()} onClick={create}>Create list</button>
        </div>
      </div>
    </dialog>
  );
}
