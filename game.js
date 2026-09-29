// Игра «9 уровней»: бесплатная воронка по дате рождения.
// Прогресс хранится в users.game_level / users.game_request.
//
// Фото/видео/голосовые: положите файл в папку media/ с именем шага,
// например media/level2.mp4 или media/level5.jpg — бот отправит его вместе с текстом.
// Голосовое к уровню 5: media/level5_voice.ogg (или .mp3). Список имён — media/README.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InlineKeyboard, InputFile, GrammyError } from 'grammy';
import * as db from './db.js';
import { PRODUCTS, SPHERES, SPHERE_KEYS, REQUEST_TO_SPHERE, TIMEZONE } from './config.js';
import { DRIP, DRIP_OFFSETS, NUDGE, NUDGE_OFFSETS, CARDS, DOORS, rowSize } from './drip_texts.js';
import { fromIso, matrixCodes, personalYear } from './numerology.js';
import { SHADOW, LINE } from './game_shadow.js';
import { POTENTIAL } from './game_potential.js';
import { REQUESTS, REQUEST_KEYS, YEAR_BREAK, G } from './game_texts.js';
import { UI, YEARS } from './texts.js';
import { ARCANA, TOPIC_DATA, TOPIC_META, TOPIC_YEAR, topicCode } from './topic_meta.js';

const HTML = { parse_mode: 'HTML' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MEDIA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'media');

// ---------- медиа ----------

const MEDIA_TYPES = [
  ['mp4', 'video'], ['mov', 'video'], ['gif', 'animation'],
  ['jpg', 'photo'], ['jpeg', 'photo'], ['png', 'photo'], ['webp', 'photo'],
];

function findMedia(key, types = MEDIA_TYPES) {
  for (const [ext, type] of types) {
    const file = path.join(MEDIA_DIR, `${key}.${ext}`);
    if (fs.existsSync(file)) return { file, type };
  }
  return null;
}

const fileIds = new Map(); // путь → file_id, чтобы не загружать файл повторно

let bot; // задаётся в setupGame

async function sendMediaFile(chatId, m, extra = {}) {
  const src = fileIds.get(m.file) ?? new InputFile(m.file);
  const method = {
    video: 'sendVideo', animation: 'sendAnimation', photo: 'sendPhoto', voice: 'sendVoice', audio: 'sendAudio', video_note: 'sendVideoNote',
  }[m.type];
  const msg = await bot.api[method](chatId, src, extra);
  const obj = msg.video ?? msg.animation ?? msg.voice ?? msg.audio ?? msg.video_note ?? (msg.photo && msg.photo[msg.photo.length - 1]);
  if (obj?.file_id) fileIds.set(m.file, obj.file_id);
  return msg;
}

// Текст шага. Если есть медиа — отправляем его с текстом в подписи
// (или отдельно, если текст длиннее лимита подписи Telegram).
async function step(chatId, key, text, kb) {
  const extra = { ...HTML, ...(kb ? { reply_markup: kb } : {}) };
  // Видео-кружки перед сообщением: media/<шаг>_circle.mp4, <шаг>_circle1.mp4 … _circle6.mp4
  if (key) {
    for (const suffix of ['_circle', '_circle1', '_circle2', '_circle3', '_circle4', '_circle5', '_circle6']) {
      const c = findMedia(key + suffix, [['mp4', 'video_note']]);
      if (c) await sendMediaFile(chatId, c).catch((e) => console.error('circle', key, e.message));
    }
  }
  const m = key && findMedia(key);
  if (m) {
    try {
      if (text.length <= 1000) return await sendMediaFile(chatId, m, { caption: text, ...extra });
      await sendMediaFile(chatId, m);
    } catch (e) {
      console.error('media', key, e.message); // медиа не должно ломать игру
    }
  }
  return bot.api.sendMessage(chatId, text, extra);
}

// ---------- тексты уровней ----------

const lines = (arr) => arr.join('\n');

