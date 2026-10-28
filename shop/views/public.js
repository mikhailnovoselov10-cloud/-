// Страницы для клиентов.

import { html, raw, text } from '../html.js';
import { settings } from '../settings.js';
import { SIGNUP_STATUSES } from '../db.js';
import {
  finalPrice, money, choiceText, deadlineText, daysLeft, plural, productName, notice, head, lightbox,
} from './common.js';

function layout({ title, body, myCount = 0 }) {
  const s = settings();
  return html`<!doctype html>
<html lang="ru">
<head>${head(title)}</head>
<body class="site">
<header class="site-top">
  <div class="wrap site-top-in">
    <a class="site-logo" href="/">${s.site_name}</a>
    <nav class="site-nav">
      <a href="/">Закупки</a>
      <a href="/my" class="my-link">Мои записи${myCount ? html` <span class="pill">${myCount}</span>` : ''}</a>
    </nav>
  </div>
</header>
<main class="wrap site-main">${body}</main>
<footer class="site-foot">
  <div class="wrap">${s.contact ? html`Организатор: <b>${s.contact}</b>` : s.site_name}</div>
</footer>
${lightbox}
<script src="/static/app.js?v=2"></script>
</body>
</html>`;
}

const activeSignups = (p) => p.signups.filter((s) => s.status !== 'cancelled');

function statusLine(p) {
  if (p.status !== 'open') return html`<span class="tag stop">Запись закрыта</span>`;
  return html`<span class="tag open">Идёт запись</span>${p.deadline
    ? html`<span class="tag">до ${deadlineText(p.deadline)} · ${daysLeft(p.deadline)}</span>` : ''}`;
}

// ---------- Главная ----------

export function homePage({ purchases, myCount }) {
  const s = settings();
  const open = purchases.filter((p) => p.status === 'open');
  const stop = purchases.filter((p) => p.status === 'stop');
  const card = (p) => html`
    <a class="pcard" href="/p/${p.id}">
      <div class="pcard-img">${p.cover ? html`<img src="/uploads/${p.cover}" alt="" loading="lazy">` : html`<span>скоро фото</span>`}</div>
      <div class="pcard-body">
        <div class="tags">${statusLine(p)}</div>
        <h3>${p.title}</h3>
        <p class="muted">${p.products_count} ${plural(p.products_count, 'модель', 'модели', 'моделей')} · ${p.signups_count} ${plural(p.signups_count, 'запись', 'записи', 'записей')}</p>
      </div>
    </a>`;
  const body = html`
    <section class="hero">
      <h1>${s.site_name}</h1>
      ${s.welcome ? html`<p>${text(s.welcome)}</p>` : ''}
    </section>
    ${open.length ? html`<h2 class="section-title">Идёт запись</h2><div class="pcards">${open.map(card)}</div>` : ''}
    ${stop.length ? html`<h2 class="section-title">Запись закрыта</h2><div class="pcards">${stop.map(card)}</div>` : ''}
    ${purchases.length ? '' : html`<div class="empty">Сейчас нет открытых закупок. Загляните чуть позже!</div>`}`;
  return layout({ body, myCount });
}

// ---------- Закупка: каталог ----------

