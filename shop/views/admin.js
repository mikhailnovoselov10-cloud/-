// Админка: боковое меню, разделы закупки, товары, записи, клиенты, настройки.

import { html, raw, text } from '../html.js';
import { settings } from '../settings.js';
import { PURCHASE_STATUSES, PURCHASE_STATUS_HINTS, SIGNUP_STATUSES } from '../db.js';
import {
  finalPrice, money, choiceText, dateTime, deadlineText, daysLeft, plural, productName,
  selected, checked, notice, head, lightbox,
} from './common.js';

// ---------- Каркас ----------

const PURCHASE_TABS = [
  ['products', 'Товары'],
  ['signups', 'Записи'],
  ['factory', 'Заказ фабрике'],
  ['clients', 'Оплаты клиентов'],
  ['settings', 'Настройки'],
];

function sidebar({ nav, active, purchase, tab }) {
  const link = (href, label, key, extra = '') => html`
    <a href="${href}" class="${active === key ? 'on' : ''}">${label}${extra}</a>`;
  const badge = (n) => (n ? html`<span class="badge">${n}</span>` : '');
  return html`
  <aside class="side" id="side">
    <a class="side-brand" href="/admin">${settings().site_name}</a>
    <nav class="side-nav">
      ${link('/admin', html`<i>⌂</i>Главная`, 'home')}
      ${link('/admin/purchases', html`<i>▤</i>Закупки`, 'purchases')}
      <div class="side-purchases">
        ${nav.purchases.map((p) => html`
          <a href="/admin/purchase/${p.id}" class="sub ${purchase?.id === p.id ? 'on' : ''}">
            <span class="dot ${p.status}"></span><span class="t">${p.title}</span>${badge(p.new_count)}</a>
          ${purchase?.id === p.id ? html`<div class="side-tabs">${PURCHASE_TABS.map(([k, label]) => html`
            <a href="/admin/purchase/${p.id}/${k}" class="${tab === k ? 'on' : ''}">${label}</a>`)}</div>` : ''}`)}
        <a href="/admin/purchases/new" class="sub add">＋ Новая закупка</a>
      </div>
      ${link('/admin/signups', html`<i>✎</i>Все записи`, 'signups', badge(nav.newSignups))}
      ${link('/admin/clients', html`<i>☺</i>Клиенты`, 'clients')}
      ${link('/admin/settings', html`<i>⚙</i>Настройки сайта`, 'settings')}
    </nav>
    <div class="side-foot">
      <a href="/" target="_blank">Открыть сайт ↗</a>
      <form method="post" action="/admin/logout"><button class="link">Выйти</button></form>
    </div>
  </aside>`;
}

function layout({ title, body, nav, active, purchase, tab }) {
  return html`<!doctype html>
<html lang="ru">
<head>${head(title)}</head>
<body class="admin">
${nav ? sidebar({ nav, active, purchase, tab }) : ''}
<div class="side-shade" data-side-close></div>
<div class="amain">
  ${nav ? html`<header class="abar"><button type="button" class="burger" data-side-open aria-label="Меню">☰</button><span>${title}</span></header>` : ''}
  <main class="acontent">${body}</main>
</div>
<div class="toast" id="toast" hidden></div>
${lightbox}
<script src="/static/admin.js?v=2"></script>
</body>
</html>`;
}

// Переключатель статуса закупки — сохраняется сразу
function statusSwitch(p) {
  return html`<div class="seg" data-status-switch="/admin/api/purchase/${p.id}/status">
    ${Object.entries(PURCHASE_STATUSES).map(([k, v]) => html`
      <button type="button" class="${k} ${p.status === k ? 'on' : ''}" data-value="${k}" title="${PURCHASE_STATUS_HINTS[k]}">${v}</button>`)}
  </div>`;
}

function signupStatusSelect(s) {
  return html`<select class="st-select ${s.status}" data-autosave="/admin/api/signup/${s.id}/status" name="status">
    ${Object.entries(SIGNUP_STATUSES).map(([k, v]) => html`<option value="${k}"${selected(k, s.status)}>${v}</option>`)}
  </select>`;
}

const optionValues = (p, name) => p.options.find((o) => o.name === name)?.values ?? [];

// ---------- Вход ----------

export function loginPage(error, noPassword) {
  const body = html`
    <form method="post" action="/admin/login" class="login">
      <h1>${settings().site_name}</h1>
      <p class="muted">Вход для организатора</p>
      ${noPassword ? notice('Пароль не задан. Укажите ADMIN_PASSWORD в файле .env и перезапустите сайт.', 'err') : ''}
      ${notice(error, 'err')}
      <label>Пароль <input type="password" name="password" autofocus required></label>
      <button class="btn wide">Войти</button>
    </form>`;
  return layout({ title: 'Вход', body });
}

// ---------- Главная ----------