function level2(code) {
  const s = SHADOW[code];
  return (
    `🌑 <b>Уровень 2 из 9 – ТЕНЬ</b>\n\n<b>Код Тени: ${code}</b>\n\n<b>Имя Тени: ${s.name}</b>\n\n` +
    `<b>Твоя тень:</b>\n${s.shadow}\n\n${lines(s.quotes)}\n\n` +
    `<b>Твоя вытесненная часть:</b>\n${s.suppressed}\n\n<b>Твои блоки:</b>\n${lines(s.blocks)}\n\n${s.extra}\n\n` +
    `<b>Ты застрял(а) в ловушке повторяющегося цикла, если:</b>\n\n💰 <b>Деньги:</b> ${s.money}\n\n❤️ <b>Отношения:</b> ${s.love}\n\n` +
    `Главный минус: <b>${s.minus}</b>`
  );
}

function levelLine(n, code, side) {
  const l = LINE[code];
  const head = side === 'mom'
    ? `🌗 <b>Уровень ${n} из 9</b>\n\n<b>Мы нашли родовой сценарий по линии мамы 🔎</b>\n\n<b>Твой код: ${code}</b>\n<b>Сценарий по материнской линии:</b>`
    : `🌑 <b>Уровень ${n} из 9</b>\n<b>Твой сценарий по линии папы</b>\n\n<b>Код: ${code}</b>\n<b>Сценарий рода отца:</b>`;
  return (
    `<b>СЦЕНАРИЙ — ${l.title}</b>\n\n${head}\n${l.scenario}\n\n${l.text}\n\n<b>${l.quote}</b>\n\n` +
    `<b>${side === 'mom' ? 'Что мешает твоему запросу' : 'Что тормозит тебя'}:</b>\n${l.hinders}\n\n` +
    `<b>Как ты блокируешь себя:</b>\n${l.how.join('\n\n')}\n\n` +
    `<b>Твой урок:</b>\n${l.lesson.join('\n\n')}\n\n<b>Твоя задача:</b>\n${l.task}`
  );
}

function level5intro(code, name) {
  return (
    `⭐ <b>Уровень 5 из 9</b>\n<b>Точка Б</b>\n\n${name ? name + ', ты' : 'Ты'} уже увидел(а), что сформировало тебя.\n` +
    `Теперь посмотри, <b>кем ты способен(на) стать</b>, если перестанешь жить по старым сценариям.\n\n` +
    `<b>ТВОЙ КОД ПОТЕНЦИАЛА: ${code}</b>\n\n<b>Вот каким человеком ты способен(на) стать</b>\n\n` +
    `👇👇👇👇 нажми ниже,\nчтобы открыть расшифровку 👇👇👇👇`
  );
}

function level5more(code) {
  const p = POTENTIAL[code];
  const topics = p.topics.map((t) => `— ${t.replace(/[;.]$/, '')}`);
  return (
    `🌟 <b>ПОТЕНЦИАЛ:</b>\n${p.potential}\n\n🎀 <b>ТВОЙ ОБРАЗ</b>\n${p.image}\n\n` +
    `💅 <b>ТВОЙ СТИЛЬ ПОДАЧИ</b>\n${p.style}\n\n💭 <b>ТЕМЫ, НА КОТОРЫХ ТЕБЯ ЗАМЕТЯТ</b>\n${topics.join(';\n')}.\n\n` +
    `Твой контент должен вызывать:\n\n<b>${p.reaction}</b>\n\n👁 <b>ТВОЯ ГЛАВНАЯ ТРАНСЛЯЦИЯ:</b>\n${p.broadcast}\n\n` +
    `🌍 <b>ПРЕДНАЗНАЧЕНИЕ:</b>\n${p.purpose}\n\n🏹 <b>ТОЧКА Б:</b>\n${p.pointB}\n\n` +
    `Твой масштаб — <b>${p.scale}</b>.`
  );
}

