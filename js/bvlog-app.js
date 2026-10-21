// ============================================================
// BVLOG — APP ENTRY POINT / ROUTER
// ============================================================
// A tiny manual router: navigate(screen, param) clears #app and
// renders the requested screen. No URL/hash routing (not needed for
// this app) — just a function call.

const SCREENS = {
  home:           () => renderHomeScreen(),
  roster:         () => renderRosterScreen(),
  newGame:        () => renderGameSetupScreen(),
  startingAction: (setupData) => renderStartingActionScreen(setupData),
  setStartingAction: (state = {}) => renderSetStartingActionScreen(state),
  setCompletion: (gameId) => renderSetCompletionScreen(gameId),
  liveGame:       (gameId) => renderLiveTrackingScreen(gameId),
  history:        () => renderHistoryScreen(),
  playerStats:    (state = {}) => renderPlayerStatsScreen(
    state.selectedPlayerId || null,
    Array.isArray(state.comparisonPlayerIds) ? state.comparisonPlayerIds : [],
    state.perGameStats !== false,
    state.filters || {},
  ),
  teamStats:      () => renderTeamStatsScreen(),
  statBreakdown:  (state = {}) => Array.isArray(state)
    ? renderStatBreakdownScreen(state, true)
    : renderStatBreakdownScreen(
      state.selectedStatIds === undefined ? null : state.selectedStatIds,
      state.perGameStats !== false,
      state.sortId || null,
      state.sortDirection || 'desc',
      state.scope || 'match',
    ),
  statisticalBreakdowns: (state = {}) => renderStatisticalBreakdownsScreen(state),
  visualizations: (state = {}) => renderVisualizationsScreen(state),
  cloudSync:      () => renderCloudSyncScreen(),
  editGameDetails: (gameId) => renderGameDetailsEditScreen(gameId),
  editPointInput: (state = {}) => renderPointInputEditScreen(state),
  gameSummary:    (state) => renderGameSummaryScreen(
    state && typeof state === 'object' ? state.gameId : state,
    state && typeof state === 'object' ? state.scope : 'match',
  ),
};

let activeScreen = 'home';
let activeScreenParam = undefined;

function navigate(screen, param) {
  const render = SCREENS[screen];
  if (!render) {
    console.error('Unknown screen:', screen);
    return;
  }
  activeScreen = screen;
  activeScreenParam = param;
  render(param);
}

// Some screens update themselves directly from control handlers rather than
// through navigate(). Preserve their current state so a cloud refresh does
// not unexpectedly reset a detail view back to its list screen.
function rememberActiveScreenParam(screen, param) {
  if (activeScreen === screen) activeScreenParam = param;
}

// Refresh read-only screens when another connected device merges new data.
// Live tracking is intentionally left alone so a realtime update cannot
// interrupt a coach in the middle of logging a rally.
window.addEventListener('bvlog-cloud-updated', () => {
  if (['roster', 'history', 'playerStats', 'teamStats', 'statBreakdown', 'statisticalBreakdowns', 'visualizations'].includes(activeScreen)) {
    navigate(activeScreen, activeScreenParam);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  navigate('home');
  if (typeof startCloudSync === 'function') startCloudSync().catch(() => {});
});
