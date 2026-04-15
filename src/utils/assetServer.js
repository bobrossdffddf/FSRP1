/**
 * Lightweight static-asset server for banner/footer images.
 * Runs on port 3000 and is accessible at https://<REPLIT_DEV_DOMAIN>/banner.png
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '../../assets');
const PORT       = 3000;
const VERSION    = Date.now(); // changes each restart, busts Discord's image cache

const MIME = {
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif':  'image/gif',
};

let _server = null;

function startAssetServer() {
    if (_server) return;

    _server = http.createServer((req, res) => {
        const urlPath = req.url.split('?')[0];
        const filename = path.basename(urlPath);

        if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
        }

        const filePath = path.join(ASSETS_DIR, filename);
        if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }

        const ext         = path.extname(filename).toLowerCase();
        const contentType = MIME[ext] || 'application/octet-stream';

        res.writeHead(200, {
            'Content-Type':  contentType,
            'Cache-Control': 'public, max-age=86400',
        });
        fs.createReadStream(filePath).pipe(res);
    });

    _server.listen(PORT, '0.0.0.0', () => {
        console.log(`[Assets] Image server started — http://0.0.0.0:${PORT}/`);
    });

    _server.on('error', err => {
        console.warn(`[Assets] Server error: ${err.message}`);
    });
}

/**
 * Returns the public HTTPS URL for an asset, or null if no domain is available.
 * The ?v= parameter busts Discord's image cache on every bot restart.
 */
function getAssetUrl(filename) {
    const domain = process.env.REPLIT_DEV_DOMAIN;
    if (!domain) return null;
    return `https://${domain}/${filename}?v=${VERSION}`;
}

module.exports = { startAssetServer, getAssetUrl };
