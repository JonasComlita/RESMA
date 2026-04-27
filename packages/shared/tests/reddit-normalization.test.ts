import { describe, expect, it } from 'vitest';
import { normalizeRedditPostId, normalizeSubredditName } from '../src/index';

describe('Reddit normalization', () => {
    describe('normalizeRedditPostId', () => {
        it('extracts post slugs from full Reddit URLs', () => {
            expect(normalizeRedditPostId('https://www.reddit.com/r/programming/comments/abc123/post_title/'))
                .toBe('abc123');
        });

        it('strips Reddit fullname prefixes', () => {
            expect(normalizeRedditPostId('t3_abc123')).toBe('abc123');
        });

        it('passes through bare slugs', () => {
            expect(normalizeRedditPostId('abc123')).toBe('abc123');
        });

        it('rejects invalid post IDs', () => {
            expect(normalizeRedditPostId(null)).toBeNull();
            expect(normalizeRedditPostId('')).toBeNull();
            expect(normalizeRedditPostId('abcdefghijk')).toBeNull();
            expect(normalizeRedditPostId('abc_123')).toBeNull();
            expect(normalizeRedditPostId('https://www.reddit.com/r/programming/post_title/')).toBeNull();
        });
    });

    describe('normalizeSubredditName', () => {
        it('strips r/ prefixes', () => {
            expect(normalizeSubredditName('r/programming')).toBe('programming');
            expect(normalizeSubredditName('/r/programming')).toBe('programming');
        });

        it('passes through subreddit names without prefixes', () => {
            expect(normalizeSubredditName('programming')).toBe('programming');
        });

        it('rejects invalid subreddit names', () => {
            expect(normalizeSubredditName(null)).toBeNull();
            expect(normalizeSubredditName('')).toBeNull();
            expect(normalizeSubredditName('a')).toBeNull();
            expect(normalizeSubredditName('this_name_is_way_too_long')).toBeNull();
            expect(normalizeSubredditName('bad-name')).toBeNull();
            expect(normalizeSubredditName('bad/name')).toBeNull();
        });
    });
});
