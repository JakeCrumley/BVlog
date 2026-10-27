// ============================================================
// BVLOG — DATA MODEL
// ============================================================
// Core principle: Events are the source of truth. Score, current
// phase, and all stats are *derived* from the event log — never
// stored as separate mutable state. This makes Undo trivial
// (pop the last event, recompute everything) and keeps score/phase
// bugs impossible to desync from the log.

// ----------------------------
// Roster
// ----------------------------

function createPlayer(name) {
  return {
    id: crypto.randomUUID(),
    name,
    practicePlayer: false,
  };
}

// ----------------------------
// Phases & Actions
// ----------------------------
// Only ONE team (your two tracked players) is logged. "Defense" phase
// covers your team's blocking/digging while the opponent attacks.

const PHASES = {
  SERVE: 'serve',
  PASSING: 'passing',
  SETTING: 'setting',
  SIDEOUT: 'sideout',
  TRANSITION: 'transition',
  DEFENSE: 'defense',
};

// Sentinel used as `next` for any action whose destination depends on
// rally state (first attack this rally → Sideout, later → Transition).
// Resolved at replay time by resolveAttackPhase(). Used by: Setting's
// own actions, Passing's "Return" (which goes straight into a Sideout
// attack), and Defense's "Dig Return" (which skips Passing *and* Setting,
// going straight into an attack).
const DYNAMIC_ATTACK = 'dynamic_attack';

// A direct attack created by a defensive Dig Return is tracked separately
// from ordinary attacks, but every resulting attack outcome is still an
// attacking attempt, whether it is a kill, error, continue, or blocked.
const ATTACK_SOURCES = {
  DIG_RETURN: 'dig_return',
};

// Logged alongside every Sideout/Transition outcome (kill/error/
// blocked/continue) as event.attackType — what kind of attack it was.
const ATTACK_TYPES = {
  HARD_DRIVEN: 'hard_driven',
  SHOT: 'shot',
  FREEBALL: 'freeball',
};

// Logged alongside an ace (Serve) or a Sideout/Transition kill as
// event.killQuality — how clean the kill was.
const KILL_QUALITIES = {
  NO_CONTACT: 'no_contact',     // opponent never touched it
  SEMI_CONTACT: 'semi_contact', // opponent got a partial touch
  FULL_CONTACT: 'full_contact', // opponent got a real touch/dig attempt and still lost the point
  OPPONENT_ERROR: 'opponent_error', // credited as a kill, but really an unforced opponent error
};

// Each action is tagged with whether it ends the point, and if so,
// who wins it ('team' | 'opponent'). Actions that don't end the
// point specify the next phase instead (or DYNAMIC_ATTACK — see above).
//
// Defense receive feeds the setter directly; Dig Return skips setting and
// goes straight into the appropriate attack phase. A Passing Return goes
// straight into the Sideout attack screen and is recorded as an OOS passing
// result by the stats engine.

