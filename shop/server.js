// Сайт совместных закупок: клиенты смотрят каталог и записываются, админ всё настраивает.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { PORT, ADMIN_PASSWORD, SESSION_SECRET, UPLOAD_DIR, TG_BOT_TOKEN, TG_CHAT_ID } from './config.js';
import * as db from './db.js';
import * as views from './views.js';

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

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const ids = (v) => [v].flat().map(Number).filter((n) => Number.isInteger(n) && n > 0);
const list = (s) => [...new Set(String(s ?? '').split(/[,;\n]/).map((x) => x.trim()).filter(Boolean))];
const safeBack = (b, fallback) => (typeof b === 'string' && /^\/[^/\\]/.test(b) ? b : fallback);

// Размеры, цвета и «Название: значения» построчно → [{ name, values }]
function parseOptions(body, { keepEmpty = false } = {}) {
  const options = [];
  const sizes = list(body.sizes);
  const colors = list(body.colors);
  if (sizes.length || keepEmpty) options.push({ name: 'Размер', values: sizes });
  if (colors.length || keepEmpty) options.push({ name: 'Цвет', values: colors });
  for (const line of String(body.extra ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().slice(0, 50);
    const values = list(line.slice(i + 1).replace(/\n/g, ''));
    if (name && values.length && !options.some((o) => o.name === name)) options.push({ name, values });
  }
  return keepEmpty ? options : options.filter((o) => o.values.length);
}

function purchaseData(body) {
  return {
    title: str(body.title, 200) || 'Без названия',
    description: str(body.description, 5000),
    status: body.status in db.PURCHASE_STATUSES ? body.status : 'draft',
    deadline: /^\d{4}-\d{2}-\d{2}$/.test(body.deadline) ? body.deadline : '',
    org_fee: Math.min(num(body.org_fee), 1000),
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

function notifyTelegram(textMsg) {
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT_ID, text: textMsg }),
    signal: AbortSignal.timeout(10000),
  }).catch((e) => console.error('Telegram:', e.message));
}

const notFound = (res, msg = 'Страница не найдена.') => res.status(404).send(String(views.errorPage(404, msg)));
const page = (res, v) => res.send(String(v));

// ---------- Клиентская часть ----------

app.get('/', (req, res) => page(res, views.homePage(db.listPurchases({ publicOnly: true }))));

function visiblePurchase(id, req) {
  const p = db.getPurchase(Number(id));
  if (!p) return null;
  if ((p.status === 'draft' || p.status === 'archive') && !isAdmin(req)) return null;
  return p;
}

app.get('/p/:id', (req, res) => {
  const purchase = visiblePurchase(req.params.id, req);
  if (!purchase) return notFound(res, 'Закупка не найдена или ещё не открыта.');
  page(res, views.purchasePage({
    purchase,
    products: db.listProducts(purchase.id, { publicOnly: true }),
    clientId: req.clientId,
    ok: req.query.ok,
    error: str(req.query.error, 200),
  }));
});

const signupHits = new Map();

app.post('/p/:id/item/:productId/signup', (req, res) => {
  const purchase = visiblePurchase(req.params.id, req);
  const product = db.getProduct(Number(req.params.productId));
  if (!purchase || !product || product.purchase_id !== purchase.id || product.hidden) return notFound(res);
  const back = (q) => res.redirect(`/p/${purchase.id}?${q}#item-${product.id}`);
  const fail = (msg) => back(`error=${encodeURIComponent(msg)}`);

  // Не больше 30 записей за 10 минут с одного адреса
  const key = req.ip;
  const hits = (signupHits.get(key) || []).filter((t) => t > Date.now() - 600_000);
  if (hits.length >= 30) return fail('Слишком много записей подряд, попробуйте позже.');
  signupHits.set(key, [...hits, Date.now()]);

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

  notifyTelegram(`🛍 Новая запись — ${purchase.title}\n${product.title || product.article || `Товар №${product.id}`}`
    + `${Object.keys(choice).length ? `\n${views.choiceText(choice)}` : ''} × ${qty}\n${name}, ${contact}`
    + `${req.body.comment ? `\n💬 ${str(req.body.comment)}` : ''}`);
  back('ok=1');
});

