// Telegram-бот «Разбор по дате рождения».

import dns from 'node:dns';
import { Bot, InlineKeyboard, GrammyError } from 'grammy';
import {
  BOT_TOKEN, ADMIN_IDS, TIMEZONE, FREE_PAUSE_MS, PAID_PAUSE_MS,
  SUPPORT_CONTACT, SPHERES, SPHERE_KEYS, PRODUCTS, CRYPTOPAY_POLL_MS, CRYPTOPAY_TESTNET,
  httpsAgent, PROXY_LABEL,
} from './config.js';
import * as db from './db.js';
import * as cp from './cryptopay.js';
import { parseDate, toIso, fromIso, formatDate, lifePath } from './numerology.js';
import { sphereReading, yearReading, compatReading } from './reading.js';
import { NUMBERS, UI } from './texts.js';
import { setupGame, afterBirth, sendIntro } from './game.js';

if (!BOT_TOKEN) {
  console.error('Не задан BOT_TOKEN (см. .env.example)');
  process.exit(1);
}

dns.setDefaultResultOrder('ipv4first');
const bot = new Bot(BOT_TOKEN, { client: { baseFetchConfig: { agent: httpsAgent } } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const HTML = { parse_mode: 'HTML' };

// Текущая дата/час в часовом поясе бота
function nowTz() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const t = { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour };
  t.iso = `${parts.year}-${parts.month}-${parts.day}`;
  return t;
}

async function notifyAdmins(text) {
  for (const id of ADMIN_IDS) {
    await bot.api.sendMessage(id, text, HTML).catch(() => {});
  }
}

// ---------- клавиатуры ----------

// Меню = выбор из тех же 7 тем, что в начале игры
function sphereMenu(user) {
  const kb = new InlineKeyboard();
  for (const key of SPHERE_KEYS) {
    const s = SPHERES[key];
    let mark;
    if (db.hasItem(user.id, `sphere:${key}`)) mark = '✅';
    else if (!user.free_sphere || user.topic_credits > 0) mark = '🎁 бесплатно';
    else mark = `${PRODUCTS.sphere.stars}⭐`;
    kb.text(`${s.emoji} ${s.name} · ${mark}`, `sp:${key}`).row();
  }
  return kb
    .text(`🎁 Все 7 тем сразу — ${PRODUCTS.pack.stars}⭐`, 'pack').row()
    .text('👥 Пригласи друга — тема бесплатно', 'ref');
}

const afterReadingKb = () =>
  new InlineKeyboard()
    .text('🔮 Выбрать другую тему', 'spheres').row()
    .text(`🎁 Все 7 тем сразу — ${PRODUCTS.pack.stars}⭐`, 'pack').row()
    .text('👥 Пригласи друга — тема бесплатно', 'ref');

async function showMenu(ctx, text = UI.chooseSphere) {
  const user = db.getUser(ctx.from.id);
  if (!user?.birth) return askBirth(ctx);
  await ctx.reply(text, { ...HTML, reply_markup: sphereMenu(user) });
}

// Даты ещё нет — человек идёт в игру, там он её и введёт
const askBirth = (ctx) => sendIntro(ctx);

// ---------- отправка разборов сериями сообщений ----------

// Очередь серий на пользователя: серии идут в фоне (паузы не блокируют других),
// а несколько серий одному человеку — строго друг за другом.
const queues = new Map();
const isBusy = (chatId) => queues.has(chatId);

async function runSeries(chatId, messages, pause, finalKb) {
  try {
    for (let i = 0; i < messages.length; i++) {
      if (i > 0) {
        await bot.api.sendChatAction(chatId, 'typing').catch(() => {});
        await sleep(pause);
      }
      const last = i === messages.length - 1;
      await bot.api.sendMessage(chatId, messages[i], { ...HTML, ...(last && finalKb ? { reply_markup: finalKb } : {}) });
    }
  } catch (e) {
    if (e instanceof GrammyError && e.error_code === 403) db.setBlocked(chatId);
    else console.error('sendSeries', e);
  }
}

function sendSeries(chatId, messages, pause, finalKb = afterReadingKb()) {
  const run = (queues.get(chatId) ?? Promise.resolve())
    .then(() => runSeries(chatId, messages, pause, finalKb))
    .finally(() => {
      if (queues.get(chatId) === run) queues.delete(chatId);
    });
  queues.set(chatId, run);
}

// Выдать уже купленное/открытое
function deliverItem(userId, item, pause = PAID_PAUSE_MS) {
  const user = db.getUser(userId);
  const birth = fromIso(user.birth);
  const [kind, param] = item.split(':');
  if (kind === 'sphere') return sendSeries(userId, sphereReading(birth, param, nowTz().year), pause);
  if (kind === 'year') return sendSeries(userId, yearReading(birth, Number(param)), pause);
  if (kind === 'compat') return sendSeries(userId, compatReading(birth, fromIso(param)), pause);
  return false;
}

// Выдать оплаченный заказ
async function deliverOrder(order) {
  const uid = order.user_id;
  if (order.product === 'pack') {
    const credits = db.getUser(uid).compat_credits;
    await bot.api.sendMessage(
      uid,
      `🎁 <b>Пакет «Всё включено» активирован!</b>\n\n✅ Все 7 тем открыты\n✅ Прогноз на ${order.param} год\n✅ Совместимость: доступно ${credits}\n\nНачнём с прогноза на год 👇`,
      HTML,
    );
    deliverItem(uid, `year:${order.param}`);
  } else {
    deliverItem(uid, `${order.product}:${order.param}`);
  }
  db.markDelivered(order.id);
}

// Защита от спама: не больше 15 действий за 10 секунд на пользователя.
// Оплата (pre_checkout_query, successful_payment) и админы не ограничиваются.
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_LIMIT = 15;
const hits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, arr] of hits) if (!arr.length || now - arr[arr.length - 1] > FLOOD_WINDOW_MS) hits.delete(id);
}, 60_000);

