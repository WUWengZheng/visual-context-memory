// Browser + saved app modules, with API responses deliberately reordered.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../src/server/server.mjs';
const { chromium } = await import(process.env.VCM_PLAYWRIGHT_MODULE ?? '/Users/wuwengzheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-browser-races-'));
const app = createLocalServer({ dbPath: path.join(directory, 'test.db'), port: 0 });
const { url } = await app.start();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function memory(id, name = id) {
  return { id, projectId: id.startsWith('B') ? 'B' : 'A', lifecycleStatus: 'active', currentRevision: { name, type: 'fact', contextRole: 'result', summary: name } };
}
async function fixture() {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  // Ignore abort at the transport seam: identity checks must still protect state.
  await page.addInitScript(() => {
    const nativeFetch = window.fetch;
    window.fetch = (url, options = {}) => nativeFetch(url, { ...options, signal: undefined });
  });
  const gates = [];
  const arm = (predicate) => {
    const received = deferred(), release = deferred(), finished = deferred();
    const gate = { predicate, received, release, finished, used: false };
    gates.push(gate);
    return gate;
  };
  await page.route('**/api/**', async (route) => {
    const request = new URL(route.request().url());
    const gate = gates.find((item) => !item.used && item.predicate(request));
    if (gate) { gate.used = true; gate.received.resolve(); await gate.release.promise; }
    const params = request.searchParams;
    const project = params.get('project') ?? 'A';
    const memories = [memory(`${project}-memory1`), memory(`${project}-memory2`)];
    let body;
    if (request.pathname === '/api/projects') body = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }];
    else if (request.pathname === '/api/conflicts' || request.pathname.endsWith('/revisions')) body = [];
    else if (request.pathname === '/api/memories') {
      body = params.get('page') === 'true' ? { items: memories, total: 2, truncated: false } : memories;
    } else if (request.pathname === '/api/graph') {
      const id = params.get('memoryId') ?? `${project}-ghost`;
      body = { nodes: [{ id, name: id, type: 'fact', lifecycleStatus: 'active' }], edges: [], total: 1 };
    } else if (request.pathname === '/api/search') {
      const items = [memory(params.get('q'))];
      body = params.get('page') === 'true' ? { items, total: 1, truncated: false } : items;
    } else {
      const item = memory(request.pathname.split('/').at(-1));
      body = { memory: item, currentRevision: item.currentRevision, sources: [], relations: [], notes: [] };
    }
    try { await route.fulfill({ json: body }); } finally { gate?.finished.resolve(); }
  });
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#memory-list')?.textContent.includes('A-memory1'));
  async function release(gate) {
    gate.release.resolve();
    await gate.finished.promise;
    // Wait for the application's render frames, not a guessed network delay.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  }
  return { page, arm, release };
}
async function check(name, action) {
  const fixtureData = await fixture();
  try { await action(fixtureData); results.push(true); console.log(`PASS ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}: ${error.message}`); }
  finally { await fixtureData.page.close(); }
}
try {
  await check('late detail after Escape cannot restore Inspector', async ({ page, arm, release }) => {
    const gate = arm((request) => request.pathname === '/api/memories/A-memory1');
    await page.locator('[data-id="A-memory1"]').click();
    await gate.received.promise;
    await page.keyboard.press('Escape');
    await release(gate);
    assert.match(await page.locator('#inspector-content').innerText(), /Select a node/);
  });
  await check('slow A workspace cannot overwrite B', async ({ page, arm, release }) => {
    const gate = arm((request) => request.pathname === '/api/graph' && request.searchParams.get('project') === 'A');
    await page.locator('#project-select').selectOption('A');
    await gate.received.promise;
    await page.locator('#project-select').selectOption('B');
    await page.waitForFunction(() => document.querySelector('#memory-list').textContent.includes('B-memory1'));
    await release(gate);
    assert.ok((await page.locator('#memory-list').innerText()).includes('B-memory1'));
    assert.ok(!(await page.locator('#memory-list').innerText()).includes('A-memory1'));
  });
  await check('old search cannot overwrite new keyword', async ({ page, arm, release }) => {
    const gate = arm((request) => request.pathname === '/api/search' && request.searchParams.get('q') === 'old');
    await page.locator('#search').fill('old');
    await gate.received.promise;
    await page.locator('#search').fill('new');
    await page.waitForFunction(() => document.querySelector('#memory-list').textContent.includes('new'));
    await release(gate);
    assert.ok((await page.locator('#memory-list').innerText()).includes('new'));
    assert.ok(!(await page.locator('#memory-list').innerText()).includes('old'));
  });
  await check('older neighborhood selection cannot restore wrong detail or focus', async ({ page, arm, release }) => {
    const gate = arm((request) => request.pathname === '/api/graph' && request.searchParams.get('memoryId') === 'A-memory1');
    await page.locator('[data-id="A-memory1"]').click();
    await gate.received.promise;
    await page.locator('[data-id="A-memory2"]').click();
    await page.waitForFunction(() => document.querySelector('#inspector-content').textContent.includes('A-memory2'));
    await release(gate);
    assert.ok((await page.locator('#inspector-content').innerText()).includes('A-memory2'));
    const ids = await page.locator('#cy').evaluate((element) => element._cyreg.cy.nodes().map((node) => node.id()));
    assert.deepEqual(ids, ['A-memory2']);
  });
} finally {
  await browser.close(); await app.stop();
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, total: results.length }));
if (results.some((pass) => !pass)) process.exitCode = 1;
