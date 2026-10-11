# Whip Rig

A physics simulation of a device that cracks a whip: a three-axis motorized arm
(shoulder, elbow, wrist) swings a 2.2 m tapered whip until the tip passes the
speed of sound.

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

## Controls

You can change swing tempo, motor stall torque, whip length, tip diameter
(taper) and air drag. Use playback speeds down to 1/100× to watch the loop
turn over and the shock ring leave the tip. The strip chart plots tip speed
against the Mach 1 line.

## Files

- `sim.js` holds the physics. It has no DOM dependencies, so it works in the browser
  (`window.WhipSim`) and in Node (`require('./sim.js')`).
- `index.html` is the renderer, telemetry and controls.
- `test/run.js` is a headless smoke test. It checks stability, inextensibility, that
  the strike programs crack and that the slow swing doesn't. Run it with `npm test`.

## Headless use

```js
const { WhipSim } = require('./sim.js');
const sim = new WhipSim({ profile: 'overhead', whipLength: 2.5 });
sim.advance(3.4); // seconds of simulated time
console.log(sim.peakTipSpeed, sim.cracks);
```