bot.use(async (ctx, next) => {
  const id = ctx.from?.id;
  if (!id || ADMIN_IDS.includes(id) || ctx.preCheckoutQuery || ctx.message?.successful_payment) return next();
  const now = Date.now();
  const arr = (hits.get(id) ?? []).filter((t) => now - t < FLOOD_WINDOW_MS);
  arr.push(now);
  hits.set(id, arr);
  if (arr.length > FLOOD_LIMIT) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: 'Не так быстро 🙂 Подожди пару секунд' }).catch(() => {});
    return; // лишние нажатия молча игнорируем
  }
  return next();
});

// Каждый апдейт: пользователь есть в базе. Метка трафика из /start метка
// сохраняется только при первом визите (touchUser не перезаписывает source).
bot.use(async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) {
    const m = ctx.message?.text?.match(/^\/start(?:@\w+)?\s+([\w-]{1,64})$/);
    const ref = m?.[1].match(/^ref_(\d+)$/);
    // /start ref_123 — приглашение от пользователя 123, метка трафика «ref»
    db.touchUser(ctx.from, ref ? 'ref' : (m ? m[1] : null), ref ? Number(ref[1]) : null);
  }
  return next();
});

// ---------- оплата ----------

const productTitle = (order) => {
  const p = PRODUCTS[order.product];
  if (order.product === 'sphere') return `${p.title}: ${SPHERES[order.param].name}`;
  if (order.product === 'year') return `${p.title} ${order.param}`;
  if (order.product === 'compat') return `${p.title} с ${formatDate(fromIso(order.param))}`;
  return p.title;
};

async function offerPayment(ctx, product, param) {
  const p = PRODUCTS[product];
  const order = db.createOrder(ctx.from.id, product, param, p.stars, p.usd);
  const kb = new InlineKeyboard().text(`⭐ Оплатить ${p.stars} Stars`, `pay:s:${order.id}`).row();
  if (cp.cryptoEnabled()) kb.text(`💎 Криптой через CryptoBot · $${p.usd}`, `pay:c:${order.id}`).row();
  kb.text('« Все темы', 'spheres');
  await ctx.reply(
    UI.payChoose(productTitle(order), p.stars, cp.cryptoEnabled() ? p.usd : null) + `\n\n<i>${p.description}</i>`,
    { ...HTML, reply_markup: kb },
  );
}

function ownOrder(ctx, id) {
  const order = db.getOrder(Number(id));
  return order && order.user_id === ctx.from.id ? order : null;
}

