// Cron (vercel.json): keeps the sandbox awake while it is importing or transcribing, even if
// everyone has closed the page, and lets it sleep otherwise. Never wakes a sleeping sandbox.
import { activity, busy, getSandbox, keepAwake } from './_sandbox.js';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.statusCode = 401;
    return res.end('Unauthorized');
  }
  const sandbox = await getSandbox({ resume: false });
  let state = sandbox.status;
  if (state === 'running') {
    const a = await activity(sandbox.domain(3462));
    if (busy(a)) { await keepAwake(sandbox); state = 'busy'; }
  }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ state }));
}