export function dashboardPage({ nav, stats, purchases, recent }) {
  const working = purchases.filter((p) => p.status === 'open' || p.status === 'stop' || p.status === 'draft');
  const stat = (n, label, href) => html`<a class="stat" href="${href}"><b>${n}</b><span>${label}</span></a>`;
  const body = html`
    <div class="page-head">
      <h1>Главная</h1>
      <a class="btn" href="/admin/purchases/new">＋ Новая закупка</a>
    </div>
    <div class="stats">
      ${stat(stats.open, 'закупок с открытой записью', '/admin/purchases?status=open')}
      ${stat(stats.newSignups, 'новых записей — не обработаны', '/admin/signups?status=new')}
      ${stat(stats.today, 'записей за сутки', '/admin/signups')}
      ${stat(stats.week, 'записей за неделю', '/admin/signups')}
      ${stat(stats.clients, 'клиентов всего', '/admin/clients')}
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Закупки в работе</h2><a href="/admin/purchases">все закупки →</a></div>
      ${working.length ? html`<div class="plist">${working.map(purchaseRow)}</div>`
        : html`<p class="muted">Нет закупок в работе. <a href="/admin/purchases/new">Создайте первую</a>.</p>`}
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Последние записи</h2><a href="/admin/signups">все записи →</a></div>
      ${recent.length ? signupsTable(recent, { showPurchase: true, back: '/admin' }) : html`<p class="muted">Записей пока нет.</p>`}
    </section>`;
  return layout({ title: 'Главная', body, nav, active: 'home' });
}

function purchaseRow(p) {
  return html`
  <div class="prow">
    <a class="prow-img" href="/admin/purchase/${p.id}">${p.cover ? html`<img src="/uploads/${p.cover}" alt="" loading="lazy">` : ''}</a>
    <div class="prow-main">
      <a class="prow-title" href="/admin/purchase/${p.id}">${p.title}</a>
      <div class="muted small">
        ${p.products_count} ${plural(p.products_count, 'товар', 'товара', 'товаров')} ·
        <a href="/admin/purchase/${p.id}/signups">${p.signups_count} ${plural(p.signups_count, 'запись', 'записи', 'записей')}</a>
        ${p.new_count ? html` · <a href="/admin/purchase/${p.id}/signups?status=new" class="new">${p.new_count} новых</a>` : ''}
        ${p.factory_sum ? html` · у фабрики на ${money(p.factory_sum)}` : ''}
        ${p.deadline ? html` · стоп ${deadlineText(p.deadline)}${p.status === 'open' ? ` (${daysLeft(p.deadline)})` : ''}` : ''}
      </div>
    </div>
    ${statusSwitch(p)}
  </div>`;
}

// ---------- Список закупок ----------

export function purchasesPage({ nav, purchases, status }) {
  const counts = { '': purchases.length };
  for (const p of purchases) counts[p.status] = (counts[p.status] || 0) + 1;
  const shown = status ? purchases.filter((p) => p.status === status) : purchases;
  const body = html`
    <div class="page-head">
      <h1>Закупки</h1>
      <a class="btn" href="/admin/purchases/new">＋ Новая закупка</a>
    </div>
    <div class="tabs">
      ${[['', 'Все'], ...Object.entries(PURCHASE_STATUSES)].map(([k, v]) => html`
        <a href="/admin/purchases${k ? `?status=${k}` : ''}" class="${status === k ? 'on' : ''}">${v} <span>${counts[k] || 0}</span></a>`)}
    </div>
    <section class="panel">
      ${shown.length ? html`<div class="plist">${shown.map(purchaseRow)}</div>` : html`<p class="muted">Здесь пока пусто.</p>`}
    </section>
    <p class="muted small">Статус меняется одним нажатием: <b>Черновик</b> — видите только вы, <b>Идёт запись</b> — клиенты записываются,
      <b>Стоп</b> — закупка видна, но записаться нельзя, <b>Архив</b> — скрыта с сайта.</p>`;
  return layout({ title: 'Закупки', body, nav, active: 'purchases' });
}

function purchaseFields(p = {}) {
  return html`
    <label>Название <input name="title" required maxlength="200" value="${p.title ?? ''}" placeholder="Например: Трикотаж фабрики «Лиза», ноябрь"></label>
    <label>Описание для клиентов <small>— условия, сроки, доставка</small>
      <textarea name="description" rows="4">${p.description ?? ''}</textarea></label>
    <div class="cols3">
      <label>Стоп записи (дата) <input type="date" name="deadline" value="${p.deadline ?? ''}"></label>
      <label>Орг. сбор, % <small>— прибавляется к цене</small><input type="number" name="org_fee" min="0" step="0.1" value="${p.org_fee ?? 0}"></label>
    </div>
    <label>Как оплатить <small>— реквизиты, видны клиенту в «Мои записи»</small>
      <textarea name="pay_info" rows="2" placeholder="Перевод на карту Сбербанк 0000 0000 0000 0000, Михаил Н.">${p.pay_info ?? ''}</textarea></label>`;
}

