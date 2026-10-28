// Админка: меню на телефоне, сохранение статусов без перезагрузки, выбор товаров,
// перетаскивание порядка, загрузка каталога частями с прогрессом.

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2200);
}

async function post(url, data) {
  const body = new URLSearchParams(data);
  const r = await fetch(url, { method: 'POST', body, headers: { Accept: 'application/json' } });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error || 'Не удалось сохранить');
  return json;
}

// ---------- Меню на телефоне ----------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-side-open]')) document.body.classList.add('side-open');
  if (e.target.closest('[data-side-close]')) document.body.classList.remove('side-open');
});

// ---------- Статус закупки: переключатель ----------
$$('[data-status-switch]').forEach((seg) => {
  seg.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || b.classList.contains('on')) return;
    try {
      const r = await post(seg.dataset.statusSwitch, { status: b.dataset.value });
      // Обновляем все переключатели этой закупки на странице и точку в меню
      $$(`[data-status-switch="${seg.dataset.statusSwitch}"] button`).forEach((x) => x.classList.toggle('on', x.dataset.value === b.dataset.value));
      const id = seg.dataset.statusSwitch.match(/purchase\/(\d+)/)[1];
      $$(`.side a[href="/admin/purchase/${id}"] .dot`).forEach((d) => { d.className = `dot ${b.dataset.value}`; });
      toast(r.message);
    } catch (err) { toast(err.message, true); }
  });
});

// ---------- Статус записи: выпадающий список ----------
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-autosave]');
  if (!sel) return;
  try {
    const r = await post(sel.dataset.autosave, { [sel.name]: sel.value });
    sel.className = `st-select ${sel.value}`;
    sel.closest('tr')?.classList.toggle('is-cancelled', sel.value === 'cancelled');
    toast(r.message);
  } catch (err) { toast(err.message, true); }
});

// Выбор закупки в фильтре — сразу применить; выбор файлов — сразу загрузить
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-autosubmit-select], [data-autosubmit]')) {
    if (e.target.matches('[data-autosubmit]')) e.target.closest('.dropzone').querySelector('b').textContent = 'Загружаю…';
    e.target.form.submit();
  }
});

// ---------- Подтверждения, диалоги, копирование ссылки ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-confirm]');
  if (btn && !confirm(btn.dataset.confirm)) { e.preventDefault(); return; }
  const open = e.target.closest('[data-dialog]');
  if (open) { document.getElementById(open.dataset.dialog).showModal(); return; }
  if (e.target.closest('[data-dialog-close]')) { e.target.closest('dialog').close(); return; }
  if (e.target.tagName === 'DIALOG') { e.target.close(); return; }
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    const url = location.origin + copy.dataset.copy;
    navigator.clipboard?.writeText(url).then(() => toast('Ссылка скопирована'), () => prompt('Скопируйте ссылку:', url));
  }
});
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.confirm && !confirm(form.dataset.confirm)) e.preventDefault();
});

// ---------- Фото на весь экран ----------
const lightbox = $('#lightbox');
document.addEventListener('click', (e) => {
  const img = e.target.closest('[data-zoom]');
  if (img) { lightbox.querySelector('img').src = img.dataset.full || img.src; lightbox.hidden = false; return; }
  if (e.target.closest('#lightbox')) lightbox.hidden = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lightbox.hidden = true; });

// ---------- Галочки в таблицах записей ----------
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.toggleAll) $$(`input[type=checkbox][form="${t.dataset.toggleAll}"]`).forEach((c) => { c.checked = t.checked; });
});

