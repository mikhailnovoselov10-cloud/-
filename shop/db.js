// База SQLite (встроенная node:sqlite).
//
// purchases — закупки (каталог одной фабрики, одна волна сбора заказов)
// products  — товары закупки; options хранит параметры выбора в JSON:
//             [{ "name": "Размер", "values": ["42", "44"] }, ...]
// photos    — фото товара, первое по sort — главное
// signups   — записи клиентов; choice — выбранные параметры { "Размер": "44" }

import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from './config.js';

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'draft',
  deadline    TEXT NOT NULL DEFAULT '',
  org_fee     REAL NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  title       TEXT NOT NULL DEFAULT '',
  article     TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price       REAL NOT NULL DEFAULT 0,
  options     TEXT NOT NULL DEFAULT '[]',
  max_qty     INTEGER,
  hidden      INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS products_purchase ON products(purchase_id, sort);
CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  file       TEXT NOT NULL,
  thumb      TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS photos_product ON photos(product_id, sort);
CREATE TABLE IF NOT EXISTS signups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  client_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL,
  choice     TEXT NOT NULL DEFAULT '{}',
  qty        INTEGER NOT NULL DEFAULT 1,
  comment    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new',
  note       TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signups_product ON signups(product_id, created_at);
CREATE INDEX IF NOT EXISTS signups_client ON signups(client_id);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Миграции для баз, созданных ранними версиями
const purchaseCols = db.prepare('PRAGMA table_info(purchases)').all().map((c) => c.name);
if (!purchaseCols.includes('pay_info')) db.exec("ALTER TABLE purchases ADD COLUMN pay_info TEXT NOT NULL DEFAULT ''");

export const PURCHASE_STATUSES = {
  draft: 'Черновик',
  open: 'Идёт запись',
  stop: 'Стоп',
  archive: 'Архив',
};

export const PURCHASE_STATUS_HINTS = {
  draft: 'видите только вы',
  open: 'клиенты записываются',
  stop: 'видна, запись закрыта',
  archive: 'скрыта с сайта',
};

export const SIGNUP_STATUSES = {
  new: 'Новая',
  confirmed: 'Подтверждена',
  paid: 'Оплачена',
  delivered: 'Выдана',
  cancelled: 'Отменена',
};

const now = () => Date.now();

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function parseProduct(p) {
  if (!p) return p;
  return { ...p, options: JSON.parse(p.options) };
}

function parseSignup(s) {
  if (!s) return s;
  return { ...s, choice: JSON.parse(s.choice) };
}

// ---------- Закупки ----------

export function listPurchases({ publicOnly = false } = {}) {
  const where = publicOnly ? "WHERE p.status IN ('open','stop')" : '';
  return db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM products pr WHERE pr.purchase_id = p.id AND pr.hidden = 0) AS products_count,
      (SELECT COUNT(*) FROM signups s JOIN products pr ON pr.id = s.product_id
        WHERE pr.purchase_id = p.id AND s.status != 'cancelled') AS signups_count,
      (SELECT COUNT(*) FROM signups s JOIN products pr ON pr.id = s.product_id
        WHERE pr.purchase_id = p.id AND s.status = 'new') AS new_count,
      (SELECT COALESCE(SUM(s.qty * pr.price), 0) FROM signups s JOIN products pr ON pr.id = s.product_id
        WHERE pr.purchase_id = p.id AND s.status != 'cancelled') AS factory_sum,
      (SELECT ph.thumb FROM photos ph JOIN products pr ON pr.id = ph.product_id
        WHERE pr.purchase_id = p.id AND pr.hidden = 0 ORDER BY pr.sort, pr.id, ph.sort, ph.id LIMIT 1) AS cover
    FROM purchases p ${where}
    ORDER BY CASE p.status WHEN 'open' THEN 0 WHEN 'stop' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, p.id DESC
  `).all();
}

export function getPurchase(id) {
  return db.prepare('SELECT * FROM purchases WHERE id = ?').get(id);
}

export function createPurchase(data) {
  const r = db.prepare(`INSERT INTO purchases (title, description, status, deadline, org_fee, pay_info, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(data.title, data.description, data.status, data.deadline, data.org_fee,
    data.pay_info ?? '', now());
  return Number(r.lastInsertRowid);
}

