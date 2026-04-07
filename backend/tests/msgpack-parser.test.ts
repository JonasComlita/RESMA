import express from 'express';
import request from 'supertest';
import { encode } from '@msgpack/msgpack';
import { msgpackParser } from '../src/middleware/msgpackParser';
import { describe, expect, it } from 'vitest';

const MSGPACK_MAGIC = Buffer.from([0x4d, 0x53, 0x47, 0x50]); // "MSGP"

function buildTestApp() {
  const app = express();
  app.use(msgpackParser);
  app.use(express.json());
  app.post('/echo', (req, res) => {
    res.status(200).json({ payload: req.body });
  });
  return app;
}

describe('msgpackParser', () => {
  it('parses extension MessagePack payloads with MSGP magic', async () => {
    const app = buildTestApp();
    const encoded = Buffer.from(encode({ foo: 'bar', count: 2 }));
    const body = Buffer.concat([MSGPACK_MAGIC, encoded]);

    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/x-msgpack')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual({ foo: 'bar', count: 2 });
  });

  it('rejects MessagePack payloads that are missing magic bytes', async () => {
    const app = buildTestApp();

    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/x-msgpack')
      .send(Buffer.from('not-msgpack'));

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/missing magic bytes/i);
  });

  it('falls through to JSON parser for application/json payloads', async () => {
    const app = buildTestApp();

    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send({ fallback: true, value: 42 });

    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual({ fallback: true, value: 42 });
  });
});
