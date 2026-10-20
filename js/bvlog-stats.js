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
      block_kill: 0, block_touch: 0, block_return: 0, block_error: 0,
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
    // Kill quality tally. The original combined fields are retained for
    // backwards-compatible raw-stat consumers, while the separated attack
    // and ace fields keep Quality Kill% from being diluted by aces.
    killQuality: {
      no_contact: 0, semi_contact: 0, full_contact: 0, opponent_error: 0, totalKills: 0,
      attackNoContact: 0, attackSemiContact: 0, attackFullContact: 0,
      attackOpponentError: 0, attackTotalKills: 0,
      aceNoContact: 0, aceSemiContact: 0, aceFullContact: 0,
      aceOpponentError: 0, aceTotal: 0,
    },
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
        if (e.killQuality === KILL_QUALITIES.NO_CONTACT) counts.killQuality.attackNoContact++;
        if (e.killQuality === KILL_QUALITIES.SEMI_CONTACT) counts.killQuality.attackSemiContact++;
        if (e.killQuality === KILL_QUALITIES.FULL_CONTACT) counts.killQuality.attackFullContact++;
        if (e.killQuality === KILL_QUALITIES.OPPONENT_ERROR) counts.killQuality.attackOpponentError++;
        if (e.killQuality !== KILL_QUALITIES.OPPONENT_ERROR) counts.killQuality.attackTotalKills++;
      }
      continue;
    }

    if (e.phase === PHASES.SERVE && e.action === 'ace' && e.killQuality) {
      if (e.killQuality in counts.killQuality) counts.killQuality[e.killQuality]++;
      counts.killQuality.totalKills++;
      if (e.killQuality === KILL_QUALITIES.NO_CONTACT) counts.killQuality.aceNoContact++;
      if (e.killQuality === KILL_QUALITIES.SEMI_CONTACT) counts.killQuality.aceSemiContact++;
      if (e.killQuality === KILL_QUALITIES.FULL_CONTACT) counts.killQuality.aceFullContact++;
      if (e.killQuality === KILL_QUALITIES.OPPONENT_ERROR) counts.killQuality.aceOpponentError++;
      if (e.killQuality !== KILL_QUALITIES.OPPONENT_ERROR) counts.killQuality.aceTotal++;
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

    // Passing Return is a defensive continuation, but its passing grade is
    // equivalent to an OOS pass for all passing totals and efficiencies.
    if (e.phase === PHASES.PASSING && e.action === 'return') {
      counts.passing.oos++;
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
function computePointTotals(events) {
  const totals = { team: 0, opponent: 0 };
  for (const event of events || []) {
    const actionConfig = PHASE_CONFIG[event?.phase]?.actions?.[event?.action];
    if (!actionConfig?.endsPoint || !actionConfig.winner) continue;
    totals[actionConfig.winner]++;
  }
  return totals;
}

function computeStats(events, who, pointTotals = null) {
  const c = computeRawCounts(events, who);
  const points = pointTotals || computePointTotals(events);

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
  const ptPct = safeDiv(points.team, points.opponent);

  // --- New formulas ---
  const avgSetQuality = safeDiv(c.setting.totalValue, c.setting.valuedAttempts);

  // Quality Kill% is intentionally attack-only. Aces have their own quality
  // metric so a strong serving night cannot change attack quality.
  const qualityKillPct = safeDiv(
    c.killQuality.attackNoContact + c.killQuality.attackSemiContact,
    c.killQuality.attackTotalKills
  );
  const qualityAcePct = safeDiv(
    c.killQuality.aceNoContact + c.killQuality.aceSemiContact,
    c.killQuality.aceTotal
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
    ptPct,
    avgSetQuality,
    qualityKillPct,
    qualityAcePct,
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
  const pointTotals = computePointTotals(events);
  return {
    team:    computeStats(events, 'team', pointTotals),
    playerA: computeStats(events, 'A', pointTotals),
    playerB: computeStats(events, 'B', pointTotals),
  };
}

// ----------------------------
// Statistical breakdowns
// ----------------------------
// These reports intentionally work from the event stream instead of from the
// already-aggregated stat line. That preserves the context around an event —
// for example, which pass led to a set, or which set quality led to an attack.

function breakdownQualityLabel(value) {
  return {
    [KILL_QUALITIES.NO_CONTACT]: 'No-contact',
    [KILL_QUALITIES.SEMI_CONTACT]: 'Semi-contact',
    [KILL_QUALITIES.FULL_CONTACT]: 'Full-contact',
    [KILL_QUALITIES.OPPONENT_ERROR]: 'Opponent error',
  }[value] || value;
}

function breakdownAttackLabel(value) {
  return {
    [ATTACK_TYPES.HARD_DRIVEN]: 'Hard-driven',
    [ATTACK_TYPES.SHOT]: 'Shot',
    [ATTACK_TYPES.FREEBALL]: 'Free ball',
  }[value] || value;
}

function breakdownScopeEvents(game, scope) {
  return getGameEventsForScope(game, scope).filter((event) => event?.type !== 'server_swap');
}

function breakdownContexts(games, playerId, scope) {
  const contexts = [];
  for (const game of games || []) {
    if (!game?.isComplete) continue;
    const playerSide = playerId
      ? game.playerAId === playerId ? 'A' : game.playerBId === playerId ? 'B' : null
      : null;
    if (playerId && !playerSide) continue;

    const excludedSides = new Set();
    const lookupPlayer = typeof findPlayerById === 'function' ? findPlayerById : () => null;
    if (!playerId && lookupPlayer(game.playerAId)?.practicePlayer) excludedSides.add('A');
    if (!playerId && lookupPlayer(game.playerBId)?.practicePlayer) excludedSides.add('B');
    const events = breakdownScopeEvents(game, scope);
    const owned = (event) => {
      if (playerId) return event.player === playerSide;
      return !event.player || !excludedSides.has(event.player);
    };
    const pointGroups = new Map();
    for (const event of events) {
      const key = `${event.setNumber || 1}:${event.pointNumber ?? 'unknown'}`;
      if (!pointGroups.has(key)) pointGroups.set(key, []);
      pointGroups.get(key).push(event);
    }
    contexts.push({ game, events, owned, pointGroups });
  }
  return contexts;
}

function breakdownIsAttack(event, phases = null) {
  return Boolean(event)
    && (!phases || phases.includes(event.phase))
    && (event.action === 'kill' || event.action === 'error'
      || event.action === 'blocked' || event.action === 'continue')
    && (event.phase === PHASES.SIDEOUT || event.phase === PHASES.TRANSITION);
}

function breakdownAttackAction(event) {
  return event?.action === 'kill' && event.killQuality === KILL_QUALITIES.OPPONENT_ERROR
    ? 'continue'
    : event?.action;
}

function breakdownAttempt(event) {
  return breakdownIsAttack(event) && isAttackAttempt(
    breakdownAttackAction(event), event.attackType, event.attackSource,
  );
}

function breakdownFindPrior(events, index, predicate) {
  const target = events[index];
  for (let i = index - 1; i >= 0; i--) {
    if (!breakdownSamePoint(target, events[i])) break;
    if (predicate(events[i])) return events[i];
  }
  return null;
}

function breakdownFindNext(events, index, predicate) {
  const target = events[index];
  for (let i = index + 1; i < events.length; i++) {
    if (!breakdownSamePoint(target, events[i])) break;
    if (predicate(events[i])) return events[i];
  }
  return null;
}

function breakdownSamePoint(first, second) {
  if (!first || !second) return false;
  const firstPoint = first.pointNumber;
  const secondPoint = second.pointNumber;
  if (firstPoint === undefined || firstPoint === null || secondPoint === undefined || secondPoint === null) {
    return true;
  }
  return Number(first.setNumber || 1) === Number(second.setNumber || 1)
    && Number(firstPoint) === Number(secondPoint);
}

function breakdownPriorSet(events, index) {
  return breakdownFindPrior(events, index, (event) => event.phase === PHASES.SETTING);
}

function breakdownPriorPass(events, index) {
  return breakdownFindPrior(events, index, (event) => event.phase === PHASES.PASSING);
}

function breakdownPriorDefense(events, index) {
  return breakdownFindPrior(events, index, (event) => event.phase === PHASES.DEFENSE);
}

function breakdownPassSource(event) {
  if (!event) return null;
  if (event.action === 'in_system') return 'in_system';
  if (event.action === 'oos' || event.action === 'return') return 'oos';
  return null;
}

function breakdownDefenseSource(event) {
  if (!event) return null;
  if (event.action === 'receive') return 'freeball';
  if (event.action === 'dig' || event.action === 'dig_return') return 'dig';
  return null;
}

function breakdownAttackTypeRows(contexts, phases) {
  const types = [ATTACK_TYPES.HARD_DRIVEN, ATTACK_TYPES.SHOT, ATTACK_TYPES.FREEBALL];
  const totals = new Map(types.map((type) => [type, {
    attempts: 0, kills: 0, errors: 0, blocked: 0, continues: 0,
    noContact: 0, semiContact: 0, fullContact: 0, qualityTotal: 0,
  }]));

  for (const context of contexts) {
    context.events.forEach((event) => {
      if (!context.owned(event) || !breakdownIsAttack(event, phases) || !totals.has(event.attackType)) return;
      const row = totals.get(event.attackType);
      const action = breakdownAttackAction(event);
      if (breakdownAttempt(event)) row.attempts++;
      if (action === 'kill') row.kills++;
      if (action === 'error') row.errors++;
      if (action === 'blocked') row.blocked++;
      if (action === 'continue') row.continues++;
      if (event.killQuality && event.killQuality !== KILL_QUALITIES.OPPONENT_ERROR) {
        row.qualityTotal++;
        if (event.killQuality === KILL_QUALITIES.NO_CONTACT) row.noContact++;
        if (event.killQuality === KILL_QUALITIES.SEMI_CONTACT) row.semiContact++;
        if (event.killQuality === KILL_QUALITIES.FULL_CONTACT) row.fullContact++;
      }
    });
  }

  return types.map((type) => {
    const row = totals.get(type);
    return {
      label: breakdownAttackLabel(type),
      attempts: row.attempts,
      kills: row.kills,
      errors: row.errors,
      blocked: row.blocked,
      continues: row.continues,
      efficiency: safeDiv(row.kills, row.attempts),
      noContact: safeDiv(row.noContact, row.qualityTotal),
      semiContact: safeDiv(row.semiContact, row.qualityTotal),
      fullContact: safeDiv(row.fullContact, row.qualityTotal),
    };
  });
}

function breakdownAttackSourceRows(contexts, phases, sourceType) {
  const sources = sourceType === 'pass'
    ? [['in_system', 'In-system'], ['oos', 'OOS']]
    : [['freeball', 'Freeball receive'], ['dig', 'Dig']];
  const totals = new Map(sources.map(([key]) => [key, { attempts: 0, kills: 0 }]));
  for (const context of contexts) {
    context.events.forEach((event, index) => {
      if (!context.owned(event) || !breakdownIsAttack(event, phases)) return;
      const prior = sourceType === 'pass'
        ? breakdownPassSource(breakdownPriorPass(context.events, index))
        : breakdownDefenseSource(breakdownPriorDefense(context.events, index));
      if (!totals.has(prior)) return;
      const row = totals.get(prior);
      if (breakdownAttempt(event)) row.attempts++;
      if (breakdownAttackAction(event) === 'kill') row.kills++;
    });
  }
  const totalKills = [...totals.values()].reduce((sum, row) => sum + row.kills, 0);
  return sources.map(([key, label]) => ({
    label,
    attempts: totals.get(key).attempts,
    kills: totals.get(key).kills,
    efficiency: safeDiv(totals.get(key).kills, totals.get(key).attempts),
    killShare: safeDiv(totals.get(key).kills, totalKills),
  }));
}

function breakdownOptionRows(contexts, phases) {
  const row = { attempts: 0, kills: 0, errors: 0 };
  for (const context of contexts) {
    context.events.forEach((event, index) => {
      if (!context.owned(event) || !breakdownIsAttack(event, phases)) return;
      const prior = breakdownPriorSet(context.events, index);
      if (prior?.action !== 'option') return;
      if (breakdownAttempt(event)) row.attempts++;
      if (breakdownAttackAction(event) === 'kill') row.kills++;
      if (breakdownAttackAction(event) === 'error') row.errors++;
    });
  }
  return [{ label: 'Option attacks', ...row, efficiency: safeDiv(row.kills, row.attempts) }];
}

function breakdownSetQualityRows(contexts, phases) {
  const totals = new Map(['1', '2', '3'].map((quality) => [quality, { attempts: 0, kills: 0 }]));
  for (const context of contexts) {
    context.events.forEach((event, index) => {
      if (!context.owned(event) || !breakdownIsAttack(event, phases)) return;
      const prior = breakdownPriorSet(context.events, index);
      const quality = prior && ['1', '2', '3'].includes(String(prior.action)) ? String(prior.action) : null;
      if (!quality) return;
      const row = totals.get(quality);
      if (breakdownAttempt(event)) row.attempts++;
      if (breakdownAttackAction(event) === 'kill') row.kills++;
    });
  }
  return ['1', '2', '3'].map((quality) => ({
    label: `Set quality ${quality}`,
    attempts: totals.get(quality).attempts,
    kills: totals.get(quality).kills,
    efficiency: safeDiv(totals.get(quality).kills, totals.get(quality).attempts),
  }));
}

function breakdownContinueRows(contexts, phases) {
  let continues = 0;
  let opponentKills = 0;
  for (const context of contexts) {
    for (const events of context.pointGroups.values()) {
      events.forEach((event, index) => {
        if (!context.owned(event) || !phases.includes(event.phase) || event.action !== 'continue') return;
        continues++;
        const nextPointEnd = breakdownFindNext(events, index, (candidate) =>
          candidate.phase === PHASES.DEFENSE && ['opponent_kill', 'opponent_error', 'block_kill', 'block_error', 'dig_error'].includes(candidate.action));
        if (nextPointEnd?.action === 'opponent_kill') opponentKills++;
      });
    }
  }
  return [{ label: 'Opponent transition kills after continue', continues, opponentKills, percentage: safeDiv(opponentKills, continues) }];
}

function breakdownSettingRows(contexts, sourceType) {
  const sources = sourceType === 'pass'
    ? [['in_system', 'In-system'], ['oos', 'OOS']]
    : [['dig', 'Dig'], ['freeball', 'Freeball']];
  const totals = new Map(sources.map(([key]) => [key, { sets: 0, totalQuality: 0, one: 0, two: 0, three: 0 }]));
  for (const context of contexts) {
    context.events.forEach((event, index) => {
      if (!context.owned(event) || event.phase !== PHASES.SETTING) return;
      const quality = setValue(event.action);
      if (quality === null) return;
      const prior = sourceType === 'pass'
        ? breakdownPassSource(breakdownPriorPass(context.events, index))
        : breakdownDefenseSource(breakdownPriorDefense(context.events, index));
      if (!totals.has(prior)) return;
      const row = totals.get(prior);
      row.sets++;
      row.totalQuality += quality;
      if (quality === 1) row.one++;
      if (quality === 2) row.two++;
      if (quality === 3) row.three++;
    });
  }
  return sources.map(([key, label]) => {
    const row = totals.get(key);
    return {
      label,
      sets: row.sets,
      average: safeDiv(row.totalQuality, row.sets),
      quality1: safeDiv(row.one, row.sets),
      quality2: safeDiv(row.two, row.sets),
      quality3: safeDiv(row.three, row.sets),
    };
  });
}

function breakdownKillAfterSetRows(contexts) {
  const totals = new Map(['1', '2', '3'].map((quality) => [quality, { attempts: 0, kills: 0 }]));
  for (const context of contexts) {
    context.events.forEach((event, index) => {
      if (!context.owned(event) || !breakdownIsAttack(event)) return;
      const prior = breakdownPriorSet(context.events, index);
      const quality = prior && ['1', '2', '3'].includes(String(prior.action)) ? String(prior.action) : null;
      if (!quality) return;
      const row = totals.get(quality);
      if (breakdownAttempt(event)) row.attempts++;
      if (breakdownAttackAction(event) === 'kill') row.kills++;
    });
  }
  return ['1', '2', '3'].map((quality) => ({
    label: `Set quality ${quality}`,
    attempts: totals.get(quality).attempts,
    kills: totals.get(quality).kills,
    killPct: safeDiv(totals.get(quality).kills, totals.get(quality).attempts),
  }));
}

function statisticalBreakdownColumns(kind) {
  const columns = {
    attack: [
      ['Attempts', 'attempts', 'number'], ['Kills', 'kills', 'number'],
      ['Errors', 'errors', 'number'], ['Blocked', 'blocked', 'number'],
      ['Continues', 'continues', 'number'], ['Eff%', 'efficiency', 'percent'],
      ['No-contact%', 'noContact', 'percent'], ['Semi-contact%', 'semiContact', 'percent'],
      ['Full-contact%', 'fullContact', 'percent'],
    ],
    sourceAttack: [['Attempts', 'attempts', 'number'], ['Kills', 'kills', 'number'], ['Kill share%', 'killShare', 'percent'], ['Eff%', 'efficiency', 'percent']],
    option: [['Attempts', 'attempts', 'number'], ['Kills', 'kills', 'number'], ['Errors', 'errors', 'number'], ['Eff%', 'efficiency', 'percent']],
    setQuality: [['Attempts', 'attempts', 'number'], ['Kills', 'kills', 'number'], ['Eff%', 'efficiency', 'percent']],
    setting: [['Sets', 'sets', 'number'], ['Average quality', 'average', 'decimal'], ['Quality 1%', 'quality1', 'percent'], ['Quality 2%', 'quality2', 'percent'], ['Quality 3%', 'quality3', 'percent']],
    killAfterSet: [['Attempts', 'attempts', 'number'], ['Kills', 'kills', 'number'], ['Kill%', 'killPct', 'percent']],
    continue: [['Continues', 'continues', 'number'], ['Opponent transition kills', 'opponentKills', 'number'], ['Kill%', 'percentage', 'percent']],
    serving: [['Aces', 'aces', 'number'], ['% of aces', 'percentage', 'percent']],
    servingResult: [['Serves', 'serves', 'number'], ['Opponent sideout kills', 'opponentKills', 'number'], ['Kill%', 'percentage', 'percent']],
    points: [['Points gained', 'value', 'number']],
  };
  return (columns[kind] || []).map(([label, key, format]) => ({ label, key, format }));
}

function computeStatisticalBreakdown(games, tab = 'serving', playerId = '', scope = 'match') {
  const contexts = breakdownContexts(games, playerId, scope);
  const sections = [];
  const add = (title, kind, rows) => sections.push({ title, columns: statisticalBreakdownColumns(kind), rows });
  const attackPhases = tab === 'sideout' ? [PHASES.SIDEOUT]
    : tab === 'transition' ? [PHASES.TRANSITION]
    : [PHASES.SIDEOUT, PHASES.TRANSITION];

  if (tab === 'serving') {
    const contactQualities = [
      KILL_QUALITIES.NO_CONTACT,
      KILL_QUALITIES.SEMI_CONTACT,
      KILL_QUALITIES.FULL_CONTACT,
    ];
    const qualityValues = contactQualities.map((quality) => ({ label: breakdownQualityLabel(quality), aces: 0 }));
    const qualityMap = new Map(contactQualities.map((quality, index) => [quality, qualityValues[index]]));
    let totalAces = 0;
    let totalServes = 0;
    const resultTotals = new Map([['ko', { serves: 0, opponentKills: 0 }], ['in_system', { serves: 0, opponentKills: 0 }]]);
    for (const context of contexts) {
      context.events.forEach((event) => {
        if (!context.owned(event) || event.phase !== PHASES.SERVE) return;
        totalServes++;
        if (event.action === 'ace' && event.killQuality !== KILL_QUALITIES.OPPONENT_ERROR) {
          totalAces++;
          if (qualityMap.has(event.killQuality)) qualityMap.get(event.killQuality).aces++;
        }
      });
      for (const events of context.pointGroups.values()) {
        events.forEach((event, index) => {
          if (!context.owned(event) || event.phase !== PHASES.SERVE || !resultTotals.has(event.action)) return;
          const row = resultTotals.get(event.action);
          row.serves++;
          const nextEnd = breakdownFindNext(events, index, (candidate) => candidate.phase === PHASES.DEFENSE && ['opponent_kill', 'opponent_error', 'block_kill', 'block_error', 'dig_error'].includes(candidate.action));
          if (nextEnd?.action === 'opponent_kill') row.opponentKills++;
        });
      }
    }
    add('Opponent contact on aces', 'serving', qualityValues.map((row) => ({ ...row, percentage: safeDiv(row.aces, totalAces) })));
    add('Opponent sideout kills after serve result', 'servingResult', [
      { label: 'KO', ...resultTotals.get('ko'), percentage: safeDiv(resultTotals.get('ko').opponentKills, resultTotals.get('ko').serves) },
      { label: 'In-system', ...resultTotals.get('in_system'), percentage: safeDiv(resultTotals.get('in_system').opponentKills, resultTotals.get('in_system').serves) },
    ]);
    sections[0].totalAces = totalAces;
    sections[1].totalServes = totalServes;
  } else if (tab === 'sideout' || tab === 'transition' || tab === 'allAttacking') {
    add('Attack type performance', 'attack', breakdownAttackTypeRows(contexts, attackPhases));
    add('Opponent transition kills after continue', 'continue', breakdownContinueRows(contexts, attackPhases));
    if (tab === 'sideout') add('Sideout attack source', 'sourceAttack', breakdownAttackSourceRows(contexts, attackPhases, 'pass'));
    if (tab === 'transition') add('Transition attack source', 'sourceAttack', breakdownAttackSourceRows(contexts, attackPhases, 'defense'));
    add('Option attack efficiency', 'option', breakdownOptionRows(contexts, attackPhases));
    add('Efficiency by set quality', 'setQuality', breakdownSetQualityRows(contexts, attackPhases));
  } else if (tab === 'setting') {
    add('Set quality by pass source', 'setting', breakdownSettingRows(contexts, 'pass'));
    add('Set quality by defensive source', 'setting', breakdownSettingRows(contexts, 'defense'));
    add('Kill percentage after set quality', 'killAfterSet', breakdownKillAfterSetRows(contexts));
  } else if (tab === 'points') {
    const allEvents = contexts.flatMap((context) => context.events.filter(context.owned));
    const stats = computeStats(allEvents, 'team');
    add('Points gained by phase', 'points', [
      { label: 'Serving', value: stats.servingPointsGained },
      { label: 'Sideout', value: stats.sideoutPointsGained },
      { label: 'Transition', value: stats.transitionPointsGained },
      { label: 'Blocking', value: stats.blockingPointsGained },
    ]);
    add('Total points and scoring events', 'points', [
      { label: 'Total kills / aces', value: stats.totalKillsAces },
      { label: 'Total errors', value: stats.totalErrors },
      { label: 'Total points gained', value: stats.totalPointsGained },
    ]);
  }

  return {
    sections,
    gameCount: contexts.length,
    setCount: contexts.length,
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

      const pointTotals = computePointTotals(scopedEvents);

      entry.gameCount++;
      entry.pointTotals = entry.pointTotals || { team: 0, opponent: 0 };
      entry.pointTotals.team += pointTotals.team;
      entry.pointTotals.opponent += pointTotals.opponent;
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
    stats: computeStats(entry.events, 'team', entry.pointTotals),
  }));
}
