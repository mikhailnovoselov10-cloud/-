// Сайт совместных закупок: клиенты смотрят каталог и записываются, админ всё настраивает.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { PORT, ADMIN_PASSWORD, SESSION_SECRET, UPLOAD_DIR } from './config.js';
import * as db from './db.js';
import { settings, updateSettings, SETTING_KEYS } from './settings.js';
import * as site from './views/public.js';
import * as admin from './views/admin.js';
import { finalPrice, choiceText, productName } from './views/common.js';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/static', express.static(path.join(import.meta.dirname, 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 300 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

// ---------- Cookies и вход ----------

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, name, value, maxAgeDays) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(maxAgeDays * 86400)}`);
}

const sign = (v) => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');

function isAdmin(req) {
  const [exp, sig] = (cookies(req).admin || '').split('.');
  if (!ADMIN_PASSWORD || !exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(`admin:${exp}`);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// Анонимный идентификатор клиента: по нему видно «мои записи» и можно отменить свою
app.use((req, res, next) => {
  let cid = cookies(req).cid;
  if (!/^[a-f0-9]{32}$/.test(cid || '')) {
    cid = crypto.randomBytes(16).toString('hex');
    setCookie(res, 'cid', cid, 365 * 3);
  }
  req.clientId = cid;
  next();
});

const loginAttempts = new Map();

// ---------- Помощники ----------

const str = (v, max = 500) => String([v].flat()[0] ?? '').trim().slice(0, max);
const num = (v) => {
  const n = Number(str(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const ids = (v) => [v].flat().flatMap((x) => String(x ?? '').split(',')).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const list = (s) => [...new Set(String(s ?? '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];
const safeBack = (b, fallback) => (typeof b === 'string' && /^\/[^/\\]/.test(b) ? b : fallback);
const withMsg = (url, msg) => {
  const [base, hash] = url.split('#');
  return `${base}${base.includes('?') ? '&' : '?'}msg=${encodeURIComponent(msg)}${hash ? `#${hash}` : ''}`;
};
const contactKey = (c) => String(c ?? '').trim().toLowerCase();

// Размеры, цвета и «Название: значения» построчно → [{ name, values }]
function parseOptions(body, { keepEmpty = false } = {}) {
  const options = [];
  const sizes = list(str(body.sizes));
  const colors = list(str(body.colors));
  if (sizes.length || keepEmpty) options.push({ name: 'Размер', values: sizes });
  if (colors.length || keepEmpty) options.push({ name: 'Цвет', values: colors });
  for (const line of str(body.extra, 5000).split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().slice(0, 50);
    const values = list(line.slice(i + 1));
    if (name && values.length && !options.some((o) => o.name === name)) options.push({ name, values });
  }
  return keepEmpty ? options : options.filter((o) => o.values.length);
}

function purchaseData(body, current = {}) {
  const status = str(body.status);
  return {
    title: str(body.title, 200) || 'Без названия',
    description: str(body.description, 5000),
    status: status in db.PURCHASE_STATUSES ? status : (current.status ?? 'draft'),
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(str(body.deadline)) ? str(body.deadline) : '',
    org_fee: Math.min(num(body.org_fee), 1000),
    pay_info: str(body.pay_info, 2000),
  };
}

// Сохраняет фото уменьшенным (до 1600px) и превью (600px), возвращает имена файлов
async function savePhoto(file) {
  const base = crypto.randomBytes(12).toString('hex');
  const img = sharp(file.buffer, { failOn: 'none' }).rotate();
  const name = `${base}.webp`;
  const thumb = `${base}_t.webp`;
  await img.clone().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 })
    .toFile(path.join(UPLOAD_DIR, name));
  await img.clone().resize(600, 600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 })
    .toFile(path.join(UPLOAD_DIR, thumb));
  return { file: name, thumb };
}

function removeFiles(files) {
  for (const f of files) {
    if (db.photoFileUsage(f.file) > 0) continue; // файл ещё нужен копии закупки
    for (const n of [f.file, f.thumb]) fs.rm(path.join(UPLOAD_DIR, path.basename(n)), { force: true }, () => {});
  }
}

function csv(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

function sendCsv(res, filename, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(csv(rows));
}

async function notifyTelegram(textMsg) {
  const { tg_bot_token: token, tg_chat_id: chat } = settings();
  if (!token || !chat) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: textMsg }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error('Telegram:', r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error('Telegram:', e.message);
    return false;
  }
}

// Клиенты из записей: группировка по контакту, суммы с орг. сбором
function aggregateClients(signups) {
  const map = new Map();
  for (const s of signups) {
    if (s.status === 'cancelled') continue;
    const key = contactKey(s.contact) || `name:${s.name.toLowerCase()}`;
    if (!map.has(key)) map.set(key, { key, name: s.name, contact: s.contact, items: 0, sum: 0, paid: 0, purchaseIds: new Set(), last: 0 });
    const c = map.get(key);
    const sum = finalPrice(s.price, s.org_fee) * s.qty;
    c.items += s.qty;
    c.sum += sum;
    if (s.status === 'paid' || s.status === 'delivered') c.paid += sum;
    c.purchaseIds.add(s.purchase_id);
    if (s.created_at > c.last) { c.last = s.created_at; c.name = s.name; }
  }
  return [...map.values()].map((c) => ({ ...c, purchases: c.purchaseIds.size }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

const page = (res, v) => res.send(String(v));
const myCount = (req) => db.listClientSignups(req.clientId).filter((s) => s.status !== 'cancelled').length;
const notFound = (res, msg = 'Страница не найдена.') => res.status(404).send(String(site.errorPage(404, msg)));

// ---------- Клиентская часть ----------

app.get('/', (req, res) => page(res, site.homePage({ purchases: db.listPurchases({ publicOnly: true }), myCount: myCount(req) })));

function visiblePurchase(id, req) {
  const p = db.getPurchase(Number(id));
  if (!p) return null;
  if ((p.status === 'draft' || p.status === 'archive') && !isAdmin(req)) return null;
  return p;
}

app.get('/p/:id', (req, res) => {
  const purchase = visiblePurchase(req.params.id, req);
  if (!purchase) return notFound(res, 'Закупка не найдена или ещё не открыта.');
  page(res, site.purchasePage({ purchase, products: db.listProducts(purchase.id, { publicOnly: true }), myCount: myCount(req) }));
});

app.get('/p/:id/item/:productId', (req, res) => {
  const purchase = visiblePurchase(req.params.id, req);
  if (!purchase) return notFound(res, 'Закупка не найдена или ещё не открыта.');
  const products = db.listProducts(purchase.id, { publicOnly: true });
  const i = products.findIndex((p) => p.id === Number(req.params.productId));
  if (i < 0) return notFound(res, 'Товар не найден.');
  page(res, site.productPage({
    purchase,
    product: products[i],
    prev: products[i - 1],
    next: products[i + 1],
    clientId: req.clientId,
    ok: req.query.ok,
    error: str(req.query.error, 200),
    myCount: myCount(req),
  }));
});

const signupHits = new Map();

app.post('/p/:id/item/:productId/signup', (req, res) => {
  const purchase = visiblePurchase(req.params.id, req);
  const product = db.getProduct(Number(req.params.productId));
  if (!purchase || !product || product.purchase_id !== purchase.id || product.hidden) return notFound(res);
  const base = `/p/${purchase.id}/item/${product.id}`;
  const fail = (msg) => res.redirect(`${base}?error=${encodeURIComponent(msg)}#signup`);

  // Не больше 30 записей за 10 минут с одного адреса
  const hits = (signupHits.get(req.ip) || []).filter((t) => t > Date.now() - 600_000);
  if (hits.length >= 30) return fail('Слишком много записей подряд, попробуйте позже.');
  signupHits.set(req.ip, [...hits, Date.now()]);

  if (purchase.status !== 'open') return fail('Запись в эту закупку закрыта.');
  const name = str(req.body.name, 60);
  const contact = str(req.body.contact, 100);
  if (!name || !contact) return fail('Укажите имя и контакт.');
  const choice = {};
  for (const [i, o] of product.options.entries()) {
    const v = str(req.body[`opt_${i}`], 100);
    if (!o.values.includes(v)) return fail(`Выберите «${o.name}».`);
    choice[o.name] = v;
  }
  const qty = Math.max(1, Math.min(99, Math.floor(num(req.body.qty)) || 1));

  const created = db.transaction(() => {
    if (product.max_qty && db.productTakenQty(product.id) + qty > product.max_qty) return false;
    db.createSignup({ product_id: product.id, client_id: req.clientId, name, contact, choice, qty, comment: str(req.body.comment) });
    return true;
  });
  if (!created) return fail('Столько штук уже нет — уменьшите количество.');

  notifyTelegram(`🛍 Новая запись — ${purchase.title}\n${productName(product)}`
    + `${Object.keys(choice).length ? `\n${choiceText(choice)}` : ''} × ${qty}\n${name}, ${contact}`
    + `${req.body.comment ? `\n💬 ${str(req.body.comment)}` : ''}`);
  res.redirect(`${base}?ok=1#signup`);
});

