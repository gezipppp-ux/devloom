const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { issueAttachments, previewMimeType } = require('../../src/domain/project-files.cjs');
const { readApiBody } = require('../../src/http/api.cjs');
const { serveProjectContent } = require('../../src/http/project-content-api.cjs');
const attachment = (data = Buffer.from('file')) => ({ id: randomUUID(), name: '说明.txt', mimeType: 'text/plain', data: data.toString('base64') });

test('issue attachment input enforces canonical base64, unique UUIDv4 and bounded bytes', () => {
  assert.deepEqual(issueAttachments({}), []);
  assert.equal(issueAttachments({ attachments: [attachment()] })[0].data.toString(), 'file');
  for (const data of ['', 'a', 'Zg=', 'Zg==\n', 'Zh==', '!!!!', 42]) assert.throws(() => issueAttachments({ attachments: [{ ...attachment(), data }] }), { statusCode: 400 });
  for (const id of ['x', '00000000-0000-1000-8000-000000000000', null]) assert.throws(() => issueAttachments({ attachments: [{ ...attachment(), id }] }), { statusCode: 400 });
  const file = attachment();
  assert.throws(() => issueAttachments({ attachments: [file, file] }), /重复/);
  assert.throws(() => issueAttachments({ attachments: Array.from({ length: 21 }, () => attachment()) }), /20/);
  assert.throws(() => issueAttachments({ attachments: [attachment(Buffer.alloc(10 * 1024 * 1024 + 1))] }), { statusCode: 400 });
  assert.throws(() => issueAttachments({ attachments: [attachment(Buffer.alloc(10 * 1024 * 1024)), attachment(Buffer.alloc(10 * 1024 * 1024)), attachment()] }), /合计/);
  assert.throws(() => issueAttachments({ attachments: [{ ...attachment(), name: '../unsafe' }] }), /路径/);
});

test('inline content uses validated raster signature, never supplied SVG or image MIME', async () => {
  const values = [[Buffer.from('<svg/>'), null], [Buffer.from('GIF89a1234'), 'image/gif'], [Buffer.from([137,80,78,71,13,10,26,10]), 'image/png'], [Buffer.from([255,216,255]), 'image/jpeg'], [Buffer.from('RIFF1234WEBP'), 'image/webp']];
  for (const [data, type] of values) {
    assert.equal(previewMimeType(data), type);
    const headers = {};
    await serveProjectContent({ method: 'GET' }, { writeHead(_status, value) { Object.assign(headers, value); }, end() {} }, new URL('http://localhost/api/projects/p/files/f?inline=1'), {
      actor: {}, services: { async downloadFile() { return { data, size: data.length, mimeType: 'image/svg+xml', previewMimeType: type, name: 'image.svg' }; } },
    });
    assert.equal(headers['content-disposition'].startsWith(type ? 'inline;' : 'attachment;'), true);
    assert.equal(headers['content-type'], type || 'image/svg+xml');
  }
});

test('large JSON body allowance is confined to issue create and edit endpoints', async () => {
  const payload = JSON.stringify({ description: 'x'.repeat(300000) });
  for (const route of ['/api/projects/p/issues', '/api/projects/p/issues/i', '/api/projects/p/assets', '/api/projects/p/issues/i/comments', '/api/projects/p/issues/import/tapd']) {
    const request = Readable.from([payload]); request.headers = { 'content-type': 'application/json' }; request.method = 'POST';
    const result = readApiBody(request, new URL(route, 'http://localhost'));
    if (route.endsWith('/issues') || route.endsWith('/issues/i')) assert.equal((await result).description.length, 300000);
    else await assert.rejects(result, /过大/);
  }
});
