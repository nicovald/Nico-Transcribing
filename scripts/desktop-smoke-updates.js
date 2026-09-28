// Runs inside the isolated Electron page. Fake token only; update checks are stubbed locally.
(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async predicate => {
    for (let i = 0; i < 120; i++) { if (await predicate()) return; await sleep(50); }
    throw new Error('Timed out checking private update access');
  };
  const originalFetch = window.fetch;
  window.fetch = (url, options) => String(url) === '/api/update/check'
    ? Promise.resolve(new Response(JSON.stringify({ status: 'current' }), { headers: { 'Content-Type': 'application/json' } }))
    : originalFetch(url, options);
  const tokenInput = root => root.querySelector('input[placeholder^="github_pat_"]');
  const button = (root, text) => [...root.querySelectorAll('button')].find(b => b.textContent.trim() === text);
  const setValue = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const savedToken = async () => (await (await originalFetch('/api/settings')).json()).keys.github;
  const open = async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', ctrlKey: true, shiftKey: true }));
    // The joke intro plays on every open.
    await until(() => document.querySelector('dialog.team-dialog[open] .terminal'));
    button(document.querySelector('dialog.team-dialog[open]'), 'Skip').click();
    await until(() => document.querySelector('dialog.team-dialog[open] .private-updates > summary'));
    const dialog = document.querySelector('dialog.team-dialog[open]');
    dialog.querySelector('.private-updates > summary').click();
    await until(() => tokenInput(dialog)?.offsetParent);
    return dialog;
  };
  try {
    const updatesTab = [...document.querySelectorAll('.settings-nav button')].find(b => b.textContent.trim() === 'App updates');
    updatesTab.click(); await sleep(200);
    if (tokenInput(document)) throw new Error('Normal Settings exposes a GitHub token field');
    let dialog = await open();
    setValue(tokenInput(dialog), 'github-pat-smoke-9898'); await sleep(100);
    button(dialog, 'Save & check').click();
    await until(async () => await savedToken() === '••••9898');
    await until(() => !button(dialog, 'Close').disabled && button(dialog, 'Check now') && !button(dialog, 'Check now').disabled);
    button(dialog, 'Close').click(); await sleep(150);
    if (tokenInput(document)) throw new Error('Token field remained visible after closing setup');
    button(document.querySelector('main'), 'Check now').click(); await sleep(250);
    if (await savedToken() !== '••••9898') throw new Error('Normal update check overwrote private access');
    dialog = await open();
    if (tokenInput(dialog).value !== '••••9898') throw new Error('Saved token did not reopen masked');
    setValue(tokenInput(dialog), ''); await sleep(100);
    button(dialog, 'Save & check').click();
    await until(async () => await savedToken() === '');
    await until(() => button(dialog, 'Check now') && !button(dialog, 'Check now').disabled);
    button(dialog, 'Close').click(); await sleep(150);
    const notices = await originalFetch('/api/licenses');
    if (!notices.ok || !(await notices.text()).includes('FFmpeg')) throw new Error('Notices unavailable');
    return { updates: 'passed', tokenControls: 'hidden', shortcut: 'passed', saveAndClear: 'passed', notices: 'passed' };
  } finally {
    window.fetch = originalFetch;
  }
})();
