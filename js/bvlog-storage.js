// ============================================================
// BVLOG — STORAGE (Roster)
// ============================================================
// localStorage read/write for the roster. Game history storage will
// live here too once we get to it — same pattern, different key.
//
// Depends on createPlayer() from bvlog-model.js (load that first).
//
// Every localStorage call is wrapped in try/catch: it can throw in a
// private window, with site data blocked, or simply be unavailable —
// and we never want a storage hiccup to crash the app mid-game.

const STORAGE_KEYS = {
  ROSTER: 'bvlog_roster',
  GAMES: 'bvlog_games',
  DELETED_GAMES: 'bvlog_deleted_games',
};

// ----------------------------
// Roster
// ----------------------------

// Returns the saved roster, or [] if nothing's saved yet or storage
// is unreadable/corrupt. Never throws.
function loadRoster() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ROSTER);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('loadRoster failed, returning empty roster:', err);
    return [];
  }
}

// Returns true on success, false if the write failed (storage full,
// blocked, unavailable, etc.) so callers can decide whether to warn
// the person their change didn't actually save.
function saveRoster(roster) {
  try {
    localStorage.setItem(STORAGE_KEYS.ROSTER, JSON.stringify(roster));
    if (typeof scheduleCloudSync === 'function') scheduleCloudSync();
    return true;
  } catch (err) {
    console.error('saveRoster failed:', err);
    return false;
  }
}

// Adds a new player and persists the roster. Returns the created
// Player object, or null if the name is blank/whitespace or the save
// failed.
function addPlayerToRoster(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;

  const roster = loadRoster();
  const now = new Date().toISOString();
  const player = { ...createPlayer(trimmed), createdAt: now, updatedAt: now };
  roster.push(player);

  return saveRoster(roster) ? player : null;
}

// Returns only active players for lineup selection and the visible roster.
// Archived players remain in loadRoster() so historical games can still
// resolve their names and stats.
function loadActiveRoster() {
  return loadRoster()
    .filter(player => !player.archived)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
}

function loadArchivedRoster() {
  return loadRoster()
    .filter(player => player.archived)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
}

// Archives a player by id and persists the roster. Archived players are
// hidden from active lineup selection but are retained for historical data.
function archivePlayer(playerId) {
  const roster = loadRoster();
  const player = roster.find(p => p.id === playerId);
  if (!player || player.archived) return false;

  player.archived = true;
  player.updatedAt = new Date().toISOString();
  return saveRoster(roster);
}

// Restores an archived player to the active roster.
function restorePlayer(playerId) {
  const roster = loadRoster();
  const player = roster.find(p => p.id === playerId);
  if (!player || !player.archived) return false;

  delete player.archived;
  player.updatedAt = new Date().toISOString();
  return saveRoster(roster);
}

// Permanently deletes an archived player record. Active players must be
// archived first so an accidental delete cannot remove an active player.
// Existing games remain untouched; their player id will resolve to the
// existing fallback name when the roster record is no longer available.
function deleteArchivedPlayer(playerId) {
  const roster = loadRoster();
  const player = roster.find(p => p.id === playerId);
  if (!player || !player.archived) return false;

  const next = roster.filter(p => p.id !== playerId);
  const games = loadGameHistory();
  for (const game of games) {
    if (game.playerAId === playerId && !game.playerAName) game.playerAName = player.name;
    if (game.playerBId === playerId && !game.playerBName) game.playerBName = player.name;
  }

  if (!saveRoster(next)) return false;
  return saveGameHistory(games);
}

// Backwards-compatible alias for callers that still use the old name.
// Removing a player now archives them instead of deleting their record.
function removePlayerFromRoster(playerId) {
  return archivePlayer(playerId);
}

// Renames a player in place and persists the roster. Returns true on
// success, false if no player matched, the new name is blank, or the
// save failed.
function renamePlayer(playerId, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) return false;

  const roster = loadRoster();
  const player = roster.find(p => p.id === playerId);
  if (!player) return false;

  player.name = trimmed;
  player.updatedAt = new Date().toISOString();
  return saveRoster(roster);
}

