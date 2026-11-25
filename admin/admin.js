'use strict';
const $ = s => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e };
const btn = (text, fn) => el('button', { type: 'button', textContent: text, onclick: fn });

const TABLE = '/rest/v1/pc_catalog', QUERY = TABLE + '?id=eq.1&select=id,data,revision';
const MAX_SIZE = 10 * 1024 * 1024;
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', csv: 'text/csv' };
const CHOICES = {
  c: { od: 'Овердрайвы', ds: 'Дисторшн', fz: 'Фуззы', cp: 'Компрессоры / гейты', md: 'Дилей / ревер / мод', ot: 'Прочее' },
  d: { 1: 'Лёгкая', 2: 'Средняя', 3: 'Сложная' },
};
// [ключ, подпись, тип]
const SCHEMA = [
  ['n', 'Модель'], ['m', 'Производитель оригинала'], ['sku', 'Артикул'], ['c', 'Категория'], ['d', 'Сложность'],
  ['price', 'Цена, ₽', 'number'], ['st', 'Остаток, шт.', 'number'], ['originalPrice', 'Цена оригинала, ₽ (0 — не показывать)', 'number'], ['pop', 'Приоритет сортировки', 'number'],
  ['active', 'Показывать на сайте', 'check'], ['hit', 'Бейдж «Хит»', 'check'], ['nw', 'Бейдж «Новинка»', 'check'],
  ['top', 'Подборка «Топ продаж»', 'check'], ['popular', 'Подборка «Популярные»', 'check'],
  ['summary', 'Краткое описание', 'textarea'], ['description', 'Полное описание', 'textarea'],
  ['features', 'Особенности — по одной в строке', 'textarea'], ['specs', 'Характеристики — «Название: значение», по одной в строке', 'textarea'],
];

let token = sessionStorage.pcToken, row, cat, cur, faq = [], busy = false, dirty = false;
const api = (path, opts) => pcStore.request(path, { token, ...opts });
const say = (msg, error = false) => { $('#status').textContent = msg; $('#status').dataset.error = error };

// Блокирует интерфейс на время операции и показывает ошибки.
const run = work => async e => {
  e?.preventDefault();
  if (busy) return;
  busy = true; $('main').inert = true;
  try { await work(e) } catch (err) { say(err.message, true) } finally { $('main').inert = false; busy = false }
};

// ---------- данные ----------
async function save(data) {
  const res = await api(`${TABLE}?id=eq.1&revision=eq.${row.revision}&select=id,data,revision`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data, revision: row.revision + 1 }) });
  if (!res?.length) throw Error('Каталог изменён в другой вкладке. Обновите страницу.');
  row = res[0]; cat = row.data; dirty = false;
  renderStock();
}

async function init() {
  try {
    if (await api('/rest/v1/rpc/pc_is_admin', { method: 'POST', body: '{}' }) !== true) throw Error('У этой учётной записи нет прав администратора.');
    [row] = await api(QUERY);
    if (!row) { // первый вход: импорт стартового каталога
      await api(TABLE, { method: 'POST', body: JSON.stringify({ id: 1, data: await pcStore.seed() }) });
      [row] = await api(QUERY);
    }
  } catch (err) { token = undefined; sessionStorage.removeItem('pcToken'); throw err }
  cat = row.data; faq = structuredClone(cat.faq);
  renderList(cat.products[0]?.id); openProduct(cat.products[0]); renderStock(); renderFaq();
  $('#login').hidden = true; $('#panel').hidden = false; say('Данные загружены.');
}

// ---------- вкладки ----------
function showTab(name) {
  document.querySelectorAll('[data-pane]').forEach(p => p.hidden = p.id !== name);
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
}
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => !busy && showTab(b.dataset.tab));

// ---------- товары ----------
const form = $('#product');
for (const [key, title, type] of SCHEMA) {
  const input = CHOICES[key] ? el('select') : type === 'textarea' ? el('textarea') : el('input');
  input.name = key;
  if (CHOICES[key]) for (const [v, t] of Object.entries(CHOICES[key])) input.add(new Option(t, v));
  else if (input.tagName === 'INPUT') input.type = type === 'check' ? 'checkbox' : type || 'text';
  if (type === 'number') Object.assign(input, { min: 0, max: 99999999, step: 1, required: true });
  if (['n', 'm', 'sku'].includes(key)) Object.assign(input, { maxLength: 140, required: true });
  $('#fields').append(el('label', {}, title, input));
}
form.addEventListener('input', () => dirty = true);
window.addEventListener('beforeunload', e => { if (dirty) e.preventDefault() });

