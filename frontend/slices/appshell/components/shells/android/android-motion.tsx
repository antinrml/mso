/* Material 3 Expressive motion — the Android shell's spring tokens, in one place.

   WHAT CHANGED AND WHY. This shell animated with `cubic-bezier(0.2,0.9,0.3,1.06)`
   at a flat 300ms, which is the pre-2025 Material model (duration + easing).
   M3 Expressive (m3.material.io, 2026) replaced that: motion is now described by
   a spring — a stiffness/damping pair — in two families. "Spatial" springs drive
   anything that moves or resizes and are allowed to overshoot; "effects" springs
   drive colour and opacity and must NOT, because an alpha that overshoots past 1
   clips flat and reads as a flicker rather than as momentum.

   CSS has no spring primitive. Each easing below is a `linear()` SAMPLED off the
   real spring's unit-step response (mass 1, as M3 specifies), truncated where the
   curve settles inside ±0.5% of rest.

   THE CEILING OF THIS APPROXIMATION, stated plainly: a sampled linear() is still
   a fixed-duration easing. A real spring can be interrupted mid-flight and
   re-targeted, carrying its current velocity into the new animation. A CSS easing
   always restarts from zero velocity and always runs its full duration, so
   flicking the shade open-closed-open looks like three separate animations rather
   than one continuous mass. Anything that genuinely needs interruptible physics
   has to leave CSS for WAAPI or a JS spring; do not try to fix it by adding more
   keyframes here.

   ONLY THREE CURVES, not six. Normalised to 0..1 a spring's SHAPE depends only on
   the damping ratio; stiffness merely scales time. So M3's six spring tokens
   collapse to three easings plus six durations:
     ζ=0.6  spatial fast          → 9.3% overshoot
     ζ=0.8  spatial default/slow  → 1.5% overshoot
     ζ=1.0  every effects token   → critically damped, no overshoot

   DURATIONS ARE calc(var(--shell-dur) * K), NOT RAW MS, ON PURPOSE. globals.css
   collapses --shell-dur to 1ms under prefers-reduced-motion. Before this change
   the only Android motion that honoured that was the one animation already
   written in terms of --shell-dur; every press/enter animation added here would
   have silently opted OUT of the reduce-motion contract if the ms were hard-coded.
   K = settle time ÷ the 300ms Android --shell-dur:
     spatial fast    322ms  (k=800,  ζ=0.6)  ×1.073
     spatial default 371ms  (k=380,  ζ=0.8)  ×1.237
     spatial slow    511ms  (k=200,  ζ=0.8)  ×1.703
     effects fast    121ms  (k=3800, ζ=1.0)  ×0.403
     effects default 186ms  (k=1600, ζ=1.0)  ×0.620
     effects slow    263ms  (k=800,  ζ=1.0)  ×0.877
   The tokens themselves now live under [data-shell="android"] in app/globals.css,
   so every Android surface inherits them from the shell root with no provider and
   no per-render style object. This module keeps only the class that consumes them.

   BROWSER FLOOR: linear() is Chrome 113 / Safari 17.2 / Firefox 112. Older engines
   drop the whole timing-function declaration and fall back to `ease`, which is a
   correct-looking degrade, not a break — so no @supports guard. */
/* Touch press-down. Real Android answers a tap with a ripple, which CSS cannot
   draw without a pseudo-element sized from the touch point; a spring scale-down
   is the honest substitute and carries the same "the surface is physical" signal.
   `transition-transform` also covers `scale` (Tailwind 4 puts scale in the
   transform group), and it deliberately REPLACES the shadcn Button base's
   `transition-colors` via tailwind-merge — every call site here is
   `hover:bg-transparent`, so there is no colour transition to lose, and keeping
   `transition` (all properties) would have put a 9.3%-overshoot SPATIAL curve on
   colour, which is exactly the family mix M3 forbids. */
export const M3_PRESS =
  "transition-transform duration-[var(--m3-dur-spatial-fast)] ease-[var(--m3-spatial-fast)]";
