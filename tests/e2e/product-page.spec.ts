import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import { config } from 'dotenv';

/**
 * Product page (/p/<slug>) — quantity box + gallery (6 Nov 2026), at 1440 and 390 px.
 * Uses live Bowijie products. The 3-image case adds two temporary product_media rows (the product's own photo with a
 * cache-busting query) before the first visit and deletes them afterwards — run against a freshly started local server
 * so the product cache is cold.
 */
config({ path: '.env.local', quiet: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

type Fx = { one: string; multi: string; moq3000: string; tiers: { slug: string; moq: number; tiers: { min_qty: number; unit_price_cents: number }[] } };
let fx: Fx; let added: string[] = [];

test.beforeAll(async () => {
  await db.connect();
  const imgCount = `(select count(*) from product_media m where m.product_id = p.id and m.kind = 'image')`;
  const one = (await db.query(`select slug from products p where status = 'live' and ${imgCount} = 1 and moq = 3000 order by slug limit 1`)).rows[0];
  const multi = (await db.query(`select p.id, p.slug, (select url from product_media m where m.product_id = p.id and m.kind = 'image' limit 1) url
    from products p where status = 'live' and ${imgCount} = 1 and slug <> $1 order by slug desc limit 1`, [one.slug])).rows[0];
  const t = (await db.query(`select slug, moq, (select json_agg(json_build_object('min_qty', min_qty, 'unit_price_cents', unit_price_cents) order by min_qty) from price_tiers x where x.product_id = p.id) tiers
    from products p where status = 'live' and (select count(*) from price_tiers x where x.product_id = p.id) >= 2 and slug not in ($1, $2) order by slug limit 1`, [one.slug, multi.slug])).rows[0];
  for (const v of [2, 3]) {
    const r = await db.query(`insert into product_media(product_id, url, alt, sort, kind) values ($1, $2, null, $3, 'image') returning id`, [multi.id, `${multi.url}${multi.url.includes('?') ? '&' : '?'}qa=${v}`, 100 + v]);
    added.push(r.rows[0].id);
  }
  fx = { one: one.slug, multi: multi.slug, moq3000: one.slug, tiers: t };
});

test.afterAll(async () => {
  if (added.length) await db.query(`delete from product_media where id = any($1::uuid[])`, [added]);
  added = [];
  await db.end();
});

const noPlaceholders = async (page: Page) => {
  // gallery + buy box, and the banner ad on the page (product cards further down keep their own photo fallback)
  await expect(page.getByTestId('product-top').locator('.ph')).toHaveCount(0);
  await expect(page.locator('main aside .ph')).toHaveCount(0);
  await expect(page.getByTestId('product-top').getByText('Packaging', { exact: true })).toHaveCount(0);   // a "Packaging" service link elsewhere is fine
};

for (const vp of [{ name: 'desktop', width: 1440, height: 900, thumb: 56 }, { name: 'mobile', width: 390, height: 844, thumb: 48 }]) {
  test.describe(`product page @ ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('1-image product: no thumbnail strip, no placeholders, no +/- buttons', async ({ page }) => {
      await page.goto(`/p/${fx.one}`);
      await expect(page.getByTestId('gallery-main')).toBeVisible();
      await expect(page.getByTestId('gallery-thumbs')).toHaveCount(0);
      await noPlaceholders(page);
      await expect(page.getByRole('button', { name: /decrease quantity|increase quantity/i })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^[−+-]$/ })).toHaveCount(0);
      await expect(page.getByTestId('qty-input')).toHaveValue('3000');
    });

    test('3-image product: 3 small real thumbnails, keyboard navigation, no Packaging box', async ({ page }) => {
      await page.goto(`/p/${fx.multi}`);
      const thumbs = page.getByTestId('gallery-thumbs').getByRole('button');
      await expect(thumbs).toHaveCount(3);
      for (let i = 0; i < 3; i++) {
        const img = thumbs.nth(i).locator('img');
        await expect(img).toHaveAttribute('alt', `Image ${i + 1} of 3`);
        const box = (await thumbs.nth(i).boundingBox())!;
        expect(Math.round(box.width)).toBe(vp.thumb);
        expect(Math.round(box.height)).toBe(vp.thumb);
      }
      // left-aligned under the main image, 8 px gap
      const main = (await page.getByTestId('gallery-main').boundingBox())!;
      const b0 = (await thumbs.nth(0).boundingBox())!; const b1 = (await thumbs.nth(1).boundingBox())!;
      expect(Math.abs(b0.x - main.x)).toBeLessThanOrEqual(2);
      expect(Math.round(b1.x - (b0.x + b0.width))).toBe(8);
      await expect(thumbs.nth(0)).toHaveAttribute('aria-current', 'true');
      await thumbs.nth(0).focus();
      await page.keyboard.press('ArrowRight');
      await expect(thumbs.nth(1)).toHaveAttribute('aria-current', 'true');
      await expect(page.getByTestId('gallery-main')).toHaveAttribute('src', /qa=2/);
      await page.keyboard.press('ArrowLeft');
      await expect(thumbs.nth(0)).toHaveAttribute('aria-current', 'true');
      await noPlaceholders(page);
    });

    test('typing below the MOQ corrects to the MOQ on blur', async ({ page }) => {
      await page.goto(`/p/${fx.moq3000}`);
      const q = page.getByTestId('qty-input');
      await q.fill('2,000');
      await q.blur();
      await expect(q).toHaveValue('3000');
      await expect(page.getByTestId('qty-note')).toContainText('Minimum order is 3,000 pcs');
      await q.fill('3500.7');   // only digits are accepted → a whole number
      await expect(q).toHaveValue('35007');
      await q.blur();
      const m = Number(await page.getByTestId('qty-input').inputValue());
      // with a carton quantity the value goes up to the next full carton and the buyer is told
      if (m !== 35007) await expect(page.getByTestId('qty-note')).toContainText(/Rounded up to .*full cartons/);
    });

    test('chips set the quantity, unit price and subtotal', async ({ page }) => {
      await page.goto(`/p/${fx.tiers.slug}`);
      const chips = page.getByTestId('qty-chip');
      const quick = [...new Set([fx.tiers.moq, ...fx.tiers.tiers.map((t) => t.min_qty)].filter((n) => n >= fx.tiers.moq))].sort((a, b) => a - b);
      await expect(chips).toHaveCount(quick.length);
      const last = quick[quick.length - 1];
      const before = await page.getByTestId('unit-price').textContent();
      await chips.last().click();
      await expect(page.getByTestId('qty-input')).toHaveValue(String(last));
      await expect(chips.last()).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('unit-price')).not.toHaveText(before ?? '');
      const sub = await page.getByTestId('subtotal').textContent();
      const unit = Number((await page.getByTestId('unit-price').textContent())!.replace(/[^0-9.]/g, ''));
      expect(Number(sub!.replace(/[^0-9.]/g, ''))).toBeCloseTo(unit * last, 0);
      await noPlaceholders(page);
    });
  });
}