const nextId = () => Math.max(-1, ...cat.products.map(p => p.id)) + 1;
const label = p => `${p.active ? '' : '[Скрыт] '}${p.m} — ${p.n}`;

function renderList(id) {
  const sel = $('#items');
  sel.replaceChildren(...cat.products.map(p => new Option(label(p), p.id)));
  sel.disabled = !cat.products.length;
  if (id != null) sel.value = String(id);
}
function openProduct(p) {
  cur = p && structuredClone(p); form.hidden = !p; dirty = false;
  if (!p) return;
  for (const [k, , t] of SCHEMA) {
    const e = form.elements[k];
    if (t === 'check') e.checked = Boolean(p[k]); else e.value = p[k] ?? '';
  }
  $('#upload-photos').value = $('#upload-docs').value = '';
  renderAssets();
}
function readForm() {
  const p = structuredClone(cur);
  for (const [k, , t] of SCHEMA) {
    const e = form.elements[k];
    p[k] = t === 'check' ? e.checked : (t === 'number' || k === 'd') ? Number(e.value) : e.value.trim();
  }
  return p;
}
function renderAssets() {
  for (const kind of ['photos', 'docs']) {
    const list = cur[kind];
    $('#' + kind).replaceChildren(...list.map((v, i) => {
      const href = pcStore.media(kind === 'photos' ? v : v.path);
      const line = el('div', { className: 'row asset' });
      if (kind === 'photos') line.append(el('img', { src: href, alt: 'Фото ' + (i + 1) }));
      else line.append(
        el('input', { value: v.title, ariaLabel: 'Название документа', oninput: e => v.title = e.target.value }),
        el('a', { href, target: '_blank', rel: 'noopener', textContent: 'Открыть' }));
      const up = btn('↑', () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; renderAssets() });
      up.disabled = i === 0;
      line.append(up, btn('Убрать', () => { list.splice(i, 1); renderAssets() }));
      return line;
    }));
  }
}
function checkFile(file, kind) {
  const type = TYPES[file.name.split('.').pop().toLowerCase()];
  if (!type || (kind === 'photos') !== type.startsWith('image/') || file.size < 1 || file.size > MAX_SIZE)
    throw Error(`Неподходящий формат или размер больше 10 МБ: ${file.name}`);
  return type;
}
async function upload(file, id, kind) {
  const type = checkFile(file, kind);
  const path = `${id}/${crypto.randomUUID()}.${file.name.split('.').pop().toLowerCase()}`;
  await api('/storage/v1/object/pedalcraft-media/' + path, { method: 'POST', headers: { 'Content-Type': type }, body: file });
  return path;
}

$('#items').onchange = () => !busy && openProduct(cat.products.find(p => p.id === Number($('#items').value)));
$('#new').onclick = () => {
  if (busy) return;
  const id = nextId();
  $('#items').selectedIndex = -1;
  openProduct({ id, sku: String(id + 1).padStart(6, '0'), c: 'od', d: 1, price: 490, st: 0, pop: 0, originalPrice: 0, active: false, photos: [], docs: [] });
  dirty = true; say('Новый товар скрыт с витрины, пока не отметите «Показывать на сайте».');
};
$('#copy').onclick = () => {
  if (busy || !cur) return;
  const id = nextId();
  openProduct({ ...readForm(), id, sku: String(id + 1).padStart(6, '0'), n: cur.n + ' (копия)', active: false, photos: [], docs: [] });
  $('#items').selectedIndex = -1; dirty = true; say('Копия создана. Измените название и сохраните.');
};
$('#del').onclick = run(async () => {
  const p = cat.products.find(x => x.id === Number($('#items').value));
  if (!p || !confirm(`Удалить «${label(p)}» безвозвратно? Чтобы просто скрыть товар, снимите «Показывать на сайте».`)) return;
  await save({ ...cat, products: cat.products.filter(x => x.id !== p.id) });
  renderList(cat.products[0]?.id); openProduct(cat.products[0]); say('Товар удалён.');
});
form.onsubmit = run(async () => {
  const p = readForm();
  if (!p.n || !p.m || !p.sku) throw Error('Заполните модель, производителя и артикул.');
  if (cat.products.some(x => x.id !== p.id && x.sku === p.sku)) throw Error('Такой артикул уже используется.');
  if (p.docs.some(d => !d.title.trim())) throw Error('Укажите названия документов.');
  const pending = ['photos', 'docs'].flatMap(k => [...$('#upload-' + k).files].map(file => ({ k, file })));
  pending.forEach(({ k, file }) => checkFile(file, k));
  const [latest] = await api(TABLE + '?id=eq.1&select=revision'); // не грузим файлы, если каталог уже устарел
  if (latest?.revision !== row.revision) throw Error('Каталог изменился в другой вкладке. Обновите страницу.');
  for (const { k, file } of pending) {
    say('Загрузка: ' + file.name);
    const path = await upload(file, p.id, k);
    p[k].push(k === 'photos' ? path : { path, title: file.name });
  }
  const products = cat.products.some(x => x.id === p.id) ? cat.products.map(x => x.id === p.id ? p : x) : [...cat.products, p];
  await save({ ...cat, products });
  renderList(p.id); openProduct(p);
  say(p.active ? 'Сохранено и опубликовано.' : 'Сохранено, на витрине скрыто.');
});

