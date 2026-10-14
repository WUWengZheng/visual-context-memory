// Real Chrome, saved application assets, isolated SQLite database.
// Run separately from node:test; no browser dependency is added to the project.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../src/server/server.mjs';
import { VisualContextMemoryStore } from '../src/db/store.mjs';

const { chromium } = await import(process.env.VCM_PLAYWRIGHT_MODULE ?? '/Users/wuwengzheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-browser-'));
const store = new VisualContextMemoryStore({ dbPath: path.join(directory, 'test.db') });
const user = store.createActor({ actorType: 'user', displayName: 'Browser test' });
const project = store.createProject({ name: '<b>Project & text</b>', slug: 'browser' });
const largeProject = store.createProject({ name: 'Bounded graph', slug: 'bounded' });
const typesProject = store.createProject({ name: 'Seven types', slug: 'seven-types' });
for (const type of ['entity', 'fact', 'decision', 'constraint', 'requirement', 'issue', 'resolution']) {
  store.createMemory({
    projectId: typesProject.id, actorId: user.id,
    revision: { name: type, type, contextRole: 'reference', summary: type },
  });
}
for (let index = 0; index < 201; index++) {
  store.createMemory({
    projectId: largeProject.id, actorId: user.id,
    isLocked: index === 200, isPinned: index === 200,
    revision: { name: `late-match ${index}`, type: 'constraint', contextRole: 'constraint', summary: 'Bounded data fixture.' },
  });
}
const add = (name, options = {}) => store.createMemory({
  projectId: project.id, actorId: user.id, ...options,
  revision: { name, type: 'fact', contextRole: 'result', summary: name, ...options.revision },
});
const first = add('needle first', { isLocked: true, isPinned: true });
const outdated = add('needle outdated', { isLocked: true, isPinned: true, lifecycleStatus: 'outdated' });
add('ordinary second');
const htmlMemory = add('<b>Memory & text</b>', { revision: { type: 'entity' } });
add('rejected needle', { lifecycleStatus: 'rejected' });
const source = store.createSource({ projectId: project.id, sourceType: 'manual_input', originalText: '<img src=x onerror=alert(1)>' });
store.attachSourceToRevision(first.currentRevisionId, { sourceId: source.id });
store.addMemoryNote(first.id, { actorId: user.id, content: '<script>dangerous()</script>' });
let app = createLocalServer({ store, port: 0 });
const { url } = await app.start();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
async function check(name, action) {
  try { await action(); results.push({ name, pass: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, pass: false }); console.log(`FAIL ${name}: ${error.message}`); }
}
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url);
await page.waitForLoadState('networkidle');
await page.locator('#project-select').selectOption(project.id);
await page.waitForFunction(() => document.querySelector('#memory-list').textContent.includes('needle first'));
if (process.env.VCM_SCREENSHOT_PATH) await page.screenshot({ path: process.env.VCM_SCREENSHOT_PATH });
await check('hidden overlay: computed display, bounds and mouse hit', async () => {
  const result = await page.locator('#graph-message').evaluate((element) => {
    const cy = document.querySelector('#cy').getBoundingClientRect();
    return { hidden: element.hidden, display: getComputedStyle(element).display, rects: element.getClientRects().length, hit: document.elementFromPoint(cy.x + cy.width / 2, cy.y + cy.height / 2)?.tagName };
  });
  assert.equal(result.hidden, true);
  assert.equal(result.display, 'none');
  assert.equal(result.rects, 0);
  assert.equal(result.hit, 'CANVAS');
});
await check('project HTML characters remain plain text', async () => {
  assert.equal(await page.locator(`#project-select option[value="${project.id}"]`).innerText(), project.name);
  assert.equal(await page.locator(`[data-id="${htmlMemory.id}"] .memory-name`).innerText(), '<b>Memory & text</b>');
  assert.equal(await page.locator(`[data-id="${htmlMemory.id}"] b`).count(), 0);
});
await check('desktop graph occupies the remaining viewport height', async () => {
  const bounds = await page.locator('#cy').boundingBox();
  assert.ok(bounds.height > 500, `Graph height was ${bounds.height}`);
});
await check('search survives result selection and Escape', async () => {
  await page.locator('#search').fill('needle');
  await page.waitForFunction(() => document.querySelector('#library-count').textContent.includes('search'));
  const before = await page.locator('#memory-list .memory-row').count();
  await page.locator(`[data-id="${first.id}"]`).click();
  await page.waitForFunction(() => document.querySelector('#inspector-content').textContent.includes('needle first'));
  assert.equal(await page.locator('#memory-list .memory-row').count(), before);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#memory-list .memory-row').count(), before);
  assert.equal(await page.locator('#search').inputValue(), 'needle');
});
await check('explicit Rejected renders a visible graph node', async () => {
  await page.locator('#search').fill('');
  await page.locator('#status-filter').selectOption('rejected');
  await page.waitForFunction(() => document.querySelector('#memory-list').textContent.includes('rejected needle'));
  const graph = await page.locator('#cy').evaluate((element) => {
    const cy = element._cyreg?.cy;
    return cy ? { count: cy.nodes().length, visible: cy.nodes().first().visible() } : null;
  });
  assert.ok(graph?.count === 1 && graph.visible);
});
await check('zero filtered nodes show accurate empty state and counts', async () => {
  await page.locator('#type-filter').selectOption('issue');
  await page.waitForFunction(() => document.querySelector('#graph-message').textContent.includes('No memories match'));
  assert.equal(await page.locator('#memory-list .memory-row').count(), 0);
  assert.match(await page.locator('#status-message').innerText(), /Graph: 0\/0/);
  assert.equal(await page.locator('#cy').evaluate((element) => element._cyreg.cy.nodes().length), 0);
});
await check('search combines Type, Lifecycle, Locked and Pinned', async () => {
  await page.locator('#type-filter').selectOption('fact');
  await page.locator('#status-filter').selectOption('active');
  await page.locator('#locked-filter').check();
  await page.locator('#pinned-filter').check();
  await page.locator('#search').fill('needle');
  await page.waitForFunction(() => document.querySelector('#library-count').textContent.includes('1/1 matching search'));
  assert.equal(await page.locator('#memory-list .memory-row').count(), 1);
  const data = await page.locator('#cy').evaluate((element) => {
    const cy = element._cyreg.cy;
    return { count: cy.nodes().length, hit: cy.nodes('.is-search-hit').length };
  });
  assert.deepEqual(data, { count: 1, hit: 1 });
});
await check('Locked and Pinned survive selection/search/outdated graph styles', async () => {
  await page.locator('#status-filter').selectOption('outdated');
  await page.waitForFunction(() => document.querySelector('#memory-list').textContent.includes('needle outdated'));
  await page.locator('#memory-list .memory-row').click();
  await page.waitForFunction(() => document.querySelector('#inspector-content').textContent.includes('needle outdated'));
  const label = await page.locator('#cy').evaluate((element) => element._cyreg.cy.nodes().first().style('label'));
  assert.match(label, /Locked/); assert.match(label, /Pinned/); assert.match(label, /outdated/);
  assert.match(await page.locator('#inspector-content').innerText(), /LOCKED · PINNED/);
});
await check('Library names, source originals and notes are plain text', async () => {
  await page.locator('#status-filter').selectOption('active');
  await page.waitForFunction(() => document.querySelector('#memory-list').textContent.includes('needle first'));
  await page.locator('#memory-list .memory-row').click();
  await page.waitForFunction(() => document.querySelector('#inspector-content').textContent.includes('needle first'));
  await page.locator('#inspector-content details summary').filter({ hasText: /^manual_input$/ }).click();
  await page.getByRole('button', { name: 'Show original', exact: true }).click();
  assert.ok((await page.locator('#inspector-content').innerText()).includes('<img src=x onerror=alert(1)>'));
  assert.ok((await page.locator('#inspector-content').innerText()).includes('<script>dangerous()</script>'));
  assert.equal(await page.locator('#inspector-content img, #inspector-content script').count(), 0);
});
await check('canvas receives node clicks, drags, wheel and background pans', async () => {
  await page.locator('#search').fill('');
  await page.waitForFunction(() => document.querySelector('#library-count').textContent.includes('memories'));
  await page.keyboard.press('Escape');
  const nodePoint = () => page.locator('#cy').evaluate((element) => {
    const cy = element._cyreg.cy;
    const position = cy.nodes().first().renderedPosition();
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x + position.x, y: bounds.y + position.y, position: cy.nodes().first().position(), zoom: cy.zoom(), pan: cy.pan() };
  });
  const initial = await nodePoint();
  await page.mouse.click(initial.x, initial.y);
  await page.waitForFunction(() => document.querySelector('#inspector-content').textContent.includes('needle first'));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForFunction(() => !document.querySelector('#cy')._cyreg.cy.animated());
  const focused = await nodePoint();
  await page.mouse.move(focused.x, focused.y); await page.mouse.down();
  await page.mouse.move(focused.x + 65, focused.y + 40, { steps: 8 }); await page.mouse.up();
  const dragged = await nodePoint();
  assert.ok(Math.hypot(dragged.position.x - focused.position.x, dragged.position.y - focused.position.y) > 20,
    JSON.stringify({ focused, dragged }));
  await page.mouse.move(dragged.x, dragged.y); await page.mouse.wheel(0, 180);
  await page.waitForFunction((zoom) => document.querySelector('#cy')._cyreg.cy.zoom() !== zoom, dragged.zoom);
  const bounds = await page.locator('#cy').boundingBox();
  const beforePan = await nodePoint();
  const x = bounds.x + 30, y = bounds.y + 30;
  await page.mouse.move(x, y); await page.mouse.down();
  await page.mouse.move(x + 80, y + 50, { steps: 8 }); await page.mouse.up();
  const afterPan = await nodePoint();
  assert.ok(Math.hypot(afterPan.pan.x - beforePan.pan.x, afterPan.pan.y - beforePan.pan.y) > 20);
});
await check('Legend contains seven types and reflects actual shape mappings', async () => {
  const labels = await page.locator('.legend .shape').allTextContents();
  assert.deepEqual(labels, ['Entity', 'Fact', 'Decision', 'Constraint', 'Requirement', 'Issue', 'Resolution']);
  await page.locator('#locked-filter').uncheck();
  await page.locator('#pinned-filter').uncheck();
  await page.locator('#status-filter').selectOption('');
  await page.locator('#type-filter').selectOption('');
  await page.locator('#project-select').selectOption(typesProject.id);
  await page.waitForFunction(() => document.querySelector('#cy')._cyreg.cy.nodes().length === 7);
  const shapes = await page.locator('#cy').evaluate((element) => Object.fromEntries(
    element._cyreg.cy.nodes().map((node) => [node.data('label'), node.style('shape')])));
  assert.deepEqual(shapes, {
    entity: 'round-rectangle', fact: 'ellipse', decision: 'diamond', constraint: 'hexagon',
    requirement: 'rectangle', issue: 'triangle', resolution: 'tag',
  });
});
await check('201-record project shows bounded ranges and finds the late locked/pinned result', async () => {
  await page.locator('#locked-filter').uncheck();
  await page.locator('#pinned-filter').uncheck();
  await page.locator('#type-filter').selectOption('');
  await page.locator('#status-filter').selectOption('');
  await page.locator('#project-select').selectOption(largeProject.id);
  await page.waitForFunction(() => document.querySelector('#library-count').textContent.includes('100/201'));
  assert.match(await page.locator('#status-message').innerText(), /Graph: 200\/201.*partial/);
  assert.equal(await page.locator('#cy').evaluate((element) => element._cyreg.cy.nodes().length), 200);
  await page.locator('#locked-filter').check();
  await page.locator('#pinned-filter').check();
  await page.waitForFunction(() => document.querySelector('#library-count').textContent.includes('1/1'));
  assert.match(await page.locator('#memory-list').innerText(), /late-match 200/);
  assert.match(await page.locator('#status-message').innerText(), /Graph: 1\/1/);
  // Return to the first project, preserving filters and clearing search explicitly.
  await page.locator('#project-select').selectOption(project.id);
  await page.waitForFunction(() => document.querySelector('#memory-list').textContent.includes('needle first'));
});
for (const width of [900, 640]) {
  await check(`${width}px Inspector and Library have open/close entries`, async () => {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Open Inspector', exact: true }).click({ timeout: 1500 });
    assert.ok(await page.locator('.inspector').isVisible());
    await page.getByRole('button', { name: 'Close Inspector', exact: true }).click();
    await page.getByRole('button', { name: 'Open Library', exact: true }).click();
    assert.ok(await page.locator('.library').isVisible());
    await page.getByRole('button', { name: 'Close Library', exact: true }).click();
    await page.waitForFunction(() => {
      const element = document.querySelector('#cy');
      return Math.abs(element._cyreg.cy.width() - element.getBoundingClientRect().width) < 2;
    });
  });
}
await check('HTTP error shows its code and Retry reloads the actual application', async () => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.route('**/api/graph?*', (route) => route.fulfill({ status: 422, json: { error: { code: 'INVALID_GRAPH_LIMIT', message: 'Bad graph limit', details: { limit: 0 } } } }));
  await page.locator('#type-filter').selectOption('entity');
  await page.waitForFunction(() => document.querySelector('#status-message').textContent.includes('INVALID_GRAPH_LIMIT'));
  assert.ok(!(await page.locator('#status-message').innerText()).includes('disconnected'));
  await page.unroute('**/api/graph?*');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#retry').hidden);
});
await check('server disconnect is distinct from HTTP error and Retry recovers', async () => {
  const port = app.address().port;
  await app.stop();
  await page.locator('#type-filter').selectOption('fact');
  await page.waitForFunction(() => document.querySelector('#status-message').textContent.includes('Server disconnected'));
  app = createLocalServer({ store, port });
  await app.start();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#retry').hidden);
  assert.ok(!(await page.locator('#status-message').innerText()).includes('disconnected'));
});
await browser.close();
await app.stop(); store.close(); fs.rmSync(directory, { recursive: true, force: true });
console.log(JSON.stringify({ passed: results.filter((item) => item.pass).length, total: results.length }));
if (results.some((item) => !item.pass)) process.exitCode = 1;
