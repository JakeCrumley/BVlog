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
  liveGame:       (gameId) => renderLiveTrackingScreen(gameId),
  history:        () => renderHistoryScreen(),
  playerStats:    () => renderPlayerStatsScreen(),
  teamStats:      () => renderTeamStatsScreen(),
  statBreakdown:  (selectedStatIds, perGameStats) => renderStatBreakdownScreen(selectedStatIds, perGameStats),
  cloudSync:      () => renderCloudSyncScreen(),
  editGameDetails: (gameId) => renderGameDetailsEditScreen(gameId),
  gameSummary:    (gameId) => renderGameSummaryScreen(gameId),
};

let activeScreen = 'home';

function navigate(screen, param) {
  const render = SCREENS[screen];
  if (!render) {
    console.error('Unknown screen:', screen);
    return;
  }
  activeScreen = screen;
  render(param);
}

// Refresh read-only screens when another connected device merges new data.
// Live tracking is intentionally left alone so a realtime update cannot
// interrupt a coach in the middle of logging a rally.
window.addEventListener('bvlog-cloud-updated', () => {
  if (['roster', 'history', 'playerStats', 'teamStats', 'statBreakdown'].includes(activeScreen)) {
    navigate(activeScreen);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  navigate('home');
  if (typeof startCloudSync === 'function') startCloudSync().catch(() => {});
});