// Marks or unmarks a player as a practice player. Practice-player status is
// roster metadata: it does not remove the player from games or individual
// stats, but aggregate team views can exclude that player's events.
function setPracticePlayer(playerId, isPracticePlayer) {
  const roster = loadRoster();
  const player = roster.find(p => p.id === playerId);
  if (!player) return false;

  if (isPracticePlayer) player.practicePlayer = true;
  else delete player.practicePlayer;
  player.updatedAt = new Date().toISOString();
  return saveRoster(roster);
}

// Convenience lookup — used when rendering a Game (which stores
// player ids) back into names for display.
function findPlayerById(playerId) {
  return loadRoster().find(p => p.id === playerId) || null;
}

// ----------------------------
// Game history
// ----------------------------
// Games are saved as a flat list, newest-last on disk — sort by
// `date` wherever you display a history list. Saving is an upsert
// (match by id): save after every point for local crash safety, but
// only sync live event changes to the cloud when the game is paused
// or completed. New games and completed-game edits sync immediately.

// A deletion tombstone is kept separately from the visible game list. This
// is important for cloud sync: an empty local list cannot tell another device
// whether a game was intentionally deleted or simply has not synced yet.
// Tombstones prevent stale devices from reintroducing an intentionally
// deleted game during the merge step.
function loadDeletedGameTombstones() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DELETED_GAMES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const byId = new Map();
    for (const entry of parsed) {
      const id = typeof entry === 'string' ? entry : entry?.id;
      if (!id) continue;
      const deletedAt = typeof entry === 'string'
        ? new Date(0).toISOString()
        : (entry.deletedAt || entry.deleted_at || new Date(0).toISOString());
      const current = byId.get(id);
      if (!current || new Date(deletedAt).getTime() > new Date(current.deletedAt).getTime()) {
        byId.set(id, { id, deletedAt });
      }
    }
    return [...byId.values()];
  } catch (err) {
    console.error('loadDeletedGameTombstones failed, returning empty list:', err);
    return [];
  }
}

function saveDeletedGameTombstones(tombstones, notifyCloud = true) {
  try {
    const normalized = Array.isArray(tombstones) ? tombstones : [];
    localStorage.setItem(STORAGE_KEYS.DELETED_GAMES, JSON.stringify(normalized));
    if (notifyCloud && typeof scheduleCloudSync === 'function') scheduleCloudSync();
    return true;
  } catch (err) {
    console.error('saveDeletedGameTombstones failed:', err);
    return false;
  }
}

function isGameDeleted(gameId) {
  return loadDeletedGameTombstones().some((entry) => entry.id === gameId);
}

function markGameDeleted(gameId, notifyCloud = true) {
  if (!gameId) return false;
  const tombstones = loadDeletedGameTombstones();
  const next = tombstones.filter((entry) => entry.id !== gameId);
  next.push({ id: gameId, deletedAt: new Date().toISOString() });
  return saveDeletedGameTombstones(next, notifyCloud);
}

function loadGameHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GAMES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const deletedIds = new Set(loadDeletedGameTombstones().map((entry) => entry.id));
    const visibleGames = parsed.filter((game) => !deletedIds.has(game?.id));
    let changed = visibleGames.length !== parsed.length;
    for (const game of visibleGames) {
      if (!game || typeof game !== 'object') continue;
      const normalizedStatus = game.isComplete ? 'completed' : 'paused';
      if (game.status !== normalizedStatus) {
        game.status = normalizedStatus;
        changed = true;
      }

      // Match-level set state was added after older games were saved. Older
      // games are treated as one completed/current set, and their events are
      // tagged as Set 1 for filtering and per-set calculations.
      const legacySetNumber = [1, 2, 3].includes(Number(game.setNumber)) ? Number(game.setNumber) : 1;
      if (!Number.isInteger(Number(game.currentSetNumber))) {
        game.currentSetNumber = legacySetNumber;
        changed = true;
      }
      if (!Array.isArray(game.completedSetNumbers)) {
        game.completedSetNumbers = game.isComplete ? [legacySetNumber] : [];
        changed = true;
      }
      if (!Array.isArray(game.checkedPointNumbers)) {
        game.checkedPointNumbers = [];
        changed = true;
      } else {
        const normalizedCheckedPoints = [...new Set(game.checkedPointNumbers
          .map(Number)
          .filter((pointNumber) => Number.isInteger(pointNumber) && pointNumber > 0))];
        if (JSON.stringify(normalizedCheckedPoints) !== JSON.stringify(game.checkedPointNumbers)) {
          game.checkedPointNumbers = normalizedCheckedPoints;
          changed = true;
        }
      }
      if (!Array.isArray(game.reviewedPointNumbers)) {
        game.reviewedPointNumbers = [];
        changed = true;
      } else {
        const normalizedReviewedPoints = [...new Set(game.reviewedPointNumbers
          .map(Number)
          .filter((pointNumber) => Number.isInteger(pointNumber) && pointNumber > 0))];
        if (JSON.stringify(normalizedReviewedPoints) !== JSON.stringify(game.reviewedPointNumbers)) {
          game.reviewedPointNumbers = normalizedReviewedPoints;
          changed = true;
        }
      }
      if (typeof game.notes !== 'string') {
        game.notes = game.notes == null ? '' : String(game.notes);
        changed = true;
      }
      if (Array.isArray(game.events)) {
        for (const event of game.events) {
          if (!event || event.type === 'set_boundary' || event.setNumber) continue;
          event.setNumber = [1, 2, 3].includes(Number(game.setNumber)) ? Number(game.setNumber) : 1;
          event.type = 'stat';
          changed = true;
        }
      }
    }
    if (changed) {
      try {
        localStorage.setItem(STORAGE_KEYS.GAMES, JSON.stringify(visibleGames));
      } catch (migrationError) {
        console.warn('Could not migrate game statuses:', migrationError);
      }
    }
    return visibleGames;
  } catch (err) {
    console.error('loadGameHistory failed, returning empty history:', err);
    return [];
  }
}

function saveGameHistory(games, notifyCloud = true) {
  try {
    const deletedIds = new Set(loadDeletedGameTombstones().map((entry) => entry.id));
    const visibleGames = (Array.isArray(games) ? games : [])
      .filter((game) => game?.id && !deletedIds.has(game.id));
    localStorage.setItem(STORAGE_KEYS.GAMES, JSON.stringify(visibleGames));
    if (notifyCloud && typeof scheduleCloudSync === 'function') scheduleCloudSync();
    return true;
  } catch (err) {
    console.error('saveGameHistory failed:', err);
    return false;
  }
}

function getGameCloudMetadata(game) {
  if (!game) return null;
  return {
    id: game.id || null,
    playerAId: game.playerAId || null,
    playerBId: game.playerBId || null,
    opponentName: game.opponentName || '',
    playedDate: game.playedDate || '',
    startingAction: game.startingAction || null,
    setStartingActions: game.setStartingActions || {},
    setNumber: Number(game.setNumber) || 1,
    currentSetNumber: Number(game.currentSetNumber) || 1,
    completedSetNumbers: Array.isArray(game.completedSetNumbers) ? game.completedSetNumbers : [],
    status: game.status || null,
    isComplete: Boolean(game.isComplete),
  };
}

// Upserts a single game into history (replaces it by id, otherwise appends)
// and persists locally. Live event-only saves stay local; pass { sync: true }
// for an explicit pause/completion boundary.
function saveGame(game, options = {}) {
  if (!game?.id || isGameDeleted(game.id)) return false;
  game.updatedAt = new Date().toISOString();
  const games = loadGameHistory();
  const index = games.findIndex(g => g.id === game.id);
  const previousGame = index === -1 ? null : games[index];
  const metadataChanged = JSON.stringify(getGameCloudMetadata(previousGame))
    !== JSON.stringify(getGameCloudMetadata(game));

  if (index === -1) {
    games.push(game);
  } else {
    games[index] = game;
  }

  if (!saveGameHistory(games, false)) return false;

  const shouldSync = Boolean(
    options.sync
    || index === -1
    || previousGame?.isComplete
    || game.isComplete
    || metadataChanged
  );
  if (shouldSync && typeof scheduleCloudSync === 'function') scheduleCloudSync();
  return true;
}

// Check-point markers are attached to the globally numbered rally rather than
// to a screen or a temporary live-tracking state. That keeps the marker with
// the point when the game is reopened, exported, synced, or edited.
function isPointChecked(game, pointNumber) {
  const target = Number(pointNumber);
  return Number.isInteger(target)
    && target > 0
    && Array.isArray(game?.checkedPointNumbers)
    && game.checkedPointNumbers.includes(target);
}