// Проведение платежа (общая точка для Stars и CryptoBot)
async function handlePayment({ provider, externalId, order, userId, amount, currency }) {
  const r = db.fulfillPayment({ provider, externalId, orderId: order.id, userId, amount, currency });

  if (r.result === 'duplicate') return r; // этот платёж уже обработан — ничего не выдаём

  if (r.result === 'order_not_pending') {
    // Заказ уже оплачен другим платежом: товар повторно не выдаём, деньги возвращаем
    if (provider === 'stars') {
      try {
        await bot.api.refundStarPayment(userId, externalId);
        db.markPaymentRefunded(provider, externalId);
        await bot.api.sendMessage(userId, UI.refundedDouble);
      } catch (e) {
        console.error('refundStarPayment', e);
        await bot.api.sendMessage(userId, UI.cryptoDouble).catch(() => {});
      }
    } else {
      await bot.api.sendMessage(userId, UI.cryptoDouble).catch(() => {});
    }
    await notifyAdmins(
      `⚠️ Повторная оплата заказа #${order.id} (${provider}, ${amount} ${currency}, id ${esc(externalId)}) от пользователя ${userId}.` +
        (provider === 'stars' ? ' Звёзды возвращаются автоматически.' : ' Нужно вернуть вручную.'),
    );
    return r;
  }

  // granted: удаляем остальные неоплаченные счета CryptoBot по этому заказу.
  // Локальный статус не трогаем: если счёт успели оплатить, поллер это увидит
  // и оформит возврат; удалённый счёт пропадёт из ответа API и будет помечен cancelled.
  for (const inv of db.otherActiveInvoices(order.id, provider === 'cryptobot' ? Number(externalId) : 0)) {
    cp.deleteInvoice(inv).catch(() => {});
  }
  await bot.api.sendMessage(userId, UI.paid).catch(() => {});
  await deliverOrder(r.order);
  await notifyAdmins(`💸 Оплата: ${esc(productTitle(r.order))} — ${amount} ${currency} (${provider}), пользователь ${userId}`);
  return r;
}

// Telegram Stars: счёт
bot.callbackQuery(/^pay:s:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const order = ownOrder(ctx, ctx.match[1]);
  if (!order) return;
  if (order.status !== 'pending') return ctx.reply(UI.alreadyPaid);
  const title = productTitle(order).slice(0, 32);
  await ctx.replyWithInvoice(title, PRODUCTS[order.product].description, `order:${order.id}`, 'XTR', [
    { label: title, amount: order.stars },
  ]);
});

// Telegram Stars: подтверждение перед списанием (ответить нужно за 10 секунд)
bot.on('pre_checkout_query', async (ctx) => {
  const q = ctx.preCheckoutQuery;
  const m = q.invoice_payload.match(/^order:(\d+)$/);
  const order = m && db.getOrder(Number(m[1]));
  const ok = order && order.user_id === q.from.id && order.status === 'pending'
    && q.currency === 'XTR' && q.total_amount === order.stars;
  if (ok) return ctx.answerPreCheckoutQuery(true);
  return ctx.answerPreCheckoutQuery(false, {
    error_message: order?.status === 'paid' ? 'Этот заказ уже оплачен.' : 'Заказ устарел, откройте меню и попробуйте снова.',
  });
});

// Telegram Stars: успешная оплата
bot.on('message:successful_payment', async (ctx) => {
  const sp = ctx.message.successful_payment;
  const m = sp.invoice_payload.match(/^order:(\d+)$/);
  const order = m && db.getOrder(Number(m[1]));
  if (!order) {
    console.error('Оплата без заказа', sp);
    await notifyAdmins(`⚠️ Оплата без заказа: ${esc(sp.invoice_payload)}, charge ${esc(sp.telegram_payment_charge_id)}`);
    return;
  }
  await handlePayment({
    provider: 'stars',
    externalId: sp.telegram_payment_charge_id,
    order,
    userId: ctx.from.id,
    amount: sp.total_amount,
    currency: sp.currency,
  });
});

// CryptoBot: создать (или переиспользовать) счёт
bot.callbackQuery(/^pay:c:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const order = ownOrder(ctx, ctx.match[1]);
  if (!order || !cp.cryptoEnabled()) return;
  if (order.status !== 'pending') return ctx.reply(UI.alreadyPaid);

  let inv = db.activeInvoiceForOrder(order.id);
  if (!inv) {
    try {
      const created = await cp.createInvoice({
        usd: order.usd,
        description: productTitle(order),
        payload: `order:${order.id}`,
        botUsername: bot.botInfo.username,
      });
      db.addCryptoInvoice(created.invoice_id, order.id, order.user_id, created.bot_invoice_url);
      inv = db.activeInvoiceForOrder(order.id);
    } catch (e) {
      console.error(e);
      return ctx.reply(UI.cryptoError);
    }
  }
  await ctx.reply(UI.cryptoInvoice, {
    reply_markup: new InlineKeyboard()
      .url(`💎 Оплатить $${order.usd}`, inv.url).row()
      .text('🔄 Я оплатил — проверить', `chk:${inv.invoice_id}`),
  });
});

