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

RESULTS_PLACEHOLDER

## Controls

You can change swing tempo, motor stall torque, whip length, tip diameter
(taper) and air drag. Use playback speeds down to 1/100× to watch the loop
turn over and the shock ring leave the tip. The strip chart plots tip speed
against the Mach 1 line.

## Files

- `sim.js` holds the physics. It has no DOM dependencies, so it works in the browser
  (`window.WhipSim`) and in Node (`require('./sim.js')`).
- `index.html` is the renderer, telemetry and controls.
- `tools/aim.js` regenerates the aim table in `sim.js` (about 15 minutes on 4 cores).
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
