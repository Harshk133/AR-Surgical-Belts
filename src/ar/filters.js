// One Euro filter (Casiez et al. 2012): low lag when moving fast, strong smoothing when still.

function alpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }

  filter(value, dt) {
    if (this.x === null || !(dt > 0)) {
      this.x = value;
      this.dx = 0;
      return value;
    }
    const dxRaw = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (dxRaw - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** A bank of One Euro filters for N-dimensional points keyed by id. */
export class PointFilterBank {
  constructor(dims, minCutoff, beta) {
    this.dims = dims;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.filters = new Map();
  }

  filter(key, values, dt, out) {
    let f = this.filters.get(key);
    if (!f) {
      f = Array.from({ length: this.dims }, () => new OneEuro(this.minCutoff, this.beta));
      this.filters.set(key, f);
    }
    for (let i = 0; i < this.dims; i++) out[i] = f[i].filter(values[i], dt);
    return out;
  }

  reset() {
    this.filters.clear();
  }
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