export function newPurchasePage({ nav }) {
  const body = html`
    <div class="page-head"><h1>Новая закупка</h1></div>
    <form method="post" action="/admin/purchases" class="panel narrow-form">
      ${purchaseFields()}
      <label>Статус
        <select name="status">${Object.entries(PURCHASE_STATUSES).map(([k, v]) => html`<option value="${k}"${selected(k, 'draft')}>${v} — ${PURCHASE_STATUS_HINTS[k]}</option>`)}</select></label>
      <button class="btn">Создать и загрузить товары →</button>
    </form>`;
  return layout({ title: 'Новая закупка', body, nav, active: 'purchases' });
}

// ---------- Страница закупки ----------

function purchaseHead(p, tab, counts) {
  return html`
    <div class="page-head">
      <div>
        <h1>${p.title}</h1>
        <div class="muted small">${p.deadline ? `Стоп ${deadlineText(p.deadline)}${p.status === 'open' ? ` · ${daysLeft(p.deadline)}` : ''} · ` : ''}${p.org_fee ? `орг. сбор ${p.org_fee}% · ` : ''}создана ${dateTime(p.created_at)}</div>
      </div>
      <div class="head-actions">
        <a class="btn ghost" href="/p/${p.id}" target="_blank">Открыть на сайте ↗</a>
        <button type="button" class="btn ghost" data-copy="/p/${p.id}">Скопировать ссылку</button>
      </div>
    </div>
    <div class="status-line"><span class="muted">Статус:</span> ${statusSwitch(p)}</div>
    <div class="tabs">
      ${PURCHASE_TABS.map(([k, label]) => html`
        <a href="/admin/purchase/${p.id}/${k}" class="${tab === k ? 'on' : ''}">${label}${counts[k] != null ? html` <span>${counts[k]}</span>` : ''}</a>`)}
    </div>`;
}

function purchaseLayout({ nav, purchase, tab, counts, body, msg }) {
  return layout({
    title: purchase.title,
    body: html`${purchaseHead(purchase, tab, counts)}${notice(msg)}${body}`,
    nav, active: 'purchases', purchase, tab,
  });
}

// Поля размеров/цветов/прочих параметров товара
function optionFields(options = [], { bulk = false } = {}) {
  const get = (name) => options.find((o) => o.name === name)?.values.join(', ') ?? '';
  const extra = options.filter((o) => o.name !== 'Размер' && o.name !== 'Цвет')
    .map((o) => `${o.name}: ${o.values.join(', ')}`).join('\n');
  return html`
    <div class="cols2">
      <label>Размеры <small>через запятую</small><input name="sizes" value="${get('Размер')}" placeholder="42, 44, 46, 48"></label>
      <label>Цвета <small>через запятую</small><input name="colors" value="${get('Цвет')}" placeholder="чёрный, белый, бежевый"></label>
    </div>
    <label>Другие параметры <small>— каждый с новой строки: «Название: вариант, вариант»</small>
      <textarea name="extra" rows="2" placeholder="Рост: 158, 164, 170">${extra}</textarea></label>
    ${bulk ? html`<p class="muted small">Пустые поля не меняются. Заполненный параметр заменяет одноимённый у выбранных товаров.</p>` : ''}`;
}

export function productsTab({ nav, purchase, products, counts, msg }) {
  const body = html`
    <section class="panel upload" data-upload="/admin/purchase/${purchase.id}/upload">
      <div class="dropzone" data-dropzone>
        <input type="file" accept="image/*" multiple data-upload-input id="upl">
        <label for="upl"><b>Перетащите сюда фото каталога</b><span>или нажмите, чтобы выбрать — можно сразу сотни</span></label>
      </div>
      <div class="upload-opts">
        <label class="inline-check"><input type="radio" name="mode" value="each" checked> каждое фото — отдельный товар</label>
        <label class="inline-check"><input type="radio" name="mode" value="one"> все фото — один товар</label>
        <label class="inline-check"><input type="checkbox" name="article_from_name" checked> артикул = имя файла</label>
      </div>
      <details>
        <summary>Сразу задать новым товарам цену, размеры, цвета</summary>
        <div class="cols3"><label>Цена (закупочная) <input type="number" name="price" min="0" step="0.01"></label></div>
        ${optionFields()}
      </details>
      <div class="progress" hidden><div class="bar"></div><span></span></div>
    </section>

    ${products.length ? html`
    <div class="toolbar">
      <input type="search" placeholder="Найти товар" data-grid-search>
      <label class="inline-check"><input type="checkbox" data-select-all> выбрать все</label>
      <span class="muted small">Перетаскивайте карточки, чтобы поменять порядок</span>
    </div>
    <div class="agrid" data-sortable="/admin/api/purchase/${purchase.id}/order">
      ${products.map((p) => adminCard(p, purchase))}
    </div>` : html`<div class="empty">Товаров пока нет — загрузите фото каталога выше.</div>`}

    <form method="post" action="/admin/purchase/${purchase.id}/bulk" id="bulk">
      <div class="bulkbar" hidden>
        <b>Выбрано: <span data-selected-count>0</span></b>
        <button type="button" class="btn sm" data-dialog="bulk-edit">Изменить цену / размеры…</button>
        <button class="btn sm ghost" name="action" value="hide">Скрыть</button>
        <button class="btn sm ghost" name="action" value="show">Показать</button>
        <button class="btn sm ghost" name="action" value="merge" data-confirm="Объединить выбранные в один товар? Фото и записи перейдут в первый.">Объединить</button>
        <button class="btn sm danger" name="action" value="delete" data-confirm="Удалить выбранные товары вместе с записями?">Удалить</button>
        <button type="button" class="link" data-select-none>снять выбор</button>
      </div>
      <dialog id="bulk-edit">
        <h2>Изменить выбранные товары</h2>
        <div class="cols3"><label>Цена <input type="number" name="price" min="0" step="0.01"></label></div>
        ${optionFields([], { bulk: true })}
        <label>Описание <small>(заменит текущее)</small><textarea name="description" rows="2"></textarea></label>
        <div class="row"><button class="btn" name="action" value="update">Применить</button>
          <button type="button" class="btn ghost" data-dialog-close>Отмена</button></div>
      </dialog>
    </form>`;
  return purchaseLayout({ nav, purchase, tab: 'products', counts, body, msg });
}