function level6(c) {
  const block = (icon, label, code, s) => `${icon} <b>${label} — ${code}</b>\n<b>${s.title}</b>\n${s.text}`;
  return (
    [
      block('⚫', 'Тень', c.shadow, SHADOW[c.shadow].sum),
      block('❤️', 'Сценарий мамы', c.mom, LINE[c.mom].sum),
      block('🔵', 'Сценарий папы', c.dad, LINE[c.dad].sum),
      block('⭐', 'Потенциал', c.potential, POTENTIAL[c.potential].sum),
    ].join('\n\n') +
    `\n\n🚨 <b>Главный барьер найден</b>\nПо отдельности эти сценарии почти незаметны.\nНо вместе они образуют <b>замкнутый цикл</b> 🔄\n\n` +
    `Каждый раз он приводит тебя к <b>одному и тому же результату.</b> Именно поэтому иногда кажется, что <b>жизнь движется по кругу</b>, сколько бы ты ни старался(ась) что-то изменить.\n\n` +
    `✨ <b>Хорошая новость. Это не твой характер. Это не судьба. Это всего лишь четыре сценария,</b>\nкоторые годами управляли твоими решениями.\nИ их <b>можно переписать</b> 💡\n\n` +
    `✅ <b>Мы уже нашли решение</b>\nОсталось сделать <b>последний шаг</b> — понять, <b>как выйти из этого круга</b>\n\n⬇️ <b>Переходим дальше</b>`
  );
}

function level7(py) {
  const y = YEAR_BREAK[py];
  return (
    `<b>Уровень 7 из 9 – ПРОРЫВ</b>\n\n<b>ТВОЁ ТЕКУЩЕЕ ЧИСЛО ГОДА — ${py}</b>\n\n` +
    `🤝 <b>ЭТОТ ГОД ДЛЯ ТЕБЯ ПРО:</b>\n${y.about}\n\n💡 <b>ВАЖНО В ЭТОМ ГОДУ ОСОЗНАТЬ:</b>\n${y.realize}\n\n` +
    `⚠️ <b>НА ЧТО ОБРАТИТЬ ВНИМАНИЕ:</b>\n${y.attention.map((a) => `— ${a}`).join('\n')}\n\n` +
    `🚀 <b>ПРОРЫВ ГОДА ДАСТ:</b>\n\n<b>Ключ:</b> ${y.key}\n\n${y.list.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\n` +
    `<b>Особенно:</b> ${y.especially}\n\n<b>КАК ПРИЙТИ В ЭТУ ТОЧКУ..?\nХОЧЕШЬ УЗНАТЬ?\nЖМИ НА КНОПКУ НИЖЕ И МЫ ПРОДОЛЖИМ ИГРУ 🎮 ⬇️</b>`
  );
}

function level8(code, reqKey, name) {
  const a = POTENTIAL[code];
  const r = REQUESTS[reqKey];
  const [q1, q2, q3] = a.insight;
  return (
    `🎮 <b>Уровень 8 из 9 — ОТВЕТ НА ТВОЙ ЗАПРОС</b>\n<b>Архетип: ${a.archetype}</b>\n<b>Запрос: ${r.label}</b>\n\n` +
    `${r.lead} <b>${a.focus}.</b>\n\nТы умеешь замечать перспективу там, где другие видят только:\n<b>${q1}</b>\n${q2}\n${q3}\n` +
    `А у тебя включается другой вопрос:\n<b>${a.question}</b>\n\nПоэтому ты особенно раскрываешься там, где можно:\n` +
    `${a.spheres.map((s) => `✨ ${s}`).join('\n')}\n\nНо здесь есть одна ловушка.\n${a.trap}\n\n` +
    `Твоя точка роста:\n<b>${a.growth}</b>\n\n${r.end} ${a.outro}\n\n` +
    `🎮 <b>Ну что${name ? ', ' + name : ''}, идём в финал?</b>\n\nТы уже прошёл(ла) <b>8 уровней из 9. Остался последний.</b>\n\n` +
    `Нажимай на кнопку ниже — открываем <b>9 уровень игры</b> ⬇️`
  );
}

// ---------- ход игры ----------

const inFlight = new Set(); // защита от двойных нажатий

function codesOf(user) {
  return matrixCodes(fromIso(user.birth));
}

// Анимация «Поиск… ▓▓▓░ 87%» — одно сообщение, которое обновляется
async function analysis(chatId, labels = G.progress) {
  const bar = (p) => '█'.repeat(Math.round(p / 10)) + '░'.repeat(10 - Math.round(p / 10));
  const frames = [[0, 12], [1, 37], [1, 64], [2, 87], [3, 100]];
  const first = frames[0];
  const msg = await bot.api.sendMessage(chatId, `${labels[first[0]]}…\n${bar(first[1])} ${first[1]}%`);
  for (const [i, p] of frames.slice(1)) {
    await sleep(900);
    await bot.api.editMessageText(chatId, msg.message_id, `${labels[i]}…\n${bar(p)} ${p}%`).catch(() => {});
  }
  await sleep(600);
}

