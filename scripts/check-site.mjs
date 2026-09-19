import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

// 在沒有 node_modules、只有網站來源的乾淨目錄驗證 Cloudflare 建置。
test('網站可獨立建置，清除舊產物並保留有效的頁面與本機連結', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'wordtiger-site-ci-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['scripts/build-site.mjs', 'src/content/markdown.ts', 'site', 'docs/privacy.md', 'docs/images', 'public/help.html', 'public/icons/128.png']) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await cp(new URL(`../${path}`, import.meta.url), join(root, path), { recursive: true });
  }
  await mkdir(join(root, 'dist/site'), { recursive: true });
  await writeFile(join(root, 'dist/site/obsolete.html'), 'old deployment');
  execFileSync(process.execPath, ['scripts/build-site.mjs'], { cwd: root });
  await assert.rejects(stat(join(root, 'dist/site/obsolete.html')), { code: 'ENOENT' });
  const base = new URL(`file://${root}/dist/site/`);
  for (const page of ['index.html', 'help.html', 'privacy.html']) {
    const html = await readFile(new URL(page, base), 'utf8');
    assert.match(html, /<h1[\s>]/);
    for (const [, href] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const url = new URL(href, new URL(page, base));
      if (url.protocol !== 'file:') continue;
      url.hash = ''; url.search = '';
      assert(url.href.startsWith(base.href), `Link outside deployment: ${href}`);
      assert((await stat(url)).isFile(), `Missing asset: ${href}`);
    }
  }
  assert.equal(await readFile(join(root, 'dist/site/privacy.html'), 'utf8'), await readFile(join(root, 'public/privacy.html'), 'utf8'));
});
