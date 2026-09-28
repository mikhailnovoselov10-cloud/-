// Сборка разборов из текстов. Каждая функция возвращает массив HTML-сообщений.

import { SPHERES } from './config.js';
import {
  lifePath, base, isMaster, birthdayNumber, personalYear, personalMonth, personalDay,
  pythagoras, strongestDigit, compatNumber, formatDate,
} from './numerology.js';
import {
  NUMBERS, BIRTHDAY, PYTHAGORAS, SPHERE_TEXTS, YEARS, MONTHS, DAYS,
  COMPAT, COMPAT_ROLE, COMPAT_TIPS,
} from './texts.js';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

// Три разных совета: по числу пути, числу дня рождения и личному году
function pickTips(tips, ...numbers) {
  const picked = [];
  for (const n of numbers) {
    let i = (n - 1) % tips.length;
    while (picked.includes(tips[i])) i = (i + 1) % tips.length;
    picked.push(tips[i]);
  }
  return picked;
}

// Разбор сферы — 9 сообщений
export function sphereReading(birth, sphereKey, year) {
  const sphere = SPHERES[sphereKey];
  const st = SPHERE_TEXTS[sphereKey];
  const lp = lifePath(birth);
  const lpBase = base(lp);
  const bd = birthdayNumber(birth);
  const counts = pythagoras(birth);
  const strong = strongestDigit(counts);
  const py = personalYear(birth, year);
  const yearInfo = YEARS[py];
  const yearAccent = yearInfo[sphereKey];

  return [
    `${sphere.emoji} <b>${sphere.name}</b>\nДата рождения: ${formatDate(birth)}\n\n${st.intro}`,
    `🔢 <b>Ваше число жизненного пути — ${lp}</b>\n«${NUMBERS[lp].title}»\n\n${NUMBERS[lp].core}`,
    `${sphere.emoji} <b>${sphere.name}: ваш стиль</b>\n\n${st.byNumber[lpBase]}` +
      (isMaster(lp) ? '\n\nМастер-число усиливает эти качества: вы способны проявить их ярче и глубже, чем большинство людей.' : ''),
    `🎂 <b>Число дня рождения — ${bd}</b>\n\n${BIRTHDAY[bd]}\n\nВ теме «${sphere.name.toLowerCase()}» этот талант помогает вам раскрываться естественно, без лишних усилий.`,
    `🔷 <b>Квадрат Пифагора</b>\n\n${PYTHAGORAS[strong].text}\n\nСочетание с числом ${lp} делает эту черту вашей опорой в теме «${sphere.name.toLowerCase()}».`,
    `💫 <b>Ваша суперсила</b>\n\nЧисло пути ${lp}, число дня рождения ${bd} и выраженная ${strong}-ка в квадрате вместе дают редкое сочетание: ` +
      `${NUMBERS[lp].title.toLowerCase().replace(/ \(.*\)$/, '')} с талантом «${PYTHAGORAS[strong].name}». Это то, что отличает вас от других — опирайтесь на это смело.`,
    `📅 <b>${year}: личный год ${py} — ${yearInfo.title}</b>\n\n${yearInfo.text}` +
      (yearAccent ? `\n\nВ теме «${sphere.name.toLowerCase()}»: ${yearAccent}.` : ''),
    `✅ <b>Советы для вас</b>\n\n` + pickTips(st.tips, lpBase, bd, py).map((t) => `• ${t}`).join('\n'),
    `🌈 Это ваш разбор темы «${sphere.name}».\n\nПомните: цифры показывают потенциал, а раскрываете его вы. У вас для этого есть всё ✨`,
  ];
}

// Прогноз на год
export function yearReading(birth, year) {
  const py = personalYear(birth, year);
  const y = YEARS[py];
  const lp = lifePath(birth);
  const months = MONTH_NAMES.map((name, i) => {
    const pm = personalMonth(py, i + 1);
    return `<b>${name}</b> (${pm}) — ${MONTHS[pm]}`;
  });
  return [
    `📅 <b>Прогноз на ${year} год</b>\nДата рождения: ${formatDate(birth)}\n\nВаш личный год — <b>${py}</b>, ${y.title}.`,
    `✨ <b>Главная тема года</b>\n\n${y.text}\n\nВаше число пути ${lp} («${NUMBERS[lp].title}») помогает прожить этот год в полную силу.`,
    `🎯 <b>Акценты года</b>\n\n💖 Любовь: ${y.love}\n💰 Деньги: ${y.money}\n🚀 Карьера: ${y.career}`,
    `🗓 <b>Помесячный прогноз</b>\n\n${months.join('\n')}`,
    `🌈 Пусть ${year} станет для вас годом, в котором ваши сильные стороны раскроются на максимум ✨`,
  ];
}

// Совместимость
export function compatReading(birth, partner) {
  const lp1 = lifePath(birth);
  const lp2 = lifePath(partner);
  const cn = compatNumber(lp1, lp2);
  const c = COMPAT[cn];
  return [
    `💞 <b>Совместимость</b>\n\nВы: ${formatDate(birth)} — число пути <b>${lp1}</b>\nПартнёр: ${formatDate(partner)} — число пути <b>${lp2}</b>`,
    `👤 <b>Что вы даёте друг другу</b>\n\nВы (${lp1}) ${COMPAT_ROLE[base(lp1)]}.\n\nПартнёр (${lp2}) ${COMPAT_ROLE[base(lp2)]}.`,
    `💫 <b>Число пары — ${cn}: ${c.title}</b>\n\n${c.text}`,
    `✅ <b>Советы паре</b>\n\n` + COMPAT_TIPS.map((t) => `• ${t}`).join('\n'),
  ];
}

// Ежедневный прогноз
export function dailyForecast(birth, { year, month, day }) {
  const py = personalYear(birth, year);
  const pd = personalDay(py, month, day);
  const variants = DAYS[pd];
  const text = variants[(day + month) % variants.length];
  return `☀️ <b>Прогноз на ${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}</b>\n\nВаш личный день — <b>${pd}</b>.\n${text}`;
}