app.post('/signup/:id/cancel', (req, res) => {
  const s = db.getSignup(Number(req.params.id));
  if (!s || s.client_id !== req.clientId) return notFound(res);
  const product = db.getProduct(s.product_id);
  const purchase = db.getPurchase(product.purchase_id);
  if (purchase.status === 'open') db.setSignupStatus([s.id], 'cancelled');
  res.redirect(safeBack(req.body.back, `/p/${purchase.id}#item-${product.id}`));
});

app.get('/my', (req, res) => page(res, views.myPage(db.listClientSignups(req.clientId))));

// ---------- Админка ----------

app.get('/admin/login', (req, res) => page(res, views.loginPage('', !ADMIN_PASSWORD)));

app.post('/admin/login', (req, res) => {
  const key = req.ip;
  const tries = (loginAttempts.get(key) || []).filter((t) => t > Date.now() - 900_000);
  if (tries.length >= 10) return page(res.status(429), views.loginPage('Слишком много попыток. Подождите 15 минут.'));
  const given = crypto.createHash('sha256').update(String(req.body.password ?? '')).digest();
  const real = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!ADMIN_PASSWORD || !crypto.timingSafeEqual(given, real)) {
    loginAttempts.set(key, [...tries, Date.now()]);
    return page(res.status(401), views.loginPage('Неверный пароль.', !ADMIN_PASSWORD));
  }
  loginAttempts.delete(key);
  const exp = String(Date.now() + 30 * 86400_000);
  setCookie(res, 'admin', `${exp}.${sign(`admin:${exp}`)}`, 30);
  res.redirect('/admin');
});

app.post('/admin/logout', (req, res) => {
  setCookie(res, 'admin', '', 0);
  res.redirect('/');
});

app.use('/admin', (req, res, next) => {
  if (isAdmin(req)) return next();
  if (req.method === 'GET') return res.redirect('/admin/login');
  res.status(403).send('Войдите в админку заново');
});

app.get('/admin', (req, res) => page(res, views.dashboardPage(db.listPurchases())));

app.post('/admin/purchase', (req, res) => {
  const id = db.createPurchase(purchaseData(req.body));
  res.redirect(`/admin/purchase/${id}`);
});

function adminPurchase(req, res) {
  const p = db.getPurchase(Number(req.params.id));
  if (!p) notFound(res, 'Закупка не найдена.');
  return p;
}

function adminProduct(req, res) {
  const p = db.getProduct(Number(req.params.id));
  if (!p) notFound(res, 'Товар не найден.');
  return p;
}

app.get('/admin/purchase/:id', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  page(res, views.purchaseAdminPage({ purchase, products: db.listProducts(purchase.id), msg: str(req.query.msg, 200) }));
});

app.post('/admin/purchase/:id', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  db.updatePurchase(purchase.id, purchaseData(req.body));
  res.redirect(`/admin/purchase/${purchase.id}?msg=${encodeURIComponent('Сохранено')}`);
});

app.post('/admin/purchase/:id/duplicate', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const id = db.duplicatePurchase(purchase.id);
  res.redirect(`/admin/purchase/${id}?msg=${encodeURIComponent('Копия создана (черновик). Поменяйте название и статус.')}`);
});

app.post('/admin/purchase/:id/delete', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  removeFiles(db.deletePurchase(purchase.id));
  res.redirect('/admin');
});

app.post('/admin/purchase/:id/upload', upload.array('photos'), async (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const files = (req.files || []).sort((a, b) => a.originalname.localeCompare(b.originalname, 'ru', { numeric: true }));
  if (!files.length) return res.redirect(`/admin/purchase/${purchase.id}?msg=${encodeURIComponent('Не выбрано ни одного фото')}`);
  const defaults = { price: num(req.body.price), options: parseOptions(req.body) };
  // multer отдаёт имя файла в latin1
  const stem = (f) => Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/\.[^.]+$/, '').slice(0, 100);
  const article = (f) => (req.body.article_from_name ? stem(f) : '');

  let saved = 0;
  let productId = null;
  let firstId = null;
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
      firstId ??= productId;
    }
    db.addPhoto(productId, photo.file, photo.thumb);
    saved++;
  }
  const failed = files.length - saved;
  const msg = `Загружено фото: ${saved}${failed ? `, не удалось: ${failed}` : ''}`;
  res.redirect(`/admin/purchase/${purchase.id}?msg=${encodeURIComponent(msg)}${firstId ? `#item-${firstId}` : ''}`);
});