// ---------- разбор темы в формате игры ----------

const TOPIC_PROGRESS = ['Расшифровка кода темы', 'Поиск повторяющегося сценария', 'Анализ точки роста', 'Готово'];

// Прогноз темы: с сентября — на следующий год, до сентября — на текущий
function forecastYear() {
  const d = new Date();
  return d.getFullYear() + (d.getMonth() >= 8 ? 1 : 0);
}

function topicStep(key, n, user, name) {
  const t = SPHERES[key];
  const meta = TOPIC_META[key];
  const birth = fromIso(user.birth);
  const code = topicCode(key, birth);
  const [power, flow, leak, s1, s2, s3] = TOPIC_DATA[key][code];
  const next = (label) => new InlineKeyboard().text(label, `t:${key}:${n + 1}`);
  switch (n) {
    case 1:
      return {
        media: `topic_${key}`,
        text:
          `${t.emoji} <b>РАЗБОР ТЕМЫ «${t.name.toUpperCase()}»</b>\n\n${name ? name + ', м' : 'М'}ы расшифровали твой код в этой теме.\n\n${meta.intro}\n\n` +
          `🔢 <b>Твой код в теме: ${code}</b>\n<b>Аркан: ${ARCANA[code]}</b>\n\n👇👇👇 нажми ниже, чтобы открыть расшифровку 👇👇👇`,
        kb: next('🔎 Открыть расшифровку'),
      };
    case 2:
      return {
        media: 'topic2',
        text:
          `💎 <b>ТВОЯ СИЛА В ТЕМЕ «${t.name.toUpperCase()}»</b>\n\n${power}\n\n<b>Ты особенно раскрываешься там, где можно:</b>\n` +
          POTENTIAL[code].spheres.map((s) => `✨ ${s}`).join('\n'),
        kb: next('➡️ Дальше'),
      };
    case 3:
      return {
        media: 'topic3',
        text:
          `🔄 <b>ТВОЙ СЦЕНАРИЙ</b>\n\nКлассический круг для кода ${code}:\n\n<b>${flow}.</b>\n\n` +
          `Внутри в этот момент звучит:\n${SHADOW[code].quotes.join('\n')}\n\n🕳 <b>${meta.leakTitle}</b>\n${leak}`,
        kb: next('➡️ Как выйти из круга'),
      };
    case 4:
      return {
        media: 'topic4',
        text:
          `🎯 <b>ТВОЯ ТОЧКА РОСТА:</b>\n<b>${POTENTIAL[code].growth}</b>\n\n👣 <b>3 ШАГА НА БЛИЖАЙШИЙ МЕСЯЦ</b>\n\n1. ${s1}\n\n2. ${s2}\n\n3. ${s3}\n\n` +
          'Не нужно менять всё сразу. Один шаг в неделю — и через месяц ты уже в другой точке.',
        kb: next(`📅 Что ждёт в ${forecastYear()}`),
      };
    default: {
      const year = forecastYear();
      const py = personalYear(birth, year);
      return {
        media: 'topic5',
        text:
          `📅 <b>«${t.name.toUpperCase()}» В ${year} ГОДУ</b>\n\nТвой личный год — <b>${py}</b>, ${YEARS[py].title}.\n\n${TOPIC_YEAR[key][py]}\n\n` +
          `✅ <b>Тема «${t.name}» открыта</b>\nВернуться к ней можно в любой момент — она всегда отмечена ✅ в списке тем.`,
        kb: new InlineKeyboard()
          .text('🔮 Выбрать другую тему', 'spheres').row()
          .text(`🎁 Все 7 тем сразу — ${PRODUCTS.pack.stars}⭐`, 'pack').row()
          .text('👥 Пригласи друга — тема бесплатно', 'ref'),
      };
    }
  }
}

async function sendTopicStep(chatId, key, n, name) {
  const user = db.getUser(chatId);
  const s = topicStep(key, n, user, name);
  await step(chatId, s.media, s.text, s.kb);
}

