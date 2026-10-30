import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedDemo } from '../src/demo/seed.mjs';
import { VisualContextMemoryStore } from '../src/db/store.mjs';
import { createLocalServer } from '../src/server/server.mjs';

const { chromium } = await import(process.env.VCM_PLAYWRIGHT_MODULE
  ?? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vcm-simple-ui-'));
const dbPath = path.join(directory, 'demo.db');
const demo = seedDemo({ dbPath });
const store = new VisualContextMemoryStore({ dbPath });
const app = createLocalServer({ store, port: 0 });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const { url } = await app.start();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(url); await page.waitForLoadState('networkidle');
  await page.locator(`[data-id="${demo.memories.metric.id}"]`).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).waitFor();
  const more = page.locator('.secondary-actions > summary');
  assert.equal(await page.locator('.secondary-actions').getAttribute('open'), null);
  assert.equal(await page.locator('[name="note"]').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Preview soft delete' }).isVisible(), false);
  await more.focus(); await page.keyboard.press('Space');
  assert.equal(await page.getByRole('button', { name: 'Preview soft delete' }).isVisible(), true);
  await page.keyboard.press('Space');
  console.log('PASS progressive actions remain keyboard-accessible');
  await page.screenshot({ path: path.join(directory, 'desktop.png') });
  for (const width of [900, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Open Inspector' }).click();
    assert.equal(await page.getByRole('button', { name: 'Edit', exact: true }).isVisible(), true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: path.join(directory, `mobile-${width}.png`) });
    console.log(`PASS ${width}px simple Inspector without page overflow`);
  }
  // Keep screenshots only when explicitly requested as verification artifacts.
  if (process.env.VCM_CAPTURE_DIR) {
    fs.mkdirSync(process.env.VCM_CAPTURE_DIR, { recursive: true });
    for (const name of ['desktop.png', 'mobile-900.png', 'mobile-640.png']) fs.copyFileSync(path.join(directory, name), path.join(process.env.VCM_CAPTURE_DIR, name));
  }
} finally {
  await browser.close(); await app.stop(); store.close(); fs.rmSync(directory, { recursive: true, force: true });
}
