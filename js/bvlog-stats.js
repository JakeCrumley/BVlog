// ============================================================
// BVLOG — STATS ENGINE
// ============================================================
// Pure functions: events[] in, numbers out. No DOM, no storage,
// nothing stateful — testable the same way we tested the model,
// straight from the console, before any UI exists.
//
// Depends on PHASES / PHASE_CONFIG / ATTACK_TYPES / KILL_QUALITIES /
// isAttackAttempt() from bvlog-model.js (load that script first).

// ----------------------------
// Helpers
// ----------------------------

// Division that returns null (not NaN/Infinity) when there's no
// denominator yet — e.g. a player who hasn't served this game.
// UI should render null as "—" rather than "0%" (0% implies attempts
// happened and all failed — null means no attempts at all).
function safeDiv(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

// Numeric value of a logged set, for the Average Set Quality formula.
// 'option' is deliberately excluded because it is a setter attack rather
// than a set-quality grade. Error is scored as 0.
function setValue(action) {
  if (action === 'error' || action === 'error_continue' || action === 0 || action === '0') return 0;
  if (action === 1 || action === '1') return 1;
  if (action === 2 || action === '2') return 2;
  if (action === 3 || action === '3') return 3;
  return null; // 'option' (or anything else) — excluded from the average
}

// ----------------------------
// Raw counts
// ----------------------------
// `who` is 'A' | 'B' | 'team'. 'team' includes every event regardless
// of player (including player:null events like opponent_kill) — an
// individual player's totals only include events logged under their
// own letter.
function computeRawCounts(events, who) {
  const counts = {
    serve:      { ace: 0, ko: 0, in_system: 0, error: 0 },
    passing:    { aced: 0, opponent_error: 0, oos: 0, in_system: 0 },
    setting:    { error: 0, error_continue: 0, 1: 0, 2: 0, 3: 0, option: 0, 0: 0, totalValue: 0, valuedAttempts: 0 },
    sideout:    { kill: 0, error: 0, blocked: 0, continue: 0, attempts: 0, attemptedContinue: 0 },
    transition: { kill: 0, error: 0, blocked: 0, continue: 0, attempts: 0, attemptedContinue: 0 },
    defense:    {
      block_kill: 0, block_touch: 0, block_error: 0,
      dig: 0, dig_error: 0,
      opponent_kill: 0, opponent_error: 0,
      receive: 0, dig_return: 0, return: 0,
    },
    // Attack type tallies, combined across Sideout + Transition (per
    // your call to keep Hard-Driven%/Shot%/Freeball% as one combined
    // stat rather than split by phase). Counts EVERY attack action
    // regardless of whether it counted as an "attempt" — this answers
    // "what % of our attacks were each type," a different question
    // than the attempt-based efficiency stats.
    attackTypes: { hard_driven: 0, shot: 0, freeball: 0, totalAttacks: 0 },
    // Kill quality tally, combined across ace + Sideout kill + Transition kill.
    killQuality: { no_contact: 0, semi_contact: 0, full_contact: 0, opponent_error: 0, totalKills: 0 },
  };

  for (const e of events) {
    if (who !== 'team' && e.player !== who) continue;

    if (e.phase === PHASES.SIDEOUT || e.phase === PHASES.TRANSITION) {
      const bucket = counts[e.phase];
      // An opponent error is logged through the kill-quality follow-up,
      // but it is not a player kill. Count it as a continue in the player
      // attack totals and efficiency calculations.
      const isOpponentErrorKill = e.action === 'kill'
        && e.killQuality === KILL_QUALITIES.OPPONENT_ERROR;
      const statAction = isOpponentErrorKill ? 'continue' : e.action;

      if (statAction in bucket) {
        bucket[statAction]++;
        if (isAttackAttempt(statAction, e.attackType, e.attackSource)) {
          bucket.attempts++;
          if (statAction === 'continue') bucket.attemptedContinue++;
        }
      }
      if (e.attackType && e.attackType in counts.attackTypes) {
        counts.attackTypes[e.attackType]++;
        counts.attackTypes.totalAttacks++;
      }
      if (e.action === 'kill' && e.killQuality) {
        if (e.killQuality in counts.killQuality) counts.killQuality[e.killQuality]++;
        if (e.killQuality !== KILL_QUALITIES.OPPONENT_ERROR) counts.killQuality.totalKills++;
      }
      continue;
    }

    if (e.phase === PHASES.SERVE && e.action === 'ace' && e.killQuality) {
      if (e.killQuality in counts.killQuality) counts.killQuality[e.killQuality]++;
      counts.killQuality.totalKills++;
    }

    if (e.phase === PHASES.SETTING) {
      if (e.action in counts.setting) counts.setting[e.action]++;
      const val = setValue(e.action);
      if (val !== null) {
        counts.setting.totalValue += val;
        counts.setting.valuedAttempts++;
      }
      continue;
    }

    if (!counts[e.phase] || !(e.action in counts[e.phase])) continue;
    counts[e.phase][e.action]++;
  }

  // Attempt totals — the denominators for the original efficiency %s.
  counts.serve.attempts = counts.serve.ace + counts.serve.ko + counts.serve.in_system + counts.serve.error;
  counts.passing.attempts = counts.passing.aced + counts.passing.oos + counts.passing.in_system;
  // NOTE: sideout.attempts / transition.attempts are now accumulated
  // event-by-event above (via isAttackAttempt), not summed from the
  // action tallies — attempt status depends on outcome and source.

  return counts;
}

// ----------------------------
// Full stat line (raw counts + every formula)
// ----------------------------
function computeStats(events, who) {
  const c = computeRawCounts(events, who);

  // --- Spec'd efficiency formulas ---
  const koPct       = safeDiv(c.serve.ace + c.serve.ko, c.serve.attempts);
  const wKoPct       = safeDiv(c.serve.ace + 0.75 * c.serve.ko + 0.25 * c.serve.in_system, c.serve.attempts);
  const firstBallEff  = safeDiv(c.sideout.kill, c.sideout.attempts);
  // NOTE: uses attemptedContinue (continues that counted as an attack
  // attempt), not the raw continue count — a freeball-continue isn't
  // an attempt, so it can't contribute to the numerator here either,
  // or the weighted % could exceed 100%.
  const wFirstBallEff = safeDiv(c.sideout.kill + 0.25 * c.sideout.attemptedContinue, c.sideout.attempts);
  const transitionEff  = safeDiv(c.transition.kill, c.transition.attempts);
  const wTransitionEff = safeDiv(c.transition.kill + 0.25 * c.transition.attemptedContinue, c.transition.attempts);
  const passPct = safeDiv(c.passing.in_system, c.passing.attempts);

  // --- Points gained ---
  const servingPointsGained    = c.serve.ace - c.serve.error;
  const sideoutPointsGained    = c.sideout.kill - c.sideout.error;
  const transitionPointsGained = c.transition.kill - c.transition.error;
  const blockingPointsGained   = c.defense.block_kill - c.defense.block_error;

  // "All kills/aces": every way this player/team directly won a
  // point by their own attack — serve aces, sideout kills,
  // transition kills, block kills. (Opponent errors are a point won,
  // but not a kill/ace of yours, so they're excluded here.)
  const totalKillsAces = c.serve.ace + c.sideout.kill + c.transition.kill + c.defense.block_kill;

  // "All errors": every point-ending error above, PLUS dig errors,
  // getting aced on a pass, and the point-ending setting error.
  // Error (Continue) is intentionally excluded because it keeps the
  // rally alive and does not award a point to the opponent.
  const settingPointEndErrors = c.setting.error;
  const totalErrors =
    c.serve.error +
    c.sideout.error +
    c.transition.error +
    c.defense.block_error +
    c.defense.dig_error +
    c.passing.aced +
    settingPointEndErrors;

  const totalPointsGained = totalKillsAces - totalErrors;

  // --- New formulas ---
  const avgSetQuality = safeDiv(c.setting.totalValue, c.setting.valuedAttempts);

  // Quality Kill% denominator = all logged kills (ace + sideout kill +
  // transition kill) that were tagged with a kill quality.
  const qualityKillPct = safeDiv(
    c.killQuality.no_contact + c.killQuality.semi_contact,
    c.killQuality.totalKills
  );

  const hardDrivenPct = safeDiv(c.attackTypes.hard_driven, c.attackTypes.totalAttacks);
  const shotPct       = safeDiv(c.attackTypes.shot, c.attackTypes.totalAttacks);
  const freeballPct   = safeDiv(c.attackTypes.freeball, c.attackTypes.totalAttacks);

  return {
    raw: c,
    koPct,
    wKoPct,
    firstBallEff,
    wFirstBallEff,
    transitionEff,
    wTransitionEff,
    passPct,
    servingPointsGained,
    sideoutPointsGained,
    transitionPointsGained,
    blockingPointsGained,
    totalKillsAces,
    totalErrors,
    totalPointsGained,
    avgSetQuality,
    qualityKillPct,
    hardDrivenPct,
    shotPct,
    freeballPct,
  };
}

// ----------------------------
// Whole-game report: team + both players in one call
// ----------------------------
function computeGameStats(game, scope = 'match') {
  const events = getGameEventsForScope(game, scope);
  return {
    team:    computeStats(events, 'team'),
    playerA: computeStats(events, 'A'),
    playerB: computeStats(events, 'B'),
  };
}

// Aggregate an individual player's events across every completed saved game. Player
// identity is stored on the game, while event.player is only the side ('A'
// or 'B'), so each game's side is mapped back to its player id before the
// event streams are combined.
function computePlayerStatsAcrossGames(games, scope = 'match') {
  const byPlayerId = new Map();

  for (const game of games || []) {
    if (!game.isComplete) continue;

    const sides = [
      { playerId: game.playerAId, side: 'A' },
      { playerId: game.playerBId, side: 'B' },
    ];

    for (const { playerId, side } of sides) {
      if (!playerId) continue;

      if (!byPlayerId.has(playerId)) {
        byPlayerId.set(playerId, {
          playerId,
          gameCount: 0,
          events: [],
        });
      }

      const entry = byPlayerId.get(playerId);
      const scopedEvents = getGameEventsForScope(game, scope);
      const playerEvents = scopedEvents.filter((event) => event.player === side);
      if (playerEvents.length === 0) continue;

      entry.gameCount++;
      entry.setCount = (entry.setCount || 0) + new Set(
        playerEvents.map((event) => getEventSetNumber(game, event)),
      ).size;

      entry.events.push(...playerEvents);
    }
  }

  return [...byPlayerId.values()].map((entry) => ({
    playerId: entry.playerId,
    gameCount: entry.gameCount,
    setCount: entry.setCount || entry.gameCount,
    stats: computeStats(entry.events, 'team'),
  }));
}
