// Saved app + fresh real SQLite + actual HTTP. Failure cases are named explicitly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../src/server/server.mjs';

const { chromium } = await import(process.env.VCM_PLAYWRIGHT_MODULE
  ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-creation-browser-'));
const app = createLocalServer({ dbPath: path.join(directory, 'fresh.db'), port: 0 });
const { url } = await app.start();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(7000);
const errors = [], results = [];
page.on('pageerror', (error) => errors.push(error.message));
async function check(name, action) {
  try { await action(); results.push(true); console.log(`PASS ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}: ${error.message}`); }
}
async function openMemory() { await page.getByRole('button', { name: 'New memory', exact: true }).click(); }
const dialog = page.locator('#creation-dialog');
try {
  await page.goto(url); await page.waitForLoadState('networkidle');
  let projectId, memoryId;
  await check('fresh install creates project and sourced memory, with text-safe names and real graph/Inspector', async () => {
    assert.equal(await page.getByRole('button', { name: 'Create your first project' }).isVisible(), true);
    await page.getByRole('button', { name: 'Create your first project' }).click();
    await dialog.getByLabel('Project name').fill('<b>我的项目</b>');
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#creation-dialog').open);
    projectId = await page.locator('#project-select').inputValue();
    assert.ok(projectId);
    assert.equal(await page.locator('#project-select option:checked').innerText(), '<b>我的项目</b>');
    assert.equal(await page.locator('#project-select b').count(), 0);
    await openMemory();
    await dialog.getByLabel('Memory name').fill('Keep <img> plain');
    await dialog.getByLabel('What should be remembered?').fill('Keep the existing classifier unchanged.');
    await dialog.getByLabel('Type', { exact: true }).selectOption('constraint');
    await dialog.getByRole('button', { name: 'Create memory', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#inspector-content').textContent.includes('Keep <img> plain'));
    memoryId = await page.locator('.memory-row').getAttribute('data-id');
    assert.ok(memoryId);
    const detail = await (await fetch(`${url}/api/memories/${memoryId}`)).json();
    assert.equal(detail.revisionCount, 1); assert.equal(detail.sources[0].sourceType, 'manual_input');
    assert.equal(await page.locator('#inspector-content img').count(), 0);
    assert.equal(await page.locator('#cy').evaluate((node, id) => node._cyreg.cy.getElementById(id).length, memoryId), 1);
    assert.match(await page.locator('#creation-feedback').innerText(), /Revision 1/);
  });
  await check('dirty creation Escape requires explicit choice and retains typed text', async () => {
    await openMemory(); await dialog.getByLabel('Memory name').fill('Unsaved name');
    page.once('dialog', (prompt) => prompt.dismiss()); await page.keyboard.press('Escape');
    assert.equal(await dialog.getByLabel('Memory name').inputValue(), 'Unsaved name');
    assert.equal(await dialog.isVisible(), true);
    page.once('dialog', (prompt) => prompt.accept()); await page.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), false);
  });
  await check('HTTP failure injection retains creation draft and accessible error', async () => {
    await openMemory();
    await dialog.getByLabel('Memory name').fill('Retain draft');
    await dialog.getByLabel('What should be remembered?').fill('Retain the full original text.');
    await page.route('**/api/memories', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 422, json: { error: { code: 'DEMO_INVALID', message: 'Check the draft', details: {} } } }) : route.continue());
    await dialog.getByRole('button', { name: 'Create memory', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#creation-status').textContent.includes('DEMO_INVALID'));
    assert.equal(await dialog.getByLabel('Memory name').inputValue(), 'Retain draft');
    assert.equal(await dialog.locator('#creation-status').getAttribute('tabindex'), '0');
    await page.unroute('**/api/memories');
    page.once('dialog', (prompt) => prompt.accept()); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await check('lost POST response after real commit does not duplicate memory; reconciliation is read-only', async () => {
    let posts = 0;
    await page.route('**/api/memories', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts++;
      await route.fetch(); // Real HTTP/SQLite commit, then deliberately drop its response.
      await route.abort('failed');
    });
    await openMemory(); await dialog.getByLabel('Memory name').fill('Committed but response lost');
    await dialog.getByLabel('What should be remembered?').fill('This is a deliberate fault-injection record.');
    await dialog.getByRole('button', { name: 'Create memory', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#creation-status').textContent.includes('outcome unknown'));
    assert.equal(await dialog.getByRole('button', { name: 'Create memory', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Check current records — read only' }).click();
    await page.waitForFunction(() => document.querySelector('#creation-records').textContent.includes('Committed but response lost'));
    assert.equal(posts, 1);
    const records = await (await fetch(`${url}/api/search?project=${projectId}&q=Committed&page=true`)).json();
    assert.equal(records.total, 1);
    await page.unroute('**/api/memories');
    page.once('dialog', (prompt) => prompt.accept()); await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
  await check('late post-create refresh cannot select an old-project memory after project switch', async () => {
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await dialog.getByLabel('Project name').fill('Second project');
    await dialog.getByRole('button', { name: 'Create project', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#creation-dialog').open);
    const second = await page.locator('#project-select').inputValue();
    await page.locator('#project-select').selectOption(projectId); await page.waitForLoadState('networkidle');
    let release, received, completed;
    const gate = new Promise((resolve) => { release = resolve; });
    const started = new Promise((resolve) => { received = resolve; });
    const finished = new Promise((resolve) => { completed = resolve; });
    let held = false;
    await page.route('**/api/graph?*', async (route) => {
      const requestProject = new URL(route.request().url()).searchParams.get('project');
      if (!held && requestProject === projectId) {
        held = true; received(); await gate;
        try { await route.continue(); } finally { completed(); }
      } else await route.continue();
    });
    await openMemory(); await dialog.getByLabel('Memory name').fill('Old project creation');
    await dialog.getByLabel('What should be remembered?').fill('Only belongs to the first project.');
    await dialog.getByRole('button', { name: 'Create memory', exact: true }).click();
    await started;
    await page.locator('#project-select').selectOption(second);
    await page.waitForFunction(() => document.querySelector('#graph-message-text').textContent.includes('No memories match'));
    release(); await finished;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('#project-select').inputValue(), second);
    assert.ok(!(await page.locator('#inspector-content').innerText()).includes('Old project creation'));
    assert.ok(!(await page.locator('#memory-list').innerText()).includes('Old project creation'));
    await page.unroute('**/api/graph?*');
  });
  for (const width of [900, 640]) {
    await check(`${width}px: creation dialog fits viewport and focuses its input`, async () => {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'New project', exact: true }).click();
      assert.equal(await dialog.getByLabel('Project name').evaluate((node) => node === document.activeElement), true);
      const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (process.env.VCM_CAPTURE_DIR) {
        fs.mkdirSync(process.env.VCM_CAPTURE_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.VCM_CAPTURE_DIR, `creation-${width}.png`) });
      }
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    });
  }
  await check('no unhandled application errors', async () => assert.deepEqual(errors, []));
} finally { await browser.close(); await app.stop(); fs.rmSync(directory, { recursive: true, force: true }); }
console.log(JSON.stringify({ passed: results.filter(Boolean).length, total: results.length }));
if (results.some((result) => !result)) process.exitCode = 1;