// Открыть купленную/подаренную тему (из main.js). false — если пользователю уже что-то показывается
export async function openTopic(chatId, key, name) {
  if (inFlight.has(chatId)) return false;
  inFlight.add(chatId);
  try {
    await analysis(chatId, TOPIC_PROGRESS);
    await sendTopicStep(chatId, key, 1, name);
  } catch (e) {
    if (e instanceof GrammyError && e.error_code === 403) db.setBlocked(chatId);
    else console.error('topic', e);
  } finally {
    inFlight.delete(chatId);
  }
  return true;
}

async function showLevel1(chatId) {
  db.setGameLevel(chatId, 1);
  db.touchGame(chatId);
  const kb = new InlineKeyboard();
  for (const k of REQUEST_KEYS) kb.text(REQUESTS[k].label, `g:req:${k}`).row();
  await step(chatId, 'level1', G.level1, kb);
}

// Открыть уровень n (2–9). Как в примере: кнопка под уровнем N-1 → «КЛЮЧ №N-1 ПОЛУЧЕН» → уровень N.
// Ключ №1 выдаётся при выборе запроса, поэтому перед уровнем 2 ключа нет; ключ №9 — после финала.
async function showLevel(chatId, n, name) {
  const user = db.getUser(chatId);
  const c = codesOf(user);
  const next = (label) => new InlineKeyboard().text(label, `g:lvl:${n + 1}`);
  const firstTime = user.game_level < n;
  db.touchGame(chatId);
  if (firstTime) {
    db.setGameLevel(chatId, n);
    if (n >= 3) await bot.api.sendMessage(chatId, G.key(n - 1), HTML);
  }

  switch (n) {
    case 2:
      return step(chatId, 'level2', level2(c.shadow), next('🗝 ЗАБРАТЬ ВТОРОЙ КЛЮЧ'));
    case 3:
      return step(chatId, 'level3', levelLine(3, c.mom, 'mom'), next('🎲 ПРОДОЛЖИТЬ'));
    case 4:
      return step(chatId, 'level4', levelLine(4, c.dad, 'dad'), next('🎲 ДАЛЬШЕ'));
    case 5:
      return step(chatId, 'level5', level5intro(c.potential, name), new InlineKeyboard().text('🔎 Узнать', 'g:l5'));
    case 6:
      await step(chatId, 'level6', G.level6intro);
      await sleep(1500);
      return step(chatId, 'level6_result', level6(c), next('🧩 УЗНАТЬ РЕШЕНИЕ'));
    case 7: {
      const now = new Date();
      return step(chatId, 'level7', level7(personalYear(fromIso(user.birth), now.getFullYear())), next('ДА, ХОЧУ УЗНАТЬ'));
    }
    case 8:
      return step(chatId, 'level8', level8(c.archetype, user.game_request, name), next('Открыть финальный уровень 🎲'));
    case 9:
      return step(chatId, 'level9', G.finale(name), new InlineKeyboard().text('🗝 ЗАБРАТЬ 9-Й КЛЮЧ', 'g:end'));
  }
}

// После 9-го ключа: подарок (разбор темы из начала игры) и остальные 6 тем
async function showOffer(chatId, name) {
  const user = db.getUser(chatId);
  const giftKey = REQUEST_TO_SPHERE[user.game_request] ?? 'purpose';
  const giftUsed = !!user.free_sphere;
  await step(chatId, 'level9_key', G.key9(name));
  await sleep(1200);

  const kb = new InlineKeyboard();
  const label = (k) => `${SPHERES[k].emoji} ${SPHERES[k].name}`;
  if (!giftUsed) kb.text(`🎁 Забрать подарок: ${label(giftKey)}`, `sp:${giftKey}`).row();
  for (const k of SPHERE_KEYS) {
    if (!giftUsed && k === giftKey) continue;
    const owned = db.hasItem(chatId, `sphere:${k}`);
    kb.text(`${label(k)} — ${owned ? '✅' : `${PRODUCTS.sphere.stars}⭐`}`, `sp:${k}`).row();
  }
  kb.text(`🎁 Все 7 тем сразу — ${PRODUCTS.pack.stars}⭐`, 'pack').row()
    .text('👥 Пригласи друга — тема бесплатно', 'ref');
  await step(chatId, 'level9_offer', G.finaleOffer(`${SPHERES[giftKey].emoji} ${SPHERES[giftKey].name}`, giftUsed), kb);
}

