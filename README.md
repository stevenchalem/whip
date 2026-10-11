# Whip Rig

A physics simulation of a device that operates a whip. A three-axis motorized
arm (shoulder, elbow, wrist) swings a 2.2 m tapered whip. It can either crack
the whip (tip past the speed of sound) or strike a playing card hanging
anywhere from 0.5 to 2 m above the floor.

Open `index.html` in a browser. There's no build step and no dependencies.

## What it models

**The device.** It's a planar three-link arm holding a rigid handle. Each joint is a
torque-limited motor with a linear torque/speed curve. A PD controller with
feed-forward drives it along a motion program of keyframes joined by
minimum-jerk segments. The whip's pull on the handle feeds back into the joints
as reaction torque (Jᵀ F), so the motors saturate and lag their commanded pose
when the whip loads them.

**The whip.** It's a chain of 56 lumped masses solved with small-step XPBD:

- inextensible links
- bending stiffness EI = E·πd⁴/64 that tapers along the length
- quadratic air drag (normal pressure drag plus skin friction)
- gravity and a floor with friction
- a light "cracker" at the tip

The sim integrates at 20 kHz, and it adds substeps automatically when any node
would move more than a fifth of a segment in one step. That happens at the
crack.

The taper is what creates the crack. The loop travelling down the whip carries its
energy into ever lighter material, so it speeds up. In the default setup, a
handle speed of about 27 m/s gives a tip speed of about 360 m/s (Mach 1.05).

## Motion programs

| Program | What it does | Typical peak |
|---|---|---|
| Overhead crack | Winds back over the rig, lets the whip unroll, strikes forward and stops hard | ~360 m/s, cracks |
| Forward flick | Lifts the whip in front, then a short, wrist-heavy snap down | ~400 m/s, cracks |
| Slow swing | The overhead motion at a lazy tempo | ~140 m/s, no crack |

## Aimed strike at a hanging card

The card is 88 mm tall, weighs 1.8 g and hangs edge-on from a 30 cm string,
2.6 m in front of the shoulder axis. A hit is the tip, or one of the last two
whip nodes, sweeping through the card within 4 mm. The sim checks the whole path
covered in each step, because the tip can travel several centimetres per step.
The card swings when hit, but it doesn't push back on the whip.

The whip can't be steered once the strike starts, so all the aiming is in the
motion program. `tools/aim.js` optimizes three things for card heights from
0.5 to 2 m:

- the wind-up shoulder angle
- the strike end pose (all three joints)
- the strike duration

Heights are solved in order, each starting from its neighbour's solution, so
the table varies smoothly. The page interpolates it for any height in between.
Each candidate is scored on a nominal strike plus four disturbed ones. Any hit
beats any miss. Among hits, the optimizer prefers ones near the middle of the
card, then faster ones.

There are two ways to start the strike:

- **When the whip has unrolled:** the strike starts once the tip is behind the
  handle and at least 85% of the whip's length away from it.
- **On a fixed clock:** the strike starts at a fixed time.

`tools/trials.js` measures hit rates for both triggers with 20 disturbed swings
per height. Each swing varies air drag ±15%, motor torque ±7.5% and the whip's
starting motion, using different random seeds from the optimizer. The page's
**Test 20 disturbed swings per trigger** button runs the same test for the
current card height.

Results with the current table (`node tools/trials.js 20`):

| Card height | Hits out of 20 | Typical impact speed |
|---|---|---|
| 0.50–1.20 m | 20 at every height tested | 42–82 m/s |
| 1.25 m | 18 | 42 m/s |
| 1.40 m | 20 | 50 m/s |
| 1.50 m | 18 | 56 m/s |
| 1.60 m | 16 | 72 m/s |
| 1.75 m | 13 | 52 m/s |
| 1.90 m | 11 | 72 m/s |
| 2.00 m | 19 | 91 m/s |

That's 90% across the 13 heights tested, including heights between table rows.

Some things to know about these results:

- **Cards around the shoulder axis are hardest.** That's 1.75–1.9 m, since the
  shoulder is at 1.7 m. At 1.9 m the nominal strike misses by 3 cm.
- **The table uses two strike styles.** Below 1.45 m it uses an overhead strike
  that drops the tip onto the card. From 1.5 m up it uses a flatter strike
  found by a second sweep run downward from 2 m with a wider search. The table
  switches between them only once, because swapping back and forth made the
  heights in between miss.
