import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import * as Ably from 'ably';

const PORT = Number.parseInt(process.env.PORT || '8000', 10);
const ABLY_API_KEY = process.env.ABLY_API_KEY;
const PUBLIC_ROOT = path.dirname(fileURLToPath(import.meta.url));

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be a valid TCP port number.');
}

if (!ABLY_API_KEY) {
    throw new Error('Missing ABLY_API_KEY. Copy .env.example to .env and add your server-side Ably key.');
}

const ably = new Ably.Rest(ABLY_API_KEY);
const CLIENT_ID_PATTERN = /^wl-[a-f0-9]{32}$/;
const MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8'
};

function sendJson(response, statusCode, body) {
    response.writeHead(statusCode, {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
    });
    response.end(JSON.stringify(body));
}

function isValidRoom(room) {
    return /^[A-Z0-9]{1,20}$/.test(room);
}

function isValidClientId(clientId) {
    return CLIENT_ID_PATTERN.test(clientId);
}

function isAllowedLocalOrigin(origin) {
    if (!origin) return true;
    try {
        const parsedOrigin = new URL(origin);
        return parsedOrigin.protocol === 'http:'
            && ['localhost', '127.0.0.1', '[::1]'].includes(parsedOrigin.hostname)
            && parsedOrigin.port === String(PORT);
    } catch {
        return false;
    }
}

async function handleTokenRequest(request, response, requestUrl) {
    if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return sendJson(response, 405, { error: 'Method not allowed.' });
    }

    if (!isAllowedLocalOrigin(request.headers.origin)) {
        return sendJson(response, 403, { error: 'Origin is not allowed.' });
    }

    const room = (requestUrl.searchParams.get('room') || '').trim().toUpperCase();
    const clientId = (requestUrl.searchParams.get('clientId') || '').trim();

    if (!isValidRoom(room) || !isValidClientId(clientId)) {
        return sendJson(response, 400, { error: 'A valid room and clientId are required.' });
    }

    try {
        const channelName = `wavelength-lobby-${room}`;
        const tokenRequest = await ably.auth.createTokenRequest({
            clientId,
            capability: JSON.stringify({
                [channelName]: ['publish', 'subscribe', 'presence']
            }),
            ttl: 60 * 60 * 1000
        });
        return sendJson(response, 200, tokenRequest);
    } catch (error) {
        console.error('Ably token request failed:', error?.message || 'unknown error');
        return sendJson(response, 502, { error: 'Unable to create an Ably token request.' });
    }
}

async function serveStaticFile(response, requestUrl) {
    const requestedPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
    const absolutePath = path.resolve(PUBLIC_ROOT, `.${requestedPath}`);
    const fileName = path.basename(absolutePath).toLowerCase();

    if (absolutePath !== PUBLIC_ROOT && !absolutePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
        return sendJson(response, 403, { error: 'Forbidden.' });
    }
    if (fileName === '.env' || fileName.startsWith('.env.')) {
        return sendJson(response, 404, { error: 'Not found.' });
    }

    try {
        const content = await readFile(absolutePath);
        const extension = path.extname(absolutePath).toLowerCase();
        response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff'
        });
        response.end(content);
    } catch (error) {
        if (error?.code === 'ENOENT') return sendJson(response, 404, { error: 'Not found.' });
        console.error('Static file request failed:', error?.message || 'unknown error');
        return sendJson(response, 500, { error: 'Unable to read the requested file.' });
    }
}

const server = http.createServer(async (request, response) => {
    try {
        const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `localhost:${PORT}`}`);
        if (requestUrl.pathname === '/api/ably-token') {
            await handleTokenRequest(request, response, requestUrl);
            return;
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            response.setHeader('Allow', 'GET, HEAD');
            sendJson(response, 405, { error: 'Method not allowed.' });
            return;
        }
        await serveStaticFile(response, requestUrl);
    } catch (error) {
        console.error('Request failed:', error?.message || 'unknown error');
        if (!response.headersSent) sendJson(response, 400, { error: 'Invalid request.' });
        else response.end();
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Wavelength running at http://localhost:${PORT}`);
    console.log('Realtime auth endpoint: /api/ably-token');
});