function adminCard(p, purchase) {
  const active = p.signups.filter((s) => s.status !== 'cancelled');
  const sizes = optionValues(p, 'Размер');
  const colors = optionValues(p, 'Цвет');
  return html`
  <div class="acard ${p.hidden ? 'is-hidden' : ''}" draggable="true" data-id="${p.id}" id="item-${p.id}"
       data-search="${`${p.title} ${p.article}`.toLowerCase()}">
    <label class="acard-pick"><input type="checkbox" name="ids" value="${p.id}" form="bulk"></label>
    <a href="/admin/product/${p.id}" class="acard-img" draggable="false">
      ${p.photos[0] ? html`<img src="/uploads/${p.photos[0].thumb}" alt="" loading="lazy" draggable="false">` : html`<span>нет фото</span>`}
      ${p.photos.length > 1 ? html`<span class="item-count">${p.photos.length}</span>` : ''}
      ${p.hidden ? html`<span class="hidden-tag">скрыт</span>` : ''}
    </a>
    <a href="/admin/product/${p.id}" class="acard-body" draggable="false">
      <b>${productName(p)}</b>
      <span class="price">${p.price ? html`${money(p.price)}${purchase.org_fee ? html` <small>→ ${money(finalPrice(p.price, purchase.org_fee))}</small>` : ''}` : html`<span class="warn">нет цены</span>`}</span>
      <span class="muted small">${sizes.length ? sizes.join(', ') : html`<span class="warn">нет размеров</span>`}${colors.length ? ` · ${colors.join(', ')}` : ''}</span>
      <span class="small ${active.length ? 'has' : 'muted'}">👥 ${active.length} ${plural(active.length, 'запись', 'записи', 'записей')}</span>
    </a>
  </div>`;
}

export function signupsTab({ nav, purchase, signups, counts, status, q, msg }) {
  const body = html`
    ${signupFilters({ action: `/admin/purchase/${purchase.id}/signups`, signups: null, status, q, statusCounts: counts.statuses })}
    <div class="row">
      <a class="btn ghost sm" href="/admin/purchase/${purchase.id}/signups.csv">Скачать в Excel (CSV)</a>
    </div>
    <section class="panel">
      ${signups.length ? signupsTable(signups, { back: `/admin/purchase/${purchase.id}/signups`, fee: purchase.org_fee })
        : html`<p class="muted">Записей нет.</p>`}
    </section>`;
  return purchaseLayout({ nav, purchase, tab: 'signups', counts, body, msg });
}

function signupFilters({ action, status, q, statusCounts, extra = '' }) {
  return html`
    <form class="filterbar" method="get" action="${action}">
      <div class="tabs small-tabs">
        ${[['', 'Все'], ...Object.entries(SIGNUP_STATUSES)].map(([k, v]) => html`
          <button name="status" value="${k}" class="${status === k ? 'on' : ''}">${v}${statusCounts?.[k] != null ? html` <span>${statusCounts[k]}</span>` : ''}</button>`)}
      </div>
      ${extra}
      <input type="search" name="q" value="${q ?? ''}" placeholder="Имя, телефон, товар…">
      <input type="hidden" name="status" value="${status ?? ''}">
      <button class="btn sm">Найти</button>
    </form>`;
}

let tableSeq = 0;