// ---------- Товары: выбор, поиск, панель действий ----------
const bulkbar = $('.bulkbar');
if (bulkbar) {
  const boxes = () => $$('input[name=ids][form=bulk]');
  const update = () => {
    const n = boxes().filter((c) => c.checked).length;
    bulkbar.hidden = n === 0;
    $('[data-selected-count]').textContent = n;
    boxes().forEach((c) => c.closest('.acard').classList.toggle('picked', c.checked));
  };
  document.addEventListener('change', (e) => { if (e.target.matches('input[name=ids][form=bulk]')) update(); });
  $('[data-select-all]')?.addEventListener('change', (e) => {
    boxes().forEach((c) => { if (!c.closest('.acard').hidden) c.checked = e.target.checked; });
    update();
  });
  $('[data-select-none]')?.addEventListener('click', () => {
    boxes().forEach((c) => { c.checked = false; });
    const all = $('[data-select-all]');
    if (all) all.checked = false;
    update();
  });
  $('[data-grid-search]')?.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('.acard').forEach((card) => { card.hidden = q && !card.dataset.search.includes(q); });
  });
  update();
}

// ---------- Перетаскивание товаров ----------
const grid = $('[data-sortable]');
if (grid) {
  let dragged = null;
  grid.addEventListener('dragstart', (e) => {
    dragged = e.target.closest('.acard');
    if (!dragged) return;
    dragged.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  grid.addEventListener('dragover', (e) => {
    if (!dragged) return;
    e.preventDefault();
    const over = e.target.closest('.acard');
    if (!over || over === dragged) return;
    const r = over.getBoundingClientRect();
    const after = (e.clientX - r.left) / r.width > 0.5;
    over.parentNode.insertBefore(dragged, after ? over.nextSibling : over);
  });
  grid.addEventListener('dragend', async () => {
    if (!dragged) return;
    dragged.classList.remove('dragging');
    dragged = null;
    try {
      const r = await post(grid.dataset.sortable, { ids: $$('.acard', grid).map((c) => c.dataset.id).join(',') });
      toast(r.message);
    } catch (err) { toast(err.message, true); }
  });
}

// ---------- Загрузка каталога ----------
const up = $('[data-upload]');
if (up) {
  const zone = $('[data-dropzone]', up);
  const input = $('[data-upload-input]', up);
  const progress = $('.progress', up);
  const bar = $('.bar', progress);
  const label = $('span', progress);

  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('over')));
  zone.addEventListener('drop', (e) => { e.preventDefault(); start([...e.dataTransfer.files]); });
  input.addEventListener('change', () => start([...input.files]));

  async function start(files) {
    files = files.filter((f) => f.type.startsWith('image/'))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
    if (!files.length) return toast('Выберите фото (jpg, png, webp…)', true);
    const opts = {};
    $$('input, select, textarea', up).forEach((el) => {
      if (!el.name || el.type === 'file') return;
      if ((el.type === 'radio' || el.type === 'checkbox') && !el.checked) return;
      opts[el.name] = el.value;
    });
    zone.hidden = true;
    progress.hidden = false;
    let done = 0;
    let saved = 0;
    let failed = 0;
    let productId = '';
    const CHUNK = 8;
    for (let i = 0; i < files.length; i += CHUNK) {
      const fd = new FormData();
      Object.entries(opts).forEach(([k, v]) => fd.append(k, v));
      if (productId) fd.append('product_id', productId);
      files.slice(i, i + CHUNK).forEach((f) => fd.append('photos', f, f.name));
      label.textContent = `Загружаю фото: ${done} из ${files.length}…`;
      try {
        const r = await fetch(up.dataset.upload, { method: 'POST', body: fd });
        const json = await r.json();
        if (!r.ok) throw new Error(json.error);
        saved += json.saved;
        failed += json.failed;
        if (opts.mode === 'one') productId = json.productId || productId;
      } catch {
        failed += Math.min(CHUNK, files.length - i);
      }
      done = Math.min(files.length, i + CHUNK);
      bar.style.width = `${(done / files.length) * 100}%`;
    }
    const msg = `Загружено фото: ${saved}${failed ? `, не удалось: ${failed}` : ''}`;
    location.href = `${location.pathname}?msg=${encodeURIComponent(msg)}`;
  }
}
