import assert from "node:assert/strict";
import { test } from "vitest";
import {
  TRUESKILL,
  confidence,
  conservativeRating,
  matchQuality,
  rate1v1,
} from "./trueskill.ts";
import { selectOpponent } from "./rating-selection.ts";

const initial = { mu: TRUESKILL.initialMu, sigma: TRUESKILL.initialSigma };

test("a win raises the winner's mean and lowers both uncertainties", () => {
  const rated = rate1v1(initial, initial, "agent1");
  assert.ok(rated.agent1.mu > initial.mu);
  assert.ok(rated.agent2.mu < initial.mu);
  assert.ok(rated.agent1.sigma < initial.sigma);
  assert.ok(rated.agent2.sigma < initial.sigma);
  assert.ok(conservativeRating(rated.agent1) > conservativeRating(rated.agent2));
});

test("a draw leaves equal players equal while reducing uncertainty", () => {
  const rated = rate1v1(initial, initial, "draw");
  assert.ok(Math.abs(rated.agent1.mu - rated.agent2.mu) < 1e-10);
  assert.ok(rated.agent1.sigma < initial.sigma);
  assert.ok(rated.agent2.sigma < initial.sigma);
});

test("a draw brings unequal players' means closer together", () => {
  const stronger = { mu: 30, sigma: 5 };
  const weaker = { mu: 20, sigma: 5 };
  const rated = rate1v1(stronger, weaker, "draw");
  assert.ok(rated.agent1.mu < stronger.mu);
  assert.ok(rated.agent2.mu > weaker.mu);
  const reversed = rate1v1(weaker, stronger, "draw");
  assert.ok(Math.abs(rated.agent1.mu - reversed.agent2.mu) < 1e-10);
});

test("match quality favors nearby ratings and confidence rises as sigma falls", () => {
  const close = matchQuality(initial, { mu: 25.5, sigma: initial.sigma });
  const far = matchQuality(initial, { mu: 45, sigma: initial.sigma });
  assert.ok(close > far);
  assert.equal(confidence(initial), 0);
  assert.ok(confidence({ mu: 25, sigma: initial.sigma / 2 }) > 0);
});

test("scheduler excludes same-user agents and avoids an immediate rematch", () => {
  const focal = { id: 1, user_id: 10, trueskill_mu: 25, trueskill_sigma: 8 };
  const sameUser = { id: 2, user_id: 10, trueskill_mu: 25, trueskill_sigma: 8 };
  const closest = { id: 3, user_id: 20, trueskill_mu: 25.1, trueskill_sigma: 8 };
  const alternative = { id: 4, user_id: 30, trueskill_mu: 26, trueskill_sigma: 8 };
  assert.equal(selectOpponent(focal, [focal, sameUser, closest, alternative])?.id, closest.id);
  assert.equal(selectOpponent(focal, [focal, sameUser, closest, alternative], { agent1_id: 1, agent2_id: 3 })?.id, alternative.id);
});