app.post('/signup/:id/cancel', (req, res) => {
  const s = db.getSignup(Number(req.params.id));
  if (!s || s.client_id !== req.clientId) return notFound(res);
  const product = db.getProduct(s.product_id);
  const purchase = db.getPurchase(product.purchase_id);
  if (purchase.status === 'open') db.setSignupStatus([s.id], 'cancelled');
  res.redirect(safeBack(req.body.back, `/p/${purchase.id}/item/${product.id}`));
});

app.get('/my', (req, res) => page(res, site.myPage({ signups: db.listClientSignups(req.clientId) })));

// ---------- Вход в админку ----------

app.get('/admin/login', (req, res) => page(res, admin.loginPage('', !ADMIN_PASSWORD)));

app.post('/admin/login', (req, res) => {
  const tries = (loginAttempts.get(req.ip) || []).filter((t) => t > Date.now() - 900_000);
  if (tries.length >= 10) return page(res.status(429), admin.loginPage('Слишком много попыток. Подождите 15 минут.'));
  const given = crypto.createHash('sha256').update(str(req.body.password, 200)).digest();
  const real = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!ADMIN_PASSWORD || !crypto.timingSafeEqual(given, real)) {
    loginAttempts.set(req.ip, [...tries, Date.now()]);
    return page(res.status(401), admin.loginPage('Неверный пароль.', !ADMIN_PASSWORD));
  }
  loginAttempts.delete(req.ip);
  const exp = String(Date.now() + 30 * 86400_000);
  setCookie(res, 'admin', `${exp}.${sign(`admin:${exp}`)}`, 30);
  res.redirect('/admin');
});

