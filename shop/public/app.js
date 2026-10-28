// Сайт для клиентов: галерея, фильтры каталога, количество, запоминание имени.

const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Галерея товара ----------
const slides = document.querySelector('[data-slides]');
if (slides) {
  const dots = $$('[data-slide]');
  const current = () => Math.round(slides.scrollLeft / slides.clientWidth);
  slides.addEventListener('scroll', () => {
    dots.forEach((d, i) => d.classList.toggle('on', i === current()));
  }, { passive: true });
  dots.forEach((d) => d.addEventListener('click', () => {
    slides.scrollTo({ left: slides.clientWidth * Number(d.dataset.slide), behavior: 'smooth' });
  }));
}

// ---------- Просмотр фото на весь экран ----------
const lightbox = document.getElementById('lightbox');
document.addEventListener('click', (e) => {
  const img = e.target.closest('[data-zoom]');
  if (img) {
    lightbox.querySelector('img').src = img.dataset.full || img.src;
    lightbox.hidden = false;
    return;
  }
  if (e.target.closest('#lightbox')) lightbox.hidden = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lightbox.hidden = true; });

// ---------- Количество −/+ ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-qty]');
  if (!b) return;
  const input = b.parentElement.querySelector('input');
  const max = Number(input.max) || 99;
  input.value = Math.min(max, Math.max(1, (Number(input.value) || 1) + Number(b.dataset.qty)));
});

// ---------- Подтверждения, запоминание имени и контакта ----------
$$('[data-remember]').forEach((el) => {
  try { el.value ||= localStorage.getItem(`sp_${el.dataset.remember}`) || ''; } catch {}
});
document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.confirm && !confirm(form.dataset.confirm)) { e.preventDefault(); return; }
  $$('[data-remember]', form).forEach((el) => {
    try { localStorage.setItem(`sp_${el.dataset.remember}`, el.value); } catch {}
  });
  const btn = form.querySelector('.btn.big');
  if (btn) { btn.disabled = true; btn.textContent = 'Записываю…'; }
});

// Длинное описание закупки
document.querySelector('[data-unclamp]')?.addEventListener('click', (e) => {
  document.querySelector('.pdesc.clamp')?.classList.remove('clamp');
  e.target.remove();
});

// ---------- Фильтры каталога ----------
const catalog = document.getElementById('catalog');
if (catalog) {
  const search = document.querySelector('[data-filter-search]');
  const sort = document.querySelector('[data-filter-sort]');
  const empty = document.querySelector('[data-filter-empty]');
  const items = $$('.item', catalog);
  const sizes = new Set();

  function apply() {
    const q = (search?.value || '').trim().toLowerCase();
    let shown = 0;
    for (const it of items) {
      const okSearch = !q || it.dataset.search.includes(q);
      const okSize = !sizes.size || [...sizes].some((s) => it.dataset.sizes.includes(`|${s}|`));
      it.hidden = !(okSearch && okSize);
      if (!it.hidden) shown++;
    }
    if (empty) empty.hidden = shown > 0;
    const by = sort?.value;
    const key = (it) => (by === 'asc' ? Number(it.dataset.price) || Infinity
      : by === 'desc' ? -Number(it.dataset.price)
        : by === 'popular' ? -Number(it.dataset.popular) : Number(it.dataset.order));
    [...items].sort((a, b) => key(a) - key(b) || a.dataset.order - b.dataset.order).forEach((it) => catalog.append(it));
  }

  search?.addEventListener('input', apply);
  sort?.addEventListener('change', apply);
  $$('[data-filter-size]').forEach((b) => b.addEventListener('click', () => {
    b.classList.toggle('on');
    if (b.classList.contains('on')) sizes.add(b.dataset.filterSize); else sizes.delete(b.dataset.filterSize);
    apply();
  }));
}
