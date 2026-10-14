// Actual Chrome + saved application + real HTTP/SQLite. Only the explicitly
// named failure case intercepts a response; other writes run real services.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalServer } from '../src/server/server.mjs';
import { VisualContextMemoryStore } from '../src/db/store.mjs';

const { chromium } = await import(process.env.VCM_PLAYWRIGHT_MODULE ?? '/Users/wuwengzheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-editor-browser-'));
const store = new VisualContextMemoryStore({ dbPath: path.join(directory, 'test.db') });
const project = store.createProject({ name: 'DEMO Phase 7 data (not real experiments)', slug: 'demo-editor' });
const otherProject = store.createProject({ name: 'Other DEMO project', slug: 'other-demo' });
const user = store.createActor({ actorType: 'user', displayName: 'Demo user' });
const add = (name, extra = {}) => store.createMemory({ projectId: project.id, actorId: user.id,
  revision: { name, type: 'fact', contextRole: 'reference', summary: 'DEMO fixture', confidence: 1, ...extra } });
const first = add('DEMO first');
const second = add('DEMO second');
const subject = add('DEMO subject', { type: 'entity', subtype: 'experiment' });
const metric = add('DEMO metric', { subtype: 'metric_observation' });
const mergeA = add('DEMO merge A'), mergeB = add('DEMO merge B');
const supersedeA = add('DEMO supersede A'), supersedeB = add('DEMO supersede B');
const conflictA = add('DEMO conflict A'), conflictB = add('DEMO conflict B');
const conflict = store.createConflict({ projectId: project.id, existingMemoryId: conflictA.id, existingRevisionId: conflictA.currentRevisionId,
  incomingMemoryId: conflictB.id, incomingRevisionId: conflictB.currentRevisionId, conflictType: 'duplicate', confidence: 1,
  rationale: 'Existing DEMO conflict; not automatically detected', detectedByActorId: user.id });
for (const memory of [mergeA, mergeB]) {
  const source = store.createSource({ projectId: project.id, sourceType: 'manual_input', originalText: `DEMO ${memory.currentRevision.name} provenance` });
  store.attachSourceToRevision(memory.currentRevisionId, { sourceId: source.id });
}
store.createMetricObservation({ revisionId: metric.currentRevisionId, subjectMemoryId: subject.id, metricName: 'DEMO accuracy',
  valueNumber: 65.433, valueRaw: '65.433', scopeKey: 'demo-scope', split: 'validation', protocol: 'clean', runLabel: 'demo-run', checkpoint: 'epoch57' });