// CryptoBot: проверка статусов счетов
async function checkCryptoInvoices(rows) {
  if (!rows.length) return [];
  const items = await cp.getInvoices(rows.map((r) => r.invoice_id));
  const byId = new Map(rows.map((r) => [r.invoice_id, r]));
  const paid = [];
  // Счета, которых нет в ответе, удалены в CryptoBot — оплатить их уже нельзя
  const returned = new Set(items.map((it) => it.invoice_id));
  for (const r of rows) if (!returned.has(r.invoice_id)) db.setInvoiceStatus(r.invoice_id, 'cancelled');
  for (const it of items) {
    const row = byId.get(it.invoice_id);
    if (!row) continue;
    if (it.status === 'paid') {
      const order = db.getOrder(row.order_id);
      // fulfillPayment идемпотентен по invoice_id — повторная проверка ничего не выдаст
      await handlePayment({
        provider: 'cryptobot',
        externalId: it.invoice_id,
        order,
        userId: row.user_id,
        amount: it.amount,
        currency: it.fiat || 'USD',
      });
      db.setInvoiceStatus(it.invoice_id, 'paid');
      paid.push(it.invoice_id);
    } else if (it.status === 'expired') {
      db.setInvoiceStatus(it.invoice_id, 'expired');
    }
  }
  return paid;
}

bot.callbackQuery(/^chk:(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const row = db.activeCryptoInvoices().find((r) => r.invoice_id === id && r.user_id === ctx.from.id);
  if (!row) return ctx.answerCallbackQuery({ text: 'Счёт уже обработан или истёк.' });
  try {
    const paid = await checkCryptoInvoices([row]);
    await ctx.answerCallbackQuery({ text: paid.length ? 'Оплата получена ✅' : 'Оплата пока не поступила. Если уже оплатили — подождите минуту.' });
  } catch (e) {
    console.error(e);
    await ctx.answerCallbackQuery({ text: 'Не удалось проверить, попробуйте чуть позже.' });
  }
});

let cryptoBusy = false;
let lastPollError = { msg: '', at: 0 };
async function cryptoPollTick() {
  if (cryptoBusy) return;
  cryptoBusy = true;
  try {
    await checkCryptoInvoices(db.activeCryptoInvoices());
    if (lastPollError.msg) console.log('crypto poll: снова работает');
    lastPollError = { msg: '', at: 0 };
  } catch (e) {
    // Временные сбои CryptoBot не страшны: следующая проверка через 15 секунд.
    // Одну и ту же ошибку пишем в лог не чаще раза в 10 минут.
    if (e.message !== lastPollError.msg || Date.now() - lastPollError.at > 600_000) {
      console.error('crypto poll', e.message);
      lastPollError = { msg: e.message, at: Date.now() };
    }
  } finally {
    cryptoBusy = false;
  }
}

// ---------- команды ----------

// /start открывает игру «9 уровней» (game.js)
bot.command('start', (ctx) => sendIntro(ctx));

bot.command('menu', (ctx) => showMenu(ctx));
bot.command('help', (ctx) => ctx.reply(UI.help));
bot.command('terms', (ctx) => ctx.reply(UI.terms));
bot.command('paysupport', (ctx) => ctx.reply(UI.paySupport(SUPPORT_CONTACT)));

// Для админа: сбросить свой прогресс (игра, подарок, открытые разборы), чтобы пройти всё заново.
// Заказы и платежи не удаляются.
bot.command('reset', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  db.resetUser(ctx.from.id);
  await ctx.reply('🔄 Твой прогресс сброшен. Отправь /start, чтобы пройти игру заново.');
});

