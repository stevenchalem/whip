/*
 * Whip-cracking device simulation — physics core.
 *
 * Model (2D, side view, SI units, y up):
 *  - Device: a 3-joint planar arm (shoulder, elbow, wrist) holding a rigid handle.
 *    Each joint is driven by a torque-limited motor with a linear torque/speed
 *    curve, tracking a minimum-jerk joint-space trajectory with a PD + feed-forward
 *    controller. Reaction forces from the whip are fed back into the joints.
 *  - Whip: a tapered chain of point masses solved with XPBD (small-step variant):
 *    inextensible stretch constraints, bending constraints with stiffness EI(d),
 *    gravity, quadratic air drag (normal + skin friction) and a ground plane.
 *
 * The taper (mass per length shrinking toward the tip) is what turns a moderate
 * handle speed into a supersonic tip: the travelling loop carries its energy and
 * momentum into ever lighter material.
 *
 * Works in the browser (window.WhipSim) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  const G = 9.81;
  const SPEED_OF_SOUND = 343;
  const RHO_AIR = 1.2;
  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------- profiles
  // Keyframes in degrees: [shoulder (absolute, from +x CCW), elbow (relative), wrist (relative)].
  // Consecutive keyframes are joined with minimum-jerk segments (zero velocity
  // and acceleration at each keyframe). Profiles start and end at the same pose
  // so they loop seamlessly.
  const REST = [-20, 10, 0];
  const PROFILES = {
    overhead: {
      name: 'Overhead crack',
      description: 'Wind the whip back over the device, let it unroll, then drive forward and stop hard.',
      phases: ['hold', 'wind back', 'let it unroll', 'strike', 'follow-through', 'return'],
      keys: [
        { t: 0.0, q: REST },
        { t: 0.5, q: REST },
        { t: 1.0, q: [115, 20, 35] },
        { t: 1.45, q: [115, 20, 35] },
        { t: 1.66, q: [5, -15, -45] },
        { t: 2.6, q: [5, -15, -45] },
        { t: 3.4, q: REST },
      ],
    },
    flick: {
      name: 'Forward flick',
      description: 'Lift the whip in front, then a short, violent wrist-dominated snap downward.',
      phases: ['hold', 'lift', 'pause', 'snap', 'follow-through', 'return'],
      keys: [
        { t: 0.0, q: REST },
        { t: 0.5, q: REST },
        { t: 1.0, q: [60, 30, 50] },
        { t: 1.3, q: [60, 30, 50] },
        { t: 1.45, q: [20, -10, -50] },
        { t: 2.4, q: [20, -10, -50] },
        { t: 3.2, q: REST },
      ],
    },
    gentle: {
      name: 'Slow swing (no crack)',
      description: 'The same overhead motion at a lazy pace: the loop never goes supersonic.',
      phases: ['hold', 'wind back', 'let it unroll', 'swing', 'follow-through', 'return'],
      keys: [
        { t: 0.0, q: REST },
        { t: 0.5, q: REST },
        { t: 1.3, q: [115, 20, 35] },
        { t: 1.8, q: [115, 20, 35] },
        { t: 2.5, q: [5, -15, -45] },
        { t: 3.2, q: [5, -15, -45] },
        { t: 4.0, q: REST },
      ],
    },
  };

  function minJerk(s) {
    // position, velocity (d/ds), acceleration (d²/ds²) of the 5th-order smoothstep
    const s2 = s * s, s3 = s2 * s;
    return [
      s3 * (10 - 15 * s + 6 * s2),
      30 * s2 * (1 - s) * (1 - s),
      60 * s * (1 - s) * (1 - 2 * s),
    ];
  }

  // Desired joint angle, velocity and acceleration (radians) at profile time t.
  function sampleProfile(profile, t, speed) {
    const keys = profile.keys;
    const duration = keys[keys.length - 1].t;
    const tp = (t * speed) % duration;
    let k = 0;
    while (k < keys.length - 2 && tp >= keys[k + 1].t) k++;
    const a = keys[k], b = keys[k + 1];
    const T = (b.t - a.t) / speed;
    const s = Math.min(1, Math.max(0, (tp - a.t) / (b.t - a.t)));
    const [p, dp, ddp] = minJerk(s);
    const q = [], qd = [], qdd = [];
    for (let j = 0; j < 3; j++) {
      const dq = (b.q[j] - a.q[j]) * DEG;
      q.push(a.q[j] * DEG + dq * p);
      qd.push((dq * dp) / T);
      qdd.push((dq * ddp) / (T * T));
    }
    return { q, qd, qdd, segment: k, phase: tp / duration, cycleTime: duration / speed };
  }

  // ---------------------------------------------------------------- defaults
  const DEFAULTS = {
    profile: 'overhead',
    speed: 1.0, // time-scale of the motion profile (higher = faster swing)

    // device geometry & drives
    shoulder: [0, 1.7],
    links: [0.55, 0.45, 0.25], // upper arm, forearm, handle (m)
    inertia: [0.9, 0.25, 0.03], // effective joint inertia incl. rotor (kg m²)
    tauMax: [400, 200, 60], // stall torque (N m)
    omegaMax: [30, 45, 70], // no-load speed (rad/s)
    friction: [0.5, 0.3, 0.05], // viscous joint friction (N m s)
    bandwidth: 45, // controller natural frequency (rad/s)
    loadFilter: 0.001, // time constant of the whip→joint reaction filter (s)

    // whip
    whipLength: 2.2,
    segments: 56,
    buttDiameter: 0.016,
    tipDiameter: 0.0015,
    density: 1100, // kg/m³ (braided nylon / leather)
    youngs: 3e7, // effective bending modulus (Pa)
    cracker: 0.00015, // mass of the tip "cracker" (kg)
    settleTime: 1.5, // damped relaxation before t = 0 (s)
    dragScale: 1.0,
    cdNormal: 1.1,
    cdTangent: 0.01,
    groundFriction: 0.6,

    dt: 1 / 20000,
  };

  // ---------------------------------------------------------------- simulation
  class WhipSim {
    constructor(opts) {
      this.params = Object.assign({}, DEFAULTS, opts || {});
      this.reset();
    }

    setParams(opts) {
      const rebuild = ['whipLength', 'segments', 'buttDiameter', 'tipDiameter', 'density', 'youngs']
        .some((k) => k in opts && opts[k] !== this.params[k]);
      Object.assign(this.params, opts);
      if (rebuild) this.reset();
    }

    reset() {
      const P = this.params;
      this.t = 0;
      this.profile = PROFILES[P.profile] || PROFILES.overhead;

      // joints
      const start = sampleProfile(this.profile, 0, P.speed);
      this.q = start.q.slice();
      this.qd = [0, 0, 0];
      this.tau = [0, 0, 0];
      this.tauLoad = [0, 0, 0];
      this.target = start;

      // whip nodes. Index 0 = handle butt (wrist), 1 = handle end; both kinematic.
      const n = P.segments;
      const N = n + 2;
      this.N = N;
      this.segLen = P.whipLength / n;
      this.x = new Float64Array(N * 2);
      this.prev = new Float64Array(N * 2);
      this.v = new Float64Array(N * 2);
      this.invMass = new Float64Array(N);
      this.mass = new Float64Array(N);
      this.diam = new Float64Array(N); // diameter at node
      this.bendCompliance = new Float64Array(N); // for hinge at node i (between seg i-1 and i)

      const dAt = (s) => P.buttDiameter + (P.tipDiameter - P.buttDiameter) * s;
      for (let i = 2; i < N; i++) {
        const s = (i - 1) / n; // arc fraction along whip
        const d = dAt(s);
        this.diam[i] = d;
        // lumped mass: half of each adjacent segment
        const segMass = (sa, sb) => {
          const da = dAt(sa), db = dAt(sb);
          return P.density * Math.PI / 4 * (da * da + da * db + db * db) / 3 * this.segLen;
        };
        let m = 0.5 * segMass((i - 2) / n, (i - 1) / n);
        if (i < N - 1) m += 0.5 * segMass((i - 1) / n, i / n);
        else m += P.cracker;
        this.mass[i] = m;
        this.invMass[i] = 1 / m;
      }
      this.diam[0] = this.diam[1] = P.buttDiameter * 1.6;
      for (let i = 1; i < N - 1; i++) {
        const d = i < 2 ? P.buttDiameter : this.diam[i];
        const EI = P.youngs * Math.PI * Math.pow(d, 4) / 64;
        this.bendCompliance[i] = this.segLen / EI; // 1 / rotational stiffness
      }
      this.totalMass = this.mass.reduce((a, b) => a + b, 0);

      // lay the whip on the floor in front of the device
      this._kinematics();
      const hx = this.x[2], hy = this.x[3];
      const drop = Math.max(0, hy - 0.01);
      for (let i = 2; i < N; i++) {
        const s = (i - 1) * this.segLen; // hang straight down, then run along the floor
        this.x[2 * i] = s <= drop ? hx : hx + (s - drop);
        this.x[2 * i + 1] = s <= drop ? hy - s : 0.01;
      }
      this.prev.set(this.x);
      this.v.fill(0);
      this._imp = new Float64Array(4);
      this._impTension = 0;
      this.tension = 0;
      this._tSub = 0;
      this._settle();

      this.tipSpeed = 0;
      this.peakTipSpeed = 0;
      this.cyclePeak = 0;
      this.cracks = [];
      this._supersonic = false;
      this._cycle = 0;
      this.energy = 0; // mechanical energy delivered by motors (J)
    }

    // Let the freshly laid-out whip relax under heavy damping while the device holds
    // its start pose, so the run begins from rest instead of with a spring-loaded kink.
    _settle() {
      const h = this.params.dt;
      const speed = this.params.speed;
      this.params.speed = 0; // freeze the profile at t = 0
      const n = Math.round(this.params.settleTime / h);
      for (let s = 0; s < n; s++) {
        this._stepWhip(h);
        this._updateLoad(h);
        // first fifth: quasi-static (velocities discarded) to iron out kinks; then heavy damping
        const damp = s < n / 5 ? 0 : 0.995;
        for (let i = 4; i < this.v.length; i++) this.v[i] *= damp;
      }
      this.params.speed = speed;
    }

    // forward kinematics: joint positions + kinematic handle nodes
    _kinematics() {
      const P = this.params;
      const [L1, L2, L3] = P.links;
      const a1 = this.q[0], a2 = a1 + this.q[1], a3 = a2 + this.q[2];
      const S = P.shoulder;
      const E = [S[0] + L1 * Math.cos(a1), S[1] + L1 * Math.sin(a1)];
      const W = [E[0] + L2 * Math.cos(a2), E[1] + L2 * Math.sin(a2)];
      const H = [W[0] + L3 * Math.cos(a3), W[1] + L3 * Math.sin(a3)];
      this.joints = [S, E, W, H];
      this.x[0] = W[0]; this.x[1] = W[1];
      this.x[2] = H[0]; this.x[3] = H[1];
    }

    _stepDevice(h) {
      const P = this.params;
      const tgt = sampleProfile(this.profile, this._tSub, P.speed);
      this.target = tgt;
      const wn = P.bandwidth;
      for (let j = 0; j < 3; j++) {
        const I = P.inertia[j];
        const kp = I * wn * wn, kd = 2 * I * wn;
        let cmd = kp * (tgt.q[j] - this.q[j]) + kd * (tgt.qd[j] - this.qd[j]) + I * tgt.qdd[j];
        // linear torque/speed curve: available torque drops as the motor spins up
        const w = this.qd[j];
        const motoring = Math.sign(cmd) === Math.sign(w);
        const avail = P.tauMax[j] * (motoring ? Math.max(0, 1 - Math.abs(w) / P.omegaMax[j]) : 1);
        cmd = Math.max(-avail, Math.min(avail, cmd));
        this.tau[j] = cmd;
        const acc = (cmd + this.tauLoad[j] - P.friction[j] * w) / I;
        this.qd[j] += acc * h;
        this.q[j] += this.qd[j] * h;
        this.energy += Math.max(0, cmd * this.qd[j]) * h;
      }
      this._kinematics();
    }

    _stepWhip(h) {
      const P = this.params;
      const N = this.N, x = this.x, prev = this.prev, v = this.v, w = this.invMass;
      const ds = this.segLen;

      // handle nodes: record their velocity, they are driven kinematically
      const hb0 = [x[0], x[1]], ht0 = [x[2], x[3]];

      // external forces + prediction
      const kDrag = 0.5 * RHO_AIR * P.dragScale;
      for (let i = 2; i < N; i++) {
        const ix = 2 * i, iy = ix + 1;
        v[iy] -= G * h;
        // tangent from neighbours
        const j0 = i - 1, j1 = Math.min(N - 1, i + 1);
        let tx = x[2 * j1] - x[2 * j0], ty = x[2 * j1 + 1] - x[2 * j0 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        const vt = v[ix] * tx + v[iy] * ty;
        let vnx = v[ix] - vt * tx, vny = v[iy] - vt * ty;
        const vn = Math.hypot(vnx, vny);
        const d = this.diam[i], m = this.mass[i];
        const len = i === N - 1 ? 0.5 * ds : ds;
        const kn = (kDrag * P.cdNormal * d * len) / m;
        const kt = (kDrag * P.cdTangent * Math.PI * d * len) / m;
        // implicit quadratic drag: v <- v / (1 + k|v|h)
        const fn = 1 / (1 + kn * vn * h);
        const ft = 1 / (1 + kt * Math.abs(vt) * h);
        v[ix] = vnx * fn + vt * ft * tx;
        v[iy] = vny * fn + vt * ft * ty;

        prev[ix] = x[ix]; prev[iy] = x[iy];
        x[ix] += v[ix] * h;
        x[iy] += v[iy] * h;
      }

      // device moves the handle
      this._stepDevice(h);
      v[0] = (x[0] - hb0[0]) / h; v[1] = (x[1] - hb0[1]) / h;
      v[2] = (x[2] - ht0[0]) / h; v[3] = (x[3] - ht0[1]) / h;

      const h2 = h * h;
      // constraint impulses applied to the handle butt / end nodes during this substep
      let Ix0 = 0, Iy0 = 0, Ix1 = 0, Iy1 = 0;

      // bending (hinge at node i between segments i-1→i and i→i+1)
      for (let i = 1; i < N - 1; i++) {
        const a = i - 1, b = i, c = i + 1;
        const e1x = x[2 * b] - x[2 * a], e1y = x[2 * b + 1] - x[2 * a + 1];
        const e2x = x[2 * c] - x[2 * b], e2y = x[2 * c + 1] - x[2 * b + 1];
        const l1s = e1x * e1x + e1y * e1y, l2s = e2x * e2x + e2y * e2y;
        if (l1s < 1e-12 || l2s < 1e-12) continue;
        const C = Math.atan2(e1x * e2y - e1y * e2x, e1x * e2x + e1y * e2y);
        // gradients
        const gax = -e1y / l1s, gay = e1x / l1s; // = perp(e1)/|e1|²
        const gcx = -e2y / l2s, gcy = e2x / l2s;
        // dθ/dpa = perp1/l1², dθ/dpc = perp2/l2², dθ/dpb = -(both)
        const g0x = gax, g0y = gay, g2x = gcx, g2y = gcy;
        const g1x = -gax - gcx, g1y = -gay - gcy;
        const wa = w[a], wb = w[b], wc = w[c];
        const denomW = wa * (g0x * g0x + g0y * g0y) + wb * (g1x * g1x + g1y * g1y) + wc * (g2x * g2x + g2y * g2y);
        const alpha = this.bendCompliance[i] / h2;
        const dl = -C / (denomW + alpha);
        x[2 * a] += wa * g0x * dl; x[2 * a + 1] += wa * g0y * dl;
        x[2 * b] += wb * g1x * dl; x[2 * b + 1] += wb * g1y * dl;
        x[2 * c] += wc * g2x * dl; x[2 * c + 1] += wc * g2y * dl;
        if (a === 0) { Ix0 += g0x * dl / h; Iy0 += g0y * dl / h; }
        if (a === 1) { Ix1 += g0x * dl / h; Iy1 += g0y * dl / h; }
        if (b === 1) { Ix1 += g1x * dl / h; Iy1 += g1y * dl / h; }
      }

      // stretch (inextensible): a handle→tip sweep then a tip→handle sweep
      for (let it = 0; it < 2; it++) {
        for (let k = 1; k < N - 1; k++) {
          const i = it === 0 ? k : N - 1 - k;
          const a = i, b = i + 1;
          const dx = x[2 * b] - x[2 * a], dy = x[2 * b + 1] - x[2 * a + 1];
          const L = Math.hypot(dx, dy);
          if (L < 1e-12) continue;
          const nx = dx / L, ny = dy / L;
          const C = L - ds;
          const wa = w[a], wb = w[b];
          const dl = -C / (wa + wb);
          x[2 * a] -= wa * nx * dl; x[2 * a + 1] -= wa * ny * dl;
          x[2 * b] += wb * nx * dl; x[2 * b + 1] += wb * ny * dl;
          if (a === 1) {
            Ix1 -= nx * dl / h; Iy1 -= ny * dl / h;
            this._impTension -= dl / h;
          }
        }
      }

      // ground
      for (let i = 2; i < N; i++) {
        const iy = 2 * i + 1;
        if (x[iy] < 0) {
          const pen = -x[iy];
          x[iy] = 0;
          const ix = 2 * i;
          const slide = x[ix] - prev[ix];
          const fr = Math.min(Math.abs(slide), P.groundFriction * pen);
          x[ix] -= Math.sign(slide) * fr;
        }
      }

      // velocities
      for (let i = 2; i < N; i++) {
        v[2 * i] = (x[2 * i] - prev[2 * i]) / h;
        v[2 * i + 1] = (x[2 * i + 1] - prev[2 * i + 1]) / h;
      }

      const I = this._imp;
      I[0] += Ix0; I[1] += Iy0; I[2] += Ix1; I[3] += Iy1;
    }

    // Turn the impulses gathered over a time step of length h into reaction torques
    // on the joints (Jᵀ F). Averaging impulses over the whole step and low-pass
    // filtering keeps the explicit arm↔whip coupling stable.
    _updateLoad(h) {
      const I = this._imp, J = this.joints;
      // impulses were recorded as acting on the (kinematic) handle nodes: the whip's pull
      const pts = [[J[2], I[0] / h, I[1] / h], [J[3], I[2] / h, I[3] / h]];
      const a = Math.min(1, h / this.params.loadFilter);
      for (let j = 0; j < 3; j++) {
        let t = 0;
        for (let k = j === 2 ? 1 : 0; k < 2; k++) { // butt force passes through the wrist axis
          const [p, fx, fy] = pts[k];
          t += (p[0] - J[j][0]) * fy - (p[1] - J[j][1]) * fx;
        }
        this.tauLoad[j] += a * (t - this.tauLoad[j]);
      }
      this.tension += a * (this._impTension / h - this.tension);
      I.fill(0);
      this._impTension = 0;
    }

    // One fixed time step, split into substeps whenever any node would travel more than
    // a fraction of a segment length (it happens around the crack, where the tip is
    // supersonic and position-based constraints otherwise lose track of it).
    step(h) {
      h = h || this.params.dt;
      const v = this.v;
      let vmax2 = 0;
      for (let i = 4; i < v.length; i += 2) {
        const s2 = v[i] * v[i] + v[i + 1] * v[i + 1];
        if (s2 > vmax2) vmax2 = s2;
      }
      const sub = Math.min(64, Math.max(1, Math.ceil((Math.sqrt(vmax2) * h) / (0.2 * this.segLen))));
      for (let k = 0; k < sub; k++) {
        this._tSub = this.t + (k * h) / sub;
        this._stepWhip(h / sub);
      }
      this._updateLoad(h);
      this.substeps = sub;
      this.t += h;

      const N = this.N;
      const vx = this.v[2 * (N - 1)], vy = this.v[2 * (N - 1) + 1];
      this.tipSpeed = Math.hypot(vx, vy);
      if (this.tipSpeed > this.peakTipSpeed) this.peakTipSpeed = this.tipSpeed;

      const cycle = Math.floor((this.t * this.params.speed) / this.profile.keys[this.profile.keys.length - 1].t);
      if (cycle !== this._cycle) { this._cycle = cycle; this.cyclePeak = 0; }
      if (this.tipSpeed > this.cyclePeak) this.cyclePeak = this.tipSpeed;

      if (this.tipSpeed > SPEED_OF_SOUND && !this._supersonic) {
        this._supersonic = true;
        this.cracks.push({
          t: this.t,
          x: this.x[2 * (N - 1)],
          y: this.x[2 * (N - 1) + 1],
          speed: this.tipSpeed,
        });
      } else if (this.tipSpeed < SPEED_OF_SOUND * 0.8) {
        this._supersonic = false;
      }
    }

    advance(seconds) {
      const h = this.params.dt;
      const n = Math.max(0, Math.round(seconds / h));
      for (let i = 0; i < n; i++) this.step(h);
      return n;
    }

    handleSpeed() {
      return Math.hypot(this.v[2], this.v[3]);
    }
  }

  const api = { WhipSim, PROFILES, DEFAULTS, SPEED_OF_SOUND, sampleProfile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WhipSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
