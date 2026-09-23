/* ============================================================
   Months — the ledger, grouped and totalled.

       Months.mount('#card', '#scroller');   once
       Months.sync();                        after every render

   Two things, one module:

   THE BAND   a sticky line per month: 09/26, what came in, what went out,
              and a chevron. A month that has ENDED opens shut; the month you
              are in is open and takes no tap — there is nothing to collapse
              away from yet.

   THE PILL   a floating label that answers "what am I looking at" with the
              tightest scope in play: a day you tapped, the day you are in
              while you are at the live end, or the month you are browsing.

   It reads the ledger it is given rather than the app's state: money.js
   stamps each row with data-mm, data-day and data-flow, and everything here
   follows from those three. Nothing to import but this file, and nothing to
   undo but the three lines that add it.
   ============================================================ */

window.Months = (function () {
  'use strict';

  const C = {
    /* A scope you chose has to survive a nudge — reading the rows around it —
       and not a journey. A row and a half is the line between the two. */
    letGo: 60,

    /* px per ms. A drag reads well under this, a fling well over it: rolling
       digits you are flying past is motion with nothing to read. */
    fling: 1.1,
    settleMs: 90,

    rollMs: 340,      /* one digit's slide */
    stagger: 22,      /* ...and the gap between them, right to left */
    easeMs: 240,      /* the box growing or shrinking to its new figures */
  };

  const SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  const rupees = (n) => '₹' + Math.abs(n).toLocaleString('en-IN');
  const inTx = (n) => '+' + rupees(n);
  const outTx = (n) => '−' + rupees(n);

  /* ---------- the stylesheet ----------
     Carried here rather than in money.css so the module stays one piece. */

  function css() {
    return `
.m-band {
  position: sticky; top: 0; z-index: 3;
  height: calc(34 * var(--u));
  display: flex; align-items: center; gap: calc(12 * var(--u));
  padding: 0 calc(13 * var(--u)) 0 calc(11 * var(--u));
  background: var(--surface-alt);
  box-shadow: inset 0 calc(-1 * var(--u)) 0 rgba(11, 11, 11, .07);
  cursor: pointer; user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.m-band.is-now { cursor: default; }
/* the month reads as a label, not a chip: the pill shape belongs to the day */
.m-band .m-mm {
  font: 500 calc(16 * var(--u))/1 var(--mono, "IBM Plex Mono", monospace);
  letter-spacing: .1em; color: var(--ink);
}
.m-band .m-got { margin-left: auto; color: var(--in); }
.m-band .m-spent { color: var(--accent); }
.m-band .m-got, .m-band .m-spent {
  font: 500 calc(16 * var(--u))/1 var(--mono, "IBM Plex Mono", monospace);
}

/* Drawn, not typed: the caret glyphs in this face sit off their optical
   centre and thin out when rotated. Same stroke language as the + and −
   keys — round caps, one weight. */
.m-band .m-caret {
  flex: 0 0 auto;
  width: calc(17 * var(--u)); height: calc(17 * var(--u));
  color: var(--ink-off);
  transition: transform .22s var(--ease-out);
}
.m-shut .m-caret { transform: rotate(-90deg); }

/* Hiding by attribute rather than by wrapping the rows: money.js owns the
   card's children and appends the draft row straight to it, so a wrapper
   here would be fighting it on every keystroke. */
.card[data-shut] .row.is-folded { display: none; }

/* the day number is the target for picking a day — it is already the thing
   the eye points at */
.money .card .daynum { cursor: pointer; }

/* ---------- the pill ---------- */

.m-pillwrap {
  position: sticky; top: calc(10 * var(--u)); z-index: 6;
  height: 0; display: grid; place-items: center;
  pointer-events: none;
}
.m-pill {
  pointer-events: auto;
  display: flex; align-items: center; gap: calc(10 * var(--u));
  box-sizing: border-box; white-space: nowrap; overflow: hidden;
  background: var(--surface);
  border: calc(2 * var(--u)) solid rgba(18, 18, 18, .7);
  border-radius: calc(17 * var(--u));
  padding: calc(6 * var(--u)) calc(14 * var(--u));
  font: 500 calc(15 * var(--u))/1 var(--mono, "IBM Plex Mono", monospace);
  box-shadow: 0 calc(3 * var(--u)) calc(9 * var(--u)) rgba(0, 0, 0, .16);
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  transition: opacity .18s var(--ease-out), transform .18s var(--ease-out),
              width ${C.easeMs}ms var(--ease-out);
}
.m-pill b { font-weight: 500; letter-spacing: .08em; color: var(--ink-weekday); }
.m-pill .m-in { color: var(--in); }
.m-pill .m-out { color: var(--accent); }
.m-pill.is-hidden { opacity: 0; transform: translateY(calc(-6 * var(--u))); }

/* the odometer: one cell per character, each a two-glyph column that slides
   when that character changes */
.m-pill b, .m-pill .m-in, .m-pill .m-out { display: inline-flex; }
.m-pill .ch { display: inline-block; height: 1em; line-height: 1em; overflow: hidden; }
.m-pill .ch .col { display: block; will-change: transform; }
.m-pill .ch i { display: block; height: 1em; line-height: 1em; font-style: normal; }

@media (prefers-reduced-motion: reduce) {
  .m-pill, .m-band .m-caret, .m-pill .ch .col { transition: none !important; }
}`;
  }

  /* ---------- state ---------- */

  let card = null, scroller = null, pill = null, pDay = null, pIn = null, pOut = null;
  const shut = new Set();          /* months folded away, by mm/yy */
  let months = [];                 /* [{ mm, got, spent, days: {key: {got, spent}} }] */
  let picked = null, pickedAt = 0;
  /* months already given their opening state once — a fold the user undid
     must survive the next render */
  const defaulted = new Set();
  let fast = false, lastTop = 0, lastAt = 0, settleSeq = null;

  const mmOf = (d) => String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getFullYear() % 100);
  const dayOf = (d) => d.getDate() + ' ' + SHORT[d.getMonth()];

  /* ---------- reading the ledger ---------- */

  function gather() {
    months = [];
    const seen = {};
    for (const row of card.querySelectorAll('.row[data-mm]')) {
      const mm = row.dataset.mm;
      const day = row.dataset.day;
      const flow = Number(row.dataset.flow) || 0;
      let M = seen[mm];
      if (!M) { M = seen[mm] = { mm, got: 0, spent: 0, days: {} }; months.push(M); }
      let D = M.days[day];
      if (!D) D = M.days[day] = { got: 0, spent: 0 };
      if (flow < 0) { M.spent += -flow; D.spent += -flow; }
      else { M.got += flow; D.got += flow; }
    }
  }

  const CARET =
    '<svg class="m-caret" viewBox="0 0 18 18" aria-hidden="true">' +
    '<path d="M4.5 7L9 11.5L13.5 7" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" /></svg>';

  function band(M, isNow) {
    const el = document.createElement('div');
    el.className = 'm-band' + (isNow ? ' is-now' : '');
    el.dataset.mm = M.mm;
    el.innerHTML =
      '<span class="m-mm"></span>' +
      '<span class="m-got"></span><span class="m-spent"></span>' + CARET;
    el.querySelector('.m-mm').textContent = M.mm;
    el.querySelector('.m-got').textContent = inTx(M.got);
    el.querySelector('.m-spent').textContent = outTx(M.spent);
    if (!isNow) el.addEventListener('click', () => {
      if (shut.has(M.mm)) shut.delete(M.mm); else shut.add(M.mm);
      fold();
      paint();
    });
    return el;
  }

  /* Which months are folded, applied to the rows and to the carets. */
  function fold() {
    card.dataset.shut = [...shut].join(' ');
    for (const row of card.querySelectorAll('.row[data-mm]')) {
      row.classList.toggle('is-folded', shut.has(row.dataset.mm));
    }
    for (const b of card.querySelectorAll('.m-band')) {
      b.classList.toggle('m-shut', shut.has(b.dataset.mm));
    }
  }

  /* ---------- the pill ---------- */

  function roll(host, text) {
    const old = [...(host.dataset.v || '')];
    const now = [...text];
    host.dataset.v = text;
    host.textContent = '';
    now.forEach((c, i) => {
      const cell = document.createElement('span');
      cell.className = 'ch';
      const g = c === ' ' ? ' ' : c;            /* a space collapses in a flex row */
      if (old[i] === c || old[i] === undefined || fast) {
        cell.innerHTML = '<i>' + g + '</i>';
      } else {
        const col = document.createElement('span');
        col.className = 'col';
        col.innerHTML = '<i>' + (old[i] === ' ' ? ' ' : old[i]) + '</i><i>' + g + '</i>';
        cell.appendChild(col);
        requestAnimationFrame(() => {
          col.style.transition = 'transform ' + C.rollMs + 'ms var(--ease-out) ' +
            (now.length - i) * C.stagger + 'ms';
          col.style.transform = 'translateY(-50%)';
        });
      }
      host.appendChild(cell);
    });
  }

  /* The box follows the digits: width is pinned, the new one measured, then
     eased between. Auto width cannot be transitioned on its own. */
  function write(label, got, spent) {
    if (pDay.dataset.v === label && pIn.dataset.v === got && pOut.dataset.v === spent) return;
    const from = pill.getBoundingClientRect().width;
    roll(pDay, label);
    roll(pIn, got);
    roll(pOut, spent);
    pill.style.width = 'auto';
    const to = pill.getBoundingClientRect().width;
    if (!from || Math.abs(to - from) < 0.5) { pill.style.width = ''; return; }
    pill.style.width = from + 'px';
    void pill.offsetWidth;
    pill.style.width = to + 'px';
  }

  /* At the live end you are looking at today, so the pill answers "today".
     One flick up and you are no longer reading a day, you are reading a
     month — so it zooms out. A day you tapped outranks both. */
  function paint() {
    if (!pill) return;
    const rows = [...card.querySelectorAll('.row[data-mm]:not(.is-folded)')];
    if (!rows.length || card.hidden) { pill.classList.add('is-hidden'); return; }

    const top = scroller.getBoundingClientRect().top + 44;
    let hit = null;
    for (const el of rows) {
      if (el.getBoundingClientRect().bottom >= top) { hit = el; break; }
    }
    if (!hit) hit = rows[rows.length - 1];
    pill.classList.remove('is-hidden');

    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
    const key = dayOf(new Date());
    const M = months.find((x) => x.mm === hit.dataset.mm);
    const todayIn = months.find((x) => x.days[key]);

    if (picked) {
      const owner = months.find((x) => x.days[picked]);
      if (owner) return show(picked, owner.days[picked]);
      picked = null;
    }
    if (atEnd && todayIn) return show(key, todayIn.days[key]);
    if (M) show(M.mm, M);
  }

  /* both figures, always — a day with nothing coming in still says +₹0, so
     the pill keeps one shape and the eye keeps one place to read */
  function show(label, o) {
    write(label, inTx(o.got || 0), outTx(o.spent || 0));
  }

  /* ---------- the api ---------- */

  const api = {
    mount(cardTarget, scrollTarget) {
      card = typeof cardTarget === 'string' ? document.querySelector(cardTarget) : cardTarget;
      scroller = typeof scrollTarget === 'string' ? document.querySelector(scrollTarget) : scrollTarget;
      if (!card || !scroller) return null;

      const style = document.createElement('style');
      style.id = 'months';
      style.textContent = css();
      document.head.appendChild(style);

      const wrap = document.createElement('div');
      wrap.className = 'm-pillwrap';
      wrap.innerHTML = '<div class="m-pill" role="status" aria-live="polite">' +
        '<b></b><span class="m-in"></span><span class="m-out"></span></div>';
      scroller.insertBefore(wrap, scroller.firstChild);
      pill = wrap.querySelector('.m-pill');
      pDay = pill.querySelector('b');
      pIn = pill.querySelector('.m-in');
      pOut = pill.querySelector('.m-out');

      /* tap a day number to pin that day; tap the pill to let it go */
      card.addEventListener('click', (e) => {
        const num = e.target.closest('.daynum');
        if (!num) return;
        const row = num.closest('.row');
        if (!row || !row.dataset.day) return;
        picked = picked === row.dataset.day ? null : row.dataset.day;
        pickedAt = scroller.scrollTop;
        paint();
      });
      pill.addEventListener('click', () => { picked = null; paint(); });

      scroller.addEventListener('scroll', () => {
        const now = performance.now();
        const dy = Math.abs(scroller.scrollTop - lastTop);
        fast = dy / Math.max(now - lastAt, 8) > C.fling;
        lastTop = scroller.scrollTop;
        lastAt = now;
        /* scrolling lets a picked day go: a nudge keeps it, a journey does not */
        if (picked && Math.abs(scroller.scrollTop - pickedAt) > C.letGo) picked = null;
        paint();
        clearTimeout(settleSeq);
        settleSeq = setTimeout(() => { fast = false; paint(); }, C.settleMs);
      }, { passive: true });

      /* money.js has already drawn the ledger by the time this runs, so the
         first pass happens here rather than waiting for the next render */
      api.sync();
      return api;
    },

    /* Called after every render: money.js rebuilds the card from scratch, so
       the bands are put back and the folds re-applied. */
    sync() {
      if (!card) return;
      for (const b of [...card.querySelectorAll('.m-band')]) b.remove();
      gather();
      const now = mmOf(new Date());
      let last = null;
      for (const row of [...card.querySelectorAll('.row[data-mm]')]) {
        if (row.dataset.mm === last) continue;
        last = row.dataset.mm;
        const M = months.find((x) => x.mm === last);
        card.insertBefore(band(M, last === now), row);
      }
      /* a month that has ended arrives shut, once — reopening it is the
         user's call and must survive the next render */
      for (const M of months) {
        if (M.mm !== now && !defaulted.has(M.mm)) shut.add(M.mm);
        defaulted.add(M.mm);
      }
      shut.delete(now);
      fold();
      lastTop = scroller.scrollTop;
      paint();
    },

    /* Re-tune live, the way mascot.js does. */
    set(patch) { Object.assign(C, patch); return Object.assign({}, C); },
    get config() { return Object.assign({}, C); },
  };

  return api;
})();