const PHASE_CONFIG = {
  [PHASES.SERVE]: {
    label: 'Serving',
    actions: {
      ace:        { endsPoint: true,  winner: 'team' },
      ko:         { endsPoint: false, next: PHASES.DEFENSE },
      in_system:  { endsPoint: false, next: PHASES.DEFENSE },
      error:      { endsPoint: true,  winner: 'opponent' },
    },
  },

  [PHASES.PASSING]: {
    label: 'Passing',
    actions: {
      aced:       { endsPoint: true,  winner: 'opponent' },
      opponent_error: { endsPoint: true, winner: 'team' },
      oos:        { endsPoint: false, next: PHASES.SETTING },
      in_system:  { endsPoint: false, next: PHASES.SETTING },
      return:     { endsPoint: false, next: DYNAMIC_ATTACK },
    },
  },

  [PHASES.SETTING]: {
    label: 'Setting',
    actions: {
      // Setting is scored 1/2/3 rather than good/bad. A point-ending
      // setting error gives the point to the opponent; an error that
      // goes over the net continues the rally into Defense.
      error:  { endsPoint: true,  winner: 'opponent' },
      error_continue: { endsPoint: false, next: PHASES.DEFENSE },
      1:      { endsPoint: false, next: DYNAMIC_ATTACK },
      2:      { endsPoint: false, next: DYNAMIC_ATTACK },
      3:      { endsPoint: false, next: DYNAMIC_ATTACK },
      option: { endsPoint: false, next: DYNAMIC_ATTACK }, // set up for an "option" attack (setter attacking) — same routing as a normal set
      // Legacy setting value retained so older saved games still replay
      // correctly. New games no longer show this action in the UI.
      0:      { endsPoint: false, next: DYNAMIC_ATTACK },
    },
  },

  // Sideout/Transition outcomes are logged WITH an attackType
  // (hard_driven/shot/freeball — see ATTACK_TYPES) on the event.
  // Whether a given outcome+attackType combo counts as an "attack
  // attempt" for the efficiency stats is resolved dynamically by
  // isAttackAttempt() below, NOT hardcoded per action — a freeball
  // only counts as an attempt if it ends in a kill or an error.
  [PHASES.SIDEOUT]: {
    label: 'Sideout',
    actions: {
      kill:     { endsPoint: true,  winner: 'team' },
      error:    { endsPoint: true,  winner: 'opponent' },
      blocked:  { endsPoint: false, next: PHASES.DEFENSE },
      continue: { endsPoint: false, next: PHASES.DEFENSE },
    },
  },

  [PHASES.TRANSITION]: {
    label: 'Transition',
    actions: {
      kill:     { endsPoint: true,  winner: 'team' },
      error:    { endsPoint: true,  winner: 'opponent' },
      blocked:  { endsPoint: false, next: PHASES.DEFENSE },
      continue: { endsPoint: false, next: PHASES.DEFENSE },
    },
  },

  [PHASES.DEFENSE]: {
    label: 'Defense',
    actions: {
      block_kill:      { endsPoint: true,  winner: 'team' },
      block_touch:     { endsPoint: false, next: PHASES.SETTING }, // a normal block touch keeps the ball on your side → set next
      block_return:    { endsPoint: false, next: PHASES.DEFENSE }, // block return keeps the team defending
      block_error:     { endsPoint: true,  winner: 'opponent' },   // ⚠️ confirm: net violation / ball out off the block → opponent point?
      dig:              { endsPoint: false, next: PHASES.SETTING },
      dig_return:       { endsPoint: false, next: DYNAMIC_ATTACK }, // a dig return becomes a direct attack
      dig_error:        { endsPoint: true,  winner: 'opponent' },  // ⚠️ confirm: ball hits floor on the dig → opponent point?
      opponent_kill:    { endsPoint: true,  winner: 'opponent' },
      opponent_error:   { endsPoint: true,  winner: 'team' },
      receive:          { endsPoint: false, next: PHASES.SETTING }, // a defensive receive feeds the setter directly
      return:           { endsPoint: false, next: DYNAMIC_ATTACK }, // legacy alias for Dig Return
    },
  },
};

// Resolves DYNAMIC_ATTACK. Sideout is ONLY the receiving team's first
// attack of a rally — the serving team's attacks (including its very
// first, after defending the return) are always Transition.
function resolveAttackPhase(startedReceiving, hasAttacked) {
  return (startedReceiving && !hasAttacked) ? PHASES.SIDEOUT : PHASES.TRANSITION;
}

// Whether a Sideout/Transition outcome counts as an "attack attempt"
// for the efficiency stats. Every Dig Return attack counts as an attempt.
// Otherwise, a freeball counts only when it ends in a kill or error;
// hard-driven and shot attacks count regardless of outcome.
function isAttackAttempt(action, attackType, attackSource = null) {
  if (attackSource === ATTACK_SOURCES.DIG_RETURN) {
    return action === 'kill' || action === 'error' || action === 'blocked' || action === 'continue';
  }
  if (attackType === ATTACK_TYPES.FREEBALL) {
    return action === 'kill' || action === 'error';
  }
  return action === 'kill' || action === 'error' || action === 'blocked' || action === 'continue';
}

