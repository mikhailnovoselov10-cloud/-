// Страницы сайта (серверная отрисовка).

import { html, raw, text } from './html.js';
import { SITE_NAME, CURRENCY, CONTACT } from './config.js';
import { PURCHASE_STATUSES, SIGNUP_STATUSES } from './db.js';

// ---------- Общие помощники ----------

export const finalPrice = (price, fee) => Math.ceil(price * (1 + (fee || 0) / 100));

export function money(n) {
  return `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} ${CURRENCY}`;
}

export function choiceText(choice) {
  return Object.entries(choice).map(([k, v]) => `${k}: ${v}`).join(', ');
}

function date(ts) {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function deadlineText(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

const optionsText = (options) => options.map((o) => `${o.name}: ${o.values.join(', ')}`).join(' · ');

const selected = (a, b) => (String(a) === String(b) ? raw(' selected') : '');
const checked = (v) => (v ? raw(' checked') : '');

function layout({ title, body, admin = false }) {
  return html`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title ? `${title} — ` : ''}${SITE_NAME}</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body class="${admin ? 'is-admin' : ''}">
<header class="top">
  <div class="wrap top-in">
    <a class="logo" href="${admin ? '/admin' : '/'}">${SITE_NAME}${admin ? ' · админка' : ''}</a>
    <nav>
      ${admin
        ? html`<a href="/">Сайт</a><form method="post" action="/admin/logout" class="inline"><button class="link">Выйти</button></form>`
        : html`<a href="/">Закупки</a><a href="/my">Мои записи</a>`}
    </nav>
  </div>
</header>
<main class="wrap">${body}</main>
<div id="lightbox" hidden><img alt=""><button class="lb-close" aria-label="Закрыть">×</button></div>
<script src="/static/app.js"></script>
</body>
</html>`;
}

function notice(msg, kind = 'ok') {
  return msg ? html`<div class="notice ${kind}">${msg}</div>` : '';
}

// ---------- Клиентская часть ----------

export function homePage(purchases) {
  const body = html`
    <h1>Открытые закупки</h1>
    ${purchases.length ? '' : html`<p class="muted">Сейчас нет открытых закупок. Загляните позже!</p>`}
    <div class="cards">
      ${purchases.map((p) => html`
        <a class="card" href="/p/${p.id}">
          <div class="card-img">${p.cover ? html`<img src="/uploads/${p.cover}" alt="" loading="lazy">` : html`<span>нет фото</span>`}</div>
          <div class="card-body">
            <h2>${p.title}</h2>
            <div class="badges">
              <span class="badge ${p.status}">${p.status === 'open' ? 'Идёт запись' : 'Запись закрыта'}</span>
              ${p.deadline ? html`<span class="badge">до ${deadlineText(p.deadline)}</span>` : ''}
            </div>
            <p class="muted">${p.products_count} товаров · ${p.signups_count} записей</p>
          </div>
        </a>`)}
    </div>
    ${CONTACT ? html`<p class="muted contact">Организатор: ${CONTACT}</p>` : ''}`;
  return layout({ body });
}

export function purchasePage({ purchase, products, clientId, ok, error }) {
  const open = purchase.status === 'open';
  const body = html`
    <p class="crumbs"><a href="/">← Все закупки</a></p>
    <h1>${purchase.title}</h1>
    <div class="badges">
      <span class="badge ${purchase.status}">${open ? 'Идёт запись' : 'Запись закрыта'}</span>
      ${purchase.deadline ? html`<span class="badge">Запись до ${deadlineText(purchase.deadline)}</span>` : ''}
      ${purchase.org_fee ? html`<span class="badge">Цены с орг. сбором ${purchase.org_fee}%</span>` : ''}
    </div>
    ${purchase.description ? html`<div class="desc">${text(purchase.description)}</div>` : ''}
    ${ok ? notice('Вы записаны! Ваша запись появилась в списке под товаром.') : ''}
    ${notice(error, 'err')}
    ${products.length ? '' : html`<p class="muted">Товары скоро появятся.</p>`}
    <div class="products">
      ${products.map((p) => productCard(p, purchase, clientId, open))}
    </div>
    ${CONTACT ? html`<p class="muted contact">Вопросы — организатору: ${CONTACT}</p>` : ''}`;
  return layout({ title: purchase.title, body });
}

function productCard(p, purchase, clientId, open) {
  const active = p.signups.filter((s) => s.status !== 'cancelled');
  const taken = active.reduce((sum, s) => sum + s.qty, 0);
  const left = p.max_qty ? p.max_qty - taken : null;
  const canSignup = open && (left === null || left > 0);
  const [main, ...more] = p.photos;
  return html`
  <article class="product" id="item-${p.id}">
    <div class="gallery">
      ${main
        ? html`<img class="main-photo" src="/uploads/${main.thumb}" data-full="/uploads/${main.file}" alt="${p.title}" loading="lazy">`
        : html`<div class="no-photo">нет фото</div>`}
      ${more.length ? html`<div class="thumbs">${p.photos.map((ph) => html`
        <img src="/uploads/${ph.thumb}" data-full="/uploads/${ph.file}" alt="" loading="lazy">`)}</div>` : ''}
    </div>
    <div class="info">
      ${p.title ? html`<h3>${p.title}</h3>` : ''}
      ${p.article ? html`<div class="muted">Арт. ${p.article}</div>` : ''}
      ${p.price ? html`<div class="price">${money(finalPrice(p.price, purchase.org_fee))}</div>` : ''}
      ${p.options.map((o) => html`<div class="opt"><b>${o.name}:</b> ${o.values.map((v) => html`<span class="chip">${v}</span>`)}</div>`)}
      ${p.description ? html`<div class="pdesc">${text(p.description)}</div>` : ''}
      ${left !== null ? html`<div class="muted">Осталось: ${Math.max(left, 0)} из ${p.max_qty}</div>` : ''}
      ${canSignup
        ? html`<button class="btn" data-open="dlg-${p.id}">Записаться</button>`
        : html`<button class="btn" disabled>${open ? 'Мест нет' : 'Запись закрыта'}</button>`}

      <div class="signups">
        <h4>Записались${active.length ? ` (${active.length} чел.${taken !== active.length ? `, ${taken} шт.` : ''})` : ''}</h4>
        ${active.length
          ? html`<ol>${active.map((s) => html`
            <li class="${s.client_id === clientId ? 'mine' : ''}">
              <span class="who">${s.name}</span>
              ${Object.keys(s.choice).length ? html` — ${choiceText(s.choice)}` : ''}
              ${s.qty > 1 ? html` × ${s.qty}` : ''}
              ${s.client_id === clientId && open ? html`
                <form method="post" action="/signup/${s.id}/cancel" class="inline" data-confirm="Отменить запись?">
                  <button class="link danger">отменить</button>
                </form>` : ''}
            </li>`)}</ol>`
          : html`<p class="muted">Пока никого — будьте первым!</p>`}
      </div>
    </div>

    ${canSignup ? html`
    <dialog id="dlg-${p.id}">
      <form method="post" action="/p/${purchase.id}/item/${p.id}/signup" class="signup-form">
        <h3>Запись: ${p.title || p.article || 'товар'}</h3>
        ${p.options.map((o, i) => html`
          <label>${o.name}
            <select name="opt_${i}" required>
              <option value="">— выберите —</option>
              ${o.values.map((v) => html`<option>${v}</option>`)}
            </select>
          </label>`)}
        <label>Количество
          <input type="number" name="qty" value="1" min="1" max="${left ?? 99}" required>
        </label>
        <label>Ваше имя (будет видно в списке)
          <input name="name" maxlength="60" required data-remember="name">
        </label>
        <label>Телефон или Telegram (видит только организатор)
          <input name="contact" maxlength="100" required data-remember="contact">
        </label>
        <label>Комментарий
          <textarea name="comment" maxlength="500" rows="2"></textarea>
        </label>
        <div class="row">
          <button class="btn">Записаться</button>
          <button type="button" class="btn ghost" data-close>Отмена</button>
        </div>
      </form>
    </dialog>` : ''}
  </article>`;
}

export function myPage(signups) {
  const active = signups.filter((s) => s.status !== 'cancelled');
  const byPurchase = new Map();
  for (const s of active) {
    if (!byPurchase.has(s.purchase_id)) byPurchase.set(s.purchase_id, { title: s.purchase_title, items: [] });
    byPurchase.get(s.purchase_id).items.push(s);
  }
  const body = html`
    <h1>Мои записи</h1>
    <p class="muted">Записи привязаны к этому браузеру. Отменить запись можно, пока закупка открыта.</p>
    ${active.length ? '' : html`<p>Вы пока никуда не записались. <a href="/">Посмотреть закупки</a></p>`}
    ${[...byPurchase.entries()].map(([id, g]) => {
      const total = g.items.reduce((sum, s) => sum + finalPrice(s.price, s.org_fee) * s.qty, 0);
      return html`
      <section class="box">
        <h2><a href="/p/${id}">${g.title}</a></h2>
        <table class="tbl">
          <tr><th></th><th>Товар</th><th>Параметры</th><th>Кол-во</th><th>Сумма</th><th>Статус</th><th></th></tr>
          ${g.items.map((s) => html`<tr>
            <td>${s.thumb ? html`<img class="tiny" src="/uploads/${s.thumb}" alt="">` : ''}</td>
            <td><a href="/p/${id}#item-${s.product_id}">${s.product_title || s.article || 'товар'}</a></td>
            <td>${choiceText(s.choice)}</td>
            <td>${s.qty}</td>
            <td>${s.price ? money(finalPrice(s.price, s.org_fee) * s.qty) : "уточняется"}</td>
            <td>${SIGNUP_STATUSES[s.status]}</td>
            <td>${s.purchase_status === 'open' ? html`
              <form method="post" action="/signup/${s.id}/cancel" class="inline" data-confirm="Отменить запись?">
                <input type="hidden" name="back" value="/my"><button class="link danger">отменить</button>
              </form>` : ''}</td>
          </tr>`)}
          <tr class="total"><td colspan="4">Итого</td><td colspan="3">${money(total)}</td></tr>
        </table>
      </section>`;
    })}`;
  return layout({ title: 'Мои записи', body });
}

export function errorPage(status, message) {
  return layout({ title: 'Ошибка', body: html`<h1>${status === 404 ? 'Не найдено' : 'Ошибка'}</h1><p>${message}</p><p><a href="/">На главную</a></p>` });
}

// ---------- Админка ----------

export function loginPage(error, noPassword) {
  const body = html`
    <form method="post" action="/admin/login" class="box narrow">
      <h1>Вход в админку</h1>
      ${noPassword ? notice('Пароль не задан. Укажите ADMIN_PASSWORD в файле .env и перезапустите сайт.', 'err') : ''}
      ${notice(error, 'err')}
      <label>Пароль <input type="password" name="password" autofocus required></label>
      <button class="btn">Войти</button>
    </form>`;
  return layout({ title: 'Вход', body, admin: true });
}

function purchaseFields(p = {}) {
  return html`
    <label>Название закупки <input name="title" required maxlength="200" value="${p.title ?? ''}" placeholder="Например: Трикотаж фабрики «Лиза», октябрь"></label>
    <label>Описание, условия (сроки, доставка, оплата)
      <textarea name="description" rows="4">${p.description ?? ''}</textarea></label>
    <div class="grid3">
      <label>Статус
        <select name="status">${Object.entries(PURCHASE_STATUSES).map(([k, v]) => html`<option value="${k}"${selected(k, p.status ?? 'draft')}>${v}</option>`)}</select></label>
      <label>Запись до (дата) <input type="date" name="deadline" value="${p.deadline ?? ''}"></label>
      <label>Орг. сбор, % (прибавляется к цене) <input type="number" name="org_fee" min="0" step="0.1" value="${p.org_fee ?? 0}"></label>
    </div>`;
}

export function dashboardPage(purchases) {
  const body = html`
    <h1>Закупки</h1>
    <table class="tbl">
      <tr><th></th><th>Название</th><th>Статус</th><th>Запись до</th><th>Товаров</th><th>Записей</th><th></th></tr>
      ${purchases.map((p) => html`<tr>
        <td>${p.cover ? html`<img class="tiny" src="/uploads/${p.cover}" alt="">` : ''}</td>
        <td><a href="/admin/purchase/${p.id}"><b>${p.title}</b></a></td>
        <td><span class="badge ${p.status}">${PURCHASE_STATUSES[p.status].split(' ')[0]}</span></td>
        <td>${deadlineText(p.deadline)}</td>
        <td>${p.products_count}</td>
        <td><a href="/admin/purchase/${p.id}/signups">${p.signups_count}</a></td>
        <td class="nowrap"><a href="/admin/purchase/${p.id}">изменить</a> · <a href="/p/${p.id}" target="_blank">на сайте</a></td>
      </tr>`)}
    </table>
    ${purchases.length ? '' : html`<p class="muted">Закупок пока нет — создайте первую.</p>`}
    <form method="post" action="/admin/purchase" class="box">
      <h2>Новая закупка</h2>
      ${purchaseFields()}
      <button class="btn">Создать</button>
    </form>`;
  return layout({ title: 'Админка', body, admin: true });
}

// Поля размеров/цветов/прочих параметров товара
function optionFields(options = [], { bulk = false } = {}) {
  const get = (name) => options.find((o) => o.name === name)?.values.join(', ') ?? '';
  const extra = options.filter((o) => o.name !== 'Размер' && o.name !== 'Цвет')
    .map((o) => `${o.name}: ${o.values.join(', ')}`).join('\n');
  return html`
    <label>Размеры (через запятую) <input name="sizes" value="${get('Размер')}" placeholder="42, 44, 46, 48"></label>
    <label>Цвета (через запятую) <input name="colors" value="${get('Цвет')}" placeholder="чёрный, белый, бежевый"></label>
    <label>Другие параметры — каждый с новой строки «Название: вариант, вариант»
      <textarea name="extra" rows="2" placeholder="Рост: 158, 164, 170">${extra}</textarea></label>
    ${bulk ? html`<p class="muted small">Пустые поля не меняются. Заполненный параметр заменяет одноимённый у выбранных товаров.</p>` : ''}`;
}

export function purchaseAdminPage({ purchase, products, msg }) {
  const signupsTotal = products.reduce((n, p) => n + p.signups.filter((s) => s.status !== 'cancelled').length, 0);
  const body = html`
    <p class="crumbs"><a href="/admin">← Все закупки</a></p>
    <h1>${purchase.title}</h1>
    <p class="row">
      <a class="btn" href="/admin/purchase/${purchase.id}/signups">Записи (${signupsTotal})</a>
      <a class="btn ghost" href="/p/${purchase.id}" target="_blank">Открыть на сайте</a>
    </p>
    ${notice(msg)}

    <details class="box" ${products.length ? '' : raw('open')}>
      <summary><h2>Настройки закупки</h2></summary>
      <form method="post" action="/admin/purchase/${purchase.id}">
        ${purchaseFields(purchase)}
        <button class="btn">Сохранить</button>
      </form>
      <div class="row">
        <form method="post" action="/admin/purchase/${purchase.id}/duplicate" class="inline">
          <button class="btn ghost">Сделать копию (без записей)</button></form>
        <form method="post" action="/admin/purchase/${purchase.id}/delete" class="inline"
          data-confirm="Удалить закупку со всеми товарами, фото и записями? Это нельзя отменить.">
          <button class="btn danger">Удалить закупку</button></form>
      </div>
    </details>

    <form method="post" action="/admin/purchase/${purchase.id}/upload" enctype="multipart/form-data" class="box">
      <h2>Загрузить каталог (фото)</h2>
      <label class="drop">Выберите фото — можно сразу много
        <input type="file" name="photos" accept="image/*" multiple required></label>
      <div class="radios">
        <label><input type="radio" name="mode" value="each" checked> Каждое фото — отдельный товар</label>
        <label><input type="radio" name="mode" value="one"> Все фото — один товар (разные ракурсы)</label>
      </div>
      <label class="check"><input type="checkbox" name="article_from_name" checked> Артикул = имя файла (если фабрика называет файлы артикулами)</label>
      <details>
        <summary>Сразу задать новым товарам цену, размеры, цвета</summary>
        <div class="grid3"><label>Цена (закупочная) <input type="number" name="price" min="0" step="0.01"></label></div>
        ${optionFields()}
      </details>
      <button class="btn">Загрузить</button>
      <p class="muted small">Большие фото автоматически сжимаются. После загрузки отредактируйте товары ниже или отметьте несколько и задайте параметры всем сразу.</p>
    </form>

    <section class="box">
      <h2>Товары (${products.length})</h2>
      ${products.length ? html`
      <p class="row small">
        <button type="button" class="link" data-check-all="bulk">Выбрать все</button>
        <button type="button" class="link" data-uncheck-all="bulk">Снять выбор</button>
      </p>
      <div class="admin-products">
        ${products.map((p, i) => adminProductRow(p, purchase, i, products.length))}
      </div>

      <form method="post" action="/admin/purchase/${purchase.id}/bulk" id="bulk" class="bulk">
        <h3>Действия с выбранными товарами</h3>
        <div class="grid3"><label>Цена <input type="number" name="price" min="0" step="0.01"></label>
          <label>Видимость <select name="hidden"><option value="">не менять</option><option value="0">показать</option><option value="1">скрыть</option></select></label></div>
        ${optionFields([], { bulk: true })}
        <label>Описание (заменит текущее) <textarea name="description" rows="2"></textarea></label>
        <div class="row">
          <button class="btn" name="action" value="update">Применить к выбранным</button>
          <button class="btn ghost" name="action" value="merge" data-confirm="Объединить выбранные в один товар? Фото и записи перейдут в первый из них.">Объединить в один товар</button>
          <button class="btn danger" name="action" value="delete" data-confirm="Удалить выбранные товары вместе с записями?">Удалить выбранные</button>
        </div>
      </form>` : html`<p class="muted">Загрузите фото каталога — товары появятся здесь.</p>`}
    </section>`;
  return layout({ title: purchase.title, body, admin: true });
}

function adminProductRow(p, purchase, i, count) {
  const active = p.signups.filter((s) => s.status !== 'cancelled');
  const qty = active.reduce((n, s) => n + s.qty, 0);
  const get = (name) => p.options.find((o) => o.name === name)?.values.join(', ') ?? '';
  return html`
  <div class="aprod ${p.hidden ? 'is-hidden' : ''}" id="item-${p.id}">
    <label class="pick"><input type="checkbox" name="ids" value="${p.id}" form="bulk"></label>
    <a href="/admin/product/${p.id}" class="aprod-img">${p.photos[0]
      ? html`<img src="/uploads/${p.photos[0].thumb}" alt="" loading="lazy">` : html`<span>нет фото</span>`}
      ${p.photos.length > 1 ? html`<span class="count">${p.photos.length} фото</span>` : ''}</a>
    <form method="post" action="/admin/product/${p.id}/quick" class="aprod-form">
      <div class="grid3">
        <label>Название <input name="title" value="${p.title}"></label>
        <label>Артикул <input name="article" value="${p.article}"></label>
        <label>Цена${purchase.org_fee ? html` <span class="muted">(клиенту ${money(finalPrice(p.price, purchase.org_fee))})</span>` : ''}
          <input type="number" name="price" min="0" step="0.01" value="${p.price || ''}"></label>
      </div>
      <div class="grid2">
        <label>Размеры <input name="sizes" value="${get('Размер')}"></label>
        <label>Цвета <input name="colors" value="${get('Цвет')}"></label>
      </div>
      <div class="row small">
        <button class="btn sm">Сохранить</button>
        <a href="/admin/product/${p.id}">все настройки и фото</a>
        <span class="muted">${p.hidden ? 'скрыт · ' : ''}записей: ${active.length}${qty !== active.length ? ` (${qty} шт.)` : ''}</span>
      </div>
    </form>
    <div class="aprod-move">
      ${i > 0 ? html`<form method="post" action="/admin/product/${p.id}/move" class="inline"><input type="hidden" name="dir" value="-1"><button class="link" title="Выше">▲</button></form>` : ''}
      ${i < count - 1 ? html`<form method="post" action="/admin/product/${p.id}/move" class="inline"><input type="hidden" name="dir" value="1"><button class="link" title="Ниже">▼</button></form>` : ''}
    </div>
  </div>`;
}

export function productAdminPage({ product: p, purchase, signups, msg }) {
  const body = html`
    <p class="crumbs"><a href="/admin/purchase/${purchase.id}#item-${p.id}">← ${purchase.title}</a></p>
    <h1>${p.title || p.article || `Товар №${p.id}`}</h1>
    ${notice(msg)}
    <div class="two-col">
      <section class="box">
        <h2>Фото</h2>
        <div class="photo-admin">
          ${p.photos.map((ph, i) => html`
            <figure>
              <img src="/uploads/${ph.thumb}" data-full="/uploads/${ph.file}" alt="">
              <figcaption>
                ${i === 0 ? html`<b>главное</b>` : html`<form method="post" action="/admin/photo/${ph.id}/main" class="inline"><button class="link">сделать главным</button></form>`}
                <form method="post" action="/admin/photo/${ph.id}/delete" class="inline" data-confirm="Удалить фото?"><button class="link danger">удалить</button></form>
              </figcaption>
            </figure>`)}
        </div>
        <form method="post" action="/admin/product/${p.id}/photos" enctype="multipart/form-data">
          <label>Добавить фото <input type="file" name="photos" accept="image/*" multiple required></label>
          <button class="btn sm">Загрузить</button>
        </form>
      </section>

      <form method="post" action="/admin/product/${p.id}" class="box">
        <input type="hidden" name="full" value="1">
        <h2>Информация</h2>
        <label>Название <input name="title" value="${p.title}" maxlength="200"></label>
        <div class="grid3">
          <label>Артикул <input name="article" value="${p.article}" maxlength="100"></label>
          <label>Цена (закупочная) <input type="number" name="price" min="0" step="0.01" value="${p.price || ''}"></label>
          <label>Лимит, шт. (пусто — без лимита) <input type="number" name="max_qty" min="1" value="${p.max_qty ?? ''}"></label>
        </div>
        ${purchase.org_fee ? html`<p class="muted small">Клиенты видят цену с орг. сбором ${purchase.org_fee}%: ${money(finalPrice(p.price, purchase.org_fee))}</p>` : ''}
        ${optionFields(p.options)}
        <label>Описание (состав, размерная сетка и т.п.) <textarea name="description" rows="4">${p.description}</textarea></label>
        <label class="check"><input type="checkbox" name="hidden"${checked(p.hidden)}> Скрыть от клиентов</label>
        <button class="btn">Сохранить</button>
      </form>
    </div>

    <section class="box">
      <h2>Записи на товар (${signups.filter((s) => s.status !== 'cancelled').length})</h2>
      ${signupsTable(signups, { showProduct: false, back: `/admin/product/${p.id}` })}
      <details>
        <summary>Добавить запись вручную (клиент написал в личку)</summary>
        <form method="post" action="/admin/product/${p.id}/signup">
          ${signupFields({ choice: {}, qty: 1 }, p)}
          <button class="btn sm">Добавить</button>
        </form>
      </details>
    </section>

    <form method="post" action="/admin/product/${p.id}/delete" data-confirm="Удалить товар вместе с фото и записями?">
      <button class="btn danger">Удалить товар</button>
    </form>`;
  return layout({ title: p.title || 'Товар', body, admin: true });
}

function signupFields(s, product) {
  return html`
    <div class="grid3">
      ${product.options.map((o, i) => html`
        <label>${o.name}
          <select name="opt_${i}">
            <option value="">—</option>
            ${o.values.map((v) => html`<option${selected(v, s.choice[o.name])}>${v}</option>`)}
            ${s.choice[o.name] && !o.values.includes(s.choice[o.name]) ? html`<option selected>${s.choice[o.name]}</option>` : ''}
          </select></label>`)}
      <label>Количество <input type="number" name="qty" min="1" value="${s.qty}" required></label>
      <label>Имя <input name="name" value="${s.name ?? ''}" required maxlength="60"></label>
      <label>Контакт <input name="contact" value="${s.contact ?? ''}" maxlength="100"></label>
    </div>
    <label>Комментарий клиента <input name="comment" value="${s.comment ?? ''}" maxlength="500"></label>`;
}

function signupsTable(signups, { showProduct, back }) {
  if (!signups.length) return html`<p class="muted">Записей нет.</p>`;
  const formId = `sg-${Math.random().toString(36).slice(2, 8)}`;
  return html`
    <table class="tbl">
      <tr><th><input type="checkbox" data-toggle-all="${formId}"></th>${showProduct ? html`<th>Товар</th>` : ''}
        <th>Имя</th><th>Контакт</th><th>Параметры</th><th>Шт.</th><th>Комментарий</th><th>Статус</th><th>Когда</th><th></th></tr>
      ${signups.map((s) => html`<tr class="${s.status === 'cancelled' ? 'is-cancelled' : ''}">
        <td><input type="checkbox" name="ids" value="${s.id}" form="${formId}"></td>
        ${showProduct ? html`<td><a href="/admin/product/${s.product_id}">${s.product_title || s.article || `№${s.product_id}`}</a></td>` : ''}
        <td>${s.name}</td>
        <td>${s.contact}</td>
        <td>${choiceText(s.choice)}</td>
        <td>${s.qty}</td>
        <td>${s.comment}${s.note ? html`<div class="muted small">заметка: ${s.note}</div>` : ''}</td>
        <td><span class="st ${s.status}">${SIGNUP_STATUSES[s.status]}</span></td>
        <td class="nowrap muted">${date(s.created_at)}</td>
        <td><a href="/admin/signup/${s.id}">изменить</a></td>
      </tr>`)}
    </table>
    <form method="post" action="/admin/signups/bulk" id="${formId}" class="row">
      <input type="hidden" name="back" value="${back}">
      <select name="status">${Object.entries(SIGNUP_STATUSES).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select>
      <button class="btn sm" name="action" value="status">Поставить статус выбранным</button>
      <button class="btn sm danger" name="action" value="delete" data-confirm="Удалить выбранные записи?">Удалить выбранные</button>
    </form>`;
}

export function signupsAdminPage({ purchase, signups, msg }) {
  const active = signups.filter((s) => s.status !== 'cancelled');
  const fee = purchase.org_fee;

  // Сводка для заказа у фабрики: товар + параметры → количество
  const summary = new Map();
  for (const s of active) {
    const key = `${s.product_id}|${choiceText(s.choice)}`;
    if (!summary.has(key)) summary.set(key, { s, qty: 0 });
    summary.get(key).qty += s.qty;
  }
  const summaryRows = [...summary.values()].sort((a, b) => a.s.product_id - b.s.product_id);
  const factoryTotal = summaryRows.reduce((n, r) => n + r.s.price * r.qty, 0);

  // По клиентам: сколько каждый должен
  const clients = new Map();
  for (const s of active) {
    const key = `${s.name.trim().toLowerCase()}|${s.contact.trim().toLowerCase()}`;
    if (!clients.has(key)) clients.set(key, { name: s.name, contact: s.contact, items: 0, sum: 0, paid: 0 });
    const c = clients.get(key);
    const sum = finalPrice(s.price, fee) * s.qty;
    c.items += s.qty;
    c.sum += sum;
    if (s.status === 'paid' || s.status === 'delivered') c.paid += sum;
  }
  const clientRows = [...clients.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const clientsTotal = clientRows.reduce((n, c) => n + c.sum, 0);

  const body = html`
    <p class="crumbs"><a href="/admin/purchase/${purchase.id}">← ${purchase.title}</a></p>
    <h1>Записи: ${purchase.title}</h1>
    ${notice(msg)}
    <p class="row">
      <a class="btn" href="/admin/purchase/${purchase.id}/signups.csv">Скачать все записи (Excel/CSV)</a>
      <a class="btn ghost" href="/admin/purchase/${purchase.id}/factory.csv">Скачать заказ для фабрики (CSV)</a>
    </p>

    <section class="box">
      <h2>Заказ для фабрики</h2>
      ${summaryRows.length ? html`
      <table class="tbl">
        <tr><th>Товар</th><th>Артикул</th><th>Параметры</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr>
        ${summaryRows.map((r) => html`<tr>
          <td><a href="/admin/product/${r.s.product_id}">${r.s.product_title || `№${r.s.product_id}`}</a></td>
          <td>${r.s.article}</td><td>${choiceText(r.s.choice)}</td><td>${r.qty}</td>
          <td>${money(r.s.price)}</td><td>${money(r.s.price * r.qty)}</td></tr>`)}
        <tr class="total"><td colspan="3">Итого</td><td>${summaryRows.reduce((n, r) => n + r.qty, 0)}</td><td></td><td>${money(factoryTotal)}</td></tr>
      </table>` : html`<p class="muted">Пока нет записей.</p>`}
    </section>

    <section class="box">
      <h2>По клиентам</h2>
      ${clientRows.length ? html`
      <table class="tbl">
        <tr><th>Имя</th><th>Контакт</th><th>Шт.</th><th>К оплате${fee ? ` (с орг. ${fee}%)` : ''}</th><th>Оплачено</th></tr>
        ${clientRows.map((c) => html`<tr><td>${c.name}</td><td>${c.contact}</td><td>${c.items}</td>
          <td>${money(c.sum)}</td><td>${c.paid ? money(c.paid) : '—'}</td></tr>`)}
        <tr class="total"><td colspan="3">Итого</td><td>${money(clientsTotal)}</td><td></td></tr>
      </table>
      ${fee ? html`<p class="muted small">Орг. сбор: ${money(clientsTotal - factoryTotal)}</p>` : ''}` : html`<p class="muted">Пока нет записей.</p>`}
    </section>

    <section class="box">
      <h2>Все записи (${active.length})</h2>
      ${signupsTable(signups, { showProduct: true, back: `/admin/purchase/${purchase.id}/signups` })}
    </section>`;
  return layout({ title: 'Записи', body, admin: true });
}

export function signupAdminPage({ signup: s, product }) {
  const body = html`
    <p class="crumbs"><a href="/admin/product/${product.id}">← ${product.title || product.article || 'товар'}</a></p>
    <h1>Запись №${s.id}</h1>
    <form method="post" action="/admin/signup/${s.id}" class="box">
      ${signupFields(s, product)}
      <div class="grid2">
        <label>Статус <select name="status">${Object.entries(SIGNUP_STATUSES).map(([k, v]) => html`<option value="${k}"${selected(k, s.status)}>${v}</option>`)}</select></label>
        <label>Заметка (видите только вы) <input name="note" value="${s.note}" maxlength="500"></label>
      </div>
      <button class="btn">Сохранить</button>
    </form>
    <form method="post" action="/admin/signups/bulk" data-confirm="Удалить запись?">
      <input type="hidden" name="ids" value="${s.id}">
      <input type="hidden" name="back" value="/admin/product/${product.id}">
      <button class="btn danger" name="action" value="delete">Удалить запись</button>
    </form>`;
  return layout({ title: `Запись №${s.id}`, body, admin: true });
}
