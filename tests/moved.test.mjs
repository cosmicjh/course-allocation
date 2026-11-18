import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { onRequest as api } from '../functions/api/[[path]].js';
import { onRequest as health } from '../functions/api/health.js';

test('legacy API and health reject every method without using bindings or reading the body', async () => {
  for (const [path, handler] of [['/api/global', api], ['/api/access/login', api], ['/api/health', health]]) {
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const request = new Request('https://legacy.example' + path, {
        method,
        ...(['GET', 'HEAD'].includes(method) ? {} : { body: 'unread request data' })
      });
      const response = await handler({
        request,
        get env() { assert.fail('The handler must not access any bindings'); },
        next() { assert.fail('The handler must not fall through'); },
        waitUntil() { assert.fail('The handler must not schedule work'); }
      });
      assert.equal(response.status, 410);
      assert.equal(response.headers.get('X-Course-Allocation-Frozen'), '1');
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.match(response.headers.get('Content-Type'), /^application\/json\b/);
      assert.deepEqual(await response.json(), { ok: false, code: 'COURSE_MOVED' });
      assert.equal(request.bodyUsed, false);
    }
  }
});

test('the notice links directly to the curriculum sign-in page and loads no app script', async () => {
  const html = await readFile(new URL('../moved.html', import.meta.url), 'utf8');
  assert.match(html, /<a href="https:\/\/cosmicjh\.github\.io\/curriculum\/teacher\.html">/);
  assert.doesNotMatch(html, /<script\b/i);
});
