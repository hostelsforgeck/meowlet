/* ============================================================
   Mascot — a cat that peeks over the edge of whatever you hang it in.

   Self-contained: shapes, stylesheet and behaviour. It knows nothing
   about the ledger, and the ledger needs two lines to use it:

       Mascot.mount('#plate');                  once
       Mascot.mood('in' | 'out' | 'tap');       when something happens

   The rest of the surface is for tuning and inspection:

       Mascot.set({ size: 70 })   re-tune any number below, live
       Mascot.config              read them back
       Mascot.wake() / .doze()    the inactivity state, forced either way
       Mascot.press(on, done)     held down; `done` fires when he covers the host

   On a desktop the eyes follow the pointer while it is near him, and let go
   when it is not. On touch they do not: there is nothing to follow.

   It dozes off after `dozeAfter` of nothing happening, and ONLY then: any
   interaction restarts that clock. It does not listen for taps itself — the
   host owns those and calls Mascot.poke().
       Mascot.hold(mood, secs)    freeze one moment, for looking at it
       Mascot.play()              undo a hold

   Every length is in reference pixels — the 643px space the rest of the
   app is measured in — and is multiplied by --u on the way out. The host
   needs `position: relative` and `overflow: hidden`; the crop is the
   host's edge, not ours, and that crop is the whole trick.
   ============================================================ */

