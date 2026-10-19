// ============================================================
// BVLOG — UI
// ============================================================
// Plain DOM manipulation — no framework. Each render function clears
// and rebuilds #app from scratch, which is simple and fast enough for
// an app this size (no virtual-DOM diffing needed).
//
// Depends on bvlog-storage.js (loadRoster, addPlayerToRoster, etc.)
// and bvlog-model.js (createGame). Navigation itself (navigate()) is
// defined in app.js.

const appEl = document.getElementById('app');
let pointEditContext = null;

function clearApp() {
  appEl.innerHTML = '';
}

function getPointEditContext(gameId) {
  return pointEditContext?.gameId === gameId ? pointEditContext : null;
}

function getWorkingGame(gameId) {
  const game = getGameById(gameId);
  const editContext = getPointEditContext(gameId);
  if (!game || !editContext) return game;

  return {
    ...game,
    events: [...editContext.prefixEvents, ...editContext.replacementEvents],
  };
}

function clearPointEditContext() {
  pointEditContext = null;
}

// A game is either completed or paused. Older saved games and incomplete
// legacy games are treated as paused.
function getGameStatus(game) {
  return game?.isComplete ? 'completed' : 'paused';
}

function getGameStatusLabel(game) {
  const status = getGameStatus(game);
  if (status === 'completed') return 'Completed';
  return 'Paused';
}

// ----------------------------
// Shared brand header
// ----------------------------
// The header replaces the old tab navigation. Clicking the branded header
// always returns to the Home screen.
function renderNavBar() {
  const brand = document.createElement('button');
  brand.type = 'button';
  brand.className = 'brand-header';
  brand.title = 'Return to Home';
  brand.setAttribute('aria-label', 'Return to Home');
  brand.addEventListener('click', () => {
    clearPointEditContext();
    navigate('home');
  });
  const logo = document.createElement('img');
  logo.className = 'spartan-logo';
  logo.src = 'San_Jose_State_Spartans_logo.svg';
  logo.alt = 'SJSU Spartan logo';
  brand.appendChild(logo);

  const title = document.createElement('span');
  title.className = 'brand-title';
  title.textContent = 'SJSU Beach Volleyball';
  brand.appendChild(title);
  return brand;
}

// ----------------------------
// Home screen
// ----------------------------

function renderHomeScreen() {
  clearApp();
  appEl.appendChild(renderNavBar('home'));

  const container = document.createElement('main');
  container.className = 'screen home-screen';

  const actions = document.createElement('div');
  actions.className = 'home-actions';

  const destinations = [
    ['Roster', 'Manage active and archived players.', 'roster'],
    ['New Game', 'Start tracking a new match.', 'newGame'],
    ['History', 'Browse, filter, and review games.', 'history'],
    ['Player Stats', 'View individual player performance.', 'playerStats'],
    ['Team Stats', 'View combined team performance.', 'teamStats'],
    ['Stat Breakdown', 'Rank the roster in selected statistics.', 'statBreakdown'],
    ['Cloud Sync', 'Connect this device to the shared coaching workspace.', 'cloudSync'],
  ];

  for (const [label, description, screen] of destinations) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'home-action-btn';
    button.addEventListener('click', () => navigate(screen));

    const buttonLabel = document.createElement('strong');
    buttonLabel.textContent = label;
    button.appendChild(buttonLabel);

    const buttonDescription = document.createElement('span');
    buttonDescription.textContent = description;
    button.appendChild(buttonDescription);
    actions.appendChild(button);
  }

  container.appendChild(actions);

  const installButton = document.createElement('button');
  installButton.type = 'button';
  installButton.className = 'secondary-btn install-app-btn';
  installButton.textContent = 'Install App';
  installButton.hidden = typeof isPwaInstalled === 'function' && isPwaInstalled();
  installButton.addEventListener('click', () => {
    if (typeof installPwa === 'function') installPwa();
  });
  const updateInstallButton = () => {
    installButton.hidden = typeof isPwaInstalled === 'function' && isPwaInstalled();
  };
  window.addEventListener('bvlog-pwa-install-available', updateInstallButton, { once: true });
  window.addEventListener('bvlog-pwa-install-state-changed', updateInstallButton, { once: true });
  container.appendChild(installButton);
  appEl.appendChild(container);
}

// ----------------------------
// Cloud Sync setup screen
// ----------------------------

function renderCloudSyncScreen() {
  clearApp();
  appEl.appendChild(renderNavBar('home'));

  const container = document.createElement('div');
  container.className = 'screen cloud-sync-screen';

  const title = document.createElement('h1');
  title.textContent = 'Cloud Sync';
  container.appendChild(title);

  const note = document.createElement('p');
  note.className = 'empty-state';
  note.textContent = 'Sign in with a coaching-staff account. This device will use the embedded shared workspace settings and connect automatically.';
  container.appendChild(note);

  const status = document.createElement('p');
  status.className = 'cloud-sync-status';
  status.textContent = 'Checking cloud configuration…';
  container.appendChild(status);

  const config = loadCloudConfig();
  const settingsForm = document.createElement('form');
  settingsForm.className = 'game-setup-form';

  const makeField = (labelText, type, value, placeholder) => {
    const field = document.createElement('label');
    field.textContent = labelText;
    const input = document.createElement('input');
    input.type = type;
    input.value = value || '';
    input.placeholder = placeholder || '';
    field.appendChild(input);
    return { field, input };
  };

  const urlField = makeField('Supabase Project URL', 'url', config.url, 'https://your-project.supabase.co');
  const keyField = makeField('Supabase Publishable Key', 'text', config.publishableKey, 'sb_publishable_…');
  const workspaceField = makeField('Workspace ID', 'text', config.workspaceId, 'Paste or create a workspace');
  settingsForm.appendChild(urlField.field);
  settingsForm.appendChild(keyField.field);
  settingsForm.appendChild(workspaceField.field);

  const settingsActions = document.createElement('div');
  settingsActions.className = 'summary-actions';
  settingsActions.appendChild(makeButton('Save Settings', 'primary-btn', () => {
    if (!saveCloudConfig({
      url: urlField.input.value,
      publishableKey: keyField.input.value,
      workspaceId: workspaceField.input.value,
    })) {
      status.textContent = 'Could not save the cloud settings on this device.';
      return;
    }
    status.textContent = 'Cloud settings saved. Checking the connection…';
    refreshCloudStatus();
  }));
  settingsActions.appendChild(makeButton('Clear Settings', 'secondary-btn', () => {
    clearCloudConfig();
    renderCloudSyncScreen();
  }));
  settingsForm.appendChild(settingsActions);

  const advancedSettings = document.createElement('details');
  advancedSettings.className = 'cloud-advanced-settings';
  const advancedSummary = document.createElement('summary');
  advancedSummary.textContent = 'Advanced Cloud Settings';
  advancedSettings.appendChild(advancedSummary);
  advancedSettings.appendChild(settingsForm);
  container.appendChild(advancedSettings);

  const authTitle = document.createElement('h2');
  authTitle.textContent = 'Staff Account';
  container.appendChild(authTitle);

  const authForm = document.createElement('form');
  authForm.className = 'game-setup-form';
  const emailField = makeField('Email', 'email', '', 'coach@example.com');
  const passwordField = makeField('Password', 'password', '', 'At least 6 characters');
  authForm.appendChild(emailField.field);
  authForm.appendChild(passwordField.field);
  const authActions = document.createElement('div');
  authActions.className = 'summary-actions';
  authActions.appendChild(makeButton('Sign In', 'primary-btn', async () => {
    try {
      await signInToCloud(emailField.input.value.trim(), passwordField.input.value);
      status.textContent = 'Signed in successfully.';
      refreshCloudStatus();
    } catch (error) {
      status.textContent = `Sign-in failed: ${error.message}`;
    }
  }));
  authActions.appendChild(makeButton('Create Account', 'secondary-btn', async () => {
    try {
      const session = await createCloudAccount(emailField.input.value.trim(), passwordField.input.value);
      status.textContent = session
        ? 'Account created and signed in.'
        : 'Account created. Check your email to confirm it, then sign in.';
      refreshCloudStatus();
    } catch (error) {
      status.textContent = `Account creation failed: ${error.message}`;
    }
  }));
  authActions.appendChild(makeButton('Sign Out', 'secondary-btn', async () => {
    try {
      await signOutOfCloud();
      status.textContent = 'Signed out.';
      refreshCloudStatus();
    } catch (error) {
      status.textContent = `Sign-out failed: ${error.message}`;
    }
  }));
  authForm.appendChild(authActions);
  container.appendChild(authForm);

  const workspaceTitle = document.createElement('h2');
  workspaceTitle.textContent = 'Workspace Actions';
  container.appendChild(workspaceTitle);

  const workspaceActions = document.createElement('div');
  workspaceActions.className = 'summary-actions';
  workspaceActions.appendChild(makeButton('Create New Workspace', 'secondary-btn', async () => {
    const name = prompt('Name this shared coaching workspace:', 'SJSU Beach Volleyball');
    if (!name) return;
    try {
      const workspace = await createCloudWorkspace(name);
      workspaceField.input.value = workspace.id;
      status.textContent = `Workspace created: ${workspace.name}. Save the settings to keep it on this device.`;
    } catch (error) {
      status.textContent = `Workspace creation failed: ${error.message}`;
    }
  }));
  workspaceActions.appendChild(makeButton('Join Existing Workspace', 'secondary-btn', async () => {
    try {
      await joinCloudWorkspace();
      status.textContent = 'Joined the workspace. Automatic merge sync is active on this device.';
    } catch (error) {
      status.textContent = `Could not join workspace: ${error.message}`;
    }
  }));
  workspaceActions.appendChild(makeButton('Sync Now (Merge)', 'secondary-btn', async () => {
    try {
      const result = await syncCloudWorkspace();
      status.textContent = result?.skipped
        ? 'Cloud sync is not configured yet.'
        : 'Local and cloud data were merged successfully.';
    } catch (error) {
      status.textContent = `Sync failed: ${error.message}`;
    }
  }));
  container.appendChild(workspaceActions);

  const help = document.createElement('p');
  help.className = 'empty-state';
  help.textContent = 'Once signed in, roster changes and paused or completed games merge automatically. Realtime updates and a periodic refresh bring changes from other connected devices into this app. Use Sync Now if you want to force an immediate merge.';
  container.appendChild(help);

  appEl.appendChild(container);

  async function refreshCloudStatus() {
    if (!isCloudConfigured()) {
      status.textContent = 'Enter the Supabase URL, publishable key, and workspace ID to begin.';
      return;
    }
    try {
      const session = await getCloudSession();
      status.textContent = session
        ? `Signed in as ${session.user.email}. Workspace is configured.`
        : 'Supabase is configured. Sign in to access the shared workspace.';
    } catch (error) {
      status.textContent = `Cloud connection error: ${error.message}`;
    }
  }

  refreshCloudStatus();
}

// ----------------------------
// Roster screen
// ----------------------------

function renderRosterScreen() {
  clearApp();
  appEl.appendChild(renderNavBar('roster'));

  const container = document.createElement('div');
  container.className = 'screen roster-screen';

  const title = document.createElement('h1');
  title.textContent = 'Roster';
  container.appendChild(title);

  // --- Add player form ---
  const form = document.createElement('form');
  form.className = 'add-player-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Player name';
  input.setAttribute('aria-label', 'New player name');

  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.textContent = 'Add Player';

  form.appendChild(input);
  form.appendChild(addBtn);
  container.appendChild(form);

  const errorMsg = document.createElement('p');
  errorMsg.className = 'error-msg';
  errorMsg.hidden = true;
  container.appendChild(errorMsg);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) {
      errorMsg.textContent = 'Enter a name before adding.';
      errorMsg.hidden = false;
      return;
    }
    const player = addPlayerToRoster(name);
    if (!player) {
      errorMsg.textContent = 'Could not save that player — try again.';
      errorMsg.hidden = false;
      return;
    }
    errorMsg.hidden = true;
    input.value = '';
    renderRosterScreen(); // simplest way to reflect the new state: re-render
  });

  // --- Player list ---
  const list = document.createElement('ul');
  list.className = 'roster-list';

  const roster = loadActiveRoster();
  const archivedRoster = loadArchivedRoster();

  if (roster.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No active players — add a player above or restore an archived player.';
    container.appendChild(empty);
  } else {
    for (const player of roster) {
      list.appendChild(renderRosterRow(player, false));
    }
    container.appendChild(list);
  }

  if (archivedRoster.length > 0) {
    const archivedSection = document.createElement('section');
    archivedSection.className = 'archived-roster-section';
    const archivedTitle = document.createElement('h2');
    archivedTitle.textContent = 'Archived Players';
    archivedSection.appendChild(archivedTitle);

    const archivedList = document.createElement('ul');
    archivedList.className = 'roster-list archived-roster-list';
    for (const player of archivedRoster) {
      archivedList.appendChild(renderRosterRow(player, true));
    }
    archivedSection.appendChild(archivedList);
    container.appendChild(archivedSection);
  }

  appEl.appendChild(container);
}

// One <li> per player: name (click to rename) + an archive/restore button.
function renderRosterRow(player, archived) {
  const row = document.createElement('li');
  row.className = 'roster-row';
  if (archived) row.classList.add('archived-roster-row');

  const nameSpan = document.createElement('span');
  nameSpan.className = 'player-name';
  nameSpan.textContent = player.name;
  nameSpan.title = 'Click to rename';

  nameSpan.addEventListener('click', () => {
    const newName = prompt('Rename player:', player.name);
    if (newName === null) return; // cancelled
    const trimmed = newName.trim();
    if (!trimmed || trimmed === player.name) return;
    if (renamePlayer(player.id, trimmed)) {
      renderRosterScreen();
    } else {
      alert('Could not rename that player — try again.');
    }
  });

  const practiceLabel = document.createElement('label');
  practiceLabel.className = 'practice-player-toggle';
  const practiceCheckbox = document.createElement('input');
  practiceCheckbox.type = 'checkbox';
  practiceCheckbox.checked = Boolean(player.practicePlayer);
  practiceCheckbox.setAttribute('aria-label', `Mark ${player.name} as a practice player`);
  practiceCheckbox.addEventListener('change', () => {
    const nextValue = practiceCheckbox.checked;
    practiceCheckbox.disabled = true;
    if (!setPracticePlayer(player.id, nextValue)) {
      practiceCheckbox.checked = !nextValue;
      practiceCheckbox.disabled = false;
      alert('Could not update the practice-player label — try again.');
      return;
    }
    renderRosterScreen();
  });
  practiceLabel.appendChild(practiceCheckbox);
  practiceLabel.appendChild(document.createTextNode('Practice Player'));

  const actionBtn = document.createElement('button');
  actionBtn.type = 'button';
  actionBtn.className = archived ? 'restore-btn' : 'remove-btn';
  actionBtn.textContent = archived ? 'Restore' : 'Archive';
  actionBtn.addEventListener('click', () => {
    if (archived) {
      if (restorePlayer(player.id)) renderRosterScreen();
      else alert('Could not restore that player — try again.');
      return;
    }

    const confirmed = confirm(`Archive ${player.name}? Their historical games and stats will be preserved.`);
    if (!confirmed) return;
    if (archivePlayer(player.id)) {
      renderRosterScreen();
    } else {
      alert('Could not archive that player — try again.');
    }
  });

  const actions = document.createElement('div');
  actions.className = 'roster-row-actions';
  actions.appendChild(practiceLabel);
  actions.appendChild(actionBtn);

  if (archived) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      const confirmed = confirm(
        `Permanently delete ${player.name} from the roster? Existing games will remain, but this player will no longer have a stored roster record.`,
      );
      if (!confirmed) return;
      if (deleteArchivedPlayer(player.id)) {
        renderRosterScreen();
      } else {
        alert('Could not delete that archived player — try again.');
      }
    });
    actions.appendChild(deleteBtn);
  }

  row.appendChild(nameSpan);
  row.appendChild(actions);
  return row;
}

// ----------------------------
// Game Setup screen
// ----------------------------

