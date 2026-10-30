// Saved Viewer + isolated SQLite + real HTTP/downloads. One named HTTP fault injection.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../src/server/server.mjs';

const { chromium } = await import(process.env.VCM_PLAYWRIGHT_MODULE
  ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-knowledge-browser-'));
const app = createLocalServer({ dbPath: path.join(directory, 'demo.db'), port: 0 });
const { url } = await app.start();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
page.setDefaultTimeout(7000);
const results = [], errors = [], downloads = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('download', (download) => downloads.push(download));
async function post(route, body) {
  const response = await fetch(url + route, { method: 'POST',
    headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
async function check(name, action) {
  try { await action(); results.push(true); console.log(`PASS ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}: ${error.message}`); }
}
async function downloadByKeyboard() {
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Export Markdown', exact: true }).press('Enter'),
  ]);
  return { filename: download.suggestedFilename(), markdown: fs.readFileSync(await download.path(), 'utf8') };
}
async function capture(width) {
  if (!process.env.VCM_CAPTURE_DIR) return;
  fs.mkdirSync(process.env.VCM_CAPTURE_DIR, { recursive: true });
  const target = path.join(process.env.VCM_CAPTURE_DIR, `export-${width}.png`);
  await page.screenshot({ path: target });
  console.log(`CAPTURE ${target}`);
}
try {
  const project = await post('/api/projects', { name: 'DEMO portable knowledge' });
  const created = await post('/api/memories', { projectId: project.id, name: 'DEMO <img> memory',
    type: 'fact', summary: 'Original DEMO evidence\n```\n<script>not executable</script>' });
  const memory = created.affectedMemories[0];
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /DEMO <img> memory/ }).click();
  await page.waitForLoadState('networkidle');
  await check('real keyboard Markdown download retains evidence and never renders submitted HTML', async () => {
    const exported = await downloadByKeyboard();
    assert.equal(exported.filename, `memory-${memory.id}-r1.md`);
    assert.ok(exported.markdown.includes('Original DEMO evidence'));
    assert.ok(exported.markdown.includes('manual_input'));
    assert.equal(await page.locator('#inspector-content img, #inspector-content script').count(), 0);
    assert.equal((await (await fetch(`${url}/api/memories/${memory.id}/revisions`)).json()).length, 1);
    await capture(1400);
  });
  await check('dirty editor disables saved-only export and search render preserves the draft', async () => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#memory-editor [name=summary]').fill('Unsaved DEMO draft');
    assert.equal(await page.locator('#export-memory').isDisabled(), true);
    await page.locator('#search').fill('DEMO');
    await page.waitForFunction(() => document.querySelector('#library-count').textContent.includes('search results'));
    assert.equal(await page.locator('#memory-editor [name=summary]').inputValue(), 'Unsaved DEMO draft');
    assert.equal(await page.locator('#export-memory').isDisabled(), true);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Exit edit', exact: true }).click();
  });
  await check('other-client Revision change blocks stale Inspector export until details are reloaded', async () => {
    await post(`/api/memories/${memory.id}/edit`, {
      expectedRevisionId: memory.currentRevisionId, changes: { summary: 'Corrected DEMO evidence' },
    });
    const count = downloads.length;
    await page.locator('#export-memory').click();
    await page.waitForFunction(() => document.querySelector('#export-feedback').textContent.includes('REVISION_CHANGED'));
    assert.equal(downloads.length, count);
    await page.getByRole('button', { name: /DEMO <img> memory/ }).click();
    await page.waitForFunction(() => document.querySelector('#inspector-content').textContent.includes('Corrected DEMO evidence'));
    const exported = await downloadByKeyboard();
    assert.equal(exported.filename, `memory-${memory.id}-r2.md`);
    assert.ok(exported.markdown.includes('Corrected DEMO evidence'));
  });
  await check('named HTTP export failure is accessible and explicit GET retry works', async () => {
    await page.route('**/api/memories/*/export?*', (route) => route.fulfill({ status: 422,
      json: { error: { code: 'DEMO_EXPORT_FAILURE', message: 'Try this read again', details: {} } } }));
    await page.locator('#export-memory').click();
    await page.waitForFunction(() => document.querySelector('#export-feedback').textContent.includes('DEMO_EXPORT_FAILURE'));
    assert.equal(await page.locator('#export-feedback').getAttribute('tabindex'), '0');
    assert.equal(await page.locator('#export-memory').isEnabled(), true);
    await page.unroute('**/api/memories/*/export?*');
    const exported = await downloadByKeyboard();
    assert.ok(exported.markdown.includes('Corrected DEMO evidence'));
  });
  for (const width of [900, 640]) {
    await check(`${width}px Inspector export remains keyboard-accessible without horizontal overflow`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Open Inspector', exact: true }).click();
      assert.equal(await page.locator('#export-memory').isVisible(), true);
      await page.locator('#export-memory').focus();
      assert.equal(await page.locator('#export-memory').evaluate((node) => node === document.activeElement), true);
      const exported = await downloadByKeyboard();
      assert.ok(exported.markdown.includes('Corrected DEMO evidence'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await capture(width);
    });
  }
  await check('no unhandled application errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  await app.stop();
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, total: results.length }));
if (results.some((result) => !result)) process.exitCode = 1;