app.post('/admin/logout', (req, res) => {
  setCookie(res, 'admin', '', 0);
  res.redirect('/');
});

app.use('/admin', (req, res, next) => {
  if (isAdmin(req)) {
    // Данные бокового меню
    req.nav = {
      purchases: db.listPurchases().filter((p) => p.status !== 'archive'),
      newSignups: db.dashboardStats().newSignups,
    };
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Войдите в админку заново' });
  if (req.method === 'GET') return res.redirect('/admin/login');
  res.status(403).send('Войдите в админку заново');
});

const adminNotFound = (req, res, msg) => res.status(404).send(String(admin.errorPage(404, msg, req.nav)));

// ---------- Главная, закупки ----------

app.get('/admin', (req, res) => {
  page(res, admin.dashboardPage({
    nav: req.nav,
    stats: db.dashboardStats(),
    purchases: db.listPurchases(),
    recent: db.searchSignups({ limit: 15 }),
  }));
});

app.get('/admin/purchases', (req, res) => {
  const status = str(req.query.status);
  page(res, admin.purchasesPage({ nav: req.nav, purchases: db.listPurchases(), status: status in db.PURCHASE_STATUSES ? status : '' }));
});

app.get('/admin/purchases/new', (req, res) => page(res, admin.newPurchasePage({ nav: req.nav })));

app.post('/admin/purchases', (req, res) => {
  const id = db.createPurchase(purchaseData(req.body));
  res.redirect(withMsg(`/admin/purchase/${id}/products`, 'Закупка создана. Загрузите фото каталога.'));
});

function adminPurchase(req, res) {
  const p = db.getPurchase(Number(req.params.id));
  if (!p) adminNotFound(req, res, 'Закупка не найдена.');
  return p;
}

function adminProduct(req, res) {
  const p = db.getProduct(Number(req.params.id));
  if (!p) adminNotFound(req, res, 'Товар не найден.');
  return p;
}

// Счётчики для вкладок закупки
function purchaseCounts(purchaseId, signups) {
  const statuses = { '': signups.length };
  for (const s of signups) statuses[s.status] = (statuses[s.status] || 0) + 1;
  return {
    products: db.listProducts(purchaseId).length,
    signups: signups.filter((s) => s.status !== 'cancelled').length,
    statuses,
  };
}

app.get('/admin/purchase/:id', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (purchase) res.redirect(`/admin/purchase/${purchase.id}/products`);
});

