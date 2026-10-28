// Общие помощники для страниц клиентов и админки.

import { html, raw } from '../html.js';
import { settings } from '../settings.js';

export const finalPrice = (price, fee) => Math.ceil(price * (1 + (fee || 0) / 100));

export function money(n) {
  return `${Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ')} ${settings().currency}`;
}

export function choiceText(choice) {
  return Object.entries(choice).map(([k, v]) => `${k}: ${v}`).join(', ');
}

export function dateTime(ts) {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function deadlineText(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

// «ещё 3 дня», «последний день», «завершена»
export function daysLeft(d) {
  if (!d) return '';
  const end = new Date(`${d}T23:59:59`);
  const days = Math.ceil((end - Date.now()) / 86400_000);
  if (days < 1) return 'срок прошёл';
  if (days === 1) return 'последний день';
  return `ещё ${days} ${plural(days, 'день', 'дня', 'дней')}`;
}

export function plural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

export const productName = (p) => p.title || (p.article ? `Арт. ${p.article}` : `Товар №${p.id}`);

export const selected = (a, b) => (String(a) === String(b) ? raw(' selected') : '');
export const checked = (v) => (v ? raw(' checked') : '');

export function notice(msg, kind = 'ok') {
  return msg ? html`<div class="notice ${kind}">${msg}</div>` : '';
}

export function head(title) {
  return html`<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title ? `${title} — ` : ''}${settings().site_name}</title>
<link rel="stylesheet" href="/static/style.css?v=2">`;
}

export const lightbox = html`<div id="lightbox" hidden><img alt=""><button type="button" class="lb-close" aria-label="Закрыть">×</button></div>`;