export function purchasePage({ purchase, products, myCount }) {
  const sizes = [...new Set(products.flatMap((p) => p.options.find((o) => o.name === 'Размер')?.values ?? []))];
  const long = purchase.description.length > 280;
  const body = html`
    <nav class="crumbs"><a href="/">Все закупки</a></nav>
    <section class="phead">
      <h1>${purchase.title}</h1>
      <div class="tags">${statusLine(purchase)}
        ${purchase.org_fee ? html`<span class="tag">цены с орг. сбором ${purchase.org_fee}%</span>` : ''}</div>
      ${purchase.description ? html`
        <div class="pdesc ${long ? 'clamp' : ''}">${text(purchase.description)}</div>
        ${long ? html`<button type="button" class="link" data-unclamp>Читать полностью</button>` : ''}` : ''}
    </section>

    ${products.length ? html`
    <div class="filters" id="filters">
      <input type="search" placeholder="Поиск по названию или артикулу" data-filter-search>
      <select data-filter-sort aria-label="Сортировка">
        <option value="">По порядку</option>
        <option value="asc">Сначала дешевле</option>
        <option value="desc">Сначала дороже</option>
        <option value="popular">Популярные</option>
      </select>
      ${sizes.length > 1 ? html`<div class="size-filter">
        <span class="muted">Размер:</span>
        ${sizes.map((v) => html`<button type="button" class="chip" data-filter-size="${v}">${v}</button>`)}
      </div>` : ''}
    </div>
    <p class="muted small" data-filter-empty hidden>Ничего не найдено — измените фильтр.</p>` : html`<div class="empty">Товары скоро появятся.</div>`}

    <div class="grid" id="catalog">
      ${products.map((p, i) => {
        const active = activeSignups(p);
        const names = [...new Set(active.map((s) => s.name))];
        const sz = p.options.find((o) => o.name === 'Размер')?.values ?? [];
        return html`
        <a class="item" href="/p/${purchase.id}/item/${p.id}" id="item-${p.id}"
           data-search="${`${p.title} ${p.article}`.toLowerCase()}" data-sizes="|${sz.join('|')}|"
           data-price="${p.price}" data-order="${i}" data-popular="${active.length}">
          <div class="item-img">
            ${p.photos[0] ? html`<img src="/uploads/${p.photos[0].thumb}" alt="" loading="lazy">` : html`<span>нет фото</span>`}
            ${p.photos.length > 1 ? html`<span class="item-count">${p.photos.length} фото</span>` : ''}
          </div>
          <div class="item-body">
            ${p.price ? html`<div class="item-price">${money(finalPrice(p.price, purchase.org_fee))}</div>` : ''}
            <div class="item-title">${productName(p)}</div>
            ${sz.length ? html`<div class="item-sizes">${sz.join(' · ')}</div>` : ''}
            <div class="item-who">${active.length
              ? html`👥 ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` и ещё ${names.length - 3}` : ''}`
              : html`<span class="muted">пока нет записей</span>`}</div>
          </div>
        </a>`;
      })}
    </div>`;
  return layout({ title: purchase.title, body, myCount });
}

// ---------- Товар: фото, запись, список записавшихся ----------

export function productPage({ purchase, product: p, prev, next, clientId, ok, error, myCount }) {
  const open = purchase.status === 'open';
  const active = activeSignups(p);
  const taken = active.reduce((n, s) => n + s.qty, 0);
  const left = p.max_qty ? p.max_qty - taken : null;
  const canSignup = open && (left === null || left > 0);
  const navLink = (x, label, cls) => (x ? html`<a class="pnav ${cls}" href="/p/${purchase.id}/item/${x.id}">${label}</a>` : html`<span class="pnav ${cls}"></span>`);

  const body = html`
    <nav class="crumbs"><a href="/">Закупки</a> / <a href="/p/${purchase.id}#item-${p.id}">${purchase.title}</a></nav>
    ${ok ? notice('Готово, вы записаны! Ваша запись — в списке ниже, все записи — в «Мои записи».') : ''}
    ${notice(error, 'err')}
    <div class="product">
      <div class="gallery">
        <div class="slides" data-slides>
          ${p.photos.length ? p.photos.map((ph) => html`<img src="/uploads/${ph.file}" alt="${productName(p)}" data-zoom>`)
            : html`<div class="no-photo">нет фото</div>`}
        </div>
        ${p.photos.length > 1 ? html`<div class="dots">${p.photos.map((ph, i) => html`
          <button type="button" class="gdot ${i === 0 ? 'on' : ''}" data-slide="${i}" aria-label="Фото ${i + 1}">
            <img src="/uploads/${ph.thumb}" alt=""></button>`)}</div>` : ''}
        <div class="pnavs">${navLink(prev, '← Предыдущая', 'prev')}${navLink(next, 'Следующая →', 'next')}</div>
      </div>

      <div class="pinfo">
        <h1>${productName(p)}</h1>
        ${p.title && p.article ? html`<div class="muted">Артикул: ${p.article}</div>` : ''}
        ${p.price ? html`<div class="big-price">${money(finalPrice(p.price, purchase.org_fee))}</div>` : html`<div class="muted">Цена уточняется</div>`}
        ${p.description ? html`<div class="pdesc">${text(p.description)}</div>` : ''}

        ${canSignup ? html`
        <form method="post" action="/p/${purchase.id}/item/${p.id}/signup" class="sform" id="signup">
          ${p.options.map((o, i) => html`
            <fieldset>
              <legend>${o.name}</legend>
              <div class="choices">
                ${o.values.map((v, j) => html`<label class="choice"><input type="radio" name="opt_${i}" value="${v}" required${o.values.length === 1 && j === 0 ? raw(' checked') : ''}><span>${v}</span></label>`)}
              </div>
            </fieldset>`)}
          <fieldset>
            <legend>Количество${left !== null ? html` <span class="muted">(осталось ${left})</span>` : ''}</legend>
            <div class="qty">
              <button type="button" data-qty="-1" aria-label="Меньше">−</button>
              <input type="number" name="qty" value="1" min="1" max="${left ?? 99}" inputmode="numeric">
              <button type="button" data-qty="1" aria-label="Больше">+</button>
            </div>
          </fieldset>
          <div class="two">
            <label>Имя <small>(видно в списке)</small><input name="name" maxlength="60" required data-remember="name" autocomplete="given-name"></label>
            <label>Телефон или Telegram <small>(видит только организатор)</small><input name="contact" maxlength="100" required data-remember="contact" autocomplete="tel"></label>
          </div>
          <label>Комментарий <small>(необязательно)</small><input name="comment" maxlength="500"></label>
          <button class="btn big">Записаться</button>
        </form>` : html`
        <div class="closed">${open ? 'Все места на эту модель заняты.' : 'Запись в эту закупку закрыта.'}</div>`}

        <section class="wholist">
          <h2>Записались ${active.length ? html`<span class="pill">${active.length}</span>` : ''}</h2>
          ${active.length ? html`<ol>${active.map((s) => html`
            <li class="${s.client_id === clientId ? 'mine' : ''}">
              <b>${s.name}</b>
              <span>${choiceText(s.choice)}${s.qty > 1 ? ` × ${s.qty}` : ''}</span>
              ${s.client_id === clientId && open ? html`
                <form method="post" action="/signup/${s.id}/cancel" data-confirm="Отменить вашу запись?">
                  <button class="link danger">отменить</button></form>` : ''}
            </li>`)}</ol>` : html`<p class="muted">Пока никто не записался — будьте первым!</p>`}
        </section>
      </div>
    </div>`;
  return layout({ title: productName(p), body, myCount });
}