app.get('/admin/purchase/:id/products', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const signups = db.searchSignups({ purchaseId: purchase.id });
  page(res, admin.productsTab({
    nav: req.nav, purchase, products: db.listProducts(purchase.id), counts: purchaseCounts(purchase.id, signups), msg: str(req.query.msg, 200),
  }));
});

app.get('/admin/purchase/:id/signups', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const all = db.searchSignups({ purchaseId: purchase.id });
  const status = str(req.query.status);
  const q = str(req.query.q, 100);
  const signups = status || q ? db.searchSignups({ purchaseId: purchase.id, status, q }) : all;
  page(res, admin.signupsTab({
    nav: req.nav, purchase, signups, counts: purchaseCounts(purchase.id, all), status, q, msg: str(req.query.msg, 200),
  }));
});

app.get('/admin/purchase/:id/factory', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const signups = db.searchSignups({ purchaseId: purchase.id }).reverse();
  page(res, admin.factoryTab({ nav: req.nav, purchase, signups, counts: purchaseCounts(purchase.id, signups) }));
});

app.get('/admin/purchase/:id/clients', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const signups = db.searchSignups({ purchaseId: purchase.id });
  page(res, admin.clientsTab({
    nav: req.nav, purchase, clients: aggregateClients(signups), counts: purchaseCounts(purchase.id, signups), msg: str(req.query.msg, 200),
  }));
});

app.get('/admin/purchase/:id/settings', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const signups = db.searchSignups({ purchaseId: purchase.id });
  page(res, admin.settingsTab({ nav: req.nav, purchase, counts: purchaseCounts(purchase.id, signups), msg: str(req.query.msg, 200) }));
});

app.post('/admin/purchase/:id', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  db.updatePurchase(purchase.id, purchaseData(req.body, purchase));
  res.redirect(withMsg(`/admin/purchase/${purchase.id}/settings`, 'Сохранено'));
});

app.post('/admin/api/purchase/:id/status', (req, res) => {
  const purchase = db.getPurchase(Number(req.params.id));
  const status = str(req.body.status);
  if (!purchase || !(status in db.PURCHASE_STATUSES)) return res.status(400).json({ error: 'Неверный статус' });
  db.setPurchaseStatus(purchase.id, status);
  res.json({ ok: true, message: `Статус: ${db.PURCHASE_STATUSES[status]}` });
});

app.post('/admin/api/purchase/:id/order', (req, res) => {
  const purchase = db.getPurchase(Number(req.params.id));
  if (!purchase) return res.status(404).json({ error: 'Закупка не найдена' });
  db.reorderProducts(purchase.id, ids(req.body.ids));
  res.json({ ok: true, message: 'Порядок сохранён' });
});

app.post('/admin/purchase/:id/client-paid', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const key = str(req.body.contact, 100);
  const toPay = db.searchSignups({ purchaseId: purchase.id })
    .filter((s) => (contactKey(s.contact) || `name:${s.name.toLowerCase()}`) === key && ['new', 'confirmed'].includes(s.status));
  db.setSignupStatus(toPay.map((s) => s.id), 'paid');
  res.redirect(withMsg(`/admin/purchase/${purchase.id}/clients`, `Отмечено оплаченными: ${toPay.length}`));
});

app.post('/admin/purchase/:id/duplicate', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const id = db.duplicatePurchase(purchase.id);
  res.redirect(withMsg(`/admin/purchase/${id}/settings`, 'Копия создана (черновик). Поменяйте название и даты.'));
});

app.post('/admin/purchase/:id/delete', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  removeFiles(db.deletePurchase(purchase.id));
  res.redirect('/admin/purchases');
});

