/* Private, versioned Cloudflare draft; input stays synchronous in page memory. */
(() => {
  const legacyKey = 'flattravel_intake_v2';
  const params = new URLSearchParams(location.search);
  const endpoint = `/api/forms-studio/draft?formId=72fa9940-164a-4efb-9ad8-e819bfeb8c91&issue=${encodeURIComponent(params.get('issue') || '')}`;
  let draft = null, version = '', changed = 0, saved = 0, timer, pending, stopped = false, readySucceeded = false;
  try { draft = JSON.parse(localStorage.getItem(legacyKey) || 'null'); } catch { /* optional legacy storage */ }
  try { localStorage.removeItem(legacyKey); } catch { /* storage unavailable */ }
  // The historical key had no issue binding. Never silently attach it to a case.
  let unboundLegacy = params.get('issue') ? draft : null;
  if (unboundLegacy) draft = null;
  if (draft) changed++;
  function status(message) {
    let node = document.getElementById('draft-save-status');
    if (!node) { node = document.createElement('p'); node.id = 'draft-save-status'; node.setAttribute('role', 'status'); document.getElementById('form')?.before(node); }
    node.textContent = message;
    node.hidden = !message;
  }
  const failure = () => status(document.documentElement.lang === 'ja'
    ? '下書きを保存できません。通信状態を確認し、この画面を開いたままにしてください。'
    : 'Your draft could not be saved. Check your connection and keep this page open.');
  async function load() {
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('draft_unavailable');
    const data = await response.json();
    version = data.version || '';
    if (data.draft) { draft = data.draft; changed = saved = 0; }
    readySucceeded = true;
    if (unboundLegacy) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = document.documentElement.lang === 'ja' ? '以前の端末下書きをこのフォームに復元' : 'Recover previous device draft into this form';
      button.addEventListener('click', () => {
        if (!window.confirm(document.documentElement.lang === 'ja' ? '以前の下書きが今回の旅行の内容であることを確認してください。現在の入力内容を置き換えます。' : 'Please confirm the previous draft belongs to this trip. This replaces the current answers.')) return;
        draft = unboundLegacy; unboundLegacy = null; changed++; button.remove();
        window.dispatchEvent(new Event('flat-form-draft-recovered')); schedule();
      });
      document.getElementById('form')?.before(button);
    }
    if (changed > saved) schedule();
    return draft;
  }
  const ready = load().catch(() => { failure(); return draft; });
  function schedule() { clearTimeout(timer); if (!stopped) timer = setTimeout(() => flush().catch(failure), 700); }
  async function flush(keepalive = false) {
    await ready;
    if (pending) { await pending; if (!stopped && changed > saved) return flush(keepalive); return; }
    if (stopped || changed <= saved) return;
    if (!readySucceeded) throw new Error('draft_not_loaded');
    const revision = changed;
    const value = JSON.stringify(draft);
    pending = (async () => {
      const response = await fetch(endpoint, { method: 'PUT', cache: 'no-store', keepalive,
        headers: { 'Content-Type': 'application/json', 'If-Match': version }, body: value });
      if (!response.ok) throw new Error(response.status === 409 ? 'draft_conflict' : 'draft_save_failed');
      version = (await response.json()).version;
      saved = revision;
      status('');
    })();
    try { await pending; } finally { pending = null; }
    if (changed > saved && !stopped) schedule();
  }
  window.FlatFormDraft = {
    ready,
    read: () => draft,
    write(value) { if (stopped) return; draft = structuredClone(value); changed++; schedule(); },
    flush,
    async clear() {
      stopped = true; clearTimeout(timer);
      if (pending) await pending.catch(() => {});
      draft = null; unboundLegacy = null; saved = changed;
      const response = await fetch(endpoint, { method: 'DELETE', cache: 'no-store', headers: { 'If-Match': version } });
      if (!response.ok) throw new Error('draft_clear_failed');
      version = (await response.json()).version;
      status('');
    },
  };
  window.addEventListener('beforeunload', event => {
    if (!stopped && (changed > saved || unboundLegacy)) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => { if (!stopped) flush(true).catch(() => {}); });
  window.addEventListener('online', () => {
    if (stopped) return;
    // Never replace edited RAM with a server response during a reconnect.
    if (readySucceeded) flush().catch(failure);
    else failure();
  });
})();