function isPointReviewed(game, pointNumber) {
  const target = Number(pointNumber);
  return Number.isInteger(target)
    && target > 0
    && Array.isArray(game?.reviewedPointNumbers)
    && game.reviewedPointNumbers.includes(target);
}

function setPointChecked(game, pointNumber, checked) {
  if (!game) return false;
  const target = Number(pointNumber);
  if (!Number.isInteger(target) || target < 1) return false;

  const current = Array.isArray(game.checkedPointNumbers)
    ? game.checkedPointNumbers.map(Number).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const next = new Set(current);
  if (checked) next.add(target);
  else {
    next.delete(target);
    if (Array.isArray(game.reviewedPointNumbers)) {
      game.reviewedPointNumbers = game.reviewedPointNumbers
        .map(Number)
        .filter((pointNumber) => Number.isInteger(pointNumber) && pointNumber > 0 && pointNumber !== target);
    }
  }
  game.checkedPointNumbers = [...next].sort((a, b) => a - b);
  return true;
}

function setPointReviewed(game, pointNumber, reviewed) {
  if (!game) return false;
  const target = Number(pointNumber);
  if (!Number.isInteger(target) || target < 1 || !isPointChecked(game, target)) return false;

  const current = Array.isArray(game.reviewedPointNumbers)
    ? game.reviewedPointNumbers.map(Number).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const next = new Set(current);
  if (reviewed) next.add(target);
  else next.delete(target);
  game.reviewedPointNumbers = [...next].sort((a, b) => a - b);
  return true;
}

function shiftCheckedPointNumbers(game, fromPointNumber, delta) {
  if (!game) return;
  const from = Number(fromPointNumber);
  const amount = Number(delta);
  if (!Number.isInteger(from) || !Number.isInteger(amount) || amount === 0) return;

  const shift = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map(Number)
    .filter((pointNumber) => Number.isInteger(pointNumber) && pointNumber > 0)
    .map((pointNumber) => pointNumber >= from ? pointNumber + amount : pointNumber)
    .filter((pointNumber) => pointNumber > 0))].sort((a, b) => a - b);
  game.checkedPointNumbers = shift(game.checkedPointNumbers);
  game.reviewedPointNumbers = shift(game.reviewedPointNumbers);
}

function removeCheckedPointNumber(game, pointNumber) {
  if (!game) return;
  const target = Number(pointNumber);
  if (!Number.isInteger(target)) return;

  const remove = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map(Number)
    .filter((checkedPoint) => Number.isInteger(checkedPoint) && checkedPoint > 0)
    .filter((checkedPoint) => checkedPoint !== target)
    .map((checkedPoint) => checkedPoint > target ? checkedPoint - 1 : checkedPoint))]
    .sort((a, b) => a - b);
  game.checkedPointNumbers = remove(game.checkedPointNumbers);
  game.reviewedPointNumbers = remove(game.reviewedPointNumbers);
}

// Merges imported players and games into local storage. Existing games with
// the same id are updated only after the caller has confirmed the import.
function mergeImportedData(games, players = []) {
  if (!Array.isArray(games) || games.length === 0) return null;

  const roster = loadRoster();
  const rosterById = new Map(roster.map((player) => [player.id, player]));
  for (const importedPlayer of players) {
    if (!importedPlayer || !importedPlayer.id || !String(importedPlayer.name || '').trim()) continue;
    if (!rosterById.has(importedPlayer.id)) {
      const player = {
        id: importedPlayer.id,
        name: String(importedPlayer.name).trim(),
        ...(importedPlayer.archived ? { archived: true } : {}),
        ...(importedPlayer.practicePlayer ? { practicePlayer: true } : {}),
      };
      roster.push(player);
      rosterById.set(player.id, player);
    }
  }

  const history = loadGameHistory();
  let added = 0;
  let updated = 0;
  for (const importedGame of games) {
    if (!importedGame || typeof importedGame !== 'object' || !Array.isArray(importedGame.events)) continue;
    const game = { ...importedGame };
    if (!game.id) game.id = crypto.randomUUID();
    const index = history.findIndex((existing) => existing.id === game.id);
    if (index === -1) {
      history.push(game);
      added++;
    } else {
      history[index] = game;
      updated++;
    }
  }

  if (added + updated === 0) return null;
  if (!saveRoster(roster)) return null;
  if (!saveGameHistory(history)) return null;
  return { added, updated };
}