function signupsTable(signups, { showPurchase = false, back, fee }) {
  const formId = `sg${++tableSeq}`;
  return html`
    <div class="table-wrap">
    <table class="tbl">
      <thead><tr><th><input type="checkbox" data-toggle-all="${formId}"></th>
        <th>Товар</th><th>Клиент</th><th>Параметры</th><th>Шт.</th><th>Сумма</th><th>Статус</th><th>Когда</th><th></th></tr></thead>
      <tbody>
      ${signups.map((s) => html`<tr class="${s.status === 'cancelled' ? 'is-cancelled' : ''}">
        <td><input type="checkbox" name="ids" value="${s.id}" form="${formId}"></td>
        <td class="prod-cell">
          <a href="/admin/product/${s.product_id}">${s.thumb ? html`<img class="tiny" src="/uploads/${s.thumb}" alt="">` : ''}
          <span>${s.product_title || (s.article ? `Арт. ${s.article}` : `№${s.product_id}`)}</span></a>
          ${showPurchase ? html`<div class="muted small"><a href="/admin/purchase/${s.purchase_id}/signups">${s.purchase_title}</a></div>` : ''}
        </td>
        <td><b>${s.name}</b><div class="small"><a href="/admin/clients/view?c=${encodeURIComponent(s.contact.trim().toLowerCase() || `name:${s.name.toLowerCase()}`)}">${s.contact || 'карточка клиента'}</a></div>
          ${s.comment ? html`<div class="muted small">💬 ${s.comment}</div>` : ''}
          ${s.note ? html`<div class="note small">📝 ${s.note}</div>` : ''}</td>
        <td>${choiceText(s.choice)}</td>
        <td>${s.qty}</td>
        <td class="nowrap">${s.price ? money(finalPrice(s.price, fee ?? s.org_fee) * s.qty) : '—'}</td>
        <td>${signupStatusSelect(s)}</td>
        <td class="nowrap muted small">${dateTime(s.created_at)}</td>
        <td><a href="/admin/signup/${s.id}" title="Изменить">✎</a></td>
      </tr>`)}
      </tbody>
    </table>
    </div>
    <form method="post" action="/admin/signups/bulk" id="${formId}" class="row table-actions">
      <input type="hidden" name="back" value="${back}">
      <span class="muted small">С отмеченными:</span>
      <select name="status">${Object.entries(SIGNUP_STATUSES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
      <button class="btn sm" name="action" value="status">Поставить статус</button>
      <button class="btn sm danger" name="action" value="delete" data-confirm="Удалить выбранные записи?">Удалить</button>
    </form>`;
}

export function factoryTab({ nav, purchase, signups, counts }) {
  const active = signups.filter((s) => s.status !== 'cancelled');
  const byProduct = new Map();
  for (const s of active) {
    if (!byProduct.has(s.product_id)) byProduct.set(s.product_id, { s, rows: new Map(), qty: 0 });
    const g = byProduct.get(s.product_id);
    const key = choiceText(s.choice) || '—';
    g.rows.set(key, (g.rows.get(key) || 0) + s.qty);
    g.qty += s.qty;
  }
  const groups = [...byProduct.values()];
  const totalQty = groups.reduce((n, g) => n + g.qty, 0);
  const total = groups.reduce((n, g) => n + g.s.price * g.qty, 0);
  const body = html`
    <div class="row">
      <a class="btn ghost sm" href="/admin/purchase/${purchase.id}/factory.csv">Скачать заказ в Excel (CSV)</a>
      <span class="muted small">Отменённые записи не учитываются.</span>
    </div>
    <div class="stats">
      <div class="stat"><b>${totalQty}</b><span>штук к заказу</span></div>
      <div class="stat"><b>${groups.length}</b><span>моделей</span></div>
      <div class="stat"><b>${money(total)}</b><span>сумма фабрике</span></div>
    </div>
    ${groups.length ? html`<div class="fgroups">${groups.map((g) => html`
      <section class="fgroup">
        <a href="/admin/product/${g.s.product_id}" class="fgroup-img">${g.s.thumb ? html`<img src="/uploads/${g.s.thumb}" alt="">` : ''}</a>
        <div class="fgroup-main">
          <div class="fgroup-head"><b>${g.s.product_title || (g.s.article ? `Арт. ${g.s.article}` : `№${g.s.product_id}`)}</b>
            ${g.s.product_title && g.s.article ? html`<span class="muted">арт. ${g.s.article}</span>` : ''}
            <span class="muted">${money(g.s.price)} × ${g.qty} = <b>${money(g.s.price * g.qty)}</b></span></div>
          <table class="tbl compact">${[...g.rows.entries()].map(([k, q]) => html`<tr><td>${k}</td><td class="num">${q} шт.</td></tr>`)}</table>
        </div>
      </section>`)}</div>` : html`<div class="empty">Пока нет записей.</div>`}`;
  return purchaseLayout({ nav, purchase, tab: 'factory', counts, body });
}