function renderGameSetupScreen() {
  clearApp();
  appEl.appendChild(renderNavBar('newGame'));

  const container = document.createElement('div');
  container.className = 'screen game-setup-screen';

  const title = document.createElement('h1');
  title.textContent = 'New Game';
  container.appendChild(title);

  const roster = loadActiveRoster();

  if (roster.length < 2) {
    const warning = document.createElement('p');
    warning.className = 'empty-state';
    warning.textContent = 'Add at least 2 players to the Roster before starting a game.';
    container.appendChild(warning);
    appEl.appendChild(container);
    return;
  }

  const form = document.createElement('form');
  form.className = 'game-setup-form';

  // --- Player A select ---
  const fieldA = document.createElement('label');
  fieldA.textContent = 'Player A';
  const selectA = document.createElement('select');
  fieldA.appendChild(selectA);

  // --- Player B select ---
  const fieldB = document.createElement('label');
  fieldB.textContent = 'Player B';
  const selectB = document.createElement('select');
  fieldB.appendChild(selectB);

  for (const player of roster) {
    selectA.appendChild(new Option(player.name, player.id));
    selectB.appendChild(new Option(player.name, player.id));
  }
  // Default to two different players when possible.
  if (roster.length > 1) selectB.selectedIndex = 1;

  // --- Opponent name ---
  const fieldOpp = document.createElement('label');
  fieldOpp.textContent = 'Opponent Name';
  const opponentInput = document.createElement('input');
  opponentInput.type = 'text';
  opponentInput.placeholder = 'e.g. Smith/Jones';
  fieldOpp.appendChild(opponentInput);

  // --- Date the match was actually played ---
  const fieldPlayedDate = document.createElement('label');
  fieldPlayedDate.textContent = 'Match Date';
  const playedDateInput = document.createElement('input');
  playedDateInput.type = 'date';
  playedDateInput.value = getLocalDateInputValue();
  playedDateInput.required = true;
  fieldPlayedDate.appendChild(playedDateInput);

  const errorMsg = document.createElement('p');
  errorMsg.className = 'error-msg';
  errorMsg.hidden = true;

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.textContent = 'Start Game';

  form.appendChild(fieldA);
  form.appendChild(fieldB);
  form.appendChild(fieldOpp);
  form.appendChild(fieldPlayedDate);
  form.appendChild(errorMsg);
  form.appendChild(submitBtn);

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const playerAId = selectA.value;
    const playerBId = selectB.value;
    const opponentName = opponentInput.value.trim();
    const playedDate = playedDateInput.value;

    if (playerAId === playerBId) {
      errorMsg.textContent = 'Player A and Player B must be different.';
      errorMsg.hidden = false;
      return;
    }
    if (!opponentName) {
      errorMsg.textContent = 'Enter an opponent name.';
      errorMsg.hidden = false;
      return;
    }
    if (!playedDate) {
      errorMsg.textContent = 'Choose the date the match was played.';
      errorMsg.hidden = false;
      return;
    }
    errorMsg.hidden = true;
    // Game isn't created yet — startingAction is picked on the next
    // screen. Pass the rest of the setup along with it.
    navigate('startingAction', { playerAId, playerBId, opponentName, playedDate });
  });

  container.appendChild(form);
  appEl.appendChild(container);
}

// ----------------------------
// Starting Action screen
// ----------------------------
// Shown right after "Start Game" — big tap targets rather than a
// radio group, since this (and the live tracking screen after it)
// is meant to be used courtside, not filled in like a form.

function renderStartingActionScreen(setupData) {
  clearApp();
  appEl.appendChild(renderNavBar(null));

  const container = document.createElement('div');
  container.className = 'screen starting-action-screen';

  const title = document.createElement('h1');
  title.textContent = 'Starting Action';
  container.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'empty-state';
  subtitle.textContent = 'Is your team serving or receiving first?';
  container.appendChild(subtitle);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'starting-action-buttons';

  const startGame = (startingAction) => {
    const game = createGame({ ...setupData, startingAction });
    if (!saveGame(game)) {
      alert('Could not save the new game — try again.');
      return;
    }
    navigate('liveGame', game.id);
  };

  const serveBtn = document.createElement('button');
  serveBtn.type = 'button';
  serveBtn.className = 'big-choice-btn serve-btn';
  serveBtn.textContent = 'Serving';
  serveBtn.addEventListener('click', () => startGame('serve'));

  const receiveBtn = document.createElement('button');
  receiveBtn.type = 'button';
  receiveBtn.className = 'big-choice-btn receive-btn';
  receiveBtn.textContent = 'Receiving';
  receiveBtn.addEventListener('click', () => startGame('receive'));

  buttonRow.appendChild(serveBtn);
  buttonRow.appendChild(receiveBtn);
  container.appendChild(buttonRow);

  appEl.appendChild(container);
}

// ----------------------------
// Live Tracking screen
// ----------------------------
// Two columns (Player A / Player B), showing the current phase's
// buttons, color-coded by phase. Some actions need a follow-up
// before the event is actually logged:
//   - Any Sideout/Transition outcome needs an Attack Type tag.
//   - An ace, Sideout kill, or Transition kill ALSO needs a Kill
//     Quality tag (asked after Attack Type, when applicable).
// Those follow-ups are small sub-screens (renderAttackTypeStep /
// renderKillQualityStep) that finish by calling finalizeEvent(),
// which is the only place an event actually gets pushed + saved.

const ACTION_LABELS = {
  ace: 'Ace', ko: 'KO', in_system: 'In-System', error: 'Error',
  error_continue: 'Error (Continue)', aced: 'Aced', oos: 'OOS',
  0: '0', 1: '1', 2: '2', 3: '3', option: 'Option Attack',
  kill: 'Kill', blocked: 'Blocked', continue: 'Continue',
  block_kill: 'Block Kill', block_touch: 'Block Touch', block_error: 'Block Error',
  dig: 'Dig', dig_error: 'Dig Error',
  opponent_kill: 'Opponent Kill', opponent_error: 'Opponent Error',
  receive: 'Receive', dig_return: 'Dig Return', return: 'Dig Return',
};
function labelForAction(action, phase = null) {
  if (phase === PHASES.SETTING && action === 'error') return 'Error (Point End)';
  if (phase === PHASES.PASSING && action === 'return') return 'Return';
  return ACTION_LABELS[action] ?? String(action);
}

const ATTACK_TYPE_LABELS = {
  [ATTACK_TYPES.HARD_DRIVEN]: 'Hard-Driven',
  [ATTACK_TYPES.SHOT]: 'Shot',
  [ATTACK_TYPES.FREEBALL]: 'Free Ball',
};

const KILL_QUALITY_LABELS = {
  [KILL_QUALITIES.NO_CONTACT]: 'No-Contact',
  [KILL_QUALITIES.SEMI_CONTACT]: 'Semi-Contact',
  [KILL_QUALITIES.FULL_CONTACT]: 'Full-Contact',
  [KILL_QUALITIES.OPPONENT_ERROR]: 'Opponent Error',
};

// CSS class per phase, for the color-coded buttons.
const PHASE_COLOR_CLASS = {
  [PHASES.SERVE]: 'phase-serve',
  [PHASES.PASSING]: 'phase-passing',
  [PHASES.SETTING]: 'phase-setting',
  [PHASES.SIDEOUT]: 'phase-sideout',
  [PHASES.TRANSITION]: 'phase-transition',
  [PHASES.DEFENSE]: 'phase-defense',
};

// Actions that are logged against the opponent, not a specific
// player on your team — rendered as their own row, not a column.
const TEAMLESS_ACTIONS = new Set(['opponent_kill', 'opponent_error']);

// Point number for the NEXT event, derived from how many point-ending
// events are already in the log (not stored — consistent with the
// "events are the source of truth" rule everything else follows).
function getCurrentPointNumber(game) {
  let endedCount = 0;
  for (const e of game.events) {
    const cfg = PHASE_CONFIG[e.phase]?.actions[e.action];
    if (cfg?.endsPoint) endedCount++;
  }
  return endedCount + 1;
}

function otherPlayer(player) {
  return player === 'A' ? 'B' : 'A';
}

// The two-column layout is intentionally narrowed by rally context:
// serving rotation, first defensive touch, setter exclusion, and direct
// return/option attacks are all derived from the event log.
function getVisiblePlayers(phase, rallyState) {
  if (phase === PHASES.SERVE && rallyState.servingPlayer) {
    return [rallyState.servingPlayer];
  }

  if (phase === PHASES.SETTING && rallyState.firstDefender) {
    return [otherPlayer(rallyState.firstDefender)];
  }

  if (phase === PHASES.SIDEOUT || phase === PHASES.TRANSITION) {
    if (rallyState.directReturner) return [rallyState.directReturner];
    if (rallyState.setter) {
      return [rallyState.setterIsOption ? rallyState.setter : otherPlayer(rallyState.setter)];
    }
  }

  return ['A', 'B'];
}

function renderLiveTrackingScreen(gameId, scoreChange = null) {
  clearApp();
  appEl.appendChild(renderNavBar(null));

  const game = getWorkingGame(gameId);
  if (!game) {
    const container = document.createElement('div');
    container.className = 'screen';
    container.innerHTML = '<p class="empty-state">Game not found.</p>';
    appEl.appendChild(container);
    return;
  }

  const nameA = findPlayerById(game.playerAId)?.name ?? 'Unknown';
  const nameB = findPlayerById(game.playerBId)?.name ?? 'Unknown';
  const rallyState = deriveRallyState(game);
  const phase = rallyState.phase;
  const editContext = getPointEditContext(gameId);
  const storedGame = editContext ? getGameById(gameId) : null;
  const displaySetNumber = editContext
    ? getEventSetNumber(storedGame, storedGame.events.find((event) => event.pointNumber === editContext.pointNumber))
    : getCurrentSetNumber(game);
  const score = computeScore(game, displaySetNumber);
  const phaseConfig = PHASE_CONFIG[phase];
  const colorClass = PHASE_COLOR_CLASS[phase];

  const container = document.createElement('div');
  container.className = 'screen live-tracking-screen';

  // --- Header: score + current phase ---
  const header = document.createElement('div');
  header.className = 'tracking-header';

  const scoreLine = document.createElement('div');
  scoreLine.className = 'score-line';

  const teamScore = document.createElement('span');
  teamScore.className = 'score-value';
  teamScore.textContent = String(score.team);
  scoreLine.appendChild(teamScore);

  scoreLine.appendChild(document.createTextNode(' – '));

  const opponentScore = document.createElement('span');
  opponentScore.className = 'score-value';
  opponentScore.textContent = String(score.opponent);
  scoreLine.appendChild(opponentScore);

  if (scoreChange === 'team') scoreLine.appendChild(createScoreChangeBadge('team'));
  if (scoreChange === 'opponent') scoreLine.appendChild(createScoreChangeBadge('opponent'));
  header.appendChild(scoreLine);

  const matchupLine = document.createElement('div');
  matchupLine.className = 'matchup-line';
  matchupLine.textContent = `${nameA} & ${nameB} vs. ${game.opponentName} · Set ${displaySetNumber} of 3`;
  header.appendChild(matchupLine);

  if (editContext) {
    const editNote = document.createElement('div');
    editNote.className = 'point-edit-note';
    editNote.textContent = `Editing Point ${editContext.pointNumber} — later points will be preserved.`;
    header.appendChild(editNote);
  }

  const phaseLine = document.createElement('div');
  phaseLine.className = `phase-label ${colorClass}`;
  phaseLine.textContent = phaseConfig.label;
  header.appendChild(phaseLine);

  container.appendChild(header);

  if (phase === PHASES.SIDEOUT || phase === PHASES.TRANSITION) {
    container.appendChild(renderAttackSelection(gameId, game, phase, rallyState, colorClass));
  } else {
    // --- Two player columns ---
    const columns = document.createElement('div');
    columns.className = 'tracking-columns';
    const visiblePlayers = getVisiblePlayers(phase, rallyState);
    if (visiblePlayers.length === 1) columns.classList.add('single-column');

    const actionKeys = Object.keys(phaseConfig.actions)
      .filter(a => !TEAMLESS_ACTIONS.has(a)
        && !(phase === PHASES.DEFENSE && a === 'return')
        && !(phase === PHASES.SETTING && a === '0'));

    for (const player of visiblePlayers) {
      const playerName = player === 'A' ? nameA : nameB;
      columns.appendChild(renderPlayerColumn(gameId, phase, player, playerName, actionKeys, colorClass));
    }
    container.appendChild(columns);
  }

  // --- Teamless row (e.g. opponent errors and opponent kills) ---
  const teamlessKeys = Object.keys(phaseConfig.actions).filter(a => TEAMLESS_ACTIONS.has(a));
  if (teamlessKeys.length > 0) {
    const row = document.createElement('div');
    row.className = 'teamless-row';
    // Passing has one teamless action, so the button is self-explanatory;
    // keep the label for Defense where it groups multiple opponent actions.
    if (phase !== PHASES.PASSING) {
      const label = document.createElement('p');
      label.className = 'teamless-label';
      label.textContent = 'Opponent';
      row.appendChild(label);
    }
    for (const action of teamlessKeys) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `action-btn ${colorClass}`;
      btn.textContent = labelForAction(action, phase);
      btn.addEventListener('click', () => handleActionClick(gameId, phase, null, action));
      row.appendChild(btn);
    }
    container.appendChild(row);
  }

  container.appendChild(renderTrackingControls(gameId));

  const liveStatsTitle = document.createElement('h2');
  liveStatsTitle.className = 'live-stats-title';
  liveStatsTitle.textContent = 'Stat Summary';
  container.appendChild(liveStatsTitle);

  const liveStats = computeGameStats(game);
  container.appendChild(renderLiveStatsSummary(liveStats, nameA, nameB));

  const allStats = document.createElement('details');
  allStats.className = 'live-stats-details';
  const allStatsToggle = document.createElement('summary');
  allStatsToggle.textContent = 'Show All Stats';
  allStats.appendChild(allStatsToggle);
  allStats.appendChild(renderMetricTable(liveStats, nameA, nameB));
  allStats.appendChild(renderRawStatsTable(liveStats, nameA, nameB));
  container.appendChild(allStats);

  appEl.appendChild(container);
}

function createScoreChangeBadge(side) {
  const badge = document.createElement('span');
  badge.className = `score-change ${side}`;
  badge.textContent = '+1';
  badge.setAttribute('aria-label', 'Point gained');
  return badge;
}

function renderTrackingControls(gameId) {
  const game = getWorkingGame(gameId);
  const editContext = getPointEditContext(gameId);
  const controls = document.createElement('div');
  controls.className = 'tracking-controls';

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'undo-btn';
  undoBtn.textContent = 'Undo';
  undoBtn.disabled = editContext
    ? editContext.replacementEvents.length === 0
    : !game || game.events.length === 0;
  undoBtn.addEventListener('click', () => {
    if (editContext) {
      editContext.replacementEvents.pop();
      renderLiveTrackingScreen(gameId);
      return;
    }
    const currentGame = getGameById(gameId);
    if (!currentGame || currentGame.events.length === 0) return;
    undoLastEvent(currentGame);
    saveGame(currentGame);
    renderLiveTrackingScreen(gameId);
  });

  if (editContext) {
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'secondary-btn cancel-point-edit-btn';
    cancelBtn.textContent = 'Cancel Point Edit';
    cancelBtn.addEventListener('click', () => {
      clearPointEditContext();
      navigate('gameSummary', gameId);
    });
    controls.appendChild(undoBtn);
    controls.appendChild(cancelBtn);
    return controls;
  }

  const pauseBtn = document.createElement('button');
  pauseBtn.type = 'button';
  pauseBtn.className = 'pause-btn';
  pauseBtn.textContent = 'Pause Match';
  pauseBtn.addEventListener('click', () => {
    const currentGame = getGameById(gameId);
    if (!currentGame) return;
    if (!pauseGame(gameId)) {
      alert('Could not save the paused game — try again.');
      return;
    }
    navigate('history');
  });

  const endBtn = document.createElement('button');
  endBtn.type = 'button';
  endBtn.className = 'end-match-btn';
  endBtn.textContent = 'End Match';
  endBtn.addEventListener('click', () => {
    if (!confirm('End this match? It will be moved to History.')) return;
    markGameComplete(gameId);
    navigate('gameSummary', gameId);
  });

  const endSetBtn = document.createElement('button');
  endSetBtn.type = 'button';
  endSetBtn.className = 'secondary-btn end-set-btn';
  endSetBtn.textContent = 'End Set';
  endSetBtn.addEventListener('click', () => renderSetCompletionScreen(gameId));

  controls.appendChild(undoBtn);
  controls.appendChild(pauseBtn);
  controls.appendChild(endSetBtn);
  controls.appendChild(endBtn);
  return controls;
}

