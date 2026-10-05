/* ============================================================
   Money Manager — web port of the terminal app.

   Same data model as the Python version's shelve db:

     { name, current, history: { "15_Mar_25": { reason: [balanceAfter, "+100"] } },
       people: { name: [owed, reason, date] } }

   Same command grammar in the amount field: 5, +5, -5. Whole rupees
   only, and no letters: the terminal's g5 and t5 are a HELD key here.
   Same reason de-duplication, same
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
  /* A true minus sign, not a hyphen: it is the same width as the + it sits
     under in the column, which a hyphen is not.

     In colour-only mode there is no mark at all — the colour is carrying
     the direction, and a sign beside it would be the very thing that
     setting exists to remove. */
  const flowText = (flow) => {
    const out = flow[0] === '-';
    const mark =
      state.flow === 'colour' ? ''
      : state.flow === 'minus' ? (out ? '\u2212' : '')
      : (out ? '\u2212' : '+');
    return mark + '₹' + group(Number(flow.slice(1)));
  };

  /* ---------- state ---------- */

  let state = load();

  const FLOWS = ['both', 'colour', 'sign', 'minus'];

  function blank() {
    return { name: '', current: 0, history: {}, people: {}, flow: 'both' };
  }

  function load() {
    let s;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) s = Object.assign(blank(), JSON.parse(raw));
    } catch (_) { /* blocked storage — run in memory */ }
    s = s || blank();

    /* A ledger saved before this setting existed carries no flow, and one
       saved by a future version could carry anything. Both land on 'both'.
       Validated HERE rather than against FLOWS, because load() is called
       before that declaration is initialised. */
    if (['both', 'colour', 'sign', 'minus'].indexOf(s.flow) < 0) s.flow = 'both';
    return s;
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (_) { /* nothing to do — the UI keeps working */ }
  }

  /* No fiction here, and none loaded by the app: with nothing stored, a new
     install opens on the empty state rather than on somebody else's chai.

     The generator lives in assets/lab/seed.js and is a bench tool now. It
     writes the same key this reads, so opening a lab page that loads it
     leaves three years here too. */

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

  /* v2.1: a transaction that involved a person keeps the NAME as a fourth
     slot — [balanceAfter, flow, "HH:MM", who]. It is appended rather than
     folded into the reason because the reason is the day's KEY: put `Ravi`
     in there and renaming the row would rename the person, and two rows for
     the same person on one day would collide into `Ravi · Tea(1)`.

     A row saved before this has three slots and reads back as a row with no
     name, which is exactly what it is. Nothing migrates. */
  function record(db, when, op, amount, how, person) {
    db.current += (op === '+' ? Number(amount) : -Number(amount));
    const key = dateKey(when);
    if (!db.history[key]) db.history[key] = {};
    const txn = [db.current, `${op}${amount}`, clock(when)];
    if (person) txn.push(person);
    db.history[key][uniqueReason(db.history[key], how)] = txn;
    if (person) updatePerson(db, person, op, amount, how, key);
  }

  /* ---------- rewriting the ledger ----------

     Every transaction stores the balance it LEFT BEHIND, so changing one of
     them changes the figure on every row under it. Rather than patch a delta
     down the column, the whole ledger is simply run again from the balance it
     opened on — one pass, no drift, and the same answer whatever was edited.

     The opening balance is not stored anywhere, because it never had to be:
     it is the first row's balance minus the first row's flow. Read it BEFORE
     touching anything, since the row that supplies it may be the row going. */

  function opening() {
    for (const day of Object.values(state.history))
      for (const t of Object.values(day)) return t[0] - Number(t[1]);
    return 0;
  }

  function rebalance(start) {
    let run = start;
    for (const day of Object.values(state.history))
      for (const t of Object.values(day)) { run += Number(t[1]); t[0] = run; }
    state.current = run;
  }

  /* A reason is a KEY in the day's object, and object keys carry the ledger's
     order — so renaming one, or putting a deleted one back, means rebuilding
     the day around the slot rather than assigning into it. */
  function insertAt(obj, at, key, value) {
    const keys = Object.keys(obj);
    if (at < 0 || at > keys.length) at = keys.length;
    const out = {};
    keys.slice(0, at).forEach((k) => { out[k] = obj[k]; });
    out[key] = value;
    keys.slice(at).forEach((k) => { out[k] = obj[k]; });
    return out;
  }

  function renameTxn(key, from, to) {
    const day = state.history[key];
    if (!day || from === to) return from;
    const at = Object.keys(day).indexOf(from);
    const rest = {};
    for (const k of Object.keys(day)) if (k !== from) rest[k] = day[k];
    const name = uniqueReason(rest, to);
    state.history[key] = insertAt(rest, at, name, day[from]);
    return name;
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

  // 5 / +5 / -5 add or subtract. Nothing else: a person entry is a held key.
  /* One entry tops out at five digits. Every route in — typed, lent, collected —
     goes through here, so this is the only place the ceiling has to exist.
     It is checked on the VALUE, not the digit count: 000099999 is five digits
     wearing a hat.

     Five, not four, because rent and fees are five-figure and splitting them
     into two rows is a worse lie than one big number. The columns already
     hold it: the flow track takes nine characters at full size and −₹99,999
     is eight, and the balance has stepped down past a lakh since it was
     measured. */
  const MAX_ENTRY = 99999;

  function parseAmount(raw) {
    const x = raw.trim();
    if (x === '') return { error: "Type an amount, for example +5" };

    let op = '+', digits = x;

    if (!/^\d+$/.test(x)) {
      const head = x[0];
      digits = x.slice(1);
      if (!/^\d+$/.test(digits)) {
        return { error: /[.,]/.test(digits) ? 'Whole rupees only — no decimals.' : 'INVALID!' };
      }
      if (head === '+') { op = '+'; }
      else if (head === '-') { op = '-'; }
      else return { error: 'INVALID!' };
    }

    if (Number(digits) > MAX_ENTRY) {
      return { error: `One entry tops out at ${rupees(MAX_ENTRY)}. Split it.` };
    }
    return { op, amount: digits };
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
  function buildRow(date, isFirst, isToday, flow, balance, reason, at, who) {
    /* Whose money it was, then what it was for. The name leads because that is
       what you are looking for when you scan a ledger for a person — the
       reason is how you tell two of their rows apart, not how you find them. */
    const label = who ? who + ' \u00b7 ' + reason : reason;
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('role', 'row');
    if ([0, 6].includes(date.getDay())) row.classList.add('is-weekend');
    if (isToday) row.classList.add('is-today');
    row.setAttribute('aria-label',
      `${date.getDate()} ${MONTHS[date.getMonth()]}${at ? ' ' + at : ''}, ` +
      `${flowText(flow)}, balance ${rupees(balance)}, ${label}`);

    /* stamped for months.js: the month band, the day pill and their totals
       are all derived from these three, so it never has to see the state */
    row.dataset.mm = String(date.getMonth() + 1).padStart(2, '0') + '/' +
                     String(date.getFullYear() % 100);
    row.dataset.day = date.getDate() + ' ' + MONTHS[date.getMonth()].toUpperCase();
    row.dataset.flow = String(Number(flow) || 0);

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
    flowCell.classList.add(flow[0] === '-' ? 'is-out' : 'is-in');

    row.append(when, cell('c-reason', label), flowCell, cell('c-bal', plain(balance)));
    return row;
  }

  function applyFlow() {
    for (const m of FLOWS) document.body.classList.toggle('flow-' + m, state.flow === m);
  }

  /* ---------- appending the one row that changed ----------

     render() empties the card and builds every row again. That is the right
     answer when the ledger RESHUFFLES — an edit, a delete, a rebalance — and
     the wrong one for the thing you do forty times a day, because a commit
     changes exactly one row and rebuilding 3,600 to show it cost 252ms.

     A commit can always append: C.when is now, history is in chronological
     insertion order, and record() puts the new transaction last in the last
     day. Edits do not come through here. The guard below says so out loud
     and falls back to a full render if it is ever not true. */
  function appendOne(key, reason) {
    const day = state.history[key];
    if (!day || !card || card.hidden) return false;

    /* The draft row used to be swept away by the rebuild. Nothing rebuilds
       now, so it has to be shown the door — or the entry lands twice, once
       as the ghost you were typing and once as the row you committed. */
    if (draftRow && draftRow.parentNode) draftRow.remove();
    draftRow = null;

    /* is it really the last transaction of the last day? */
    const keys = Object.keys(state.history);
    if (keys[keys.length - 1] !== key) return false;
    const reasons = Object.keys(day);
    if (reasons[reasons.length - 1] !== reason) return false;

    const [balance, flow, at, who] = day[reason];
    const date = parseKey(key);
    const isFirst = reasons.length === 1;
    const row = buildRow(date, isFirst, isFirst && key === dateKey(new Date()),
                         flow, balance, reason, at, who);
    row.dataset.k = key;
    row.dataset.r = reason;
    card.appendChild(row);
    /* the bands keep their own running totals, so they are told rather than
       recounted — the whole point of not rebuilding */
    if (window.Months && window.Months.add) window.Months.add(row);
    return true;
  }

  function render() {
    applyFlow();
    /* the card is about to be replaced, so any hold still crossing a row on
       it is holding a node that will not exist when it lands */
    disarmRow();
    const today = dateKey(new Date());
    card.textContent = '';
    let rows = 0;

    for (const [key, txns] of Object.entries(state.history)) {
      const date = parseKey(key);
      let first = true;
      for (const [reason, [balance, flow, at, who]] of Object.entries(txns)) {
        const row = buildRow(date, first, first && key === today,
                             flow, balance, reason, at, who);
        /* what the hold gesture reads back to find the transaction again */
        row.dataset.k = key;
        row.dataset.r = reason;
        /* the row being edited wears the draft skin it would wear if it were
           being entered — same surface, same rules, nothing new to learn */
        if (C.edit && C.edit.key === key && C.edit.reason === reason) {
          row.classList.add('is-draft');
          if (flow[0] !== '-') row.classList.add('is-up');
          editRow = row;
        }
        card.appendChild(row);
        first = false;
        rows++;
      }
    }

    blankNote.hidden = rows > 0;
    card.hidden = rows === 0;
    if (C.edit) paintEdit();
    /* the card was just rebuilt from scratch, so the month bands go back on
       it and the folds are re-applied */
    if (window.Months) window.Months.sync();
    /* ...but not while the plate is a field, or is mid-commit holding the
       old balance for the roll to leave */
    if (C.beat === 0 && !C.busy) Plate.rest();
  }

  /* ---------- the row is the receipt ----------

     No toast: a new transaction tints its own row, an undone one collapses
     away. Nothing is covered, and the confirmation is the actual data. */

  function flashLast() {
    const row = card.lastElementChild;
    if (!row) return;
    row.classList.remove('is-new', 'is-up');
    void row.offsetWidth;
    /* the flash takes the direction from the row it is flashing, so nothing
       has to be passed in and an undo cannot disagree with it */
    if (row.querySelector('.c-flow.is-in')) row.classList.add('is-up');
    row.classList.add('is-new');
  }

  /* ...and a row that was rewritten flashes where it stands, which is not
     necessarily the end of the ledger. */
  function flashRow(key, reason) {
    const row = findRow(key, reason);
    if (!row) return;
    row.classList.remove('is-new', 'is-up');
    void row.offsetWidth;
    if (row.querySelector('.c-flow.is-in')) row.classList.add('is-up');
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
  const sheetEl = overlay.querySelector('.sheet');
  const sheetTitle = document.getElementById('sheetTitle');
  const sheetBody = document.getElementById('sheetBody');
  const sheetActions = document.getElementById('sheetActions');
  let lastFocus = null;

  /* `cls` is for the one body that needs the sheet shaped around it rather
     than the other way round — People goes edge to edge, so it takes the
     side gutter back and pays it in itself. */
  function openSheet(title, body, actions, cls) {
    lastFocus = document.activeElement;
    sheetEl.className = 'sheet' + (cls ? ' ' + cls : '');
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

    /* Android's autofill — Google Password Manager is usually the provider —
       decides what a field is from its name, id, placeholder and label, and
       autocomplete="off" on its own is a hint it is well known for overruling.
       There was no name attribute here at all, so the id and the visible label
       were all it had to go on, and a field labelled "name" is precisely what
       it takes for a username. A neutral name takes that signal away. It is
       never sent anywhere — none of these inputs live in a form, and nothing
       here submits. */
    i.name = 'nf-' + id;
    i.setAttribute('autocorrect', 'off');
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
    for (const old of plateEl.querySelectorAll('.pl-layer:not(.out)')) {
      if (reduced) { old.remove(); continue; }
      /* The plate is usually changing WIDTH at this exact moment — a key
         collapses into the go key as an entry opens — and a layer pinned to
         inset:0 keeps re-centring its own text for every frame of that resize.
         The figure that is on its way out has no business moving at all, so
         its box is frozen at the size it is leaving from. */
      const box = old.offsetWidth;
      if (box) { old.style.width = box + 'px'; old.style.right = 'auto'; }
      old.classList.add('out');
      setTimeout(() => old.remove(), 420);
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

    /* A static figure of a given value, with no roll in it. The plate carries
       the OLD balance home while the bar travels, so the roll that plays on
       arrival has a "from" to leave. */
    hold(value) {
      clearTimeout(plateSeq);
      plateSwap(figure(value));
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
  ];
  /* Four, not six. `Source Code Pro` sat between Plex and JetBrains without
     being either, and `System mono` is a different face on every device —
     an option whose own preview cannot promise what it will look like.

     Six faces is a decision; four is a glance. An id saved by an older
     version falls through `fontById` to Plex and nothing breaks. */

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

  /* ---------- compose ----------

     Entry used to open a sheet. It no longer does: the plate stops being a
     balance and becomes the field, and the two keys become the direction
     you already chose plus the one way forward.

         −  →  ₹ 620  →  [Food]  →  ✓

     Two beats, one surface, nothing covered. `sign` is '+' or '-' and is set
     by the key you pressed, so the most common data-entry error in a money
     app — logging a spend as income — still has nowhere to happen.

     The sheet is not gone. People, Export, Font, Help and You still use it;
     it just stops being the thing you touch forty times a day. */

  const chiprow = document.getElementById('chiprow');
  const chipscroll = document.getElementById('chipscroll');
  const composeInput = document.getElementById('composeInput');
  const plateWrap = document.getElementById('plateWrap');
  const flipBtn = document.getElementById('flipSign');

  /* Categories, not past reasons: a fixed vocabulary keeps every chip in the
     same slot forever, and a chip that never moves stops having to be read.
     `Entertainment` is thirteen characters — about 153 reference px — and
     blows the row on its own, so it ships as `Fun`. */
  /* ---------- the four person moves ----------

     Not four features — two questions, and the bar already asks the first
     one. `owes` is whose money ends up where (−1 they owe you, +1 you owe
     them) and decides which key holds it; `cash` is whether any actually
     moved, and decides whether the ledger ever hears about it.

              hold − (they owe you)          hold + (you owe them)
     moved    I gave someone        −₹row    Someone gave me      +₹row
     did not  Someone has my money  no row   Someone paid for me  no row

     `someone` on the button, never `they`: `they` is the plural and the
     singular-of-unknown-gender at once and is bad at both, and it is the one
     word the sentence below already stands a missing name in with. The two
     buttons under one key open on different words (`I` vs `Someone`) so the
     eye can tell the cash move from the promise without reading both.

     A promise is settled by its opposite, so there is no fifth move: claim
     ₹5,000 then take ₹5,000 and the person nets to zero and leaves People. */
  const MOVES = {
    give:  { label: 'I gave someone',       arrow: 'up',   owes: -1, cash: -1 },
    claim: { label: 'Someone has my money', arrow: 'up',   owes: -1, cash:  0 },
    take:  { label: 'Someone gave me',      arrow: 'down', owes:  1, cash:  1 },
    owe:   { label: 'Someone paid for me',  arrow: 'down', owes:  1, cash:  0 },
  };
  const MOVES_BY_KEY = { '-': ['give', 'claim'], '+': ['take', 'owe'] };

  /* One sentence each, all four built the same way: the person who DID it
     first, the figure in the middle, `for <reason>` at the end. `a` `w` `r`
     arrive as finished fragments, so the template decides only the words. */
  const SAY = {
    give:  (a, w, r) => ['you gave ', w, ' ', a, ' for ', r],
    claim: (a, w, r) => [w, ' keeps your ', a, ' for ', r],
    take:  (a, w, r) => [w, ' gave you ', a, ' for ', r],
    owe:   (a, w, r) => [w, ' paid ', a, ' for your ', r],
  };

  const CHIPS_OUT = ['Food', 'Travel', 'Groceries', 'Bills', 'Shopping',
                     'Health', 'Fun', 'Rent', 'Gifts', 'Other'];
  /* Money comes in fewer ways than it goes out, so the + list is shorter —
     but it is not a smaller version of the − list, it is ranked by what
     actually credits an account: `Work` for the freelance, gig and tip money
     `Salary` never covered, `Family` for the second-biggest credit most
     people have. `Refund` and `Sold` left: a refund is a spend reversed and
     belongs against the reason it came back from, and a thing you sell twice
     a year does not earn a sixth of the row.

     Six is the CEILING here, not a preference. The row is 618u — 643 less
     12.5u each side — a chip is 10.8u a character plus 36u of chrome, and
     the gap is 8u: these six spend 612u. A seventh cannot fit, because the
     shortest chip there could be still costs 76u with its gap. */
  const CHIPS_IN  = ['Salary', 'Work', 'Family', 'Gift', 'Cashback', 'Other'];
  const CHIP_H = 60;          /* 48 chip + the 12 that separates it from the bar */

  /* ---------- the shelf of things you have already typed ----------

     Beat 1 asks for an amount and the strip above the bar is EMPTY while it
     does: the categories only arrive on the reason beat after it. That is the
     most valuable 48u in the app, unused at exactly the moment the most
     predictable entry of the day is being made — the same chai, the same bus,
     the same figure, forty times a month.

     So beat 1 offers what the ledger has already seen. A chip here answers BOTH
     beats at once, because the figure and the reason are one object, so it does
     not fill the field and wait like a category does: it writes the row.

     The unit is a REASON AND A FIGURE TOGETHER. `Tea ₹12` and `Tea ₹20` are two
     habits and only one of them is the morning one; a chip that averaged them
     would put a number on the row that was never typed, which is the one thing
     a shortcut may never do.

     Four numbers, each stopping a different failure:

       WINDOW  how far back a sighting counts at all. Longer, and last winter's
               office canteen is still on the shelf; shorter, and a weekly habit
               never gets counted twice.
       TIMES   the threshold — and it only means anything beside the window. A
               DAILY habit passes any number inside a week, so this is really the
               rule for WEEKLY things, and 4 is one month of them.
       STALE   how long since the last one before the slot is taken back. A daily
               chai you stopped drinking is not a habit, it is a memory, and it
               is holding the shelf against whatever replaced it.
       SLOTS   how many at once. One glance and one tap; past three you are
               reading a list instead of recognising a shape. */
  const AGAIN = { window: 45, times: 4, stale: 14, slots: 3 };

  /* The rail the chips have to fit inside: 643 less the bar's 12.5u each side.
     A chip is 10.8u a character at 18u mono plus 36u of chrome, and 8u of gap
     stands between two of them — so the shelf can say whether it overflows
     without waiting to be laid out and measured. */
  const RAIL = 618, CHIP_GAP = 8;
  const chipRoom = (label, figure) => (label.length + figure.length) * 10.8 + 36 + CHIP_GAP;

  function recurring(sign) {
    const today = new Date();
    const midnight = (back) =>
      new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const oldest = midnight(AGAIN.window);
    const freshest = midnight(AGAIN.stale);

    const keys = Object.keys(state.history);
    const pairs = new Map();

    /* Newest day first, and STOP at the window: history is in chronological
       insertion order — appendOne already relies on that — so three years of
       ledger costs the last 45 days of it and nothing more. */
    for (let i = keys.length - 1; i >= 0; i--) {
      const day = parseKey(keys[i]);
      if (day < oldest) break;
      const txns = state.history[keys[i]];
      const reasons = Object.keys(txns);
      for (let j = reasons.length - 1; j >= 0; j--) {
        const flow = txns[reasons[j]][1];
        if ((flow[0] === '-' ? '-' : '+') !== sign) continue;
        /* Two entries on one date cannot share a key, so the second chai of the
           day is stored as `Tea(1)`. Strip that or a daily habit splits into
           five separate ones and none of them ever reaches the threshold. */
        const why = reasons[j].replace(/\(\d+\)$/, '').trim();
        const amount = Math.abs(Number(flow));
        if (!why || !amount) continue;
        const k = why.toLowerCase() + '|' + amount;
        const seen = pairs.get(k);
        /* walking backwards means the first sighting IS the most recent one, so
           `at` needs no comparing and the newest spelling wins by arriving first */
        if (seen) seen.n++;
        else pairs.set(k, { why, amount, n: 1, at: day });
      }
    }

    const earned = [];
    for (const e of pairs.values()) if (e.n >= AGAIN.times && e.at >= freshest) earned.push(e);
    earned.sort((a, b) => b.n - a.n || b.at - a.at);

    const shelf = [];
    let used = 0;
    for (const e of earned) {
      if (shelf.length >= AGAIN.slots) break;
      const w = chipRoom(e.why, figureOf(sign, e.amount));
      if (used + w > RAIL + CHIP_GAP) continue;   /* a chip half off the rail is not a chip */
      used += w;
      shelf.push(e);
    }

    /* Nothing earned a slot, so nothing is offered. A shelf that falls back to
       the last thing you typed is guessing, and a guess here writes a row on ONE
       tap — so an unearned shelf simply does not appear, and beat 1 is exactly
       what it was before any of this existed. */
    return shelf;
  }

  const figureOf = (sign, amount) => (sign === '-' ? '−' : '+') + '₹' + group(amount);

  function buildRecur(sign) {
    const shelf = recurring(sign);
    chipscroll.textContent = '';
    chipscroll.classList.remove('is-moves');
    for (const e of shelf) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip is-recur';
      const fig = document.createElement('span');
      fig.className = 'chip-net ' + (sign === '-' ? 'is-mine' : 'is-theirs');
      fig.textContent = figureOf(sign, e.amount);
      b.append(document.createTextNode(e.why), fig);
      b.addEventListener('click', () => pickRecur(e, b));
      chipscroll.appendChild(b);
    }
    chipscroll.scrollLeft = 0;
    return shelf.length > 0;
  }
  const isChip = (s) => CHIPS_OUT.indexOf(s) >= 0 || CHIPS_IN.indexOf(s) >= 0;

  /* beat 0 at rest · 1 amount · 2 reason · 3 who (g/t only)
     `edit` is the transaction being rewritten, or null for a new one. The
     beats are the same either way — that is the whole point of holding a row:
     you land in the flow you already use forty times a day. */
  const C = { beat: 0, sign: '-', raw: '', why: '', who: '', busy: false,
              when: null, edit: null, kind: null, seq: null };

  /* ---------- the order the beats are asked in ----------

     1 amount · 2 reason · 3 who. Those numbers are the ROLES and they do not
     move; what moves is the walk between them.

     The sentence has always read who · amount · reason —

         you gave Ravi ₹500 for chai

     — so when the person is known before a key is pressed, which is exactly
     the case when you held − and picked a move, that is the order it asks
     in, and the blanks fill left to right instead of the name landing last
     and sitting first.

     There are two walks and no third. The typed `g5` and `t5` are gone: they
     were a second door into the same room and the worse one, because a typed
     shortcut only admits to being a person entry once the amount parses — too
     late to ask the name first — while a held key knows the direction before
     a character is typed. One way in, and it is the one that asks in the
     order the sentence reads. */
  const SEQ_PLAIN  = [1, 2];
  const SEQ_MOVE   = [3, 1, 2];
  C.seq = SEQ_PLAIN;
  const stepOf = () => C.seq.indexOf(C.beat);

  /* The key you pressed supplies the sign, and nothing typed can argue with
     it any more: the field takes digits and only digits. */
  const expr = () => C.sign + C.raw;

  /* ---------- the app follows the visible area ----------

     The keyboard does not resize the LAYOUT viewport on every browser, and
     `.app` is fixed to that — so its floor, and the bar standing on it, could
     end up underneath the keyboard. But handing the app the whole visual
     viewport to fix that made it follow everything ELSE that moves the visual
     viewport too, and on Chrome the loudest of those is the URL bar: it rides
     out and back on every flick of the ledger, and the bar wobbled after it.

     So the app is sized off `100%` — which for a fixed element already IS the
     visible area, kept in step by the browser itself, with no event to wait
     for and nothing to lag behind — and the script contributes exactly one
     number: the keyboard.

     Which is measured as the disagreement between the layout viewport and the
     visual one, because that is the only thing that can open a gap this wide.
     It reads 0 where the browser already shrinks the layout viewport for the
     keyboard (Chrome, via interactive-widget) and the keyboard's real height
     where it does not (Safari) — correct both times, without asking which
     browser this is. */
  const vv = window.visualViewport;
  const appEl = document.querySelector('.app');

  /* A URL bar is about 60px and a keyboard is never under 200, so the line
     between "browser chrome moved" and "a keyboard opened" sits between. */
  const KB_MIN = 120;
  let kbPx = 0, topPx = 0, rideOff;

  function lift() {
    if (!vv) return;
    /* Pinch-zoom shrinks the visual viewport too, and resizing the app to a
       zoomed view would fight the zoom instead of helping it. */
    const gap = vv.scale > 1.01 ? 0 : window.innerHeight - vv.height;
    const kb = gap > KB_MIN ? Math.round(gap) : 0;
    /* Safari scrolls the page under a raised keyboard; the app rides with it.
       Off the keyboard, offsetTop is the URL bar's business, not ours. */
    const top = kb ? Math.round(vv.offsetTop) : 0;
    if (kb === kbPx && top === topPx) return;
    kbPx = kb;
    topPx = top;
    document.body.style.setProperty('--kb', kb + 'px');
    document.body.style.setProperty('--vtop', top + 'px');
    ride();
  }

  /* The ease, armed for the length of one ride and then taken away again, so
     the only height change that ever animates is the one a keyboard caused.

     Both ends of the keyboard arm it, because only one of them is visible from
     here: where the browser shrinks the LAYOUT viewport for the keyboard, the
     app changes height without --kb moving a pixel and lift() never runs. So
     the field arms it as well — opening and closing the field IS the keyboard
     coming and going, whichever viewport the browser chooses to spend it on. */
  function ride() {
    appEl.classList.add('is-riding');
    clearTimeout(rideOff);
    rideOff = setTimeout(() => appEl.classList.remove('is-riding'), 500);
  }

  if (vv) {
    vv.addEventListener('resize', lift);
    vv.addEventListener('scroll', lift);
    lift();
  }

  /* ---------- the shelf above the bar ----------

     It used to hold one thing at a time — the strip OR the sentence — so
     either could simply claim the slot. In who · amount · reason the
     sentence is up from the first beat and the strip is up for two of the
     three, so they stack: the strip keeps the slot, the sentence rides
     above it, and the ledger is told what the pair costs, not each. */
  let shelfChips = 0, shelfSay = 0;
  function shelf() {
    document.body.style.setProperty('--chips', shelfChips + shelfSay);
    document.body.style.setProperty('--lift', shelfChips ? 54 : 0);
  }
  function setChipsH(px) { shelfChips = px; shelf(); }
  function setSayH(px) { shelfSay = px; shelf(); }

  /* ---------- who gets the caret ----------

     The keyboard is the one the person already has: Gboard on a phone, the
     physical one on a laptop. Nothing here draws keys.

     Focus is what summons it, and `inputmode` says what it comes up as —
     'numeric' for the amount, 'text' for a reason or a name. A laptop ignores
     inputmode entirely and simply types. Every beat raises it, so no beat
     needs asking twice. */

  let refocus = true;
  function focusField() {
    if (composeInput.hidden) return;
    composeInput.focus({ preventScroll: true });
    const n = composeInput.value.length;
    try { composeInput.setSelectionRange(n, n); } catch (_) { /* not a text type */ }
  }

  /* ---------- the chips ---------- */

  /* The two moves that lean the way of the key you held. They land in the
     chip row because that is the shelf above the bar, and the two never want
     it at the same time: pick a move and the categories step aside. */
  function buildMoves(sign) {
    chipscroll.textContent = '';
    chipscroll.classList.add('is-moves');
    for (const id of MOVES_BY_KEY[sign]) {
      const m = MOVES[id];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip is-move ' + (m.owes < 0 ? 'is-mine' : 'is-theirs') +
                    (m.cash === 0 ? ' is-promise' : '');
      b.dataset.move = id;
      b.append(icon(m.arrow), document.createTextNode(m.label));
      b.addEventListener('click', () => startPerson(id));
      chipscroll.appendChild(b);
    }
    chipscroll.scrollLeft = 0;
  }

  /* ---------- who, out of the people you already have ----------

     Asking for the name FIRST is what makes this possible: the row the moves
     were standing in is free, and the answer is nearly always one of three
     names the app is already holding. Each chip carries that person's net,
     so the strip answers the question and reports the standing at once.

     Names only. A dashed `+ new` chip used to close the strip, and all it did
     was clear the field and focus it — which is where the caret already was,
     with the keyboard already up. Returns whether it found anyone, because
     with nobody on the list there is no strip to show. */
  function buildPeople() {
    chipscroll.textContent = '';
    chipscroll.classList.remove('is-moves');
    const names = Object.keys(state.people);
    for (const name of names) {
      const net = Number(state.people[name][0]);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      const owe = document.createElement('span');
      owe.className = 'chip-net ' + (net < 0 ? 'is-mine' : 'is-theirs');
      owe.textContent = (net < 0 ? '−' : '+') + '₹' + group(Math.abs(net));
      b.append(document.createTextNode(name), owe);
      b.addEventListener('click', () => pickWho(name, b));
      chipscroll.appendChild(b);
    }
    chipscroll.scrollLeft = 0;
    return names.length > 0;
  }

  function buildChips() {
    chipscroll.textContent = '';
    chipscroll.classList.remove('is-moves');
    for (const label of (C.sign === '-' ? CHIPS_OUT : CHIPS_IN)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.addEventListener('click', () => pickChip(label, b));
      chipscroll.appendChild(b);
    }
    chipscroll.scrollLeft = 0;
  }


  let chipSeq;
  function showChips(on, fade) {
    clearTimeout(chipSeq);
    setChipsH(on ? CHIP_H : 0);
    if (on) {
      chiprow.hidden = false;
      chiprow.classList.remove('is-out');
      return;
    }
    if (fade && !reduced) {
      chiprow.classList.add('is-out');
      chipSeq = setTimeout(() => {
        chiprow.hidden = true;
        chiprow.classList.remove('is-out');
      }, 240);
      return;
    }
    chiprow.hidden = true;
    chiprow.classList.remove('is-out');
  }

  /* The strip exists for exactly one condition: beat 2, reason still empty,
     keyboard not up. Pick one or reach for the letters and it has done its
     job — 60px back to the ledger and one fewer control on screen. */
  /* The strip belongs to the reason and to nothing else: beat 2, still empty,
     not typing. Beat 1 is an amount — it has no categories, so it gets no
     strip, and the keyboard key has nothing to float on. */
  /* The strip belongs to one condition: beat 2, no reason yet. The keyboard
     is up throughout now, so it is no longer part of the question — the chips
     simply sit above it until one of them, or the keyboard, answers. */
  function syncChips(fade) {
    if (C.beat === 3 && !C.who.trim() && buildPeople()) { showChips(true); return; }
    if (C.beat === 2 && !C.why) { buildChips(); showChips(true); return; }
    /* Beat 1 now has an offer too, but only while the field is untouched and only
       for a plain entry: a person move still owes a name, and an edit is pointed
       at a row that already exists — neither can be answered by one tap. */
    if (C.beat === 1 && !C.raw && !C.kind && !C.edit && buildRecur(C.sign)) {
      showChips(true);
      return;
    }
    showChips(false, fade);
  }

  /* The chosen chip flies into the field. The value lands in the input at
     once — state is never behind the animation — and the clone dissolves
     onto text that is already there. */
  function flyChip(btn) {
    if (reduced || !btn) return;
    const a = btn.getBoundingClientRect();
    const b = plateWrap.getBoundingClientRect();
    const s = chipscroll.getBoundingClientRect();
    if (!a.width || !b.width) return;

    const fly = btn.cloneNode(true);
    fly.className = 'chip is-fly';
    /* the strip scrolls, so a chip can start partly outside it; fly from
       where it is actually visible, and pin the box so nothing re-measures it */
    const x0 = Math.min(Math.max(a.left, s.left), Math.max(s.left, s.right - a.width));
    fly.style.left = x0 + 'px';
    fly.style.top = a.top + 'px';
    fly.style.width = a.width + 'px';
    fly.style.height = a.height + 'px';
    document.body.appendChild(fly);

    const u = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--u')) || 1;
    const tx = b.left + 107 * u - x0;
    const ty = b.top + (b.height - a.height) / 2 - a.top;
    requestAnimationFrame(() => {
      fly.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px)';
      fly.style.opacity = '0';
    });
    setTimeout(() => fly.remove(), 320);
  }

  /* Nearly a category chip, with one difference: it MOVES ON.

     A category is a first guess — tap `Travel` and you may still type `cab`
     after it, so that chip fills the field and waits. A name off the people
     list is not a guess: it is the person, spelled the way the app already
     spells them. Waiting there for a second tap on the key asks you to
     confirm something you have already said. */
  function pickWho(name, btn) {
    if (C.beat !== 3 || C.busy || C.who.trim()) return;
    C.who = name;
    composeInput.value = name;
    flyChip(btn);
    paintSay();
    nextBeat();
  }

  /* A category chip is a first guess and waits for the rest; a recurring chip is
     the WHOLE entry. Both beats are already answered by the one object, so there
     is nothing left to ask and nothing to press: it commits. The row is the
     receipt, and the row is what a tap here produces — got it wrong, and a hold
     on that row still edits or deletes it, same as any other. */
  function pickRecur(e, btn) {
    if (C.beat !== 1 || C.busy || C.raw || C.kind || C.edit) return;
    C.raw = String(e.amount);
    C.why = e.why;
    composeInput.value = C.raw;
    flyChip(btn);
    showChips(false, true);
    commit();
  }

  function pickChip(label, btn) {
    if (C.beat !== 2 || C.busy || C.why) return;
    C.why = label;
    composeInput.value = label;
    flyChip(btn);
    syncChips(true);
    paintKeys();
    /* the sentence is the receipt, so it cannot be a beat behind the field:
       before who-first a person entry never saw these chips, and the tap
       that fills the reason never had to tell it */
    paintSay();
    draft();
  }

  /* ---------- the sentence ----------

     It reads back what you are about to write, and it arrives WHOLE: the
     same words in the same places at every beat, with the slots you have not
     answered standing in as `someone` / `something`, greyed. Nothing appears
     and nothing shifts along — only the three blanks ever change. */

  const sayingEl = document.getElementById('saying');
  const SAY_H = 50;                  /* what it costs the ledger, in ref px */
  let sayHold;

  function paintSay() {
    clearTimeout(sayHold);
    if (!C.kind || !C.beat) {
      sayingEl.classList.add('is-out');
      setSayH(0);
      return;
    }
    const m = MOVES[C.kind];
    const frag = (text, cls) => {
      const el = document.createElement(cls === 'b' ? 'b' : 'span');
      if (cls && cls !== 'b') el.className = cls;
      el.textContent = text;
      return el;
    };
    const amount = C.raw
      ? frag('\u20b9' + group(Number(C.raw)), 'sy-amt ' + (m.owes < 0 ? 'is-mine' : 'is-theirs'))
      : frag('\u20b9\u2014', 'sy-soft');
    const who = C.who.trim() ? frag(C.who.trim(), 'b') : frag('someone', 'sy-soft');
    const why = C.why.trim() ? frag(C.why.trim(), 'b') : frag('something', 'sy-soft');

    sayingEl.textContent = '';
    for (const piece of SAY[C.kind](amount, who, why)) {
      sayingEl.appendChild(typeof piece === 'string' ? document.createTextNode(piece) : piece);
    }
    sayingEl.hidden = false;
    sayingEl.classList.remove('is-out');
    setSayH(SAY_H);
  }

  /* A promise writes no row, so the sentence is the only receipt there can
     be. It stays where it already was for two seconds rather than a new
     surface arriving to say the same thing. */
  function keepSay() {
    clearTimeout(sayHold);
    sayHold = setTimeout(() => {
      sayingEl.classList.add('is-out');
      setSayH(0);
    }, reduced ? 200 : 2000);
  }

  /* ---------- with a person ----------

     Hold the key you would have tapped. It already means the direction, so
     the two moves that lean that way are the only two offered, and the beats
     after that are the ones you already know: amount, why, who. */

  function startPerson(kind) {
    if (C.busy || C.beat !== 0) return;
    const m = MOVES[kind];
    C.kind = kind;
    C.sign = m.owes < 0 ? '-' : '+';
    C.seq = SEQ_MOVE;               /* who, and the strip is already there */
    C.raw = '';
    C.why = '';
    C.who = '';
    C.when = new Date();
    enter(SEQ_MOVE[0]);
    toBottom();
    if (window.Mascot) window.Mascot.wake();
  }

  /* ---------- the field ---------- */

  /* Beat 1 carries a prefix, because the sign is a decision already made and
     has to stay visible. Beats 2 and 3 carry none: a placeholder says what
     the field wants, and gets out of the way the moment you answer it. */
  function fieldLabel(sign) {
    const box = document.createElement('span');
    box.className = 'pl-field';
    if (!sign) return box;
    const m = document.createElement('span');
    m.className = 'pl-sign' + (sign === '-' ? ' is-out' : '');
    m.textContent = sign === '-' ? '\u2212' : '+';
    const cur = document.createElement('span');
    cur.className = 'pl-cur';
    cur.textContent = '\u20b9';
    box.append(m, cur);
    return box;
  }

  /* `focus` only counts as a user gesture inside the handler of one, so every
     call site below is reached synchronously from a click. `mode` is what a
     phone reads, and every beat here wants a keyboard. */
  /* Writing an attribute the IME reads tears the keyboard down and builds it
     again on Android — even when the value written is the one already there.
     Between beats that showed as the keyboard ducking out and coming back, so
     only an actual CHANGE is written. */
  function setAttr(el, name, value) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }

  /* The mark is a switch for exactly one condition: a row being edited, on the
     beat that holds its figure. Every other beat has no sign to change — a
     reason and a name do not point anywhere — and an entry already chose its
     direction with the key that opened it. Offered anywhere else it would be a
     box drawn around a character for no reason. */
  function paintFlip() {
    plateWrap.classList.toggle('can-flip', !!C.edit && C.beat === 1 && !C.busy);
  }

  /* Tapping it rewrites the figure in place: the mark, the row it is rehearsing
     and that row's own skin. Nothing is saved — the tick is still what saves —
     so a wrong tap costs one more tap, the same as a wrong digit. */
  function flipSign() {
    if (C.busy || !C.edit || C.beat !== 1) return;
    C.sign = C.sign === '-' ? '+' : '-';
    const m = plateEl.querySelector('.pl-layer:not(.out) .pl-sign');
    if (m) {
      m.textContent = C.sign === '-' ? '\u2212' : '+';
      m.classList.toggle('is-out', C.sign === '-');
    }
    if (editRow) editRow.classList.toggle('is-up', C.sign === '+');
    paintEdit();
    if (window.Mascot) window.Mascot.wake();
  }

  function openField(sign, value, word, mode, hint) {
    clearTimeout(plateSeq);          /* no parked rest() may steal the field */
    slipHome();                      /* the bar is the field now, so it stands */
    plateSwap(fieldLabel(sign));
    composeInput.hidden = false;
    composeInput.classList.toggle('is-word', !!word);
    setAttr(composeInput, 'enterkeyhint',
            stepOf() === C.seq.length - 1 ? 'done' : 'next');
    composeInput.placeholder = hint || '';
    composeInput.value = value || '';
    setAttr(composeInput, 'inputmode', mode);
    paintFlip();
    ride();
    focusField();
    /* Any other beat puts him back to idle; coming BACK to beat 1 with an
       amount already typed picks the pose straight up again. */
    if (word) catRest(); else catTyped();
  }

  function closeField() {
    ride();
    plateWrap.classList.remove('can-flip');
    refocus = false;
    composeInput.hidden = true;
    composeInput.value = '';
    composeInput.blur();
    refocus = true;
    catRest();
  }

  /* ---------- editing a row that already exists ----------

     Hold a row and you are in the entry flow, pointed at that row instead of
     at a new one: the plate is the field, − is still the way on, and the +
     key — which an entry collapses, because the direction is already chosen —
     becomes the bin. The row itself is the draft, in place, in the ledger.

     Nothing new is drawn and nothing new is learnt. The only thing an edit
     adds is a use for a key that was already empty. */

  let editRow = null;                    /* the row, in the ledger, being edited */
  let editH = 0;                         /* ...and how tall it was when it last parked */

  function findRow(key, reason) {
    for (const row of card.querySelectorAll('.row'))
      if (row.dataset.k === key && row.dataset.r === reason) return row;
    return null;
  }

  /* The two cells you are allowed to change, repainted in place. A full
     render per keystroke would rebuild the whole ledger and re-run the month
     bands with it; this touches four nodes. */
  function paintEdit() {
    if (!C.edit) return;
    if (!editRow || !editRow.parentNode) editRow = findRow(C.edit.key, C.edit.reason);
    if (!editRow) return;
    /* the direction the FIELD is holding, not the one the row was saved with:
       the mark on the plate can change it, and the row is the rehearsal */
    const up = C.sign !== '-';
    const text = flowText((up ? '+' : '-') + (C.raw || '0'));
    const f = editRow.querySelector('.c-flow');
    const r = editRow.querySelector('.c-reason');
    if (f) {
      f.className = 'cell c-flow' + room('c-flow', text) + (up ? ' is-in' : ' is-out') +
                    (C.beat === 1 ? ' is-live' : '');
      if (f.firstChild) f.firstChild.textContent = text;
    }
    if (r) {
      r.className = 'cell c-reason' + (C.beat === 2 ? ' is-live' : '');
      if (r.firstChild) r.firstChild.textContent = C.why;
    }

    reparkIfGrew(editRow);
  }

  /* ---------- the row comes to the plate ----------

     Hold a row and the keyboard takes half the screen. The bar rides up on top
     of it, and the row you are holding is very often under one or the other —
     so the figure being changed is being changed blind.

     Nothing is drawn for that. The row is already on the screen; it is only in
     the wrong place. So the LEDGER moves instead, until the row sits one gap
     above the bar and the screen reads row · plate · keyboard.

     Where it stops is CSS's business, not this function's: scroll-margin-bottom
     on the draft row is the room to leave, and it is the scroller's own foot
     padding, so a row brought to the plate rests exactly where the ledger's
     last row rests. Measuring a gap here instead put the card's bottom edge
     hard against the bar, in a place the app is in no other state.

     The scroller does the rest of the thinking. A ledger too short to bring the
     row down there simply cannot scroll that far, so nothing moves and the row
     stays where it already was, in plain sight. That is the whole of "only when
     the ledger reaches the bottom", and it costs no test of its own. */

  function park() {
    /* an edit holds a row that already exists; a new entry holds the draft
       it is rehearsing. Both are THE row you are working on, and both want
       the same place on the screen, so there is one function for it. */
    const row = editRow || draftRow;
    /* a promise rehearses no row at all — nothing moved, so there is nothing
       to bring up, and the ledger simply keeps its foot in view */
    if (!row || !row.parentNode) { if (!C.edit) toBottom(); return; }
    row.scrollIntoView({ block: 'end', behavior });
    editH = row.offsetHeight;        /* the height this parking was true for */
  }

  /* A row travels between one line and however many the reason needs, and
     is-draft is the one row in the ledger with no fixed height — so a row
     that grew after it parked grew straight back under the bar. Park it again
     on the keystroke that wrapped the line, and only on that one: every other
     keystroke has to leave the ledger exactly where it is.

     editH is 0 until the first park has landed, which keeps this from firing
     against a viewport the keyboard has not finished shrinking yet. */
  function reparkIfGrew(row) {
    if (!editH || !row || row.offsetHeight === editH) return;
    editH = row.offsetHeight;
    park();
  }

  /* ...once the keyboard has finished arriving, and never during it: a scroll
     measured against a viewport that is still shrinking lands short.

     The app carries a height transition ONLY while it is riding a keyboard —
     that is what is-riding exists for — so transitionend on height is the
     keyboard saying it has landed, rather than a URL bar moving the floor.
     Where no ride happens at all (reduced motion, or a field that was already
     open) the timer says the same thing a little later. */
  function afterRide(then) {
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      appEl.removeEventListener('transitionend', on);
      then();
    };
    const on = (e) => { if (e.propertyName === 'height') fire(); };
    appEl.addEventListener('transitionend', on);
    setTimeout(fire, 360);
  }

  function startEdit(key, reason) {
    const day = state.history[key];
    const t = day && day[reason];
    if (!t || C.busy || C.beat !== 0) return;
    clearUndo();
    C.edit = { key, reason, flow: t[1] };
    C.beat = 1;
    C.seq = SEQ_PLAIN;
    C.sign = t[1][0] === '-' ? '-' : '+';
    C.raw = String(Math.abs(Number(t[1])));
    C.why = reason;
    C.who = '';
    C.when = parseKey(key);
    openField(C.sign, C.raw, false, 'numeric', '');
    showChips(false);
    paintKeys();
    /* The row is marked where it stands rather than re-rendered. A rebuilt
       node has no height to grow FROM — it simply appears at its new one —
       and the growing is the whole point: it is what says THIS row is the
       one you are holding. Nothing else on screen changed anyway. */
    editRow = findRow(key, reason);
    editH = 0;                       /* nothing has parked yet, so nothing may re-park */
    if (editRow) {
      editRow.classList.add('is-draft');
      if (C.sign === '+') editRow.classList.add('is-up');
    }
    paintEdit();
    afterRide(park);
    if (window.Mascot) window.Mascot.wake();
  }

  /* ...and the row comes home before the ledger is rebuilt, for the same
     reason in reverse: a render replaces the node, and a replaced node has
     nothing to shrink from. */
  function shutEdit(then) {
    const row = editRow;
    editRow = null;
    if (!row || !row.parentNode || reduced) { then(); return; }
    row.classList.remove('is-draft', 'is-up');
    for (const c of row.querySelectorAll('.cell.is-live')) c.classList.remove('is-live');
    setTimeout(then, 240);
  }

  function saveEdit() {
    const parsed = parseAmount(expr());
    if (parsed.error) { plateWarn(parsed.error); return; }
    const before = state.current;
    const start = opening();
    const { key, reason } = C.edit;
    state.history[key][reason][1] = parsed.op + parsed.amount;
    const name = renameTxn(key, reason, C.why.trim());
    rebalance(start);
    save();

    C.edit = null;
    C.beat = 0;
    closeField();
    showChips(false);
    paintKeys();
    /* land, then roll — the same order a commit uses. the row shrinks home
       first, and the figure moves once it has arrived. */
    shutEdit(() => {
      render();
      flashRow(key, name);
      Plate.roll(before);
    });
  }

  /* Delete keeps the plate for the way back rather than rolling the figure:
     the collapse is the receipt, the balance column has already restated
     itself under it, and the one thing that is NOT recoverable from the
     screen is the row you just took out. */
  function deleteEdit() {
    const { key, reason } = C.edit;
    const day = state.history[key];
    if (!day || !day[reason]) return;
    const snap = {
      key, reason,
      tuple: day[reason].slice(),
      at: Object.keys(day).indexOf(reason),
      dayAt: Object.keys(state.history).indexOf(key),
      start: opening(),
    };
    const row = editRow || findRow(key, reason);

    const done = () => {
      delete state.history[key][reason];
      if (!Object.keys(state.history[key]).length) delete state.history[key];
      rebalance(snap.start);
      save();
      C.edit = null;
      C.beat = 0;
      editRow = null;
      closeField();
      showChips(false);
      paintKeys();
      render();
      armUndo(snap);
    };

    if (row && !reduced) { row.classList.add('is-gone'); setTimeout(done, 340); }
    else done();
  }

  /* ---------- the way back ----------

     Five seconds of the plate, and a tap takes it. The plate is already the
     surface that answers a tap and already the surface that says the short
     things; this is one more of them, with a consequence attached. */

  let undoSnap = null, undoSeq;

  function armUndo(snap) {
    undoSnap = snap;
    clearTimeout(plateSeq);
    clearTimeout(undoSeq);
    plateSwap(span('pl-msg', '↶ undo'));
    plateEl.setAttribute('aria-label', 'Undo delete');
    undoSeq = setTimeout(() => { undoSnap = null; Plate.rest(); }, reduced ? 1600 : 5000);
  }

  function clearUndo() { clearTimeout(undoSeq); undoSnap = null; }

  function undoDelete() {
    const snap = undoSnap;
    clearUndo();
    const before = state.current;
    if (!state.history[snap.key])
      state.history = insertAt(state.history, snap.dayAt, snap.key, {});
    state.history[snap.key] =
      insertAt(state.history[snap.key], snap.at, snap.reason, snap.tuple);
    rebalance(snap.start);
    save();
    render();
    flashRow(snap.key, snap.reason);
    Plate.roll(before);
  }

  /* ---------- the draft row ----------

     Beat 2 puts the reason on the plate, so without this the amount you just
     typed would be nowhere on screen. */
  let draftRow = null;

  function draft() {
    /* an edit already HAS a row, and it is the one you are looking at */
    if (C.edit) { paintEdit(); return; }
    /* ...and a promise never becomes a row, so it must not rehearse one:
       nothing moved, and the ledger is only ever what moved */
    if (C.kind && MOVES[C.kind].cash === 0) {
      if (draftRow && draftRow.parentNode) draftRow.remove();
      draftRow = null;
      return;
    }
    if (draftRow && draftRow.parentNode) draftRow.remove();
    draftRow = null;
    if (C.beat === 0 || C.busy) return;

    const parsed = parseAmount(expr());
    const op = parsed.error ? C.sign : parsed.op;
    const amount = (C.raw && !parsed.error) ? Number(parsed.amount) : null;
    const delta = amount == null ? null : (op === '+' ? amount : -amount);

    const row = document.createElement('div');
    row.className = 'row is-draft' + (op === '+' ? ' is-up' : '');

    const when = document.createElement('div');
    when.className = 'cell c-when';
    const inner = document.createElement('span');
    inner.className = 'when-in';
    const num = document.createElement('span');
    num.className = 'daynum';
    num.textContent = String(C.when.getDate());
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = clock(C.when);
    inner.append(num, t);
    when.appendChild(inner);

    /* The draft is a rehearsal of the row, so it wears the row's own label:
       with a person, the name leads. The separator waits for the reason —
       `Ravi · ` with nothing after it is a sentence cut in half. */
    const nm = C.kind ? C.who.trim() : '';
    const why = cell('c-reason',
      nm && C.why ? nm + ' · ' + C.why : (nm || C.why || ''));
    if (C.beat === 2 || (C.beat === 3 && C.why)) why.classList.add('is-live');

    const flowCell = cell('c-flow',
      (op === '+' ? '+' : '\u2212') + '₹' + (C.raw ? group(amount == null ? 0 : amount) : ''));
    flowCell.classList.add(op === '+' ? 'is-in' : 'is-out');
    if (C.beat === 1) flowCell.classList.add('is-live');

    const bal = cell('c-bal', delta == null ? '·' : group(state.current + delta));

    row.append(when, why, flowCell, bal);
    draftRow = row;
    card.hidden = false;
    card.appendChild(row);
    blankNote.hidden = true;
    /* the draft wraps its reason too, and it is rebuilt rather than grown,
       so the measurement has to happen here rather than in paintEdit */
    reparkIfGrew(row);
  }

  /* ---------- the keys ---------- */

  function paintKeys() {
    slipHome();                      /* a bar whose keys changed belongs on screen */
    if (C.beat === 0) {
      btnIn.className = 'key k-in';
      btnOut.className = 'key k-out';
      btnIn.setAttribute('aria-label', 'Money in');
      btnOut.setAttribute('aria-label', 'Money out');
      keyGlyph(btnIn, 'plus');
      keyGlyph(btnOut, 'minus');
      return;
    }
    /* Composing: the direction is already chosen, so + collapses and −
       becomes the only way forward.

       Editing gives that freed slot the one job the entry flow has no use
       for. A row that already exists is the only row there is anything to
       delete, so the bin exists exactly while one is open and nowhere else. */
    if (C.edit) {
      btnIn.className = 'key k-in is-del';
      btnIn.setAttribute('aria-label', 'Delete');
      keyGlyph(btnIn, 'bin');
    } else {
      btnIn.className = 'key k-in is-gone';
    }
    const armed = C.beat === 1 ? !!C.raw : (C.beat === 2 ? !!C.why.trim() : !!C.who.trim());
    /* the tick belongs to the LAST beat, wherever the walk put it */
    const last = stepOf() === C.seq.length - 1 && !C.edit;
    btnOut.className = 'key k-out ' + (armed ? 'is-go' : 'is-cold');
    btnOut.setAttribute('aria-label', last ? 'Save' : 'Next');
    keyGlyph(btnOut, last ? 'tick' : 'next');
  }

  const GLYPHS = {
    plus:  { vb: '0 0 18 18', d: 'M9 1.5V16.5M1.5 9H16.5' },
    minus: { vb: '0 0 18 4',  d: 'M1.5 2H16.5' },
    next:  { vb: '0 0 18 18', d: 'M1.5 9H16.5M10 2.5L16.5 9L10 15.5' },
    tick:  { vb: '0 0 18 18', d: 'M2 9.5L7 14.5L16 3.5' },
    /* whose money ends up where: up is yours out there, down is theirs here */
    up:    { vb: '0 0 18 18', w: 2, d: 'M9 15.5V3M3.5 8.5L9 3l5.5 5.5' },
    down:  { vb: '0 0 18 18', w: 2, d: 'M9 2.5V15M3.5 9.5L9 15l5.5-5.5' },
    /* the bin is drawn, not struck — at stroke 3 it is a black box */
    bin:   { vb: '0 0 18 18', w: 1.6,
             d: 'M3 4.5h12M7 4.5V2.5h4v2M4.5 4.5l.8 11h7.4l.8-11M7.5 7.5v5M10.5 7.5v5' },
  };
  function keyGlyph(btn, name) {
    btn.textContent = '';
    /* #btnOut .icon is locked to 4u tall for the minus bar, so anything that
       is not the minus has to say it is square */
    btn.appendChild(icon(name, 'icon' + (name === 'minus' ? '' : ' is-square')));
  }

  function icon(name, cls) {
    const g = GLYPHS[name];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls || 'icon');
    svg.setAttribute('viewBox', g.vb);
    svg.setAttribute('width', '18');
    svg.setAttribute('height', name === 'minus' ? '4' : '18');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', g.d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', String(g.w || 3));
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }

  /* ---------- the beats ---------- */

  function startCompose(sign) {
    if (C.busy || C.beat !== 0) return;
    C.beat = 1;
    C.seq = SEQ_PLAIN;
    C.sign = sign;
    C.raw = '';
    C.why = '';
    C.who = '';
    C.when = new Date();
    editH = 0;                       /* nothing has parked yet, so nothing may re-park */
    /* the number keyboard, straight away — an amount is what this beat is
       for, and on a laptop this simply means the field has the caret */
    openField(sign, '', false, 'numeric', '');
    /* beat 1 used to have nothing to offer, so this said showChips(false)
       outright. It has an offer now — the things you repeat — and syncChips
       still closes the strip when the ledger has none. */
    syncChips();
    paintKeys();
    draft();
    afterRide(park);
    if (window.Mascot) window.Mascot.wake();
  }

  /* Every beat is entered through here, forwards or backwards, so the walk
     is the only thing that knows about order and the beats themselves stay
     three plain jobs: a figure, a word, a name. */
  function enter(role) {
    C.beat = role;
    if (role === 1) openField(C.sign, C.raw, false, 'numeric', '');
    else openField(null, role === 2 ? C.why : C.who, true, 'text',
                   role === 2 ? 'why?' : 'who?');
    syncChips();
    paintKeys();
    paintSay();
    draft();
    /* The reason beat opens the row taller and the shelf above the bar may take
       a slot with it, so the place the row belongs has moved. It waits like the
       first park does: a numeric pad and a text keyboard are not the same
       height, and parking before that swap lands is what put the row back
       under the keyboard the moment you asked for the reason. */
    /* ...and a new entry wants it just as much: the strip opening above the
       bar and a numeric pad swapping for a text one both move the floor the
       row is standing on, so the row has to be brought up AFTER they land,
       not before. Parking on the way in is what made the amount you had just
       typed sit behind the chips. */
    afterRide(park);
  }

  function nextBeat() {
    if (C.busy) return;

    if (C.beat === 1) {
      if (!C.raw) return;
      const parsed = parseAmount(expr());
      if (parsed.error) { plateWarn(parsed.error); return; }
    }
    if (C.beat === 2 && !C.why.trim()) return;
    if (C.beat === 3 && !C.who.trim()) return;
    /* an edit is finished by its reason: the row it rewrites has no name */
    if (C.beat === 2 && C.edit) { saveEdit(); return; }

    const i = stepOf() + 1;
    if (i >= C.seq.length) { commit(); return; }
    enter(C.seq[i]);
  }

  function backBeat() {
    if (C.busy) return;
    const i = stepOf();
    if (i <= 0) { cancelCompose(); return; }
    enter(C.seq[i - 1]);
  }

  function cancelCompose(message) {
    const wasEdit = !!C.edit;
    C.beat = 0;
    C.seq = SEQ_PLAIN;
    C.edit = null;
    C.kind = null;
    paintSay();
    C.raw = '';
    C.why = '';
    C.who = '';
    C.busy = false;
    closeField();
    showChips(false);
    paintKeys();
    const done = () => {
      render();
      if (message) Plate.say(message); else Plate.rest();
    };
    if (wasEdit) shutEdit(done); else { editRow = null; done(); }
  }

  function plateWarn(text) {
    /* the field keeps what you typed; the plate says what is wrong and then
       goes back to being a field */
    const keep = composeInput.value;
    Plate.say(text);
    setTimeout(() => {
      if (C.beat !== 1) return;
      plateSwap(fieldLabel('₹', C.sign));
      composeInput.value = keep;
      composeInput.focus();
    }, reduced ? 20 : 1500);
  }

  /* ---------- commit ----------

     Land, then roll — and in that order for a reason worth keeping.

     Rolling WHILE the bar travels does not read as one gesture: the plate
     crosses the keyboard's height in 240ms, and a digit flip inside a body
     moving that fast is masked by it. Same axis is exactly what hides it.

     So the row flash goes first — it is the one thing that stays legible
     while the bar moves, because the ledger holds still — and the figure
     rolls on arrival, at rest, where the balance always lives. Cause, then
     effect, staged rather than stacked.

     The roll is fired from the bar's own transitionend rather than a timer
     set to match it: two clocks that have to agree eventually will not, and
     the failure is a figure rolling in mid-air. */

  function commit() {
    C.busy = true;
    const before = state.current;
    const parsed = parseAmount(expr());
    const move = C.kind ? MOVES[C.kind] : null;

    /* ---------- a promise ----------

       Nothing moved, so the ledger hears nothing: no row, no balance, no
       roll. Only People changes, and the sentence already on screen is the
       receipt — it stays for two seconds rather than a new surface arriving
       to repeat it. */
    if (move && move.cash === 0) {
      updatePerson(state, C.who.trim(), move.owes < 0 ? '-' : '+',
        parsed.amount, C.why.trim(), dateKey(C.when));
      save();
      C.beat = 0;
      C.kind = null;
      C.busy = false;
      closeField();
      showChips(false);
      paintKeys();
      render();
      keepSay();
      return;
    }

    const key = dateKey(C.when);
    const before_n = state.history[key] ? Object.keys(state.history[key]).length : 0;
    record(state, C.when, parsed.op, parsed.amount, C.why.trim(),
      move ? C.who.trim() : null);
    save();
    const reasons = Object.keys(state.history[key]);
    const added = reasons.length === before_n + 1 ? reasons[reasons.length - 1] : null;

    C.beat = 0;
    C.kind = null;
    paintSay();
    closeField();
    showChips(false);
    paintKeys();
    /* one row appended, or the whole ledger again if anything looked off */
    if (!added || !appendOne(key, added)) render();
    else { applyFlow(); disarmRow(); Plate.rest(); }
    flashLast();

    /* the plate carries the OLD balance down, so the roll has a from */
    Plate.hold(before);
    lift();

    let fired = false;
    const payoff = () => {
      if (fired) return;
      fired = true;
      plateEl.classList.remove('is-land');
      void plateEl.offsetWidth;                 /* let the removal land */
      if (!reduced) plateEl.classList.add('is-land');
      Plate.roll(before);
      setTimeout(() => plateEl.classList.remove('is-land'), 220);
    };

    /* The bar no longer moves relative to the app; the APP resizes as the
       keyboard goes, and the bar rides down with it. So that is the
       transition the roll waits on. */
    const app = document.querySelector('.app');
    const onEnd = (e) => {
      if (e.propertyName !== 'height') return;
      app.removeEventListener('transitionend', onEnd);
      payoff();
    };
    app.addEventListener('transitionend', onEnd);
    /* a transition that never starts fires no event — reduced motion, a
       hidden tab, or a bar that was already home because you used chips */
    setTimeout(() => { app.removeEventListener('transitionend', onEnd); payoff(); },
      reduced ? 20 : 300);

    /* Arm the unlock BEFORE anything that can throw. busy is a latch: if
       toBottom() ever failed, a timer that was never scheduled would leave
       the whole flow wedged with no way back but a reload. */
    setTimeout(() => { C.busy = false; }, reduced ? 40 : 820);

    toBottom();
  }

  /* ---------- input ---------- */

  composeInput.addEventListener('input', () => {
    /* Somebody is typing, so the nap is over — on every beat, not just the one
       that talks to him about digits. Asleep he springs up with the same wobble
       a tap gives him; awake this costs nothing but a pushed-back clock. */
    if (window.Mascot && window.Mascot.rouse) window.Mascot.rouse();
    if (C.beat === 1) {
      /* The sign is the key you pressed; it is not part of what you type. And
         the five-digit ceiling is enforced here now: a drawn pad could refuse
         a sixth digit by simply not having one, a real keyboard cannot. */
      let v = composeInput.value.replace(/^[+-]+/, '');
      /* g and t open a person's ledger, and an edit cannot reopen one — the
         history row does not record whose it was. So an edit takes digits,
         and its direction stays the one the row already has. */
      v = v.replace(/\D/g, '').slice(0, 5);
      if (v !== composeInput.value) {
        const atEnd = composeInput.selectionStart === composeInput.value.length;
        composeInput.value = v;
        if (atEnd) { try { composeInput.setSelectionRange(v.length, v.length); } catch (_) {} }
      }
      C.raw = v;
      /* the first digit says you are typing your own figure, so the shelf has
         nothing left to offer — and clearing back to empty brings it back */
      syncChips(true);
      catTyped();
    } else if (C.beat === 2) {
      /* typing straight after a chip refines it, so the space belongs to the
         app: "Travel" + "cab" is "Travel cab", never "Travelcab" */
      let v = composeInput.value;
      if (isChip(C.why) && v.length === C.why.length + 1 && v.indexOf(C.why) === 0) {
        v = C.why + ' ' + v.slice(C.why.length);
        composeInput.value = v;
      }
      C.why = v;
      /* type something and the chips have nothing left to offer. On a phone
         the ⌨ key did this; on a desktop there is no key, so the keystroke
         does it — and deleting back to empty brings them back. */
      syncChips(true);
    } else if (C.beat === 3) {
      C.who = composeInput.value;
      syncChips(true);
    }
    paintKeys();
    paintSay();
    draft();
  });

  /* ---------- the cat ----------

     He lives on the plate, so while beat 1 is running he answers the digits:
     a brace that scales with the amount, a glance up at the figure on a
     spend, stars and a hop on money in. He is optional — every call is
     guarded — and he is TOLD what happened rather than left to work it out,
     the same bargain poke() and mood() already make.

     The sign is simply the key's, now that nothing typed can flip it. */
  let catSeen = 0;

  function catTyped() {
    if (!window.Mascot || !window.Mascot.type) return;
    const digits = String(C.raw).replace(/\D/g, "");
    const parsed = parseAmount(expr());
    window.Mascot.type({
      digits: digits.length,
      amount: Number(digits || 0),
      sign: parsed.error ? C.sign : parsed.op,
      added: digits.length > catSeen,   /* the one-shots fire on the landing */
    });
    catSeen = digits.length;
  }

  function catRest() {
    catSeen = 0;
    if (window.Mascot && window.Mascot.rest) window.Mascot.rest();
  }

  composeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nextBeat(); return; }
    if (e.key === 'Escape') { e.preventDefault(); cancelCompose(); return; }
    if (e.key === 'Backspace' && !composeInput.value) { e.preventDefault(); backBeat(); }
  });

  /* The caret belongs to the compose, not to whatever was last tapped: every
     pad key and every chip is a button, and pressing one would otherwise take
     the focus and drop the caret. `refocus` is lowered only by the code that
     MEANS the blur — closeField. */
  composeInput.addEventListener('blur', () => {
    if (!refocus || C.busy || C.beat === 0) return;
    setTimeout(() => {
      if (C.beat !== 0 && !composeInput.hidden && overlay.hidden &&
          document.activeElement !== composeInput) focusField();
    }, 0);
  });


  /* ---------- people ----------

     Who owes you, who you owe, and the one gesture that closes a name.

     `state.people` holds the open balances; the moves that BUILT them are in
     history, under the fourth slot of the tuple. The two do not line up on
     their own — a promise writes a person and no row, and a settled person
     leaves `state.people` entirely while keeping every row they are named on
     — so the list is the union of both, and the net is whatever
     `state.people` still says about them, or zero. */

  function census() {
    const by = new Map();
    const touch = (name) => {
      if (!by.has(name)) by.set(name, { name, net: 0, rows: [], last: null });
      return by.get(name);
    };

    for (const [key, day] of Object.entries(state.history)) {
      const date = parseKey(key);
      for (const [reason, t] of Object.entries(day)) {
        if (!t[3]) continue;            /* a row with no name is nobody's */
        const when = new Date(date);
        const [hh, mm] = String(t[2] || '00:00').split(':');
        when.setHours(Number(hh) || 0, Number(mm) || 0, 0, 0);
        touch(t[3]).rows.push({ when, why: reason, flow: Number(t[1]) });
      }
    }
    for (const [name, [owed, , key]] of Object.entries(state.people)) {
      const P = touch(name);
      P.net = Number(owed);
      P.promised = parseKey(key);       /* a promise has a date and no row */
    }

    const out = [...by.values()];
    for (const P of out) {
      P.rows.sort((a, b) => b.when - a.when);
      P.last = P.rows.length ? P.rows[0].when : P.promised;
    }
    /* open names first, biggest first, then alphabetical — the order the
       sheet reads top to bottom */
    out.sort((a, b) => (!!b.net - !!a.net) ||
                       (Math.abs(b.net) - Math.abs(a.net)) ||
                       a.name.localeCompare(b.name));
    return out;
  }

  /* Settling is not a label change, it is a transaction, and the cash moves
     the way the row it writes says it does:

         they owe you   net < 0   they hand it over   +   balance UP
         you owe them   net > 0   you hand it over    −   balance DOWN

     `updatePerson` nets them to zero and drops them out of `state.people` on
     its own, which is exactly what settled means. Their rows stay: Ravi gave
     me ₹100 and I gave Ravi ₹100 is two rows and a zero, not two rows gone. */
  const SETTLE_WHY = 'Settled up';

  function settlePerson(P) {
    const when = new Date();
    const key = dateKey(when);
    const snap = { name: P.name, was: state.people[P.name].slice(),
                   key, start: opening() };
    record(state, when, P.net > 0 ? '-' : '+', Math.abs(P.net), SETTLE_WHY, P.name);
    /* the reason may have been uniquified — two people settled on one day —
       so the way back out reads back the key `record` actually used */
    const reasons = Object.keys(state.history[key]);
    snap.reason = reasons[reasons.length - 1];
    save();
    render();
    return snap;
  }

  /* ...and the way back out: the row deleted, the ledger run again from the
     balance it opened on, and the person put back exactly as they were. */
  function unsettlePerson(snap) {
    const day = state.history[snap.key];
    if (day) {
      delete day[snap.reason];
      if (!Object.keys(day).length) delete state.history[snap.key];
    }
    rebalance(snap.start);
    state.people[snap.name] = snap.was;
    save();
    render();
  }

  /* the figure is always the size of the debt — which side it is on is
     carried by the colour and by the word beside it, never by a sign */
  const money = (n) => rupees(Math.abs(n));
  const sum = (xs) => xs.reduce((a, P) => a + Math.abs(P.net), 0);

  function ago(d) {
    const days = Math.round((Date.now() - d) / 864e5);
    if (days < 1) return 'today';
    if (days < 7) return days + 'd ago';
    if (days < 60) return Math.round(days / 7) + 'w ago';
    if (days < 365) return Math.round(days / 30) + 'mo ago';
    return Math.round(days / 365) + 'y ago';
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const stamp = (d) => pad2(d.getDate()) +
    '<span>/' + pad2(d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(-2) + '</span>' +
    '<span>' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + '</span>';

  const CARET =
    '<svg class="pp-caret" viewBox="0 0 18 18" aria-hidden="true">' +
    '<path d="M4.5 7L9 11.5L13.5 7" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" /></svg>';
  const CHEV =
    '<svg class="c" viewBox="0 0 18 18" aria-hidden="true">' +
    '<path d="M7 4.5L11.5 9L7 13.5" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>';
  const TICK =
    '<svg class="c" viewBox="0 0 18 18" aria-hidden="true">' +
    '<path d="M3.5 9.5L7 13L14.5 5" fill="none" stroke="currentColor" ' +
    'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" /></svg>';

  /* ---------- one meter, two gestures ----------

     Drag right to about four fifths and let go to commit; let go short of it
     and it springs back. Or press and hold and it fills on its own — move
     sideways before it finishes and the hold is abandoned and the drag takes
     over from where the finger actually is. Both run the same fill, so there
     is one thing to learn and one thing to watch. */
  function swipe(said) {
    const el = document.createElement('div');
    el.className = 'pp-swipe';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    const face = (cls, glyph) =>
      '<div class="pp-face ' + cls + '">' + glyph + '<span class="t"></span></div>';
    el.innerHTML = face('pp-rest', CHEV) + face('pp-fill', CHEV);
    for (const t of el.querySelectorAll('.t')) t.textContent = said;

    const fill = el.querySelector('.pp-fill');
    /* 420ms is the app's own hold — row-arm and key-arm both run it, and the
       bin key is already an irreversible thing committed at that length. */
    const HOLD = 420, SLOP = 8;
    let id = null, x0 = 0, p = 0, done = false, mode = null, timer = 0;
    const paint = (v) => { fill.style.clipPath = 'inset(0 ' + ((1 - v) * 100) + '% 0 0)'; };

    const settle = () => {
      done = true;
      clearTimeout(timer); timer = 0;
      el.classList.remove('is-hold', 'is-drag');
      el.classList.add('is-done', 'is-snap');
      paint(1);
      for (const t of el.querySelectorAll('.t')) t.textContent = 'settled';
      for (const c of el.querySelectorAll('.c')) c.outerHTML = TICK;
      el.dispatchEvent(new CustomEvent('settled'));
      /* ...and the way out, in the same breath. The thumb is still on the bar
         it just filled, so the exit belongs there at that moment — an undo
         that arrives a second later arrives after the eye has moved on, and
         is then something you have to go and FIND. */
      el.classList.add('can-undo');
    };

    /* ---------- the exit ----------

       It appears under the very finger that committed, so the one thing it
       may never answer to is that finger's own release: `pointerup` on the
       committing pointer is captured by the bar, and the `click` that trails
       it is dropped here. A press that starts ON the chip is a new gesture
       and the only one that counts. */
    const undo = document.createElement('div');
    undo.className = 'pp-undo';
    undo.textContent = 'undo';
    undo.setAttribute('role', 'button');
    undo.tabIndex = 0;
    undo.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
    undo.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      el.dispatchEvent(new CustomEvent('unsettled'));
    });
    undo.addEventListener('click', (e) => e.stopPropagation());
    undo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      el.dispatchEvent(new CustomEvent('unsettled'));
    });
    el.appendChild(undo);

    const stopHold = () => { clearTimeout(timer); timer = 0; el.classList.remove('is-hold'); };

    el.addEventListener('pointerdown', (e) => {
      if (done) return;
      e.stopPropagation();
      id = e.pointerId; x0 = e.clientX; mode = 'hold';
      el.setPointerCapture(id);
      el.classList.add('is-drag', 'is-hold');
      el.classList.remove('is-snap');
      fill.style.clipPath = '';          /* hand the fill back to the CSS */
      timer = setTimeout(() => { timer = 0; settle(); }, HOLD);
    });
    el.addEventListener('pointermove', (e) => {
      if (done || e.pointerId !== id) return;
      const dx = e.clientX - x0;
      /* a sideways finger was never holding — take the fill back and drag it */
      if (mode === 'hold' && Math.abs(dx) > SLOP) { stopHold(); mode = 'drag'; }
      if (mode !== 'drag') return;
      p = Math.max(0, Math.min(1, dx / (el.clientWidth * 0.82)));
      paint(p);
    });
    const release = (e) => {
      if (e.pointerId !== id) return;
      stopHold();
      id = null; mode = null;
      el.classList.remove('is-drag');
      el.classList.add('is-snap');
      /* a hold that already committed has nothing left to spring back */
      if (done) return;
      if (p >= 0.995) settle(); else paint(0);
      p = 0;
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    /* a keyboard has no swipe, so Enter is the whole gesture */
    el.addEventListener('keydown', (e) => {
      if (done) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); settle(); }
    });
    /* the row under it opens and shuts on click; this is not that */
    el.addEventListener('click', (e) => e.stopPropagation());
    return el;
  }

  function moveRow(t) {
    const row = document.createElement('div');
    row.className = 'pp-txn';
    row.innerHTML = '<div class="pp-when">' + stamp(t.when) + '</div>' +
      '<div class="pp-why"><span></span></div>' +
      '<div class="pp-amt ' + (t.flow < 0 ? 'pp-pay' : 'pp-get') + '"><i>' +
      (t.flow < 0 ? 'paid' : 'got') + '</i><b></b></div>';
    row.querySelector('.pp-why span').textContent = t.why;
    row.querySelector('.pp-amt b').textContent = money(t.flow);
    return row;
  }

  /* the history, and above it the one thing you can do about it */
  function personBody(P, withKey) {
    const b = document.createElement('div');
    b.className = 'pp-body';
    if (withKey) {
      const act = document.createElement('div');
      act.className = 'pp-act';
      /* the app already says this: the four person moves are labelled
         `I gave someone` and `Someone gave me`. The key that CLOSES one is
         the same sentence with the name where someone was. */
      act.appendChild(swipe(P.net > 0
        ? 'I gave ' + P.name + ' ' + money(P.net)
        : P.name + ' gave me ' + money(P.net)));
      b.appendChild(act);
    }
    for (const t of P.rows) b.appendChild(moveRow(t));
    return b;
  }

  function personBlock(P, cls, withKey) {
    const w = document.createElement('div');
    w.className = 'pp-person is-shut';

    const head = document.createElement('div');
    head.className = 'pp-row';
    const two = document.createElement('div');
    two.className = 'pp-two';
    two.innerHTML = '<b></b><span></span>';
    two.querySelector('b').textContent = P.name;
    two.querySelector('span').textContent = P.last ? ago(P.last) : '';
    const fig = document.createElement('div');
    fig.className = 'pp-fig ' + cls;
    fig.textContent = money(P.net);
    head.append(two, fig);
    head.insertAdjacentHTML('beforeend', CARET);
    head.addEventListener('click', () => w.classList.toggle('is-shut'));

    w.append(head, personBody(P, withKey));
    return w;
  }

  function tally(label, list, cls) {
    const b = document.createElement('div');
    b.className = 'pp-box';
    b.innerHTML = '<em></em><b></b><span></span>';
    b.children[0].textContent = label;
    b.children[1].className = cls;
    b.children[1].textContent = rupees(sum(list));
    b.children[2].textContent = list.length + (list.length === 1 ? ' person' : ' people');
    return b;
  }

  function showPeople() {
    const PEOPLE = census();

    if (!PEOPLE.length) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Nobody owes you, and you owe nobody.';
      openSheet('People', hint, [['Done', 'primary', closeSheet]]);
      return;
    }

    const body = document.createElement('div');
    body.className = 'pp';
    const boxes = document.createElement('div');
    boxes.className = 'pp-boxes';
    const sdiv = document.createElement('div');
    sdiv.className = 'pp-sdiv';
    sdiv.textContent = 'settled';
    const done = document.createElement('div');
    done.className = 'pp-done';

    /* the sheet is modal and nothing else writes while it is up, so the two
       sides are held here and the nodes keep their identity across a settle */
    const live = { pay: PEOPLE.filter((P) => P.net > 0),
                   collect: PEOPLE.filter((P) => P.net < 0) };

    function paintBoxes() {
      boxes.textContent = '';
      boxes.append(tally('pay', live.pay, 'pp-pay'),
                   tally('collect', live.collect, 'pp-get'));
      sdiv.hidden = !done.children.length;
    }

    function onSettle(P, node) {
      const was = P.net;
      P.snap = settlePerson(P);
      P.was = was;
      P.net = 0;
      live[was > 0 ? 'pay' : 'collect'] =
        live[was > 0 ? 'pay' : 'collect'].filter((x) => x !== P);
      /* the settlement is a row like any other, so it joins the history it
         just closed — in front, where the newest move belongs */
      const t = { when: new Date(), why: P.snap.reason, flow: -was };
      P.rows.unshift(t);
      node.querySelector('.pp-act').after(moveRow(t));

      /* ...and it says so where it stands. The figure becomes the word and
         the name goes quiet, but the row does NOT travel to the bottom: the
         undo lives on this key, and a key that moves the instant it is
         pressed is a key you have to go and find. Nothing resizes either —
         a row that changes height here shifts the exit out from under the
         thumb that is still on it.

         They are filed under `settled` the next time the sheet opens, which
         is the first moment nobody is looking at them. */
      node.classList.add('is-done');
      const fig = node.querySelector('.pp-fig');
      fig.textContent = 'settled';
      fig.className = 'pp-fig';
      paintBoxes();
    }

    /* every effect reversed, and the row rebuilt from scratch in the slot it
       is standing in — back to being settleable rather than stuck wearing a
       spent key, and still under the eye that just took the exit */
    function onUndo(P, node) {
      unsettlePerson(P.snap);
      P.snap = null;
      P.net = P.was;
      P.was = 0;
      P.rows.shift();
      const cls = P.net > 0 ? 'pp-pay' : 'pp-get';
      live[P.net > 0 ? 'pay' : 'collect'].push(P);
      node.replaceWith(openRow(P, cls));
      paintBoxes();
    }

    function openRow(P, cls) {
      const node = personBlock(P, cls, true);
      const sw = node.querySelector('.pp-swipe');
      sw.addEventListener('settled', () => onSettle(P, node));
      sw.addEventListener('unsettled', () => onUndo(P, node));
      return node;
    }

    /* the ones that were already square when the sheet opened */
    for (const P of PEOPLE) {
      if (P.net) continue;
      const node = personBlock(P, '', false);
      node.querySelector('.pp-fig').textContent = 'settled';
      done.appendChild(node);
    }

    body.append(boxes, sdiv, done);
    for (const [side, cls] of [['pay', 'pp-pay'], ['collect', 'pp-get']])
      for (const P of live[side]) body.insertBefore(openRow(P, cls), sdiv);
    paintBoxes();

    openSheet('People', body, [['Done', 'primary', closeSheet]], 'is-people');
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

  /* The plate leaves the greeting 142 reference px beside the cat, and this
     face costs 15 of them a character: nine in all, and "Hi " has three.
     So six is the longest name that sits at full size. The field stops
     there rather than letting the greeting quietly shrink to fit. */
  const NAME_MAX = 6;

  function setName() {
    const body = document.createElement('div');
    const name = field('Name', 'f-name', 'Meow');
    body.appendChild(name);
    const input = name.querySelector('input');
    input.maxLength = NAME_MAX;
    input.value = state.name.slice(0, NAME_MAX);

    function submit() {
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      /* maxLength holds a keyboard; a paste can still arrive longer */
      const cut = value.slice(0, NAME_MAX);
      state.name = cut[0].toUpperCase() + cut.slice(1);
      save();
      closeSheet();
      Plate.greet();
    }
    /* Same reason as the transaction sheet: without preventDefault the Enter
       that saved the name goes on to activate whatever closeSheet() focuses. */
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      submit();
    });

    openSheet('Your name', body, [
      ['Cancel', 'ghost', closeSheet],
      ['Save', 'primary', submit],
    ]);
  }

  /* ---------- how the direction is shown ----------

     Three ways to tell money in from money out, and the honest note under
     each: colour alone is the one that fails a red-blind reader, and it is
     also the quietest. Both is the default because a sign costs one glyph
     and survives everything. */

  /* Named for the cat, loudest to quietest. The preview beside each one is
     the whole explanation, so no line of prose has to sit under it.

     The description does not disappear, though: it moves to the button's
     aria-label, because a screen reader gets no preview and "Purr" on its
     own would tell it nothing at all. */
  const FLOW_OPTS = [
    { id: 'both',   label: 'Meow',  says: 'Both \u2014 sign and colour' },
    { id: 'colour', label: 'Purr',  says: 'Colour only \u2014 no signs' },
    { id: 'sign',   label: 'Chirp', says: 'Sign only \u2014 no colour' },
    { id: 'minus',  label: 'Doze',  says: 'Minus only \u2014 income unmarked' },
  ];

  function chooseFlow() {
    const body = document.createElement('div');
    body.className = 'choices';
    body.setAttribute('role', 'radiogroup');
    body.setAttribute('aria-label', 'Flow column');

    for (const o of FLOW_OPTS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'choice no-note' + (o.id === state.flow ? ' is-on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.id === state.flow));
      b.setAttribute('aria-label', o.label + ': ' + o.says);
      b.title = o.says;

      const name = document.createElement('span');
      name.className = 'choice-name';
      name.textContent = o.label;

      /* the preview is the argument: each row is drawn the way it would be */
      const sample = document.createElement('span');
      sample.className = 'choice-sample flow-eg flow-eg-' + o.id;
      const out = document.createElement('i');
      out.className = 'eg-out';
      out.textContent = (o.id === 'colour' ? '' : '\u2212') + '\u20b9620';
      const inn = document.createElement('i');
      inn.className = 'eg-in';
      inn.textContent = (o.id === 'colour' || o.id === 'minus' ? '' : '+') + '\u20b9500';
      sample.append(out, inn);

      b.append(name, sample);
      b.addEventListener('click', () => {
        state.flow = o.id;
        save();
        render();
        for (const other of body.children) {
          const on = other === b;
          other.classList.toggle('is-on', on);
          other.setAttribute('aria-checked', String(on));
        }
      });
      body.appendChild(b);
    }

    openSheet('Flow', body, [['Done', 'primary', closeSheet]]);
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
  Hold either one for the person moves.
  Tap the balance for everything else.

Keyboard
  -        money out
  +        money in
  hold -   I gave someone · someone has my money
  hold +   someone gave me · someone paid for me
  Esc      back out of an entry

Amount field
  5    add 5 to the balance
  +5   the same thing
  -5   take 5 off the balance

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
     stays clean: no icon has to sit on the balance.

     Every row carries its VALUE. Seven rows that each said one word were
     seven rows you had to open to learn anything, and six of those openings
     ended in you closing it again. */

  const CARET_Y =
    '<svg class="yo-caret" viewBox="0 0 18 18" aria-hidden="true">' +
    '<path d="M7 4.5L11.5 9L7 13.5" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" /></svg>';

  function yoRow(label, value, run, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'yo-row' + (cls ? ' ' + cls : '');
    const l = document.createElement('span');
    l.textContent = label;
    const v = value instanceof Node ? value : document.createElement('span');
    if (!(value instanceof Node)) { v.className = 'yo-val'; v.textContent = value || ''; }
    b.append(l, v);
    b.insertAdjacentHTML('beforeend', CARET_Y);
    if (run) b.addEventListener('click', run);
    return b;
  }

  function yoDiv(text) {
    const d = document.createElement('div');
    d.className = 'yo-div';
    if (text) d.textContent = text;
    return d;
  }

  /* the flow sample, drawn the way that mode draws the ledger */
  function yoFlow() {
    const s = document.createElement('span');
    s.className = 'yo-val yo-flow f-' + state.flow;
    const out = document.createElement('i');
    out.className = 'eg-out';
    out.textContent = (state.flow === 'colour' ? '' : '−') + '₹620';
    const inn = document.createElement('i');
    inn.className = 'eg-in';
    inn.textContent = (state.flow === 'colour' || state.flow === 'minus' ? '' : '+') + '₹500';
    s.append(out, inn);
    return s;
  }

  /* ---------- what the rows have to say ----------

     Read rather than stored: the sheet is opened rarely and these are three
     walks of an object the app is already holding, which is cheaper than any
     counter that could drift out of step with the ledger. */

  const countRows = () =>
    Object.values(state.history).reduce((n, day) => n + Object.keys(day).length, 0);

  /* the newest transaction, without taking it out — `undo()` removes, and
     this row has to be able to NAME what it would remove before you press */
  function lastTxn() {
    const days = Object.keys(state.history);
    for (let i = days.length - 1; i >= 0; i--) {
      const reasons = Object.keys(state.history[days[i]]);
      if (reasons.length) {
        const key = reasons[reasons.length - 1];
        return { reason: key, flow: state.history[days[i]][key][1] };
      }
    }
    return null;
  }

  function showYou() {
    const body = document.createElement('div');

    /* money */
    const open = Object.keys(state.people).length;
    body.appendChild(yoRow('People', open ? open + ' open' : '', showPeople));
    const rows = countRows();
    body.appendChild(yoRow('Export', rows ? rows + (rows === 1 ? ' row' : ' rows') : '',
      exportHistory));

    /* look — the two settings that exist only to change how the ledger reads */
    body.appendChild(yoDiv('look'));
    body.appendChild(yoRow('Font', currentFont.label, chooseFont));
    body.appendChild(yoRow('Flow', yoFlow(), chooseFlow));

    /* you */
    body.appendChild(yoDiv('you'));
    body.appendChild(yoRow('Your name', state.name, setName));
    body.appendChild(yoRow('Help', '', showHelp));

    /* ...and the one row here that rewrites the ledger. It goes last, it
       goes red, and it says what it is about to take out: a button that
       will not tell you what it undoes is a button you cannot press on
       purpose. With an empty ledger it is not drawn at all, because a
       control that can only answer `nothing to undo` is not a control. */
    const last = lastTxn();
    if (last) {
      body.appendChild(yoDiv(''));
      body.appendChild(yoRow('Undo last', last.reason + '  ' + flowText(last.flow),
        undoLast, 'is-undo'));
    }

    openSheet(greeting(), body, [['Done', 'primary', closeSheet]], 'is-you');

    /* With no name the greeting is just `Good evening` and `Your name` below
       is a row with an empty value — true, and no kind of invitation. The ask
       goes beside the greeting it would change, where the gap actually is,
       and it exists only while the gap does. */
    if (!state.name) {
      const ask = document.createElement('button');
      ask.type = 'button';
      ask.className = 'yo-ask';
      ask.textContent = 'add your name';
      ask.addEventListener('click', setName);
      sheetTitle.appendChild(ask);
    }
  }

  /* greet.js is optional scenery in its own file, so it is asked rather than
     called: without it the sheet is titled the way it always was. */
  function greeting() {
    if (window.Greet) return window.Greet.say(state.name);
    return state.name || 'You';
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

  const toolbar = document.querySelector('.toolbar');
  const btnIn = document.getElementById('btnIn');
  const btnOut = document.getElementById('btnOut');

  const behavior = reduced ? 'auto' : 'smooth';

  function toBottom(how) {
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: how || behavior });
  }

  /* ---------- the caret stays in the field ----------

     Pressing a button hands it the focus, and the focus leaving the input is
     what takes the keyboard down. So tapping a chip, or → between beats, had
     the keyboard duck out and come straight back — with the bar and the plate
     riding down and up behind it — to end exactly where it started.

     Cancelling mousedown's default is what stops the focus from moving at all.
     The click still fires, and the chip strip still scrolls: mousedown only
     arrives once the gesture is over, so nothing a finger does is touched. */
  for (const bar of [toolbar, chiprow]) {
    bar.addEventListener('mousedown', (e) => {
      if (!composeInput.hidden) e.preventDefault();
    });
  }

  btnOut.addEventListener('click', () => {
    if (swallowTap(btnOut)) return;
    if (C.beat === 0) startCompose('-'); else nextBeat();
  });
  flipBtn.addEventListener('click', flipSign);

  btnIn.addEventListener('click', () => {
    if (swallowTap(btnIn)) return;
    if (C.beat === 0) startCompose('+');
    else if (C.edit) deleteEdit();
  });

  /* ---------- hold a key for the person moves ----------

     A tap on − is a spend and a hold on − is a spend that someone owes you
     for: the same direction, one level deeper. So the moves hang off the key
     that already means their direction, and only the two that lean that way
     are ever offered — the 2×2 exists in the code and never on the screen.

     It fires on the timer, like the row does, and the tap that would have
     followed is swallowed so the hold does not also start a plain entry. */

  let armKey = null, armKeySeq, heldOn = null;

  function disarmKey() {
    clearTimeout(armKeySeq);
    if (armKey) armKey.classList.remove('is-arming');
    armKey = null;
  }

  /* The click that closes a hold would otherwise also fire the key's own tap.
     It is swallowed on the key that was HELD and on nothing else: the commit
     key is the next thing you press, and it must not be eaten with it. */
  function swallowTap(btn) {
    if (heldOn !== btn) return false;
    heldOn = null;
    return true;
  }

  function armMoves(btn, sign) {
    btn.addEventListener('pointerdown', () => {
      heldOn = null;
      if (C.beat !== 0 || C.busy || !overlay.hidden) return;
      armKey = btn;
      btn.classList.add('is-arming');
      armKeySeq = setTimeout(() => {
        btn.classList.remove('is-arming');
        armKey = null;
        heldOn = btn;
        if (navigator.vibrate) navigator.vibrate(8);
        buildMoves(sign);
        showChips(true);
      }, 420);
    });
    for (const t of ['pointerup', 'pointerleave', 'pointercancel']) {
      btn.addEventListener(t, disarmKey);
    }
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  armMoves(btnOut, '-');
  armMoves(btnIn, '+');

  /* ---------- the same two keys, on a keyboard ----------

     A phone has one gesture per key, and so does a desk. − and + open an
     entry, and HOLDING one for the same 420ms opens that direction's person
     moves: the same key, the same wait, the same two things at the end of
     it. Nothing new to learn and nothing new to document beyond which key.

     Shift is not the hold. A modifier is a second thing to know about a
     control that already has one gesture; the wait is the gesture the app
     already uses everywhere else — a held row, a held key, a settle — and
     the `is-arming` fill makes it the same thing to WATCH too.

     The tap fires on the way UP, because that is the only place a tap and a
     hold can still be told apart. Auto-repeat is what a held key actually
     sends, so the first keydown arms and every repeat after it is ignored. */

  /* − and + wherever the layout keeps them: the bare key, the shifted one,
     and the numpad's, which report the signs directly */
  const SIGN_KEY = { '-': '-', '_': '-', '−': '-', '+': '+', '=': '+' };

  let typedKey = null, typedSeq = null, typedSpent = false;

  function typedOff() {
    clearTimeout(typedSeq);
    if (typedKey) typedKey.classList.remove('is-arming');
    typedKey = null;
  }

  /* A field has first claim on every key it can hold — but only a field that
     is ON SCREEN. The compose input is hidden rather than removed, and the
     focus does not always leave it when it goes; a closed field that still
     answers to activeElement would take − and + with it for good. */
  const inField = () => {
    const el = document.activeElement;
    if (!el || el.hidden) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  };
  const keysFree = () => C.beat === 0 && !C.busy && overlay.hidden && !inField();

  document.addEventListener('keydown', (e) => {
    const sign = SIGN_KEY[e.key];
    if (!sign || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!keysFree()) return;
    e.preventDefault();
    const btn = sign === '-' ? btnOut : btnIn;
    typedSpent = false;
    typedKey = btn;
    btn.classList.add('is-arming');
    typedSeq = setTimeout(() => {
      typedOff();
      typedSpent = true;                 /* the hold has spent this press */
      buildMoves(sign);
      showChips(true);
    }, 420);
  });

  document.addEventListener('keyup', (e) => {
    const sign = SIGN_KEY[e.key];
    if (!sign) return;
    const armed = typedKey === (sign === '-' ? btnOut : btnIn);
    typedOff();
    if (typedSpent) { typedSpent = false; return; }
    if (armed && keysFree()) startCompose(sign);
  });

  /* a key still down when the window goes is a key that is never coming up */
  addEventListener('blur', typedOff);

  /* the moves are an offer, not a mode: anywhere else takes it back */
  document.addEventListener('pointerdown', (e) => {
    if (C.beat !== 0 || chiprow.hidden) return;
    if (e.target.closest('.chip') || e.target.closest('.key')) return;
    showChips(false, true);
  }, true);

  /* ---------- and a tap outside takes back the entry ----------

     Same reading as Escape, on the gesture a phone actually has. The bar, the
     chip strip and the sentence are the entry; everything else — the ledger,
     the empty air above it — is the way out, and the keyboard goes with it.

     It waits for the LIFT and measures the travel, because the ledger is a
     scroller: a flick that starts on a row is a scroll, not a tap, and a
     scroll must never throw away what you typed. */
  const TAP_SLOP = 10;
  let outX = 0, outY = 0, outOn = false;

  const inEntry = (t) => !!(t && t.closest &&
    (t.closest('.toolbar') || t.closest('.chiprow') || t.closest('.saying')));

  document.addEventListener('pointerdown', (e) => {
    outOn = C.beat !== 0 && !C.busy && overlay.hidden && !inEntry(e.target);
    outX = e.clientX;
    outY = e.clientY;
  }, true);

  document.addEventListener('pointerup', (e) => {
    if (!outOn) return;
    outOn = false;
    if (C.beat === 0 || C.busy || !overlay.hidden) return;
    if (Math.hypot(e.clientX - outX, e.clientY - outY) > TAP_SLOP) return;
    if (inEntry(e.target)) return;
    cancelCompose();
  }, true);

  document.addEventListener('pointercancel', () => { outOn = false; }, true);

  /* ---------- hold a row to fix it ----------

     The app already teaches this gesture on the plate: press, and something
     grows to tell you it is coming. Here the ink crosses the row, and when it
     lands the row is open in the bar.

     It fires on the timer rather than the lift, because a press that has
     visibly finished and then waits for you to let go reads as broken. The
     lift is used for one thing only — a second, free go at the keyboard, for
     browsers that will not raise it from a timer. */

  let armRow = null, armSeq, armX = 0, armY = 0;

  function disarmRow() {
    clearTimeout(armSeq);
    if (armRow) armRow.classList.remove('is-arming');
    armRow = null;
  }

  card.addEventListener('pointerdown', (e) => {
    if (C.beat !== 0 || C.busy || !overlay.hidden) return;
    const row = e.target.closest('.row');
    if (!row || !row.dataset.k) return;
    armX = e.clientX;
    armY = e.clientY;
    armRow = row;
    row.classList.add('is-arming');
    armSeq = setTimeout(() => {
      row.classList.remove('is-arming');
      armRow = null;
      if (navigator.vibrate) navigator.vibrate(8);
      startEdit(row.dataset.k, row.dataset.r);
    }, 420);
  });

  /* a press that turns into a scroll was a scroll */
  card.addEventListener('pointermove', (e) => {
    if (armRow && Math.hypot(e.clientX - armX, e.clientY - armY) > 8) disarmRow();
  }, { passive: true });

  card.addEventListener('pointerup', () => {
    disarmRow();
    if (C.edit && !composeInput.hidden && document.activeElement !== composeInput) focusField();
  });
  card.addEventListener('pointercancel', disarmRow);
  card.addEventListener('pointerleave', disarmRow);

  /* a long press on a row otherwise raises the text-selection callout */
  card.addEventListener('contextmenu', (e) => { if (e.target.closest('.row')) e.preventDefault(); });
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

  /* On the WRAP, not on the plate button. The plate cannot hold the field —
     it is a button — so the field is a SIBLING lying over it, and mid-entry
     every touch on that box hits the input instead. Bound to the button, this
     handler simply never ran while composing: the one gesture it exists for,
     touching a cat asleep on the field, was the one it could not see. The wrap
     is both of them, and its box is the plate's exactly. */
  plateWrap.addEventListener('pointerdown', () => {
    if (C.beat !== 0 || C.busy) {
      /* Mid-entry the plate is a FIELD: this touch belongs to the caret, and
         nothing here may take it. But a cat asleep on that field is still a cat
         you just touched, so he comes up — the same wobble a tap gives him at
         rest, and nothing at all if he was already awake. */
      if (!C.busy && window.Mascot && window.Mascot.rouse) window.Mascot.rouse();
      return;
    }
    holding = true;
    if (window.Mascot) window.Mascot.press(true, () => { holding = false; showYou(); });
  });

  function release() {
    if (!holding) return;
    holding = false;
    const wasGrowing = window.Mascot && window.Mascot.press(false);
    if (wasGrowing) return;
    /* while the way back is on offer, the tap takes it — the cat can wait */
    if (undoSnap) { undoDelete(); return; }
    if (window.Mascot) window.Mascot.poke();
  }
  plateEl.addEventListener('pointerup', release);
  plateEl.addEventListener('pointerleave', release);
  plateEl.addEventListener('pointercancel', release);

  /* a long press on a touch screen otherwise raises the selection callout */
  plateEl.addEventListener('contextmenu', (e) => e.preventDefault());

  plateEl.addEventListener('click', (e) => { if (e.detail === 0) showYou(); });

  /* Anywhere else in the app counts as being here: pressing a key, opening a
     sheet, scrolling the ledger. He only nods off when nothing at all is
     happening, which is the whole point of the behaviour. The plate's whole box
     is excluded — button and the field over it — because a touch there goes
     through poke() or rouse(), and a silent wake first would rob him of the
     spring. Excluding only the button left the field to this handler, which
     un-dozed him without a sound and then had nothing left for rouse() to
     play: tapping the amount to start typing was the tap he never answered. */
  document.addEventListener('pointerdown', (e) => {
    if (window.Mascot && !plateWrap.contains(e.target)) window.Mascot.wake();
  }, { passive: true });
  /* ---------- the bar gets out of the way ----------

     Reading back through the ledger is the one thing you do here that wants
     the whole screen, and it is the one thing the bar is in the way of. So it
     leaves on the way back and returns on the way home.

     Four rules, and they are most of what keeps it from feeling broken:

       DEAD    a thumb resting on the glass is not a scroll
       COMMIT  a direction has to be MEANT. the count restarts on every flip,
               which is what stops a jittery finger flickering the bar
       FLOOR   at the foot it is always out: that is where the newest row is,
               where a commit lands, and where the plate belongs
       and it comes back on the first stroke the other way, because getting it
       back has to be cheaper than losing it.

     It never moves mid-entry — the bar IS the field then — and never while an
     undo is on offer, because the plate is the only way back from a delete and
     scrolling it off the screen would take that with it. */

  const SLIP_DEAD = 4, SLIP_COMMIT = 14, SLIP_FLOOR = 10, SLIP_BY = 112;
  const slipGone = () => SLIP_BY * Math.min(1, window.innerWidth / 643);

  let slipPx = 0, slipSince = 0, slipLast = scroller.scrollTop, slipQueued = false;

  function slipTo(px) {
    px = Math.max(0, Math.min(slipGone(), px));
    if (px === slipPx) return;
    slipPx = px;
    document.body.style.setProperty('--slip', px + 'px');
  }

  /* ...and it comes home without waiting for a scroll.

     Every guard below only ever ran on a scroll event, and a compose, an edit
     and a delete all arrive without one. So a bar slipped away for the long
     read was still slipped away when the keyboard came up under it, and the
     plate went with it — the one failure this bar exists to prevent.

     paintKeys is where every state those guards name lands, and openField is
     the door the keyboard comes through. Home is called from both, so the bar
     is already back before the keyboard has anywhere to bury it. */
  function slipHome() { slipSince = 0; slipTo(0); }

  function slipRead() {
    slipQueued = false;
    const y = scroller.scrollTop;
    const d = y - slipLast;
    slipLast = y;

    if (C.beat !== 0 || C.busy || undoSnap) { slipHome(); return; }
    if (y >= scroller.scrollHeight - scroller.clientHeight - SLIP_FLOOR) { slipHome(); return; }

    if (Math.abs(d) < SLIP_DEAD) return;
    slipSince = (slipSince > 0) === (d > 0) ? slipSince + d : d;
    if (Math.abs(slipSince) < SLIP_COMMIT) return;
    slipSince = 0;
    slipTo(d < 0 ? slipGone() : 0);   /* up is the long read, and it costs the bar */
  }

  scroller.addEventListener('scroll', () => {
    disarmRow();
    if (window.Mascot) window.Mascot.wake();
    if (!slipQueued) { slipQueued = true; requestAnimationFrame(slipRead); }
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!overlay.hidden) { closeSheet(); return; }
    if (C.beat !== 0) { cancelCompose(); return; }
    /* the moves are an offer, not a mode — Escape is the keyboard's way of
       tapping outside them */
    if (!chiprow.hidden) showChips(false, true);
  });

  /* ---------- first paint ---------- */

  render();
  Plate.greet();
  requestAnimationFrame(() => toBottom('auto'));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => toBottom('auto'));
  }
})();
