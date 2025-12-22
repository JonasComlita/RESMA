import request from 'supertest';
import app from '../src/index';

describe('YouTube Feed API', () => {
  it('should reject invalid feed data', async () => {
    const res = await request(app)
      .post('/youtube/feed')
      .send({ feed: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid feed data/);
  });

  it('should reject feed items with missing fields', async () => {
    const res = await request(app)
      .post('/youtube/feed')
      .send({ feed: [{ foo: 'bar' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid feed item structure/);
  });

  it('should accept valid feed data', async () => {
    const res = await request(app)
      .post('/youtube/feed')
      .send({ feed: [{ videoId: 'abc123', title: 'Test Video' }] });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/YouTube feed data saved/);
  });
});