// Обёртка: один шаг игры за раз на пользователя, ошибки не роняют бота
async function run(ctx, fn) {
  const id = ctx.from.id;
  const isCb = !!ctx.callbackQuery;
  if (inFlight.has(id)) {
    if (isCb) await ctx.answerCallbackQuery({ text: G.wait }).catch(() => {});
    return;
  }
  inFlight.add(id);
  try {
    if (isCb) await ctx.answerCallbackQuery().catch(() => {});
    await fn();
  } catch (e) {
    if (e instanceof GrammyError && e.error_code === 403) db.setBlocked(id);
    else console.error('game', e);
  } finally {
    inFlight.delete(id);
  }
}

// Вызывается из main.js после ввода даты рождения в начале игры
export function afterBirth(ctx) {
  const id = ctx.from.id;
  return run(ctx, async () => {
    db.resetGame(id);
    await analysis(id);
    await showLevel1(id);
  });
}

// Приветствие игры (/start)
export function sendIntro(ctx) {
  const kb = new InlineKeyboard().text('🎲 начать игру', 'g:start');
  return step(ctx.chat.id, 'intro', G.intro(escName(ctx.from.first_name)), kb);
}

// Как в примере: после нажатия кнопки она исчезает из сообщения уровня,
// и «КЛЮЧ №N ПОЛУЧЕН» оказывается прямо под текстом уровня
const dropKb = (ctx) => ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});

const escName = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export function setupGame(b) {
  bot = b;
  setupDripHandlers();

  // Начать игру: всегда просим ввести дату рождения
  bot.callbackQuery('g:start', (ctx) => run(ctx, async () => {
    await dropKb(ctx);
    db.setState(ctx.from.id, 'await_birth_game');
    await step(ctx.from.id, 'identify', G.identify);
  }));

  // Уровень 1: выбор запроса → ключ №1 → «маршрут построен»
  bot.callbackQuery(/^g:req:(\w+)$/, (ctx) => run(ctx, async () => {
    const key = ctx.match[1];
    const user = db.getUser(ctx.from.id);
    if (!REQUESTS[key] || !user.birth || user.game_level < 1) return;
    const firstTime = !user.game_request;
    await dropKb(ctx);
    db.setGameRequest(user.id, key);
    db.touchGame(user.id);
    if (firstTime) await bot.api.sendMessage(user.id, G.key(1), HTML);
    await step(user.id, 'route', G.route(escName(ctx.from.first_name), REQUESTS[key].name),
      new InlineKeyboard().text('➡️ Перейти на следующий уровень', 'g:lvl:2'));
  }));

  // После финала: ключ №9 и предложение тем
  bot.callbackQuery('g:end', (ctx) => run(ctx, async () => {
    const user = db.getUser(ctx.from.id);
    if (!user.birth || !user.game_request || user.game_level < 9) return;
    await dropKb(ctx);
    db.startDrip(user.id); // цепочка прогрева считается от окончания игры
    await showOffer(user.id, escName(ctx.from.first_name));
    // Друг прошёл игру по приглашению → пригласившему тема бесплатно (один раз)
    const referrer = db.rewardReferral(user.id);
    if (referrer) {
      await bot.api.sendMessage(referrer, UI.refReward(escName(ctx.from.first_name)), {
        ...HTML,
        reply_markup: new InlineKeyboard().text('🎁 Выбрать тему', 'spheres'),
      }).catch(() => {});
    }
  }));

  // Уровни 2–9: открывать можно только следующий или уже пройденный
  bot.callbackQuery(/^g:lvl:([2-9])$/, (ctx) => run(ctx, async () => {
    const n = Number(ctx.match[1]);
    const user = db.getUser(ctx.from.id);
    if (!user.birth || !user.game_request || n > user.game_level + 1) return;
    await dropKb(ctx);
    await showLevel(user.id, n, escName(ctx.from.first_name));
  }));

  // Уровень 5, вторая часть: расшифровка потенциала (+ голосовое, если есть)
  bot.callbackQuery('g:l5', (ctx) => run(ctx, async () => {
    const user = db.getUser(ctx.from.id);
    if (!user.birth || user.game_level < 5) return;
    await dropKb(ctx);
    db.touchGame(user.id);
    await step(user.id, 'level5_more', level5more(codesOf(user).potential));
    const voice = findMedia('level5_voice', [['ogg', 'voice'], ['oga', 'voice'], ['mp3', 'audio'], ['m4a', 'audio']]);
    const kb = new InlineKeyboard().text('➡️ Перейти на следующий уровень', 'g:lvl:6');
    if (voice) {
      await sendMediaFile(user.id, voice).catch((e) => console.error('voice', e.message));
      await bot.api.sendMessage(user.id, G.voiceNote(5), { ...HTML, reply_markup: kb });
    } else {
      await bot.api.sendMessage(user.id, G.nextNote(5), { ...HTML, reply_markup: kb });
    }
  }));
}