// Загрузка фото каталога. Из админки фото приходят частями (fetch), ответ — JSON
app.post('/admin/purchase/:id/upload', upload.array('photos'), async (req, res) => {
  const purchase = db.getPurchase(Number(req.params.id));
  if (!purchase) return res.status(404).json({ error: 'Закупка не найдена' });
  const files = (req.files || []).sort((a, b) => a.originalname.localeCompare(b.originalname, 'ru', { numeric: true }));
  const defaults = { price: num(req.body.price), options: parseOptions(req.body) };
  // multer отдаёт имя файла в latin1
  const stem = (f) => Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/\.[^.]+$/, '').slice(0, 100);
  const article = (f) => (req.body.article_from_name ? stem(f) : '');

  // В режиме «один товар» следующие части догружаются в уже созданный товар
  let productId = Number(req.body.product_id) || null;
  if (productId && db.getProduct(productId)?.purchase_id !== purchase.id) productId = null;
  let saved = 0;
  for (const f of files) {
    let photo;
    try {
      photo = await savePhoto(f);
    } catch (e) {
      console.error('Фото не сохранено:', f.originalname, e.message);
      continue;
    }
    if (req.body.mode !== 'one' || !productId) {
      productId = db.createProduct(purchase.id, { ...defaults, article: article(f) });
    }
    db.addPhoto(productId, photo.file, photo.thumb);
    saved++;
  }
  res.json({ saved, failed: files.length - saved, productId });
});

app.post('/admin/purchase/:id/bulk', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const selected = ids(req.body.ids).filter((id) => db.getProduct(id)?.purchase_id === purchase.id);
  const back = `/admin/purchase/${purchase.id}/products`;
  const go = (msg) => res.redirect(withMsg(back, msg));
  if (!selected.length) return go('Не выбрано ни одного товара');
  const action = str(req.body.action);
  if (action === 'delete') {
    removeFiles(db.deleteProducts(selected));
    return go(`Удалено товаров: ${selected.length}`);
  }
  if (action === 'merge') {
    if (selected.length < 2) return go('Для объединения выберите хотя бы два товара');
    const id = db.mergeProducts(selected);
    return res.redirect(withMsg(`/admin/product/${id}`, 'Товары объединены'));
  }
  if (action === 'hide' || action === 'show') {
    db.bulkUpdateProducts(selected, { hidden: action === 'hide' ? 1 : 0 });
    return go(action === 'hide' ? `Скрыто товаров: ${selected.length}` : `Показано товаров: ${selected.length}`);
  }
  const options = parseOptions(req.body);
  db.bulkUpdateProducts(selected, {
    price: str(req.body.price) ? num(req.body.price) : undefined,
    options: options.length ? options : undefined,
    description: str(req.body.description) ? str(req.body.description, 5000) : undefined,
  });
  go(`Изменено товаров: ${selected.length}`);
});

app.get('/admin/purchase/:id/signups.csv', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const rows = [['№', 'Дата', 'Товар', 'Артикул', 'Параметры', 'Кол-во', 'Цена клиенту', 'Сумма', 'Имя', 'Контакт', 'Комментарий', 'Статус', 'Заметка']];
  for (const s of db.searchSignups({ purchaseId: purchase.id }).reverse()) {
    const price = finalPrice(s.price, purchase.org_fee);
    rows.push([s.id, new Date(s.created_at).toLocaleString('ru-RU'), s.product_title, s.article, choiceText(s.choice),
      s.qty, price, price * s.qty, s.name, s.contact, s.comment, db.SIGNUP_STATUSES[s.status], s.note]);
  }
  sendCsv(res, `Записи — ${purchase.title}.csv`, rows);
});

app.get('/admin/purchase/:id/factory.csv', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const summary = new Map();
  for (const s of db.searchSignups({ purchaseId: purchase.id }).reverse()) {
    if (s.status === 'cancelled') continue;
    const key = `${s.product_id}|${choiceText(s.choice)}`;
    if (!summary.has(key)) summary.set(key, { s, qty: 0 });
    summary.get(key).qty += s.qty;
  }
  const rows = [['Товар', 'Артикул', 'Параметры', 'Кол-во', 'Цена', 'Сумма']];
  for (const { s, qty } of [...summary.values()].sort((a, b) => a.s.product_id - b.s.product_id)) {
    rows.push([s.product_title, s.article, choiceText(s.choice), qty, s.price, s.price * qty]);
  }
  sendCsv(res, `Заказ фабрике — ${purchase.title}.csv`, rows);
});

