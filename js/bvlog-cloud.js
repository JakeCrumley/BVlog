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

async function loadCloudWorkspace() {
  const client = getCloudClient();
  const workspaceId = loadCloudConfig().workspaceId;
  if (!client || !workspaceId) throw new Error('Save Supabase settings and a workspace id first.');

  const { data, error } = await client
    .from('bvlog_workspaces')
    .select('id, name, roster, games, updated_at')
    .eq('id', workspaceId)
    .single();
  if (error) throw error;
  return data;
}

async function saveCloudWorkspace(roster, games) {
  const client = getCloudClient();
  const config = loadCloudConfig();
  if (!client || !config.workspaceId) throw new Error('Save Supabase settings and a workspace id first.');

  const { data, error } = await client
    .from('bvlog_workspaces')
    .update({ roster, games, updated_at: new Date().toISOString() })
    .eq('id', config.workspaceId)
    .select('id, updated_at')
    .single();
  if (error) throw error;
  return data;
}

// ============================================================
// Automatic merge sync
// ============================================================
// The functions below intentionally supersede the initial explicit-transfer
// functions above. Keeping the small foundation intact makes older saved
// settings compatible while all new writes use merge semantics.

const CLOUD_SYNC_INTERVAL_MS = 15000;
let autoCloudClient = null;
let autoCloudClientKey = '';
let autoCloudAuthSubscription = null;
let autoCloudRealtimeChannel = null;
let autoCloudSyncTimer = null;
let autoCloudSyncInterval = null;
let autoCloudSyncInFlight = null;
let autoCloudSyncStartedKey = '';
let autoCloudSyncSuppressed = false;

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
  const byId = new Map();
  for (const raw of [...localGames, ...remoteGames]) {
    if (!raw?.id || !Array.isArray(raw.events)) continue;
    const game = remapCloudGame(raw, idRemap);
    const existing = byId.get(game.id);
    if (!existing || cloudTime(game.updatedAt || game.date) > cloudTime(existing.updatedAt || existing.date)) {
      byId.set(game.id, game);
    }
  }
  return [...byId.values()].sort((a, b) => cloudTime(a.date) - cloudTime(b.date));
}

function cloudStable(value) {
  return JSON.stringify(value || []);
}

function mergeCloudData(localRoster, localGames, remoteRoster, remoteGames) {
  const rosterResult = mergeCloudRosters(localRoster, remoteRoster);
  return {
    roster: rosterResult.roster,
    games: mergeCloudGames(localGames, remoteGames, rosterResult.idRemap),
  };
}

function setCloudApplySuppressed(value) {
  autoCloudSyncSuppressed = Boolean(value);
}

function applyCloudMergedData(merged) {
  setCloudApplySuppressed(true);
  try {
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

async function fetchCloudWorkspace() {
  const client = getCloudClient();
  const workspaceId = loadCloudConfig().workspaceId;
  if (!client || !workspaceId) throw new Error('Save Supabase settings and a workspace id first.');
  const { data, error } = await client
    .from('bvlog_workspaces')
    .select('id, name, roster, games, updated_at')
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

  const { error } = await client
    .from('bvlog_workspace_members')
    .insert({ workspace_id: workspaceId, user_id: userData.user.id, role: 'coach' });
  if (error && error.code !== '23505') throw error;
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

async function saveCloudWorkspace(roster, games) {
  const client = getCloudClient();
  const config = loadCloudConfig();
  if (!client || !config.workspaceId) throw new Error('Save Supabase settings and a workspace id first.');

  const remote = await fetchCloudWorkspace();
  const merged = mergeCloudData(roster, games, remote.roster || [], remote.games || []);
  const changed = cloudStable(merged.roster) !== cloudStable(remote.roster)
    || cloudStable(merged.games) !== cloudStable(remote.games);
  if (!changed) return { id: remote.id, updated_at: remote.updated_at, changed: false, merged };

  const { data, error } = await client
    .from('bvlog_workspaces')
    .update({ roster: merged.roster, games: merged.games, updated_at: new Date().toISOString() })
    .eq('id', config.workspaceId)
    .select('id, updated_at')
    .single();
  if (error) throw error;
  return { ...data, changed: true, merged };
}

async function syncCloudWorkspace({ silent = false } = {}) {
  if (!isCloudConfigured()) return { skipped: true };
  if (autoCloudSyncInFlight) return autoCloudSyncInFlight;

  autoCloudSyncInFlight = (async () => {
    const session = await getCloudSession();
    if (!session) return { signedOut: true };

    await ensureCloudWorkspaceMembership();
    const remote = await fetchCloudWorkspace();
    const merged = mergeCloudData(
      loadRoster(),
      loadGameHistory(),
      remote.roster || [],
      remote.games || [],
    );
    const localRoster = loadRoster();
    const localGames = loadGameHistory();
    const localChanged = cloudStable(merged.roster) !== cloudStable(localRoster)
      || cloudStable(merged.games) !== cloudStable(localGames);
    if (localChanged) applyCloudMergedData(merged);

    const remoteChanged = cloudStable(merged.roster) !== cloudStable(remote.roster)
      || cloudStable(merged.games) !== cloudStable(remote.games);
    if (remoteChanged) {
      const { error } = await getCloudClient()
        .from('bvlog_workspaces')
        .update({ roster: merged.roster, games: merged.games, updated_at: new Date().toISOString() })
        .eq('id', loadCloudConfig().workspaceId);
      if (error) throw error;
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
    autoCloudRealtimeChannel = client
      .channel(`bvlog-workspace-${config.workspaceId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bvlog_workspaces',
        filter: `id=eq.${config.workspaceId}`,
      }, () => syncCloudWorkspace({ silent: true }).catch(() => {}))
      .subscribe();
    autoCloudSyncInterval = window.setInterval(() => {
      syncCloudWorkspace({ silent: true }).catch(() => {});
    }, CLOUD_SYNC_INTERVAL_MS);
  }
  return syncCloudWorkspace({ silent: true });
}

function restartCloudSync() {
  stopCloudSync();
  if (isCloudConfigured()) startCloudSync().catch(() => {});
}

window.addEventListener('online', () => startCloudSync().catch(() => {}));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') startCloudSync().catch(() => {});
});