// Returns one game by id, or null if not found.
function getGameById(gameId) {
  return loadGameHistory().find(g => g.id === gameId) || null;
}

function pauseGame(gameId) {
  const game = getGameById(gameId);
  if (!game || game.isComplete) return false;

  game.status = 'paused';
  return saveGame(game, { sync: true });
}

function resumeGame(gameId) {
  const game = getGameById(gameId);
  if (!game || game.isComplete) return false;

  game.status = 'paused';
  return saveGame(game);
}

function setBoundaryEvent(game, setNumber) {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'set_boundary',
    setNumber,
    phase: null,
    player: null,
    action: 'set_end',
    pointNumber: null,
    attackType: null,
    killQuality: null,
    attackSource: null,
  };
}

function serverSwapEvent(setNumber, player) {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type: 'server_swap',
    setNumber,
    phase: PHASES.SERVE,
    player,
    action: 'server_swap',
    pointNumber: null,
    attackType: null,
    killQuality: null,
    attackSource: null,
  };
}

// Correct the serving rotation without creating a stat or changing the
// current score. The correction is logged so replay, reload, and cloud sync
// all use the corrected server going forward.
function swapServingPlayer(gameId) {
  const game = getGameById(gameId);
  if (!game || game.isComplete || computeCurrentPhase(game) !== PHASES.SERVE) return false;

  const rallyState = deriveRallyState(game);
  if (!rallyState.servingPlayer) return false;
  const nextServer = rallyState.servingPlayer === 'A' ? 'B' : 'A';
  game.events = [...(game.events || []), serverSwapEvent(getCurrentSetNumber(game), nextServer)];
  return saveGame(game);
}

// Finishes the current set and starts the next one without completing the
// match. The boundary event lets replay reset the rally state cleanly.
function advanceToNextSet(gameId, startingAction = null) {
  const game = getGameById(gameId);
  const currentSet = getCurrentSetNumber(game);
  if (!game || game.isComplete || currentSet >= 3) return false;

  const nextSet = currentSet + 1;
  const nextStartingAction = startingAction === 'receive' || startingAction === 'serve'
    ? startingAction
    : getSetStartingAction(game, nextSet);

  game.events = [...(game.events || []), setBoundaryEvent(game, currentSet)];
  game.completedSetNumbers = [...new Set([...(game.completedSetNumbers || []), currentSet])].sort((a, b) => a - b);
  game.currentSetNumber = nextSet;
  game.setNumber = 1;
  game.setStartingActions = {
    ...(game.setStartingActions || {}),
    [nextSet]: nextStartingAction,
  };
  game.status = 'paused';
  return saveGame(game, { sync: true });
}

// Finishes the current set and the match. Set 3 always ends the match here;
// the same function is used when a user elects to end a match after Set 1 or
// Set 2.
function completeMatchAtSetEnd(gameId) {
  const game = getGameById(gameId);
  if (!game || game.isComplete) return false;

  const currentSet = getCurrentSetNumber(game);
  game.events = [...(game.events || []), setBoundaryEvent(game, currentSet)];
  game.completedSetNumbers = [...new Set([...(game.completedSetNumbers || []), currentSet])].sort((a, b) => a - b);
  game.currentSetNumber = currentSet;
  game.setNumber = 1;
  game.isComplete = true;
  game.status = 'completed';
  return saveGame(game, { sync: true });
}

// Removes a game from history. Returns true if a game was actually
// removed, false if no match was found or the save failed.
function deleteGame(gameId) {
  const games = loadGameHistory();
  const next = games.filter(g => g.id !== gameId);
  if (next.length === games.length) return false; // nothing matched

  // Record the deletion before removing the local copy. If another tab or
  // device still has the old game, the tombstone will win the next merge.
  if (!markGameDeleted(gameId, false)) return false;
  return saveGameHistory(next);
}