export function clientsTab({ nav, purchase, clients, counts, msg }) {
  const total = clients.reduce((n, c) => n + c.sum, 0);
  const paid = clients.reduce((n, c) => n + c.paid, 0);
  const body = html`
    <div class="stats">
      <div class="stat"><b>${clients.length}</b><span>клиентов</span></div>
      <div class="stat"><b>${money(total)}</b><span>к оплате всего</span></div>
      <div class="stat"><b>${money(paid)}</b><span>оплачено</span></div>
      <div class="stat ${total - paid > 0 ? 'warn' : ''}"><b>${money(total - paid)}</b><span>осталось собрать</span></div>
    </div>
    <section class="panel">
      ${clients.length ? html`
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Клиент</th><th>Товаров</th><th>К оплате</th><th>Оплачено</th><th>Долг</th><th></th></tr></thead>
        <tbody>${clients.map((c) => html`<tr>
          <td><b>${c.name}</b><div class="small"><a href="/admin/clients/view?c=${encodeURIComponent(c.key)}">${c.contact}</a></div></td>
          <td>${c.items} шт.</td>
          <td class="nowrap">${money(c.sum)}</td>
          <td class="nowrap">${c.paid ? money(c.paid) : '—'}</td>
          <td class="nowrap ${c.sum - c.paid > 0 ? 'warn' : 'okc'}">${c.sum - c.paid > 0 ? money(c.sum - c.paid) : '✓'}</td>
          <td>${c.sum - c.paid > 0 ? html`
            <form method="post" action="/admin/purchase/${purchase.id}/client-paid">
              <input type="hidden" name="contact" value="${c.key}">
              <button class="btn sm">Оплатил всё</button></form>` : ''}</td>
        </tr>`)}</tbody>
      </table></div>
      ${purchase.org_fee ? html`<p class="muted small">Сумма с орг. сбором ${purchase.org_fee}%.</p>` : ''}` : html`<p class="muted">Пока нет записей.</p>`}
    </section>`;
  return purchaseLayout({ nav, purchase, tab: 'clients', counts, body, msg });
}

export function settingsTab({ nav, purchase, counts, msg }) {
  const body = html`
    <form method="post" action="/admin/purchase/${purchase.id}" class="panel narrow-form">
      <input type="hidden" name="status" value="${purchase.status}">
      ${purchaseFields(purchase)}
      <button class="btn">Сохранить</button>
    </form>
    <section class="panel narrow-form">
      <h2>Другие действия</h2>
      <div class="row">
        <form method="post" action="/admin/purchase/${purchase.id}/duplicate">
          <button class="btn ghost">Сделать копию закупки</button></form>
        <span class="muted small">Те же товары и фото, без записей — удобно для повторного сбора.</span>
      </div>
      <div class="row">
        <form method="post" action="/admin/purchase/${purchase.id}/delete"
          data-confirm="Удалить закупку со всеми товарами, фото и записями? Это нельзя отменить.">
          <button class="btn danger">Удалить закупку</button></form>
        <span class="muted small">Если закупка просто закончилась — лучше переведите её в «Архив».</span>
      </div>
    </section>`;
  return purchaseLayout({ nav, purchase, tab: 'settings', counts, body, msg });
}

// ---------- Товар ----------