function renderSetCompletionScreen(gameId) {
  clearApp();
  appEl.appendChild(renderNavBar(null));

  const game = getGameById(gameId);
  if (!game) return navigate('history');

  const currentSet = getCurrentSetNumber(game);
  if (currentSet >= 3) {
    if (!completeMatchAtSetEnd(gameId)) {
      alert('Could not complete the match — try again.');
      navigate('liveGame', gameId);
      return;
    }
    navigate('gameSummary', gameId);
    return;
  }

  const container = document.createElement('div');
  container.className = 'screen step-screen set-completion-screen';

  const title = document.createElement('h1');
  title.textContent = `Set ${currentSet} Complete`;
  container.appendChild(title);

  const score = document.createElement('p');
  score.className = 'summary-score';
  const setScore = computeScore(game, currentSet);
  score.textContent = `${setScore.team} – ${setScore.opponent}`;
  container.appendChild(score);

  const prompt = document.createElement('p');
  prompt.className = 'empty-state';
  prompt.textContent = currentSet < 3
    ? `What would you like to do next?`
    : 'The third set is complete, so this match will end.';
  container.appendChild(prompt);

  const actions = document.createElement('div');
  actions.className = 'step-buttons';

  if (currentSet < 3) {
    actions.appendChild(makeButton(`Move to Set ${currentSet + 1}`, 'primary-btn', () => {
      if (!advanceToNextSet(gameId)) {
        alert('Could not start the next set — try again.');
        return;
      }
      navigate('liveGame', gameId);
    }));
    actions.appendChild(makeButton('End Match', 'end-match-btn', () => {
      if (!completeMatchAtSetEnd(gameId)) {
        alert('Could not complete the match — try again.');
        return;
      }
      navigate('gameSummary', gameId);
    }));
  } else {
    actions.appendChild(makeButton('Finish Match', 'primary-btn', () => {
      if (!completeMatchAtSetEnd(gameId)) {
        alert('Could not complete the match — try again.');
        return;
      }
      navigate('gameSummary', gameId);
    }));
  }

  actions.appendChild(makeButton('Back to Match', 'secondary-btn', () => navigate('liveGame', gameId)));
  container.appendChild(actions);
  appEl.appendChild(container);
}

function renderPlayerColumn(gameId, phase, player, playerName, actionKeys, colorClass) {
  const col = document.createElement('div');
  col.className = 'player-column';

  const heading = document.createElement('h2');
  heading.textContent = playerName;
  col.appendChild(heading);

  for (const action of actionKeys) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `action-btn ${colorClass}`;
    btn.textContent = labelForAction(action, phase);
    btn.addEventListener('click', () => handleActionClick(gameId, phase, player, action));
    col.appendChild(btn);
  }

  return col;
}

// Decides whether a follow-up step is needed before the event can be
// logged, and routes accordingly. `player` is null for teamless
// Defense actions (opponent_kill/opponent_error).
function handleActionClick(gameId, phase, player, action) {
  const game = getWorkingGame(gameId);
  const rallyState = game ? deriveRallyState(game) : null;
  const pending = {
    phase,
    player,
    action,
    attackType: null,
    killQuality: null,
    attackSource: rallyState?.attackSource ?? null,
  };

  if (phase === PHASES.SIDEOUT || phase === PHASES.TRANSITION) {
    renderLiveTrackingScreen(gameId);
    return;
  }

  if (phase === PHASES.SERVE && action === 'ace') {
    renderKillQualityStep(gameId, pending);
    return;
  }

  finalizeEvent(gameId, pending);
}

// Attack screen: choose the attack type and result side by side. Both
// selections are held in memory until complete, so no partial attack event
// is written before the user has chosen both values.
function renderAttackSelection(gameId, game, phase, rallyState, colorClass) {
  const wrapper = document.createElement('div');
  wrapper.className = 'attack-selection';

  const visiblePlayers = getVisiblePlayers(phase, rallyState);
  const attacker = visiblePlayers[0];
  const attackerName = attacker === 'A'
    ? (findPlayerById(game.playerAId)?.name ?? 'Unknown')
    : (findPlayerById(game.playerBId)?.name ?? 'Unknown');

  const attackerLabel = document.createElement('p');
  attackerLabel.className = 'attack-player-label';
  attackerLabel.textContent = `Attacker: ${attackerName}`;
  wrapper.appendChild(attackerLabel);

  const columns = document.createElement('div');
  columns.className = 'attack-selection-columns';

  const typeColumn = document.createElement('div');
  typeColumn.className = 'attack-selection-column';
  const typeHeading = document.createElement('h2');
  typeHeading.textContent = 'Attack Type';
  typeColumn.appendChild(typeHeading);

  const resultColumn = document.createElement('div');
  resultColumn.className = 'attack-selection-column';
  const resultHeading = document.createElement('h2');
  resultHeading.textContent = 'Attack Result';
  resultColumn.appendChild(resultHeading);

  let selectedType = null;
  let selectedResult = null;
  const typeButtons = [];
  const resultButtons = [];

  const completeSelection = () => {
    if (!selectedType || !selectedResult || !attacker) return;

    const pending = {
      phase,
      player: attacker,
      action: selectedResult,
      attackType: selectedType,
      killQuality: null,
      attackSource: rallyState.attackSource ?? null,
    };

    if (selectedResult === 'kill') {
      renderKillQualityStep(gameId, pending);
    } else {
      finalizeEvent(gameId, pending);
    }
  };

  for (const type of Object.values(ATTACK_TYPES)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `action-btn ${colorClass} attack-choice-btn`;
    btn.textContent = ATTACK_TYPE_LABELS[type];
    btn.addEventListener('click', () => {
      selectedType = type;
      for (const other of typeButtons) other.classList.remove('selected');
      btn.classList.add('selected');
      completeSelection();
    });
    typeButtons.push(btn);
    typeColumn.appendChild(btn);
  }

  for (const result of Object.keys(PHASE_CONFIG[phase].actions)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `action-btn ${colorClass} attack-choice-btn`;
    btn.textContent = labelForAction(result, phase);
    btn.addEventListener('click', () => {
      selectedResult = result;
      for (const other of resultButtons) other.classList.remove('selected');
      btn.classList.add('selected');
      completeSelection();
    });
    resultButtons.push(btn);
    resultColumn.appendChild(btn);
  }

  columns.appendChild(typeColumn);
  columns.appendChild(resultColumn);
  wrapper.appendChild(columns);
  return wrapper;
}

// Sub-screen: pick Kill Quality (ace / Sideout kill / Transition kill only).
function renderKillQualityStep(gameId, pending) {
  clearApp();
  appEl.appendChild(renderNavBar(null));

  const container = document.createElement('div');
  container.className = 'screen step-screen';

  const title = document.createElement('h1');
  title.textContent = 'Kill Quality';
  container.appendChild(title);

  const row = document.createElement('div');
  row.className = 'step-buttons';

  for (const quality of Object.values(KILL_QUALITIES)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'big-choice-btn step-btn';
    btn.textContent = KILL_QUALITY_LABELS[quality];
    btn.addEventListener('click', () => {
      finalizeEvent(gameId, { ...pending, killQuality: quality });
    });
    row.appendChild(btn);
  }

  container.appendChild(row);
  container.appendChild(renderTrackingControls(gameId));
  appEl.appendChild(container);
}

// The only place an event actually gets created + saved.
function finalizeEvent(gameId, pending) {
  const storedGame = getGameById(gameId);
  const editContext = getPointEditContext(gameId);
  const game = getWorkingGame(gameId);
  if (!game) {
    alert('Game not found.');
    navigate('roster');
    return;
  }

  const previousScore = computeScore(game, getCurrentSetNumber(game));
  const pointNumber = editContext ? editContext.pointNumber : getCurrentPointNumber(game);
  const pointSetNumber = editContext
    ? getEventSetNumber(storedGame, storedGame.events.find((event) => event.pointNumber === editContext.pointNumber))
    : getCurrentSetNumber(game);
  const event = createEvent({
    phase: pending.phase,
    player: pending.player,
    action: pending.action,
    pointNumber,
    setNumber: pointSetNumber,
    attackType: pending.attackType,
    killQuality: pending.killQuality,
    attackSource: pending.attackSource,
  });

  if (editContext) {
    editContext.replacementEvents.push(event);
    const eventConfig = PHASE_CONFIG[pending.phase]?.actions[pending.action];

    if (eventConfig?.endsPoint) {
      const updatedGame = {
        ...storedGame,
        events: [
          ...editContext.prefixEvents,
          ...editContext.replacementEvents,
          ...editContext.laterEvents,
        ],
      };
      if (!saveGame(updatedGame)) {
        editContext.replacementEvents.pop();
        alert('Could not save the edited point — try again.');
        return;
      }
      clearPointEditContext();
      navigate('gameSummary', gameId);
      return;
    }

    renderLiveTrackingScreen(gameId);
    return;
  }

  game.events.push(event);

  if (!saveGame(game)) {
    alert('Could not save that event — try again.');
  }

  const nextScore = computeScore(game, getCurrentSetNumber(game));
  const scoreChange = nextScore.team > previousScore.team
    ? 'team'
    : nextScore.opponent > previousScore.opponent
      ? 'opponent'
      : null;
  renderLiveTrackingScreen(gameId, scoreChange);
}

// ----------------------------
// History and Match Summary
// ----------------------------

function playerNameForGame(game, side) {
  const player = findPlayerById(side === 'A' ? game.playerAId : game.playerBId);
  const savedName = side === 'A' ? game.playerAName : game.playerBName;
  return player?.name ?? savedName ?? `Player ${side}`;
}

function getLocalDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatGameDate(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatPlayedDate(dateValue) {
  if (!dateValue) return 'Unknown date';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue))
    ? new Date(`${dateValue}T00:00:00`)
    : new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function playedDateForGame(game) {
  return game.playedDate || game.date;
}

function dateInputValueForGame(game) {
  const value = playedDateForGame(game);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return getLocalDateInputValue();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeStatsScope(scope) {
  return [1, 2, 3].includes(Number(scope)) ? Number(scope) : 'match';
}

function gameHasSet(game, setNumber) {
  const selectedSet = Number(setNumber);
  if (![1, 2, 3].includes(selectedSet)) return true;
  return getCompletedSetNumbers(game).includes(selectedSet)
    || getCurrentSetNumber(game) === selectedSet
    || (game.events || []).some((event) => getEventSetNumber(game, event) === selectedSet);
}

function getSetCountForScope(game, scope = 'match') {
  const normalizedScope = normalizeStatsScope(scope);
  if (normalizedScope !== 'match') return gameHasSet(game, normalizedScope) ? 1 : 0;
  const completedSets = getCompletedSetNumbers(game);
  if (completedSets.length > 0) return completedSets.length;
  const eventSets = new Set((game.events || []).map((event) => getEventSetNumber(game, event)));
  return eventSets.size || (game.isComplete ? 1 : 0);
}

function statsEventsForScope(game, scope = 'match') {
  return getGameEventsForScope(game, normalizeStatsScope(scope));
}

function formatPercent(value) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`;
}

function formatStatNumber(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function makeButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function safeFilePart(value) {
  return String(value || 'game')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'game';
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function gameExportBaseName(game) {
  const datePart = /^\d{4}-\d{2}-\d{2}$/.test(String(playedDateForGame(game)))
    ? playedDateForGame(game)
    : new Date(playedDateForGame(game)).toISOString().slice(0, 10);
  return `bvlog-${datePart}-${safeFilePart(game.opponentName)}`;
}

function exportGameJson(gameId) {
  const game = getGameById(gameId);
  if (!game) return;

  const players = [
    {
      id: game.playerAId,
      name: playerNameForGame(game, 'A'),
      archived: findPlayerById(game.playerAId)?.archived ?? true,
      practicePlayer: Boolean(findPlayerById(game.playerAId)?.practicePlayer),
    },
    {
      id: game.playerBId,
      name: playerNameForGame(game, 'B'),
      archived: findPlayerById(game.playerBId)?.archived ?? true,
      practicePlayer: Boolean(findPlayerById(game.playerBId)?.practicePlayer),
    },
  ].filter((player) => player.id && player.name && !player.name.startsWith('Unknown'));
  const payload = {
    formatVersion: 1,
    players,
    game,
    score: computeScore(game),
    stats: computeGameStats(game),
  };
  downloadTextFile(
    `${gameExportBaseName(game)}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  );
}

function exportGameCsv(gameId) {
  const game = getGameById(gameId);
  if (!game) return;

  const rows = [
    ['Game ID', game.id],
    ['Player A', playerNameForGame(game, 'A')],
    ['Player B', playerNameForGame(game, 'B')],
    ['Opponent', game.opponentName],
    ['Played Date', playedDateForGame(game)],
    ['Logged At', game.date],
    ['Sets', getCompletedSetNumbers(game).join(', ') || getCurrentSetNumber(game)],
    ['Starting Action', game.startingAction ?? 'serve'],
    ['Status', getGameStatusLabel(game)],
    ['Final Score', `${computeScore(game).team} - ${computeScore(game).opponent}`],
    [],
    ['Set', 'Point', 'Timestamp', 'Phase', 'Player', 'Action', 'Attack Type', 'Kill Quality', 'Attack Source'],
  ];

  for (const event of game.events) {
    if (event.type === 'set_boundary' || event.action === 'set_end') {
      rows.push([
        event.setNumber,
        '',
        new Date(event.timestamp).toISOString(),
        'Set',
        '',
        'End Set',
        '',
        '',
        '',
      ]);
      continue;
    }
    rows.push([
      getEventSetNumber(game, event),
      event.pointNumber,
      new Date(event.timestamp).toISOString(),
      PHASE_CONFIG[event.phase]?.label ?? event.phase,
      event.player === 'A' ? playerNameForGame(game, 'A') : event.player === 'B' ? playerNameForGame(game, 'B') : 'Opponent',
      labelForAction(event.action, event.phase),
      event.attackType ? ATTACK_TYPE_LABELS[event.attackType] : '',
      event.killQuality ? KILL_QUALITY_LABELS[event.killQuality] : '',
      event.attackSource ?? '',
    ]);
  }

  const csv = rows.map(row => row.map(csvValue).join(',')).join('\r\n');
  downloadTextFile(`${gameExportBaseName(game)}.csv`, csv, 'text/csv');
}

function playerExportBaseName(playerName) {
  return `bvlog-player-${safeFilePart(playerName)}`;
}

function getPlayerStatsExportData(playerId) {
  const row = getPlayerStatsRows(loadGameHistory()).find((entry) => entry.playerId === playerId);
  if (!row) return null;

  const player = findPlayerById(playerId);
  return {
    row,
    player: {
      id: playerId,
      name: player?.name || playerStatsName(row),
      archived: Boolean(player?.archived),
      practicePlayer: Boolean(player?.practicePlayer),
    },
    totals: row.stats,
    perSet: getPlayerStatsForDisplay(row.stats, row.setCount || row.gameCount, true),
  };
}

