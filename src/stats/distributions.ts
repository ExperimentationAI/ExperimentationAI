/**
 * Error function approximation using Abramowitz & Stegun formula 7.1.26.
 * Maximum error: 1.5 × 10⁻⁷
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1.0 / (1.0 + p * a);
  const y =
    1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-a * a);

  return sign * y;
}

/**
 * Standard normal CDF: Φ(z) = P(Z ≤ z) where Z ~ N(0,1)
 */
export function normalCDF(z: number): number {
  return 0.5 * (1.0 + erf(z / Math.SQRT2));
}

/**
 * Natural log of the Gamma function using Lanczos approximation.
 */
function lnGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (z < 0.5) {
    // Reflection formula
    return (
      Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
    );
  }

  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/**
 * Regularized incomplete beta function I_x(a, b) using a continued fraction expansion.
 * Used for computing the t-distribution CDF.
 */
function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use the symmetry relation when x > (a+1)/(a+b+2) for better convergence
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(
    Math.log(x) * a + Math.log(1 - x) * b - lnBeta
  ) / a;

  // Lentz's continued fraction algorithm
  const maxIter = 200;
  const eps = 3e-14;
  let tiny = 1e-30;

  let f = tiny;
  let C = tiny;
  let D = 0;

  for (let m = 0; m <= maxIter; m++) {
    let numerator: number;

    if (m === 0) {
      numerator = 1;
    } else {
      const k = m;
      const isEven = k % 2 === 0;
      const m2 = k / 2;

      if (isEven) {
        // d_{2m} = m(b-m)x / ((a+2m-1)(a+2m))
        numerator = (m2 * (b - m2) * x) / ((a + 2 * m2 - 1) * (a + 2 * m2));
      } else {
        // d_{2m+1} = -((a+m)(a+b+m)x) / ((a+2m)(a+2m+1))
        const mm = Math.floor(m2);
        numerator =
          -(((a + mm) * (a + b + mm) * x) / ((a + 2 * mm) * (a + 2 * mm + 1)));
      }
    }

    D = 1 + numerator * D;
    if (Math.abs(D) < tiny) D = tiny;
    D = 1 / D;

    C = 1 + numerator / C;
    if (Math.abs(C) < tiny) C = tiny;

    const delta = C * D;
    f *= delta;

    if (Math.abs(delta - 1) < eps) break;
  }

  return front * (f - 1) + (x <= 0 ? 0 : 0);
  // Actually, Lentz's method gives us f directly
}

/**
 * Regularized incomplete beta function - cleaner implementation
 */
function betaIncomplete(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  if (x > (a + 1) / (a + b + 2)) {
    return 1 - betaIncomplete(1 - x, b, a);
  }

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a;

  // Continued fraction using modified Lentz's method
  const maxIter = 200;
  const eps = 3e-14;

  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIter; m++) {
    // Even step: a_{2m}
    let num = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;

    // Odd step: a_{2m+1}
    num = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const delta = d * c;
    h *= delta;

    if (Math.abs(delta - 1) < eps) break;
  }

  return front * h;
}

/**
 * Student's t-distribution CDF: P(T ≤ t) where T ~ t(df)
 * Uses the relationship with the regularized incomplete beta function.
 */
export function tCDF(t: number, df: number): number {
  if (df <= 0) throw new Error("Degrees of freedom must be positive");

  const x = df / (df + t * t);
  const ibeta = betaIncomplete(x, df / 2, 0.5);

  if (t >= 0) {
    return 1 - 0.5 * ibeta;
  } else {
    return 0.5 * ibeta;
  }
}
