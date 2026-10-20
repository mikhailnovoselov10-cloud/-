// Модальные окна записи, просмотр фото, подтверждения, выбор всех чекбоксов.

document.addEventListener('click', (e) => {
  const t = e.target;

  const opener = t.closest('[data-open]');
  if (opener) {
    const dlg = document.getElementById(opener.dataset.open);
    dlg.querySelectorAll('[data-remember]').forEach((el) => {
      try { el.value ||= localStorage.getItem(`sp_${el.dataset.remember}`) || ''; } catch {}
    });
    dlg.showModal();
    return;
  }
  if (t.closest('[data-close]')) { t.closest('dialog').close(); return; }
  if (t.tagName === 'DIALOG') { t.close(); return; } // клик по фону

  // Миниатюры меняют главное фото, главное открывается на весь экран
  if (t.matches('.thumbs img')) {
    const main = t.closest('.gallery').querySelector('.main-photo');
    main.src = t.src;
    main.dataset.full = t.dataset.full;
    return;
  }
  if (t.matches('.main-photo, .photo-admin img')) {
    const lb = document.getElementById('lightbox');
    lb.querySelector('img').src = t.dataset.full;
    lb.hidden = false;
    return;
  }
  if (t.closest('#lightbox')) { document.getElementById('lightbox').hidden = true; return; }

  const confirmBtn = t.closest('button[data-confirm]');
  if (confirmBtn && !confirm(confirmBtn.dataset.confirm)) { e.preventDefault(); return; }

  const all = t.closest('[data-check-all], [data-uncheck-all]');
  if (all) {
    const form = all.dataset.checkAll || all.dataset.uncheckAll;
    document.querySelectorAll(`input[type=checkbox][form="${form}"]`).forEach((c) => { c.checked = !!all.dataset.checkAll; });
  }
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.toggleAll) {
    document.querySelectorAll(`input[type=checkbox][form="${t.dataset.toggleAll}"]`).forEach((c) => { c.checked = t.checked; });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.getElementById('lightbox').hidden = true;
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (form.dataset.confirm && !confirm(form.dataset.confirm)) { e.preventDefault(); return; }
  form.querySelectorAll('[data-remember]').forEach((el) => {
    try { localStorage.setItem(`sp_${el.dataset.remember}`, el.value); } catch {}
  });
  // Загрузка большого каталога идёт долго — показываем это на кнопке
  if (form.enctype === 'multipart/form-data') {
    const btn = form.querySelector('button:not([type=button])');
    if (btn) { btn.disabled = true; btn.textContent = 'Загружаю…'; }
  }
});
