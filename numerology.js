// Нумерологические расчёты по дате рождения.

const MASTER = [11, 22, 33];

const digitSum = (n) =>
  String(Math.abs(n))
    .split('')
    .reduce((s, d) => s + Number(d), 0);

// Сворачивает число до одной цифры; мастер-числа 11/22/33 по желанию сохраняет
export function reduce(n, keepMaster = false) {
  while (n > 9 && !(keepMaster && MASTER.includes(n))) n = digitSum(n);
  return n;
}

// Мастер-число → базовая цифра (для текстов, заданных на 1–9)
export const base = (n) => reduce(n, false);

export const isMaster = (n) => MASTER.includes(n);

// Разбор строки «ДД.ММ.ГГГГ» (разделители . / - или пробел). null — если дата некорректна.
export function parseDate(text, maxYear = new Date().getFullYear()) {
  const m = String(text).trim().match(/^(\d{1,2})[.\/\-\s](\d{1,2})[.\/\-\s](\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (y < 1900 || y > maxYear) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return { d, m: mo, y };
}

export const toIso = ({ d, m, y }) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function fromIso(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { d, m, y };
}

export const formatDate = ({ d, m, y }) =>
  `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;

// Число жизненного пути: сумма всех цифр даты, мастер-числа сохраняются
export function lifePath({ d, m, y }) {
  return reduce(digitSum(d) + digitSum(m) + digitSum(y), true);
}

// Число дня рождения (1–9)
export const birthdayNumber = ({ d }) => reduce(d);

// Личный год для календарного года
export function personalYear({ d, m }, year) {
  return reduce(digitSum(d) + digitSum(m) + digitSum(year));
}

export const personalMonth = (py, month) => reduce(py + month);

export const personalDay = (py, month, day) => reduce(personalMonth(py, month) + day);

// Квадрат Пифагора (классическая схема с четырьмя рабочими числами).
// Возвращает количество каждой цифры 1–9.
export function pythagoras({ d, m, y }) {
  const dateDigits = `${String(d).padStart(2, '0')}${String(m).padStart(2, '0')}${y}`;
  const w1 = digitSum(Number(dateDigits));
  const w2 = digitSum(w1);
  const firstDayDigit = Number(String(d)[0]);
  const w3 = Math.abs(w1 - 2 * firstDayDigit);
  const w4 = digitSum(w3);
  const all = `${dateDigits}${w1}${w2}${w3}${w4}`;
  const counts = {};
  for (let i = 1; i <= 9; i++) counts[i] = 0;
  for (const ch of all) if (ch !== '0') counts[Number(ch)]++;
  return counts;
}

// Самая выраженная цифра квадрата (при равенстве — меньшая)
export function strongestDigit(counts) {
  let best = 1;
  for (let i = 2; i <= 9; i++) if (counts[i] > counts[best]) best = i;
  return best;
}

// Число совместимости пары (1–9)
export const compatNumber = (lp1, lp2) => reduce(base(lp1) + base(lp2));