export function productPage({ nav, product: p, purchase, signups, prev, next, msg }) {
  const body = html`
    <div class="page-head">
      <div>
        <a href="/admin/purchase/${purchase.id}/products#item-${p.id}" class="back">← ${purchase.title}</a>
        <h1>${productName(p)}</h1>
      </div>
      <div class="head-actions">
        ${prev ? html`<a class="btn ghost sm" href="/admin/product/${prev.id}">← предыдущий</a>` : ''}
        ${next ? html`<a class="btn ghost sm" href="/admin/product/${next.id}">следующий →</a>` : ''}
        <a class="btn ghost sm" href="/p/${purchase.id}/item/${p.id}" target="_blank">на сайте ↗</a>
      </div>
    </div>
    ${notice(msg)}
    <div class="cols-main">
      <section class="panel">
        <h2>Фото</h2>
        <div class="photos">
          ${p.photos.map((ph, i) => html`
            <figure class="${i === 0 ? 'main' : ''}">
              <img src="/uploads/${ph.thumb}" data-full="/uploads/${ph.file}" alt="" data-zoom>
              <figcaption>
                ${i === 0 ? html`<span class="tag open">главное</span>` : html`<form method="post" action="/admin/photo/${ph.id}/main"><button class="link small">сделать главным</button></form>`}
                <form method="post" action="/admin/photo/${ph.id}/delete" data-confirm="Удалить фото?"><button class="link danger small" title="Удалить">удалить</button></form>
              </figcaption>
            </figure>`)}
        </div>
        <form method="post" action="/admin/product/${p.id}/photos" enctype="multipart/form-data" class="add-photos">
          <label class="dropzone small"><input type="file" name="photos" accept="image/*" multiple required data-autosubmit>
            <span><b>＋ Добавить фото</b></span></label>
        </form>
      </section>

      <form method="post" action="/admin/product/${p.id}" class="panel">
        <input type="hidden" name="full" value="1">
        <h2>Информация</h2>
        <label>Название <input name="title" value="${p.title}" maxlength="200" placeholder="Платье миди"></label>
        <div class="cols3">
          <label>Артикул <input name="article" value="${p.article}" maxlength="100"></label>
          <label>Цена (закупочная) <input type="number" name="price" min="0" step="0.01" value="${p.price || ''}"></label>
          <label>Лимит, шт. <small>пусто — без лимита</small><input type="number" name="max_qty" min="1" value="${p.max_qty ?? ''}"></label>
        </div>
        ${purchase.org_fee ? html`<p class="muted small">Клиенты видят цену с орг. сбором ${purchase.org_fee}%: <b>${money(finalPrice(p.price, purchase.org_fee))}</b></p>` : ''}
        ${optionFields(p.options)}
        <label>Описание <small>— состав, размерная сетка, замеры</small><textarea name="description" rows="4">${p.description}</textarea></label>
        <label class="inline-check"><input type="checkbox" name="hidden"${checked(p.hidden)}> Скрыть от клиентов</label>
        <div class="row">
          <button class="btn">Сохранить</button>
          ${next ? html`<button class="btn ghost" name="then" value="next">Сохранить и к следующему →</button>` : ''}
        </div>
      </form>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Записи на этот товар (${signups.filter((s) => s.status !== 'cancelled').length})</h2>
        <button type="button" class="btn sm ghost" data-dialog="add-signup">＋ Добавить запись вручную</button></div>
      ${signups.length ? signupsTable(signups, { back: `/admin/product/${p.id}`, fee: purchase.org_fee }) : html`<p class="muted">Записей нет.</p>`}
    </section>

    <dialog id="add-signup">
      <form method="post" action="/admin/product/${p.id}/signup">
        <h2>Запись от клиента</h2>
        <p class="muted small">Например, клиент написал вам в личку.</p>
        ${signupFields({ choice: {}, qty: 1 }, p)}
        <div class="row"><button class="btn">Добавить</button><button type="button" class="btn ghost" data-dialog-close>Отмена</button></div>
      </form>
    </dialog>

    <form method="post" action="/admin/product/${p.id}/delete" data-confirm="Удалить товар вместе с фото и записями?" class="danger-zone">
      <button class="link danger">Удалить товар</button>
    </form>`;
  return layout({ title: productName(p), body, nav, active: 'purchases', purchase, tab: 'products' });
}

function signupFields(s, product) {
  return html`
    <div class="cols3">
      ${product.options.map((o, i) => html`
        <label>${o.name}
          <select name="opt_${i}">
            <option value="">—</option>
            ${o.values.map((v) => html`<option${selected(v, s.choice[o.name])}>${v}</option>`)}
            ${s.choice[o.name] && !o.values.includes(s.choice[o.name]) ? html`<option selected>${s.choice[o.name]}</option>` : ''}
          </select></label>`)}
      <label>Количество <input type="number" name="qty" min="1" value="${s.qty}" required></label>
    </div>
    <div class="cols2">
      <label>Имя <input name="name" value="${s.name ?? ''}" required maxlength="60"></label>
      <label>Телефон / Telegram <input name="contact" value="${s.contact ?? ''}" maxlength="100"></label>
    </div>
    <label>Комментарий клиента <input name="comment" value="${s.comment ?? ''}" maxlength="500"></label>`;
}

export function signupPage({ nav, signup: s, product, purchase }) {
  const body = html`
    <div class="page-head"><div>
      <a href="/admin/product/${product.id}" class="back">← ${productName(product)}</a>
      <h1>Запись №${s.id}</h1>
      <div class="muted small">${purchase.title} · ${dateTime(s.created_at)}</div>
    </div></div>
    <form method="post" action="/admin/signup/${s.id}" class="panel narrow-form">
      ${signupFields(s, product)}
      <div class="cols2">
        <label>Статус <select name="status">${Object.entries(SIGNUP_STATUSES).map(([k, v]) => html`<option value="${k}"${selected(k, s.status)}>${v}</option>`)}</select></label>
        <label>Заметка <small>— видите только вы</small><input name="note" value="${s.note}" maxlength="500"></label>
      </div>
      <button class="btn">Сохранить</button>
    </form>
    <form method="post" action="/admin/signups/bulk" data-confirm="Удалить запись?" class="danger-zone">
      <input type="hidden" name="ids" value="${s.id}">
      <input type="hidden" name="back" value="/admin/product/${product.id}">
      <button class="link danger" name="action" value="delete">Удалить запись</button>
    </form>`;
  return layout({ title: `Запись №${s.id}`, body, nav, active: 'purchases', purchase, tab: 'signups' });
}

// ---------- Все записи, клиенты, настройки ----------

