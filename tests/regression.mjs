import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
const scriptMatch = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
assert(scriptMatch, 'inline application script must exist');
const client = scriptMatch[1];
new vm.Script(client, { filename: 'index.inline.js' });

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to extract ${name}`);
}

const context = vm.createContext({
    CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
    ALLOWED_GUESS_SECONDS: new Set([5, 10, 15, 20, 30, 45, 60]),
    ALLOWED_INTER_ROUND_SECONDS: new Set([3, 5, 8, 10, 15])
});
[
    'clampNumber',
    'normalizeClientId',
    'normalizeSettings',
    'uniquePresenceMembers',
    'fallbackOrderedPresenceMembers',
    'orderedPresenceMembers',
    'appendCanonicalPlayerOrder',
    'selectHostCandidate',
    'chooseNextPsychic',
    'chooseInitialPsychic',
    'areAllEligibleGuessesLocked',
    'transitionGuessingToReveal',
    'wrappedArcSegments',
    'circularDialDistance',
    'circularDialMean',
    'scoreForDistance'
].forEach(name => vm.runInContext(extractFunction(client, name), context));

const ids = ['a', 'b', 'c'].map(letter => `wl-${letter.repeat(32)}`);
const members = ids.map((clientId, index) => ({ clientId, timestamp: index + 1 }));

context.globalState = {
    psychicClientId: ids[0],
    rotationOrder: ids,
    settings: { startingPsychic: ids[1] }
};
assert.equal(context.chooseInitialPsychic(members).psychicClientId, ids[1]);
context.globalState.settings.startingPsychic = 'random';
context.secureRandomIndex = () => 2;
assert.equal(context.chooseInitialPsychic(members).psychicClientId, ids[2]);
const skippedPlayerRotation = context.chooseNextPsychic([members[0], members[2]]);
assert.equal(skippedPlayerRotation.psychicClientId, ids[2], 'disconnected next player must be skipped');
assert.deepEqual(Array.from(skippedPlayerRotation.rotationOrder), ids, 'canonical order must retain a disconnected identity');
assert.deepEqual(Array.from(skippedPlayerRotation.roundPlayerIds), [ids[0], ids[2]], 'round participants must contain only active identities');

const idD = `wl-${'d'.repeat(32)}`;
const idE = `wl-${'e'.repeat(32)}`;
const fourMembers = [...members, { clientId: idD, timestamp: 4 }];
const canonicalContext = vm.createContext({
    CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
    isHost: true,
    myClientId: ids[0],
    globalState: { hostClientId: ids[0], rotationOrder: [] }
});
for (const name of [
    'clampNumber', 'normalizeClientId', 'arraysEqual', 'uniquePresenceMembers',
    'fallbackOrderedPresenceMembers', 'orderedPresenceMembers', 'appendCanonicalPlayerOrder', 'selectHostCandidate'
]) {
    vm.runInContext(extractFunction(client, name), canonicalContext);
}
assert.equal(canonicalContext.appendCanonicalPlayerOrder([fourMembers[3], fourMembers[1], fourMembers[0], fourMembers[2]]), true);
assert.deepEqual(Array.from(canonicalContext.globalState.rotationOrder), [...ids, idD], 'true joins must establish A/B/C/D order');
for (const rawOrder of [
    [fourMembers[2], fourMembers[0], fourMembers[3], fourMembers[1]],
    [fourMembers[1], fourMembers[3], fourMembers[0], fourMembers[2]]
]) {
    assert.deepEqual(
        Array.from(canonicalContext.orderedPresenceMembers(rawOrder).map(member => member.clientId)),
        [...ids, idD],
        'raw presence iteration order must not affect canonical display order'
    );
}
const activeAfterCLeaves = [fourMembers[0], fourMembers[1], fourMembers[3]];
assert.deepEqual(
    Array.from(canonicalContext.orderedPresenceMembers(activeAfterCLeaves).map(member => member.clientId)),
    [ids[0], ids[1], idD],
    'a middle departure must filter C without moving D'
);
const memberE = { clientId: idE, timestamp: 5 };
assert.equal(canonicalContext.appendCanonicalPlayerOrder([memberE, ...activeAfterCLeaves]), true);
assert.deepEqual(Array.from(canonicalContext.globalState.rotationOrder), [...ids, idD, idE]);
assert.deepEqual(
    Array.from(canonicalContext.orderedPresenceMembers([memberE, fourMembers[3], fourMembers[1], fourMembers[0]]).map(member => member.clientId)),
    [ids[0], ids[1], idD, idE],
    'a new E must append after D even when raw presence order is reversed'
);
assert.equal(canonicalContext.selectHostCandidate([memberE, fourMembers[3], fourMembers[1]]).clientId, ids[1]);
assert.equal(canonicalContext.selectHostCandidate([memberE, fourMembers[3]]).clientId, idD);
assert.equal(canonicalContext.selectHostCandidate([memberE]).clientId, idE);
assert.equal(canonicalContext.selectHostCandidate([fourMembers[3], fourMembers[1]]).clientId, ids[1], 'C leaving before succession must not move D ahead of B');
const reloadedA = { ...fourMembers[0], timestamp: 100 };
assert.deepEqual(
    Array.from(canonicalContext.orderedPresenceMembers([memberE, reloadedA, fourMembers[3], fourMembers[1]]).map(member => member.clientId)),
    [ids[0], ids[1], idD, idE],
    'reconnect timestamps must not change an established position'
);
const reloadedB = { ...fourMembers[1], timestamp: 101 };
assert.deepEqual(
    Array.from(canonicalContext.orderedPresenceMembers([memberE, fourMembers[3], reloadedB, fourMembers[0]]).map(member => member.clientId)),
    [ids[0], ids[1], idD, idE],
    'a non-Host reload must also preserve its canonical position'
);
assert.equal(
    canonicalContext.appendCanonicalPlayerOrder([fourMembers[1], { ...fourMembers[1], timestamp: 99 }]),
    false,
    'duplicate presence for one authenticated ID must not duplicate the player'
);
canonicalContext.isHost = false;
assert.equal(canonicalContext.appendCanonicalPlayerOrder([{ clientId: `wl-${'f'.repeat(32)}`, timestamp: 6 }]), false);
assert.deepEqual(Array.from(canonicalContext.globalState.rotationOrder), [...ids, idD, idE], 'non-Hosts must not alter canonical order');

for (const guessSeconds of [5, 10, 15, 20, 30, 45, 60]) {
    assert.equal(context.normalizeSettings({ guessSeconds, interRoundSeconds: 5, startingPsychic: 'random' }).guessSeconds, guessSeconds);
}

context.localRoundGuessesReceived = Object.create(null);
assert.equal(context.areAllEligibleGuessesLocked([ids[1]]), false, 'one outstanding Guesser must keep guessing open');
context.localRoundGuessesReceived[ids[1]] = { guessValue: 40 };
assert.equal(context.areAllEligibleGuessesLocked([ids[1]]), true, 'one locked Guesser must complete the quorum');
context.localRoundGuessesReceived = { [ids[1]]: { guessValue: 40 } };
assert.equal(context.areAllEligibleGuessesLocked([ids[1], ids[2]]), false, 'a partial multi-Guesser quorum must stay open');
context.localRoundGuessesReceived[ids[2]] = { guessValue: 60 };
assert.equal(context.areAllEligibleGuessesLocked([ids[1], ids[2]]), true, 'the final Guesser must complete the quorum');
context.localRoundGuessesReceived[ids[2]] = { guessValue: 61 };
assert.equal(context.areAllEligibleGuessesLocked([ids[1], ids[2]]), true, 'a duplicate identity must not enlarge the quorum');

context.myClientId = ids[0];
context.globalState = {
    phase: 'guessing', isPaused: false, psychicClientId: ids[0],
    roundPlayerIds: ids, timerValue: 1, stateVersion: 7
};
context.localCountdownTimer = null;
context.guesserDisconnectTimer = null;
context.revealEligibleGuesserIds = null;
context.clearTimeout = () => {};
const revealCalls = { publish: 0, timer: 0, render: 0, score: 0 };
context.pushGlobalStateBroadcast = () => { revealCalls.publish += 1; };
context.handleLiveTimerSynchronization = () => { revealCalls.timer += 1; };
context.renderGameInterface = () => { revealCalls.render += 1; };
context.evaluatePsychicPointPayouts = () => { revealCalls.score += 1; };
assert.equal(context.transitionGuessingToReveal([ids[1], ids[1], ids[2]]), true);
assert.equal(context.globalState.phase, 'reveal');
assert.equal(context.globalState.timerValue, -1);
assert.equal(context.globalState.stateVersion, 8);
assert.deepEqual(Array.from(context.revealEligibleGuesserIds), [ids[1], ids[2]]);
assert.deepEqual(revealCalls, { publish: 1, timer: 1, render: 1, score: 1 });
assert.equal(context.transitionGuessingToReveal([ids[1], ids[2]]), false, 'timer/final-guess race must not reveal twice');
assert.deepEqual(revealCalls, { publish: 1, timer: 1, render: 1, score: 1 });
for (const interRoundSeconds of [3, 5, 8, 10, 15]) {
    assert.equal(context.normalizeSettings({ guessSeconds: 10, interRoundSeconds, startingPsychic: 'random' }).interRoundSeconds, interRoundSeconds);
}

function isInsideSegments(value, segments) {
    return segments.some(([start, end]) => value >= start && value <= end);
}

const edgeCenters = [0, 1, 2, 98, 99, 100];
for (const center of edgeCenters) {
    for (const halfWidth of [3, 9, 16]) {
        const segments = context.wrappedArcSegments(center, halfWidth);
        assert(segments.length >= 1 && segments.length <= 2);
        for (let guess = 0; guess <= 100; guess += 1) {
            const visualHit = isInsideSegments(guess, segments);
            const scoringHit = context.circularDialDistance(guess, center) <= halfWidth;
            assert.equal(visualHit, scoringHit, `visual/scoring mismatch: center=${center}, guess=${guess}, width=${halfWidth}`);
        }
    }
}

const scoringCases = [
    [0, 100, 3], [0, 1, 3], [1, 99, 3], [2, 98, 2],
    [98, 5, 2], [99, 16, 0], [100, 84, 1], [2, 18, 1], [2, 19, 0]
];
for (const [target, guess, expected] of scoringCases) {
    assert.equal(context.scoreForDistance(context.circularDialDistance(target, guess)), expected, `target=${target}, guess=${guess}`);
}
assert(context.circularDialMean([99, 1]) < 1 || context.circularDialMean([99, 1]) > 99);

const spectrumContext = vm.createContext({
    CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
    ROUND_ID_PATTERN: /^r-[a-f0-9]{16}$/,
    ROUND_PHASES: new Set(['waiting', 'selecting', 'starting', 'clue', 'guessing', 'reveal', 'results']),
    ALLOWED_GUESS_SECONDS: new Set([5, 10, 15, 20, 30, 45, 60]),
    ALLOWED_INTER_ROUND_SECONDS: new Set([3, 5, 8, 10, 15]),
    globalState: { targetValue: 50 }
});
for (const name of [
    'clampNumber', 'normalizeClientId', 'normalizeRoundId', 'normalizeClientIdArray',
    'normalizeSettings', 'clearUnpublishedRoundContent', 'normalizeGameState', 'publicGameState'
]) {
    vm.runInContext(extractFunction(client, name), spectrumContext);
}
const synchronizedSpectrumState = {
    hostClientId: ids[0], psychicClientId: ids[1], rotationOrder: ids,
    roundPlayerIds: ids, targetValue: 87, activeClue: 'Round 1 clue',
    currentLeft: 'Cheap', currentRight: 'Expensive', timerValue: 5,
    roundId: `r-${'7'.repeat(16)}`, roundNumber: 1, stateVersion: 4,
    isPaused: false, phaseDeadline: 0, pausedPhaseRemainingMs: 0,
    settings: { guessSeconds: 10, interRoundSeconds: 5, startingPsychic: 'random' }
};
for (const phase of ['waiting', 'selecting', 'starting', 'clue']) {
    const normalized = spectrumContext.normalizeGameState({ ...synchronizedSpectrumState, phase });
    assert.equal(normalized.currentLeft, '', `${phase} must not synchronize a left pole`);
    assert.equal(normalized.currentRight, '', `${phase} must not synchronize a right pole`);
    assert.equal(normalized.activeClue, '', `${phase} must not synchronize a clue`);
}
for (const phase of ['guessing', 'reveal', 'results']) {
    const normalized = spectrumContext.normalizeGameState({ ...synchronizedSpectrumState, phase });
    assert.equal(normalized.currentLeft, 'Cheap', `${phase} must retain the current left pole`);
    assert.equal(normalized.currentRight, 'Expensive', `${phase} must retain the current right pole`);
    assert.equal(normalized.activeClue, 'Round 1 clue', `${phase} must retain the current clue`);
}
spectrumContext.globalState = { ...synchronizedSpectrumState, phase: 'clue' };
const privateClueState = spectrumContext.publicGameState();
assert.equal(privateClueState.currentLeft, '');
assert.equal(privateClueState.currentRight, '');
assert.equal(privateClueState.activeClue, '');
assert.equal('targetValue' in privateClueState, false, 'clue preparation must hide the target');
spectrumContext.globalState = { ...synchronizedSpectrumState, phase: 'guessing' };
const publishedGuessingState = spectrumContext.publicGameState();
assert.equal(publishedGuessingState.currentLeft, 'Cheap');
assert.equal(publishedGuessingState.currentRight, 'Expensive');
assert.equal(publishedGuessingState.activeClue, 'Round 1 clue');
assert.equal('targetValue' in publishedGuessingState, false, 'guessing must keep the target hidden');
spectrumContext.globalState = { ...synchronizedSpectrumState, phase: 'results' };
assert.equal(spectrumContext.publicGameState().currentLeft, 'Cheap', 'results must retain current-round poles');

const labelElements = {
    leftLabel: { textContent: 'stale left' },
    rightLabel: { textContent: 'stale right' }
};
const labelRenderContext = vm.createContext({
    isHost: false,
    globalState: {},
    document: { getElementById: id => labelElements[id] }
});
for (const name of ['clearUnpublishedRoundContent', 'renderSpectrumLabels']) {
    vm.runInContext(extractFunction(client, name), labelRenderContext);
}
for (const viewer of [
    { label: 'Host', isHost: true, clientId: ids[0] },
    { label: 'non-Host', isHost: false, clientId: ids[2] }
]) {
    labelRenderContext.isHost = viewer.isHost;
    labelRenderContext.myClientId = viewer.clientId;
    for (const phase of ['waiting', 'selecting', 'starting', 'clue']) {
        labelRenderContext.globalState = {
            ...synchronizedSpectrumState,
            phase,
            currentLeft: 'Cheap',
            currentRight: 'Expensive',
            activeClue: 'Private draft'
        };
        labelRenderContext.renderSpectrumLabels();
        assert.equal(labelElements.leftLabel.textContent, '', `${viewer.label} must see a blank left label during ${phase}`);
        assert.equal(labelElements.rightLabel.textContent, '', `${viewer.label} must see a blank right label during ${phase}`);
        assert.equal(labelRenderContext.globalState.currentLeft, '', `${viewer.label} local state must discard an unpublished left pole during ${phase}`);
        assert.equal(labelRenderContext.globalState.currentRight, '', `${viewer.label} local state must discard an unpublished right pole during ${phase}`);
        assert.equal(labelRenderContext.globalState.activeClue, '', `${viewer.label} local state must discard an unpublished clue during ${phase}`);
    }
}
labelRenderContext.globalState = { ...synchronizedSpectrumState, phase: 'guessing' };
labelRenderContext.renderSpectrumLabels();
assert.deepEqual(
    [labelElements.leftLabel.textContent, labelElements.rightLabel.textContent],
    ['Cheap', 'Expensive'],
    'Send Clue Live must make the synchronized poles renderable'
);
labelRenderContext.globalState = { ...synchronizedSpectrumState, phase: 'results' };
labelRenderContext.renderSpectrumLabels();
assert.deepEqual(
    [labelElements.leftLabel.textContent, labelElements.rightLabel.textContent],
    ['Cheap', 'Expensive'],
    'results must retain the current synchronized poles'
);
labelRenderContext.globalState.phase = 'starting';
labelRenderContext.renderSpectrumLabels();
assert.deepEqual(
    [labelElements.leftLabel.textContent, labelElements.rightLabel.textContent],
    ['', ''],
    'the next round must immediately clear the prior poles for every viewer'
);

const reloadedHostState = spectrumContext.normalizeGameState({
    ...synchronizedSpectrumState,
    hostClientId: ids[0],
    psychicClientId: ids[1],
    phase: 'clue'
});
assert.equal(reloadedHostState.currentLeft, '', 'a reloaded Host must not restore a stale left pole during clue preparation');
assert.equal(reloadedHostState.currentRight, '', 'a reloaded Host must not restore a stale right pole during clue preparation');

const draftWrites = new Map();
const draftContext = vm.createContext({
    roomId: 'ROOM1',
    myClientId: ids[1],
    myCurrentScore: 0,
    scoredRoundIds: new Set(),
    awardsPublishedRoundIds: new Set(),
    submittedGuessValue: null,
    targetKnownLocally: true,
    localRoundGuessesReceived: Object.create(null),
    revealEligibleGuesserIds: null,
    globalState: {
        ...synchronizedSpectrumState,
        phase: 'clue', activeClue: '', currentLeft: '', currentRight: ''
    },
    document: {
        getElementById: id => ({
            clueInput: { value: 'Private clue draft' },
            leftInput: { value: 'Tiny' },
            rightInput: { value: 'Huge' }
        }[id])
    },
    writeSessionValue: (key, value) => draftWrites.set(key, value)
});
vm.runInContext(extractFunction(client, 'clearUnpublishedRoundContent'), draftContext);
vm.runInContext(extractFunction(client, 'persistLocalRuntime'), draftContext);
draftContext.persistLocalRuntime();
const cachedPublicState = JSON.parse(draftWrites.get('wavelength.state.ROOM1'));
const cachedPsychicRuntime = JSON.parse(draftWrites.get('wavelength.psychic.ROOM1'));
assert.equal(cachedPublicState.currentLeft, '');
assert.equal(cachedPublicState.currentRight, '');
assert.equal(cachedPublicState.activeClue, '');
assert.deepEqual(
    [cachedPsychicRuntime.leftPoleDraft, cachedPsychicRuntime.rightPoleDraft, cachedPsychicRuntime.clueDraft],
    ['Tiny', 'Huge', 'Private clue draft'],
    'unsent Psychic inputs must persist only in private round runtime'
);

const restoredDraftInputs = {
    clueInput: { value: '' },
    leftInput: { value: '' },
    rightInput: { value: '' }
};
const draftRestoreContext = vm.createContext({
    CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
    roomId: 'ROOM1',
    myClientId: ids[1],
    targetKnownLocally: false,
    localRoundGuessesReceived: Object.create(null),
    revealEligibleGuesserIds: null,
    submittedGuessValue: null,
    needleSlider: { value: '50' },
    globalState: {
        ...synchronizedSpectrumState,
        phase: 'clue', activeClue: '', currentLeft: '', currentRight: ''
    },
    document: { getElementById: id => restoredDraftInputs[id] },
    readSessionValue: key => key.includes('wavelength.psychic.')
        ? JSON.stringify({
            roundId: synchronizedSpectrumState.roundId,
            targetValue: 87,
            targetKnownLocally: true,
            guesses: {},
            revealEligibleGuesserIds: [],
            clueDraft: 'Private clue draft',
            leftPoleDraft: 'Cheap',
            rightPoleDraft: 'Expensive'
        })
        : ''
});
for (const name of ['clampNumber', 'normalizeClientId', 'normalizeClientIdArray', 'restoreRoundSpecificRuntime']) {
    vm.runInContext(extractFunction(client, name), draftRestoreContext);
}
draftRestoreContext.restoreRoundSpecificRuntime();
assert.deepEqual(
    [restoredDraftInputs.leftInput.value, restoredDraftInputs.rightInput.value, restoredDraftInputs.clueInput.value],
    ['Cheap', 'Expensive', 'Private clue draft'],
    'a reloaded Psychic must recover private drafts in input fields'
);
assert.deepEqual(
    [draftRestoreContext.globalState.currentLeft, draftRestoreContext.globalState.currentRight, draftRestoreContext.globalState.activeClue],
    ['', '', ''],
    'restoring private Psychic drafts must not populate synchronized public round content'
);

const chatCalls = [];
const chatContext = vm.createContext({
    CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
    CHAT_MESSAGE_ID_PATTERN: /^c-[a-f0-9]{24}$/,
    CHAT_MAX_LENGTH: 400,
    roomId: 'ROOM1',
    myClientId: ids[0],
    activePlayerIds: new Set(ids),
    seenChatMessageIds: new Set(),
    Date,
    appendChatMessage: (...args) => chatCalls.push(args)
});
for (const name of ['normalizeRoomId', 'normalizeClientId', 'handleChatMessage']) {
    vm.runInContext(extractFunction(client, name), chatContext);
}
const validChatData = {
    roomId: 'ROOM1',
    messageId: `c-${'d'.repeat(24)}`,
    text: 'Hello party',
    sentAt: Date.now()
};
chatContext.handleChatMessage({ clientId: ids[1], data: validChatData });
assert.equal(chatCalls.length, 1, 'valid room chat must be accepted');
chatContext.handleChatMessage({ clientId: ids[1], data: { ...validChatData, roomId: 'OTHER' } });
chatContext.handleChatMessage({ clientId: 'forged-player', data: { ...validChatData, messageId: `c-${'e'.repeat(24)}` } });
chatContext.handleChatMessage({ clientId: ids[1], data: { ...validChatData, messageId: `c-${'f'.repeat(24)}`, text: 'x'.repeat(401) } });
chatContext.handleChatMessage({ clientId: ids[1], data: { ...validChatData, messageId: 'bad-id' } });
assert.equal(chatCalls.length, 1, 'malformed, wrong-room, forged, and oversized chat must be rejected');

let pendingRoundStart;
const pauseRaceContext = vm.createContext({
    isHost: true,
    presenceChannel: { get: callback => { pendingRoundStart = callback; } },
    roundStartInFlight: false,
    singlePlayerRecoveryTimer: null,
    globalState: { isPaused: false, phase: 'results', roundNumber: 3 },
    renderGameInterface: () => {}
});
vm.runInContext(extractFunction(client, 'beginNextRound'), pauseRaceContext);
pauseRaceContext.beginNextRound();
assert.equal(pauseRaceContext.roundStartInFlight, true);
pauseRaceContext.globalState.isPaused = true;
pendingRoundStart(null, []);
assert.equal(pauseRaceContext.roundStartInFlight, false);
assert.equal(pauseRaceContext.globalState.roundNumber, 3, 'pausing during an in-flight handoff must prevent the next round');

function createHostFailoverContext(myClientId, phase = 'waiting', isPaused = false) {
    const calls = {
        persist: 0, publish: 0, timer: 0, selection: 0,
        starting: 0, render: 0, resync: 0, recovery: 0
    };
    const failoverContext = vm.createContext({
        CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
        myClientId,
        isHost: false,
        electedHostClientId: '',
        activePlayerIds: new Set(),
        hostFailoverSyncTimer: null,
        globalState: {
            hostClientId: ids[0],
            psychicClientId: ids[2],
            rotationOrder: ids,
            phase,
            isPaused,
            roundNumber: phase === 'waiting' ? 0 : 3,
            roundId: phase === 'waiting' ? '' : `r-${'1'.repeat(16)}`,
            stateVersion: 10
        },
        clearTimeout: () => {},
        scheduleHostFailoverStateRequest: () => { calls.resync += 1; },
        persistLocalRuntime: () => { calls.persist += 1; },
        pushGlobalStateBroadcast: () => { calls.publish += 1; },
        handleLiveTimerSynchronization: () => { calls.timer += 1; },
        handlePsychicSelection: () => { calls.selection += 1; },
        handleStartingPhaseForPsychic: () => { calls.starting += 1; },
        renderGameInterface: () => { calls.render += 1; },
        recoverFromMissingPsychic: () => {
            calls.recovery += 1;
            return false;
        }
    });
    for (const name of [
        'clampNumber', 'normalizeClientId', 'arraysEqual', 'uniquePresenceMembers',
        'fallbackOrderedPresenceMembers', 'orderedPresenceMembers', 'appendCanonicalPlayerOrder',
        'selectHostCandidate', 'attemptHostFailover'
    ]) {
        vm.runInContext(extractFunction(client, name), failoverContext);
    }
    return { failoverContext, calls };
}

const remainingMembers = [members[1], members[2]];
const lobbyWinner = createHostFailoverContext(ids[1]);
assert.equal(lobbyWinner.failoverContext.attemptHostFailover(ids[0], remainingMembers), ids[1]);
assert.equal(lobbyWinner.failoverContext.globalState.hostClientId, ids[1], 'the deterministic lobby successor must become Host');
assert.equal(lobbyWinner.failoverContext.isHost, true, 'replacement Host UI state must be enabled');
assert.equal(lobbyWinner.failoverContext.globalState.stateVersion, 11);
assert.deepEqual(lobbyWinner.calls, {
    persist: 1, publish: 1, timer: 1, selection: 1,
    starting: 1, render: 1, resync: 0, recovery: 0
}, 'the replacement Host must publish and resume ownership exactly once');

const lobbyLoser = createHostFailoverContext(ids[2]);
assert.equal(lobbyLoser.failoverContext.attemptHostFailover(ids[0], remainingMembers), ids[1]);
assert.equal(lobbyLoser.failoverContext.globalState.hostClientId, ids[0], 'non-winners must await authenticated successor state');
assert.equal(lobbyLoser.failoverContext.isHost, false);
assert.equal(lobbyLoser.calls.publish, 0, 'only one client may publish the Host claim');
assert.equal(lobbyLoser.calls.resync, 1, 'a non-winner must request convergence if the claim broadcast is missed');

const reloadWithinGrace = createHostFailoverContext(ids[1]);
assert.equal(reloadWithinGrace.failoverContext.attemptHostFailover(ids[0], members), '');
assert.equal(reloadWithinGrace.failoverContext.globalState.hostClientId, ids[0], 'a present/reloaded Host must retain ownership');
assert.equal(reloadWithinGrace.calls.publish, 0);

const combinedRoleDeparture = createHostFailoverContext(ids[1], 'guessing');
combinedRoleDeparture.failoverContext.globalState.psychicClientId = ids[0];
combinedRoleDeparture.failoverContext.recoverFromMissingPsychic = (expectedPsychicClientId, currentMembers) => {
    combinedRoleDeparture.calls.recovery += 1;
    assert.equal(expectedPsychicClientId, ids[0]);
    assert.deepEqual(Array.from(currentMembers, member => member.clientId), [ids[1], ids[2]]);
    return true;
};
assert.equal(combinedRoleDeparture.failoverContext.attemptHostFailover(ids[0], remainingMembers), ids[1]);
assert.equal(combinedRoleDeparture.failoverContext.globalState.hostClientId, ids[1]);
assert.equal(combinedRoleDeparture.calls.recovery, 1, 'the successor must recover an abandoned Host/Psychic in the same failover turn');
assert.equal(combinedRoleDeparture.calls.publish, 0, 'the combined recovery owns the single authoritative publish');
assert.equal(combinedRoleDeparture.calls.timer, 0, 'normal Host resume work must not duplicate combined recovery timers');

for (const [phase, isPaused] of [['clue', false], ['guessing', false], ['results', false], ['results', true]]) {
    const activeWinner = createHostFailoverContext(ids[1], phase, isPaused);
    activeWinner.failoverContext.attemptHostFailover(ids[0], remainingMembers);
    assert.equal(activeWinner.failoverContext.globalState.hostClientId, ids[1], `${phase} failover must elect the same successor`);
    assert.equal(activeWinner.failoverContext.globalState.phase, phase, `${phase} failover must preserve the active phase`);
    assert.equal(activeWinner.failoverContext.globalState.isPaused, isPaused, `${phase} failover must preserve pause state`);
    assert.equal(activeWinner.calls.publish, 1, `${phase} failover must publish exactly once`);
}

function createPsychicRecoveryContext({
    myClientId = ids[0], hostClientId = ids[0], psychicClientId = ids[1],
    phase = 'clue', isPaused = false
} = {}) {
    const calls = { reset: 0, publish: 0, timer: 0, render: 0 };
    const hasPublishedClue = ['guessing', 'reveal', 'results'].includes(phase);
    const recoveryContext = vm.createContext({
        CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
        ACTIVE_ROUND_PHASES: new Set(['selecting', 'starting', 'clue', 'guessing', 'reveal']),
        myClientId,
        isHost: myClientId === hostClientId,
        activePlayerIds: new Set(),
        localCountdownTimer: null,
        selectionTransitionTimer: null,
        psychicDisconnectTimer: null,
        singlePlayerRecoveryTimer: null,
        guesserDisconnectTimer: null,
        roundStartInFlight: true,
        globalState: {
            hostClientId,
            psychicClientId,
            rotationOrder: [ids[0], ids[1], ids[2], idD],
            roundPlayerIds: [ids[0], ids[1], ids[2]],
            targetValue: 87,
            activeClue: hasPublishedClue ? 'A saved clue' : '',
            currentLeft: hasPublishedClue ? 'Left' : '',
            currentRight: hasPublishedClue ? 'Right' : '',
            phase,
            timerValue: 7,
            roundId: `r-${'2'.repeat(16)}`,
            roundNumber: 4,
            stateVersion: 20,
            roundNotice: '',
            isPaused,
            phaseDeadline: 12345,
            pausedPhaseRemainingMs: 800,
            settings: { guessSeconds: 10, interRoundSeconds: 5, startingPsychic: psychicClientId }
        },
        clearTimeout: () => {},
        resetLocalRoundRuntime: () => { calls.reset += 1; },
        pushGlobalStateBroadcast: () => { calls.publish += 1; },
        handleLiveTimerSynchronization: () => { calls.timer += 1; },
        renderGameInterface: () => { calls.render += 1; }
    });
    for (const name of [
        'clampNumber', 'normalizeClientId', 'uniquePresenceMembers',
        'enterSinglePlayerLobby', 'recoverFromMissingPsychic'
    ]) {
        vm.runInContext(extractFunction(client, name), recoveryContext);
    }
    return { recoveryContext, calls };
}

const temporaryPsychicDisconnect = createPsychicRecoveryContext();
assert.equal(temporaryPsychicDisconnect.recoveryContext.recoverFromMissingPsychic(
    ids[1], [members[0], members[1], members[2]]
), false, 'a Psychic who returns during grace must keep the round');
assert.equal(temporaryPsychicDisconnect.recoveryContext.globalState.phase, 'clue');
assert.equal(temporaryPsychicDisconnect.recoveryContext.globalState.roundId, `r-${'2'.repeat(16)}`);
assert.equal(temporaryPsychicDisconnect.recoveryContext.globalState.targetValue, 87);
assert.equal(temporaryPsychicDisconnect.recoveryContext.globalState.activeClue, '');
assert.equal(temporaryPsychicDisconnect.recoveryContext.globalState.currentLeft, '');
assert.equal(temporaryPsychicDisconnect.recoveryContext.globalState.currentRight, '');
assert.deepEqual(temporaryPsychicDisconnect.calls, { reset: 0, publish: 0, timer: 0, render: 0 });

const temporaryHostPsychicDisconnect = createPsychicRecoveryContext({
    myClientId: ids[0], hostClientId: ids[0], psychicClientId: ids[0], phase: 'guessing'
});
assert.equal(temporaryHostPsychicDisconnect.recoveryContext.recoverFromMissingPsychic(
    ids[0], [members[0], members[1]]
), false, 'a returning Host/Psychic must retain both roles and the active round');
assert.equal(temporaryHostPsychicDisconnect.recoveryContext.globalState.hostClientId, ids[0]);
assert.equal(temporaryHostPsychicDisconnect.recoveryContext.globalState.psychicClientId, ids[0]);
assert.equal(temporaryHostPsychicDisconnect.recoveryContext.globalState.phase, 'guessing');
assert.equal(temporaryHostPsychicDisconnect.recoveryContext.globalState.currentLeft, 'Left');
assert.equal(temporaryHostPsychicDisconnect.recoveryContext.globalState.currentRight, 'Right');
assert.equal(temporaryHostPsychicDisconnect.recoveryContext.globalState.activeClue, 'A saved clue');

for (const [phase, isPaused] of [
    ['selecting', false], ['starting', false], ['clue', false], ['guessing', false], ['reveal', false], ['guessing', true]
]) {
    const abandoned = createPsychicRecoveryContext({ phase, isPaused });
    assert.equal(abandoned.recoveryContext.recoverFromMissingPsychic(ids[1], [members[0], members[2]]), true);
    assert.equal(abandoned.recoveryContext.globalState.phase, 'waiting', `${phase} must recover to waiting`);
    assert.equal(abandoned.recoveryContext.globalState.roundId, '', `${phase} must invalidate the abandoned round ID`);
    assert.equal(abandoned.recoveryContext.globalState.roundNumber, 4, `${phase} abandonment must not count as a completed round`);
    assert.equal(abandoned.recoveryContext.globalState.psychicClientId, ids[1], `${phase} must retain the departed Psychic only as the rotation anchor`);
    assert.deepEqual(Array.from(abandoned.recoveryContext.globalState.roundPlayerIds), []);
    assert.equal(abandoned.recoveryContext.globalState.targetValue, 50);
    assert.equal(abandoned.recoveryContext.globalState.activeClue, '');
    assert.equal(abandoned.recoveryContext.globalState.currentLeft, '');
    assert.equal(abandoned.recoveryContext.globalState.currentRight, '');
    assert.equal(abandoned.recoveryContext.globalState.isPaused, false);
    assert.equal(abandoned.recoveryContext.globalState.timerValue, 5);
    assert.deepEqual(abandoned.calls, { reset: 1, publish: 1, timer: 1, render: 1 });
}

const completedResults = createPsychicRecoveryContext({ phase: 'results' });
assert.equal(completedResults.recoveryContext.recoverFromMissingPsychic(ids[1], [members[0], members[2]]), false);
assert.equal(completedResults.recoveryContext.globalState.phase, 'results', 'completed results must not be cancelled');
assert.equal(completedResults.recoveryContext.globalState.roundId, `r-${'2'.repeat(16)}`);
assert.deepEqual(completedResults.calls, { reset: 0, publish: 0, timer: 0, render: 0 });

for (const [phase, isPaused] of [
    ['clue', false], ['guessing', false], ['results', false], ['guessing', true]
]) {
    const singlePlayer = createPsychicRecoveryContext({ phase, isPaused });
    assert.equal(singlePlayer.recoveryContext.recoverFromMissingPsychic(ids[1], [members[0]]), true);
    assert.equal(singlePlayer.recoveryContext.globalState.phase, 'waiting');
    assert.equal(singlePlayer.recoveryContext.globalState.roundNumber, 0);
    assert.equal(singlePlayer.recoveryContext.globalState.roundId, '');
    assert.equal(singlePlayer.recoveryContext.globalState.psychicClientId, '');
    assert.deepEqual(Array.from(singlePlayer.recoveryContext.globalState.roundPlayerIds), []);
    assert.equal(singlePlayer.recoveryContext.globalState.timerValue, -1);
    assert.equal(singlePlayer.recoveryContext.globalState.isPaused, false);
    assert.equal(singlePlayer.recoveryContext.globalState.currentLeft, '');
    assert.equal(singlePlayer.recoveryContext.globalState.currentRight, '');
    assert.equal(singlePlayer.recoveryContext.globalState.activeClue, '');
    assert.equal(singlePlayer.recoveryContext.globalState.settings.startingPsychic, 'random');
    assert.match(singlePlayer.recoveryContext.globalState.roundNotice, /Waiting for at least one more player/);
    assert.deepEqual(singlePlayer.calls, { reset: 1, publish: 1, timer: 0, render: 1 });
}

const hostPsychicDeparture = createPsychicRecoveryContext({
    myClientId: ids[1], hostClientId: ids[1], psychicClientId: ids[0], phase: 'guessing'
});
assert.equal(hostPsychicDeparture.recoveryContext.recoverFromMissingPsychic(ids[0], [members[1], members[2]]), true);
assert.equal(hostPsychicDeparture.recoveryContext.globalState.hostClientId, ids[1]);
assert.equal(hostPsychicDeparture.recoveryContext.globalState.phase, 'waiting');

const lonePsychic = createPsychicRecoveryContext({
    myClientId: ids[1], hostClientId: ids[1], psychicClientId: ids[1], phase: 'guessing'
});
assert.equal(lonePsychic.recoveryContext.enterSinglePlayerLobby(new Set([ids[1]])), true);
assert.equal(lonePsychic.recoveryContext.globalState.psychicClientId, '', 'the lone player must not remain a phantom Psychic');
assert.equal(lonePsychic.recoveryContext.globalState.timerValue, -1, 'the lone player must not keep a guessing countdown');

const rejoinContext = vm.createContext({
    CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
    isHost: true,
    myClientId: ids[0],
    globalState: { hostClientId: ids[0], rotationOrder: ids }
});
for (const name of [
    'clampNumber', 'normalizeClientId', 'arraysEqual', 'uniquePresenceMembers',
    'fallbackOrderedPresenceMembers', 'orderedPresenceMembers', 'appendCanonicalPlayerOrder'
]) {
    vm.runInContext(extractFunction(client, name), rejoinContext);
}
assert.equal(rejoinContext.appendCanonicalPlayerOrder([members[0], fourMembers[3]]), true);
assert.deepEqual(
    Array.from(rejoinContext.orderedPresenceMembers([fourMembers[3], members[0]]).map(member => member.clientId)),
    [ids[0], idD],
    'a new D must append after lone A and make the recovery lobby a two-player Party'
);

context.globalState = {
    psychicClientId: ids[1],
    rotationOrder: [ids[0], ids[1], ids[2], idD],
    settings: { startingPsychic: 'random' }
};
assert.equal(context.chooseNextPsychic([members[0], members[2], fourMembers[3]]).psychicClientId, ids[2], 'C must follow a departed B');
context.globalState.psychicClientId = ids[2];
assert.equal(context.chooseNextPsychic([members[0], fourMembers[3]]).psychicClientId, idD, 'D must follow a departed C');
assert.equal(context.chooseNextPsychic([members[0]]).psychicClientId, ids[0], 'rotation must wrap to A when later players are absent');

const updatePlayersSource = extractFunction(client, 'updateLivePlayerDomGrid');
assert(updatePlayersSource.includes('scheduleSinglePlayerRecovery()'));
assert(updatePlayersSource.includes('recoverFromMissingPsychic(expectedPsychicClientId, currentMembers)'));
assert(!updatePlayersSource.includes('beginNextRound()'), 'a player joining the recovery lobby must not auto-start a game');

const authorityContext = vm.createContext({
    CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
    activePlayerIds: new Set(remainingMembers.map(member => member.clientId)),
    electedHostClientId: ids[1],
    awaitingAuthoritativeState: false,
    myClientId: ids[2],
    isCleanPregameState: () => false,
    isAuthorizedRecoveryState: () => false,
    globalState: { hostClientId: ids[0], stateVersion: 10, roundNumber: 0 }
});
vm.runInContext(extractFunction(client, 'normalizeClientId'), authorityContext);
vm.runInContext(extractFunction(client, 'isAuthorizedGameStateMessage'), authorityContext);
assert.equal(authorityContext.isAuthorizedGameStateMessage(
    { clientId: ids[1] },
    { hostClientId: ids[1], stateVersion: 11, roundNumber: 0 }
), true, 'the authenticated deterministic successor must be accepted');
assert.equal(authorityContext.isAuthorizedGameStateMessage(
    { clientId: ids[2] },
    { hostClientId: ids[2], stateVersion: 9, roundNumber: 0 }
), false, 'a non-winning client must not claim Host authority');
assert.equal(authorityContext.isAuthorizedGameStateMessage(
    { clientId: 'forged-player' },
    { hostClientId: ids[1], stateVersion: 11, roundNumber: 0 }
), false, 'an unauthenticated/invalid identity must not claim Host authority');

const orderAuthorityContext = vm.createContext({
    CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
    ACTIVE_ROUND_PHASES: new Set(['selecting', 'starting', 'clue', 'guessing', 'reveal']),
    activePlayerIds: new Set(ids),
    electedHostClientId: ids[0],
    awaitingAuthoritativeState: false,
    myClientId: ids[2],
    globalState: {
        hostClientId: ids[0], psychicClientId: ids[1], rotationOrder: [ids[0], ids[1]],
        roundPlayerIds: [ids[0], ids[1]], phase: 'waiting', roundId: '', roundNumber: 0,
        stateVersion: 10, settings: { guessSeconds: 10, interRoundSeconds: 5, startingPsychic: 'random' }
    }
});
for (const name of [
    'normalizeClientId', 'arraysEqual', 'settingsEqual', 'isCanonicalOrderExtension',
    'selectCanonicalSuccessorClientId', 'isCleanPregameState', 'isAuthorizedRecoveryState',
    'isAuthorizedGameStateMessage'
]) {
    vm.runInContext(extractFunction(client, name), orderAuthorityContext);
}
const canonicalAppendState = {
    ...orderAuthorityContext.globalState,
    rotationOrder: ids,
    stateVersion: 11
};
assert.equal(orderAuthorityContext.isAuthorizedGameStateMessage(
    { clientId: ids[0] }, canonicalAppendState
), true, 'the authenticated Host may append a present identity to canonical order');
assert.equal(orderAuthorityContext.isAuthorizedGameStateMessage(
    { clientId: ids[0] }, { ...canonicalAppendState, rotationOrder: [ids[0], ids[2], ids[1]] }
), false, 'even the Host may not reorder established canonical positions through normal state sync');
assert.equal(orderAuthorityContext.isAuthorizedGameStateMessage(
    { clientId: ids[1] }, canonicalAppendState
), false, 'the Psychic may not modify canonical Party order');

orderAuthorityContext.awaitingAuthoritativeState = true;
orderAuthorityContext.myClientId = ids[0];
assert.equal(orderAuthorityContext.isAuthorizedGameStateMessage(
    { clientId: ids[1] }, { ...canonicalAppendState, hostClientId: ids[1] }
), true, 'a returning former Host must accept the exact canonical successor\'s newer state');
assert.equal(orderAuthorityContext.isAuthorizedGameStateMessage(
    { clientId: ids[2] }, { ...canonicalAppendState, hostClientId: ids[2] }
), false, 'a later player may not displace the canonical successor during reconnect sync');

orderAuthorityContext.awaitingAuthoritativeState = false;
orderAuthorityContext.myClientId = ids[1];
orderAuthorityContext.globalState = { ...canonicalAppendState, hostClientId: ids[1] };
assert.equal(orderAuthorityContext.isAuthorizedGameStateMessage(
    { clientId: ids[0] }, { ...canonicalAppendState, hostClientId: ids[0], stateVersion: 12 }
), false, 'a former Host returning after failover must not steal ownership back');

const recoveryAuthContext = vm.createContext({
    CLIENT_ID_PATTERN: /^wl-[a-f0-9]{32}$/,
    ACTIVE_ROUND_PHASES: new Set(['selecting', 'starting', 'clue', 'guessing', 'reveal']),
    activePlayerIds: new Set([ids[0], ids[2]]),
    electedHostClientId: ids[0],
    awaitingAuthoritativeState: false,
    myClientId: ids[2],
    globalState: {
        hostClientId: ids[0], psychicClientId: ids[1], rotationOrder: ids,
        roundPlayerIds: ids, phase: 'guessing', roundId: `r-${'4'.repeat(16)}`,
        roundNumber: 4, stateVersion: 20, activeClue: 'Live clue', timerValue: 7,
        isPaused: false, settings: { guessSeconds: 10, interRoundSeconds: 5, startingPsychic: 'random' }
    }
});
for (const name of [
    'normalizeClientId', 'arraysEqual', 'settingsEqual', 'isCanonicalOrderExtension',
    'selectCanonicalSuccessorClientId', 'isCleanPregameState', 'isAuthorizedRecoveryState',
    'isAuthorizedGameStateMessage'
]) {
    vm.runInContext(extractFunction(client, name), recoveryAuthContext);
}
const abandonedRoundState = {
    ...recoveryAuthContext.globalState,
    roundPlayerIds: [], phase: 'waiting', roundId: '', stateVersion: 21,
    activeClue: '', timerValue: 5, isPaused: false
};
assert.equal(recoveryAuthContext.isAuthorizedGameStateMessage(
    { clientId: ids[0] }, abandonedRoundState
), true, 'only the authenticated Host may publish missing-Psychic recovery');
assert.equal(recoveryAuthContext.isAuthorizedGameStateMessage(
    { clientId: ids[2] }, abandonedRoundState
), false, 'a Guesser may not forge missing-Psychic recovery');

recoveryAuthContext.globalState = abandonedRoundState;
assert.equal(recoveryAuthContext.isAuthorizedGameStateMessage(
    { clientId: ids[1] }, {
        ...recoveryAuthContext.globalState,
        phase: 'guessing', roundId: `r-${'4'.repeat(16)}`, roundPlayerIds: ids,
        activeClue: 'Stale clue', stateVersion: 22
    }
), false, 'the departed Psychic must not resurrect the abandoned round');

recoveryAuthContext.globalState = {
    ...recoveryAuthContext.globalState,
    phase: 'clue', roundId: `r-${'4'.repeat(16)}`, roundPlayerIds: ids,
    activeClue: '', roundNumber: 4, stateVersion: 20
};
recoveryAuthContext.activePlayerIds = new Set([ids[0], ids[1]]);
recoveryAuthContext.awaitingAuthoritativeState = true;
recoveryAuthContext.myClientId = ids[1];
const cleanLobbyState = {
    ...recoveryAuthContext.globalState,
    psychicClientId: '', roundPlayerIds: [], phase: 'waiting', roundId: '', roundNumber: 0,
    stateVersion: 21, activeClue: '', timerValue: -1, isPaused: false
};
assert.equal(recoveryAuthContext.isAuthorizedGameStateMessage(
    { clientId: ids[0] }, cleanLobbyState
), true, 'a returning old Psychic must accept the current Host\'s clean recovery lobby');

const advancedRoundState = {
    ...recoveryAuthContext.globalState,
    psychicClientId: ids[2], roundPlayerIds: [ids[0], ids[2]], phase: 'clue',
    roundId: `r-${'6'.repeat(16)}`, roundNumber: 5, stateVersion: 30,
    activeClue: '', timerValue: -1, isPaused: false
};
recoveryAuthContext.activePlayerIds = new Set(ids);
assert.equal(recoveryAuthContext.isAuthorizedGameStateMessage(
    { clientId: ids[0] }, advancedRoundState
), true, 'a returning old Psychic must accept the Host\'s already-advanced round');

recoveryAuthContext.awaitingAuthoritativeState = false;
recoveryAuthContext.myClientId = ids[0];
recoveryAuthContext.activePlayerIds = new Set([ids[0]]);
assert.equal(recoveryAuthContext.isAuthorizedGameStateMessage(
    { clientId: ids[0] }, cleanLobbyState
), true, 'connected clients must accept the Host-authorized single-player lobby reset');

const finalizedAwardCalls = { presence: 0, persist: 0 };
const finalizedAwardContext = vm.createContext({
    myClientId: ids[2],
    myUsername: 'C',
    myCurrentScore: 10,
    scoredRoundIds: new Set(),
    globalState: { phase: 'reveal', roundId: `r-${'5'.repeat(16)}` },
    roundResults: {
        roundId: `r-${'5'.repeat(16)}`,
        awards: { [ids[2]]: 3 },
        guesses: { [ids[2]]: 50 }
    },
    presenceChannel: { update: () => { finalizedAwardCalls.presence += 1; } },
    persistLocalRuntime: () => { finalizedAwardCalls.persist += 1; }
});
vm.runInContext(extractFunction(client, 'applyFinalizedRoundAward'), finalizedAwardContext);
assert.equal(finalizedAwardContext.applyFinalizedRoundAward(finalizedAwardContext.globalState.roundId), false);
assert.equal(finalizedAwardContext.myCurrentScore, 10, 'reveal-phase awards must remain pending');
finalizedAwardContext.globalState.phase = 'waiting';
finalizedAwardContext.globalState.roundId = '';
assert.equal(finalizedAwardContext.applyFinalizedRoundAward(`r-${'5'.repeat(16)}`), false);
assert.equal(finalizedAwardContext.myCurrentScore, 10, 'an abandoned round must not apply pending points');
finalizedAwardContext.globalState.phase = 'results';
finalizedAwardContext.globalState.roundId = `r-${'5'.repeat(16)}`;
assert.equal(finalizedAwardContext.applyFinalizedRoundAward(finalizedAwardContext.globalState.roundId), true);
assert.equal(finalizedAwardContext.myCurrentScore, 13);
assert.equal(finalizedAwardContext.applyFinalizedRoundAward(finalizedAwardContext.globalState.roundId), false);
assert.deepEqual(finalizedAwardCalls, { presence: 1, persist: 1 }, 'finalized scoring must apply exactly once');

const nonHostControlContext = vm.createContext({
    isHost: false,
    globalState: { roundNumber: 3, isPaused: false }
});
vm.runInContext(extractFunction(client, 'toggleGamePaused'), nonHostControlContext);
nonHostControlContext.toggleGamePaused();
assert.equal(nonHostControlContext.globalState.isPaused, false, 'non-Hosts must not invoke Host-only pause actions');

assert.equal(vm.runInNewContext(client.match(/const DISCONNECT_GRACE_MS = (\d+);/)[1]), 8000);
assert.equal(vm.runInNewContext(client.match(/const ROLE_DEPARTURE_GRACE_MS = (\d+);/)[1]), 4000);
assert.equal(
    (updatePlayersSource.match(/}, ROLE_DEPARTURE_GRACE_MS\);/g) || []).length,
    2,
    'Host and Psychic departure recovery must share the same application-level grace period'
);
assert(!client.includes('HOST_DISCONNECT_GRACE_MS'), 'a separate Host grace constant must not drift from Psychic recovery again');
const hostFailoverSource = extractFunction(client, 'attemptHostFailover');
assert(
    hostFailoverSource.indexOf('recoverFromMissingPsychic(expectedHostClientId, currentMembers)')
        < hostFailoverSource.indexOf('persistLocalRuntime()'),
    'combined Host/Psychic recovery must run before publishing a standalone Host transition'
);

const originContext = vm.createContext({
    URL,
    PORT: 8000,
    PRODUCTION_ORIGIN: 'https://wavelength-example.onrender.com'
});
for (const name of ['normalizeConfiguredOrigin', 'resolveProductionOrigin', 'isAllowedRequestOrigin']) {
    vm.runInContext(extractFunction(server, name), originContext);
}
assert.equal(originContext.normalizeConfiguredOrigin('https://wavelength-example.onrender.com/'), 'https://wavelength-example.onrender.com');
assert.throws(() => originContext.normalizeConfiguredOrigin('https://wavelength-example.onrender.com/path'));
assert.equal(
    originContext.resolveProductionOrigin('https://custom.example', 'https://wavelength-example.onrender.com'),
    'https://custom.example',
    'APP_ORIGIN must override RENDER_EXTERNAL_URL'
);
assert.equal(
    originContext.resolveProductionOrigin('', 'https://wavelength-example.onrender.com/'),
    'https://wavelength-example.onrender.com',
    'RENDER_EXTERNAL_URL must be the automatic production fallback'
);
assert.equal(originContext.resolveProductionOrigin('', ''), '');
assert.throws(() => originContext.resolveProductionOrigin('https://custom.example', 'not-an-origin'));
assert.equal(originContext.isAllowedRequestOrigin('http://localhost:8000'), true);
assert.equal(originContext.isAllowedRequestOrigin('http://127.0.0.1:8000'), true);
assert.equal(originContext.isAllowedRequestOrigin('https://wavelength-example.onrender.com'), true);
assert.equal(originContext.isAllowedRequestOrigin('https://wrong-origin.example'), false);

const idsInMarkup = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(idsInMarkup.length, new Set(idsInMarkup).size, 'DOM ids must be unique');
const referencedIds = [...client.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(match => match[1]);
for (const id of referencedIds) assert(idsInMarkup.includes(id), `missing DOM id: ${id}`);

assert(client.includes("new Set(['waiting', 'selecting', 'starting', 'clue', 'guessing', 'reveal', 'results'])"));
assert(client.includes('secureRandomIndex(101)'), 'target generator must include both 0 and 100');
assert(client.includes('globalState.timerValue = globalState.settings.guessSeconds'));
assert(client.includes('globalState.timerValue = globalState.settings.interRoundSeconds'));
assert(client.includes('globalState.isPaused'));
assert(client.includes('Next round starting in'));
assert(client.includes('startPsychicSelectionAnimation'));
assert(client.includes('RANDOM_SELECTION_RESULT_HOLD_MS = 1000'));
assert(client.includes('RANDOM_SELECTION_DURATION_MS + RANDOM_SELECTION_RESULT_HOLD_MS'));
assert(client.includes('elapsedMs >= animationDuration'));
assert(client.includes('checkAllEligibleGuessesLocked'));
assert(client.includes("scoringEvaluationInFlightRoundId === globalState.roundId"));
assert(client.includes("roundId === globalState.roundId"), 'guess submissions must remain round-scoped');
assert(client.includes('scheduleDisconnectedGuesserGrace'));
assert(!client.includes('Connected securely with Ably token authentication.'), 'normal success banner must be removed');
assert(client.includes('Connection lost. Trying to reconnect…'));
assert(client.includes('Unable to connect. Check the room connection and authentication configuration.'));
assert(/<span id="leftLabel"[^>]*>\s*<\/span>/.test(html), 'pre-game left pole label must start blank');
assert(/<span id="rightLabel"[^>]*>\s*<\/span>/.test(html), 'pre-game right pole label must start blank');
assert(!/<input[^>]+id="leftInput"[^>]+value=/i.test(html), 'Psychic left-pole input must not have a semantic default');
assert(!/<input[^>]+id="rightInput"[^>]+value=/i.test(html), 'Psychic right-pole input must not have a semantic default');
assert(!html.includes('Cold') && !html.includes('Hot'), 'default Hot/Cold poles must not exist in application markup or state');
assert(extractFunction(client, 'publicGameState').includes('clearUnpublishedRoundContent(globalState)'));
assert(extractFunction(client, 'renderGameInterface').includes('renderSpectrumLabels()'));
assert(!extractFunction(client, 'renderSpectrumLabels').includes('leftInput')
    && !extractFunction(client, 'renderSpectrumLabels').includes('rightInput'),
'dial labels must never render from private Psychic input values');
assert(extractFunction(client, 'beginNextRound').includes("globalState.currentLeft = ''"), 'every new round must clear previous poles immediately');
assert(client.includes('leftPoleDraft') && client.includes('rightPoleDraft') && client.includes('clueDraft'), 'Psychic clue drafts must remain local and reloadable');
assert(client.includes("'🎯 Bullseye! +3 points'"));
assert(client.includes("'✅ Nice hit! +2 points'"));
assert(client.includes("'👍 Not bad! +1 point'"));
assert(client.includes("'❌ Off the mark! 0 points'"));
assert(client.includes('`Guess: ${Math.round(detailGuess)}% · Target: ${Math.round(globalState.targetValue)}%`'));
assert(!idsInMarkup.includes('btnResetScores'), 'visible Reset Party Scores control must be absent');
assert(html.includes('id="partyPanel"') && html.includes('id="gamePanel"') && html.includes('id="chatPanel"'));
assert(html.indexOf('id="gamePanel"') < html.indexOf('id="chatPanel"'), 'mobile DOM/CSS flow must keep Chat after the game');
assert(client.includes("channel.subscribe('chatMessage', handleChatMessage)"));
assert(client.includes('normalizeClientId(message?.clientId)'), 'chat sender must come from authenticated message.clientId');
assert(client.includes("body.textContent = text"), 'chat content must use safe DOM text rendering');
assert(client.includes('CHAT_SEND_COOLDOWN_MS = 750'));
assert(client.includes('CHAT_MAX_LENGTH = 400'));
assert(!extractFunction(client, 'sendChatMessage').includes('username:'), 'chat payload must not claim a username');

assert(client.includes('authCallback: requestAblyToken'));
assert(client.includes('useTokenAuth: true'));
assert(client.includes('window.location.origin + window.location.pathname'), 'invite links must derive from the current website origin');
assert(!/https?:\/\/(?:localhost|127\.0\.0\.1|[^'"\s]*onrender\.com)/i.test(client), 'client must not hardcode a deployment or development origin');
assert(!/new\s+Ably\.Realtime\s*\(\s*\{[^}]*\bkey\s*:/s.test(client), 'browser must not contain Ably key auth');
assert(server.includes('process.env.ABLY_API_KEY'));
assert(server.includes('process.env.APP_ORIGIN'));
assert(server.includes('process.env.RENDER_EXTERNAL_URL'));
assert(server.includes("process.env.PORT || '8000'"));
assert(server.includes("server.listen(PORT, '0.0.0.0'"));
assert(server.includes("[channelName]: ['publish', 'subscribe', 'presence']"));
assert(server.includes("fileName === '.env' || fileName.startsWith('.env.')"));
assert(!server.match(/ABLY_API_KEY\s*=\s*['"][^'"]+['"]/), 'server must not contain a literal Ably credential');
assert.equal(packageJson.scripts.start, 'node --env-file-if-exists=.env server.mjs');
assert.equal(packageJson.engines.node, '>=24.10 <25');
assert(envExample.includes('ABLY_API_KEY=your_ably_api_key_here'));
assert(envExample.includes('APP_ORIGIN=http://localhost:8000'));
assert(envExample.includes('Render supplies RENDER_EXTERNAL_URL automatically'));
assert(/^\.env$/m.test(gitignore), '.env must remain ignored');

console.log('Regression checks passed: syntax, deployment config, origins, DOM/layout, spectrum visibility, chat validation, settings, canonical Party order, Host/Psychic recovery, single-player fallback, pause races, rotation, circular scoring/bands, and auth invariants.');