// Flips isComplete on a saved game and persists it. Call this once,
// when the person ends the match (not after every point). Returns
// true on success, false if no game matched or the save failed.
function markGameComplete(gameId) {
  const game = getGameById(gameId);
  if (!game) return false;

  game.isComplete = true;
  game.status = 'completed';
  return saveGame(game, { sync: true });
}

// Reopens a completed game for editing without changing its event log.
// The game returns to the in-progress list until it is ended again.
function reopenGame(gameId) {
  const game = getGameById(gameId);
  if (!game) return false;

  game.isComplete = false;
  game.status = 'paused';
  return saveGame(game);
}

// Updates game metadata without changing the chronological event log or the
// original timestamp showing when the game was entered.
function updateGameDetails(gameId, details) {
  const game = getGameById(gameId);
  if (!game || !details) return false;

  const playerAId = String(details.playerAId || '');
  const playerBId = String(details.playerBId || '');
  const opponentName = String(details.opponentName || '').trim();
  const playedDate = String(details.playedDate || '');
  const startingAction = details.startingAction;

  if (!playerAId || !playerBId || playerAId === playerBId) return false;
  if (!opponentName) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedDate)) return false;
  if (Number.isNaN(new Date(`${playedDate}T00:00:00`).getTime())) return false;
  if (startingAction !== 'serve' && startingAction !== 'receive') return false;

  game.playerAId = playerAId;
  game.playerBId = playerBId;
  game.opponentName = opponentName;
  game.playedDate = playedDate;
  game.startingAction = startingAction;
  game.setStartingActions = {
    ...(game.setStartingActions || {}),
    1: startingAction,
  };
  return saveGame(game);
}

// Saves coach notes independently from the recorded point sequence. Notes
// travel with the game so they remain available in summaries and cloud sync.
function updateGameNotes(gameId, notes) {
  const game = getGameById(gameId);
  if (!game) return false;

  game.notes = String(notes ?? '');
  return saveGame(game, { sync: true });
}

// Removes one set from a multi-set match and closes the numbering gaps in the
// remaining set and point logs. The match stays paused or completed as it was.
function deleteGameSet(gameId, setNumber) {
  const game = getGameById(gameId);
  const target = Number(setNumber);
  if (!game || !Number.isInteger(target) || ![1, 2, 3].includes(target)) return false;

  const setNumbers = [...new Set([
    ...getCompletedSetNumbers(game),
    ...(game.events || []).map((event) => getEventSetNumber(game, event)),
    getCurrentSetNumber(game),
  ])].filter((number) => [1, 2, 3].includes(Number(number))).sort((a, b) => a - b);
  if (setNumbers.length <= 1 || !setNumbers.includes(target)) return false;

  const deletedPointNumbers = [...new Set((game.events || [])
    .filter((event) => getEventSetNumber(game, event) === target)
    .map((event) => Number(event.pointNumber))
    .filter((pointNumber) => Number.isInteger(pointNumber) && pointNumber > 0))]
    .sort((a, b) => a - b);
  const pointWasDeleted = (pointNumber) => deletedPointNumbers.includes(Number(pointNumber));
  const remapPointNumber = (pointNumber) => {
    const number = Number(pointNumber);
    if (!Number.isInteger(number) || number < 1) return pointNumber;
    if (pointWasDeleted(number)) return null;
    return number - deletedPointNumbers.filter((deletedPoint) => deletedPoint < number).length;
  };
  const remapPointList = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map(Number)
    .filter((pointNumber) => Number.isInteger(pointNumber) && pointNumber > 0)
    .map(remapPointNumber)
    .filter((pointNumber) => Number.isInteger(pointNumber) && pointNumber > 0))]
    .sort((a, b) => a - b);

  game.events = (game.events || [])
    .filter((event) => getEventSetNumber(game, event) !== target)
    .map((event) => {
      const eventSet = getEventSetNumber(game, event);
      const nextPointNumber = remapPointNumber(event.pointNumber);
      return {
        ...event,
        setNumber: eventSet > target ? eventSet - 1 : eventSet,
        ...(nextPointNumber === null ? { pointNumber: null } : { pointNumber: nextPointNumber }),
      };
    });

  const remapSetList = (values) => [...new Set((Array.isArray(values) ? values : [])
    .map(Number)
    .filter((number) => [1, 2, 3].includes(number) && number !== target)
    .map((number) => number > target ? number - 1 : number))]
    .sort((a, b) => a - b);
  game.completedSetNumbers = remapSetList(game.completedSetNumbers);

  const startingActions = game.setStartingActions || { 1: game.startingAction };
  const nextStartingActions = {};
  for (const [key, value] of Object.entries(startingActions)) {
    const number = Number(key);
    if (![1, 2, 3].includes(number) || number === target) continue;
    const nextNumber = number > target ? number - 1 : number;
    if (value === 'serve' || value === 'receive') nextStartingActions[nextNumber] = value;
  }
  if (!nextStartingActions[1]) nextStartingActions[1] = game.startingAction === 'receive' ? 'receive' : 'serve';
  game.setStartingActions = nextStartingActions;
  game.startingAction = nextStartingActions[1];

  const oldCurrentSet = getCurrentSetNumber(game);
  const remappedCurrentSet = oldCurrentSet > target
    ? oldCurrentSet - 1
    : oldCurrentSet === target ? Math.max(1, oldCurrentSet - 1) : oldCurrentSet;
  const remainingSetNumbers = setNumbers
    .filter((number) => number !== target)
    .map((number) => number > target ? number - 1 : number);
  game.currentSetNumber = Math.min(
    remappedCurrentSet,
    Math.max(...remainingSetNumbers, 1),
  );
  game.setNumber = 1;
  game.checkedPointNumbers = remapPointList(game.checkedPointNumbers);
  game.reviewedPointNumbers = remapPointList(game.reviewedPointNumbers);

  return saveGame(game, { sync: true });
}