export function allSignupsPage({ nav, signups, status, q, purchaseId, purchases, statusCounts, msg }) {
  const purchaseSelect = html`<select name="purchase" data-autosubmit-select>
    <option value="">Все закупки</option>
    ${purchases.map((p) => html`<option value="${p.id}"${selected(p.id, purchaseId)}>${p.title}</option>`)}</select>`;
  const body = html`
    <div class="page-head"><h1>Все записи</h1></div>
    ${notice(msg)}
    ${signupFilters({ action: '/admin/signups', status, q, statusCounts, extra: purchaseSelect })}
    <section class="panel">
      ${signups.length ? signupsTable(signups, { showPurchase: true, back: '/admin/signups' }) : html`<p class="muted">Ничего не найдено.</p>`}
    </section>`;
  return layout({ title: 'Все записи', body, nav, active: 'signups' });
}

export function clientsPage({ nav, clients, q }) {
  const body = html`
    <div class="page-head"><h1>Клиенты</h1></div>
    <form class="filterbar" method="get"><input type="search" name="q" value="${q}" placeholder="Имя или телефон"><button class="btn sm">Найти</button></form>
    <section class="panel">
      ${clients.length ? html`<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Клиент</th><th>Закупок</th><th>Товаров</th><th>Сумма</th><th>Оплачено</th><th>Долг</th><th>Последняя запись</th></tr></thead>
        <tbody>${clients.map((c) => html`<tr>
          <td><a href="/admin/clients/view?c=${encodeURIComponent(c.key)}"><b>${c.name}</b></a><div class="small muted">${c.contact}</div></td>
          <td>${c.purchases}</td><td>${c.items}</td>
          <td class="nowrap">${money(c.sum)}</td><td class="nowrap">${c.paid ? money(c.paid) : '—'}</td>
          <td class="nowrap ${c.sum - c.paid > 0 ? 'warn' : 'okc'}">${c.sum - c.paid > 0 ? money(c.sum - c.paid) : '✓'}</td>
          <td class="muted small nowrap">${dateTime(c.last)}</td>
        </tr>`)}</tbody></table></div>` : html`<p class="muted">Клиентов пока нет.</p>`}
    </section>`;
  return layout({ title: 'Клиенты', body, nav, active: 'clients' });
}

export function clientPage({ nav, client, signups }) {
  const body = html`
    <div class="page-head"><div>
      <a href="/admin/clients" class="back">← Клиенты</a>
      <h1>${client.name}</h1>
      <div class="muted">${client.contact}</div>
    </div></div>
    <div class="stats">
      <div class="stat"><b>${client.items}</b><span>товаров</span></div>
      <div class="stat"><b>${money(client.sum)}</b><span>сумма</span></div>
      <div class="stat"><b>${money(client.paid)}</b><span>оплачено</span></div>
      <div class="stat ${client.sum - client.paid > 0 ? 'warn' : ''}"><b>${money(client.sum - client.paid)}</b><span>долг</span></div>
    </div>
    <section class="panel">${signupsTable(signups, { showPurchase: true, back: `/admin/clients/view?c=${encodeURIComponent(client.key)}` })}</section>`;
  return layout({ title: client.name, body, nav, active: 'clients' });
}

export function settingsPage({ nav, s, msg }) {
  const body = html`
    <div class="page-head"><h1>Настройки сайта</h1></div>
    ${notice(msg)}
    <form method="post" action="/admin/settings" class="panel narrow-form">
      <h2>Сайт</h2>
      <label>Название сайта <input name="site_name" value="${s.site_name}" maxlength="80" required></label>
      <label>Приветствие на главной <textarea name="welcome" rows="3">${s.welcome}</textarea></label>
      <div class="cols2">
        <label>Контакт организатора <small>— виден клиентам</small><input name="contact" value="${s.contact}" placeholder="@my_telegram, +7 900 000-00-00"></label>
        <label>Валюта <input name="currency" value="${s.currency}" maxlength="5"></label>
      </div>
      <h2>Уведомления о новых записях в Telegram</h2>
      <p class="muted small">Создайте бота у @BotFather, напишите ему /start, свой chat id узнайте у @userinfobot.</p>
      <div class="cols2">
        <label>Токен бота <input name="tg_bot_token" value="${s.tg_bot_token}" autocomplete="off"></label>
        <label>Ваш chat id <input name="tg_chat_id" value="${s.tg_chat_id}"></label>
      </div>
      <div class="row">
        <button class="btn">Сохранить</button>
        <button class="btn ghost" name="test" value="1">Сохранить и отправить тест</button>
      </div>
      <p class="muted small">Пароль от админки меняется в файле .env (ADMIN_PASSWORD) с перезапуском сайта.</p>
    </form>`;
  return layout({ title: 'Настройки', body, nav, active: 'settings' });
}

export function errorPage(status, message, nav) {
  return layout({ title: 'Ошибка', body: html`<div class="empty"><h1>${status === 404 ? 'Не найдено' : 'Ошибка'}</h1><p>${message}</p><p><a href="/admin">На главную</a></p></div>`, nav });
}

export { text, raw };