function exportPlayerStatsJson(playerId) {
  const data = getPlayerStatsExportData(playerId);
  if (!data) return;

  const payload = {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    player: data.player,
    completedGameCount: data.row.gameCount,
    totalStats: data.totals,
    perSetStats: data.perSet,
  };
  downloadTextFile(
    `${playerExportBaseName(data.player.name)}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  );
}

function exportPlayerStatsCsv(playerId) {
  const data = getPlayerStatsExportData(playerId);
  if (!data) return;

  const rows = [
    ['Player', data.player.name],
    ['Player ID', data.player.id],
    ['Status', data.player.archived ? 'Archived' : 'Active'],
    ['Completed Games', data.row.gameCount],
    ['Exported At', new Date().toISOString()],
    [],
    ['Section', 'Stat', 'Total', 'Per Set'],
  ];

  for (const group of getPerformanceMetricGroups()) {
    for (const [label, key, formatter] of group.rows) {
      rows.push([
        group.label,
        label,
        formatter(data.totals[key]),
        formatter(data.perSet[key]),
      ]);
    }
  }

  rows.push([], ['Raw Counts', 'Stat', 'Total', 'Per Set']);
  for (const [bucketName, bucket] of Object.entries(data.totals.raw)) {
    for (const [key, value] of Object.entries(bucket)) {
      rows.push([
        bucketName,
        key,
        formatStatNumber(value),
        formatStatNumber(data.perSet.raw[bucketName]?.[key]),
      ]);
    }
  }

  const csv = rows.map((row) => row.map(csvValue).join(',')).join('\r\n');
  downloadTextFile(
    `${playerExportBaseName(data.player.name)}.csv`,
    csv,
    'text/csv',
  );
}

function normalizeImportText(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function normalizeImportedGame(game) {
  if (!game || typeof game !== 'object' || !Array.isArray(game.events)) return null;

  const importedDefaultSet = [1, 2, 3].includes(Number(game.setNumber)) ? Number(game.setNumber) : 1;

  const playedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(game.playedDate || ''))
    ? game.playedDate
    : /^\d{4}-\d{2}-\d{2}/.test(String(game.date || ''))
      ? String(game.date).slice(0, 10)
      : getLocalDateInputValue();

  return {
    ...game,
    id: game.id || crypto.randomUUID(),
    date: game.date || new Date().toISOString(),
    playedDate,
    setNumber: 1,
    currentSetNumber: getCurrentSetNumber(game),
    completedSetNumbers: getCompletedSetNumbers(game),
    startingAction: game.startingAction === 'receive' ? 'receive' : 'serve',
    isComplete: Boolean(game.isComplete),
    status: game.isComplete ? 'completed' : 'paused',
    events: game.events.map((event) => ({
      ...event,
      id: event.id || crypto.randomUUID(),
      timestamp: event.timestamp || Date.now(),
      type: event.type || 'stat',
      setNumber: [1, 2, 3].includes(Number(event.setNumber)) ? Number(event.setNumber) : importedDefaultSet,
      attackSource: event.attackSource || null,
    })),
  };
}

function findOrCreateImportedPlayer(name, importedPlayers) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;

  const existing = loadRoster().find((player) =>
    normalizeImportText(player.name) === normalizeImportText(trimmed),
  );
  if (existing) return existing;

  const imported = importedPlayers.find((player) =>
    normalizeImportText(player.name) === normalizeImportText(trimmed),
  );
  if (imported) return imported;

  const player = { id: crypto.randomUUID(), name: trimmed };
  importedPlayers.push(player);
  return player;
}

function summarizeImport(games) {
  const existingIds = new Set(loadGameHistory().map((game) => game.id));
  const added = games.filter((game) => !existingIds.has(game.id)).length;
  return { added, updated: games.length - added };
}

function importPreparedData(games, players, sourceLabel) {
  const normalizedGames = games.map(normalizeImportedGame).filter(Boolean);
  if (normalizedGames.length === 0) {
    alert(`No valid games were found in the ${sourceLabel} file.`);
    return false;
  }

  const { added, updated } = summarizeImport(normalizedGames);
  const updateText = updated > 0
    ? ` ${updated} existing game${updated === 1 ? '' : 's'} will be updated.`
    : '';
  const confirmed = confirm(
    `Import ${normalizedGames.length} game${normalizedGames.length === 1 ? '' : 's'} from this ${sourceLabel} backup? ${added} new game${added === 1 ? '' : 's'} will be added.${updateText}`,
  );
  if (!confirmed) return false;

  const result = mergeImportedData(normalizedGames, players);
  if (!result) {
    alert('The backup could not be imported. No changes were saved.');
    return false;
  }

  alert(`Import complete: ${result.added} game${result.added === 1 ? '' : 's'} added, ${result.updated} updated.`);
  renderHistoryScreen();
  return true;
}

async function importJsonBackupFile(file) {
  try {
    const payload = JSON.parse(await file.text());
    const games = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.games)
        ? payload.games
        : payload.game
          ? [payload.game]
          : payload.id && Array.isArray(payload.events)
            ? [payload]
            : [];
    const players = Array.isArray(payload?.players) ? payload.players : [];
    importPreparedData(games, players, 'JSON');
  } catch (error) {
    console.error('JSON backup import failed:', error);
    alert('That JSON file could not be read. Choose a BVlog JSON backup file.');
  }
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function phaseKeyFromImportLabel(value) {
  const normalized = normalizeImportText(value);
  return Object.entries(PHASE_CONFIG).find(([key, config]) =>
    normalizeImportText(config.label) === normalized || normalizeImportText(key) === normalized,
  )?.[0] || null;
}

function actionKeyFromImportLabel(phase, value) {
  const normalized = normalizeImportText(value);
  return Object.keys(PHASE_CONFIG[phase]?.actions || {}).find((key) =>
    normalizeImportText(labelForAction(key, phase)) === normalized
      || normalizeImportText(key) === normalized
      || (phase === PHASES.SETTING && key === 'error' && normalized === 'error'),
  ) || null;
}

function lookupImportLabel(labels, value) {
  const normalized = normalizeImportText(value);
  return Object.entries(labels).find(([key, label]) =>
    normalizeImportText(key) === normalized || normalizeImportText(label) === normalized,
  )?.[0] || null;
}

function importCsvBackupText(text) {
  const rows = parseCsvText(text);
  const metadata = new Map();
  let headerIndex = -1;

  rows.forEach((row, index) => {
    if (row.includes('Phase') && row.includes('Action')) headerIndex = index;
    else if (headerIndex === -1 && row.length >= 2 && row[0]) metadata.set(row[0], row[1]);
  });

  if (headerIndex === -1) {
    alert('That CSV file does not contain a BVlog event header.');
    return false;
  }

  const importedPlayers = [];
  const playerA = findOrCreateImportedPlayer(metadata.get('Player A'), importedPlayers);
  const playerB = findOrCreateImportedPlayer(metadata.get('Player B'), importedPlayers);
  if (!playerA || !playerB || playerA.id === playerB.id) {
    alert('The CSV backup needs two different Player A and Player B names.');
    return false;
  }

  const header = rows[headerIndex];
  const column = (name) => header.indexOf(name);
  const game = {
    id: metadata.get('Game ID') || crypto.randomUUID(),
    date: metadata.get('Logged At') || new Date().toISOString(),
    playedDate: metadata.get('Played Date') || getLocalDateInputValue(),
    setNumber: 1,
    currentSetNumber: 1,
    completedSetNumbers: [],
    playerAId: playerA.id,
    playerBId: playerB.id,
    opponentName: metadata.get('Opponent') || 'Imported Opponent',
    startingAction: metadata.get('Starting Action') === 'receive' ? 'receive' : 'serve',
    isComplete: metadata.has('Status')
      ? normalizeImportText(metadata.get('Status')) === 'completed'
      : true,
    status: normalizeImportText(metadata.get('Status')) === 'completed'
      ? 'completed'
      : 'paused',
    events: [],
  };

  for (const row of rows.slice(headerIndex + 1)) {
    if (!row.length || !row[0] || !row[2] || !row[3]) continue;
    const rowPhase = normalizeImportText(row[column('Phase')]);
    if (rowPhase === 'set' && normalizeImportText(row[column('Action')]) === 'end set') {
      game.events.push({
        id: crypto.randomUUID(),
        timestamp: Date.parse(row[column('Timestamp')]) || Date.now(),
        type: 'set_boundary',
        setNumber: [1, 2, 3].includes(Number(row[column('Set')])) ? Number(row[column('Set')]) : 1,
        phase: null,
        player: null,
        action: 'set_end',
        pointNumber: null,
        attackType: null,
        killQuality: null,
        attackSource: null,
      });
      continue;
    }
    const phase = phaseKeyFromImportLabel(row[column('Phase')]);
    const action = actionKeyFromImportLabel(phase, row[column('Action')]);
    if (!phase || !action) continue;

    const timestampValue = Date.parse(row[column('Timestamp')]);
    const playerName = row[column('Player')];
    const player = normalizeImportText(playerName) === normalizeImportText(playerA.name)
      ? 'A'
      : normalizeImportText(playerName) === normalizeImportText(playerB.name)
        ? 'B'
        : null;
    const pointNumber = Number(row[column('Point')]);
    game.events.push({
      id: crypto.randomUUID(),
      timestamp: Number.isFinite(timestampValue) ? timestampValue : Date.now(),
      type: 'stat',
      setNumber: [1, 2, 3].includes(Number(row[column('Set')])) ? Number(row[column('Set')]) : 1,
      phase,
      player,
      action,
      pointNumber: Number.isFinite(pointNumber) && pointNumber > 0 ? pointNumber : 1,
      attackType: lookupImportLabel(ATTACK_TYPE_LABELS, row[column('Attack Type')]),
      killQuality: lookupImportLabel(KILL_QUALITY_LABELS, row[column('Kill Quality')]),
      attackSource: row[column('Attack Source')] || null,
    });
  }

  const importedSetNumbers = [...new Set(game.events.map((event) => event.setNumber))].sort((a, b) => a - b);
  game.completedSetNumbers = importedSetNumbers.length > 0 ? importedSetNumbers : [1];
  game.currentSetNumber = importedSetNumbers.length > 0 ? Math.max(...importedSetNumbers) : 1;
  return importPreparedData([game], importedPlayers, 'CSV');
}

function createBackupImportControl(label, accept, onFile) {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-import-control';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.hidden = true;
  const button = makeButton(label, 'secondary-btn', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) await onFile(file);
  });
  wrapper.appendChild(button);
  wrapper.appendChild(input);
  return wrapper;
}

function beginPointEdit(gameId, pointNumber) {
  const game = getGameById(gameId);
  if (!game) return;

  const firstPointEventIndex = game.events.findIndex((event) => event.pointNumber === pointNumber);
  if (firstPointEventIndex < 0) return;

  let lastPointEventIndex = firstPointEventIndex;
  while (lastPointEventIndex + 1 < game.events.length
    && game.events[lastPointEventIndex + 1].pointNumber === pointNumber) {
    lastPointEventIndex++;
  }

  pointEditContext = {
    gameId,
    pointNumber,
    prefixEvents: game.events.slice(0, firstPointEventIndex),
    laterEvents: game.events.slice(lastPointEventIndex + 1),
    replacementEvents: [],
  };
  navigate('liveGame', gameId);
}

function reopenGameForEditing(gameId, opponentName) {
  const confirmed = confirm(`Reopen the game against ${opponentName} for editing?`);
  if (!confirmed) return;
  if (!reopenGame(gameId)) {
    alert('Could not reopen that game — try again.');
    return;
  }
  navigate('liveGame', gameId);
}

function renderGameDetailsEditScreen(gameId) {
  clearApp();
  appEl.appendChild(renderNavBar('history'));

  const game = getGameById(gameId);
  if (!game) {
    const missing = document.createElement('div');
    missing.className = 'screen';
    missing.innerHTML = '<p class="empty-state">Game not found.</p>';
    appEl.appendChild(missing);
    return;
  }

  const container = document.createElement('div');
  container.className = 'screen edit-game-screen';

  const title = document.createElement('h1');
  title.textContent = 'Edit Game Details';
  container.appendChild(title);

  const note = document.createElement('p');
  note.className = 'empty-state';
  note.textContent = 'Update the game information without changing its recorded events.';
  container.appendChild(note);

  const roster = loadActiveRoster();
  for (const playerId of [game.playerAId, game.playerBId]) {
    const archivedPlayer = findPlayerById(playerId);
    if (archivedPlayer && !roster.some((player) => player.id === archivedPlayer.id)) {
      roster.push(archivedPlayer);
    }
  }
  const form = document.createElement('form');
  form.className = 'game-setup-form';

  const fieldA = document.createElement('label');
  fieldA.textContent = 'Player A';
  const selectA = document.createElement('select');
  fieldA.appendChild(selectA);

  const fieldB = document.createElement('label');
  fieldB.textContent = 'Player B';
  const selectB = document.createElement('select');
  fieldB.appendChild(selectB);

  const addPlayerOptions = (select, currentId, side) => {
    for (const player of roster) {
      select.appendChild(new Option(player.name, player.id));
    }
    if (!roster.some((player) => player.id === currentId) && currentId) {
      select.appendChild(new Option(`${playerNameForGame(game, side)} (not on roster)`, currentId));
    }
    select.value = currentId;
  };
  addPlayerOptions(selectA, game.playerAId, 'A');
  addPlayerOptions(selectB, game.playerBId, 'B');

  const fieldOpp = document.createElement('label');
  fieldOpp.textContent = 'Opponent Name';
  const opponentInput = document.createElement('input');
  opponentInput.type = 'text';
  opponentInput.value = game.opponentName || '';
  fieldOpp.appendChild(opponentInput);

  const fieldPlayedDate = document.createElement('label');
  fieldPlayedDate.textContent = 'Match Date';
  const playedDateInput = document.createElement('input');
  playedDateInput.type = 'date';
  playedDateInput.value = dateInputValueForGame(game);
  playedDateInput.required = true;
  fieldPlayedDate.appendChild(playedDateInput);

  const fieldStartingAction = document.createElement('label');
  fieldStartingAction.textContent = 'Starting Action';
  const startingActionSelect = document.createElement('select');
  startingActionSelect.appendChild(new Option('Serving first', 'serve'));
  startingActionSelect.appendChild(new Option('Receiving first', 'receive'));
  startingActionSelect.value = game.startingAction === 'receive' ? 'receive' : 'serve';
  fieldStartingAction.appendChild(startingActionSelect);

  const errorMsg = document.createElement('p');
  errorMsg.className = 'error-msg';
  errorMsg.hidden = true;

  const buttonRow = document.createElement('div');
  buttonRow.className = 'summary-actions';
  const saveButton = makeButton('Save Changes', 'primary-btn', () => form.requestSubmit());
  const cancelButton = makeButton('Cancel', 'secondary-btn', () => navigate('gameSummary', gameId));
  buttonRow.appendChild(saveButton);
  buttonRow.appendChild(cancelButton);

  form.appendChild(fieldA);
  form.appendChild(fieldB);
  form.appendChild(fieldOpp);
  form.appendChild(fieldPlayedDate);
  form.appendChild(fieldStartingAction);
  form.appendChild(errorMsg);
  form.appendChild(buttonRow);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const details = {
      playerAId: selectA.value,
      playerBId: selectB.value,
      opponentName: opponentInput.value.trim(),
      playedDate: playedDateInput.value,
      startingAction: startingActionSelect.value,
    };

    if (details.playerAId === details.playerBId) {
      errorMsg.textContent = 'Player A and Player B must be different.';
      errorMsg.hidden = false;
      return;
    }
    if (!details.opponentName) {
      errorMsg.textContent = 'Enter an opponent name.';
      errorMsg.hidden = false;
      return;
    }
    if (!details.playedDate) {
      errorMsg.textContent = 'Choose the date the match was played.';
      errorMsg.hidden = false;
      return;
    }

    if (!updateGameDetails(gameId, details)) {
      errorMsg.textContent = 'Could not save the game details — try again.';
      errorMsg.hidden = false;
      return;
    }
    navigate('gameSummary', gameId);
  });

  container.appendChild(form);
  appEl.appendChild(container);
}

function renderHistoryScreen() {
  clearApp();
  appEl.appendChild(renderNavBar('history'));

  const container = document.createElement('div');
  container.className = 'screen history-screen';

  const title = document.createElement('h1');
  title.textContent = 'History';
  container.appendChild(title);

  const importControls = document.createElement('div');
  importControls.className = 'history-import-controls';
  importControls.appendChild(createBackupImportControl(
    'Import JSON Backup',
    '.json,application/json',
    (file) => importJsonBackupFile(file),
  ));
  importControls.appendChild(createBackupImportControl(
    'Import CSV Backup',
    '.csv,text/csv',
    async (file) => importCsvBackupText(await file.text()),
  ));
  container.appendChild(importControls);

  const inProgress = getInProgressGames();
  const completed = getCompletedGames();
  const allGames = [...inProgress, ...completed];

  const filters = document.createElement('div');
  filters.className = 'history-filter-panel';

  const makeFilterField = (labelText, control) => {
    const field = document.createElement('label');
    field.className = 'history-filter-field';
    if (control.type === 'date') field.classList.add('date-filter-field');
    field.textContent = labelText;
    field.appendChild(control);
    return field;
  };

  const playerInput = document.createElement('input');
  playerInput.id = 'history-player-filter';
  playerInput.type = 'search';
  playerInput.placeholder = 'e.g. Alex';
  playerInput.setAttribute('aria-label', 'Filter by player name');

  const opponentInput = document.createElement('input');
  opponentInput.id = 'history-opponent-filter';
  opponentInput.type = 'search';
  opponentInput.placeholder = 'e.g. Smith/Jones';
  opponentInput.setAttribute('aria-label', 'Filter by opponent');

  const fromDateInput = document.createElement('input');
  fromDateInput.id = 'history-date-from';
  fromDateInput.type = 'date';
  fromDateInput.setAttribute('aria-label', 'Filter matches from date');

  const toDateInput = document.createElement('input');
  toDateInput.id = 'history-date-to';
  toDateInput.type = 'date';
  toDateInput.setAttribute('aria-label', 'Filter matches through date');

  const setSelect = document.createElement('select');
  setSelect.id = 'history-set-filter';
  setSelect.appendChild(new Option('Full match', 'match'));
  for (const setNumber of [1, 2, 3]) {
    setSelect.appendChild(new Option(`Set ${setNumber}`, String(setNumber)));
  }

  const statusSelect = document.createElement('select');
  statusSelect.id = 'history-status-filter';
  statusSelect.appendChild(new Option('Any status', ''));
  statusSelect.appendChild(new Option('Completed', 'completed'));
  statusSelect.appendChild(new Option('Paused', 'paused'));

  const resultSelect = document.createElement('select');
  resultSelect.id = 'history-result-filter';
  resultSelect.appendChild(new Option('Any result', ''));
  resultSelect.appendChild(new Option('Wins', 'win'));
  resultSelect.appendChild(new Option('Losses', 'loss'));

  filters.appendChild(makeFilterField('Player', playerInput));
  filters.appendChild(makeFilterField('Opponent', opponentInput));
  filters.appendChild(makeFilterField('Played from', fromDateInput));
  filters.appendChild(makeFilterField('Played through', toDateInput));
  filters.appendChild(makeFilterField('View', setSelect));
  filters.appendChild(makeFilterField('Status', statusSelect));
  filters.appendChild(makeFilterField('Result', resultSelect));

  const filterActions = document.createElement('div');
  filterActions.className = 'history-filter-actions';
  const clearFiltersButton = makeButton('Clear Filters', 'secondary-btn', () => {
    playerInput.value = '';
    opponentInput.value = '';
    fromDateInput.value = '';
    toDateInput.value = '';
    setSelect.value = 'match';
    statusSelect.value = '';
    resultSelect.value = '';
    renderResults();
  });
  clearFiltersButton.disabled = allGames.length === 0;
  filterActions.appendChild(clearFiltersButton);
  filters.appendChild(filterActions);
  container.appendChild(filters);

  const results = document.createElement('div');
  results.className = 'history-results';
  container.appendChild(results);

  const renderResults = () => {
    results.innerHTML = '';
    const playerQuery = playerInput.value.trim().toLocaleLowerCase();
    const opponentQuery = opponentInput.value.trim().toLocaleLowerCase();
    const startDate = fromDateInput.value;
    const endDate = toDateInput.value;
    const selectedSet = setSelect.value;
    const selectedStatus = statusSelect.value;
    const selectedResult = resultSelect.value;

    const matches = (game) => {
      const playerNames = [playerNameForGame(game, 'A'), playerNameForGame(game, 'B')];
      const playedDate = dateInputValueForGame(game);

      if (playerQuery && !playerNames.some((name) => name.toLocaleLowerCase().includes(playerQuery))) return false;
      if (opponentQuery && !String(game.opponentName || '').toLocaleLowerCase().includes(opponentQuery)) return false;
      if (startDate && playedDate < startDate) return false;
      if (endDate && playedDate > endDate) return false;
      if (!gameHasSet(game, selectedSet)) return false;
      if (selectedStatus && getGameStatus(game) !== selectedStatus) return false;

      if (selectedResult) {
        if (!game.isComplete) return false;
        const score = computeScore(game, selectedSet);
        if (selectedResult === 'win' && score.team <= score.opponent) return false;
        if (selectedResult === 'loss' && score.team >= score.opponent) return false;
      }
      return true;
    };

    const filteredInProgress = inProgress.filter(matches);
    const filteredCompleted = completed.filter(matches);

    if (allGames.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No games yet — start a new game to see it here.';
      results.appendChild(empty);
      return;
    }

    if (filteredInProgress.length === 0 && filteredCompleted.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No games match the selected filters.';
      results.appendChild(empty);
      return;
    }

    if (filteredInProgress.length > 0) {
      results.appendChild(renderHistorySection('Paused Games', filteredInProgress, false, selectedSet));
    }
    if (filteredCompleted.length > 0) {
      results.appendChild(renderHistorySection('Completed Games', filteredCompleted, true, selectedSet));
    }
  };

  for (const control of [playerInput, opponentInput, fromDateInput, toDateInput, setSelect, statusSelect, resultSelect]) {
    control.disabled = allGames.length === 0;
    control.addEventListener('input', renderResults);
    control.addEventListener('change', renderResults);
  }
  renderResults();

  appEl.appendChild(container);
}

function renderHistorySection(titleText, games, completed, scope = 'match') {
  const section = document.createElement('section');
  section.className = 'history-section';

  const title = document.createElement('h2');
  title.textContent = titleText;
  section.appendChild(title);

  const list = document.createElement('div');
  list.className = 'match-card-list';
  for (const game of games) {
    list.appendChild(renderMatchCard(game, completed, scope));
  }
  section.appendChild(list);
  return section;
}

function renderMatchCard(game, completed, scope = 'match') {
  const card = document.createElement('article');
  card.className = 'match-card';

  const heading = document.createElement('div');
  heading.className = 'match-card-heading';

  const matchup = document.createElement('h3');
  matchup.textContent = `${playerNameForGame(game, 'A')} & ${playerNameForGame(game, 'B')} - ${formatPlayedDate(playedDateForGame(game))}`;
  heading.appendChild(matchup);

  const score = document.createElement('strong');
  const computedScore = computeScore(game, scope);
  score.className = 'match-card-score';
  score.textContent = `${computedScore.team} – ${computedScore.opponent}`;
  heading.appendChild(score);
  card.appendChild(heading);

  const meta = document.createElement('p');
  meta.className = 'match-card-meta';
  meta.textContent = `${game.opponentName} · Logged ${formatGameDate(game.date)}`;

  const footer = document.createElement('div');
  footer.className = 'match-card-footer';
  footer.appendChild(meta);

  const setLabel = document.createElement('span');
  setLabel.className = 'match-card-set';
  const completedSets = getCompletedSetNumbers(game);
  const selectedScope = normalizeStatsScope(scope);
  setLabel.textContent = selectedScope !== 'match'
    ? `Set ${selectedScope}`
    : game.isComplete
      ? `${completedSets.length || getCurrentSetNumber(game)} set${(completedSets.length || getCurrentSetNumber(game)) === 1 ? '' : 's'}`
      : `Set ${getCurrentSetNumber(game)} of 3`;

  const footerRight = document.createElement('div');
  footerRight.className = 'match-card-footer-right';
  footerRight.appendChild(setLabel);

  const status = document.createElement('span');
  const gameStatus = getGameStatus(game);
  status.className = `match-card-status ${gameStatus}`;
  status.textContent = getGameStatusLabel(game);
  footerRight.appendChild(status);

  footer.appendChild(footerRight);
  card.appendChild(footer);

  const actions = document.createElement('div');
  actions.className = 'match-card-actions';
  if (!completed) {
    actions.appendChild(makeButton('Resume', 'primary-btn', () => {
      if (!resumeGame(game.id)) {
        alert('Could not resume that game — try again.');
        return;
      }
      navigate('liveGame', game.id);
    }));
  } else {
    actions.appendChild(makeButton('View Summary', 'primary-btn', () => navigate('gameSummary', game.id)));
  }
  actions.appendChild(makeButton('Edit Details', 'secondary-btn', () => navigate('editGameDetails', game.id)));
  if (!completed) {
    actions.appendChild(makeButton('View Summary', 'secondary-btn', () => navigate('gameSummary', game.id)));
  }
  actions.appendChild(makeButton('Delete', 'delete-btn', () => {
    const confirmed = confirm(`Delete this game against ${game.opponentName}? This cannot be undone.`);
    if (!confirmed) return;
    if (!deleteGame(game.id)) {
      alert('Could not delete that game — try again.');
      return;
    }
    renderHistoryScreen();
  }));
  card.appendChild(actions);

  return card;
}

const DEFAULT_PLAYER_STATS_FILTERS = {
  playerId: '',
  partnerId: '',
  opponent: '',
  fromDate: '',
  toDate: '',
  setNumber: 'match',
  status: 'completed',
  result: '',
};

function filterGamesForPlayerStats(games, playerId, filters) {
  return games.filter((game) => {
    const isPlayerA = game.playerAId === playerId;
    const isPlayerB = game.playerBId === playerId;
    if (!isPlayerA && !isPlayerB) return false;

    const partnerId = isPlayerA ? game.playerBId : game.playerAId;
    const playedDate = dateInputValueForGame(game);
    const opponent = String(game.opponentName || '').toLocaleLowerCase();

    if (filters.partnerId && partnerId !== filters.partnerId) return false;
    if (filters.opponent && !opponent.includes(filters.opponent.toLocaleLowerCase())) return false;
    if (filters.fromDate && playedDate < filters.fromDate) return false;
    if (filters.toDate && playedDate > filters.toDate) return false;
    if (!gameHasSet(game, filters.setNumber)) return false;
    if (filters.status && getGameStatus(game) !== filters.status) return false;

    if (filters.result) {
      if (!game.isComplete) return false;
      const score = computeScore(game, filters.setNumber);
      if (filters.result === 'win' && score.team <= score.opponent) return false;
      if (filters.result === 'loss' && score.team >= score.opponent) return false;
    }
    return true;
  });
}

function renderPlayerStatsFilterPanel(selectedPlayerId, filters, onChange) {
  const panel = document.createElement('div');
  panel.className = 'history-filter-panel player-stats-filter-panel';

  const makeField = (labelText, control) => {
    const field = document.createElement('label');
    field.className = 'history-filter-field';
    if (control.type === 'date') field.classList.add('date-filter-field');
    field.textContent = labelText;
    field.appendChild(control);
    return field;
  };

  const playerSelect = document.createElement('select');
  playerSelect.setAttribute('aria-label', 'Filter by player');
  for (const player of loadRoster()) {
    const label = player.archived ? `${player.name} (Archived)` : player.name;
    playerSelect.appendChild(new Option(label, player.id));
  }
  playerSelect.value = selectedPlayerId;

  const partnerSelect = document.createElement('select');
  partnerSelect.setAttribute('aria-label', 'Filter by partner');
  partnerSelect.appendChild(new Option('Any partner', ''));
  const playedPartnerIds = new Set();
  for (const game of loadGameHistory()) {
    if (game.playerAId === selectedPlayerId && game.playerBId) playedPartnerIds.add(game.playerBId);
    if (game.playerBId === selectedPlayerId && game.playerAId) playedPartnerIds.add(game.playerAId);
  }
  for (const player of loadRoster()) {
    if (player.id === selectedPlayerId || !playedPartnerIds.has(player.id)) continue;
    const label = player.archived ? `${player.name} (Archived)` : player.name;
    partnerSelect.appendChild(new Option(label, player.id));
  }
  partnerSelect.value = filters.partnerId;

  const opponentInput = document.createElement('input');
  opponentInput.type = 'search';
  opponentInput.placeholder = 'e.g. Smith/Jones';
  opponentInput.value = filters.opponent;
  opponentInput.setAttribute('aria-label', 'Filter player stats by opponent');

  const fromDateInput = document.createElement('input');
  fromDateInput.type = 'date';
  fromDateInput.value = filters.fromDate;
  fromDateInput.setAttribute('aria-label', 'Filter player stats from date');

  const toDateInput = document.createElement('input');
  toDateInput.type = 'date';
  toDateInput.value = filters.toDate;
  toDateInput.setAttribute('aria-label', 'Filter player stats through date');

  const setSelect = document.createElement('select');
  setSelect.appendChild(new Option('Full match', 'match'));
  for (const setNumber of [1, 2, 3]) {
    setSelect.appendChild(new Option(`Set ${setNumber}`, String(setNumber)));
  }
  setSelect.value = filters.setNumber || 'match';

  const statusSelect = document.createElement('select');
  statusSelect.appendChild(new Option('Completed only', 'completed'));
  statusSelect.appendChild(new Option('Any status', ''));
  statusSelect.appendChild(new Option('Paused', 'paused'));
  statusSelect.value = filters.status;

  const resultSelect = document.createElement('select');
  resultSelect.appendChild(new Option('Any result', ''));
  resultSelect.appendChild(new Option('Wins', 'win'));
  resultSelect.appendChild(new Option('Losses', 'loss'));
  resultSelect.value = filters.result;

  panel.appendChild(makeField('Player', playerSelect));
  panel.appendChild(makeField('Partner', partnerSelect));
  panel.appendChild(makeField('Opponent', opponentInput));
  panel.appendChild(makeField('Played from', fromDateInput));
  panel.appendChild(makeField('Played through', toDateInput));
  panel.appendChild(makeField('View', setSelect));
  panel.appendChild(makeField('Status', statusSelect));
  panel.appendChild(makeField('Result', resultSelect));

  const actions = document.createElement('div');
  actions.className = 'history-filter-actions';
  actions.appendChild(makeButton('Clear Filters', 'secondary-btn', () => onChange({
    ...DEFAULT_PLAYER_STATS_FILTERS,
    playerId: selectedPlayerId,
  })));
  panel.appendChild(actions);

  const collectFilters = () => onChange({
    playerId: playerSelect.value,
    partnerId: partnerSelect.value,
    opponent: opponentInput.value.trim(),
    fromDate: fromDateInput.value,
    toDate: toDateInput.value,
    setNumber: setSelect.value,
    status: statusSelect.value,
    result: resultSelect.value,
  });

  playerSelect.addEventListener('change', () => onChange({
    ...filters,
    playerId: playerSelect.value,
    partnerId: '',
  }));
  for (const control of [partnerSelect, opponentInput, fromDateInput, toDateInput, setSelect, statusSelect, resultSelect]) {
    control.addEventListener('input', collectFilters);
    control.addEventListener('change', collectFilters);
  }
  return panel;
}

const DEFAULT_TEAM_STATS_FILTERS = {
  playerId: '',
  partnerId: '',
  opponent: '',
  fromDate: '',
  toDate: '',
  setNumber: 'match',
  status: 'completed',
  result: '',
};

function filterGamesForTeamStats(games, filters) {
  return games.filter((game) => {
    const includesPlayer = !filters.playerId
      || game.playerAId === filters.playerId
      || game.playerBId === filters.playerId;
    if (!includesPlayer) return false;

    if (filters.partnerId) {
      const hasPairing = (game.playerAId === filters.playerId && game.playerBId === filters.partnerId)
        || (game.playerBId === filters.playerId && game.playerAId === filters.partnerId);
      if (!hasPairing) return false;
    }

    const playedDate = dateInputValueForGame(game);
    const opponent = String(game.opponentName || '').toLocaleLowerCase();
    if (filters.opponent && !opponent.includes(filters.opponent.toLocaleLowerCase())) return false;
    if (filters.fromDate && playedDate < filters.fromDate) return false;
    if (filters.toDate && playedDate > filters.toDate) return false;
    if (!gameHasSet(game, filters.setNumber)) return false;
    if (filters.status && getGameStatus(game) !== filters.status) return false;

    if (filters.result) {
      if (!game.isComplete) return false;
      const score = computeScore(game, filters.setNumber);
      if (filters.result === 'win' && score.team <= score.opponent) return false;
      if (filters.result === 'loss' && score.team >= score.opponent) return false;
    }
    return true;
  });
}

function renderTeamStatsFilterPanel(filters, onChange) {
  const panel = document.createElement('div');
  panel.className = 'history-filter-panel team-stats-filter-panel';

  const makeField = (labelText, control) => {
    const field = document.createElement('label');
    field.className = 'history-filter-field';
    if (control.type === 'date') field.classList.add('date-filter-field');
    field.textContent = labelText;
    field.appendChild(control);
    return field;
  };

  const playerSelect = document.createElement('select');
  playerSelect.setAttribute('aria-label', 'Filter team stats by player');
  playerSelect.appendChild(new Option('Any player', ''));
  for (const player of loadRoster()) {
    const label = player.archived ? `${player.name} (Archived)` : player.name;
    playerSelect.appendChild(new Option(label, player.id));
  }
  playerSelect.value = filters.playerId;

  const partnerSelect = document.createElement('select');
  partnerSelect.setAttribute('aria-label', 'Filter team stats by partner');
  partnerSelect.appendChild(new Option('Any partner', ''));
  const playedPartnerIds = new Set();
  if (filters.playerId) {
    for (const game of loadGameHistory()) {
      if (game.playerAId === filters.playerId && game.playerBId) playedPartnerIds.add(game.playerBId);
      if (game.playerBId === filters.playerId && game.playerAId) playedPartnerIds.add(game.playerAId);
    }
  }
  for (const player of loadRoster()) {
    if (!playedPartnerIds.has(player.id) || player.id === filters.playerId) continue;
    const label = player.archived ? `${player.name} (Archived)` : player.name;
    partnerSelect.appendChild(new Option(label, player.id));
  }
  partnerSelect.value = filters.partnerId;
  partnerSelect.disabled = !filters.playerId;

  const opponentInput = document.createElement('input');
  opponentInput.type = 'search';
  opponentInput.placeholder = 'e.g. Smith/Jones';
  opponentInput.value = filters.opponent;
  opponentInput.setAttribute('aria-label', 'Filter team stats by opponent');

  const fromDateInput = document.createElement('input');
  fromDateInput.type = 'date';
  fromDateInput.value = filters.fromDate;
  fromDateInput.setAttribute('aria-label', 'Filter team stats from date');

  const toDateInput = document.createElement('input');
  toDateInput.type = 'date';
  toDateInput.value = filters.toDate;
  toDateInput.setAttribute('aria-label', 'Filter team stats through date');

  const setSelect = document.createElement('select');
  setSelect.appendChild(new Option('Full match', 'match'));
  for (const setNumber of [1, 2, 3]) setSelect.appendChild(new Option(`Set ${setNumber}`, String(setNumber)));
  setSelect.value = filters.setNumber || 'match';

  const statusSelect = document.createElement('select');
  statusSelect.appendChild(new Option('Completed only', 'completed'));
  statusSelect.appendChild(new Option('Any status', ''));
  statusSelect.appendChild(new Option('Paused', 'paused'));
  statusSelect.value = filters.status;

  const resultSelect = document.createElement('select');
  resultSelect.appendChild(new Option('Any result', ''));
  resultSelect.appendChild(new Option('Wins', 'win'));
  resultSelect.appendChild(new Option('Losses', 'loss'));
  resultSelect.value = filters.result;

  panel.appendChild(makeField('Player', playerSelect));
  panel.appendChild(makeField('Partner', partnerSelect));
  panel.appendChild(makeField('Opponent', opponentInput));
  panel.appendChild(makeField('Played from', fromDateInput));
  panel.appendChild(makeField('Played through', toDateInput));
  panel.appendChild(makeField('View', setSelect));
  panel.appendChild(makeField('Status', statusSelect));
  panel.appendChild(makeField('Result', resultSelect));

  const actions = document.createElement('div');
  actions.className = 'history-filter-actions';
  actions.appendChild(makeButton('Clear Filters', 'secondary-btn', () => onChange({ ...DEFAULT_TEAM_STATS_FILTERS })));
  panel.appendChild(actions);

  const collectFilters = () => onChange({
    playerId: playerSelect.value,
    partnerId: partnerSelect.value,
    opponent: opponentInput.value.trim(),
    fromDate: fromDateInput.value,
    toDate: toDateInput.value,
    setNumber: setSelect.value,
    status: statusSelect.value,
    result: resultSelect.value,
  });

  playerSelect.addEventListener('change', () => onChange({
    ...filters,
    playerId: playerSelect.value,
    partnerId: '',
  }));
  for (const control of [partnerSelect, opponentInput, fromDateInput, toDateInput, setSelect, statusSelect, resultSelect]) {
    control.addEventListener('input', collectFilters);
    control.addEventListener('change', collectFilters);
  }
  return panel;
}

function teamStatsEventsForGame(game) {
  const excludedSides = new Set();
  if (findPlayerById(game.playerAId)?.practicePlayer) excludedSides.add('A');
  if (findPlayerById(game.playerBId)?.practicePlayer) excludedSides.add('B');

  return (game.events || []).filter((event) => !excludedSides.has(event.player));
}

function renderTeamStatsScreen(perGameStats = true, filters = {}) {
  clearApp();
  appEl.appendChild(renderNavBar('teamStats'));

  const container = document.createElement('div');
  container.className = 'screen team-stats-screen';

  const activeFilters = { ...DEFAULT_TEAM_STATS_FILTERS, ...filters };
  const matchingGames = filterGamesForTeamStats(loadGameHistory(), activeFilters);
  const completedGames = matchingGames.filter((game) => game.isComplete);
  const combinedEvents = completedGames.flatMap((game) =>
    teamStatsEventsForGame(game).filter((event) => {
      const selectedSet = normalizeStatsScope(activeFilters.setNumber);
      return selectedSet === 'match' || getEventSetNumber(game, event) === selectedSet;
    }),
  );
  const stats = computeStats(combinedEvents, 'team');
  const setCount = completedGames.reduce((total, game) => total + getSetCountForScope(game, activeFilters.setNumber), 0);
  const displayStats = getPlayerStatsForDisplay(stats, setCount, perGameStats);

  const title = document.createElement('h1');
  title.textContent = `Team ${perGameStats ? 'Per Set' : 'Total'} Stats`;
  container.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'empty-state';
  subtitle.textContent = `${matchingGames.length} matching match${matchingGames.length === 1 ? '' : 'es'}; ${setCount} completed set${setCount === 1 ? '' : 's'} included in stats. Practice-player events are excluded.`;
  container.appendChild(subtitle);

  container.appendChild(renderTeamStatsFilterPanel(activeFilters, (nextFilters) => {
    renderTeamStatsScreen(perGameStats, nextFilters);
  }));

  const actions = document.createElement('div');
  actions.className = 'summary-actions player-stats-detail-actions';
  const totalToggle = document.createElement('label');
  totalToggle.className = 'per-game-toggle';
  const totalCheckbox = document.createElement('input');
  totalCheckbox.type = 'checkbox';
  totalCheckbox.checked = !perGameStats;
  totalCheckbox.addEventListener('change', () => renderTeamStatsScreen(!totalCheckbox.checked, activeFilters));
  totalToggle.appendChild(totalCheckbox);
  const totalText = document.createElement('span');
  totalText.textContent = 'Total Stats';
  totalToggle.appendChild(totalText);
  actions.appendChild(totalToggle);
  container.appendChild(actions);

  if (completedGames.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No completed matches match the selected filters.';
    container.appendChild(empty);
  } else {
    container.appendChild(renderPlayerAggregateMetricTable(displayStats, perGameStats));
    container.appendChild(renderPlayerAggregateRawTable(displayStats, perGameStats));
  }

  appEl.appendChild(container);
}

function renderPlayerStatsScreen(selectedPlayerId = null, comparisonPlayerIds = [], perGameStats = true, filters = {}) {
  clearApp();
  appEl.appendChild(renderNavBar('playerStats'));

  const container = document.createElement('div');
  container.className = 'screen player-stats-screen';

  const activePlayerId = selectedPlayerId || filters.playerId || null;
  const activeFilters = {
    ...DEFAULT_PLAYER_STATS_FILTERS,
    ...filters,
    playerId: activePlayerId || '',
  };
  const filteredGames = activePlayerId
    ? filterGamesForPlayerStats(loadGameHistory(), activePlayerId, activeFilters)
    : loadGameHistory();
  const rows = getPlayerStatsRows(filteredGames, activeFilters.setNumber);
  const selectedRow = rows.find((row) => row.playerId === activePlayerId);

  const title = document.createElement('h1');
  title.textContent = selectedRow
    ? `${playerStatsName(selectedRow)} ${perGameStats ? 'Per Set' : 'Total'} Stats`
    : 'Player Stats';
  container.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'empty-state';
  subtitle.textContent = selectedRow
    ? `${filteredGames.length} matching match${filteredGames.length === 1 ? '' : 'es'}; ${selectedRow.setCount || 0} completed set${(selectedRow.setCount || 0) === 1 ? '' : 's'} included in stats.`
    : 'Select a player to view completed-game totals, or choose two or more players to compare.';
  container.appendChild(subtitle);

  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Add players and record a game to see player stats here.';
    container.appendChild(empty);
    appEl.appendChild(container);
    return;
  }

  if (selectedRow) {
    container.appendChild(renderPlayerStatsFilterPanel(activePlayerId, activeFilters, (nextFilters) => {
      renderPlayerStatsScreen(nextFilters.playerId, [], perGameStats, nextFilters);
    }));
    const actions = document.createElement('div');
    actions.className = 'summary-actions player-stats-detail-actions';
    actions.appendChild(makeButton('Back to Player Stats', 'secondary-btn', () => renderPlayerStatsScreen()));
    actions.appendChild(makeButton('Export JSON', 'secondary-btn', () => exportPlayerStatsJson(selectedRow.playerId)));
    actions.appendChild(makeButton('Export CSV', 'secondary-btn', () => exportPlayerStatsCsv(selectedRow.playerId)));
    container.appendChild(actions);
    container.appendChild(renderPlayerStatsCard(selectedRow, perGameStats, [], activeFilters));
    appEl.appendChild(container);
    return;
  }

  const list = document.createElement('div');
  list.className = 'player-list';
  const compareControls = document.createElement('div');
  compareControls.className = 'player-compare-controls';
  const compareButton = makeButton('Compare Selected', 'primary-btn', () => {
    const selectedIds = [...list.querySelectorAll('input[type="checkbox"]:checked')]
      .map((checkbox) => checkbox.value);
    renderPlayerStatsScreen(null, selectedIds);
  });
  compareButton.disabled = comparisonPlayerIds.length < 2;
  compareControls.appendChild(compareButton);

  const clearCompareButton = makeButton('Clear Comparison', 'secondary-btn', () => {
    renderPlayerStatsScreen(selectedPlayerId, [], perGameStats);
  });
  clearCompareButton.disabled = comparisonPlayerIds.length === 0;
  compareControls.appendChild(clearCompareButton);

  const compareHint = document.createElement('span');
  compareHint.className = 'player-compare-hint';
  compareHint.textContent = comparisonPlayerIds.length >= 2
    ? `${comparisonPlayerIds.length} players selected`
    : 'Select at least two players';
  compareControls.appendChild(compareHint);

  for (const row of rows) {
    const playerItem = document.createElement('div');
    playerItem.className = 'player-list-item';
    const archived = Boolean(findPlayerById(row.playerId)?.archived);

    const playerButton = document.createElement('button');
    playerButton.type = 'button';
    playerButton.className = 'player-list-btn';
    playerButton.textContent = archived ? `${playerStatsName(row)} (Archived)` : playerStatsName(row);
    playerButton.setAttribute('aria-pressed', String(row.playerId === selectedPlayerId));
    if (row.playerId === selectedPlayerId) playerButton.classList.add('selected');
    playerButton.addEventListener('click', () => renderPlayerStatsScreen(row.playerId, comparisonPlayerIds, true));
    playerItem.appendChild(playerButton);

    const compareLabel = document.createElement('label');
    compareLabel.className = 'player-compare-label';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = row.playerId;
    checkbox.checked = comparisonPlayerIds.includes(row.playerId);
    checkbox.setAttribute('aria-label', `Select ${playerStatsName(row)} for comparison`);
    checkbox.addEventListener('change', () => {
      const count = list.querySelectorAll('input[type="checkbox"]:checked').length;
      compareButton.disabled = count < 2;
      clearCompareButton.disabled = count === 0;
      compareHint.textContent = count >= 2 ? `${count} players selected` : 'Select at least two players';
    });
    compareLabel.appendChild(checkbox);
    const compareText = document.createElement('span');
    compareText.textContent = 'Compare';
    compareLabel.appendChild(compareText);
    playerItem.appendChild(compareLabel);
    list.appendChild(playerItem);
  }
  container.appendChild(compareControls);
  container.appendChild(list);

  const comparisonRows = rows.filter((row) => comparisonPlayerIds.includes(row.playerId));
  if (comparisonRows.length >= 2) container.appendChild(renderPlayerComparison(comparisonRows));

  appEl.appendChild(container);
}

function getPlayerStatsRows(games, scope = 'match') {
  const aggregateRows = computePlayerStatsAcrossGames(games, normalizeStatsScope(scope));
  const aggregateById = new Map(aggregateRows.map((row) => [row.playerId, row]));
  const rows = [];

  for (const player of loadRoster()) {
    rows.push(aggregateById.get(player.id) || {
      playerId: player.id,
      gameCount: 0,
      setCount: 0,
      stats: computeStats([], 'team'),
    });
    aggregateById.delete(player.id);
  }

  return rows.sort((a, b) => playerStatsName(a).localeCompare(playerStatsName(b)));
}

function playerStatsName(row) {
  return findPlayerById(row.playerId)?.name ?? 'Player no longer on roster';
}

function renderPlayerStatsCard(row, perGameStats = true, comparisonPlayerIds = [], filters = {}) {
  const card = document.createElement('article');
  card.className = 'player-stats-card';

  const heading = document.createElement('div');
  heading.className = 'player-stats-heading';

  const name = document.createElement('h2');
  name.textContent = playerStatsName(row);
  heading.appendChild(name);

  const gameCount = document.createElement('p');
  gameCount.className = 'player-stats-meta';
  gameCount.textContent = `${row.setCount || 0} completed set${(row.setCount || 0) === 1 ? '' : 's'}`;
  heading.appendChild(gameCount);
  card.appendChild(heading);

  const displayToggle = document.createElement('label');
  displayToggle.className = 'per-game-toggle';
  const perGameCheckbox = document.createElement('input');
  perGameCheckbox.type = 'checkbox';
  perGameCheckbox.checked = !perGameStats;
  perGameCheckbox.addEventListener('change', () => {
    renderPlayerStatsScreen(row.playerId, comparisonPlayerIds, !perGameCheckbox.checked, filters);
  });
  displayToggle.appendChild(perGameCheckbox);
  const toggleText = document.createElement('span');
  toggleText.textContent = 'Total Stats';
  displayToggle.appendChild(toggleText);
  card.appendChild(displayToggle);

  if (row.gameCount === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No games recorded for this player yet.';
    card.appendChild(empty);
    return card;
  }

  const displayStats = getPlayerStatsForDisplay(row.stats, row.setCount || row.gameCount, perGameStats);
  card.appendChild(renderPlayerAggregateMetricTable(displayStats, perGameStats));
  card.appendChild(renderPlayerAggregateRawTable(displayStats, perGameStats));
  return card;
}

const PER_GAME_COUNT_STAT_KEYS = new Set([
  'servingPointsGained',
  'sideoutPointsGained',
  'transitionPointsGained',
  'blockingPointsGained',
  'totalKillsAces',
  'totalErrors',
  'totalPointsGained',
]);

function getPlayerStatsForDisplay(stats, gameCount, perGameStats) {
  if (!perGameStats || gameCount <= 0) return stats;

  const displayStats = { ...stats };
  for (const key of PER_GAME_COUNT_STAT_KEYS) displayStats[key] = stats[key] / gameCount;

  displayStats.raw = Object.fromEntries(
    Object.entries(stats.raw).map(([bucketName, bucket]) => [
      bucketName,
      Object.fromEntries(
        Object.entries(bucket).map(([key, value]) => [
          key,
          typeof value === 'number' ? value / gameCount : value,
        ]),
      ),
    ]),
  );

  return displayStats;
}

function renderPlayerComparison(rows) {
  const section = document.createElement('section');
  section.className = 'player-comparison';

  const title = document.createElement('h2');
  title.textContent = 'Player Comparison';
  section.appendChild(title);

  const description = document.createElement('p');
  description.className = 'player-stats-meta';
  description.textContent = 'Totals across completed games for the selected players.';
  section.appendChild(description);

  section.appendChild(renderPlayerComparisonMetricTable(rows));
  section.appendChild(renderPlayerComparisonRawTable(rows));
  return section;
}

function renderPlayerComparisonMetricTable(rows) {
  const section = document.createElement('section');
  section.className = 'player-stats-section';

  const title = document.createElement('h3');
  title.textContent = 'Performance Metrics';
  section.appendChild(title);

  const table = document.createElement('table');
  table.className = 'stats-table player-comparison-table';
  table.appendChild(renderStatsHeader(['Metric', ...rows.map(playerStatsName)]));

  for (const group of getPerformanceMetricGroups()) {
    const groupRow = document.createElement('tr');
    groupRow.className = 'stats-group-row';
    const groupCell = renderTableCell(group.label, 'th');
    groupCell.colSpan = rows.length + 1;
    groupRow.appendChild(groupCell);
    table.appendChild(groupRow);

    for (const [label, key, formatter] of group.rows) {
      const rowElement = document.createElement('tr');
      rowElement.appendChild(renderTableCell(label, 'th'));
      for (const player of rows) {
        rowElement.appendChild(renderTableCell(formatter(player.stats[key])));
      }
      table.appendChild(rowElement);
    }
  }

  section.appendChild(table);
  return section;
}

function renderPlayerComparisonRawTable(rows) {
  const section = document.createElement('section');
  section.className = 'player-stats-section';

  const title = document.createElement('h3');
  title.textContent = 'Phase Totals';
  section.appendChild(title);

  const table = document.createElement('table');
  table.className = 'stats-table player-comparison-table';
  table.appendChild(renderStatsHeader(['Phase / Action', ...rows.map(playerStatsName)]));

  const phaseRows = [
    ['Serving', 'serve', [['Ace', 'ace'], ['KO', 'ko'], ['In-System', 'in_system'], ['Error', 'error']]],
    ['Passing', 'passing', [['Aced', 'aced'], ['Opponent Error', 'opponent_error'], ['OOS', 'oos'], ['In-System', 'in_system']]],
    ['Setting', 'setting', [['Error (Point End)', 'error'], ['Error (Continue)', 'error_continue'], ['1', '1'], ['2', '2'], ['3', '3'], ['Option Attack', 'option']]],
    ['Sideout', 'sideout', [['Kill', 'kill'], ['Error', 'error'], ['Blocked', 'blocked'], ['Continue', 'continue']]],
    ['Transition', 'transition', [['Kill', 'kill'], ['Error', 'error'], ['Blocked', 'blocked'], ['Continue', 'continue']]],
    ['Defense', 'defense', [['Block Kill', 'block_kill'], ['Block Touch', 'block_touch'], ['Block Error', 'block_error'], ['Dig', 'dig'], ['Dig Return', 'dig_return'], ['Dig Error', 'dig_error'], ['Receive', 'receive']]],
  ];

  for (const [phaseLabel, bucketName, actionRows] of phaseRows) {
    const groupRow = document.createElement('tr');
    groupRow.className = 'stats-group-row';
    const groupCell = renderTableCell(phaseLabel, 'th');
    groupCell.colSpan = rows.length + 1;
    groupRow.appendChild(groupCell);
    table.appendChild(groupRow);

    for (const [actionLabel, actionKey] of actionRows) {
      const rowElement = document.createElement('tr');
      rowElement.appendChild(renderTableCell(actionLabel, 'th'));
      for (const player of rows) {
        rowElement.appendChild(renderTableCell(formatStatNumber(player.stats.raw[bucketName]?.[actionKey] ?? 0)));
      }
      table.appendChild(rowElement);
    }
  }

  section.appendChild(table);
  return section;
}

function renderPlayerAggregateMetricTable(stats, perGameStats = false) {
  const section = document.createElement('section');
  section.className = 'player-stats-section';

  const title = document.createElement('h3');
  title.textContent = 'Performance Metrics';
  section.appendChild(title);

  const table = document.createElement('table');
  table.className = 'stats-table player-stats-table';
  table.appendChild(renderStatsHeader(['Metric', perGameStats ? 'Per Set' : 'Total']));

  for (const group of getPerformanceMetricGroups()) {
    const groupRow = document.createElement('tr');
    groupRow.className = 'stats-group-row';
    const groupCell = renderTableCell(group.label, 'th');
    groupCell.colSpan = 2;
    groupRow.appendChild(groupCell);
    table.appendChild(groupRow);

    for (const [label, key, formatter] of group.rows) {
      const row = document.createElement('tr');
      row.appendChild(renderTableCell(label, 'th'));
      row.appendChild(renderTableCell(formatter(stats[key])));
      table.appendChild(row);
    }
  }

  section.appendChild(table);
  return section;
}

function renderPlayerAggregateRawTable(stats, perGameStats = false) {
  const section = document.createElement('section');
  section.className = 'player-stats-section';

  const title = document.createElement('h3');
  title.textContent = 'Phase Totals';
  section.appendChild(title);

  const table = document.createElement('table');
  table.className = 'stats-table player-stats-table';
  table.appendChild(renderStatsHeader(['Phase / Action', perGameStats ? 'Per Set' : 'Total']));

  const phaseRows = [
    ['Serving', 'serve', [['Ace', 'ace'], ['KO', 'ko'], ['In-System', 'in_system'], ['Error', 'error']]],
    ['Passing', 'passing', [['Aced', 'aced'], ['Opponent Error', 'opponent_error'], ['OOS', 'oos'], ['In-System', 'in_system']]],
    ['Setting', 'setting', [['Error (Point End)', 'error'], ['Error (Continue)', 'error_continue'], ['1', '1'], ['2', '2'], ['3', '3'], ['Option Attack', 'option']]],
    ['Sideout', 'sideout', [['Kill', 'kill'], ['Error', 'error'], ['Blocked', 'blocked'], ['Continue', 'continue']]],
    ['Transition', 'transition', [['Kill', 'kill'], ['Error', 'error'], ['Blocked', 'blocked'], ['Continue', 'continue']]],
    ['Defense', 'defense', [['Block Kill', 'block_kill'], ['Block Touch', 'block_touch'], ['Block Error', 'block_error'], ['Dig', 'dig'], ['Dig Return', 'dig_return'], ['Dig Error', 'dig_error'], ['Receive', 'receive']]],
  ];

  for (const [phaseLabel, bucketName, actionRows] of phaseRows) {
    const groupRow = document.createElement('tr');
    groupRow.className = 'stats-group-row';
    const groupCell = renderTableCell(phaseLabel, 'th');
    groupCell.colSpan = 2;
    groupRow.appendChild(groupCell);
    table.appendChild(groupRow);

    for (const [actionLabel, actionKey] of actionRows) {
      const row = document.createElement('tr');
      row.appendChild(renderTableCell(actionLabel, 'th'));
      row.appendChild(renderTableCell(formatStatNumber(stats.raw[bucketName]?.[actionKey] ?? 0)));
      table.appendChild(row);
    }
  }

  section.appendChild(table);
  return section;
}

function renderGameSummaryScreen(gameId) {
  clearApp();
  appEl.appendChild(renderNavBar('history'));

  const game = getGameById(gameId);
  if (!game) {
    const missing = document.createElement('div');
    missing.className = 'screen';
    missing.innerHTML = '<p class="empty-state">Game not found.</p>';
    appEl.appendChild(missing);
    return;
  }

  const nameA = playerNameForGame(game, 'A');
  const nameB = playerNameForGame(game, 'B');
  const score = computeScore(game);
  const stats = computeGameStats(game);

  const container = document.createElement('div');
  container.className = 'screen summary-screen';

  const header = document.createElement('div');
  header.className = 'summary-header';

  const title = document.createElement('h1');
  title.textContent = 'Match Summary';
  header.appendChild(title);

  const matchup = document.createElement('p');
  matchup.className = 'summary-matchup';
  matchup.textContent = `${nameA} & ${nameB} vs. ${game.opponentName}`;
  header.appendChild(matchup);

  const date = document.createElement('p');
  date.className = 'summary-date';
  date.textContent = `Played ${formatPlayedDate(playedDateForGame(game))} · Logged ${formatGameDate(game.date)}`;
  header.appendChild(date);

  const scoreLine = document.createElement('div');
  scoreLine.className = 'summary-score';
  scoreLine.textContent = `${score.team} – ${score.opponent}`;
  header.appendChild(scoreLine);

  const completedSets = getCompletedSetNumbers(game);
  if (completedSets.length > 0) {
    const setScores = document.createElement('p');
    setScores.className = 'summary-date';
    setScores.textContent = completedSets
      .map((setNumber) => `Set ${setNumber}: ${computeScore(game, setNumber).team}–${computeScore(game, setNumber).opponent}`)
      .join(' · ');
    header.appendChild(setScores);
  }

  const status = document.createElement('span');
  const gameStatus = getGameStatus(game);
  status.className = `summary-status ${gameStatus}`;
  status.textContent = getGameStatusLabel(game);
  header.appendChild(status);
  container.appendChild(header);

  const actions = document.createElement('div');
  actions.className = 'summary-actions';
  actions.appendChild(makeButton('Back to History', 'secondary-btn', () => navigate('history')));
  actions.appendChild(makeButton('Export JSON', 'secondary-btn', () => exportGameJson(game.id)));
  actions.appendChild(makeButton('Export CSV', 'secondary-btn', () => exportGameCsv(game.id)));
  actions.appendChild(makeButton('Edit Details', 'secondary-btn', () => navigate('editGameDetails', game.id)));
  if (!game.isComplete) {
    actions.appendChild(makeButton('Resume Match', 'primary-btn', () => {
      if (!resumeGame(game.id)) {
        alert('Could not resume that game — try again.');
        return;
      }
      navigate('liveGame', game.id);
    }));
  }
  container.appendChild(actions);

  container.appendChild(renderMetricTable(stats, nameA, nameB));
  container.appendChild(renderRawStatsTable(stats, nameA, nameB));
  container.appendChild(renderEventLog(game, nameA, nameB));

  appEl.appendChild(container);
}

function getPerformanceMetricGroups() {
  return [
    {
      label: 'Serving',
      rows: [
        ['KO%', 'koPct', formatPercent],
        ['wKO%', 'wKoPct', formatPercent],
        ['Serving Points Gained', 'servingPointsGained', formatStatNumber],
      ],
    },
    {
      label: 'Passing/Setting',
      rows: [
        ['Pass%', 'passPct', formatPercent],
        ['Average Set Quality', 'avgSetQuality', formatStatNumber],
      ],
    },
    {
      label: 'Sideout',
      rows: [
        ['First Ball Eff%', 'firstBallEff', formatPercent],
        ['wFirst Ball Eff%', 'wFirstBallEff', formatPercent],
        ['Sideout Points Gained', 'sideoutPointsGained', formatStatNumber],
      ],
    },
    {
      label: 'Transition',
      rows: [
        ['Transition Eff%', 'transitionEff', formatPercent],
        ['wTransition Eff%', 'wTransitionEff', formatPercent],
        ['Transition Points Gained', 'transitionPointsGained', formatStatNumber],
      ],
    },
    {
      label: 'Attack Types (Sideout & Transition)',
      rows: [
        ['Quality Kill%', 'qualityKillPct', formatPercent],
        ['Hard-Driven%', 'hardDrivenPct', formatPercent],
        ['Shot%', 'shotPct', formatPercent],
        ['Free Ball%', 'freeballPct', formatPercent],
      ],
    },
    {
      label: 'Defense',
      rows: [
        ['Blocking Points Gained', 'blockingPointsGained', formatStatNumber],
      ],
    },
    {
      label: 'Total Points',
      rows: [
        ['Total Kills / Aces', 'totalKillsAces', formatStatNumber],
        ['Total Errors', 'totalErrors', formatStatNumber],
        ['Total Points Gained', 'totalPointsGained', formatStatNumber],
      ],
    },
  ];
}

function getStatBreakdownDefinitions() {
  const definitions = [];
  const pointsGainedKeys = new Set([
    'servingPointsGained',
    'sideoutPointsGained',
    'transitionPointsGained',
    'blockingPointsGained',
    'totalKillsAces',
    'totalErrors',
    'totalPointsGained',
  ]);

  for (const group of getPerformanceMetricGroups()) {
    for (const [label, key, formatter] of group.rows) {
      const isEfficiencyMetric = label.includes('%') || key === 'avgSetQuality';
      if (!isEfficiencyMetric && !pointsGainedKeys.has(key)) continue;

      definitions.push({
        id: `metric:${key}`,
        group: group.label,
        label,
        formatter,
        getValue: (stats) => stats[key],
      });
    }
  }

  return definitions;
}

function renderStatBreakdownSelector(definitions, selectedStatIds, onChange) {
  const panel = document.createElement('section');
  panel.className = 'stat-breakdown-selector';

  const title = document.createElement('h2');
  title.textContent = 'Choose Statistics';
  panel.appendChild(title);

  const hint = document.createElement('p');
  hint.className = 'player-stats-meta';
  hint.textContent = 'Select one or more statistics to rank the roster.';
  panel.appendChild(hint);

  const options = document.createElement('div');
  options.className = 'stat-breakdown-options';
  const groups = [...new Set(definitions.map((definition) => definition.group))];

  for (const group of groups) {
    const groupSection = document.createElement('div');
    groupSection.className = 'stat-breakdown-option-group';

    const groupTitle = document.createElement('h3');
    groupTitle.textContent = group;
    groupSection.appendChild(groupTitle);

    for (const definition of definitions.filter((item) => item.group === group)) {
      const label = document.createElement('label');
      label.className = 'stat-breakdown-option';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = definition.id;
      checkbox.checked = selectedStatIds.includes(definition.id);
      checkbox.setAttribute('aria-label', `Rank players by ${definition.label}`);
      checkbox.addEventListener('change', () => {
        const nextSelectedIds = [...options.querySelectorAll('input[type="checkbox"]:checked')]
          .map((input) => input.value);
        onChange(nextSelectedIds);
      });

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(definition.label));
      groupSection.appendChild(label);
    }
    options.appendChild(groupSection);
  }
  panel.appendChild(options);

  const actions = document.createElement('div');
  actions.className = 'stat-breakdown-actions';
  actions.appendChild(makeButton('Select All', 'secondary-btn', () => {
    onChange(definitions.map((definition) => definition.id));
  }));
  actions.appendChild(makeButton('Clear Selection', 'secondary-btn', () => onChange([])));
  panel.appendChild(actions);
  return panel;
}

function renderStatBreakdownTable(definitions, rows, perGameStats, sortId, sortDirection, onSort) {
  const section = document.createElement('section');
  section.className = 'stat-breakdown-ranking';

  const title = document.createElement('h2');
  title.textContent = 'Roster Rankings';
  section.appendChild(title);

  const description = document.createElement('p');
  description.className = 'player-stats-meta';
  description.textContent = 'Click a statistic heading to sort the roster by that column.';
  section.appendChild(description);

  const table = document.createElement('table');
  table.className = 'stats-table stat-breakdown-table';
  const headerRow = document.createElement('tr');
  headerRow.appendChild(renderTableCell('Rank', 'th'));
  headerRow.appendChild(renderTableCell('Player', 'th'));
  headerRow.appendChild(renderTableCell('Completed Sets', 'th'));

  for (const definition of definitions) {
    const headerCell = document.createElement('th');
    const sortButton = document.createElement('button');
    sortButton.type = 'button';
    sortButton.className = 'stat-breakdown-sort-btn';
    const isActiveSort = sortId === definition.id;
    const arrow = isActiveSort ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : '';
    sortButton.textContent = `${definition.label}${arrow}`;
    sortButton.title = `Sort by ${definition.label}`;
    sortButton.setAttribute('aria-label', `Sort by ${definition.label}`);
    sortButton.setAttribute('aria-sort', isActiveSort
      ? sortDirection === 'asc' ? 'ascending' : 'descending'
      : 'none');
    sortButton.addEventListener('click', () => {
      const nextDirection = isActiveSort && sortDirection === 'desc' ? 'asc' : 'desc';
      onSort(definition.id, nextDirection);
    });
    headerCell.appendChild(sortButton);
    headerRow.appendChild(headerCell);
  }
  table.appendChild(headerRow);

  const rankingRows = rows.map((row) => {
    const displayStats = getPlayerStatsForDisplay(row.stats, row.setCount || row.gameCount, perGameStats);
    return {
      row,
      values: definitions.map((definition) => definition.getValue(displayStats)),
    };
  });
  const sortIndex = definitions.findIndex((definition) => definition.id === sortId);
  rankingRows.sort((a, b) => {
    const aValue = a.values[sortIndex];
    const bValue = b.values[sortIndex];
    const aHasValue = (a.row.setCount || a.row.gameCount) > 0 && typeof aValue === 'number' && Number.isFinite(aValue);
    const bHasValue = (b.row.setCount || b.row.gameCount) > 0 && typeof bValue === 'number' && Number.isFinite(bValue);
    if (aHasValue !== bHasValue) return aHasValue ? -1 : 1;
    if (!aHasValue) return playerStatsName(a.row).localeCompare(playerStatsName(b.row));
    if (bValue !== aValue) {
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    }
    return playerStatsName(a.row).localeCompare(playerStatsName(b.row));
  });

  let previousValue;
  let previousRank = 0;
  rankingRows.forEach(({ row, values }, index) => {
    const value = values[sortIndex];
    const hasValue = (row.setCount || row.gameCount) > 0 && typeof value === 'number' && Number.isFinite(value);
    const rank = hasValue
      ? value === previousValue ? previousRank : index + 1
      : '—';
    if (hasValue) {
      previousValue = value;
      previousRank = rank;
    }

    const tableRow = document.createElement('tr');
    tableRow.appendChild(renderTableCell(rank, 'th'));
    const player = findPlayerById(row.playerId);
    const playerLabel = player?.archived ? `${playerStatsName(row)} (Archived)` : playerStatsName(row);
    tableRow.appendChild(renderTableCell(playerLabel));
    tableRow.appendChild(renderTableCell(row.setCount || row.gameCount));
    definitions.forEach((definition, definitionIndex) => {
      const statValue = values[definitionIndex];
      const hasStatValue = (row.setCount || row.gameCount) > 0
        && typeof statValue === 'number'
        && Number.isFinite(statValue);
      tableRow.appendChild(renderTableCell(hasStatValue ? definition.formatter(statValue) : '—'));
    });
    table.appendChild(tableRow);
  });

  section.appendChild(table);
  return section;
}

function renderStatBreakdownScreen(selectedStatIds = null, perGameStats = true, sortId = null, sortDirection = 'desc', scope = 'match') {
  clearApp();
  appEl.appendChild(renderNavBar('statBreakdown'));

  const container = document.createElement('div');
  container.className = 'screen stat-breakdown-screen';

  const definitions = getStatBreakdownDefinitions();
  const defaultSelection = ['metric:totalPointsGained'];
  const activeSelectedIds = selectedStatIds === null
    ? defaultSelection
    : selectedStatIds.filter((id) => definitions.some((definition) => definition.id === id));
  const selectedIds = new Set(activeSelectedIds);
  const selectedDefinitions = definitions.filter((definition) => selectedIds.has(definition.id));
  const activeSortId = selectedDefinitions.some((definition) => definition.id === sortId)
    ? sortId
    : selectedDefinitions[0]?.id;
  const activeSortDirection = sortDirection === 'asc' ? 'asc' : 'desc';
  const activeScope = normalizeStatsScope(scope);

  const title = document.createElement('h1');
  title.textContent = `Stat Breakdown — ${perGameStats ? 'Per Set Stats' : 'Total Stats'}`;
  container.appendChild(title);

  const completedGames = loadGameHistory().filter((game) => game.isComplete);
  const subtitle = document.createElement('p');
  subtitle.className = 'empty-state';
  const includedSetCount = completedGames.reduce((total, game) => total + getSetCountForScope(game, activeScope), 0);
  subtitle.textContent = `${includedSetCount} completed set${includedSetCount === 1 ? '' : 's'} included. Paused matches and practice players are excluded.`;
  container.appendChild(subtitle);

  const displayActions = document.createElement('div');
  displayActions.className = 'summary-actions stat-breakdown-display-actions';
  const totalToggle = document.createElement('label');
  totalToggle.className = 'per-game-toggle';
  const totalCheckbox = document.createElement('input');
  totalCheckbox.type = 'checkbox';
  totalCheckbox.checked = !perGameStats;
  totalCheckbox.addEventListener('change', () => renderStatBreakdownScreen(
    activeSelectedIds,
    !totalCheckbox.checked,
    activeSortId,
    activeSortDirection,
    activeScope,
  ));
  totalToggle.appendChild(totalCheckbox);
  const totalText = document.createElement('span');
  totalText.textContent = 'Total Stats';
  totalToggle.appendChild(totalText);
  displayActions.appendChild(totalToggle);
  container.appendChild(displayActions);

  const scopeField = document.createElement('label');
  scopeField.className = 'history-filter-field stat-breakdown-scope-field';
  scopeField.textContent = 'View';
  const scopeSelect = document.createElement('select');
  scopeSelect.appendChild(new Option('Full match', 'match'));
  for (const setNumber of [1, 2, 3]) scopeSelect.appendChild(new Option(`Set ${setNumber}`, String(setNumber)));
  scopeSelect.value = String(activeScope);
  scopeSelect.addEventListener('change', () => renderStatBreakdownScreen(
    activeSelectedIds,
    perGameStats,
    activeSortId,
    activeSortDirection,
    scopeSelect.value,
  ));
  scopeField.appendChild(scopeSelect);
  container.appendChild(scopeField);

  container.appendChild(renderStatBreakdownSelector(definitions, [...selectedIds], (nextSelectedIds) => {
    renderStatBreakdownScreen(nextSelectedIds, perGameStats, activeSortId, activeSortDirection, activeScope);
  }));

  if (selectedIds.size === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Select at least one statistic to see player rankings.';
    container.appendChild(empty);
  } else if (completedGames.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No completed games are available for ranking yet.';
    container.appendChild(empty);
  } else {
    const rows = getPlayerStatsRows(completedGames, activeScope)
      .filter((row) => !findPlayerById(row.playerId)?.practicePlayer);
    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'No non-practice players are available for ranking.';
      container.appendChild(empty);
    } else {
      container.appendChild(renderStatBreakdownTable(
        selectedDefinitions,
        rows,
        perGameStats,
        activeSortId,
        activeSortDirection,
        (nextSortId, nextSortDirection) => renderStatBreakdownScreen(
          activeSelectedIds,
          perGameStats,
          nextSortId,
          nextSortDirection,
          activeScope,
        ),
      ));
    }
  }

  appEl.appendChild(container);
}

function renderLiveStatsSummary(stats, nameA, nameB) {
  const section = document.createElement('section');
  section.className = 'summary-section live-stats-summary';

  const table = document.createElement('table');
  table.className = 'stats-table team-comparison-table live-stat-summary-table';
  table.appendChild(renderStatsHeader(['Metric', nameA, nameB, 'Team']));

  const values = [stats.playerA, stats.playerB, stats.team];
  const groups = [
    {
      label: 'Key Metrics',
      rows: [
        ['wKO%', 'wKoPct', formatPercent],
        ['wFirst Ball Eff%', 'wFirstBallEff', formatPercent],
        ['wTransition Eff%', 'wTransitionEff', formatPercent],
        ['Pass%', 'passPct', formatPercent],
        ['Average Set Quality', 'avgSetQuality', formatStatNumber],
        ['Quality Kill%', 'qualityKillPct', formatPercent],
        ['Total Kills/Aces', 'totalKillsAces', formatStatNumber],
        ['Total Errors', 'totalErrors', formatStatNumber],
        ['Total Pts Gained', 'totalPointsGained', formatStatNumber],
      ],
    },
    {
      label: 'Attack Types',
      rows: [
        ['Hard-Driven%', 'hardDrivenPct', formatPercent],
        ['Shot%', 'shotPct', formatPercent],
        ['Free Ball%', 'freeballPct', formatPercent],
      ],
    },
  ];

  for (const group of groups) {
    const groupRow = document.createElement('tr');
    groupRow.className = 'stats-group-row';
    const groupCell = renderTableCell(group.label, 'th');
    groupCell.colSpan = 3;
    groupRow.appendChild(groupCell);
    groupRow.appendChild(renderTableCell('', 'th'));
    table.appendChild(groupRow);

    for (const [label, key, formatter] of group.rows) {
      const row = document.createElement('tr');
      row.appendChild(renderTableCell(label, 'th'));
      for (const stat of values) row.appendChild(renderTableCell(formatter(stat[key])));
      table.appendChild(row);
    }
  }

  section.appendChild(table);
  return section;
}

function renderMetricTable(stats, nameA, nameB) {
  const section = document.createElement('section');
  section.className = 'summary-section';

  const title = document.createElement('h2');
  title.textContent = 'Performance Metrics';
  section.appendChild(title);

  const table = document.createElement('table');
  table.className = 'stats-table team-comparison-table';
  table.appendChild(renderStatsHeader(['Metric', nameA, nameB, 'Team']));

  const groups = getPerformanceMetricGroups();

  const values = [stats.playerA, stats.playerB, stats.team];
  for (const group of groups) {
    const groupRow = document.createElement('tr');
    groupRow.className = 'stats-group-row';
    const groupCell = renderTableCell(group.label, 'th');
    groupCell.colSpan = 3;
    groupRow.appendChild(groupCell);
    groupRow.appendChild(renderTableCell('', 'th'));
    table.appendChild(groupRow);

    for (const [label, key, formatter] of group.rows) {
      const row = document.createElement('tr');
      row.appendChild(renderTableCell(label, 'th'));
      for (const stat of values) row.appendChild(renderTableCell(formatter(stat[key])));
      table.appendChild(row);
    }
  }

  section.appendChild(table);
  return section;
}

function renderStatsHeader(labels) {
  const row = document.createElement('tr');
  for (const label of labels) row.appendChild(renderTableCell(label, 'th'));
  return row;
}

function renderTableCell(value, tagName = 'td') {
  const cell = document.createElement(tagName);
  cell.textContent = value;
  return cell;
}

function renderRawStatsTable(stats, nameA, nameB) {
  const section = document.createElement('section');
  section.className = 'summary-section';

  const title = document.createElement('h2');
  title.textContent = 'Phase Totals';
  section.appendChild(title);

  const table = document.createElement('table');
  table.className = 'stats-table team-comparison-table compact';
  table.appendChild(renderStatsHeader(['Phase / Action', nameA, nameB, 'Team']));

  const phaseRows = [
    ['Serving', 'serve', [['Ace', 'ace'], ['KO', 'ko'], ['In-System', 'in_system'], ['Error', 'error']]],
    ['Passing', 'passing', [['Aced', 'aced'], ['Opponent Error', 'opponent_error'], ['OOS', 'oos'], ['In-System', 'in_system']]],
    ['Setting', 'setting', [['Error (Point End)', 'error'], ['Error (Continue)', 'error_continue'], ['1', '1'], ['2', '2'], ['3', '3'], ['Option Attack', 'option']]],
    ['Sideout', 'sideout', [['Kill', 'kill'], ['Error', 'error'], ['Blocked', 'blocked'], ['Continue', 'continue']]],
    ['Transition', 'transition', [['Kill', 'kill'], ['Error', 'error'], ['Blocked', 'blocked'], ['Continue', 'continue']]],
    ['Defense', 'defense', [['Block Kill', 'block_kill'], ['Block Touch', 'block_touch'], ['Block Error', 'block_error'], ['Dig', 'dig'], ['Dig Return', 'dig_return'], ['Dig Error', 'dig_error'], ['Receive', 'receive'], ['Opponent Kill', 'opponent_kill'], ['Opponent Error', 'opponent_error']]],
  ];

  const values = [stats.playerA.raw, stats.playerB.raw, stats.team.raw];
  for (const [phaseLabel, bucketName, actionRows] of phaseRows) {
    const groupRow = document.createElement('tr');
    groupRow.className = 'stats-group-row';
    const groupCell = renderTableCell(phaseLabel, 'th');
    groupCell.colSpan = 3;
    groupRow.appendChild(groupCell);
    groupRow.appendChild(renderTableCell('', 'th'));
    table.appendChild(groupRow);

    for (const [actionLabel, actionKey] of actionRows) {
      const row = document.createElement('tr');
      row.appendChild(renderTableCell(actionLabel, 'th'));
      for (const raw of values) {
        row.appendChild(renderTableCell(formatStatNumber(raw[bucketName]?.[actionKey] ?? 0)));
      }
      table.appendChild(row);
    }
  }

  section.appendChild(table);
  return section;
}

function getEventStartScores(game) {
  const scoresBySet = new Map();
  const startScores = new Map();

  for (const event of game.events || []) {
    if (event.type === 'set_boundary' || event.action === 'set_end') continue;

    const setNumber = getEventSetNumber(game, event);
    const currentScore = scoresBySet.get(setNumber) || { team: 0, opponent: 0 };
    // Every event in the same point receives the same starting score. The
    // score advances only after the point-ending event is processed below.
    startScores.set(event, { ...currentScore });

    const cfg = PHASE_CONFIG[event.phase]?.actions[event.action];
    if (!cfg?.endsPoint) continue;
    scoresBySet.set(setNumber, {
      team: currentScore.team + (cfg.winner === 'team' ? 1 : 0),
      opponent: currentScore.opponent + (cfg.winner === 'opponent' ? 1 : 0),
    });
  }

  return startScores;
}

function renderEventLog(game, nameA, nameB) {
  const section = document.createElement('section');
  section.className = 'summary-section';

  const title = document.createElement('h2');
  title.textContent = 'Chronological Event Log';
  section.appendChild(title);

  if (game.events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'No events recorded yet.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('ol');
  list.className = 'event-log';
  const eventStartScores = getEventStartScores(game);
  game.events.forEach((event) => {
    if (event.type === 'set_boundary' || event.action === 'set_end') {
      const item = document.createElement('li');
      item.className = 'event-log-item set-boundary-log-item';
      item.textContent = `Set ${event.setNumber} complete`;
      list.appendChild(item);
      return;
    }
    const item = document.createElement('li');
    item.className = 'event-log-item';

    const point = document.createElement('span');
    point.className = 'event-point';
    const scoreAtStart = eventStartScores.get(event) || { team: 0, opponent: 0 };
    point.textContent = `Set ${getEventSetNumber(game, event)} · Point ${event.pointNumber}`;
    const startScore = document.createElement('span');
    startScore.className = 'event-start-score';
    startScore.textContent = `${scoreAtStart.team}–${scoreAtStart.opponent}`;
    point.appendChild(startScore);
    item.appendChild(point);

    const details = document.createElement('div');
    details.className = 'event-details';
    const player = event.player === 'A' ? nameA : event.player === 'B' ? nameB : 'Opponent';
    const phaseLabel = PHASE_CONFIG[event.phase]?.label ?? event.phase;
    const action = document.createElement('strong');
    action.textContent = `${player} · ${phaseLabel} · ${labelForAction(event.action, event.phase)}`;
    details.appendChild(action);

    const tags = [
      event.attackType ? ATTACK_TYPE_LABELS[event.attackType] : null,
      event.killQuality ? KILL_QUALITY_LABELS[event.killQuality] : null,
    ].filter(Boolean);
    if (tags.length > 0) {
      const tagLine = document.createElement('span');
      tagLine.className = 'event-tags';
      tagLine.textContent = tags.join(' · ');
      details.appendChild(tagLine);
    }
    item.appendChild(details);

    const editButton = makeButton('Edit Point', 'event-edit-btn', () => {
      beginPointEdit(game.id, event.pointNumber);
    });
    editButton.title = `Edit Point ${event.pointNumber} without changing later points`;
    item.appendChild(editButton);
    list.appendChild(item);
  });

  section.appendChild(list);
  return section;
}