store.lockMemory(metric.id, { actorId: user.id });
store.createRelation({ projectId: project.id, sourceMemoryId: first.id, targetMemoryId: second.id, relationType: 'related_to', confidence: 1, actorId: user.id });
const app = createLocalServer({ port: 0, store });
const { url } = await app.start();
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [], errors = [];
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (error) => errors.push(error.message));
page.setDefaultTimeout(7000);
async function reset(target = page) {
  await target.goto(url); await target.waitForLoadState('networkidle');
  await target.locator('#project-select').selectOption(project.id);
  await target.waitForFunction((id) => Boolean(document.querySelector(`[data-id="${id}"]`)), first.id);
}
async function choose(id, target = page) {
  await target.locator(`[data-id="${id}"]`).click();
  await target.waitForFunction((id) => document.querySelector('#revision-history') && document.querySelector('#inspector-content')?.textContent.includes(id), id);
}
async function edit(id, target = page) {
  await choose(id, target); await target.getByRole('button', { name: 'Edit', exact: true }).click();
}
async function saved(target = page) {
  await target.waitForFunction(() => !document.querySelector('#memory-editor') && document.querySelector('#editor-feedback')?.textContent.includes('New Revision'));
}
async function check(name, action) {
  try { await action(); results.push(true); console.log(`PASS ${name}`); }
  catch (error) { results.push(false); console.log(`FAIL ${name}: ${error.message}`); }
}
try {
  await reset();
  await check('real UI: 2-hop navigation, deselection and reload retain center/depth', async () => {
    await choose(first.id); await page.locator('[data-mode="two"]').click();
    await choose(second.id);
    assert.match(await page.locator('[data-mode="two"]').getAttribute('class'), /active/);
    await page.keyboard.press('Escape');
    const requestPromise = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/graph');
    await page.locator('#locked-filter').check();
    const request = new URL((await requestPromise).url());
    assert.equal(request.searchParams.get('memoryId'), second.id); assert.equal(request.searchParams.get('depth'), '2');
    await page.locator('#locked-filter').uncheck();
  });
  await check('real UI: draft survives search/reload and explicit navigation cancellation', async () => {
    await reset(); await edit(first.id);
    await page.locator('[name="summary"]').fill('Unfinished DEMO draft');
    await page.locator('#search').fill('DEMO');
    await page.waitForFunction(() => document.querySelector('#library-count').textContent.includes('search results'));
    await page.locator('[data-mode="project"]').click();
    assert.equal(await page.locator('[name="summary"]').inputValue(), 'Unfinished DEMO draft');
    page.once('dialog', (dialog) => dialog.dismiss()); await page.locator(`[data-id="${second.id}"]`).click();
    assert.equal(await page.locator('[name="summary"]').inputValue(), 'Unfinished DEMO draft');
    page.once('dialog', (dialog) => dialog.dismiss()); await page.locator('#project-select').selectOption(otherProject.id);
    assert.equal(await page.locator('#project-select').inputValue(), project.id);
    assert.equal(await page.locator('[name="summary"]').inputValue(), 'Unfinished DEMO draft');
    page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Exit edit' }).click();
    assert.equal(await page.locator('#memory-editor').count(), 0);
  });
  await check('real two browser tabs: stale Revision gets HTTP 409 and retains draft', async () => {
    await reset(); const tab = await browser.newPage(); tab.setDefaultTimeout(7000);
    try {
      await reset(tab); await edit(first.id); await edit(first.id, tab);
      const oldRevision = store.getMemory(first.id).currentRevisionId;
      await page.locator('[name="summary"]').fill('Saved by tab A');
      await page.locator('#save-memory').click(); await saved();
      await tab.locator('[name="summary"]').fill('Stale tab B');
      const response = tab.waitForResponse((r) => r.url().endsWith('/edit') && r.request().method() === 'POST');
      await tab.locator('#save-memory').click(); assert.equal((await response).status(), 409);
      await tab.waitForFunction(() => document.querySelector('#editor-feedback').textContent.includes('REVISION_MISMATCH'));
      assert.equal(await tab.locator('[name="summary"]').inputValue(), 'Stale tab B');
      assert.equal(store.getMemory(first.id).currentRevision.summary, 'Saved by tab A');
      assert.equal(store.getRevisionHistory(first.id).find((r) => r.id === oldRevision).summary, 'DEMO fixture');
    } finally { await tab.close(); }
  });
  await check('real UI: Locked Metric correction preserves scope and shows field Diff', async () => {
    await reset(); await edit(metric.id);
    await page.locator('[name="metricValueRaw"]').fill('65.564');
    await page.locator('#save-memory').click(); await saved();
    const m = store.getMemory(metric.id), o = store.getMetricObservation(m.currentRevisionId);
    assert.equal(m.isLocked, true); assert.equal(o.valueNumber, 65.564); assert.equal(o.runLabel, 'demo-run'); assert.equal(o.checkpoint, 'epoch57');
    await page.locator('#revision-history > summary').click();
    await page.locator('#revision-history details > summary').last().click();
    assert.match(await page.locator('#revision-history').innerText(), /metricObservation.valueNumber: 65.433 → 65.564/);
  });
  await check('real UI: successful edit outside filter is not reported as save failure', async () => {
    await reset(); await page.locator('#type-filter').selectOption('fact'); await edit(second.id);
    await page.locator('[name="type"]').selectOption('decision');
    await page.locator('#save-memory').click(); await saved();
    await page.waitForFunction(() => document.querySelector('#editor-feedback').textContent.includes('no longer matches'));
    assert.equal(await page.locator(`[data-id="${second.id}"]`).count(), 0);
    assert.equal(store.getMemory(second.id).currentRevision.type, 'decision');
  });
  await check('HTTP failure injection only: save failure keeps accessible draft/error', async () => {
    await reset(); await edit(first.id);
    await page.locator('[name="summary"]').fill('Keep me on failure');
    await page.route('**/api/memories/*/edit', (route) => route.fulfill({ status: 422, json: { error: { code: 'DEMO_FAILURE', message: 'Demo validation failure', details: {} } } }));
    await page.locator('#save-memory').click();
    await page.waitForFunction(() => document.querySelector('#editor-feedback').textContent.includes('DEMO_FAILURE'));
    assert.equal(await page.locator('[name="summary"]').inputValue(), 'Keep me on failure');
    assert.equal(await page.locator('#editor-feedback').getAttribute('tabindex'), '0');
    await page.unroute('**/api/memories/*/edit');
    page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Exit edit' }).click();
  });
  await check('real UI: Note add/delete and Pin update Library/Inspector', async () => {
    await reset(); await choose(first.id);
    await page.getByRole('button', { name: 'Pin', exact: true }).click();
    await page.getByRole('button', { name: 'Unpin', exact: true }).waitFor();
    assert.match(await page.locator(`[data-id="${first.id}"]`).innerText(), /Pinned/);
    await page.getByText('Add a note', { exact: true }).click();
    await page.locator('[name="note"]').fill('DEMO <b>plain Note</b>');
    await page.getByRole('button', { name: 'Add Note', exact: true }).click();
    await page.getByRole('button', { name: 'Soft delete Note: DEMO <b>plain Note</b>', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('#inspector-content .note'));
    assert.equal(store.listMemoryNotes(first.id).length, 0); assert.equal(store.listMemoryNotes(first.id, { includeDeleted: true }).length, 1);
  });
  await check('real UI: backend soft-delete preview executes and deleted Memory restores', async () => {
    await reset(); await choose(first.id);
    await page.getByText('More actions', { exact: true }).click();
    await page.getByRole('button', { name: 'Preview soft delete', exact: true }).click();
    await page.getByRole('button', { name: 'Execute reviewed operation' }).waitFor();
    assert.equal(store.getMemory(first.id).lifecycleStatus, 'active');
    assert.match(await page.locator('#operation-preview').innerText(), /historyPolicy/);
    await page.getByRole('button', { name: 'Execute reviewed operation' }).click();
    await page.getByRole('button', { name: 'Restore', exact: true }).waitFor();
    assert.equal(store.getMemory(first.id, { includeDeleted: true }).lifecycleStatus, 'deleted');
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).waitFor();
    assert.equal(store.getMemory(first.id).lifecycleStatus, 'candidate');
    assert.ok(store.getRevisionHistory(first.id).length >= 2);
  });
  await check('real UI: Merge preview becomes stale, requires re-preview and creates sourced history', async () => {
    await reset(); await choose(mergeA.id);
    async function previewMerge() {
      await page.getByText('Merge / Supersede (preview required)', { exact: true }).click();
      await page.getByLabel('Target Memory', { exact: true }).selectOption(mergeB.id);
      await page.getByLabel('Reason', { exact: true }).fill('DEMO merge review');
      await page.getByRole('button', { name: 'Preview Merge (keep current content)', exact: true }).click();
      await page.getByRole('button', { name: 'Execute reviewed operation' }).waitFor();
    }
    await previewMerge(); assert.equal(store.getRevisionHistory(mergeA.id).length, 1);
    app.services.memoryService.pinMemory(mergeB.id, user.id);
    await page.getByRole('button', { name: 'Execute reviewed operation' }).click();
    await page.waitForFunction(() => document.querySelector('#editor-feedback').textContent.includes('PREVIEW_STALE'));
    assert.equal(await page.getByRole('button', { name: 'Execute reviewed operation' }).count(), 0);
    assert.equal(store.getRevisionHistory(mergeA.id).length, 1);
    await previewMerge(); await page.getByRole('button', { name: 'Execute reviewed operation' }).click();
    await page.waitForFunction(() => document.querySelector('#editor-feedback')?.textContent.includes('Operation completed'));
    assert.equal(store.getRevisionHistory(mergeA.id).length, 2); assert.equal(store.getRevisionHistory(mergeB.id).length, 1);
    assert.equal(store.getMemory(mergeB.id).lifecycleStatus, 'superseded');
    assert.equal(store.listSourcesForRevision(store.getMemory(mergeA.id).currentRevisionId).length, 2);
  });
  await check('real UI: Supersede preserves center/depth and old revisions', async () => {
    await reset(); await choose(supersedeA.id); await page.locator('[data-mode="two"]').click();
    await page.getByText('Merge / Supersede (preview required)', { exact: true }).click();
    await page.getByLabel('Target Memory', { exact: true }).selectOption(supersedeB.id);
    await page.getByLabel('Reason', { exact: true }).fill('DEMO successor review');
    await page.getByRole('button', { name: 'Preview Supersede (target replaces current)', exact: true }).click();
    await page.getByRole('button', { name: 'Execute reviewed operation' }).click();
    await page.waitForFunction(() => document.querySelector('#editor-feedback')?.textContent.includes('Operation completed'));
    assert.equal(store.getMemory(supersedeA.id).lifecycleStatus, 'superseded');
    assert.equal(store.getRevisionHistory(supersedeA.id)[0].id, supersedeA.currentRevisionId);
    assert.match(await page.locator('[data-mode="two"]').getAttribute('class'), /active/);
    const query = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/graph');
    await page.locator('#pinned-filter').check();
    assert.equal(new URL((await query).url()).searchParams.get('memoryId'), supersedeA.id);
  });
  await check('real UI at 900px: existing Conflict manual dry-run opens Inspector, execution updates count', async () => {
    await reset(); await page.setViewportSize({ width: 900, height: 900 });
    await page.locator('#conflicts > details > summary').click();
    await page.getByText('duplicate · open', { exact: true }).click();
    await page.getByLabel('Manual resolution', { exact: true }).selectOption('keep_both');
    await page.getByRole('button', { name: 'Preview Conflict resolution', exact: true }).click();
    await page.getByRole('button', { name: 'Execute reviewed operation' }).waitFor({ state: 'visible' });
    assert.equal(store.getConflict(conflict.id).status, 'open');
    assert.match(await page.locator('#operation-preview').innerText(), /domainDryRun/);
    await page.getByRole('button', { name: 'Execute reviewed operation' }).click();
    await page.waitForFunction(() => document.querySelector('#conflicts').textContent.includes('0 open Conflicts'));
    assert.equal(store.getConflict(conflict.id).status, 'resolved');
    await page.setViewportSize({ width: 1400, height: 900 });
  });
  for (const width of [900, 640]) {
    await check(`${width}px: keyboard-accessible editor, close guard and graph resize`, async () => {
      await reset(); await page.setViewportSize({ width, height: 900 });
      if (width === 640) await page.getByRole('button', { name: 'Open Library' }).click();
      await edit(metric.id);
      await page.locator('[name="summary"]').fill('Narrow DEMO draft');
      page.once('dialog', (dialog) => dialog.dismiss()); await page.getByRole('button', { name: 'Close Inspector' }).click();
      assert.equal(await page.locator('#memory-editor').isVisible(), true);
      page.once('dialog', (dialog) => dialog.accept()); await page.getByRole('button', { name: 'Close Inspector' }).click();
      await page.getByRole('button', { name: 'Open Inspector' }).click();
      assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).isVisible(), true);
      const dimensions = await page.locator('#cy').evaluate((element) => ({ dom: element.clientWidth, cy: element._cyreg.cy.width() }));
      assert.equal(dimensions.cy, dimensions.dom);
      await page.setViewportSize({ width: 1400, height: 900 });
    });
  }
  await check('saved application has no unhandled browser errors', async () => assert.deepEqual(errors, []));
} finally {
  await browser.close(); await app.stop(); store.close(); fs.rmSync(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ passed: results.filter(Boolean).length, total: results.length }));
if (results.some((result) => !result)) process.exitCode = 1;
