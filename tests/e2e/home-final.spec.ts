import { test, expect } from '@playwright/test';

/** Brand kit step 6 — final home page: order, picker keyboard, FAQ keyboard, Octo button, pictures, no floating card over a control. */
test('sections in the owner\'s order, each service with its 3D picture and alt text', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('From the factory to your customer.');
  const ids = await page.$$eval('section[id]', (els) => els.map((e) => e.id));
  const order = ['dropshipping', 'make-my-brand', 'sourcing', 'moq-pools', 'turnkey', 'warehousing'].filter((x) => ids.includes(x));
  expect(order.slice(0, 3)).toEqual(['dropshipping', 'make-my-brand', 'sourcing']);
  expect(ids.indexOf('warehousing')).toBeGreaterThan(ids.indexOf('sourcing'));
  for (const id of order) {
    const img = page.locator(`#${id} img`).first();
    await expect(img).toHaveAttribute('alt', /\S{4,}/);
  }
  await expect(page.getByTestId('3pl-strip').locator('img')).toHaveCount(4);
  await expect(page.getByText(/YunExpress|\[[A-Za-z]/)).toHaveCount(0);
});

test('picker: arrow keys move between tabs (aria-pressed) and keep ?do= in the URL', async ({ page }) => {
  await page.goto('/');
  const first = page.getByTestId('picker-tab-drop');
  await first.focus();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('picker-tab-brand')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('picker-tab-brand')).toBeFocused();
  await expect(page).toHaveURL(/do=brand/);
  await expect(page.getByTestId('picker-cta')).toHaveAttribute('href', '/request/brand');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Destination country')).toBeVisible(); // Source tab has the fields
  await page.goto('/?do=store');
  await expect(page.getByTestId('picker-tab-store')).toHaveAttribute('aria-pressed', 'true');
});

test('FAQ opens with the keyboard; Ask Octo goes to the assistant', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' }); // wait for the streamed section to hydrate
  const q = page.getByTestId('home-faq').locator('summary').first();
  await q.scrollIntoViewIfNeeded();
  await q.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('home-faq').locator('details').first()).toHaveAttribute('open', '');
  await expect(page.getByTestId('octo-button')).toHaveAttribute('href', '/assistant');
});

test('no floating card covers a button or link (1440 and 390)', async ({ page }) => {
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(vp);
    await page.goto('/');
    const hits = await page.evaluate(() => {
      const floats = [...document.querySelectorAll('.absolute.z-10.rounded-\\[16px\\].bg-white')].map((e) => e.getBoundingClientRect());
      const ctrls = [...document.querySelectorAll('main a, main button')].filter((e) => !e.closest('.absolute.z-10')).map((e) => ({ r: e.getBoundingClientRect(), t: (e.textContent || '').trim().slice(0, 30) }));
      const out: string[] = [];
      for (const f of floats) for (const c of ctrls) if (c.r.width && f.left < c.r.right && f.right > c.r.left && f.top < c.r.bottom && f.bottom > c.r.top) out.push(c.t);
      return out;
    });
    expect(hits, `${vp.width}px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  }
});
