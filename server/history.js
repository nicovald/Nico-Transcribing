export { undo, summary } from './transcript.js';
import { updateTranscript } from './transcript.js';
export const clear = id => updateTranscript(id, state => { state.history = []; });