export function updatePurchase(id, data) {
  db.prepare(`UPDATE purchases SET title = ?, description = ?, status = ?, deadline = ?, org_fee = ?, pay_info = ?
    WHERE id = ?`).run(data.title, data.description, data.status, data.deadline, data.org_fee, data.pay_info, id);
}

export function setPurchaseStatus(id, status) {
  db.prepare('UPDATE purchases SET status = ? WHERE id = ?').run(status, id);
}

export function deletePurchase(id) {
  const files = purchasePhotoFiles(id);
  db.prepare('DELETE FROM purchases WHERE id = ?').run(id);
  return files;
}

function purchasePhotoFiles(purchaseId) {
  return db.prepare(`SELECT ph.file, ph.thumb FROM photos ph JOIN products pr ON pr.id = ph.product_id
    WHERE pr.purchase_id = ?`).all(purchaseId);
}

// Копия закупки со всеми товарами и фото (файлы общие), без записей.
export function duplicatePurchase(id) {
  return transaction(() => {
    const p = getPurchase(id);
    const newId = createPurchase({ ...p, title: `${p.title} (копия)`, status: 'draft' });
    for (const pr of listProducts(id)) {
      const newProductId = db.prepare(`INSERT INTO products
        (purchase_id, title, article, description, price, options, max_qty, hidden, sort, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(newId, pr.title, pr.article, pr.description, pr.price,
        JSON.stringify(pr.options), pr.max_qty, pr.hidden, pr.sort, now()).lastInsertRowid;
      for (const ph of pr.photos) addPhoto(Number(newProductId), ph.file, ph.thumb);
    }
    return newId;
  });
}

// ---------- Товары ----------

export function listProducts(purchaseId, { publicOnly = false } = {}) {
  const products = db.prepare(`SELECT * FROM products WHERE purchase_id = ? ${publicOnly ? 'AND hidden = 0' : ''}
    ORDER BY sort, id`).all(purchaseId).map(parseProduct);
  const photos = db.prepare(`SELECT ph.* FROM photos ph JOIN products pr ON pr.id = ph.product_id
    WHERE pr.purchase_id = ? ORDER BY ph.sort, ph.id`).all(purchaseId);
  const signups = db.prepare(`SELECT s.* FROM signups s JOIN products pr ON pr.id = s.product_id
    WHERE pr.purchase_id = ? ORDER BY s.created_at, s.id`).all(purchaseId).map(parseSignup);
  const byId = new Map(products.map((p) => [p.id, Object.assign(p, { photos: [], signups: [] })]));
  for (const ph of photos) byId.get(ph.product_id)?.photos.push(ph);
  for (const s of signups) byId.get(s.product_id)?.signups.push(s);
  return products;
}

export function getProduct(id) {
  const p = parseProduct(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  if (!p) return p;
  p.photos = db.prepare('SELECT * FROM photos WHERE product_id = ? ORDER BY sort, id').all(id);
  return p;
}

export function createProduct(purchaseId, data) {
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM products WHERE purchase_id = ?').get(purchaseId).s;
  const r = db.prepare(`INSERT INTO products (purchase_id, title, article, description, price, options, max_qty, sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(purchaseId, data.title ?? '', data.article ?? '', data.description ?? '',
    data.price ?? 0, JSON.stringify(data.options ?? []), data.max_qty ?? null, sort, now());
  return Number(r.lastInsertRowid);
}

export function updateProduct(id, data) {
  db.prepare(`UPDATE products SET title = ?, article = ?, description = ?, price = ?, options = ?, max_qty = ?, hidden = ?
    WHERE id = ?`).run(data.title, data.article, data.description, data.price, JSON.stringify(data.options),
    data.max_qty, data.hidden ? 1 : 0, id);
}

// Массовое изменение: меняются только переданные поля.
export function bulkUpdateProducts(ids, { price, options, hidden, description }) {
  transaction(() => {
    for (const id of ids) {
      const p = getProduct(id);
      if (!p) continue;
      updateProduct(id, {
        ...p,
        price: price ?? p.price,
        options: options ? mergeOptions(p.options, options) : p.options,
        hidden: hidden ?? p.hidden,
        description: description ?? p.description,
      });
    }
  });
}

// Параметры из массовой формы заменяют одноимённые на их месте, новые добавляются в конец.
function mergeOptions(current, incoming) {
  const result = current.map((o) => incoming.find((n) => n.name === o.name) ?? o);
  return [...result, ...incoming.filter((n) => !current.some((o) => o.name === n.name))];
}

export function moveProduct(id, dir) {
  const p = getProduct(id);
  const neighbor = db.prepare(`SELECT id, sort FROM products WHERE purchase_id = ? AND
    ${dir < 0 ? '(sort < ? OR (sort = ? AND id < ?)) ORDER BY sort DESC, id DESC' : '(sort > ? OR (sort = ? AND id > ?)) ORDER BY sort, id'}
    LIMIT 1`).get(p.purchase_id, p.sort, p.sort, p.id);
  if (!neighbor) return;
  transaction(() => {
    const a = neighbor.sort === p.sort ? p.sort + (dir < 0 ? 1 : -1) : neighbor.sort;
    db.prepare('UPDATE products SET sort = ? WHERE id = ?').run(a, p.id);
    db.prepare('UPDATE products SET sort = ? WHERE id = ?').run(p.sort, neighbor.id);
  });
}

// Порядок товаров после перетаскивания в админке
export function reorderProducts(purchaseId, ids) {
  transaction(() => {
    ids.forEach((id, i) => db.prepare('UPDATE products SET sort = ? WHERE id = ? AND purchase_id = ?').run(i + 1, id, purchaseId));
  });
}

export function deleteProducts(ids) {
  const files = [];
  transaction(() => {
    for (const id of ids) {
      files.push(...db.prepare('SELECT file, thumb FROM photos WHERE product_id = ?').all(id));
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
    }
  });
  return files;
}

// Объединяет несколько товаров в первый: фото и записи переносятся.
export function mergeProducts(ids) {
  const [target, ...rest] = ids;
  transaction(() => {
    for (const id of rest) {
      db.prepare('UPDATE photos SET product_id = ?, sort = sort + 1000 WHERE product_id = ?').run(target, id);
      db.prepare('UPDATE signups SET product_id = ? WHERE product_id = ?').run(target, id);
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
    }
  });
  return target;
}

// ---------- Фото ----------

export function addPhoto(productId, file, thumb) {
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM photos WHERE product_id = ?').get(productId).s;
  db.prepare('INSERT INTO photos (product_id, file, thumb, sort) VALUES (?, ?, ?, ?)').run(productId, file, thumb, sort);
}

export function getPhoto(id) {
  return db.prepare('SELECT * FROM photos WHERE id = ?').get(id);
}

export function deletePhoto(id) {
  db.prepare('DELETE FROM photos WHERE id = ?').run(id);
}

export function makePhotoMain(id) {
  const ph = getPhoto(id);
  const min = db.prepare('SELECT MIN(sort) AS s FROM photos WHERE product_id = ?').get(ph.product_id).s;
  db.prepare('UPDATE photos SET sort = ? WHERE id = ?').run(min - 1, id);
}

// Сколько строк ещё ссылаются на файл (у копий закупок файлы общие).
export function photoFileUsage(file) {
  return db.prepare('SELECT COUNT(*) AS c FROM photos WHERE file = ?').get(file).c;
}

// ---------- Записи ----------

export function productTakenQty(productId) {
  return db.prepare(`SELECT COALESCE(SUM(qty), 0) AS q FROM signups WHERE product_id = ? AND status != 'cancelled'`)
    .get(productId).q;
}

export function createSignup(data) {
  const r = db.prepare(`INSERT INTO signups (product_id, client_id, name, contact, choice, qty, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(data.product_id, data.client_id, data.name, data.contact,
    JSON.stringify(data.choice), data.qty, data.comment, now());
  return Number(r.lastInsertRowid);
}

export function getSignup(id) {
  return parseSignup(db.prepare('SELECT * FROM signups WHERE id = ?').get(id));
}

export function setSignupNote(id, note) {
  db.prepare('UPDATE signups SET note = ? WHERE id = ?').run(note, id);
}

export function updateSignup(id, data) {
  db.prepare(`UPDATE signups SET name = ?, contact = ?, choice = ?, qty = ?, comment = ?, status = ?, note = ? WHERE id = ?`)
    .run(data.name, data.contact, JSON.stringify(data.choice), data.qty, data.comment, data.status, data.note, id);
}

export function setSignupStatus(ids, status) {
  transaction(() => {
    for (const id of ids) db.prepare('UPDATE signups SET status = ? WHERE id = ?').run(status, id);
  });
}

export function deleteSignups(ids) {
  transaction(() => {
    for (const id of ids) db.prepare('DELETE FROM signups WHERE id = ?').run(id);
  });
}

export function listPurchaseSignups(purchaseId) {
  return db.prepare(`SELECT s.*, pr.title AS product_title, pr.article, pr.price, pr.id AS product_id
    FROM signups s JOIN products pr ON pr.id = s.product_id
    WHERE pr.purchase_id = ? ORDER BY s.created_at, s.id`).all(purchaseId).map(parseSignup);
}

const SIGNUP_JOIN = `SELECT s.*, pr.title AS product_title, pr.article, pr.price, pr.purchase_id,
      pu.title AS purchase_title, pu.org_fee, pu.status AS purchase_status, pu.pay_info,
      (SELECT thumb FROM photos WHERE product_id = pr.id ORDER BY sort, id LIMIT 1) AS thumb
    FROM signups s JOIN products pr ON pr.id = s.product_id JOIN purchases pu ON pu.id = pr.purchase_id`;

// Записи с фильтрами: по закупке, статусу, поиску по имени/контакту/товару, по контакту клиента
export function searchSignups({ purchaseId, status, q, contact, limit = 1000 } = {}) {
  const where = [];
  const args = [];
  if (purchaseId) { where.push('pr.purchase_id = ?'); args.push(purchaseId); }
  if (status) { where.push('s.status = ?'); args.push(status); }
  if (contact) { where.push('lower(trim(s.contact)) = ?'); args.push(contact); }
  if (q) {
    where.push(`(lower(s.name) LIKE ? OR lower(s.contact) LIKE ? OR lower(pr.title) LIKE ? OR lower(pr.article) LIKE ?)`);
    const like = `%${q.toLowerCase()}%`;
    args.push(like, like, like, like);
  }
  return db.prepare(`${SIGNUP_JOIN} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY s.created_at DESC, s.id DESC LIMIT ${Number(limit)}`).all(...args).map(parseSignup);
}

export function dashboardStats() {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const dayAgo = now() - 86400_000;
  const weekAgo = now() - 7 * 86400_000;
  return {
    open: one("SELECT COUNT(*) AS c FROM purchases WHERE status = 'open'").c,
    purchases: one("SELECT COUNT(*) AS c FROM purchases WHERE status != 'archive'").c,
    newSignups: one("SELECT COUNT(*) AS c FROM signups WHERE status = 'new'").c,
    today: one("SELECT COUNT(*) AS c FROM signups WHERE status != 'cancelled' AND created_at > ?", dayAgo).c,
    week: one("SELECT COUNT(*) AS c FROM signups WHERE status != 'cancelled' AND created_at > ?", weekAgo).c,
    clients: one("SELECT COUNT(DISTINCT lower(trim(contact))) AS c FROM signups WHERE status != 'cancelled'").c,
  };
}

// ---------- Настройки сайта ----------

export function getSettings(defaults) {
  const out = { ...defaults };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

export function saveSettings(values) {
  transaction(() => {
    for (const [k, v] of Object.entries(values)) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);
    }
  });
}

export function listClientSignups(clientId) {
  return db.prepare(`${SIGNUP_JOIN} WHERE s.client_id = ? ORDER BY s.created_at DESC`).all(clientId).map(parseSignup);
}

export default db;