// ----------------------------
// Event
// ----------------------------

function createEvent({ phase, player, action, pointNumber, setNumber = 1, attackType = null, killQuality = null, attackSource = null }) {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'stat',
    setNumber,
    phase,       // one of PHASES
    player,      // 'A' | 'B' | null (null for e.g. opponent_kill/error)
    action,      // key into PHASE_CONFIG[phase].actions
    pointNumber, // which rally this belongs to (increments after each PointEnd)
    attackType,  // one of ATTACK_TYPES, only set on Sideout/Transition events
    killQuality, // one of KILL_QUALITIES, only set on ace/Sideout-kill/Transition-kill events
    attackSource, // e.g. ATTACK_SOURCES.DIG_RETURN for a direct defensive return
  };
}

// ----------------------------
// Game
// ----------------------------

function createGame({ playerAId, playerBId, opponentName, startingAction, playedDate }) {
  // startingAction: 'serve' | 'receive' — determines the opening phase
  // playerAId/playerBId: Roster player ids (NOT the player objects
  // themselves) — look the current name up with findPlayerById()
  // from bvlog-storage.js whenever you display it. That way a rename
  // in the Roster is reflected in every past game automatically,
  // instead of freezing whatever name was typed at game time.
  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString(), // when the game was logged
    playedDate: playedDate || new Date().toISOString().slice(0, 10), // when the match occurred
    // A game is a match. It always begins in Set 1; each event records the
    // set it belongs to so a match can be filtered or summarized by set.
    setNumber: 1,
    currentSetNumber: 1,
    completedSetNumbers: [],
    playerAId,
    playerBId,
    opponentName,
    notes: '',
    startingAction,
    setStartingActions: { 1: startingAction },
    events: [],       // Event[]  — the full chronological log
    checkedPointNumbers: [], // Point numbers a coach wants to revisit later
    reviewedPointNumbers: [], // Checked points that have been reviewed
    isComplete: false,
    status: 'paused', // every incomplete game is paused until completed
  };
}

// ----------------------------
// Derived state (computed from events, never stored)
// ----------------------------

// Score: count PointEnd-equivalent events (i.e. events where
// PHASE_CONFIG[...].actions[...].endsPoint === true).
function computeScore(game) {
  const events = getGameEventsForScope(game, arguments.length > 1 ? arguments[1] : 'match');
  let team = 0, opponent = 0;
  for (const e of events) {
    const cfg = PHASE_CONFIG[e.phase]?.actions[e.action];
    if (cfg?.endsPoint) {
      if (cfg.winner === 'team') team++;
      else opponent++;
    }
  }
  return { team, opponent };
}

function getEventSetNumber(game, event) {
  const eventSet = Number(event?.setNumber);
  if ([1, 2, 3].includes(eventSet)) return eventSet;
  const gameSet = Number(game?.setNumber);
  return [1, 2, 3].includes(gameSet) ? gameSet : 1;
}

function getCurrentSetNumber(game) {
  const current = Number(game?.currentSetNumber);
  if ([1, 2, 3].includes(current)) return current;

  const eventSets = (game?.events || [])
    .map((event) => getEventSetNumber(game, event))
    .filter((setNumber) => [1, 2, 3].includes(setNumber));
  return eventSets.length > 0 ? Math.max(...eventSets) : 1;
}

function getSetStartingAction(game, setNumber = 1) {
  const configured = game?.setStartingActions?.[setNumber]
    ?? game?.setStartingActions?.[String(setNumber)];
  if (configured === 'receive' || configured === 'serve') return configured;
  return game?.startingAction === 'receive' ? 'receive' : 'serve';
}