// ---------- прогрев после игры и напоминания ----------

function dripContext(user) {
  const reqKey = REQUEST_TO_SPHERE[user.game_request] ?? 'purpose';
  const birth = fromIso(user.birth);
  const shadowCode = matrixCodes(birth).shadow;
  return {
    name: escName(user.first_name),
    reqKey,
    reqName: SPHERES[reqKey].name,
    giftKey: reqKey,
    giftName: SPHERES[reqKey].name,
    giftUsed: !!user.free_sphere,
    shadowCode,
    shadowName: SHADOW[shadowCode].name,
    birthDay: birth.d,
    topicPrice: PRODUCTS.sphere.stars,
    packPrice: PRODUCTS.pack.stars,
  };
}

function buttonsKb(buttons, perRow = 1) {
  const kb = new InlineKeyboard();
  buttons.forEach(([label, data], i) => {
    if (/^https?:/.test(data)) kb.url(label, data); else kb.text(label, data);
    if ((i + 1) % perRow === 0) kb.row();
  });
  return kb;
}

// Час в часовом поясе бота: ночью (22–9) не беспокоим
function localHour() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}

let schedulerBusy = false;
export async function schedulerTick(force = false) {
  if (schedulerBusy) return;
  const h = localHour();
  if (!force && (h < 9 || h >= 22)) return;
  schedulerBusy = true;
  const now = Date.now();
  try {
    // 1) Бросили игру на середине: «твой ключ ждёт»
    for (const u of db.nudgeCandidates(NUDGE.length)) {
      if (now - u.game_at < NUDGE_OFFSETS[u.nudge_step]) continue;
      if (inFlight.has(u.id)) continue;
      db.setNudgeStep(u.id, u.nudge_step + 1);
      await bot.api.sendMessage(u.id, NUDGE[u.nudge_step](escName(u.first_name), u.game_level), {
        ...HTML, reply_markup: new InlineKeyboard().text('🎲 Продолжить игру', 'g:resume'),
      }).catch((e) => { if (e instanceof GrammyError && e.error_code === 403) db.setBlocked(u.id); });
      await sleep(60);
    }
    // 2) Прошли игру, но ничего не купили: цепочка прогрева
    for (const u of db.dripCandidates(DRIP.length)) {
      if (now - u.game_at < DRIP_OFFSETS[u.drip_step]) continue;
      if (db.hasPaid(u.id)) { db.setDripStep(u.id, DRIP.length); continue; } // уже покупатель — не дожимаем
      // Если несколько шагов уже просрочены (ночь, бот был выключен) — шлём только самый свежий,
      // чтобы не засыпать человека сообщениями подряд
      let s = u.drip_step;
      while (s + 1 < DRIP.length && now - u.game_at >= DRIP_OFFSETS[s + 1]) s++;
      db.setDripStep(u.id, s + 1);
      const m = DRIP[s](dripContext(u));
      try {
        await step(u.id, m.key, m.text, buttonsKb(m.buttons, rowSize(s)));
      } catch (e) {
        if (e instanceof GrammyError && e.error_code === 403) db.setBlocked(u.id);
        else console.error('drip', u.id, e.message);
      }
      await sleep(60);
    }
  } finally {
    schedulerBusy = false;
  }
}

