import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/index';
import { config } from '../src/config';
import { describe, expect, it } from 'vitest';

function makeAuthToken() {
  return jwt.sign({ userId: 'test-user' }, config.jwt.secret);
}

describe('Ingestion gateway auth and contract baselines', () => {
  it.each(['/feeds', '/instagram/feed'])('requires auth on %s', async (path) => {
    const payload = path === '/feeds'
      ? { platform: 'tiktok', feed: [{ videoId: 'abc123' }], sessionMetadata: {} }
      : { feed: [{ videoId: 'abc123' }], sessionMetadata: {} };

    const res = await request(app)
      .post(path)
      .send(payload);

    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/Authorization token required|Invalid or expired token/);
  });

  it('rejects /feeds payloads that fail @resma/shared contract validation', async () => {
    const res = await request(app)
      .post('/feeds')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        platform: 'tiktok',
        feed: [{ videoId: '' }],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation|Video ID required/);
  });

  it('rejects /feeds payloads with unsupported explicit platform', async () => {
    const res = await request(app)
      .post('/feeds')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        platform: 'myspace',
        feed: [{ videoId: 'abc123' }],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });

  it('rejects /youtube/feed payloads that contain partially invalid feed rows', async () => {
    const res = await request(app)
      .post('/youtube/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        feed: [
          { videoId: 'abc123xyz78', title: 'valid row' },
          { title: 'missing id row' },
        ],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });

  it('rejects /instagram/feed payloads that fail @resma/shared contract validation', async () => {
    const res = await request(app)
      .post('/instagram/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        feed: [{ caption: 'Missing videoId' }],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });

  it('rejects /instagram/feed payloads that contain partially invalid feed rows', async () => {
    const res = await request(app)
      .post('/instagram/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({
        feed: [
          { videoId: 'C9xAbCdEf12', caption: 'valid row' },
          { caption: 'missing id row' },
        ],
        sessionMetadata: {},
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });
});