- **Hits are mostly slow, at 40–90 m/s.** The optimizer favours a reliable hit
  over a fast one. One solution it found at 0.75 m cracked at the card at about
  450 m/s, but it was robust only in a narrow height band, so it isn't in the
  table.
- **The two triggers give identical results here.** The wind-up always leaves
  the whip stretched out behind the rig, so the unroll trigger fires at once
  and never needs to wait. It would only matter with a faster wind-up, a longer
  whip, or disturbances that delay the unroll.

To regenerate the table:

```
node tools/aim.js --out up.json
node tools/aim.js --descending --out down.json
node tools/merge-aim.js --split 1.45 up.json down.json
```

`merge-aim.js` also keeps the rows already in `sim.js` as candidates, so for a
clean rebuild, first set `AIM_TABLE` to `null`.

## Two joints instead of three

To see whether the third joint earns its place, the same optimization and
trials were run with one joint locked rigid at 0°. Reach, motors and whip were
unchanged. The tables and raw trial output are in `results/`.

| Card height | 3 joints | Shoulder + wrist (elbow locked) | Shoulder + elbow (wrist locked) |
|---|---|---|---|
| 0.50 m | 20 | 18 | 20 |
| 0.60 m | 20 | 15 | 14 |
| 0.75 m | 20 | 15 | 5 |
| 0.90 m | 20 | 20 | 0 |
| 1.00 m | 20 | 20 | 18 |
| 1.20 m | 20 | 20 | 0 |
| 1.25 m | 18 | 20 | 13 |
| 1.40 m | 20 | 20 | 10 |
| 1.50 m | 18 | 12 | 19 |
| 1.60 m | 16 | 17 | 10 |
| 1.75 m | 13 | 18 | 19 |
| 1.90 m | 11 | 12 | 15 |
| 2.00 m | 19 | 14 | 19 |
| **Mean hit rate** | **90%** | **85%** | **62%** |

The table shows hits out of 20 disturbed swings at each height.

- **Shoulder + wrist comes close to three joints.** It does as well or better
  from 0.9 to 1.4 m and at 1.75 m. But its hits there are slow (20–27 m/s,
  against 44–82 m/s with three joints), and it is weaker at the extremes.
- **Shoulder + elbow is the weakest overall.** It completely fails at 0.9 and
  1.2 m, where even the nominal strike misses. However, it found strikes from
  1.5 to 1.75 m that hit at 250–380 m/s, cracking at or near the card, with
  95% hits at 1.5 and 1.75 m.
- **This is one optimizer run per arm.** Some differences at individual
  heights will reflect how the search went rather than a hard limit of the arm.

In the page, the **Drives** card switches between the three arms. A locked joint
is drawn as a rigid pin, and each two-joint arm uses its own aim table, which
`tools/embed-tables.js` copies from `results/two-joint` into `sim.js`. The
in-page hit-rate test runs on whichever arm is selected.

To reproduce one variant (shown here for the elbow):

```
WHIP_LOCK=elbow node tools/aim.js --out up.json
WHIP_LOCK=elbow node tools/aim.js --descending --out down.json
WHIP_LOCK=elbow node tools/merge-aim.js --split 1.45 --out table.json up.json down.json
WHIP_LOCK=elbow node tools/trials.js 20 --table table.json
```

## Controls

You can change swing tempo, motor stall torque, whip length, tip diameter
(taper) and air drag. Use playback speeds down to 1/100× to watch the loop
turn over and the shock ring leave the tip. The strip chart plots tip speed
against the Mach 1 line.

## Files

- `sim.js` holds the physics. It has no DOM dependencies, so it works in the browser
  (`window.WhipSim`) and in Node (`require('./sim.js')`).
- `index.html` is the renderer, telemetry and controls.
- `tools/aim.js` runs one optimizer sweep (about 15 minutes on 4 cores).
- `tools/merge-aim.js` combines sweeps into the aim table in `sim.js`.
- `tools/trials.js` runs the hit-rate trials (`node tools/trials.js [n]`).
- `test/run.js` is a headless smoke test. It checks stability, inextensibility, that
  the strike programs crack and that the slow swing doesn't. Run it with `npm test`.

## Headless use

```js
const { WhipSim } = require('./sim.js');
const sim = new WhipSim({ profile: 'overhead', whipLength: 2.5 });
sim.advance(3.4); // seconds of simulated time
console.log(sim.peakTipSpeed, sim.cracks);
```