// Removes one complete rally from a game log and closes the numbering gap so
// the remaining chronological log stays easy to read. Non-rally events such
// as set boundaries and server-swap corrections have no point number and are
// preserved in place.
function deleteGamePoint(gameId, pointNumber) {
  const game = getGameById(gameId);
  const target = Number(pointNumber);
  if (!game || !Number.isInteger(target) || target < 1) return false;

  const hasPoint = (game.events || []).some((event) => Number(event.pointNumber) === target);
  if (!hasPoint) return false;

  game.events = (game.events || [])
    .filter((event) => Number(event.pointNumber) !== target)
    .map((event) => {
      const number = Number(event.pointNumber);
      if (!Number.isInteger(number) || number <= target) return event;
      return { ...event, pointNumber: number - 1 };
    });
  removeCheckedPointNumber(game, target);

  return saveGame(game);
}

// Removes an event and everything after it so the rally can be replayed
// from that point. This is safer than editing one event in isolation because
// later phases and scores are derived from the chronological event log.
function truncateGameEvents(gameId, eventIndex) {
  const game = getGameById(gameId);
  if (!game || !Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex >= game.events.length) {
    return false;
  }

  game.events = game.events.slice(0, eventIndex);
  game.isComplete = false;
  game.status = 'paused';
  return saveGame(game);
}

// History cards are newest-first by the date the match was played. If two
// games share that match date, the original log timestamp breaks the tie.
// This keeps backfilled film logs in match order while still making same-day
// entries appear in the order they were entered.
function compareGamesByHistoryDate(a, b) {
  const playedA = new Date(a?.playedDate || a?.date).getTime();
  const playedB = new Date(b?.playedDate || b?.date).getTime();
  const playedDifference = (Number.isFinite(playedB) ? playedB : 0)
    - (Number.isFinite(playedA) ? playedA : 0);
  if (playedDifference !== 0) return playedDifference;

  const loggedA = new Date(a?.date).getTime();
  const loggedB = new Date(b?.date).getTime();
  return (Number.isFinite(loggedB) ? loggedB : 0)
    - (Number.isFinite(loggedA) ? loggedA : 0);
}

// Filtered views for the history list ("finished matches") and a
// resume screen ("pick back up where you left off"). Both use the same
// newest-first match-date ordering.
function getCompletedGames() {
  return loadGameHistory()
    .filter(g => g.isComplete)
    .sort(compareGamesByHistoryDate);
}

function getInProgressGames() {
  return loadGameHistory()
    .filter(g => !g.isComplete)
    .sort(compareGamesByHistoryDate);
}