// ---------- Товар ----------

app.get('/admin/product/:id', (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  const purchase = db.getPurchase(product.purchase_id);
  const products = db.listProducts(purchase.id);
  const i = products.findIndex((p) => p.id === product.id);
  page(res, admin.productPage({
    nav: req.nav,
    product,
    purchase,
    signups: db.searchSignups({ purchaseId: purchase.id }).filter((s) => s.product_id === product.id),
    prev: products[i - 1],
    next: products[i + 1],
    msg: str(req.query.msg, 200),
  }));
});

app.post('/admin/product/:id', (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  db.updateProduct(product.id, {
    title: str(req.body.title, 200),
    article: str(req.body.article, 100),
    description: str(req.body.description, 5000),
    price: num(req.body.price),
    max_qty: Math.floor(num(req.body.max_qty)) || null,
    hidden: !!req.body.hidden,
    options: parseOptions(req.body),
  });
  if (req.body.then === 'next') {
    const products = db.listProducts(product.purchase_id);
    const next = products[products.findIndex((p) => p.id === product.id) + 1];
    if (next) return res.redirect(withMsg(`/admin/product/${next.id}`, 'Предыдущий товар сохранён'));
  }
  res.redirect(withMsg(`/admin/product/${product.id}`, 'Сохранено'));
});

app.post('/admin/product/:id/delete', (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  removeFiles(db.deleteProducts([product.id]));
  res.redirect(withMsg(`/admin/purchase/${product.purchase_id}/products`, 'Товар удалён'));
});

app.post('/admin/product/:id/photos', upload.array('photos'), async (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  let saved = 0;
  for (const f of req.files || []) {
    try {
      const photo = await savePhoto(f);
      db.addPhoto(product.id, photo.file, photo.thumb);
      saved++;
    } catch (e) {
      console.error('Фото не сохранено:', f.originalname, e.message);
    }
  }
  res.redirect(withMsg(`/admin/product/${product.id}`, `Добавлено фото: ${saved}`));
});

function signupData(body, product) {
  const choice = {};
  for (const [i, o] of product.options.entries()) {
    const v = str(body[`opt_${i}`], 100);
    if (v) choice[o.name] = v;
  }
  return {
    name: str(body.name, 60) || 'Без имени',
    contact: str(body.contact, 100),
    choice,
    qty: Math.max(1, Math.floor(num(body.qty)) || 1),
    comment: str(body.comment),
  };
}

app.post('/admin/product/:id/signup', (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  db.createSignup({ product_id: product.id, client_id: 'admin', ...signupData(req.body, product) });
  res.redirect(withMsg(`/admin/product/${product.id}`, 'Запись добавлена'));
});

app.post('/admin/photo/:id/main', (req, res) => {
  const ph = db.getPhoto(Number(req.params.id));
  if (!ph) return adminNotFound(req, res, 'Фото не найдено.');
  db.makePhotoMain(ph.id);
  res.redirect(`/admin/product/${ph.product_id}`);
});

app.post('/admin/photo/:id/delete', (req, res) => {
  const ph = db.getPhoto(Number(req.params.id));
  if (!ph) return adminNotFound(req, res, 'Фото не найдено.');
  db.deletePhoto(ph.id);
  removeFiles([ph]);
  res.redirect(withMsg(`/admin/product/${ph.product_id}`, 'Фото удалено'));
});

// ---------- Записи ----------

app.get('/admin/signups', (req, res) => {
  const status = str(req.query.status);
  const q = str(req.query.q, 100);
  const purchaseId = Number(req.query.purchase) || null;
  const scope = db.searchSignups({ purchaseId });
  const statusCounts = { '': scope.length };
  for (const s of scope) statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
  page(res, admin.allSignupsPage({
    nav: req.nav,
    signups: db.searchSignups({ purchaseId, status, q, limit: 500 }),
    status, q, purchaseId, statusCounts,
    purchases: db.listPurchases(),
    msg: str(req.query.msg, 200),
  }));
});

app.get('/admin/signup/:id', (req, res) => {
  const signup = db.getSignup(Number(req.params.id));
  if (!signup) return adminNotFound(req, res, 'Запись не найдена.');
  const product = db.getProduct(signup.product_id);
  page(res, admin.signupPage({ nav: req.nav, signup, product, purchase: db.getPurchase(product.purchase_id) }));
});