// Все сообщения цепочки и напоминаний подряд — для просмотра админом
export async function previewDrip(chatId) {
  const user = db.getUser(chatId);
  const c = dripContext(user);
  for (let i = 0; i < NUDGE.length; i++) {
    await bot.api.sendMessage(chatId, `<i>— напоминание ${i + 1} (бросил игру) —</i>\n\n` + NUDGE[i](c.name, 4), {
      ...HTML, reply_markup: new InlineKeyboard().text('🎲 Продолжить игру', 'g:resume'),
    });
  }
  for (let i = 0; i < DRIP.length; i++) {
    const m = DRIP[i](c);
    await bot.api.sendMessage(chatId, `<i>— прогрев ${i + 1} из ${DRIP.length}, через ${Math.round(DRIP_OFFSETS[i] / 36e5 * 10) / 10} ч после игры —</i>`, HTML);
    await step(chatId, m.key, m.text, buttonsKb(m.buttons, rowSize(i)));
    await sleep(300);
  }
}

export function startScheduler() {
  setInterval(() => schedulerTick().catch((e) => console.error('scheduler', e)), 60_000);
}

function setupDripHandlers() {
  // Шаги разбора темы: открыть можно только тему, которая есть у пользователя
  bot.callbackQuery(/^t:(\w+):([2-5])$/, (ctx) => run(ctx, async () => {
    const [, key, n] = ctx.match;
    if (!SPHERES[key] || !db.hasItem(ctx.from.id, `sphere:${key}`)) return;
    await dropKb(ctx);
    await sendTopicStep(ctx.from.id, key, Number(n), escName(ctx.from.first_name));
  }));

  // Продолжить игру с места, где остановился
  bot.callbackQuery('g:resume', (ctx) => run(ctx, async () => {
    const user = db.getUser(ctx.from.id);
    await dropKb(ctx);
    if (!user?.birth || !user.game_level) return sendIntro(ctx);
    if (user.game_level >= 9) return showLevel(user.id, 9, escName(ctx.from.first_name));
    if (!user.game_request || user.game_level === 1) return showLevel1(user.id);
    return showLevel(user.id, user.game_level, escName(ctx.from.first_name));
  }));

  // Карта дня: любая из трёх кнопок открывает случайную карту
  bot.callbackQuery(/^d:card:[1-3]$/, (ctx) => run(ctx, async () => {
    const user = db.getUser(ctx.from.id);
    if (!user?.birth) return;
    await dropKb(ctx);
    const i = Math.floor(Math.random() * CARDS.length);
    const card = CARDS[i];
    const c = dripContext(user);
    await step(user.id, `card${i + 1}`,
      `✨ <b>Карта дня: ${card.name}</b>\n\n${card.text}\n\n📝 <b>Задание на сегодня:</b>\n${card.task}\n\n` +
      `${c.name ? c.name + ', к' : 'К'}арта на сегодня получена ✓\nСохрани её и выполни задание до вечера.\n\n` +
      `А полную картину — что именно делать в теме <b>«${c.reqName}»</b> — показывает разбор твоей темы 👇`,
      new InlineKeyboard().text(`🔮 Разбор «${c.reqName}»`, `sp:${c.reqKey}`));
  }));

  // Тест «Выбери дверь»
  bot.callbackQuery(/^d:door:([1-6])$/, (ctx) => run(ctx, async () => {
    const user = db.getUser(ctx.from.id);
    if (!user?.birth) return;
    await dropKb(ctx);
    const d = DOORS[Number(ctx.match[1]) - 1];
    const t = SPHERES[d.topic];
    await step(user.id, `door${ctx.match[1]}`,
      `🚪 <b>Дверь ${ctx.match[1]}</b>\n\n${d.text}\n\nИменно здесь сейчас твоя главная точка роста. Разбор темы <b>«${t.name}»</b> покажет твой код в этой сфере, сценарий, который мешает, и первые 3 шага 👇`,
      new InlineKeyboard().text(`${t.emoji} Разбор «${t.name}»`, `sp:${d.topic}`).row().text('🔮 Все темы', 'spheres'));
  }));
}

// Для тестов
export const _topicStep = topicStep;
export const _texts = { level2, levelLine, level5intro, level5more, level6, level7, level8 };
