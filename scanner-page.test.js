const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

const indexHtml = readFileSync(join(__dirname, 'index.html'), 'utf8');
const redirectScript = readFileSync(
  join(__dirname, 'legacy-redirect.js'),
  'utf8',
);
const firebaseConfig = JSON.parse(
  readFileSync(join(__dirname, 'firebase.json'), 'utf8'),
);
const firebaseProject = JSON.parse(
  readFileSync(join(__dirname, '.firebaserc'), 'utf8'),
);

function executeRedirect(hostname, search = '', hash = '') {
  let replacement = null;
  const location = {
    hostname,
    search,
    hash,
    replace(value) {
      replacement = value;
    },
  };

  const window = { location };
  runInNewContext(redirectScript, {
    URL,
    window,
  });

  return {
    replacement,
    redirecting: window.__SN_SCANNER_REDIRECTING__ === true,
  };
}

test('declares the Firebase scanner as canonical branded URL', () => {
  assert.match(indexHtml, /<title>Sicherheit Nord · Ausweisscan<\/title>/);
  assert.match(
    indexHtml,
    /<meta property="og:site_name" content="Sicherheit Nord" \/>/,
  );
  assert.match(indexHtml, /https:\/\/sicherheit-nord-ausweisscan\.web\.app\//);
  assert.match(
    indexHtml,
    /<script src="\.\/legacy-redirect\.js\?v=20261003-firebase-host"><\/script>/,
  );
  assert.match(indexHtml, /scanner\.js\?v=20261003-firebase-host/);
});

test('redirects only the legacy GitHub Pages host and keeps query and hash', () => {
  const realisticFragment =
    '#v=1&s=11111111-1111-4111-8111-111111111111&u=YWJj&k=ZGVm&e=https%3A%2F%2Fscript.google.com%2Fmacros%2Fs%2Fexample%2Fexec';
  assert.deepEqual(
    executeRedirect(
      'sicherheit-nord-programming.github.io',
      '?source=legacy',
      realisticFragment,
    ),
    {
      replacement:
        'https://sicherheit-nord-ausweisscan.web.app/?source=legacy' +
        realisticFragment,
      redirecting: true,
    },
  );
  assert.deepEqual(
    executeRedirect(
      'sicherheit-nord-ausweisscan.web.app',
      '?source=firebase',
      '#session=keep',
    ),
    { replacement: null, redirecting: false },
  );
  assert.deepEqual(
    executeRedirect(
      'sicherheit-nord-ausweisscan.firebaseapp.com',
      '?source=firebase-alias',
      '#session=alias',
    ),
    {
      replacement:
        'https://sicherheit-nord-ausweisscan.web.app/?source=firebase-alias#session=alias',
      redirecting: true,
    },
  );
  assert.match(
    readFileSync(join(__dirname, 'scanner.js'), 'utf8'),
    /if \(!window\.__SN_SCANNER_REDIRECTING__\) \{\s*void start\(\);\s*\}/,
  );
});

test('targets the dedicated Firebase Hosting site with no-store security headers', () => {
  assert.equal(
    firebaseProject.projects.default,
    'sicherheit-nord-aufschaltung',
  );
  assert.equal(firebaseConfig.hosting.site, 'sicherheit-nord-ausweisscan');
  assert.equal(firebaseConfig.hosting.public, '.');

  const globalHeaders = firebaseConfig.hosting.headers.find(
    ({ source }) => source === '**',
  );
  assert.ok(globalHeaders);
  const headers = Object.fromEntries(
    globalHeaders.headers.map(({ key, value }) => [key, value]),
  );
  assert.equal(headers['Cache-Control'], 'no-cache, no-store, must-revalidate');
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(
    headers['Permissions-Policy'],
    'camera=(self), microphone=(), geolocation=()',
  );
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
});