app.post('/admin/signup/:id', (req, res) => {
  const signup = db.getSignup(Number(req.params.id));
  if (!signup) return adminNotFound(req, res, 'Запись не найдена.');
  const product = db.getProduct(signup.product_id);
  const status = str(req.body.status);
  db.updateSignup(signup.id, {
    ...signupData(req.body, product),
    status: status in db.SIGNUP_STATUSES ? status : signup.status,
    note: str(req.body.note),
  });
  res.redirect(withMsg(`/admin/product/${product.id}`, 'Запись сохранена'));
});

app.post('/admin/api/signup/:id/status', (req, res) => {
  const signup = db.getSignup(Number(req.params.id));
  const status = str(req.body.status);
  if (!signup || !(status in db.SIGNUP_STATUSES)) return res.status(400).json({ error: 'Неверный статус' });
  db.setSignupStatus([signup.id], status);
  res.json({ ok: true, message: `Статус: ${db.SIGNUP_STATUSES[status]}` });
});

app.post('/admin/signups/bulk', (req, res) => {
  const selected = ids(req.body.ids);
  const back = safeBack(req.body.back, '/admin');
  if (!selected.length) return res.redirect(withMsg(back, 'Не выбрано ни одной записи'));
  if (str(req.body.action) === 'delete') {
    db.deleteSignups(selected);
    return res.redirect(withMsg(back, `Удалено записей: ${selected.length}`));
  }
  const status = str(req.body.status);
  if (status in db.SIGNUP_STATUSES) db.setSignupStatus(selected, status);
  res.redirect(withMsg(back, `Статус изменён: ${selected.length}`));
});

// ---------- Клиенты ----------

app.get('/admin/clients', (req, res) => {
  const q = str(req.query.q, 100).toLowerCase();
  let clients = aggregateClients(db.searchSignups({ limit: 100000 }));
  if (q) clients = clients.filter((c) => c.name.toLowerCase().includes(q) || c.contact.toLowerCase().includes(q));
  page(res, admin.clientsPage({ nav: req.nav, clients, q }));
});

app.get('/admin/clients/view', (req, res) => {
  const key = str(req.query.c, 100);
  const all = db.searchSignups({ limit: 100000 });
  const signups = all.filter((s) => (contactKey(s.contact) || `name:${s.name.toLowerCase()}`) === key);
  const [client] = aggregateClients(signups);
  if (!signups.length) return adminNotFound(req, res, 'Клиент не найден.');
  page(res, admin.clientPage({ nav: req.nav, client: client ?? { key, name: signups[0].name, contact: signups[0].contact, items: 0, sum: 0, paid: 0 }, signups }));
});

// ---------- Настройки ----------

app.get('/admin/settings', (req, res) => page(res, admin.settingsPage({ nav: req.nav, s: settings(), msg: str(req.query.msg, 200) })));

app.post('/admin/settings', async (req, res) => {
  const values = {};
  for (const k of SETTING_KEYS) values[k] = str(req.body[k], 2000);
  values.site_name ||= 'Совместные закупки';
  values.currency ||= '₽';
  updateSettings(values);
  let msg = 'Настройки сохранены';
  if (req.body.test) {
    msg = await notifyTelegram('✅ Уведомления о записях работают') ? 'Сохранено, тестовое сообщение отправлено в Telegram'
      : 'Сохранено, но сообщение в Telegram не ушло — проверьте токен, chat id и что вы написали боту /start';
  }
  res.redirect(withMsg('/admin/settings', msg));
});

// ---------- Ошибки ----------

app.use((req, res) => notFound(res));

app.use((err, req, res, next) => {
  console.error(err);
  const msg = err instanceof multer.MulterError
    ? (err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 25 МБ.' : 'Слишком много файлов за раз.')
    : 'Что-то пошло не так. Попробуйте ещё раз.';
  if (req.path.includes('/api/') || req.path.endsWith('/upload')) return res.status(500).json({ error: msg });
  res.status(500).send(String(site.errorPage(500, msg)));
});

app.listen(PORT, () => {
  console.log(`Сайт закупок: http://localhost:${PORT}  (админка: http://localhost:${PORT}/admin)`);
  if (!ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD не задан — вход в админку невозможен. Укажите его в .env');
});
