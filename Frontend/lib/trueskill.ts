export type TrueSkillRating = { mu: number; sigma: number };
export type TrueSkillOutcome = "agent1" | "agent2" | "draw";

export const TRUESKILL = {
  initialMu: 25,
  initialSigma: 25 / 3,
  beta: 25 / 6,
  tau: 25 / 300,
  drawProbability: 0.1,
} as const;

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * Math.abs(x));
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return sign * y;
}

function pdf(x: number) { return Math.exp(-0.5 * x * x) / SQRT_2PI; }
function cdf(x: number) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

// Peter John Acklam's inverse-normal approximation; accurate enough for draw margin.
function invCdf(p: number): number {
  if (p <= 0 || p >= 1) throw new RangeError("p must be in (0, 1)");
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  if (p < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - 0.02425) return -invCdf(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function safeDiv(n: number, d: number) { return n / Math.max(d, 1e-12); }

export function conservativeRating({ mu, sigma }: TrueSkillRating) {
  return Math.round(1000 + 40 * (mu - 3 * sigma));
}

export function confidence({ sigma }: TrueSkillRating) {
  return Math.max(0, Math.min(100, Math.round((1 - sigma / TRUESKILL.initialSigma) * 100)));
}

export function matchQuality(a: TrueSkillRating, b: TrueSkillRating) {
  const variance = a.sigma ** 2 + b.sigma ** 2 + 2 * TRUESKILL.beta ** 2;
  return Math.sqrt((2 * TRUESKILL.beta ** 2) / variance) * Math.exp(-((a.mu - b.mu) ** 2) / (2 * variance));
}

export function rate1v1(a: TrueSkillRating, b: TrueSkillRating, outcome: TrueSkillOutcome) {
  const sigmaA2 = a.sigma ** 2 + TRUESKILL.tau ** 2;
  const sigmaB2 = b.sigma ** 2 + TRUESKILL.tau ** 2;
  const c = Math.sqrt(2 * TRUESKILL.beta ** 2 + sigmaA2 + sigmaB2);
  const drawMargin = Math.SQRT2 * TRUESKILL.beta * invCdf((TRUESKILL.drawProbability + 1) / 2);
  const delta = a.mu - b.mu;
  let v: number, w: number, rank = 0;

  if (outcome === "draw") {
    const lower = safeDiv(-drawMargin - delta, c);
    const upper = safeDiv(drawMargin - delta, c);
    const denom = Math.max(cdf(upper) - cdf(lower), 1e-12);
    v = safeDiv(pdf(lower) - pdf(upper), denom);
    w = v * v + safeDiv(upper * pdf(upper) - lower * pdf(lower), denom);
  } else {
    rank = outcome === "agent1" ? 1 : -1;
    const t = safeDiv(rank * delta - drawMargin, c);
    v = safeDiv(pdf(t), cdf(t));
    w = v * (v + t);
  }

  const multiplier = rank / c;
  const shrink = w / (c * c);
  return {
    agent1: {
      mu: a.mu + multiplier * sigmaA2 * v,
      sigma: Math.sqrt(Math.max(1e-9, sigmaA2 * (1 - sigmaA2 * shrink))),
    },
    agent2: {
      mu: b.mu - multiplier * sigmaB2 * v,
      sigma: Math.sqrt(Math.max(1e-9, sigmaB2 * (1 - sigmaB2 * shrink))),
    },
  };
}
