//@name pkr_css_blocks
//@display-name CSS 블록 관리 v0.2.2
//@api 3.0
//@version 0.2.2
//@update-url https://raw.githubusercontent.com/EXena1722/pocketrisu-css-blocks/main/PocketRisu-CSS-Blocks.js
//@link https://github.com/EXena1722/pocketrisu-css-blocks 저장소

// Keeps Custom CSS as a list of titled blocks. Enabled blocks are joined in
// order into the app's single Custom CSS field; @import rules are hoisted to
// the top so browsers do not drop them.

(async () => {
  // Keep in sync with //@version and //@display-name above.
  const VERSION = '0.2.2';
  const STORE_KEY = 'pkr_css_blocks_v1';
  const BACKUP_KEY = 'pkr_css_blocks_backup_v1';

  let blocks = [];
  let dirty = false;

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  async function load() {
    const saved = await risuai.pluginStorage.getItem(STORE_KEY);
    blocks = Array.isArray(saved?.blocks) ? saved.blocks : [];
  }

  async function save() {
    await risuai.pluginStorage.setItem(STORE_KEY, { blocks });
    dirty = false;
  }

  async function readCustomCSS() {
    const db = await risuai.getDatabase(['customCSS']);
    return db ? (db.customCSS ?? '') : null;
  }

  // @import must precede every other rule, so pull them out of each block
  // (only lines that start with @import, which skips most commented ones).
  function combine() {
    const imports = [];
    const parts = [];
    for (const b of blocks) {
      if (!b.enabled) continue;
      const body = b.css.replace(/^[ \t]*@import\s[^;]*;[ \t]*$/gm, (m) => {
        const rule = m.trim();
        if (!imports.includes(rule)) imports.push(rule);
        return '';
      });
      const title = (b.title || '제목 없음').replace(/\*\//g, '* /');
      parts.push(`/* ===== ${title} ===== */\n${body.trim()}\n`);
    }
    return (imports.length ? imports.join('\n') + '\n\n' : '') + parts.join('\n');
  }

  // Save to the database, then swap the live <style id="customcss"> so the
  // change shows without a reload (setDatabase alone does not re-inject CSS).
  async function applyCSS(css) {
    await risuai.setDatabase({ customCSS: css });
    const doc = await risuai.getRootDocument();
    if (!doc) return false;
    const el = await doc.getElementById('customcss');
    if (!el) return false;
    await el.setTextContent(css);
    return true;
  }

  // ---------- UI (runs inside the plugin iframe) ----------

  function setStatus(text) {
    document.getElementById('status').textContent = text;
  }

  function markDirty() {
    dirty = true;
    setStatus('변경됨 — [적용]을 눌러야 반영됩니다');
  }

  function blockEl(b, i) {
    const wrap = document.createElement('section');
    wrap.className = 'block' + (b.enabled ? '' : ' off');

    const bar = document.createElement('div');
    bar.className = 'bar';

    const en = document.createElement('input');
    en.type = 'checkbox';
    en.checked = b.enabled;
    en.title = '켜기/끄기';
    en.addEventListener('change', () => { b.enabled = en.checked; wrap.classList.toggle('off', !b.enabled); markDirty(); });

    const title = document.createElement('input');
    title.className = 'title';
    title.value = b.title;
    title.placeholder = '블록 제목';
    title.addEventListener('input', () => { b.title = title.value; markDirty(); });

    const btn = (label, fn) => {
      const x = document.createElement('button');
      x.textContent = label;
      x.addEventListener('click', fn);
      return x;
    };

    const up = btn('[↑]', () => { if (i > 0) { [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]]; markDirty(); render(); } });
    const down = btn('[↓]', () => { if (i < blocks.length - 1) { [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]]; markDirty(); render(); } });
    const fold = btn(b.folded ? '[펼치기]' : '[접기]', () => { b.folded = !b.folded; render(); });

    // Two-step delete instead of confirm(), which a sandboxed iframe may block.
    let armed = false;
    const del = btn('[삭제]', () => {
      if (!armed) { armed = true; del.textContent = '[정말?]'; del.classList.add('danger'); return; }
      blocks.splice(i, 1); markDirty(); render();
    });

    bar.append(en, title, up, down, fold, del);
    wrap.append(bar);

    if (!b.folded) {
      const ta = document.createElement('textarea');
      ta.spellcheck = false;
      ta.value = b.css;
      ta.placeholder = '/* CSS */';
      ta.addEventListener('input', () => { b.css = ta.value; markDirty(); });
      wrap.append(ta);
    }
    return wrap;
  }

  function render() {
    const list = document.getElementById('list');
    list.replaceChildren(...blocks.map(blockEl));
    if (!blocks.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '블록이 없습니다. [+ 블록 추가] 또는 [현재 CSS 가져오기]를 누르세요.';
      list.append(p);
    }
    const preview = document.getElementById('preview');
    if (!preview.hidden) preview.value = combine();
  }

  async function importCurrent() {
    const css = await readCustomCSS();
    if (css === null) { setStatus('데이터 접근 권한이 없어 가져오지 못했습니다'); return; }
    if (!css.trim()) { setStatus('현재 Custom CSS가 비어 있습니다'); return; }
    blocks.push({ id: newId(), title: '가져온 CSS', enabled: true, folded: false, css });
    markDirty();
    render();
  }

  async function onApply() {
    setStatus('적용 중…');
    const prev = await readCustomCSS();
    if (prev === null) { setStatus('데이터 접근 권한이 없어 적용하지 못했습니다. [설정] > [플러그인]에서 "권한 응답 초기화" 후 다시 여세요'); return; }
    await risuai.pluginStorage.setItem(BACKUP_KEY, prev);
    await save();
    const live = await applyCSS(combine());
    setStatus(live ? '적용됨' : '저장됨 — 화면 접근 권한이 없어 새로고침 후 반영됩니다');
  }

  async function onRestore() {
    const prev = await risuai.pluginStorage.getItem(BACKUP_KEY);
    if (typeof prev !== 'string') { setStatus('되돌릴 이전 CSS가 없습니다'); return; }
    const live = await applyCSS(prev);
    setStatus(live ? '마지막 [적용] 이전 CSS로 되돌렸습니다 (블록 목록은 그대로)' : '되돌림 저장됨 — 새로고침 후 반영됩니다');
  }

  async function onClose() {
    if (dirty) await save();
    await risuai.hideContainer();
  }

  function buildUI() {
    // The app always sizes the plugin iframe to the whole screen, but the iframe
    // itself has no background: keep this page transparent, dim the app behind
    // it, and draw a window: 80% x 85% of large screens, the whole screen on phones.
    document.head.innerHTML = `<meta charset="utf-8"><style>
      @import url("https://cdn.jsdelivr.net/npm/d2coding@1.3.2/d2coding-full.css");
      :root { --bg:#101719; --header:#19272a; --line:#354c50; --text:#d1ddda; --muted:#8ba7a5; --accent:#80c9b7; --red:#ff5555; }
      * { box-sizing: border-box; font-family: 'D2Coding', Consolas, monospace; }
      [hidden] { display: none !important; }
      html, body { margin: 0; height: 100%; background: transparent; color: var(--text); font-size: 16px; }
      body { display: flex; align-items: center; justify-content: center; background: rgb(0 0 0 / .55); }
      .win { display: flex; flex-direction: column; width: min(80%, 72rem); height: 85%;
             background: var(--bg); border: 1px solid var(--line); }
      header { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1ch;
               padding: .6rem 2ch; border-bottom: 1px solid var(--line); }
      header h1 { margin: 0 auto 0 0; font-size: 1rem; color: var(--accent); }
      #status { width: 100%; color: var(--muted); font-size: .8rem; min-height: 1.2em; }
      button { background: none; border: 0; color: var(--muted); cursor: pointer; padding: .25rem .5ch; font-size: .9rem; }
      button:hover { background: var(--accent); color: var(--bg); }
      button.primary { color: var(--accent); }
      button.danger { color: var(--red); }
      main { flex: 1; overflow-y: auto; padding: 1rem 2ch 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
      #list { display: flex; flex-direction: column; gap: 1rem; }
      .block { border: 1px solid var(--line); }
      .block.off { opacity: .55; }
      .bar { display: flex; align-items: center; gap: 1ch; padding: .3rem 1ch; border-bottom: 1px solid var(--line); background: var(--header); }
      .bar .title { flex: 1; min-width: 6rem; background: transparent; color: var(--text); border: 0; font-weight: 600; font-size: .95rem; }
      .bar .title:focus { outline: 1px solid var(--accent); }
      input[type=checkbox] { accent-color: var(--accent); margin: 0; }
      textarea { display: block; width: 100%; height: 14rem; resize: vertical; margin: 0; padding: .6rem 1ch; border: 0;
                 background: var(--bg); color: var(--text); font-size: .9rem; line-height: 1.5; tab-size: 2; }
      textarea:focus { outline: 1px solid var(--accent); }
      #preview { border: 1px dashed var(--line); height: 18rem; color: var(--muted); }
      .empty { color: var(--muted); margin: 0; }
      .note { color: var(--muted); font-size: .8rem; margin: 0; line-height: 1.5; }
      @media (max-width: 600px) {
        .win { width: 100%; height: 100%; border: 0; }
        header, main { padding-left: 1ch; padding-right: 1ch; }
      }
    </style>`;
    document.body.innerHTML = `
      <div class="win">
        <header>
          <h1>[ CSS 블록 관리 v${VERSION} ]</h1>
          <button id="add">[+ 블록]</button>
          <button id="import">[현재 CSS 가져오기]</button>
          <button id="toggle-preview">[합친 결과 보기]</button>
          <button id="restore">[이전 CSS 되돌리기]</button>
          <button id="apply" class="primary">[적용]</button>
          <button id="close">[닫기]</button>
          <div id="status"></div>
        </header>
        <main>
          <p class="note">켜진 블록이 위에서부터 합쳐져 Custom CSS 칸에 저장됩니다(@import는 자동으로 맨 앞).
          Custom CSS 칸을 직접 고치면 다음 [적용] 때 덮어쓰이니 블록에서 수정하세요.</p>
          <div id="list"></div>
          <textarea id="preview" readonly hidden></textarea>
        </main>
      </div>`;

    document.getElementById('add').addEventListener('click', () => {
      blocks.push({ id: newId(), title: '새 블록', enabled: true, folded: false, css: '' });
      markDirty(); render();
    });
    document.getElementById('import').addEventListener('click', importCurrent);
    document.getElementById('toggle-preview').addEventListener('click', (e) => {
      const p = document.getElementById('preview');
      p.hidden = !p.hidden;
      e.target.textContent = p.hidden ? '[합친 결과 보기]' : '[합친 결과 숨기기]';
      if (!p.hidden) p.value = combine();
    });
    document.getElementById('restore').addEventListener('click', onRestore);
    document.getElementById('apply').addEventListener('click', onApply);
    document.getElementById('close').addEventListener('click', onClose);
  }

  await risuai.registerSetting(`CSS 블록 관리 v${VERSION}`, async () => {
    // Ask for both permissions before showing the fullscreen iframe: the app's
    // consent dialog (z-index 50) would otherwise sit hidden behind the plugin
    // container (z-index 1000). Answers are remembered, so this asks only once.
    const current = await readCustomCSS();
    const rootDoc = await risuai.getRootDocument();

    await risuai.showContainer('fullscreen');
    buildUI();
    await load();
    // First run: start from whatever is in Custom CSS today.
    if (!blocks.length && current && current.trim()) {
      blocks.push({ id: newId(), title: '가져온 CSS', enabled: true, folded: false, css: current });
    }
    render();
    if (current === null) {
      setStatus('데이터 접근 권한이 없습니다. [설정] > [플러그인]에서 이 플러그인의 "권한 응답 초기화" 후 다시 여세요');
    } else if (!rootDoc) {
      setStatus('화면 접근 권한이 없어 [적용] 후 새로고침해야 반영됩니다');
    } else {
      setStatus('');
    }
  }, '🧩', 'html', 'pkr-css-blocks');
})();