function getCompletedSetNumbers(game) {
  const saved = Array.isArray(game?.completedSetNumbers)
    ? game.completedSetNumbers.map(Number).filter((setNumber) => [1, 2, 3].includes(setNumber))
    : [];
  if (saved.length > 0) return [...new Set(saved)].sort((a, b) => a - b);

  if (game?.isComplete) {
    const eventSets = new Set((game.events || []).map((event) => getEventSetNumber(game, event)));
    return [...eventSets].sort((a, b) => a - b);
  }
  return [];
}

function getGameEventsForScope(game, scope = 'match') {
  const selectedSet = Number(scope);
  return (game?.events || []).filter((event) => {
    if (event?.type === 'set_boundary' || event?.action === 'set_end') return false;
    return ![1, 2, 3].includes(selectedSet) || getEventSetNumber(game, event) === selectedSet;
  });
}

// Current phase, derived by replaying events since the last
// point-ending event. Tracks two things across that replay:
//   - startedReceiving: did THIS rally begin with the team receiving?
//     (serve alternates by point, so this is per-rally, not per-game)
//   - hasAttacked: has the team attacked at least once this rally?
// Sideout only applies when both are true on the dynamic-attack check.
// Replay the event log into all UI-relevant rally context. Keeping this
// derived means Undo, reload, and older saved games all behave consistently.
function deriveRallyState(game) {
  let currentSetNumber = 1;
  let startingAction = getSetStartingAction(game, currentSetNumber);
  let phase = startingAction === 'serve' ? PHASES.SERVE : PHASES.PASSING;
  let startedReceiving = startingAction !== 'serve';
  let hasAttacked = false;

  let lastTeamServer = null;
  let needsServerRotation = false;
  let servingPlayer = null;

  let firstDefender = null;
  let setter = null;
  let setterIsOption = false;
  let directReturner = null;
  let attackSource = null;
  let lastDefenseAction = null;

  for (const e of game.events) {
    const eventSetNumber = Number(e?.setNumber);
    if (e?.type !== 'set_boundary' && e?.action !== 'set_end'
      && [1, 2, 3].includes(eventSetNumber) && eventSetNumber !== currentSetNumber) {
      currentSetNumber = eventSetNumber;
      startingAction = getSetStartingAction(game, currentSetNumber);
      phase = startingAction === 'serve' ? PHASES.SERVE : PHASES.PASSING;
      startedReceiving = startingAction !== 'serve';
    }

    if (e?.type === 'set_boundary' || e?.action === 'set_end') {
      currentSetNumber = Math.min(3, Number(e.setNumber) || currentSetNumber) + 1;
      startingAction = getSetStartingAction(game, currentSetNumber);
      phase = startingAction === 'serve' ? PHASES.SERVE : PHASES.PASSING;
      startedReceiving = startingAction !== 'serve';
      hasAttacked = false;
      lastTeamServer = null;
      needsServerRotation = false;
      servingPlayer = null;
      firstDefender = null;
      setter = null;
      setterIsOption = false;
      directReturner = null;
      attackSource = null;
      lastDefenseAction = null;
      continue;
    }

    // A server-swap correction is a non-stat event. It changes the serving
    // rotation used by replay without changing the score or phase.
    if (e?.type === 'server_swap' || e?.action === 'server_swap') {
      if (e.player === 'A' || e.player === 'B') {
        servingPlayer = e.player;
        lastTeamServer = e.player;
        needsServerRotation = false;
      }
      continue;
    }

    const cfg = PHASE_CONFIG[e.phase]?.actions[e.action];
    if (!cfg) continue;

    if (e.phase === PHASES.SERVE && (e.player === 'A' || e.player === 'B')) {
      // The first serve establishes the rotation. Every later serve event is
      // constrained by the UI to the derived serving player.
      servingPlayer = e.player;
      lastTeamServer = e.player;
      needsServerRotation = false;
    }

    if (e.phase === PHASES.DEFENSE && (e.player === 'A' || e.player === 'B')) {
      // The player who made the latest defensive touch cannot set the next
      // ball. This also handles a dig that follows a block return within the
      // same defensive exchange.
      firstDefender = e.player;
      if (e.action === 'dig_return' || e.action === 'return') {
        directReturner = e.player;
        attackSource = ATTACK_SOURCES.DIG_RETURN;
      }
    }
    if (e.phase === PHASES.DEFENSE) lastDefenseAction = e.action;

    // The passer is the first touch of the rally's offensive exchange. They
    // cannot also be the setter for the following setting phase.
    if (e.phase === PHASES.PASSING && (e.player === 'A' || e.player === 'B')) {
      firstDefender = e.player;
      if (e.action === 'return') directReturner = e.player;
    }

    if (e.phase === PHASES.SETTING && (e.player === 'A' || e.player === 'B')) {
      setter = e.player;
      setterIsOption = e.action === 'option';
      directReturner = null;
      attackSource = null;
    }

    if (cfg.endsPoint) {
      // A point lost after the rotation is established means the next time
      // this team regains the serve, the partner serves.
      if (cfg.winner === 'opponent' && lastTeamServer !== null) {
        needsServerRotation = true;
      }

      // If the team won while receiving, it regained the serve and rotates.
      // A point won while serving keeps the same server.
      if (cfg.winner === 'team' && e.phase !== PHASES.SERVE && needsServerRotation && lastTeamServer !== null) {
        servingPlayer = lastTeamServer === 'A' ? 'B' : 'A';
        lastTeamServer = servingPlayer;
        needsServerRotation = false;
      }

      phase = cfg.winner === 'team' ? PHASES.SERVE : PHASES.PASSING;
      startedReceiving = cfg.winner !== 'team';
      hasAttacked = false;
      firstDefender = null;
      setter = null;
      setterIsOption = false;
      directReturner = null;
      attackSource = null;
      lastDefenseAction = null;
      continue;
    }

    const nextPhase = cfg.next === DYNAMIC_ATTACK
      ? resolveAttackPhase(startedReceiving, hasAttacked)
      : cfg.next;

    // A new defensive exchange gets a new first-touch player.
    if (nextPhase === PHASES.DEFENSE && phase !== PHASES.DEFENSE) {
      firstDefender = null;
      setter = null;
      setterIsOption = false;
      directReturner = null;
      attackSource = null;
    }

    phase = nextPhase;

    if (phase === PHASES.SIDEOUT || phase === PHASES.TRANSITION) {
      hasAttacked = true;
    }
  }

  let currentServingPlayer = servingPlayer;
  if (phase === PHASES.SERVE && needsServerRotation && lastTeamServer !== null) {
    currentServingPlayer = lastTeamServer === 'A' ? 'B' : 'A';
  }

  return {
    phase,
    startedReceiving,
    hasAttacked,
    servingPlayer: currentServingPlayer,
    firstDefender,
    setter,
    setterIsOption,
    directReturner,
    attackSource,
    lastDefenseAction,
  };
}

function computeCurrentPhase(game) {
  return deriveRallyState(game).phase;
}

// Undo: just drop the last event. Score/phase recompute automatically
// next time computeScore()/computeCurrentPhase() run.
function undoLastEvent(game) {
  const removed = game.events.pop();
  if (removed?.type === 'set_boundary' || removed?.action === 'set_end') {
    const nextSet = (Number(removed.setNumber) || 1) + 1;
    game.currentSetNumber = Number(removed.setNumber) || 1;
    game.completedSetNumbers = (game.completedSetNumbers || [])
      .map(Number)
      .filter((setNumber) => setNumber !== Number(removed.setNumber));
    if (game.setStartingActions) {
      const nextActions = { ...game.setStartingActions };
      delete nextActions[nextSet];
      delete nextActions[String(nextSet)];
      game.setStartingActions = nextActions;
    }
  }
}
