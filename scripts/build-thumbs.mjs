// Renders the shelf thumbnails: every 3D product, without its mannequin, on a transparent background.
// Run with `npm run thumbs:build` after changing a model. Output: public/products/<product id>.webp
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const OUT = resolve('public/products');
mkdirSync(OUT, { recursive: true });

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) throw new Error('No Chrome or Edge found. Set CHROME_PATH to a Chromium browser.');

const readBody = (req) =>
  new Promise((ok, fail) => {
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', fail);
  });

let finish;
const finished = new Promise((ok) => (finish = ok));
let failures = 0;

const server = await createServer({
  server: { port: 5199, strictPort: false, host: '127.0.0.1' },
  logLevel: 'warn',
  plugins: [
    {
      name: 'thumb-sink',
      configureServer(s) {
        s.middlewares.use(async (req, res, next) => {
          if (req.method !== 'POST' || !req.url.startsWith('/__thumb')) return next();
          const body = await readBody(req);
          const [, route, id] = req.url.split('/');
          if (route === '__thumb') {
            writeFileSync(resolve(OUT, `${id}.webp`), body);
            console.log(`  ${id}.webp  ${(body.length / 1024).toFixed(0)} kB`);
          } else if (route === '__thumb-error') {
            failures++;
            console.error(`  ${id} FAILED\n${body}`);
          } else {
            finish();
          }
          res.end('ok');
        });
      },
    },
  ],
});
await server.listen();
const url = `${server.resolvedUrls.local[0]}scripts/thumbs.html`;
console.log(`Rendering ${url}`);

const chrome = spawn(browser, [
  '--headless=new',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--no-first-run',
  `--user-data-dir=${resolve(process.env.TEMP || '/tmp', `thumbs-profile-${process.pid}`)}`,
  url,
], { stdio: 'ignore' });

const timeout = setTimeout(() => {
  failures++;
  console.error('Timed out after 120 s');
  finish();
}, 120000);

await finished;
clearTimeout(timeout);
chrome.kill();
await server.close();
process.exit(failures ? 1 : 0);