window.Mascot = (function () {
  'use strict';

  /* ---------- the numbers worth arguing about ---------- */

  const C = {
    /* Placement. The cat is drawn TALLER than the gap it shows through and hung
       below the floor of its box, so the box's own overflow makes the crop.
       Rising reveals more of the head, ducking reveals less, and nothing ever
       redraws. */
    size:  78,          /* the HEAD's width; the drawing's box follows from it */
    hang:  21,          /* how far the chin sits below the floor — bigger = less face */
    edge: -13,          /* left offset; negative crops the cheek, as the reference does */
    tilt:  14,          /* the reference is a symmetric cat photographed at a tilt */
    gutter: 79,         /* room the host's own content gives up to the cat. It has to
                           clear the tilted head (which reaches 121 of the drawing's
                           120 units) plus whatever the mood rotations swing. */

    /* ---- idle ----
       Five layers on four periods that share no factors, so they never line up
       the same way twice. Regularity is the thing that makes an idle read as a
       looping GIF, and staggered periods are the cheapest way out of it. */

    breathMs: 4200, breathLift: 1,      /* breathing: a scale, not a float */
    swayMs: 9400,   swayBy: 1.2,        /* the tilt drifts, so the pose is held */
    irrMs: 17000,                       /* four blinks at uneven places, one a double */
    flickMs: 13000, flickBy: 5, flickDip: 0.1,   /* one ear at a time */
    dartMs: 11000,  dartBy: 1.3,        /* the eyes glance right, then left */
    lookBy: 9,                          /* how far the whole FACE turns to the number */

    /* ---- the gaze (desktop only) ----
       The eyes follow the pointer, but only inside a zone around his own face.
       Tracking the whole window means he is permanently staring at something,
       which is not watching — it is just a fixed squint in whatever direction
       the cursor happens to be parked.

       Two radii, in CSS pixels from the eye line. Inside `gazeNear` the swing
       grows with distance and tops out; from there to `gazeFar` it fades back to
       nothing. `gazeNear` is about the plate's own height, so he tracks you
       while you are over the balance; `gazeFar` is roughly the plate's width, so
       he has let go by the time you are reading the ledger. The fade is a
       smoothstep, because a hard edge makes the eyes snap home the moment you
       cross it. */
    gazeX: 4, gazeY: 2.5, gazeNear: 100, gazeFar: 210, gazeMs: 120,

    /* ---- asleep: which candidate ----
       0 is today's (nothing at all). 1-5 are the options being compared. */
    zzzMs: 5600,        /* the whole cycle: three z's AND the quiet after them */
    zzzBurst: 0.52,     /* how much of it the z's get; the rest is empty sky */
    zzzFrom: 98,        /* where they leave him, in drawing units */
    zzzRise: 30,        /* and how far up they get before they are gone */

    /* ---- doze ----
       After a while with nothing happening it goes under: the only behaviour
       here that makes the screen quieter the longer you leave it, which is the
       right instinct for a page whose job is a number. 0 turns it off. */
    dozeAfter: 45000, dozeMs: 1200, dozeSink: 3.5,

    /* Asleep he breathes DEEPER and slower than awake, not shallower — a body
       at rest has nothing else to do with its chest. `dozeSwell` is how much he
       widens on the inhale, `dozeLift` how far he rises with it, and the period
       is `breathMs` stretched by `dozeSlow`.

       These were a third of what they are now, and the sleep read as a still
       image: the crown of the head travelled about a pixel over five seconds,
       which is below the speed anything registers as motion at all. A breath
       nobody can see is not a subtle breath, it is a bug — so the travel went up
       and the period came down. `dozeSlow` is still above 1, so he is still
       breathing slower asleep than awake; he is just no longer slower than the
       eye. */
    dozeSwell: 0.05, dozeLift: 7, dozeSlow: 1.35,

    /* The ears ride the breath a beat behind the chest — follow-through, and the
       cheapest visibility on offer. A broad smooth edge creeping four pixels is
       something the eye smooths away; the TIP of a pointed ear crossing the same
       four pixels of empty sky is a corner moving against a background, which is
       the one kind of motion peripheral vision is actually built to catch.
       Degrees, about the foot each ear already pivots on. */
    dozeEar: 4.5,

    /* ---- being poked ---- */
    wakeMs: 420,

    /* ---- the long press ----
       Hold and he grows until he IS the sheet. Three numbers, and the reason
       for each:

       pressWait  Nothing may move before this: until it passes, the press is
                  still a tap. The first version used 160ms on the grounds that
                  taps land at 80-150ms — true of a quick tap, wrong for a
                  deliberate one, which runs 200-300ms. Ordinary taps were
                  crossing the line and starting the fill, and then releasing
                  counted as an abandoned hold, so the tap did nothing at all.
                  320 sits past any realistic tap. It is not dead air: the
                  plate's own press-dim answers the touch immediately, it is
                  just not a commitment yet.

       tapGrace   And a band past that. Let go in the first ${C.tapGrace}ms of the fill
                  and it still counts as a tap — he has barely moved and eases
                  straight back. Without it the boundary is a cliff: a press
                  one millisecond too long silently does nothing.

       holdMs     The fill. Both platforms put a long press at 500ms, and
                  progress you can SEE buys a little more patience than progress
                  you cannot — but only a little. 480 lands the whole gesture at
                  800ms: deliberate, not a wait.

       A five-second hold would be six times the platform convention. Long
       before then a person concludes the thing is broken and lets go. */
    pressWait: 320,
    tapGrace: 90,
    holdMs: 480,
    releaseMs: 300,     /* and how long the ease home takes if you let go early */
    coverBy: 7,         /* how far he grows: enough to leave no plate showing */
    buzz: true,         /* a tick when the fill engages, a firmer one when it commits */

    /* ---- moods ---- */
    inBy: 13, inMs: 1150,                        /* money in  */
    outFlinch: 5, outSink: 8, outMs: 1250,       /* money out */
    tapSwing: 3.2, tapJolt: 2, tapMs: 600,       /* poked: first swing, and the jolt */

    /* ---- being typed at ----
       The reaction while an amount is on the plate. Every number here was
       argued out in assets/mascot-input.html against the real geometry; the
       comments on what each one does are with the rules, in css().

       braceAt is the amount the tension tops out at. 5000 is not a limit,
       it is where the dial runs out: the plate takes four digits, so 9999
       lands past the top with a little of the scale left unspent, which is
       what keeps 900 from already looking like the worst day of the year. */
    braceAt: 5000,
    braceEar: 9, braceEye: 0.30, braceSink: 6,      /* the spend, on the dial */
    braceLook: 8, braceLift: 4, glanceMs: 760,      /* ...and the look up at it */
    upEye: 0.55, upGain: 1,                         /* the income */
    sparkMs: 820, sparkStep: 90,                    /* a star per digit */
    hopMs: 440, hopBy: 5,                           /* and a hop under it */

    fur:    '#ffffff',
    ink:    '#121212',  /* the cut-out colour: whatever is behind the cat */
    inkDim: '#1c1c1c'   /* ...and what that becomes while the host is pressed */
  };

  /* ---------- the shapes ----------

     Traced from assets/cat.png, not drawn by eye. The reference turned out to be one
     symmetric cat photographed at a 9.97 degree tilt — both its eyes are the
     same capsule, and its apparent lopsidedness is that tilt. So: un-rotate,
     measure, mirror, and put the tilt back as a transform.

     The head is an ellipse of 731.5 x 574 reference units — aspect 0.785, NOT a
     circle — fitted to the cheek and jaw at 0.53px RMS. The skull between the
     ears is very nearly flat, which is what the Q in BODY is.

     BODY and EAR are that outline cut into three pieces so an ear can move on
     its own: each ear's base runs well past where it meets the head, so what
     moves is only the tip. Body + two ears agrees with the reference on 98.5%
     of its pixels — the identical score the one-piece version got.

     CAT is the drawing's own box; VB is bigger, to leave the corners room to
     swing when the tilt turns. */

  const CAT = { w: 120, h: 109.25, cx: 60, cy: 54.63 };

  /* The viewBox is bigger than the drawing twice over: sideways, so the corners
     have room to swing when the tilt turns; and upward, so there is sky above
     his ears for anything that rises out of him. The top and the height move
     together, which keeps (y + h) — the distance from the drawing to the bottom
     of the box — the same, so hanging him in the host does not change. */
  const SKY = 40;
  const VB  = { x: -11.44, y: -12.89 - SKY, w: 142.87, h: 135.03 + SKY };

  /* He turns about a point low in the head. Held in the drawing's own
     coordinates and converted below, because a percentage of the BOX would
     quietly move the pivot every time the box changed size. */
  const PIVOT = { x: 60, y: 92.43 };

  const BODY = 'M48.19 15.99A60 47.08 0 1 0 71.81 15.99Q60 15.83 48.19 15.99Z';

  const EAR = 'M23.83 0C23.34 0.1 22.08 -0.03 20.87 0.57C19.67 1.18 17.65 2.28 16.61 3.61C15.57 4.94 15.16 6.48 14.64 8.53C14.12 10.58 13.78 13.59 13.49 15.91C13.21 18.24 13.1 20.15 12.92 22.47C12.74 24.8 12.78 27.81 12.43 29.86C12.07 31.91 11.45 33.41 10.79 34.78C10.13 36.14 8.85 37.51 8.47 38.06L14.31 41.34L43.84 22.47L48.19 15.99C47.64 15.57 46.47 14.7 44.91 13.45C43.35 12.21 40.98 10.17 38.84 8.53C36.69 6.89 33.96 4.94 32.03 3.61C30.1 2.28 28.56 1.18 27.27 0.57C25.99 -0.03 24.81 0.1 24.32 0A.4 .4 0 0 1 23.83 0Z';

  /* A four-point star drawn around its own origin, so the wrapper places it
     and the scale finds its middle. */
  const STAR = 'M0 -5C.6 -1.6 1.6 -.6 5 0C1.6 .6 .6 1.6 0 5C-.6 1.6 -1.6 .6 -5 0C-1.6 -.6 -.6 -1.6 0 -5Z';

  const SVG = [
    '<g class="m-tilt">',
    '  <path class="m-body" d="' + BODY + '" />',
    '  <path class="m-ear m-ear-l" d="' + EAR + '" />',
    /* the right ear is the left one mirrored by its wrapper, so BOTH ears flick
       with the same negative angle — the direction that tucks the ear's buried
       base deeper into the head instead of poking a bump out of the cheek. */
    '  <g transform="translate(120,0) scale(-1,1)">',
    '    <path class="m-ear m-ear-r" d="' + EAR + '" />',
    '  </g>',
    /* both eyes are the same capsule — measured 103 x 178, i.e. 8.45 x 14.6 here.
       They are grouped so a glance can move the pair while each eye keeps its
       own blink: two animations cannot share one transform. */
    /* m-look is every feature on the face. Sliding the whole set sideways is
       how flat 2D art fakes a head turning — moving the eyes alone at this size
       is a couple of pixels and reads as nothing at all. m-eyes nests inside it
       so a glance can still move just the eyes. */
    '  <g class="m-look">',
    /* m-gaze is the cursor follower, and it wraps ONLY the eyes: the nose stays
       with m-look. It needs a layer to itself because m-look and m-eyes are both
       driven by keyframes, and a running animation beats an inline transform —
       the gaze would simply be ignored on any element that is already animating. */
    '    <g class="m-gaze">',
    '    <g class="m-eyes">',
    '      <rect class="m-eye" x="36.09" y="50.12" width="8.45" height="14.6" rx="4.22" />',
    '      <rect class="m-eye" x="75.47" y="50.12" width="8.45" height="14.6" rx="4.22" />',
    /* the smile lives in the same group as the eyes it replaces, so a glance
       carries it along instead of leaving it behind on the face */
    '      <path class="m-joy" d="M36.1 61.3Q40.31 51.6 44.54 61.3" />',
    '      <path class="m-joy" d="M75.47 61.3Q79.69 51.6 83.91 61.3" />',
    /* A catchlight per eye, for money coming in. Both sit up and to the LEFT
       of their pupil, because two dots on opposite sides are two light
       sources and the face stops reading as one face. */
    '      <circle class="m-glint g-l" cx="39" cy="54.1" r="1.5" />',
    '      <circle class="m-glint g-r" cx="78.4" cy="54.1" r="1.5" />',
    '    </g>',
    '    </g>',
    '    <ellipse class="m-nose" cx="60" cy="67.75" rx="4.88" ry="3.53" />',
    '  </g>',
    '</g>',
    /* asleep. Outside m-tilt so these rise straight up rather than leaning with
       his head, which is what a z does. All drawn around the origin so a scale
       finds its own middle and a translate can fly it anywhere. */
    '<g class="m-zzz">',
    '  <path class="m-z m-z1" d="M-4.5 -4.5H4.5L-4.5 4.5H4.5" />',
    '  <path class="m-z m-z2" d="M-4.5 -4.5H4.5L-4.5 4.5H4.5" />',
    '  <path class="m-z m-z3" d="M-4.5 -4.5H4.5L-4.5 4.5H4.5" />',
    '</g>',
    /* Four stars, in the same strip of sky the z-s fly through — so they are
       known to be visible above his ears and known to clear the figure. Each
       is wrapped in its own g: the translate lives on the wrapper, which
       leaves the star's own transform free for the animation. */
    '<g transform="translate(98,-4) scale(1.4)"><path class="m-spark s1" d="' + STAR + '" /></g>',
    '<g transform="translate(116,-18) scale(1.15)"><path class="m-spark s2" d="' + STAR + '" /></g>',
    '<g transform="translate(79,-25) scale(1)"><path class="m-spark s3" d="' + STAR + '" /></g>',
    '<g transform="translate(58,-14) scale(.85)"><path class="m-spark s4" d="' + STAR + '" /></g>'
  ].join('\n');

  /* ---------- the stylesheet ----------

     Carried here rather than in a .css file so the mascot stays one movable
     piece. u() writes a length in reference pixels; box() turns a length in
     drawing units into one. */

  const u = (n) => 'calc(' + n + ' * var(--u))';

  /* A point inside the z burst, as a percentage of the whole cycle: zAt(1) is
     the moment the last z is gone and the quiet begins. */
  const zAt = (f) => (f * C.zzzBurst * 100).toFixed(2) + '%';
  const box = (n) => C.size * n / CAT.w;

  function css() {
    /* The chin is not the bottom of the element — the viewBox leaves room below
       it for the tilt to swing into. Hang the element low enough that the CHIN
       lands where hang asks. */
    const belowChin = box(VB.h + VB.y - CAT.h);

    /* The sleeping breath's period. Named because the ears have to ride the
       same clock as the chest — two literals that drift apart under the knobs
       would read as two separate animals. */
    const dozeCycle = Math.round(C.breathMs * C.dozeSlow);

    return `
/* The host gives up a corner; whatever it centres re-centres in what is left. */
.m-host .pl-layer { padding-left: ${u(C.gutter)}; padding-right: ${u(14)}; }

.m-cat {
  position: absolute;
  left: ${u(C.edge)};
  bottom: ${u(-(C.hang + belowChin))};
  width: ${u(box(VB.w))};
  height: ${u(box(VB.h))};
  transform-origin: ${(((PIVOT.x - VB.x) / VB.w) * 100).toFixed(3)}% ${(((PIVOT.y - VB.y) / VB.h) * 100).toFixed(3)}%;
  pointer-events: none;                /* the empty corners of the box stay the host's */
}


.m-cat .m-body, .m-cat .m-ear { fill: ${C.fur}; }

/* Both ears pivot at the ear's own FOOT — the corner where its inner edge meets
   the skull — and never anywhere else.

   That corner sits ON the head's outline, so any pivot above it drags the foot
   off the crown and opens a black spike at the join: the ear reads as snapped
   off. Pivoting at the foot nails it down, and then rotation and scale in
   either direction are both safe. It is the same point in each ear's own
   bounding box, which is why the mirrored one needs no special-casing. */
.m-cat .m-ear { transform-box: fill-box; transform-origin: 100% 38.7%; }

.m-cat .m-eye, .m-cat .m-nose {
  fill: ${C.ink};
  transition: fill .16s var(--ease-out);   /* rides along with the host's press-dim */
}
.m-host:active .m-cat .m-eye, .m-host:active .m-cat .m-nose { fill: ${C.inkDim}; }

/* A capsule can only ever flatten, and a flat eye reads as asleep rather than
   as pleased — so money in swaps the two capsules for two arcs. */
.m-cat .m-joy {
  fill: none;
  stroke: ${C.ink};
  stroke-width: 3.4;
  stroke-linecap: round;
  opacity: 0;
  transition: stroke .16s var(--ease-out);
}
.m-host:active .m-cat .m-joy { stroke: ${C.inkDim}; }

.m-cat .m-eye {
  transform-box: fill-box;             /* so a squint scales about the eye, not the canvas */
  transform-origin: center;
}

/* the gaze eases to each new target instead of snapping to the pointer, which
   is what keeps it from looking twitchy on small mouse movements */
.m-cat .m-gaze { transition: transform ${C.gazeMs}ms var(--ease-out); }

/* ========== idle ==========
   Five layers, four periods, no shared factors. Every keyframe below starts and
   ends neutral, which is also what makes them safe under reduced motion: the
   global rule collapses them to a single frame and the cat simply sits still. */

/* breathing. Translate reads as hovering; scale reads as volume, which is what
   breathing is — it widens a little as it flattens. */
.m-cat { animation: m-breathe ${C.breathMs}ms var(--ease-out) infinite; }
@keyframes m-breathe {
  0%, 100% { transform: translateY(0) scale(1); }
  50%      { transform: translateY(${u(-C.breathLift)}) scale(1.008, 0.994); }
}

/* the reference's tilt, drifting, so the pose is being held rather than frozen.
   Its own transform, so every mood composes with it instead of fighting it. */
.m-cat .m-tilt {
  transform: rotate(${C.tilt}deg);
  transform-origin: ${CAT.cx}px ${CAT.cy}px;
  animation: m-sway ${C.swayMs}ms var(--ease-out) infinite;
}
@keyframes m-sway {
  0%, 100% { transform: rotate(${C.tilt - C.swayBy}deg); }
  50%      { transform: rotate(${C.tilt + C.swayBy}deg); }
}

/* blinks at uneven places, one of them a double. Written as shares of the loop,
   so each blink is about ${Math.round(C.irrMs * 0.006)}ms shut — a cat's slow blink. */
.m-cat .m-eye { animation: m-blink ${C.irrMs}ms var(--ease-out) infinite; }
@keyframes m-blink {
  0%, 10.4%  { transform: scaleY(1); }
  11%        { transform: scaleY(.08); }
  12%, 28.4% { transform: scaleY(1); }
  29%        { transform: scaleY(.08); }
  30%, 33.4% { transform: scaleY(1); }   /* the second half of a double blink */
  34%        { transform: scaleY(.08); }
  35%, 70.4% { transform: scaleY(1); }
  71%        { transform: scaleY(.08); }
  72%, 100%  { transform: scaleY(1); }
}

/* one ear at a time, the two half a cycle apart so they never go together.

   A small rotation PLUS a slight squash, not a big rotation: rotating far
   enough to read on its own drags the ear's inner edge across the notch and
   tears it open into a gash, while shrinking the ear pulls it away from the
   notch — which is also what a real ear does as it turns and foreshortens. */
.m-cat .m-ear-l { animation: m-flick ${C.flickMs}ms var(--ease-out) infinite; }
.m-cat .m-ear-r { animation: m-flick ${C.flickMs}ms var(--ease-out) ${-Math.round(C.flickMs / 2)}ms infinite; }
@keyframes m-flick {
  0%, 22%   { transform: rotate(0deg) scaleY(1); }
  23%       { transform: rotate(${-C.flickBy}deg) scaleY(${1 - C.flickDip}); }
  25%, 100% { transform: rotate(0deg) scaleY(1); }
}

/* the glance. A sticker has eyes; a character has attention. */
.m-cat .m-eyes { animation: m-dart ${C.dartMs}ms var(--ease-out) infinite; }
@keyframes m-dart {
  0%, 26%   { transform: translateX(0); }
  29%, 36%  { transform: translateX(${C.dartBy}px); }
  40%, 62%  { transform: translateX(0); }
  65%, 70%  { transform: translateX(${-C.dartBy * 0.85}px); }
  74%, 100% { transform: translateX(0); }
}

/* ========== doze ==========
   Everything stops but the breathing, which deepens and slows.

   Two animations on one element, and the order is load-bearing: both write the
   transform property, and the later one in the list wins for as long as it is
   running. m-doze-in holds the sunk pose with fill-mode forwards, and m-doze
   takes it over the moment its delay is up. */
.m-cat.is-doze {
  animation: m-doze-in ${C.dozeMs}ms var(--ease-out) forwards,
             m-doze ${dozeCycle}ms ease-in-out ${C.dozeMs}ms infinite;
}
@keyframes m-doze-in { to { transform: translateY(${u(C.dozeSink)}) scale(1); } }

/* The inhale takes longer than the exhale, which is what makes it read as
   breathing rather than pulsing: 55% up, 45% back, and ease-in-out at both ends
   so there is no corner at the turn.

   He gets TALLER on the inhale as well as wider. The first pass widened and
   flattened him — the squash of a real chest — and it was self-defeating at this
   crop: the flatten pulled the crown of the head back down by most of what the
   lift had just raised it, and the crown is the only part of him standing
   against open background, so it is the only part there is to watch. Swelling
   in both directions puts the two together instead, and the crown travels the
   lift PLUS the stretch. */
@keyframes m-doze {
  0%   { transform: translateY(${u(C.dozeSink)}) scale(1, 1); }
  55%  { transform: translateY(${u(C.dozeSink - C.dozeLift)})
                    scale(${(1 + C.dozeSwell).toFixed(4)}, ${(1 + C.dozeSwell * 0.45).toFixed(4)}); }
  100% { transform: translateY(${u(C.dozeSink)}) scale(1, 1); }
}
.m-cat.is-doze .m-eye { animation: m-doze-eyes ${C.dozeMs}ms var(--ease-out) forwards; }
@keyframes m-doze-eyes { to { transform: scaleY(.08); } }
.m-cat.is-doze .m-eyes { animation: none; }

/* The ears lag the chest by a twelfth of a cycle, so the breath reaches the top
   of him last. Rotation only, about the foot they already pivot on — no scale,
   because the flick's squash is there to pull the ear clear of its notch and
   there is nothing here it needs pulling clear of. */
.m-cat.is-doze .m-ear-l,
.m-cat.is-doze .m-ear-r {
  animation: m-doze-ear ${dozeCycle}ms ease-in-out ${C.dozeMs + Math.round(dozeCycle / 12)}ms infinite;
}
@keyframes m-doze-ear {
  0%   { transform: rotate(0deg); }
  55%  { transform: rotate(${-C.dozeEar}deg); }
  100% { transform: rotate(0deg); }
}
.m-cat.is-doze .m-tilt  { animation: none; transform: rotate(${C.tilt}deg); }

/* springing awake: it starts from the dozed pose, so it only ever plays from
   there — poking an already-awake cat gets the tap mood instead. */
.m-cat.is-wake { animation: m-wake ${C.wakeMs}ms var(--ease-spring); }
@keyframes m-wake {
  0%   { transform: translateY(${u(C.dozeSink)}) scale(1); }
  35%  { transform: translateY(${u(-4)}) scale(1.02, 0.98); }
  65%  { transform: translateY(${u(-1)}) scale(1); }
  100% { transform: translateY(0) scale(1); }
}
.m-cat.is-wake .m-eye { animation: m-pop ${C.wakeMs}ms var(--ease-spring); }
@keyframes m-pop {
  0%   { transform: scaleY(.08); }
  45%  { transform: scaleY(1.15); }
  100% { transform: scaleY(1); }
}

/* ========== the moods ==========
   Declared last on purpose: a mood class and an idle rule have the same
   specificity, so source order is what lets a mood take the wheel. */

/* ========== asleep ==========
   Three z's drift up, all three go, and then nothing happens for a while.

   The silence is the point. A z leaving as the next arrives is a conveyor belt:
   it never starts and never finishes, so after two seconds your eye files it as
   texture and stops seeing it. A burst has a shape — they arrive, they go, the
   sky is empty — and an empty sky is what makes the next one read as new.

   zzzBurst is how much of the cycle the z's get; the rest of it is quiet. At
   ${C.zzzMs}ms and ${C.zzzBurst}, that is ${Math.round(C.zzzMs * C.zzzBurst)}ms of z
   and ${Math.round(C.zzzMs * (1 - C.zzzBurst))}ms of nothing.

   None of the three flies the same path — each has its own drift, height and
   size. Three identical z's on a stagger still read as machinery no matter how
   long the gap is. */

.m-cat .m-z {
  fill: none;
  stroke: ${C.fur};
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0;
}
.m-cat.is-doze .m-z1 { animation: m-z-a ${C.zzzMs}ms ease-out infinite; }
.m-cat.is-doze .m-z2 { animation: m-z-b ${C.zzzMs}ms ease-out infinite; }
.m-cat.is-doze .m-z3 { animation: m-z-c ${C.zzzMs}ms ease-out infinite; }

@keyframes m-z-a {
  0%                    { transform: translate(${C.zzzFrom}px, 5px) scale(.55); opacity: 0; }
  ${zAt(0.06)}          { opacity: .9; }
  ${zAt(0.5)}           { opacity: .5; }
  ${zAt(0.68)}, 100%    { transform: translate(${C.zzzFrom + 15}px, ${-C.zzzRise}px) scale(1); opacity: 0; }
}
@keyframes m-z-b {
  0%, ${zAt(0.16)}      { transform: translate(${C.zzzFrom + 6}px, 7px) scale(.46); opacity: 0; }
  ${zAt(0.23)}          { opacity: .9; }
  ${zAt(0.68)}          { opacity: .45; }
  ${zAt(0.84)}, 100%    { transform: translate(${C.zzzFrom + 27}px, ${(-C.zzzRise * 1.16).toFixed(1)}px) scale(1.15); opacity: 0; }
}
@keyframes m-z-c {
  0%, ${zAt(0.32)}      { transform: translate(${C.zzzFrom - 4}px, 3px) scale(.62); opacity: 0; }
  ${zAt(0.39)}          { opacity: .85; }
  ${zAt(0.85)}          { opacity: .4; }
  ${zAt(1)}, 100%       { transform: translate(${C.zzzFrom + 7}px, ${(-C.zzzRise * 0.86).toFixed(1)}px) scale(.9); opacity: 0; }
}


/* ========== the long press: he grows until he IS the sheet ==========

   The press does not put a meter on screen and then hand over to a panel that
   arrives from nowhere. He expands, the plate fills with him, and the sheet
   opens behind a screen that is already solid white. The progress indicator and
   the transition are the same object.

   Built on TRANSITIONS, not keyframes, and that is the whole reason it works:
   a hold can be let go at any millisecond, and a transition interrupts from
   wherever it had got to. An animation would have to snap back to its start.

   The breathing has to be switched off while this runs — an animation beats a
   transition on the same property, and the idle would simply eat the growth. */

/* ========== the long press ==========
   He grows until he IS the sheet: the progress and the transition are one
   object, and by the time You opens the screen is already solid white.

   The growth is driven from JavaScript, not from a CSS transition, and that is
   not a preference. A transition here was created and then sat at currentTime 0
   forever — never advancing, then resolving to the end value in a single jump.
   Transitions have too many ways to not start: the property has to be declared
   before the value changes, nothing may be animating it, and the element must
   not be waiting on the compositor. An animation object has none of those
   conditions. It also gives an exact finish to hang the callback on, and can be
   reversed from wherever it had got to.

   All CSS has to do is keep the idle breathing out of the way while it runs. */
.m-cat.is-press { animation: none; }


/* money in — the one that won the comparison: a crouch before the leap, the
   body stretching up and squashing on the landing, the ears leading it and
   letting go after, and the whole face turning to look at the figure while it
   rolls. Four things on one timeline, none of them moving in lockstep. */
.m-cat.is-in { animation: m-in ${C.inMs}ms var(--ease-out); }
@keyframes m-in {
  0%   { transform: translateY(0) scale(1, 1) rotate(0deg); }
  9%   { transform: translateY(${u(3.5)}) scale(1.04, .96) rotate(1deg); }   /* crouch */
  22%  { transform: translateY(${u(-C.inBy * 0.65)}) scale(.96, 1.07) rotate(-4deg); }
  36%  { transform: translateY(${u(-C.inBy)}) scale(1, 1) rotate(-5deg); }
  58%  { transform: translateY(0) scale(1.07, .94) rotate(1deg); }           /* lands */
  74%  { transform: translateY(${u(-C.inBy * 0.32)}) scale(1, 1) rotate(-1.5deg); }
  90%  { transform: translateY(0) scale(1.02, .98) rotate(0deg); }
  100% { transform: translateY(0) scale(1, 1) rotate(0deg); }
}

/* the ears start before the head and let go after it */
.m-cat.is-in .m-ear-l,
.m-cat.is-in .m-ear-r { animation: m-in-ears ${C.inMs}ms var(--ease-out); }
@keyframes m-in-ears {
  0%   { transform: rotate(0deg) scaleY(1); }
  14%  { transform: rotate(-5deg) scaleY(1.25); }
  62%  { transform: rotate(-4deg) scaleY(1.2); }
  100% { transform: rotate(0deg) scaleY(1); }
}

/* the whole face slides toward the figure — every feature together, which is
   how flat drawing fakes a head turning. Moving the eyes alone at this size is
   a pixel and a half and reads as nothing. */
.m-cat.is-in .m-look { animation: m-in-look ${C.inMs}ms var(--ease-out); }
@keyframes m-in-look {
  0%        { transform: translateX(0); }
  22%, 62%  { transform: translateX(${C.lookBy}px); }
  85%, 100% { transform: translateX(0); }
}
/* and the eyes go a little further still, so they arrive first and leave last */
.m-cat.is-in .m-eyes { animation: m-in-glance ${C.inMs}ms var(--ease-out); }
@keyframes m-in-glance {
  0%        { transform: translateX(0); }
  18%, 66%  { transform: translateX(${(C.lookBy * 0.28).toFixed(2)}px); }
  82%, 100% { transform: translateX(0); }
}

/* A capsule can only flatten, and a flat eye reads as asleep rather than as
   pleased — so the two capsules swap for two arcs. Quick enough at either end
   to read as a blink into a smile. */
.m-cat.is-in .m-eye { animation: m-shut ${C.inMs}ms var(--ease-out); }
.m-cat.is-in .m-joy { animation: m-joy  ${C.inMs}ms var(--ease-out); }
@keyframes m-shut {
  0%, 10% { opacity: 1; } 16%, 72% { opacity: 0; } 80%, 100% { opacity: 1; }
}
@keyframes m-joy {
  0%, 10% { opacity: 0; } 16%, 72% { opacity: 1; } 80%, 100% { opacity: 0; }
}


/* money out — ears back and the face turned off the number.

   He does NOT duck out of sight. Hiding was the obvious idea and it is the
   wrong one twice over: it costs you the mascot at the moment you are looking
   at the plate, and it buries the two things this reaction is actually made of
   — ears and an averted face are no use under the edge. So he only settles, and
   holds the pose long enough to be read.

   Spending is four entries in five, so this is the reaction seen most. Nothing
   here shouts. */
.m-cat.is-out { animation: m-out ${C.outMs}ms var(--ease-out); }
@keyframes m-out {
  0%       { transform: translateY(0) rotate(0deg); }
  10%      { transform: translateY(${u(-C.outFlinch * 0.7)}) rotate(0deg); }  /* flinch */
  30%, 66% { transform: translateY(${u(C.outSink)}) rotate(2deg); }           /* settles, and holds */
  88%      { transform: translateY(${u(C.outSink * 0.25)}) rotate(1deg); }
  100%     { transform: translateY(0) rotate(0deg); }
}

/* ears back — what a real cat does when it dislikes something */
.m-cat.is-out .m-ear-l,
.m-cat.is-out .m-ear-r { animation: m-out-ears ${C.outMs}ms var(--ease-out); }
@keyframes m-out-ears {
  0%   { transform: rotate(0deg) scaleY(1); }
  16%  { transform: rotate(-7deg) scaleY(.74); }
  70%  { transform: rotate(-6deg) scaleY(.78); }
  100% { transform: rotate(0deg) scaleY(1); }
}

/* the face turns off the number — the exact mirror of money in, which turns
   toward it. Held through the settle, and straightened only on the way home. */
.m-cat.is-out .m-look { animation: m-out-look ${C.outMs}ms var(--ease-out); }
@keyframes m-out-look {
  0%       { transform: translateX(0); }
  20%, 74% { transform: translateX(${(-C.lookBy * 0.9).toFixed(2)}px); }
  100%     { transform: translateX(0); }
}

/* the eyes widen on the flinch and are back to normal before he sinks */
.m-cat.is-out .m-eye { animation: m-wide ${C.outMs}ms var(--ease-out); }
@keyframes m-wide {
  0%, 100% { transform: scale(1); }
  8%, 28%  { transform: scaleY(1.22) scaleX(1.14); }
}

/* tap — poked, and everything on him wobbles.

   Three ideas, none of them loud:

   1. It DAMPS. Each swing is a bit over half the last one (${C.tapSwing} degrees,
      then .62, .34, .16 of it) so it dies away instead of stopping dead. A
      wobble that ends abruptly reads as a glitch.
   2. It OVERLAPS. The body peaks first, the ears a beat later, the face later
      still — soft things attached to a moving body arrive late and carry on
      after it has stopped. Everything moving in lockstep is what makes a
      drawing read as one rigid sticker.
   3. Every segment eases in AND out, so the direction changes are round.
      A front-loaded ease makes each swing snap, which is the opposite of soft.

   The ears still only swing NEGATIVE — that is the direction that tucks their
   hidden base deeper into the head rather than poking a bump out of the cheek.
   The magnitude is free now that they pivot at the foot. */
.m-cat.is-tap { animation: m-tap ${C.tapMs}ms ease-in-out; }
@keyframes m-tap {
  0%   { transform: translateY(0) rotate(0deg) scale(1, 1); }
  12%  { transform: translateY(${u(C.tapJolt)}) rotate(${-C.tapSwing}deg) scale(1.03, .97); }
  32%  { transform: translateY(${u(-C.tapJolt * 0.35)}) rotate(${(C.tapSwing * 0.62).toFixed(2)}deg) scale(.99, 1.01); }
  54%  { transform: translateY(0) rotate(${(-C.tapSwing * 0.34).toFixed(2)}deg) scale(1, 1); }
  76%  { transform: translateY(0) rotate(${(C.tapSwing * 0.16).toFixed(2)}deg) scale(1, 1); }
  100% { transform: translateY(0) rotate(0deg) scale(1, 1); }
}

/* the ears flop a beat behind the body and are still going when it has settled */
.m-cat.is-tap .m-ear-l,
.m-cat.is-tap .m-ear-r { animation: m-tap-ears ${C.tapMs}ms ease-in-out; }
.m-cat.is-tap .m-ear-r { animation-delay: 32ms; }   /* and not both at once */
@keyframes m-tap-ears {
  0%   { transform: rotate(0deg) scaleY(1); }
  18%  { transform: rotate(${-C.tapSwing * 2.1}deg) scaleY(.94); }
  42%  { transform: rotate(${(-C.tapSwing * 0.25).toFixed(2)}deg) scaleY(1); }
  64%  { transform: rotate(${(-C.tapSwing * 1).toFixed(2)}deg) scaleY(.98); }
  84%  { transform: rotate(${(-C.tapSwing * 0.2).toFixed(2)}deg) scaleY(1); }
  100% { transform: rotate(0deg) scaleY(1); }
}

/* the whole face — eyes and nose together — lags the other way, the way loose
   things trail a body that has just been shoved */
.m-cat.is-tap .m-look { animation: m-tap-look ${C.tapMs}ms ease-in-out; }
@keyframes m-tap-look {
  0%   { transform: translateX(0); }
  18%  { transform: translateX(${(C.tapSwing * 0.8).toFixed(2)}px); }
  44%  { transform: translateX(${(-C.tapSwing * 0.45).toFixed(2)}px); }
  70%  { transform: translateX(${(C.tapSwing * 0.18).toFixed(2)}px); }
  100% { transform: translateX(0); }
}

/* and the eyes drift a fraction further again, so the face itself is not rigid */
.m-cat.is-tap .m-eyes { animation: m-tap-eyes ${C.tapMs}ms ease-in-out; }
@keyframes m-tap-eyes {
  0%, 100% { transform: translateX(0); }
  24%      { transform: translateX(${(C.tapSwing * 0.3).toFixed(2)}px); }
  52%      { transform: translateX(${(-C.tapSwing * 0.16).toFixed(2)}px); }
}

/* a half-squint on the impact itself — not a blink, just a flinch */
.m-cat.is-tap .m-eye { animation: m-tap-eye ${C.tapMs}ms ease-in-out; }
@keyframes m-tap-eye {
  0%, 100% { transform: scaleY(1); }
  12%      { transform: scaleY(.72) scaleX(1.06); }
  36%      { transform: scaleY(1.03); }
  62%      { transform: scaleY(.98); }
}

/* ========== being typed at ==========

   What he does WHILE an amount is on the plate. Everything below reads one
   number, --tense, which the host's digits set: 0 for nothing typed, 1 at
   ${C.braceAt}. Log, not linear — the step from 50 to 500 matters far more
   than the one from 9,000 to 9,500, and a linear dial spends almost all of
   its travel on amounts nobody types.

   The idle is five layers on four periods, all of them animations, and an
   inline transform loses to a running animation every time. So every rule
   here first stops the part it poses. That also means the pose has to yield
   to sleep, or a dozing cat wears a wide-awake face under his own z's —
   hence :not(.is-doze) on every one of them. */

.m-cat.is-brace:not(.is-doze) .m-ear-l,
.m-cat.is-brace:not(.is-doze) .m-ear-r {
  animation: none !important;
  transition: transform .18s var(--ease-out);
  transform: rotate(calc(var(--tense, 0) * ${-C.braceEar}deg))
             scaleY(calc(1 - var(--tense, 0) * .24));
}
.m-cat.is-brace:not(.is-doze) .m-eye {
  animation: none !important;
  transition: transform .18s var(--ease-out);
  transform: scaleY(calc(1 + var(--tense, 0) * ${C.braceEye}))
             scaleX(calc(1 + var(--tense, 0) * ${(C.braceEye * 0.6).toFixed(3)}));
}
.m-cat.is-brace:not(.is-doze) {
  animation: none !important;
  transition: transform .18s var(--ease-out);
  transform: translateY(calc(var(--tense, 0) * ${C.braceSink}px));
}

/* ---- money out: he checks the figure, then checks you ----

   Not a held turn: a pose that faces away reads as sulking, and at four
   digits he would show you a cheek for as long as you were typing. The
   figure sits ABOVE his eyeline as well as beside it — his eyes are about
   13 reference px off the floor of the plate and the digits are centred at
   36 — so the look goes up as well as across, or it passes them by.

   m-look is the whole face, because at this size moving the eyes alone is
   two pixels and reads as nothing; the eyes then carry a little further, the
   way a head turns and the eyes finish the turn. Facing you is the resting
   state, so coming back costs nothing to say: it is where it ends. */
.m-cat.is-brace:not(.is-doze).is-glance .m-look {
  animation: m-glance ${C.glanceMs}ms var(--ease-out);
}
.m-cat.is-brace:not(.is-doze).is-glance .m-eyes {
  animation: m-glance-eyes ${C.glanceMs}ms var(--ease-out);
}
@keyframes m-glance {
  0%       { transform: translate(0, 0); }
  32%, 60% { transform: translate(${C.braceLook}px, ${-C.braceLift}px); }
  100%     { transform: translate(0, 0); }
}
@keyframes m-glance-eyes {
  0%       { transform: translate(0, 0); }
  32%, 60% { transform: translate(${(C.braceLook * 0.4).toFixed(2)}px, ${(-C.braceLift * 0.4).toFixed(2)}px); }
  100%     { transform: translate(0, 0); }
}

/* ---- money in ----
   The ears and the head stay out of it: a cat braced AND delighted is a cat
   with two feelings. */
.m-cat.is-brace:not(.is-doze).is-up .m-ear-l,
.m-cat.is-brace:not(.is-doze).is-up .m-ear-r { transform: none; }

/* the eyes · pupils blow open, and a catchlight comes up in each. Both dots
   sit on the same side of their eye: one light source, not two. The dot
   rides the same growth as the eye it sits in, so it stays put on the curve
   instead of sliding off it. */
.m-cat .m-glint {
  fill: ${C.fur};
  opacity: 0;
  transform-box: view-box;
  transition: transform .18s var(--ease-out), opacity .18s linear;
}
.m-cat .m-glint.g-l { transform-origin: 40.315px 57.42px; }   /* its eye's centre */
.m-cat .m-glint.g-r { transform-origin: 79.695px 57.42px; }
.m-cat.is-brace:not(.is-doze).is-up .m-eye,
.m-cat.is-brace:not(.is-doze).is-up .m-glint {
  transform: scaleX(calc(1 + var(--tense, 0) * ${C.upEye}))
             scaleY(calc(1 + var(--tense, 0) * ${(C.upEye * 0.6).toFixed(3)}));
}
.m-cat.is-brace:not(.is-doze).is-up .m-glint { opacity: var(--tense, 0); }

/* the sky · one star per DIGIT, fired once as that digit lands, and then
   gone. Not a loop: a twinkle that keeps going is weather, and weather is
   what the eye files as texture and stops seeing inside two seconds. A burst
   arrives and leaves, which is what lets it arrive again. They come in order
   rather than together — four at once is one flash, four in a cascade is a
   count you can read without counting. Which stars light is decided in JS,
   because CSS cannot compare a count to an index without ten selectors that
   all say the same thing. */
.m-cat .m-spark { fill: ${C.fur}; opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; }
.m-cat.is-brace:not(.is-doze).is-up.is-pop .m-spark.is-lit {
  animation: m-spark ${C.sparkMs}ms var(--ease-out);
}
.m-cat .m-spark.s2 { animation-delay: ${C.sparkStep}ms; }
.m-cat .m-spark.s3 { animation-delay: ${C.sparkStep * 2}ms; }
.m-cat .m-spark.s4 { animation-delay: ${C.sparkStep * 3}ms; }
@keyframes m-spark {
  0%   { transform: scale(0)    rotate(-40deg); opacity: 0; }
  30%  { transform: scale(1.12) rotate(0deg);   opacity: 1; }
  58%  { transform: scale(1)    rotate(6deg);   opacity: 1; }
  100% { transform: scale(.2)   rotate(18deg);  opacity: 0; }
}

/* the step · he moves toward the figure. He is cropped at the left edge, so
   moving right gives back cheek he did not have: he reads as coming closer
   rather than sliding. Held as --leanX/--leanY because the hop has to carry
   the same step inside its own keyframes. */
.m-cat.is-brace:not(.is-doze).is-up {
  transition: transform .22s var(--ease-out);
  transform: translate(var(--leanX, 0px), var(--leanY, 0px));
}

/* the hop · one as each digit lands. An animation beats a transform outright,
   so a hop that only knew about Y would drop him back to centre mid-jump and
   snap him forward again when it ended. Every frame carries the step. */
.m-cat.is-hop:not(.is-doze) { animation: m-hop ${C.hopMs}ms var(--ease-spring) !important; }
@keyframes m-hop {
  0%   { transform: translate(var(--leanX, 0px), var(--leanY, 0px)) scale(1, 1); }
  30%  { transform: translate(var(--leanX, 0px), calc(var(--leanY, 0px) - ${C.hopBy}px)) scale(.97, 1.04); }
  62%  { transform: translate(var(--leanX, 0px), calc(var(--leanY, 0px) + ${(C.hopBy * 0.25).toFixed(2)}px)) scale(1.03, .97); }
  100% { transform: translate(var(--leanX, 0px), var(--leanY, 0px)) scale(1, 1); }
}`;
  }

  /* ---------- wiring ---------- */

  const MS = { in: 'inMs', out: 'outMs', tap: 'tapMs', wake: 'wakeMs' };
  const MOODS = ['is-in', 'is-out', 'is-tap', 'is-wake'];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let waitSeq, doneSeq, grow = null, growing = false, grewAt = 0;

  /* A tick you feel rather than see. Android and desktop Chrome honour it;
     iOS Safari has no web vibration at all, so this is a bonus on the platforms
     that have it and silence on the one that does not — never the only signal. */
  function buzz(ms) {
    if (!C.buzz || !navigator.vibrate) return;
    try { navigator.vibrate(ms); } catch (_) { /* blocked, and that is fine */ }
  }

  let styleEl = null;
  let el = null;      /* the <svg> */
  let seq;            /* the running mood's clean-up */
  let nap;            /* the inactivity countdown */

  /* Everything that can carry an animation of its own. hold() freezes this
     list, so anything missing from it keeps running and gets caught at a random
     frame — which looks exactly like the animation not working. */
  const parts = () => [el].concat([].slice.call(el.querySelectorAll(
    '.m-eye, .m-joy, .m-ear, .m-eyes, .m-tilt, .m-look, .m-gaze, .m-z')));

  function paint() {
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'mascot';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = css();
  }

  /* ---- being poked ----

     The cat does not listen for taps himself. He cannot: he lives inside
     whatever you hang him in, and only the host knows what a tap there is
     supposed to mean. So the host calls poke(). */


  /* ---- the gaze ----

     Desktop only, and deliberately: a touch screen has no pointer to follow, and
     wiring one up there would mean the eyes sat frozen wherever the last tap
     landed. `(hover: hover) and (pointer: fine)` is the test for a real mouse.

     The eye centre is worked out from the element's own box rather than from the
     eyes' — measuring the thing you are about to move feeds its own output back
     in, and the eyes would creep. */

  const EYE_FX = 0.5, EYE_FY = 0.5207;   /* where the eye line sits in the viewBox */
  let gaze = null, aimX = 0, aimY = 0, queued = false;

  function aim() {
    queued = false;
    if (!gaze || !el) return;
    if (el.classList.contains('is-doze')) { gaze.style.transform = ''; return; }
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const ex = aimX - (r.left + r.width * EYE_FX);
    const ey = aimY - (r.top + r.height * EYE_FY);
    const d = Math.sqrt(ex * ex + ey * ey);

    if (d > C.gazeFar || d < 0.001) { gaze.style.transform = ''; return; }

    let k = Math.min(d / C.gazeNear, 1);          /* swing grows with distance, then tops out */
    if (d > C.gazeNear) {                          /* ...and fades back out towards gazeFar */
      const t = (d - C.gazeNear) / (C.gazeFar - C.gazeNear);
      k *= 1 - t * t * (3 - 2 * t);                /* smoothstep, so there is no edge to cross */
    }
    gaze.style.transform = 'translate(' + (ex / d * k * C.gazeX).toFixed(2) + 'px,' +
                                          (ey / d * k * C.gazeY).toFixed(2) + 'px)';
  }

  function watchPointer() {
    if (reduced) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    gaze = el.querySelector('.m-gaze');
    window.addEventListener('pointermove', function (e) {
      aimX = e.clientX; aimY = e.clientY;
      if (!queued) { queued = true; requestAnimationFrame(aim); }   /* at most once a frame */
    }, { passive: true });
  }

  function countdown() {
    clearTimeout(nap);
    if (el && !reduced && C.dozeAfter > 0) {
      nap = setTimeout(function () { el.classList.add('is-doze'); }, C.dozeAfter);
    }
  }

  /* ---- being typed at ----

     Three one-shots and one held pose. Each one-shot is played by taking its
     class off, forcing a reflow, and putting it back: without the reflow the
     browser sees no change and the second burst of a run never plays. Each
     also parks a timer to take the class off again, so the cat always falls
     back to idle with nobody tracking what he was doing — the same bargain
     mood() makes. */

  let popSeq, hopSeq, glanceSeq;
  let wasUp = false, wasDown = false;

  function replay(cls, ms, done) {
    el.classList.remove(cls);
    el.getBoundingClientRect();
    el.classList.add(cls);
    return setTimeout(function () { el.classList.remove(cls); if (done) done(); }, ms);
  }

  /* n stars, once. Which ones light is a class on the first n, because CSS
     cannot compare a count to an index. */
  function burst(n) {
    const stars = el.querySelectorAll('.m-spark');
    el.classList.remove('is-pop');
    for (let i = 0; i < stars.length; i++) stars[i].classList.toggle('is-lit', i < n);
    clearTimeout(popSeq);
    if (!n) return;
    popSeq = replay('is-pop', C.sparkMs + C.sparkStep * 3 + 60);
  }

  const api = {
    /* Hang the cat in an element. The host needs `position: relative` and
       `overflow: hidden` — both things a sunk plate already is. */
    mount(target) {
      const host = typeof target === 'string' ? document.querySelector(target) : target;
      if (!host) return null;
      paint();
      host.classList.add('m-host');
      el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      el.setAttribute('class', 'm-cat');
      el.setAttribute('viewBox', [VB.x, VB.y, VB.w, VB.h].join(' '));
      el.setAttribute('aria-hidden', 'true');   /* decorative: the host announces the number */
      el.setAttribute('focusable', 'false');
      el.innerHTML = SVG;
      host.insertBefore(el, host.firstChild);
      watchPointer();
      countdown();
      return el;
    },

    /* One class, which takes itself off again when the keyframes are done — so
       the cat always falls back to idle with nobody tracking what it was doing.
       Firing the same mood again restarts it. Anything happening also wakes it
       and restarts the countdown to the next doze. */
    mood(name) {
      if (!el || reduced || !MS[name]) return;
      clearTimeout(seq);
      el.classList.remove('is-doze');
      el.classList.remove.apply(el.classList, MOODS);
      el.getBoundingClientRect();               /* let the removal land, so a repeat replays */
      el.classList.add('is-' + name);
      seq = setTimeout(function () { el.classList.remove('is-' + name); }, C[MS[name]]);
      countdown();
    },

    /* A tap, from whoever owns the tap. Asleep, he springs awake; awake, he
       wobbles. Either way the clock restarts, because a tap IS an interaction
       and sleep is for the absence of them — a poke that put him under would
       be the one gesture that punished you for using the thing. */
    poke() {
      if (!el) return;
      api.mood(el.classList.contains('is-doze') ? 'wake' : 'tap');
      countdown();
    },

    /* Held down, and let go. The host calls these around its own hold timer —
       the animation is the progress, so the two have to agree on how long. */
    /* Held down. The mascot owns the whole timeline — the wait, the fill and the
       moment it is covered — and calls `done` when the screen is solid. The host
       opens its sheet from that callback rather than running a timer of its own,
       because two timers that must agree eventually will not.

       Returns nothing on the way down. press(false) returns TRUE if the fill had
       begun, which is how the host tells a hold that was abandoned from a tap:
       let go during the wait and you meant to tap; let go during the fill and
       you meant to hold and changed your mind. */
    press(on, done) {
      if (!el || reduced) return false;
      clearTimeout(waitSeq);
      clearTimeout(doneSeq);

      if (on) {
        growing = false;
        waitSeq = setTimeout(function () {
          growing = true;
          grewAt = Date.now();                     /* the clock the grace is measured on */
          buzz(8);                                 /* a tick: it has taken hold */
          el.classList.add('is-press');            /* idle breathing out of the way */
          if (grow) grow.cancel();
          grow = el.animate(
            [{ transform: 'none' }, { transform: 'scale(' + C.coverBy + ')' }],
            { duration: C.holdMs, easing: 'linear', fill: 'forwards' }
          );
          /* The commit is announced TWICE and acted on once. onfinish is the
             exact moment the screen is covered, which is what you want — but an
             animation can be throttled (a background tab, a low-power mode, a
             browser that defers it a frame) and then it never arrives. A timer
             cannot be throttled out of existence. The visual may lag; the
             gesture may not. */
          let fired = false;
          const commit = function () {
            if (fired) return;
            fired = true;
            clearTimeout(doneSeq);
            buzz(18);                              /* firmer: it is committed */
            if (done) done();
          };
          grow.onfinish = commit;
          doneSeq = setTimeout(commit, C.holdMs + 40);
        }, C.pressWait);
        return false;
      }

      /* "Did the hold begin?" is not the same as "did the fill start": the first
         breath of the fill is still forgiven, so a tap that ran long is a tap.

         Measured against the wall clock rather than the animation's own
         currentTime. The animation's clock is the more natural thing to ask,
         and it is the wrong one: it can legitimately read 0 while the animation
         is running and waiting on a frame, which silently turns every hold back
         into a tap. */
      const began = growing && (Date.now() - grewAt) > C.tapGrace;
      growing = false;
      if (grow) {
        /* Ease home from exactly where he had got to, which is the whole reason
           this is an animation and not a keyframe played from the top. */
        const here = getComputedStyle(el).transform;
        grow.onfinish = null;
        grow.cancel();
        grow = el.animate(
          [{ transform: here }, { transform: 'none' }],
          { duration: C.releaseMs, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' }
        );
        /* Guarded the same way as the commit, and for a worse reason: if this
           never ran, is-press would stay on and the cat would never breathe
           again. A visual that stalls is a blemish; a cat frozen mid-press is
           a bug you cannot get out of without a reload. */
        let home = false;
        const settle = function () {
          if (home) return;
          home = true;
          clearTimeout(doneSeq);
          if (grow) { grow.cancel(); grow = null; }
          el.classList.remove('is-press');         /* and the breathing comes back */
        };
        grow.onfinish = settle;
        doneSeq = setTimeout(settle, C.releaseMs + 60);
      }
      countdown();
      return began;
    },

    /* What he does while an amount is being typed.

       The host owns the field, so the host says what is in it — he cannot
       read it himself any more than he can decide what a tap meant:

         Mascot.type({ digits, amount, sign, added })

       digits  how many have been typed (the stars are counted, not scaled:
               one star growing is a dimmer, four arriving is a number)
       amount  what they add up to  (the dial: ears, eyes, sink, lean)
       sign    '+' or '-'           (which half of him answers)
       added   true if THIS keystroke put a digit on (the one-shots fire on
               the landing, not on every repaint)

       Nothing typed is nothing to react to, so an empty field is rest(). */
    type(o) {
      if (!el || reduced) return;
      o = o || {};
      const digits = o.digits || 0;
      const amount = Number(o.amount) || 0;
      const up = o.sign === '+';

      api.wake();                       /* a keystroke says a person is there */
      if (!digits) { api.rest(); return; }

      el.classList.add('is-brace');
      /* Log, not linear — see braceAt at the top. */
      const t = amount <= 0 ? 0
        : Math.min(1, Math.log(amount + 1) / Math.log(C.braceAt + 1));
      el.style.setProperty('--tense', t.toFixed(3));
      el.classList.toggle('is-up', up);

      if (!up) {
        /* a flip counts as news too, or turning a sum into a spend says
           nothing at all */
        const flipped = !wasDown;
        wasUp = false;
        wasDown = true;
        burst(0);
        el.classList.remove('is-hop');
        el.style.removeProperty('--leanX');
        el.style.removeProperty('--leanY');
        if (o.added || flipped) { clearTimeout(glanceSeq); glanceSeq = replay('is-glance', C.glanceMs + 40); }
        return;
      }

      wasDown = false;
      clearTimeout(glanceSeq);
      el.classList.remove('is-glance');   /* a glance left running would swing his face mid-hop */
      el.style.setProperty('--leanX', (t * 8 * C.upGain).toFixed(2) + 'px');
      el.style.setProperty('--leanY', (t * -2 * C.upGain).toFixed(2) + 'px');
      const flipped = !wasUp;
      wasUp = true;
      if (o.added || flipped) {
        burst(digits);
        clearTimeout(hopSeq);
        hopSeq = replay('is-hop', C.hopMs + 30);
      }
    },

    /* ...and out of it: the field has closed, or there is nothing in it. The
       commit's own mood plays from here, so this has to leave nothing behind
       for it to fight over. */
    rest() {
      if (!el) return;
      clearTimeout(popSeq); clearTimeout(hopSeq); clearTimeout(glanceSeq);
      el.classList.remove('is-brace', 'is-up', 'is-pop', 'is-hop', 'is-glance');
      const stars = el.querySelectorAll('.m-spark');
      for (let i = 0; i < stars.length; i++) stars[i].classList.remove('is-lit');
      el.style.removeProperty('--tense');
      el.style.removeProperty('--leanX');
      el.style.removeProperty('--leanY');
      wasUp = false;
      wasDown = false;
    },

    /* Rouse it without playing a mood — for scrolls, keystrokes, anything that
       says a person is still there. */
    wake() {
      if (!el) return;
      el.classList.remove('is-doze');
      countdown();
    },

    /* ...and the other way, without waiting out the clock. */
    doze() {
      if (!el) return;
      clearTimeout(nap);
      el.classList.add('is-doze');
      if (gaze) gaze.style.transform = '';      /* asleep, he stops following */
    },

    /* Re-tune live. Pass any subset of the numbers at the top. */
    set(patch) { Object.assign(C, patch); paint(); countdown(); return this.config; },
    get config() { return Object.assign({}, C); },
    get el() { return el; },

    /* ---- inspection ----
       Freeze one moment, in seconds, so it can be looked at. Pass a mood name
       to freeze that, or null to freeze the idle. */
    hold(name, at) {
      if (!el) return;
      clearTimeout(seq);
      clearTimeout(nap);
      el.classList.remove.apply(el.classList, MOODS);
      if (name) el.classList.add('is-' + name);
      parts().forEach(function (p) {
        p.style.animationPlayState = 'paused';
        p.style.animationDelay = '-' + at + 's';
      });
    },

    play() {
      if (!el) return;
      parts().forEach(function (p) {
        p.style.animationPlayState = '';
        p.style.animationDelay = '';
      });
      el.classList.remove.apply(el.classList, MOODS);
      el.classList.remove('is-doze');
      countdown();
    }
  };

  return api;
})();
