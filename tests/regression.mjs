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
    'orderedPresenceMembers',
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
assert.equal(context.chooseNextPsychic([members[0], members[2]]).psychicClientId, ids[2], 'disconnected next player must be skipped');

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

const originContext = vm.createContext({
    URL,
    PORT: 8000,
    APP_ORIGIN: 'https://wavelength-example.onrender.com'
});
for (const name of ['normalizeConfiguredOrigin', 'isAllowedRequestOrigin']) {
    vm.runInContext(extractFunction(server, name), originContext);
}
assert.equal(originContext.normalizeConfiguredOrigin('https://wavelength-example.onrender.com/'), 'https://wavelength-example.onrender.com');
assert.throws(() => originContext.normalizeConfiguredOrigin('https://wavelength-example.onrender.com/path'));
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
assert(server.includes("process.env.PORT || '8000'"));
assert(server.includes("server.listen(PORT, '0.0.0.0'"));
assert(server.includes("[channelName]: ['publish', 'subscribe', 'presence']"));
assert(server.includes("fileName === '.env' || fileName.startsWith('.env.')"));
assert(!server.match(/ABLY_API_KEY\s*=\s*['"][^'"]+['"]/), 'server must not contain a literal Ably credential');
assert.equal(packageJson.scripts.start, 'node --env-file-if-exists=.env server.mjs');
assert.equal(packageJson.engines.node, '>=24.10 <25');
assert(envExample.includes('ABLY_API_KEY=your_ably_api_key_here'));
assert(envExample.includes('APP_ORIGIN=http://localhost:8000'));
assert(/^\.env$/m.test(gitignore), '.env must remain ignored');

console.log('Regression checks passed: syntax, deployment config, origins, DOM/layout, chat validation, settings, pause races, rotation, circular scoring/bands, and auth invariants.');
