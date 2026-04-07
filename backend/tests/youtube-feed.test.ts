import request from 'supertest';
import app from '../src/index';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';
import { describe, expect, it } from 'vitest';

function makeAuthToken() {
  return jwt.sign({ userId: 'test-user' }, config.jwt.secret);
}

describe('YouTube Feed API', () => {
  it('should require auth', async () => {
    const res = await request(app)
      .post('/youtube/feed')
      .send({ feed: [{ videoId: 'abc123' }] });
    expect(res.status).toBe(401);
    expect(String(res.body.error)).toMatch(/Authorization token required|Invalid or expired token/);
  });

  it('should reject invalid feed envelope', async () => {
    const res = await request(app)
      .post('/youtube/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ feed: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation|Invalid feed data/);
  });

  it('should reject payloads that fail @resma/shared contract validation', async () => {
    const res = await request(app)
      .post('/youtube/feed')
      .set('Authorization', `Bearer ${makeAuthToken()}`)
      .send({ feed: [{ title: 'Missing videoId' }] });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Payload failed contract validation/);
  });
});