bot.command('stats', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  const s = db.stats();
  const funnel = db.gameFunnel().map((n, i) => `${i + 1}: ${n}`).join(' · ');
  const products = s.byProduct.map((p) => `${PRODUCTS[p.product]?.title ?? p.product}: ${p.n}`).join('\n') || '—';
  const sources = s.bySource
    .map((r) => `<code>${esc(r.source)}</code>: ${r.users} чел, бесплатно ${r.free}, купили ${r.buyers}, ${r.stars}⭐ + $${r.usd.toFixed(2)}`)
    .join('\n');
  await ctx.reply(
    `📊 <b>Статистика</b>\n\n` +
      `👥 Пользователей: ${s.users} (+${s.users24h} за 24ч, +${s.users7d} за 7д)\n` +
      `📅 Указали дату: ${s.withBirth}\n🎁 Взяли бесплатный разбор: ${s.freeUsed}\n` +
      `🚫 Заблокировали бота: ${s.blocked}\n👥 По приглашениям: пришли ${s.refs.invited}, прошли игру ${s.refs.done}\n\n` +
      `🎮 <b>Игра — дошли до уровня</b>\n${funnel}\n\n` +
      `⭐ Stars: ${s.stars.n} оплат, ${s.stars.s}⭐ (за 24ч ${s.stars24h}⭐)\n` +
      `💎 CryptoBot: ${s.crypto.n} оплат, $${s.crypto.s.toFixed(2)} (за 24ч $${s.crypto24h.toFixed(2)})\n\n` +
      `<b>Продажи по продуктам</b>\n${products}\n\n<b>Метки трафика</b>\n${sources}`,
    HTML,
  );
});

// ---------- кнопки меню ----------

bot.callbackQuery('menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showMenu(ctx);
});

bot.callbackQuery('spheres', async (ctx) => {
  await ctx.answerCallbackQuery();
  const user = db.getUser(ctx.from.id);
  if (!user.birth) return askBirth(ctx);
  await ctx.reply(UI.chooseSphere, { reply_markup: sphereMenu(user) });
});

bot.callbackQuery(/^sp:(\w+)$/, async (ctx) => {
  const key = ctx.match[1];
  if (!SPHERES[key]) return ctx.answerCallbackQuery();
  const user = db.getUser(ctx.from.id);
  if (!user.birth) {
    await ctx.answerCallbackQuery();
    return askBirth(ctx);
  }
  if (isBusy(user.id)) return ctx.answerCallbackQuery({ text: UI.busy });
  await ctx.answerCallbackQuery();

  const item = `sphere:${key}`;
  if (db.hasItem(user.id, item)) return deliverItem(user.id, item);
  if (db.claimFreeSphere(user.id, key)) return deliverItem(user.id, item, FREE_PAUSE_MS);
  if (db.useTopicCredit(user.id, key)) return deliverItem(user.id, item); // тема за приглашённого друга
  return offerPayment(ctx, 'sphere', key);
});

bot.callbackQuery('year', async (ctx) => {
  const user = db.getUser(ctx.from.id);
  if (isBusy(user.id)) return ctx.answerCallbackQuery({ text: UI.busy });
  await ctx.answerCallbackQuery();
  if (!user.birth) return askBirth(ctx);
  const year = nowTz().year;
  if (db.hasItem(user.id, `year:${year}`)) return deliverItem(user.id, `year:${year}`);
  return offerPayment(ctx, 'year', String(year));
});

bot.callbackQuery(/^yr:(\d{4})$/, async (ctx) => {
  if (isBusy(ctx.from.id)) return ctx.answerCallbackQuery({ text: UI.busy });
  await ctx.answerCallbackQuery();
  const item = `year:${ctx.match[1]}`;
  if (db.hasItem(ctx.from.id, item)) deliverItem(ctx.from.id, item);
});

bot.callbackQuery('compat', async (ctx) => {
  const user = db.getUser(ctx.from.id);
  await ctx.answerCallbackQuery();
  if (!user.birth) return askBirth(ctx);
  db.setState(user.id, 'await_partner');
  const credits = user.compat_credits ? `\n\n🎁 У вас есть оплаченных совместимостей: ${user.compat_credits}` : '';
  await ctx.reply(UI.askPartner + credits, HTML);
});

bot.callbackQuery(/^cp:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  if (isBusy(ctx.from.id)) return ctx.answerCallbackQuery({ text: UI.busy });
  await ctx.answerCallbackQuery();
  const item = `compat:${ctx.match[1]}`;
  if (db.hasItem(ctx.from.id, item)) deliverItem(ctx.from.id, item);
});

bot.callbackQuery('pack', async (ctx) => {
  const user = db.getUser(ctx.from.id);
  await ctx.answerCallbackQuery();
  if (!user.birth) return askBirth(ctx);
  return offerPayment(ctx, 'pack', String(nowTz().year));
});

// Старая кнопка «Мои разборы» из прошлых сообщений — просто показываем темы
bot.callbackQuery('my', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showMenu(ctx);
});