// ---------- склад ----------
function renderStock() {
  const cell = (p, k) => {
    const i = el('input', { type: k === 'active' ? 'checkbox' : 'number', min: 0 });
    i.dataset.id = p.id; i.dataset.k = k;
    k === 'active' ? i.checked = p.active : i.value = p[k];
    return el('td', {}, i);
  };
  $('#rows').replaceChildren(...cat.products.map(p => el('tr', {}, el('td', { textContent: `${p.m} — ${p.n}` }), cell(p, 'price'), cell(p, 'st'), cell(p, 'active'))));
}
$('#stock-form').onsubmit = run(async () => {
  const products = cat.products.map(p => ({ ...p }));
  document.querySelectorAll('#rows input').forEach(i => {
    const p = products.find(x => x.id === Number(i.dataset.id)), k = i.dataset.k;
    p[k] = k === 'active' ? i.checked : Math.max(0, Math.round(Number(i.value)) || 0);
  });
  await save({ ...cat, products });
  renderList(Number($('#items').value)); say('Склад и цены сохранены.');
});

// ---------- FAQ ----------
function renderFaq() {
  $('#questions').replaceChildren(...faq.map((qa, i) => {
    const q = el('input', { value: qa[0], required: true, oninput: e => qa[0] = e.target.value });
    const a = el('textarea', { value: qa[1], required: true, oninput: e => qa[1] = e.target.value });
    const up = btn('Выше', () => { [faq[i - 1], faq[i]] = [faq[i], faq[i - 1]]; renderFaq() });
    up.disabled = i === 0;
    return el('fieldset', {}, el('label', {}, 'Вопрос', q), el('label', {}, 'Ответ', a), up, btn('Удалить', () => { faq.splice(i, 1); renderFaq() }));
  }));
}
$('#new-question').onclick = () => { faq.push(['', '']); renderFaq() };
$('#faq-form').onsubmit = run(async () => {
  const clean = faq.map(qa => qa.map(x => x.trim()));
  if (clean.some(qa => !qa[0] || !qa[1])) throw Error('Заполните все вопросы и ответы.');
  await save({ ...cat, faq: clean }); say('FAQ опубликован.');
});

// ---------- вход ----------
$('#login').onsubmit = run(async e => {
  if (!pcStore.configured) throw Error('Сначала подключите Supabase (см. README).');
  const data = new FormData(e.target);
  say('Вход…');
  const session = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: data.get('email'), password: data.get('password') }) });
  e.target.reset(); token = session.access_token; sessionStorage.pcToken = token; // живёт до закрытия вкладки
  await init();
});
$('#logout').onclick = run(async () => {
  try { await api('/auth/v1/logout?scope=local', { method: 'POST' }) } finally { sessionStorage.removeItem('pcToken'); location.reload() }
});

showTab('products');
if (!pcStore.configured) say('Подключите Supabase по README. Пока витрина показывает catalog.json.');
else if (token) run(init)().then(() => { if (!cat) say('Сессия истекла, войдите снова.') });