app.post('/admin/purchase/:id/bulk', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const selected = ids(req.body.ids).filter((id) => db.getProduct(id)?.purchase_id === purchase.id);
  const go = (msg) => res.redirect(`/admin/purchase/${purchase.id}?msg=${encodeURIComponent(msg)}`);
  if (!selected.length) return go('Не выбрано ни одного товара');
  if (req.body.action === 'delete') {
    removeFiles(db.deleteProducts(selected));
    return go(`Удалено товаров: ${selected.length}`);
  }
  if (req.body.action === 'merge') {
    if (selected.length < 2) return go('Для объединения выберите хотя бы два товара');
    const id = db.mergeProducts(selected);
    return res.redirect(`/admin/product/${id}?msg=${encodeURIComponent('Товары объединены')}`);
  }
  const options = parseOptions(req.body);
  db.bulkUpdateProducts(selected, {
    price: str(req.body.price) ? num(req.body.price) : undefined,
    options: options.length ? options : undefined,
    hidden: req.body.hidden === '1' ? 1 : req.body.hidden === '0' ? 0 : undefined,
    description: str(req.body.description) ? str(req.body.description, 5000) : undefined,
  });
  go(`Изменено товаров: ${selected.length}`);
});

app.get('/admin/purchase/:id/signups', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  page(res, views.signupsAdminPage({ purchase, signups: db.listPurchaseSignups(purchase.id), msg: str(req.query.msg, 200) }));
});

app.get('/admin/purchase/:id/signups.csv', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const rows = [['№', 'Дата', 'Товар', 'Артикул', 'Параметры', 'Кол-во', 'Цена клиенту', 'Сумма', 'Имя', 'Контакт', 'Комментарий', 'Статус', 'Заметка']];
  for (const s of db.listPurchaseSignups(purchase.id)) {
    const price = views.finalPrice(s.price, purchase.org_fee);
    rows.push([s.id, new Date(s.created_at).toLocaleString('ru-RU'), s.product_title, s.article, views.choiceText(s.choice),
      s.qty, price, price * s.qty, s.name, s.contact, s.comment, db.SIGNUP_STATUSES[s.status], s.note]);
  }
  sendCsv(res, `Записи — ${purchase.title}.csv`, rows);
});

app.get('/admin/purchase/:id/factory.csv', (req, res) => {
  const purchase = adminPurchase(req, res);
  if (!purchase) return;
  const summary = new Map();
  for (const s of db.listPurchaseSignups(purchase.id)) {
    if (s.status === 'cancelled') continue;
    const key = `${s.product_id}|${views.choiceText(s.choice)}`;
    if (!summary.has(key)) summary.set(key, { s, qty: 0 });
    summary.get(key).qty += s.qty;
  }
  const rows = [['Товар', 'Артикул', 'Параметры', 'Кол-во', 'Цена', 'Сумма']];
  for (const { s, qty } of [...summary.values()].sort((a, b) => a.s.product_id - b.s.product_id)) {
    rows.push([s.product_title, s.article, views.choiceText(s.choice), qty, s.price, s.price * qty]);
  }
  sendCsv(res, `Заказ фабрике — ${purchase.title}.csv`, rows);
});

// ----- Товар -----

app.get('/admin/product/:id', (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  const purchase = db.getPurchase(product.purchase_id);
  const signups = db.listPurchaseSignups(purchase.id).filter((s) => s.product_id === product.id);
  page(res, views.productAdminPage({ product, purchase, signups, msg: str(req.query.msg, 200) }));
});

function productData(body, current) {
  const full = body.full === '1'; // полная форма товара, а не быстрая из списка
  return {
    title: str(body.title, 200),
    article: str(body.article, 100),
    description: full ? str(body.description, 5000) : current.description,
    price: num(body.price),
    max_qty: full ? (Math.floor(num(body.max_qty)) || null) : current.max_qty,
    hidden: full ? !!body.hidden : current.hidden,
  };
}

app.post('/admin/product/:id', (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  db.updateProduct(product.id, { ...productData(req.body, product), options: parseOptions(req.body) });
  res.redirect(`/admin/product/${product.id}?msg=${encodeURIComponent('Сохранено')}`);
});

