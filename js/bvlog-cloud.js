// ============================================================
// BVLOG — CLOUD FOUNDATION
// ============================================================
// Supabase is intentionally optional while the app is being configured.
// Local storage remains the fallback until a project URL, publishable key,
// and workspace id are saved on this device.

const CLOUD_CONFIG_STORAGE_KEY = 'bvlog_cloud_config';

function getEmbeddedCloudDefaults() {
  const defaults = window.BVLOG_CLOUD_DEFAULTS || {};
  return {
    url: String(defaults.url || '').trim().replace(/\/$/, ''),
    publishableKey: String(defaults.publishableKey || '').trim(),
    workspaceId: String(defaults.workspaceId || '').trim(),
  };
}

function loadCloudConfig() {
  try {
    const raw = localStorage.getItem(CLOUD_CONFIG_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object'
      ? { ...getEmbeddedCloudDefaults(), ...parsed }
      : getEmbeddedCloudDefaults();
  } catch (error) {
    console.error('Could not load cloud configuration:', error);
    return getEmbeddedCloudDefaults();
  }
}

function saveCloudConfig(config) {
  try {
    localStorage.setItem(CLOUD_CONFIG_STORAGE_KEY, JSON.stringify({
      url: String(config.url || '').trim().replace(/\/$/, ''),
      publishableKey: String(config.publishableKey || '').trim(),
      workspaceId: String(config.workspaceId || '').trim(),
    }));
    if (typeof restartCloudSync === 'function') restartCloudSync();
    return true;
  } catch (error) {
    console.error('Could not save cloud configuration:', error);
    return false;
  }
}

function clearCloudConfig() {
  try {
    if (typeof stopCloudSync === 'function') stopCloudSync();
    localStorage.removeItem(CLOUD_CONFIG_STORAGE_KEY);
    return true;
  } catch (error) {
    console.error('Could not clear cloud configuration:', error);
    return false;
  }
}

let cloudClient = null;
let cloudClientKey = '';

function getCloudClient() {
  const config = loadCloudConfig();
  const supabaseApi = window.supabase;
  if (!config.url || !config.publishableKey || !supabaseApi?.createClient) return null;

  const key = `${config.url}|${config.publishableKey}`;
  if (!cloudClient || cloudClientKey !== key) {
    cloudClient = supabaseApi.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    cloudClientKey = key;
  }
  return cloudClient;
}

function isCloudConfigured() {
  const config = loadCloudConfig();
  return Boolean(config.url && config.publishableKey && config.workspaceId);
}

async function getCloudSession() {
  const client = getCloudClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

async function signInToCloud(email, password) {
  const client = getCloudClient();
  if (!client) throw new Error('Save the Supabase project settings first.');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

async function createCloudAccount(email, password) {
  const client = getCloudClient();
  if (!client) throw new Error('Save the Supabase project settings first.');
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data.session;
}

async function signOutOfCloud() {
  const client = getCloudClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

async function createCloudWorkspace(name) {
  const client = getCloudClient();
  if (!client) throw new Error('Save the Supabase project settings first.');
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('Sign in before creating a workspace.');

  const { data: workspace, error: workspaceError } = await client
    .from('bvlog_workspaces')
    .insert({ name: String(name || 'BVlog Staff'), created_by: userData.user.id })
    .select('id, name')
    .single();
  if (workspaceError) throw workspaceError;

  const { error: memberError } = await client
    .from('bvlog_workspace_members')
    .insert({ workspace_id: workspace.id, user_id: userData.user.id, role: 'owner' });
  if (memberError) throw memberError;

  const config = loadCloudConfig();
  saveCloudConfig({ ...config, workspaceId: workspace.id });
  await startCloudSync();
  return workspace;
}

// ============================================================
// Automatic merge sync
// ============================================================
// The functions below use merge semantics. Games are stored as individual
// workspace rows after the database migration, with a legacy JSON fallback
// while older workspaces are being upgraded.

// Cloud downloads are intentionally pull-based. The app syncs at startup and
// when the user explicitly requests an update; it does not keep a Realtime
// subscription or poll while sitting open.
let autoCloudClient = null;
let autoCloudClientKey = '';
let autoCloudAuthSubscription = null;
let autoCloudRealtimeChannel = null;
let autoCloudSyncTimer = null;
let autoCloudSyncInterval = null;
let autoCloudSyncInFlight = null;
let autoCloudSyncStartedKey = '';
let autoCloudSyncSuppressed = false;
let autoCloudWorkspaceSnapshot = null;
let autoCloudWorkspaceUpdatedAt = '';
let autoCloudGameSyncCursor = '';
let autoCloudDeletionSyncCursor = '';
let autoCloudMembershipKey = '';
let autoCloudGameRowsAvailable = null;

function cloudPlayerNameKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function cloudTime(value) {
  return new Date(value || 0).getTime() || 0;
}

function mergeCloudRosters(localRoster = [], remoteRoster = []) {
  const byId = new Map();
  const nameToId = new Map();
  const canonicalPlayers = new Map();
  const idRemap = new Map();

  for (const raw of [...localRoster, ...remoteRoster]) {
    if (!raw?.id || !String(raw.name || '').trim()) continue;
    const player = {
      ...raw,
      name: String(raw.name).trim(),
      updatedAt: raw.updatedAt || raw.createdAt || new Date(0).toISOString(),
    };
    const existing = byId.get(player.id);
    if (!existing || cloudTime(player.updatedAt) > cloudTime(existing.updatedAt)) {
      byId.set(player.id, player);
    }
  }

  for (const player of byId.values()) {
    const nameKey = cloudPlayerNameKey(player.name);
    const existingId = nameToId.get(nameKey);
    if (!existingId) {
      nameToId.set(nameKey, player.id);
      canonicalPlayers.set(nameKey, player);
      continue;
    }
    const canonicalId = [existingId, player.id].sort()[0];
    const duplicateId = canonicalId === existingId ? player.id : existingId;
    nameToId.set(nameKey, canonicalId);
    idRemap.set(duplicateId, canonicalId);
    const existingPlayer = canonicalPlayers.get(nameKey) || byId.get(existingId);
    const preferred = cloudTime(player.updatedAt) > cloudTime(existingPlayer?.updatedAt)
      ? player
      : existingPlayer;
    canonicalPlayers.set(nameKey, { ...preferred, id: canonicalId });
  }

  const roster = [];
  for (const player of byId.values()) {
    const nameKey = cloudPlayerNameKey(player.name);
    const canonicalId = nameToId.get(nameKey) || player.id;
    const canonical = canonicalPlayers.get(nameKey) || player;
    if (roster.some((entry) => entry.id === canonicalId)) continue;
    roster.push({ ...canonical, id: canonicalId });
  }
  roster.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  return { roster, idRemap };
}

function remapCloudGame(game, idRemap) {
  if (!game || !idRemap.size) return game;
  const next = { ...game };
  if (idRemap.has(next.playerAId)) next.playerAId = idRemap.get(next.playerAId);
  if (idRemap.has(next.playerBId)) next.playerBId = idRemap.get(next.playerBId);
  return next;
}

function mergeCloudGames(localGames = [], remoteGames = [], idRemap = new Map()) {
  return mergeCloudGamesWithDeletions(localGames, remoteGames, idRemap, []);
}

function mergeCloudDeletions(localTombstones = [], remoteTombstones = []) {
  const byId = new Map();
  for (const raw of [...localTombstones, ...remoteTombstones]) {
    const id = typeof raw === 'string' ? raw : raw?.id;
    if (!id) continue;
    const deletedAt = typeof raw === 'string'
      ? new Date(0).toISOString()
      : (raw.deletedAt || raw.deleted_at || new Date(0).toISOString());
    const existing = byId.get(id);
    if (!existing || cloudTime(deletedAt) > cloudTime(existing.deletedAt)) {
      byId.set(id, { id, deletedAt });
    }
  }
  return [...byId.values()].sort((a, b) => cloudTime(a.deletedAt) - cloudTime(b.deletedAt) || String(a.id).localeCompare(String(b.id)));
}

function mergeCloudGamesWithDeletions(localGames = [], remoteGames = [], idRemap = new Map(), deletedTombstones = []) {
  const byId = new Map();
  const deletedIds = new Set(deletedTombstones.map((entry) => entry.id));
  for (const raw of [...localGames, ...remoteGames]) {
    if (!raw?.id || !Array.isArray(raw.events)) continue;
    const game = remapCloudGame(raw, idRemap);
    if (deletedIds.has(game.id)) continue;
    const existing = byId.get(game.id);
    if (!existing || cloudTime(game.updatedAt || game.date) > cloudTime(existing.updatedAt || existing.date)) {
      byId.set(game.id, game);
    }
  }
  return [...byId.values()].sort((a, b) => cloudTime(a.date) - cloudTime(b.date) || String(a.id).localeCompare(String(b.id)));
}

function cloudStable(value) {
  return JSON.stringify(value || []);
}

function mergeCloudData(
  localRoster,
  localGames,
  remoteRoster,
  remoteGames,
  localDeletedGames = [],
  remoteDeletedGames = [],
) {
  const rosterResult = mergeCloudRosters(localRoster, remoteRoster);
  const deletedGames = mergeCloudDeletions(localDeletedGames, remoteDeletedGames);
  return {
    roster: rosterResult.roster,
    games: mergeCloudGamesWithDeletions(localGames, remoteGames, rosterResult.idRemap, deletedGames),
    deletedGames,
  };
}

function setCloudApplySuppressed(value) {
  autoCloudSyncSuppressed = Boolean(value);
}

function applyCloudMergedData(merged) {
  setCloudApplySuppressed(true);
  try {
    saveDeletedGameTombstones(merged.deletedGames || [], false);
    saveRoster(merged.roster || []);
    saveGameHistory(merged.games || []);
  } finally {
    setCloudApplySuppressed(false);
  }
}

function getCloudClient() {
  const config = loadCloudConfig();
  const supabaseApi = window.supabase;
  if (!config.url || !config.publishableKey || !supabaseApi?.createClient) return null;

  const clientKey = `${config.url}|${config.publishableKey}`;
  if (!autoCloudClient || autoCloudClientKey !== clientKey) {
    stopCloudSync();
    autoCloudClient = supabaseApi.createClient(config.url, config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    autoCloudClientKey = clientKey;
    autoCloudAuthSubscription = autoCloudClient.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        window.setTimeout(() => startCloudSync().catch(() => {}), 0);
      } else if (event === 'SIGNED_OUT') {
        stopCloudSync();
      }
    });
  }
  return autoCloudClient;
}

function isCloudConfigured() {
  const config = loadCloudConfig();
  return Boolean(config.url && config.publishableKey && config.workspaceId);
}

async function getCloudSession() {
  const client = getCloudClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data.session || null;
}

async function signInToCloud(email, password) {
  const client = getCloudClient();
  if (!client) throw new Error('Save the Supabase project settings first.');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await startCloudSync();
  return data.session;
}

async function createCloudAccount(email, password) {
  const client = getCloudClient();
  if (!client) throw new Error('Save the Supabase project settings first.');
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  if (data.session) await startCloudSync();
  return data.session;
}

async function signOutOfCloud() {
  const client = getCloudClient();
  if (!client) return;
  stopCloudSync();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

function isMissingCloudGameRowsError(error) {
  const message = String(error?.message || '');
  return ['42P01', 'PGRST205', 'PGRST204'].includes(error?.code)
    || /bvlog_workspace_game|relation .* does not exist/i.test(message);
}

function normalizeCloudGameRows(rows = []) {
  return rows
    .map((row) => {
      if (!row?.game || typeof row.game !== 'object' || Array.isArray(row.game)) return null;
      return {
        ...row.game,
        id: row.game.id || row.game_id,
        updatedAt: row.game.updatedAt || row.updated_at,
      };
    })
    .filter((game) => game?.id && Array.isArray(game.events))
    .sort((a, b) => cloudTime(a.date) - cloudTime(b.date) || String(a.id).localeCompare(String(b.id)));
}

function normalizeCloudDeletionRows(rows = []) {
  return rows
    .map((row) => ({
      id: row?.game_id,
      deletedAt: row?.deleted_at,
      updatedAt: row?.updated_at || row?.deleted_at,
    }))
    .filter((entry) => entry.id)
    .sort((a, b) => cloudTime(a.updatedAt) - cloudTime(b.updatedAt) || String(a.id).localeCompare(String(b.id)));
}

function latestCloudTimestamp(values = []) {
  return values
    .map((value) => value || '')
    .filter(Boolean)
    .sort((a, b) => cloudTime(b) - cloudTime(a))[0] || '';
}

function advanceCloudSyncCursors(gameRows = [], deletionRows = []) {
  const latestGameTimestamp = latestCloudTimestamp(gameRows.map((row) => row?.updated_at));
  const latestDeletionTimestamp = latestCloudTimestamp(deletionRows.map((row) => row?.updated_at || row?.deleted_at));
  if (cloudTime(latestGameTimestamp) > cloudTime(autoCloudGameSyncCursor)) {
    autoCloudGameSyncCursor = latestGameTimestamp;
  }
  if (cloudTime(latestDeletionTimestamp) > cloudTime(autoCloudDeletionSyncCursor)) {
    autoCloudDeletionSyncCursor = latestDeletionTimestamp;
  }
}

async function fetchLegacyCloudWorkspace() {
  const client = getCloudClient();
  const workspaceId = loadCloudConfig().workspaceId;
  if (!client || !workspaceId) throw new Error('Save Supabase settings and a workspace id first.');
  const { data, error } = await client
    .from('bvlog_workspaces')
    .select('id, name, roster, games, deleted_game_ids, updated_at')
    .eq('id', workspaceId)
    .single();
  if (error) throw error;
  return data;
}

async function fetchCloudWorkspace() {
  const client = getCloudClient();
  const workspaceId = loadCloudConfig().workspaceId;
  if (!client || !workspaceId) throw new Error('Save the Supabase settings and a workspace id first.');

  const { data: workspace, error: workspaceError } = await client
    .from('bvlog_workspaces')
    .select('id, name, roster, updated_at')
    .eq('id', workspaceId)
    .single();
  if (workspaceError) throw workspaceError;

  if (autoCloudGameRowsAvailable !== false) {
    const [{ data: gameRows, error: gameError }, { data: deletionRows, error: deletionError }] = await Promise.all([
      client
        .from('bvlog_workspace_games')
        .select('game_id, game, updated_at')
        .eq('workspace_id', workspaceId),
      client
        .from('bvlog_workspace_game_deletions')
        .select('game_id, deleted_at, updated_at')
        .eq('workspace_id', workspaceId),
    ]);

    if (!gameError && !deletionError) {
      autoCloudGameRowsAvailable = true;
      advanceCloudSyncCursors(gameRows || [], deletionRows || []);
      return {
        ...workspace,
        games: normalizeCloudGameRows(gameRows || []),
        deleted_game_ids: normalizeCloudDeletionRows(deletionRows || []),
      };
    }

    if (!isMissingCloudGameRowsError(gameError) && !isMissingCloudGameRowsError(deletionError)) {
      throw gameError || deletionError;
    }
    autoCloudGameRowsAvailable = false;
  }

  // Compatibility fallback until the new migration has been run.
  autoCloudGameSyncCursor = '';
  autoCloudDeletionSyncCursor = '';
  return fetchLegacyCloudWorkspace();
}

// Once an initial snapshot exists, only retrieve rows changed after the last
// downloaded row timestamp. The >= comparison intentionally re-reads rows at
// the cursor boundary so equal timestamps cannot cause a change to be missed.
async function fetchCloudWorkspaceChangesSinceLastSync() {
  const client = getCloudClient();
  const workspaceId = loadCloudConfig().workspaceId;
  if (!client || !workspaceId) throw new Error('Save the Supabase settings and workspace id first.');
  if (autoCloudGameRowsAvailable !== true || !autoCloudWorkspaceSnapshot) return null;

  const gameQuery = client
    .from('bvlog_workspace_games')
    .select('game_id, game, updated_at')
    .eq('workspace_id', workspaceId);
  if (autoCloudGameSyncCursor) gameQuery.gte('updated_at', autoCloudGameSyncCursor);

  const deletionQuery = client
    .from('bvlog_workspace_game_deletions')
    .select('game_id, deleted_at, updated_at')
    .eq('workspace_id', workspaceId);
  if (autoCloudDeletionSyncCursor) deletionQuery.gte('updated_at', autoCloudDeletionSyncCursor);

  const [
    { data: workspace, error: workspaceError },
    { data: gameRows, error: gameError },
    { data: deletionRows, error: deletionError },
  ] = await Promise.all([
    client
      .from('bvlog_workspaces')
      .select('id, name, roster, updated_at')
      .eq('id', workspaceId)
      .single(),
    gameQuery,
    deletionQuery,
  ]);
  if (workspaceError) throw workspaceError;
  if (gameError || deletionError) {
    if (isMissingCloudGameRowsError(gameError) || isMissingCloudGameRowsError(deletionError)) {
      autoCloudGameRowsAvailable = false;
      return null;
    }
    throw gameError || deletionError;
  }

  advanceCloudSyncCursors(gameRows || [], deletionRows || []);
  return {
    ...workspace,
    games: normalizeCloudGameRows(gameRows || []),
    deleted_game_ids: normalizeCloudDeletionRows(deletionRows || []),
  };
}

function mergeCloudWorkspaceDelta(snapshot, delta) {
  const deletedGames = mergeCloudDeletions(
    snapshot.deleted_game_ids || [],
    delta.deleted_game_ids || [],
  );
  return {
    ...snapshot,
    ...delta,
    games: mergeCloudGamesWithDeletions(
      snapshot.games || [],
      delta.games || [],
      new Map(),
      deletedGames,
    ),
    deleted_game_ids: deletedGames,
  };
}

// Background checks only need the version marker. The roster and games can be
// much larger than this response, so avoid transferring them unless the
// workspace actually changed.
async function fetchCloudWorkspaceVersion() {
  const client = getCloudClient();
  const workspaceId = loadCloudConfig().workspaceId;
  if (!client || !workspaceId) throw new Error('Save the Supabase settings and workspace id first.');
  const { data, error } = await client
    .from('bvlog_workspaces')
    .select('id, updated_at')
    .eq('id', workspaceId)
    .single();
  if (error) throw error;
  return data;
}

async function loadCloudWorkspace() {
  return fetchCloudWorkspace();
}

// Workspace membership is automatic for a signed-in user who has the
// embedded workspace id. The primary key makes repeat joins harmless.
async function ensureCloudWorkspaceMembership() {
  const client = getCloudClient();
  const workspaceId = loadCloudConfig().workspaceId;
  if (!client || !workspaceId) return false;

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return false;

  const membershipKey = `${workspaceId}|${userData.user.id}`;
  if (autoCloudMembershipKey === membershipKey) return true;

  const { error } = await client
    .from('bvlog_workspace_members')
    .insert({ workspace_id: workspaceId, user_id: userData.user.id, role: 'coach' });
  if (error && error.code !== '23505') throw error;
  autoCloudMembershipKey = membershipKey;
  return true;
}

async function joinCloudWorkspace() {
  const client = getCloudClient();
  const workspaceId = loadCloudConfig().workspaceId;
  if (!client || !workspaceId) throw new Error('Save Supabase settings and a workspace id first.');

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) throw new Error('Sign in before joining a workspace.');

  const { error } = await client
    .from('bvlog_workspace_members')
    .insert({ workspace_id: workspaceId, user_id: userData.user.id, role: 'coach' });
  if (error && error.code !== '23505') throw error;
  await startCloudSync();
  return fetchCloudWorkspace();
}

async function saveLegacyCloudWorkspace(roster, games, deletedGameTombstones = []) {
  const client = getCloudClient();
  const config = loadCloudConfig();
  if (!client || !config.workspaceId) throw new Error('Save Supabase settings and a workspace id first.');

  const remote = await fetchCloudWorkspace();
  const merged = mergeCloudData(
    roster,
    games,
    remote.roster || [],
    remote.games || [],
    deletedGameTombstones,
    remote.deleted_game_ids || [],
  );
  const changed = cloudStable(merged.roster) !== cloudStable(remote.roster)
    || cloudStable(merged.games) !== cloudStable(remote.games)
    || cloudStable(merged.deletedGames) !== cloudStable(remote.deleted_game_ids);
  if (!changed) return { id: remote.id, updated_at: remote.updated_at, changed: false, merged };

  const { data, error } = await client
    .from('bvlog_workspaces')
    .update({
      roster: merged.roster,
      games: merged.games,
      deleted_game_ids: merged.deletedGames,
      updated_at: new Date().toISOString(),
    })
    .eq('id', config.workspaceId)
    .eq('updated_at', remote.updated_at)
    .select('id, updated_at')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The shared workspace changed on another device. Please sync again.');
  return { ...data, changed: true, merged };
}

async function writeCloudGameRows(remote, merged) {
  const client = getCloudClient();
  const workspaceId = loadCloudConfig().workspaceId;
  if (!client || !workspaceId) throw new Error('Save the Supabase settings and a workspace id first.');

  const remoteGames = new Map((remote.games || []).map((game) => [game.id, game]));
  const deletedIds = new Set((merged.deletedGames || []).map((entry) => entry.id));
  const gameIdsToRemove = [...remoteGames.keys()].filter((gameId) => deletedIds.has(gameId));
  if (gameIdsToRemove.length > 0) {
    const { error } = await client
      .from('bvlog_workspace_games')
      .delete()
      .eq('workspace_id', workspaceId)
      .in('game_id', gameIdsToRemove);
    if (error) throw error;
  }

  const gamesToUpsert = (merged.games || [])
    .filter((game) => {
      const remoteGame = remoteGames.get(game.id);
      return !remoteGame || cloudStable(remoteGame) !== cloudStable(game);
    })
    .map((game) => ({
      workspace_id: workspaceId,
      game_id: game.id,
      game,
      // The row timestamp describes this cloud mutation. It must be fresh
      // even when an offline game retains its original local updatedAt.
      updated_at: new Date().toISOString(),
    }));
  if (gamesToUpsert.length > 0) {
    const { error } = await client
      .from('bvlog_workspace_games')
      .upsert(gamesToUpsert, { onConflict: 'workspace_id,game_id' });
    if (error) throw error;
  }

  const remoteDeletions = new Map((remote.deleted_game_ids || []).map((entry) => [entry.id, entry]));
  const deletionsToUpsert = (merged.deletedGames || [])
    .filter((entry) => {
      const remoteEntry = remoteDeletions.get(entry.id);
      return !remoteEntry || cloudTime(entry.deletedAt) > cloudTime(remoteEntry.deletedAt);
    })
    .map((entry) => ({
      workspace_id: workspaceId,
      game_id: entry.id,
      deleted_at: entry.deletedAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
  if (deletionsToUpsert.length > 0) {
    const { error } = await client
      .from('bvlog_workspace_game_deletions')
      .upsert(deletionsToUpsert, { onConflict: 'workspace_id,game_id' });
    if (error) throw error;
  }

  if (cloudStable(merged.roster) !== cloudStable(remote.roster)) {
    const { error } = await client
      .from('bvlog_workspaces')
      .update({ roster: merged.roster, updated_at: new Date().toISOString() })
      .eq('id', workspaceId);
    if (error) throw error;
  }

  const version = await fetchCloudWorkspaceVersion();
  return {
    id: workspaceId,
    updated_at: version.updated_at,
    gameCursor: latestCloudTimestamp(gamesToUpsert.map((game) => game.updated_at)),
    deletionCursor: latestCloudTimestamp(deletionsToUpsert.map((entry) => entry.updated_at)),
  };
}

async function saveCloudWorkspace(roster, games, deletedGameTombstones = []) {
  const remote = await fetchCloudWorkspace();
  const merged = mergeCloudData(
    roster,
    games,
    remote.roster || [],
    remote.games || [],
    deletedGameTombstones,
    remote.deleted_game_ids || [],
  );
  const changed = cloudStable(merged.roster) !== cloudStable(remote.roster)
    || cloudStable(merged.games) !== cloudStable(remote.games)
    || cloudStable(merged.deletedGames) !== cloudStable(remote.deleted_game_ids);
  if (!changed) return { id: remote.id, updated_at: remote.updated_at, changed: false, merged };
  if (autoCloudGameRowsAvailable) {
    const result = await writeCloudGameRows(remote, merged);
    return { ...result, changed: true, merged };
  }
  return saveLegacyCloudWorkspace(roster, games, deletedGameTombstones);
}

async function syncCloudWorkspace({ silent = false } = {}) {
  if (!isCloudConfigured()) return { skipped: true };
  if (autoCloudSyncInFlight) return autoCloudSyncInFlight;

  autoCloudSyncInFlight = (async () => {
    const session = await getCloudSession();
    if (!session) return { signedOut: true };

    await ensureCloudWorkspaceMembership();
    let localChanged = false;
    let remoteChanged = false;
    let converged = false;

    // Reuse the last full remote snapshot whenever its lightweight version
    // check is unchanged. With normalized game rows, writes only send games
    // that differ from this snapshot.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let remote = null;
      if (attempt === 0 && autoCloudWorkspaceSnapshot) {
        const remoteVersion = await fetchCloudWorkspaceVersion();
        if (remoteVersion.updated_at === autoCloudWorkspaceUpdatedAt) {
          remote = autoCloudWorkspaceSnapshot;
        } else if (autoCloudGameRowsAvailable === true) {
          // The workspace version changed, but the cached snapshot already
          // contains every older game. Download only the changed rows and
          // merge them into that snapshot.
          const delta = await fetchCloudWorkspaceChangesSinceLastSync();
          if (delta) remote = mergeCloudWorkspaceDelta(autoCloudWorkspaceSnapshot, delta);
        }
      }
      if (!remote) remote = await fetchCloudWorkspace();
      autoCloudWorkspaceSnapshot = remote;
      autoCloudWorkspaceUpdatedAt = remote.updated_at || '';

      const localRoster = loadRoster();
      const localGames = loadGameHistory();
      const localDeletedGames = loadDeletedGameTombstones();
      const merged = mergeCloudData(
        localRoster,
        localGames,
        remote.roster || [],
        remote.games || [],
        localDeletedGames,
        remote.deleted_game_ids || [],
      );
      const thisLocalChanged = cloudStable(merged.roster) !== cloudStable(localRoster)
        || cloudStable(merged.games) !== cloudStable(localGames)
        || cloudStable(merged.deletedGames) !== cloudStable(localDeletedGames);
      if (thisLocalChanged) {
        applyCloudMergedData(merged);
        localChanged = true;
      }

      const thisRemoteChanged = cloudStable(merged.roster) !== cloudStable(remote.roster)
        || cloudStable(merged.games) !== cloudStable(remote.games)
        || cloudStable(merged.deletedGames) !== cloudStable(remote.deleted_game_ids);
      if (!thisRemoteChanged) {
        converged = true;
        break;
      }

      if (autoCloudGameRowsAvailable) {
        const data = await writeCloudGameRows(remote, merged);
        remoteChanged = true;
        autoCloudWorkspaceSnapshot = {
          ...remote,
          roster: merged.roster,
          games: merged.games,
          deleted_game_ids: merged.deletedGames,
          updated_at: data.updated_at,
        };
        if (data.gameCursor) autoCloudGameSyncCursor = data.gameCursor;
        if (data.deletionCursor) autoCloudDeletionSyncCursor = data.deletionCursor;
        autoCloudWorkspaceUpdatedAt = data.updated_at || '';
        converged = true;
        break;
      }

      const { data, error } = await getCloudClient()
        .from('bvlog_workspaces')
        .update({
          roster: merged.roster,
          games: merged.games,
          deleted_game_ids: merged.deletedGames,
          updated_at: new Date().toISOString(),
        })
        .eq('id', loadCloudConfig().workspaceId)
        .eq('updated_at', remote.updated_at)
        .select('id, updated_at')
        .maybeSingle();
      if (error) throw error;
      if (data) {
        remoteChanged = true;
        autoCloudWorkspaceSnapshot = {
          ...remote,
          roster: merged.roster,
          games: merged.games,
          deleted_game_ids: merged.deletedGames,
          updated_at: data.updated_at,
        };
        autoCloudWorkspaceUpdatedAt = data.updated_at || '';
        converged = true;
        break;
      }

      // A concurrent writer won the optimistic update. Discard the cached
      // snapshot so the next attempt downloads the current workspace once.
      autoCloudWorkspaceSnapshot = null;
      autoCloudWorkspaceUpdatedAt = '';
    }

    if (!converged) {
      throw new Error('The shared workspace is changing on another device. Please try syncing again.');
    }

    window.dispatchEvent(new CustomEvent('bvlog-cloud-updated', {
      detail: { localChanged, remoteChanged, silent },
    }));
    return { localChanged, remoteChanged };
  })().catch((error) => {
    if (!silent) console.error('BVlog cloud sync failed:', error);
    window.dispatchEvent(new CustomEvent('bvlog-cloud-sync-error', { detail: { error } }));
    throw error;
  }).finally(() => {
    autoCloudSyncInFlight = null;
  });

  return autoCloudSyncInFlight;
}

async function checkCloudWorkspaceForChanges() {
  if (!isCloudConfigured() || autoCloudSyncInFlight) return { skipped: true };
  const remoteVersion = await fetchCloudWorkspaceVersion();
  if (remoteVersion.updated_at === autoCloudWorkspaceUpdatedAt) {
    return { unchanged: true };
  }
  return syncCloudWorkspace({ silent: true });
}

async function refreshCloudSnapshotVersion() {
  if (!autoCloudWorkspaceSnapshot) return;
  const version = await fetchCloudWorkspaceVersion();
  autoCloudWorkspaceUpdatedAt = version.updated_at || '';
  autoCloudWorkspaceSnapshot.updated_at = autoCloudWorkspaceUpdatedAt;
}

async function handleCloudGameRealtime(payload) {
  if (payload.eventType === 'DELETE' || !payload.new) return;
  if (!autoCloudWorkspaceSnapshot || autoCloudGameRowsAvailable !== true) {
    await syncCloudWorkspace({ silent: true });
    return;
  }

  const [game] = normalizeCloudGameRows([payload.new]);
  if (!game) return;
  advanceCloudSyncCursors([payload.new], []);
  const remoteDeletedIds = new Set((autoCloudWorkspaceSnapshot.deleted_game_ids || []).map((entry) => entry.id));
  const remoteGames = autoCloudWorkspaceSnapshot.games || [];
  autoCloudWorkspaceSnapshot.games = [
    ...remoteGames.filter((entry) => entry.id !== game.id),
    ...(remoteDeletedIds.has(game.id) ? [] : [game]),
  ].sort((a, b) => cloudTime(a.date) - cloudTime(b.date) || String(a.id).localeCompare(String(b.id)));
  await refreshCloudSnapshotVersion();

  const localGames = loadGameHistory();
  const remoteDeletions = mergeCloudDeletions(
    loadDeletedGameTombstones(),
    autoCloudWorkspaceSnapshot.deleted_game_ids || [],
  );
  const mergedGames = mergeCloudGamesWithDeletions(
    localGames,
    [game],
    new Map(),
    remoteDeletions,
  );
  const localChanged = cloudStable(mergedGames) !== cloudStable(localGames);
  if (localChanged) {
    setCloudApplySuppressed(true);
    try {
      saveGameHistory(mergedGames);
    } finally {
      setCloudApplySuppressed(false);
    }
    window.dispatchEvent(new CustomEvent('bvlog-cloud-updated', {
      detail: { localChanged: true, remoteChanged: false, silent: true },
    }));
  }

  const localGame = loadGameHistory().find((entry) => entry.id === game.id);
  if (localGame && cloudTime(localGame.updatedAt || localGame.date) > cloudTime(game.updatedAt || game.date)) {
    scheduleCloudSync();
  }
}

async function handleCloudGameDeletionRealtime(payload) {
  if (payload.eventType === 'DELETE' || !payload.new) return;
  if (!autoCloudWorkspaceSnapshot || autoCloudGameRowsAvailable !== true) {
    await syncCloudWorkspace({ silent: true });
    return;
  }

  const [deletion] = normalizeCloudDeletionRows([payload.new]);
  if (!deletion) return;
  advanceCloudSyncCursors([], [payload.new]);
  autoCloudWorkspaceSnapshot.deleted_game_ids = mergeCloudDeletions(
    autoCloudWorkspaceSnapshot.deleted_game_ids || [],
    [deletion],
  );
  const deletedIds = new Set(autoCloudWorkspaceSnapshot.deleted_game_ids.map((entry) => entry.id));
  autoCloudWorkspaceSnapshot.games = (autoCloudWorkspaceSnapshot.games || [])
    .filter((game) => !deletedIds.has(game.id));
  await refreshCloudSnapshotVersion();

  const localRoster = loadRoster();
  const localGames = loadGameHistory();
  const localDeletedGames = loadDeletedGameTombstones();
  const merged = mergeCloudData(
    localRoster,
    localGames,
    autoCloudWorkspaceSnapshot.roster || [],
    autoCloudWorkspaceSnapshot.games || [],
    localDeletedGames,
    autoCloudWorkspaceSnapshot.deleted_game_ids || [],
  );
  const localChanged = cloudStable(merged.games) !== cloudStable(localGames)
    || cloudStable(merged.deletedGames) !== cloudStable(localDeletedGames);
  if (localChanged) {
    applyCloudMergedData(merged);
    window.dispatchEvent(new CustomEvent('bvlog-cloud-updated', {
      detail: { localChanged: true, remoteChanged: false, silent: true },
    }));
  }
}

async function handleCloudWorkspaceRealtime(payload) {
  if (!payload.new || !autoCloudWorkspaceSnapshot) {
    await syncCloudWorkspace({ silent: true });
    return;
  }

  const remoteRoster = Array.isArray(payload.new.roster) ? payload.new.roster : null;
  if (!remoteRoster) {
    await syncCloudWorkspace({ silent: true });
    return;
  }

  const rosterChanged = cloudStable(remoteRoster) !== cloudStable(autoCloudWorkspaceSnapshot.roster || []);
  autoCloudWorkspaceSnapshot.roster = remoteRoster;
  await refreshCloudSnapshotVersion();
  if (!rosterChanged) return;

  const localRoster = loadRoster();
  const mergedRoster = mergeCloudRosters(localRoster, remoteRoster).roster;
  const localChanged = cloudStable(mergedRoster) !== cloudStable(localRoster);
  if (localChanged) {
    setCloudApplySuppressed(true);
    try {
      saveRoster(mergedRoster);
    } finally {
      setCloudApplySuppressed(false);
    }
    window.dispatchEvent(new CustomEvent('bvlog-cloud-updated', {
      detail: { localChanged: true, remoteChanged: false, silent: true },
    }));
  } else {
    scheduleCloudSync();
  }
}

function scheduleCloudSync() {
  if (autoCloudSyncSuppressed || !isCloudConfigured()) return;
  window.clearTimeout(autoCloudSyncTimer);
  autoCloudSyncTimer = window.setTimeout(() => {
    syncCloudWorkspace({ silent: true }).catch(() => {});
  }, 700);
}

function stopCloudSync() {
  window.clearTimeout(autoCloudSyncTimer);
  autoCloudSyncTimer = null;
  window.clearInterval(autoCloudSyncInterval);
  autoCloudSyncInterval = null;
  if (autoCloudRealtimeChannel && autoCloudClient) {
    autoCloudClient.removeChannel(autoCloudRealtimeChannel);
  }
  autoCloudRealtimeChannel = null;
  autoCloudSyncStartedKey = '';
  autoCloudWorkspaceSnapshot = null;
  autoCloudWorkspaceUpdatedAt = '';
  autoCloudGameSyncCursor = '';
  autoCloudDeletionSyncCursor = '';
  autoCloudMembershipKey = '';
  autoCloudGameRowsAvailable = null;
}

async function startCloudSync() {
  if (!isCloudConfigured()) return { skipped: true };
  const client = getCloudClient();
  if (!client) return { skipped: true };
  const config = loadCloudConfig();
  const syncKey = `${config.url}|${config.publishableKey}|${config.workspaceId}`;

  if (autoCloudSyncStartedKey !== syncKey) {
    stopCloudSync();
    autoCloudSyncStartedKey = syncKey;
    // Do not subscribe to Supabase Realtime here. Realtime sends every game
    // JSON payload to every connected device, which is unnecessarily costly
    // for this app. Startup sync and the manual update button use the same
    // incremental row download path instead.
    autoCloudRealtimeChannel = null;
    autoCloudSyncInterval = null;
  }
  return syncCloudWorkspace({ silent: true });
}

function restartCloudSync() {
  stopCloudSync();
  if (isCloudConfigured()) startCloudSync().catch(() => {});
}