// ---------- Мои записи ----------

export function myPage({ signups }) {
  const active = signups.filter((s) => s.status !== 'cancelled');
  const groups = new Map();
  for (const s of active) {
    if (!groups.has(s.purchase_id)) groups.set(s.purchase_id, { s, items: [] });
    groups.get(s.purchase_id).items.push(s);
  }
  const body = html`
    <h1>Мои записи</h1>
    <p class="muted">Записи сохраняются в этом браузере. Отменить запись можно, пока идёт запись в закупку.</p>
    ${active.length ? '' : html`<div class="empty">Вы пока никуда не записались. <a href="/">Посмотреть закупки →</a></div>`}
    ${[...groups.values()].map(({ s: first, items }) => {
      const total = items.reduce((n, s) => n + finalPrice(s.price, s.org_fee) * s.qty, 0);
      return html`
      <section class="mygroup">
        <div class="mygroup-head">
          <h2><a href="/p/${first.purchase_id}">${first.purchase_title}</a></h2>
          <span class="tag ${first.purchase_status === 'open' ? 'open' : 'stop'}">${first.purchase_status === 'open' ? 'Идёт запись' : 'Запись закрыта'}</span>
        </div>
        ${items.map((s) => html`
          <div class="myitem">
            <a href="/p/${s.purchase_id}/item/${s.product_id}">${s.thumb ? html`<img src="/uploads/${s.thumb}" alt="">` : html`<span class="noimg"></span>`}</a>
            <div class="myitem-info">
              <a href="/p/${s.purchase_id}/item/${s.product_id}"><b>${s.product_title || (s.article ? `Арт. ${s.article}` : 'Товар')}</b></a>
              <div class="muted small">${choiceText(s.choice)}${s.qty > 1 ? ` · ${s.qty} шт.` : ''}</div>
              <span class="st ${s.status}">${SIGNUP_STATUSES[s.status]}</span>
            </div>
            <div class="myitem-sum">
              ${s.price ? money(finalPrice(s.price, s.org_fee) * s.qty) : html`<span class="muted">цена уточняется</span>`}
              ${s.purchase_status === 'open' ? html`
                <form method="post" action="/signup/${s.id}/cancel" data-confirm="Отменить запись?">
                  <input type="hidden" name="back" value="/my"><button class="link danger small">отменить</button></form>` : ''}
            </div>
          </div>`)}
        <div class="mytotal">Итого: <b>${money(total)}</b></div>
        ${first.pay_info ? html`<div class="payinfo"><b>Оплата:</b> ${text(first.pay_info)}</div>` : ''}
      </section>`;
    })}`;
  return layout({ title: 'Мои записи', body, myCount: active.length });
}

export function errorPage(status, message) {
  return layout({
    title: 'Ошибка',
    body: html`<div class="empty"><h1>${status === 404 ? 'Не найдено' : 'Ошибка'}</h1><p>${message}</p><p><a href="/">На главную</a></p></div>`,
  });
}
