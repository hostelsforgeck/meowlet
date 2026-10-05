/* ============================================================
   Greet — what a sheet says before it says anything else.

       Greet.say('Shah')     →  "Good morning, Shah"
       Greet.say()           →  "Good morning"
       Greet.band()          →  "morning"

   One file, no imports, nothing to undo but the line that loads it.

   THE CLOCK is the device's own, read at the moment of the call rather
   than at load: an app left open overnight must not still be saying good
   evening at six in the morning, and this is the whole reason the hour is
   not cached anywhere.

   THE BANDS are cut where people actually change what they are doing, not
   into equal sixths. 5 to 8 is its own thing — being up then is worth
   acknowledging — and so is past nine, which is when the ledger stops
   being admin and starts being the last thing before bed.

   NOTHING HERE READS THE MONEY. A greeting that knows your balance is an
   app with an opinion about your life, and the one surface that opens with
   a kind word is the last place to put a comment on your spending.
   ============================================================ */

window.Greet = (function () {
  'use strict';

  const C = {
    /* Pick once and KEEP it until the band turns over.

       Claude rolls its greeting once a session, and that is the right
       shape: a line that changes every time you open the same sheet is a
       line you start reading instead of glancing at, and the sheet behind
       it is what you came for. Re-rolling only on the band change means
       the variety lands where you would notice a repeat anyway — the
       first open of the evening — and nowhere else. */
    sticky: true,
  };

  /* The plain form appears twice in each pool and the variants once, so
     the ordinary greeting is what you get most of the time and the rest
     is seasoning. No weights table: the list IS the weighting.

     `Good night` sits only in the last band, where it reads as "you are
     still here at this hour" rather than as the farewell it usually is —
     at nine in the evening it would be telling you to leave. */
  const BANDS = [
    { id: 'late',      from: 0,
      says: ['Still up', 'Night owl', 'Late one', 'Still up'] },
    { id: 'early',     from: 5,
      says: ['Up early', 'Good morning', 'Early start', 'Up early'] },
    { id: 'morning',   from: 8,
      says: ['Good morning', 'Good morning', 'Morning', 'Good morning'] },
    { id: 'afternoon', from: 12,
      says: ['Good afternoon', 'Good afternoon', 'Afternoon', 'Good afternoon'] },
    { id: 'evening',   from: 17,
      says: ['Good evening', 'Good evening', 'Evening', 'Good evening'] },
    { id: 'night',     from: 21,
      says: ['Good night', 'Winding down', 'Good night', 'Late one'] },
  ];

  /* last in wins, so the bands are read from the back and the first one
     at or below the hour is the answer — no end times to keep in step */
  function bandAt(when) {
    const h = (when || new Date()).getHours();
    for (let i = BANDS.length - 1; i >= 0; i--) if (h >= BANDS[i].from) return BANDS[i];
    return BANDS[0];
  }

  let held = { id: null, line: '' };

  function line(when) {
    const B = bandAt(when);
    if (C.sticky && held.id === B.id) return held.line;
    const pick = B.says[Math.floor(Math.random() * B.says.length)];
    held = { id: B.id, line: pick };
    return pick;
  }

  return {
    /* The name is optional and the comma goes with it: a greeting with
       nowhere to put a name is a greeting, not a bug, and an app that has
       not been told who you are must never print `Good morning, `. */
    say(name, when) {
      const said = line(when);
      const who = (name || '').trim();
      return who ? said + ', ' + who : said;
    },

    band(when) { return bandAt(when).id; },

    /* the phrase alone, for anywhere the name is already on screen */
    phrase(when) { return line(when); },

    /* roll again without waiting for the hour — the bench needs it, and so
       would anything that wants a new line per open rather than per band */
    fresh() { held = { id: null, line: '' }; return this; },

    /* re-tune live, the way mascot.js and months.js do */
    set(patch) { Object.assign(C, patch); return Object.assign({}, C); },
    get config() { return Object.assign({}, C); },
    get bands() { return BANDS.map((b) => ({ id: b.id, from: b.from, says: b.says.slice() })); },
  };
})();
