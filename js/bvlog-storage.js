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
// (match by id): call saveGame() right after creating a game AND
// again after every point if you want crash-safe live tracking, not
// just once at the end — it's cheap, and it means a closed tab or
// dead battery mid-game doesn't lose the log.

function loadGameHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GAMES);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    let changed = false;
    for (const game of parsed) {
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
        localStorage.setItem(STORAGE_KEYS.GAMES, JSON.stringify(parsed));
      } catch (migrationError) {
        console.warn('Could not migrate game statuses:', migrationError);
      }
    }
    return parsed;
  } catch (err) {
    console.error('loadGameHistory failed, returning empty history:', err);
    return [];
  }
}

function saveGameHistory(games) {
  try {
    localStorage.setItem(STORAGE_KEYS.GAMES, JSON.stringify(games));
    if (typeof scheduleCloudSync === 'function') scheduleCloudSync();
    return true;
  } catch (err) {
    console.error('saveGameHistory failed:', err);
    return false;
  }
}

// Upserts a single game into history (replaces it by id if it's
// already there, otherwise appends) and persists. Returns true on
// success, false if the save failed.
function saveGame(game) {
  game.updatedAt = new Date().toISOString();
  const games = loadGameHistory();
  const index = games.findIndex(g => g.id === game.id);

  if (index === -1) {
    games.push(game);
  } else {
    games[index] = game;
  }

  return saveGameHistory(games);
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
  return saveGame(game);
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

// Finishes the current set and starts the next one without completing the
// match. The boundary event lets replay reset the rally state cleanly.
function advanceToNextSet(gameId) {
  const game = getGameById(gameId);
  const currentSet = getCurrentSetNumber(game);
  if (!game || game.isComplete || currentSet >= 3) return false;

  game.events = [...(game.events || []), setBoundaryEvent(game, currentSet)];
  game.completedSetNumbers = [...new Set([...(game.completedSetNumbers || []), currentSet])].sort((a, b) => a - b);
  game.currentSetNumber = currentSet + 1;
  game.setNumber = 1;
  game.status = 'paused';
  return saveGame(game);
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
  return saveGame(game);
}

// Removes a game from history. Returns true if a game was actually
// removed, false if no match was found or the save failed.
function deleteGame(gameId) {
  const games = loadGameHistory();
  const next = games.filter(g => g.id !== gameId);
  if (next.length === games.length) return false; // nothing matched

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
  return saveGame(game);
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

// Filtered views for the history list ("finished matches") and a
// resume screen ("pick back up where you left off"). Both sort
// newest-first, since that's what you want on either screen.
function getCompletedGames() {
  return loadGameHistory()
    .filter(g => g.isComplete)
    .sort((a, b) => new Date(b.playedDate || b.date) - new Date(a.playedDate || a.date));
}

function getInProgressGames() {
  return loadGameHistory()
    .filter(g => !g.isComplete)
    .sort((a, b) => new Date(b.playedDate || b.date) - new Date(a.playedDate || a.date));
}
