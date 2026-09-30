/** Seeded 2D simplex noise (after Stefan Gustavson's public-domain reference), range ≈ −1…1. */
export function simplex2(seed = 1) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256).map((_, i) => i);
  let s = seed >>> 0 || 1;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  // Eight gradient directions, as x and y components.
  const gx = new Float64Array([1, -1, 1, -1, 1, -1, 0, 0]);
  const gy = new Float64Array([1, 1, -1, -1, 0, 0, 1, -1]);
  const F2 = 0.5 * (Math.sqrt(3) - 1),
    G2 = (3 - Math.sqrt(3)) / 6;
  const corner = (g: number, x: number, y: number) => {
    const t = 0.5 - x * x - y * y;
    if (t <= 0) return 0;
    const t2 = t * t;
    return t2 * t2 * (gx[g & 7] * x + gy[g & 7] * y);
  };
  return (x: number, y: number) => {
    const t = (x + y) * F2;
    const i = Math.floor(x + t),
      j = Math.floor(y + t);
    const u = (i + j) * G2;
    const x0 = x - (i - u),
      y0 = y - (j - u);
    const i1 = x0 > y0 ? 1 : 0,
      j1 = 1 - i1;
    const ii = i & 255,
      jj = j & 255;
    return (
      70 *
      (corner(perm[ii + perm[jj]], x0, y0) +
        corner(perm[ii + i1 + perm[jj + j1]], x0 - i1 + G2, y0 - j1 + G2) +
        corner(perm[ii + 1 + perm[jj + 1]], x0 - 1 + 2 * G2, y0 - 1 + 2 * G2))
    );
  };
}

/** Deterministic 0…1 hash for scattering props. */
export function hash2(x: number, y: number, salt = 0) {
  let h =
    Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
