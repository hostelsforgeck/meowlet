/* ============================================================
   Money Manager — web port of the terminal app.

   Same data model as the Python version's shelve db:

     { name, current, history: { "15_Mar_25": { reason: [balanceAfter, "+100"] } },
       people: { name: [owed, reason, date] } }

   Same command grammar in the amount field: 5, +5, -5, g5 (give),
   t5 (take). Whole rupees only. Same reason de-duplication, same
   undo, same people ledger, same export tables. Storage is
   localStorage instead of shelve.

   The shell is not a port. The ledger reads when · reason · flow · bal with
   no heading row; the bottom bar is a balance plate plus two direction keys;
   and feedback is the row itself rather than a toast.
   ============================================================ */

(() => {
  'use strict';

  /* v2: the history tuple gained a time — [balanceAfter, flow, "HH:MM"]. */
  const STORE_KEY = 'money-manager.v2';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FONT_KEY = 'money-manager.font';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ---------- dates: the Python "%d_%b_%y" key ---------- */

  const dateKey = (d) =>
    `${String(d.getDate()).padStart(2, '0')}_${MONTHS[d.getMonth()]}_${String(d.getFullYear()).slice(-2)}`;

  function parseKey(key) {
    const [dd, mon, yy] = key.split('_');
    return new Date(2000 + Number(yy), MONTHS.indexOf(mon), Number(dd));
  }

  /* ---------- money formatting ---------- */

  const group = (n) => Math.abs(n).toLocaleString('en-IN');
  /* the balance column carries no rupee sign — the flow says it once a row */
  const plain = (n) => (n < 0 ? '-' : '') + group(n);
  /* 24-hour: five fixed characters, so times column up in a mono face */
  const clock = (d) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const rupees = (n) => (n < 0 ? '-' : '') + '₹' + group(n);
  const flowText = (flow) => flow[0] + '₹' + group(Number(flow.slice(1)));

  /* ---------- state ---------- */

  let state = load();

  function blank() {
    return { name: '', current: 0, history: {}, people: {} };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(blank(), JSON.parse(raw));
    } catch (_) { /* blocked storage — run in memory */ }
    return seed();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (_) { /* nothing to do — the UI keeps working */ }
  }

  /* A sample ledger so a fresh install has something to read.
     "Clear all" empties it. */
  function seed() {
    const s = blank();
    const entries = [
      [9, 'Opening balance',      '+', 2000, null,  '09:00'],
      [8, 'Bus pass',             '-',  350, null,  '08:20'],
      [8, 'Chai with Arjun',      '-',   40, null,  '16:45'],
      [7, 'Groceries',            '-',  620, null,  '18:10'],
      [6, 'Borrowed from Sana',   '+',  400, 'Sana','11:05'],
      [6, 'Tuition fee received', '+', 1500, null,  '19:30'],
      [5, 'Notebook and pens',    '-',  180, null,  '08:12'],
      [4, 'Lent to Ravi',         '-',  500, 'Ravi','09:40'],
      [3, 'Midnight pizza',       '-',  100, null,  '23:05'],
      [2, 'Birthday gift from mom', '+', 500, null, '10:20'],
      [2, 'Movie ticket',         '-',  250, null,  '16:15'],
      [1, 'Phone recharge',       '-',  299, null,  '09:02'],
      [1, 'Ravi paid back',       '+',  300, 'Ravi','18:33'],
      [0, 'Sold old textbooks',   '+',  400, null,  '08:30'],
      [0, 'Auto fare',            '-',   60, null,  '19:11'],
    ];
    for (const [back, reason, op, amount, person, at] of entries) {
      const when = new Date();
      when.setDate(when.getDate() - back);
      const [hh, mm] = at.split(':');
      when.setHours(Number(hh), Number(mm), 0, 0);
      record(s, when, op, String(amount), reason, person);
    }
    return s;
  }

  /* ---------- the write path, ported straight across ---------- */

  // check_reason_exist: two entries on one date cannot share a key.
  function uniqueReason(day, how) {
    if (!day || !(how in day)) return how;
    let i = 1;
    while (`${how}(${i})` in day) i++;
    return `${how}(${i})`;
  }

  // check_name_in_db: a person's balance nets out, and clears at zero.
  function updatePerson(db, name, op, amount, how, key) {
    if (!(name in db.people)) {
      db.people[name] = [`${op}${amount}`, how, key];
      return;
    }
    const owed = Number(db.people[name][0]) + (op === '+' ? Number(amount) : -Number(amount));
    if (owed === 0) delete db.people[name];
    else db.people[name] = [String(owed), how, key];
  }

  function record(db, when, op, amount, how, person) {
    db.current += (op === '+' ? Number(amount) : -Number(amount));
    const key = dateKey(when);
    if (!db.history[key]) db.history[key] = {};
    db.history[key][uniqueReason(db.history[key], how)] =
      [db.current, `${op}${amount}`, clock(when)];
    if (person) updatePerson(db, person, op, amount, how, key);
  }

  // undo: drop the newest transaction and rewind the balance to what
  // it was before it, skipping any date group left empty.
  function undo() {
    const dates = Object.keys(state.history);
    if (!dates.length) return false;
    const key = dates[dates.length - 1];
    const reasons = Object.keys(state.history[key]);
    if (!reasons.length) { delete state.history[key]; return undo(); }
    const last = reasons[reasons.length - 1];
    const [balanceAfter, flow] = state.history[key][last];
    state.current = balanceAfter - Number(flow);
    delete state.history[key][last];
    if (!Object.keys(state.history[key]).length) delete state.history[key];
    return true;
  }

  /* ---------- amount grammar ---------- */

  // 5 / +5 / -5 add or subtract; g5 gives (lends), t5 takes (collects).
  /* One entry tops out at four digits. Every route in — typed, lent, collected —
     goes through here, so this is the only place the ceiling has to exist.
     It is checked on the VALUE, not the digit count: 00009999 is four digits
     wearing a hat. */
  const MAX_ENTRY = 9999;

  function parseAmount(raw) {
    const x = raw.trim();
    if (x === '') return { error: "Type an amount, for example +5" };

    let op = '+', digits = x, person = false;

    if (!/^\d+$/.test(x)) {
      const head = x[0].toLowerCase();
      digits = x.slice(1);
      if (!/^\d+$/.test(digits)) {
        return { error: /[.,]/.test(digits) ? 'Whole rupees only — no decimals.' : 'INVALID!' };
      }
      if (head === '+') { op = '+'; }
      else if (head === '-') { op = '-'; }
      else if (head === 'g') { op = '-'; person = true; }
      else if (head === 't') { op = '+'; person = true; }
      else return { error: 'INVALID!' };
    }

    if (Number(digits) > MAX_ENTRY) {
      return { error: `One entry tops out at ${rupees(MAX_ENTRY)}. Split it.` };
    }
    return { op, amount: digits, person };
  }

  /* ---------- render ---------- */

  const card = document.getElementById('card');
  const scroller = document.getElementById('scroller');
  const blankNote = document.getElementById('blank');

  /* The two figure columns are fixed so the whole ledger lines up — each row is
     its own grid, so an `auto` track would size per row and the columns would
     stop agreeing with each other. Fixed tracks mean the text has to give way
     instead, in two steps.

     The counts are measured at the real column widths, not guessed: the balance
     track is 104u with 14u of padding, which holds seven characters at full
     size and nine at the first step down. A lakh is eight. */
  const FITS  = { 'c-flow': 9,  'c-bal': 7 };    /* full size */
  const FITS2 = { 'c-flow': 11, 'c-bal': 9 };    /* first step down */

  function room(cls, text) {
    if (text == null || !FITS[cls]) return '';
    if (text.length > FITS2[cls]) return ' is-vlong';
    if (text.length > FITS[cls])  return ' is-long';
    return '';
  }

  function cell(cls, text) {
    const el = document.createElement('div');
    el.className = 'cell ' + cls + room(cls, text);
    el.setAttribute('role', 'cell');
    if (text != null) {
      const span = document.createElement('span');
      span.textContent = text;
      el.appendChild(span);
    }
    return el;
  }

  /* when · reason · flow · bal.

     The day number only prints on the first row of a date; continuation
     rows indent to the time, which reads as "same day" without a rule or a
     repeat. There is no weekday letter and no heading row. */
  function buildRow(date, isFirst, isToday, flow, balance, reason, at) {
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('role', 'row');
    if ([0, 6].includes(date.getDay())) row.classList.add('is-weekend');
    if (isToday) row.classList.add('is-today');
    row.setAttribute('aria-label',
      `${date.getDate()} ${MONTHS[date.getMonth()]}${at ? ' ' + at : ''}, ` +
      `${flowText(flow)}, balance ${rupees(balance)}, ${reason}`);

    const when = document.createElement('div');
    when.className = 'cell c-when' + (isFirst ? '' : ' is-cont');
    when.setAttribute('role', 'cell');
    const inner = document.createElement('span');
    inner.className = 'when-in';
    if (isFirst) {
      const num = document.createElement('span');
      num.className = 'daynum';
      num.textContent = String(date.getDate());
      inner.appendChild(num);
    }
    if (at) {
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = at;
      inner.appendChild(t);
    }
    when.appendChild(inner);

    const flowCell = cell('c-flow', flowText(flow));
    if (flow[0] === '-') flowCell.classList.add('is-out');

    row.append(when, cell('c-reason', reason), flowCell, cell('c-bal', plain(balance)));
    return row;
  }

  function render() {
    const today = dateKey(new Date());
    card.textContent = '';
    let rows = 0;

    for (const [key, txns] of Object.entries(state.history)) {
      const date = parseKey(key);
      let first = true;
      for (const [reason, [balance, flow, at]] of Object.entries(txns)) {
        card.appendChild(
          buildRow(date, first, first && key === today, flow, balance, reason, at));
        first = false;
        rows++;
      }
    }

    blankNote.hidden = rows > 0;
    card.hidden = rows === 0;
    Plate.rest();
  }

  /* ---------- the row is the receipt ----------

     No toast: a new transaction tints its own row, an undone one collapses
     away. Nothing is covered, and the confirmation is the actual data. */

  function flashLast() {
    const row = card.lastElementChild;
    if (!row) return;
    row.classList.remove('is-new');
    void row.offsetWidth;
    row.classList.add('is-new');
  }

  function collapseLast(then) {
    const row = card.lastElementChild;
    if (!row || reduced) { then(); return; }
    row.classList.add('is-gone');
    setTimeout(then, 340);
  }

  /* ---------- sheets ---------- */

  const overlay = document.getElementById('overlay');
  const sheetTitle = document.getElementById('sheetTitle');
  const sheetBody = document.getElementById('sheetBody');
  const sheetActions = document.getElementById('sheetActions');
  let lastFocus = null;

  function openSheet(title, body, actions) {
    lastFocus = document.activeElement;
    sheetTitle.textContent = title;
    sheetBody.textContent = '';
    sheetBody.append(body);
    sheetActions.textContent = '';
    for (const [label, variant, onClick] of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-' + variant;
      b.textContent = label;
      b.addEventListener('click', onClick);
      sheetActions.appendChild(b);
    }
    overlay.hidden = false;
    (sheetBody.querySelector('input') || sheetActions.querySelector('.btn-primary') ||
     sheetActions.firstChild).focus();
  }

  function closeSheet() {
    overlay.hidden = true;
    if (lastFocus) lastFocus.focus();

    /* ...and the cat comes back off the plate.

       A hold that COMMITTED never gets its press(false). The commit callback
       clears `holding`, so the pointerup that follows returns early out of
       release() — and that is right while the sheet is up, because he IS the
       white screen it opened behind and shrinking him there would undo the one
       thing the gesture was for. It just leaves nobody to bring him home
       afterwards: he stays at scale(coverBy) with is-press still on, so the
       plate comes back as a blank white tile with no balance on it and no
       breathing left, and only a reload clears it.

       The close is the other half of the press, so this is where it belongs
       — he eases home over releaseMs as the sheet goes, which is the growth
       played backwards rather than a second effect bolted on.

       Safe on every other path: sheets opened from the two keys never grew him,
       and press(false) with nothing to undo does nothing but restart the doze
       clock, which closing a sheet should do anyway. */
    if (window.Mascot) window.Mascot.press(false);
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSheet(); });

  function field(label, id, placeholder, hint) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const l = document.createElement('label');
    l.htmlFor = id;
    l.textContent = label;
    const i = document.createElement('input');
    i.id = id;
    i.type = 'text';
    i.placeholder = placeholder || '';
    i.autocomplete = 'off';
    i.spellcheck = false;
    wrap.append(l, i);
    if (hint) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = hint;
      wrap.appendChild(p);
    }
    return wrap;
  }

  /* ---------- the plate ----------

     One zone showing one thing at a time: the greeting on open, the balance
     at rest, the figure rolling when money moves, a short message after an
     action that produced no row. Never two at once, and every state returns
     to the balance — that is the resting state and the fastest fact here. */

  const plateEl = document.getElementById('plate');
  let plateSeq;

  function plateSwap(node) {
    const old = plateEl.querySelector('.pl-layer:not(.out)');
    if (old) {
      if (reduced) old.remove();
      else { old.classList.add('out'); setTimeout(() => old.remove(), 420); }
    }
    const layer = document.createElement('span');
    layer.className = 'pl-layer' + (reduced ? '' : ' in');
    layer.appendChild(node);
    plateEl.appendChild(layer);
  }

  /* Only the digits that actually changed roll — that is what makes it read
     as a counter rather than a wipe. */
  function figure(to, from) {
    const box = document.createElement('span');
    const a = from == null ? null : rupees(from);
    const b = rupees(to);

    /* The mascot takes a corner of the plate, which leaves the figure seven
       characters at full size. Past that it steps down rather than overflow.
       The steps are not guesses: every balance from 9 to 999999999, both signs,
       was measured against the plate's real width. Eight characters is
       -99,999 with the symbol — an overdraft, not an edge case. */
    const room = b.length > 11 ? ' is-xlong'
               : b.length > 9  ? ' is-vlong'
               : b.length > 7  ? ' is-long' : '';
    box.className = 'pl-bal' + (to < 0 ? ' is-negative' : '') + room;
    [...b].forEach((ch, i) => {
      const d = document.createElement('span');
      d.className = 'd';
      const prev = a && a.length === b.length ? a[i] : null;
      const changed = prev != null && prev !== ch && !reduced;
      const top = document.createElement('i');
      top.textContent = changed ? prev : ch;
      d.appendChild(top);
      if (changed) {
        const next = document.createElement('i');
        next.textContent = ch;
        d.appendChild(next);
        d.classList.add('roll');
      }
      box.appendChild(d);
    });
    return box;
  }

  /* The mascot's corner leaves these about 137 reference px. The figure has its
     own step-down; the greeting and the messages get one here, with an ellipsis
     behind it for a name longer than any step can rescue. */
  const LIMIT = { 'pl-greet': 9, 'pl-msg': 11 };

  function span(cls, text) {
    const el = document.createElement('span');
    el.className = cls + (text.length > (LIMIT[cls] || 99) ? ' is-long' : '');
    el.textContent = text;
    return el;
  }

  const Plate = {
    rest() {
      clearTimeout(plateSeq);
      plateSwap(figure(state.current));
      plateEl.setAttribute('aria-label', `Balance ${rupees(state.current)} — open You`);
    },

    /* the greeting has the plate to itself, then hands it back */
    greet() {
      if (!state.name) { Plate.rest(); return; }
      clearTimeout(plateSeq);
      plateSwap(span('pl-greet', `Hi ${state.name}`));
      plateSeq = setTimeout(() => Plate.rest(), reduced ? 600 : 1900);
    },

    roll(from) {
      clearTimeout(plateSeq);
      const cur = plateEl.querySelector('.pl-layer:not(.out)');
      const box = figure(state.current, from);
      if (cur) { cur.textContent = ''; cur.appendChild(box); }
      else plateSwap(box);
      plateEl.setAttribute('aria-label', `Balance ${rupees(state.current)} — open You`);

      /* The mascot is optional scenery in its own file, so it is asked rather
         than called: with mascot.js absent the ledger is exactly as it was.
         The direction comes off the balance, not off which key was pressed, so
         an undo animates the way the money actually moved. */
      if (state.current !== from && window.Mascot) {
        window.Mascot.mood(state.current > from ? 'in' : 'out');
      }
    },

    /* for the few actions that produce no row at all */
    say(message) {
      clearTimeout(plateSeq);
      plateSwap(span('pl-msg', message));
      plateSeq = setTimeout(() => Plate.rest(), 1600);
    }
  };

  /* ---------- typeface ----------

     The ledger is a column of numbers, so every option is a monospace:
     a proportional face would break the grid the CSS is measured on.
     `fallback` is what shows before the webfont arrives, and forever
     if the network is gone — always a mono already on the device. */

  const FALLBACK =
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

  const FONTS = [
    { id: 'plex',      label: 'IBM Plex Mono',  family: 'IBM Plex Mono',
      google: 'IBM+Plex+Mono:wght@400;500', note: 'dotted zero' },
    { id: 'roboto',    label: 'Roboto Mono',    family: 'Roboto Mono',
      google: 'Roboto+Mono:wght@400;500',   note: 'slashed zero — matches the capture' },
    { id: 'jetbrains', label: 'JetBrains Mono', family: 'JetBrains Mono',
      google: 'JetBrains+Mono:wght@400;500', note: 'tall x-height' },
    { id: 'geist',     label: 'Geist Mono',     family: 'Geist Mono',
      google: 'Geist+Mono:wght@400;500',    note: 'narrow, flat' },
    { id: 'source',    label: 'Source Code Pro', family: 'Source Code Pro',
      google: 'Source+Code+Pro:wght@400;500', note: 'wider, rounder' },
    { id: 'system',    label: 'System mono',    family: null,
      google: null, note: 'no download — whatever this device ships' },
  ];

  const DEFAULT_FONT = 'plex';
  const fontById = (id) => FONTS.find((f) => f.id === id) || FONTS[0];
  const stackFor = (f) => (f.family ? `"${f.family}", ${FALLBACK}` : FALLBACK);

  /* One <link> per family, added the first time it is needed and then
     left in place — swapping back is instant. */
  function loadFont(f) {
    if (!f.google || document.getElementById('font-' + f.id)) return;
    const link = document.createElement('link');
    link.id = 'font-' + f.id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
    document.head.appendChild(link);
  }

  function applyFont(id) {
    const f = fontById(id);
    loadFont(f);
    document.documentElement.style.setProperty('--font', stackFor(f));
    return f;
  }

  function readFont() {
    try { return localStorage.getItem(FONT_KEY) || DEFAULT_FONT; }
    catch (_) { return DEFAULT_FONT; }
  }

  function writeFont(id) {
    try { localStorage.setItem(FONT_KEY, id); } catch (_) { /* memory only */ }
  }

  let currentFont = applyFont(readFont());

  function chooseFont() {
    FONTS.forEach(loadFont);            // so every preview renders in its own face

    const body = document.createElement('div');
    body.className = 'choices';
    body.setAttribute('role', 'radiogroup');
    body.setAttribute('aria-label', 'Typeface');

    for (const f of FONTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice' + (f.id === currentFont.id ? ' is-on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(f.id === currentFont.id));

      const name = document.createElement('span');
      name.className = 'choice-name';
      name.textContent = f.label;

      const sample = document.createElement('span');
      sample.className = 'choice-sample';
      sample.style.fontFamily = stackFor(f);
      sample.textContent = '10:29  -\u20B92,450';

      const note = document.createElement('span');
      note.className = 'choice-note';
      note.textContent = f.note;

      b.append(name, sample, note);
      b.addEventListener('click', () => {
        currentFont = applyFont(f.id);
        writeFont(f.id);
        for (const other of body.children) {
          const on = other === b;
          other.classList.toggle('is-on', on);
          other.setAttribute('aria-checked', String(on));
        }
      });
      body.appendChild(b);
    }

    openSheet('Font', body, [['Done', 'primary', closeSheet]]);
  }

  /* ---------- new transaction ---------- */

  /* `sign` is '+' or '-'. Pressing a key presets the direction, so the most
     common data-entry error in a money app — logging a spend as income —
     has nowhere to happen. Typing over it still works. */
  function newTransaction(sign) {
    const out = sign === '-';
    const body = document.createElement('div');
    const amount = field('₹', 'f-amount', out ? '-299' : '+500',
      '5 or +5 adds  ·  -5 subtracts  ·  g5 lends  ·  t5 collects  ·  max 9999');
    const reason = field('?', 'f-reason', 'Midnight pizza');
    const person = field('name', 'f-person', 'Ravi');
    person.hidden = true;
    const err = document.createElement('p');
    err.className = 'error';
    err.hidden = true;
    body.append(amount, reason, person, err);

    const amountInput = amount.querySelector('input');

    /* Stop the fifth digit at the keystroke, rather than only refusing it on
       save. Only DIGITS are gated: a stray "." has to reach parseAmount so it
       can say "whole rupees only" — silently swallowing it would turn 10.50
       into 1050 and be off by a factor of a hundred. Letters and a leading
       +/-/g/t pass through untouched and are judged later, as before.

       parseAmount keeps its own ceiling. This one is a courtesy to the thumb;
       that one is the rule, and it still catches a paste, an autofill, or
       anything that sets .value without a keystroke. */
    amountInput.addEventListener('beforeinput', (e) => {
      if (e.inputType && e.inputType.indexOf('delete') === 0) return;
      const typed = e.data != null ? e.data
        : (e.dataTransfer ? e.dataTransfer.getData('text') : '');
      if (!/\d/.test(typed)) return;
      const el = e.target;
      const after = el.value.slice(0, el.selectionStart) + typed + el.value.slice(el.selectionEnd);
      if ((after.match(/\d/g) || []).length > 4) e.preventDefault();
    });
    const reasonInput = reason.querySelector('input');
    const personInput = person.querySelector('input');
    amountInput.value = sign;

    // g/t need someone to attach the debt to, so reveal that field live.
    amountInput.addEventListener('input', () => {
      person.hidden = !/^[gt]/i.test(amountInput.value.trim());
    });

    function submit() {
      const parsed = parseAmount(amountInput.value);
      if (parsed.error) { fail(parsed.error, amountInput); return; }

      const how = reasonInput.value.trim();
      if (!how) { fail('Every transaction needs a reason.', reasonInput); return; }

      let who = null;
      if (parsed.person) {
        who = personInput.value.trim();
        if (!who) { fail('Who was it with?', personInput); return; }
      }

      const before = state.current;
      record(state, new Date(), parsed.op, parsed.amount, how, who);
      save();
      render();
      closeSheet();
      toBottom();
      /* the row is the receipt, and the plate rolls to the new figure */
      flashLast();
      Plate.roll(before);
    }

    function fail(message, focusOn) {
      err.textContent = message;
      err.hidden = false;
      focusOn.focus();
      focusOn.select();
    }

    for (const input of [amountInput, reasonInput, personInput]) {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }

    openSheet(out ? 'Money out' : 'Money in', body, [
      ['Cancel', 'ghost', closeSheet],
      ['Save', 'primary', submit],
    ]);
  }

  /* ---------- people ---------- */

  function showPeople() {
    const names = Object.keys(state.people);
    let body;

    if (!names.length) {
      body = document.createElement('p');
      body.className = 'hint';
      body.textContent = 'Nobody owes you, and you owe nobody.';
    } else {
      body = document.createElement('table');
      body.className = 'mini';
      body.innerHTML =
        '<thead><tr><th>Name</th><th class="num">₹</th><th>?</th><th>Date</th></tr></thead>';
      const tbody = document.createElement('tbody');
      for (const name of names) {
        const [owed, why, when] = state.people[name];
        const tr = document.createElement('tr');
        // The stored sign is only present on a person's first entry,
        // so normalise through Number rather than reusing the string.
        const net = Number(owed);
        const amountCell = document.createElement('td');
        amountCell.className = 'num' + (net < 0 ? ' is-out' : '');
        amountCell.textContent = (net > 0 ? '+' : '') + net;
        const nameCell = document.createElement('td');
        nameCell.textContent = name;
        const whyCell = document.createElement('td');
        whyCell.textContent = why;
        const whenCell = document.createElement('td');
        whenCell.textContent = when;
        tr.append(nameCell, amountCell, whyCell, whenCell);
        tbody.appendChild(tr);
      }
      body.appendChild(tbody);

      const legend = document.createElement('p');
      legend.className = 'hint';
      legend.textContent = '− they owe you  ·  + you owe them';
      const wrap = document.createElement('div');
      wrap.append(body, legend);
      body = wrap;
    }

    openSheet('People', body, [['Done', 'primary', closeSheet]]);
  }

  /* ---------- export ---------- */

  // The PrettyTable layout the terminal app writes out.
  function asciiTable(headers, rows) {
    const widths = headers.map((h, i) =>
      Math.max(String(h).length, ...rows.map((r) => String(r[i]).length)));
    const rule = '+' + widths.map((w) => '-'.repeat(w + 2)).join('+') + '+';
    const line = (cells) =>
      '| ' + cells.map((c, i) => String(c).padEnd(widths[i])).join(' | ') + ' |';
    return [rule, line(headers), rule, ...rows.map(line), rule].join('\n');
  }

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportHistory() {
    const rows = [];
    for (const [key, txns] of Object.entries(state.history)) {
      rows.push([key, '', '', '']);
      for (const [reason, [balance, flow]] of Object.entries(txns)) {
        rows.push(['', flow, String(balance), reason]);
      }
    }
    const history = asciiTable(['Date', 'Flow', 'Bal', 'Reason'], rows);

    const owed = Object.entries(state.people)
      .map(([name, [amount, why, when]]) => [name, amount, why, when]);
    const people = asciiTable(['Name', '₹', '?', 'Date'], owed);

    const body = document.createElement('pre');
    body.className = 'pre';
    body.textContent = history + (owed.length ? '\n\n' + people : '');

    openSheet('Export', body, [
      ['Close', 'ghost', closeSheet],
      ['Download', 'primary', () => {
        download('Money_history.txt', history);
        if (owed.length) setTimeout(() => download('Owe_history.txt', people), 400);
        closeSheet();
        Plate.say('Exported');
      }],
    ]);
  }

  /* ---------- name, help, clear ---------- */

  function setName() {
    const body = document.createElement('div');
    const name = field('Name', 'f-name', 'Shahir');
    body.appendChild(name);
    const input = name.querySelector('input');
    input.value = state.name;

    function submit() {
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      state.name = value[0].toUpperCase() + value.slice(1);
      save();
      closeSheet();
      Plate.greet();
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

    openSheet('Your name', body, [
      ['Cancel', 'ghost', closeSheet],
      ['Save', 'primary', submit],
    ]);
  }

  function showHelp() {
    const body = document.createElement('pre');
    body.className = 'pre';
    body.textContent =
`${state.name ? `Welcome back ${state.name}!\n\n` : ''}A money manager. Every transaction becomes a
row: when it happened, why, how much moved, and
the balance it left behind.

Buttons
  −   money out  (the sign is already set)
  +   money in
  Tap the balance for everything else.

Amount field
  5    add 5 to the balance
  +5   the same thing
  -5   take 5 off the balance
  g5   give 5 to someone (they owe you)
  t5   take 5 back from someone

  Whole rupees only. No decimals.

Reason field
  Why the money moved. Required. Repeat a reason
  on one day and it is kept apart as reason(1).

You
  People      who owes what, and to whom
  Undo last   rewind the newest transaction
  Export      the tables as text files
  Your name   who the greeting is for
  Font        pick the typeface the ledger uses`;

    openSheet('Help', body, [['Done', 'primary', closeSheet]]);
  }

  /* ---------- You ----------

     Tapping the plate opens this. A single tap, not a double — a custom
     double-tap is how VoiceOver and TalkBack activate things, so it would
     put every one of these controls out of reach. It also means the plate
     stays clean: no icon has to sit on the balance. */

  function showYou() {
    const body = document.createElement('div');

    const bal = document.createElement('p');
    bal.className = 'you-bal' + (state.current < 0 ? ' is-negative' : '');
    bal.textContent = rupees(state.current);
    body.appendChild(bal);

    const list = document.createElement('div');
    list.className = 'you-list';
    for (const [label, run] of [
      ['People', showPeople],
      ['Undo last', undoLast],
      ['Export', exportHistory],
      ['Your name', setName],
      ['Font', chooseFont],
      ['Help', showHelp],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'menu-item';
      b.textContent = label;
      b.addEventListener('click', run);
      list.appendChild(b);
    }
    body.appendChild(list);

    openSheet(state.name || 'You', body, [['Done', 'primary', closeSheet]]);
  }

  function undoLast() {
    if (!Object.keys(state.history).length) { closeSheet(); Plate.say('Nothing to undo'); return; }
    closeSheet();
    const before = state.current;
    /* animate the row away first, then rebuild — the collapse IS the
       confirmation, so nothing has to be announced */
    collapseLast(() => {
      undo();
      save();
      render();
      toBottom();
      Plate.roll(before);
    });
  }

  /* ---------- bottom bar ---------- */

  const btnIn = document.getElementById('btnIn');
  const btnOut = document.getElementById('btnOut');

  const behavior = reduced ? 'auto' : 'smooth';

  function toBottom(how) {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: how || behavior });
  }

  btnOut.addEventListener('click', () => newTransaction('-'));
  btnIn.addEventListener('click', () => newTransaction('+'));
  /* ---------- the plate answers two gestures ----------

     A tap pokes the cat; a press and hold opens You. They cannot share one
     gesture and they cannot share the plate by area either — the cat covers
     about a third of it, and a control whose outcome depends on which third of
     it you hit is not a control.

     The MASCOT owns the hold's timeline and calls back when he has covered the
     plate; this file does not run a timer of its own. Two timers that have to
     agree eventually will not, and the failure is the sheet opening over a cat
     that is still halfway grown.

     Let go during his opening wait and it was a tap. Let go once he has started
     growing and it was a hold you changed your mind about — he eases home and
     nothing else happens. press(false) reports which it was.

     The click handler is not dead: a button activated from the keyboard fires a
     click with detail 0 and no pointer events at all, so that is the only way
     Enter and Space still reach You. */

  let holding = false;

  plateEl.addEventListener('pointerdown', () => {
    holding = true;
    if (window.Mascot) window.Mascot.press(true, () => { holding = false; showYou(); });
  });

  function release() {
    if (!holding) return;
    holding = false;
    const wasGrowing = window.Mascot && window.Mascot.press(false);
    if (!wasGrowing && window.Mascot) window.Mascot.poke();
  }
  plateEl.addEventListener('pointerup', release);
  plateEl.addEventListener('pointerleave', release);
  plateEl.addEventListener('pointercancel', release);

  /* a long press on a touch screen otherwise raises the selection callout */
  plateEl.addEventListener('contextmenu', (e) => e.preventDefault());

  plateEl.addEventListener('click', (e) => { if (e.detail === 0) showYou(); });

  /* Anywhere else in the app counts as being here: pressing a key, opening a
     sheet, scrolling the ledger. He only nods off when nothing at all is
     happening, which is the whole point of the behaviour. The plate is excluded
     because its own tap goes through poke(), and a silent wake first would rob
     him of the spring. */
  document.addEventListener('pointerdown', (e) => {
    if (window.Mascot && !plateEl.contains(e.target)) window.Mascot.wake();
  }, { passive: true });
  scroller.addEventListener('scroll', () => {
    if (window.Mascot) window.Mascot.wake();
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) closeSheet();
  });

  /* ---------- first paint ---------- */

  render();
  Plate.greet();
  requestAnimationFrame(() => toBottom('auto'));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => toBottom('auto'));
  }
})();