// Реферальная программа: друг прошёл игру по твоей ссылке → тебе тема бесплатно
bot.callbackQuery('ref', async (ctx) => {
  await ctx.answerCallbackQuery();
  const link = `https://t.me/${bot.botInfo.username}?start=ref_${ctx.from.id}`;
  const r = db.referralInfo(ctx.from.id);
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(UI.refShareText)}`;
  await ctx.reply(UI.refInfo(link, r), {
    ...HTML,
    link_preview_options: { is_disabled: true },
    reply_markup: new InlineKeyboard().url('📤 Отправить другу', share).row().text('« Все темы', 'spheres'),
  });
});

// ---------- игра «9 уровней» ----------

setupGame(bot);

// ---------- ввод дат ----------

bot.on('message:text', async (ctx) => {
  const user = db.getUser(ctx.from.id);
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  if (user.state === 'await_partner' && user.birth) {
    const partner = parseDate(text, nowTz().year);
    if (!partner) return ctx.reply(UI.badDate, HTML);
    const iso = toIso(partner);
    db.setState(user.id, null);
    if (isBusy(user.id)) return ctx.reply(UI.busy);
    if (db.useCompatCredit(user.id, iso)) return deliverItem(user.id, `compat:${iso}`);
    return offerPayment(ctx, 'compat', iso);
  }

  // Дата в начале игры (или первая дата вообще) — запускаем игру
  if (user.state === 'await_birth_game' || (!user.birth && user.state !== 'await_birth')) {
    const birth = parseDate(text, nowTz().year);
    if (!birth) return ctx.reply(UI.badDate, HTML);
    db.setBirth(user.id, toIso(birth));
    return afterBirth(ctx);
  }

  if (user.state === 'await_birth') {
    const birth = parseDate(text, nowTz().year);
    if (!birth) return ctx.reply(UI.badDate, HTML);
    db.setBirth(user.id, toIso(birth));
    const lp = lifePath(birth);
    return ctx.reply(UI.dateSaved(formatDate(birth), lp, NUMBERS[lp].title), {
      ...HTML,
      reply_markup: sphereMenu(db.getUser(user.id)),
    });
  }

  return showMenu(ctx);
});

// ---------- запуск ----------

bot.catch((err) => console.error('Ошибка обработки апдейта', err.error));

async function main() {
  console.log(PROXY_LABEL ? `Подключаюсь к Telegram через прокси ${PROXY_LABEL}…` : 'Подключаюсь к Telegram…');
  const hint = setTimeout(() => {
    console.log(
      '\n⏳ Telegram не отвечает уже 15 секунд.\n' +
        'Проверьте в браузере: https://api.telegram.org/bot<ВАШ_ТОКЕН>/getMe\n' +
        '— не открывается: api.telegram.org недоступен из вашей сети — укажите PROXY_URL в .env;\n' +
        '— уже указан PROXY_URL: проверьте прокси или попробуйте http:// и HTTP-порт;\n' +
        '— открывается: напишите, что показывает это окно дальше.\n',
    );
  }, 15000);
  try {
    await bot.init();
  } catch (e) {
    clearTimeout(hint);
    if (e instanceof GrammyError && e.error_code === 401) {
      console.error('❌ Неверный BOT_TOKEN в .env — скопируйте токен из @BotFather заново.');
    } else {
      console.error('❌ Не удалось подключиться к Telegram:', e.message);
    }
    process.exit(1);
  }
  clearTimeout(hint);

  if (cp.cryptoEnabled()) {
    try {
      const app = await cp.getMe();
      console.log(`CryptoBot подключён: ${app.name}${CRYPTOPAY_TESTNET ? ' (testnet)' : ''}`);
    } catch (e) {
      console.error('CryptoBot: проверьте CRYPTOPAY_TOKEN и CRYPTOPAY_TESTNET —', e.message);
    }
    setInterval(cryptoPollTick, CRYPTOPAY_POLL_MS);
    cryptoPollTick();
  } else {
    console.log('CRYPTOPAY_TOKEN не задан — доступна только оплата Stars');
  }

  // Без списка команд: у пользователя нет кнопки «Меню», он идёт по сюжету игры.
  // Команды (/menu, /paysupport, /stats, /reset…) продолжают работать, если их написать.
  await bot.api.deleteMyCommands().catch(() => {});

  const stop = () => bot.stop();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  console.log(`Бот @${bot.botInfo.username} запущен`);
  await bot.start({ allowed_updates: ['message', 'callback_query', 'pre_checkout_query'] });
}

main();