// Быстрое сохранение из списка товаров: размеры/цвета меняются, прочие параметры остаются
app.post('/admin/product/:id/quick', (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  const incoming = parseOptions({ sizes: req.body.sizes, colors: req.body.colors }, { keepEmpty: true });
  const others = product.options.filter((o) => o.name !== 'Размер' && o.name !== 'Цвет');
  const options = [...incoming.filter((o) => o.values.length), ...others];
  db.updateProduct(product.id, { ...productData(req.body, product), options });
  res.redirect(`/admin/purchase/${product.purchase_id}?msg=${encodeURIComponent('Товар сохранён')}#item-${product.id}`);
});

app.post('/admin/product/:id/move', (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  db.moveProduct(product.id, Number(req.body.dir) < 0 ? -1 : 1);
  res.redirect(`/admin/purchase/${product.purchase_id}#item-${product.id}`);
});

app.post('/admin/product/:id/delete', (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  removeFiles(db.deleteProducts([product.id]));
  res.redirect(`/admin/purchase/${product.purchase_id}?msg=${encodeURIComponent('Товар удалён')}`);
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
  res.redirect(`/admin/product/${product.id}?msg=${encodeURIComponent(`Добавлено фото: ${saved}`)}`);
});

app.post('/admin/product/:id/signup', (req, res) => {
  const product = adminProduct(req, res);
  if (!product) return;
  db.createSignup({ product_id: product.id, client_id: 'admin', ...signupData(req.body, product) });
  res.redirect(`/admin/product/${product.id}?msg=${encodeURIComponent('Запись добавлена')}`);
});

app.post('/admin/photo/:id/main', (req, res) => {
  const ph = db.getPhoto(Number(req.params.id));
  if (!ph) return notFound(res);
  db.makePhotoMain(ph.id);
  res.redirect(`/admin/product/${ph.product_id}`);
});

app.post('/admin/photo/:id/delete', (req, res) => {
  const ph = db.getPhoto(Number(req.params.id));
  if (!ph) return notFound(res);
  db.deletePhoto(ph.id);
  removeFiles([ph]);
  res.redirect(`/admin/product/${ph.product_id}?msg=${encodeURIComponent('Фото удалено')}`);
});

// ----- Записи -----

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

app.get('/admin/signup/:id', (req, res) => {
  const signup = db.getSignup(Number(req.params.id));
  if (!signup) return notFound(res, 'Запись не найдена.');
  page(res, views.signupAdminPage({ signup, product: db.getProduct(signup.product_id) }));
});

app.post('/admin/signup/:id', (req, res) => {
  const signup = db.getSignup(Number(req.params.id));
  if (!signup) return notFound(res, 'Запись не найдена.');
  const product = db.getProduct(signup.product_id);
  db.updateSignup(signup.id, {
    ...signupData(req.body, product),
    status: req.body.status in db.SIGNUP_STATUSES ? req.body.status : signup.status,
    note: str(req.body.note),
  });
  res.redirect(`/admin/product/${product.id}?msg=${encodeURIComponent('Запись сохранена')}`);
});

app.post('/admin/signups/bulk', (req, res) => {
  const selected = ids(req.body.ids);
  const back = safeBack(req.body.back, '/admin');
  const sep = back.includes('?') ? '&' : '?';
  if (!selected.length) return res.redirect(`${back}${sep}msg=${encodeURIComponent('Не выбрано ни одной записи')}`);
  if (req.body.action === 'delete') {
    db.deleteSignups(selected);
    return res.redirect(`${back}${sep}msg=${encodeURIComponent(`Удалено записей: ${selected.length}`)}`);
  }
  if (req.body.status in db.SIGNUP_STATUSES) db.setSignupStatus(selected, req.body.status);
  res.redirect(`${back}${sep}msg=${encodeURIComponent(`Статус изменён: ${selected.length}`)}`);
});

// ---------- Ошибки ----------

app.use((req, res) => notFound(res));

app.use((err, req, res, next) => {
  console.error(err);
  const msg = err instanceof multer.MulterError
    ? (err.code === 'LIMIT_FILE_SIZE' ? 'Файл больше 25 МБ.' : 'Слишком много файлов за раз (максимум 300).')
    : 'Что-то пошло не так. Попробуйте ещё раз.';
  res.status(500).send(String(views.errorPage(500, msg)));
});

app.listen(PORT, () => {
  console.log(`Сайт закупок: http://localhost:${PORT}  (админка: /admin)`);
  if (!ADMIN_PASSWORD) console.warn('⚠️  ADMIN_PASSWORD не задан — вход в админку невозможен. Укажите его в .env');
});
