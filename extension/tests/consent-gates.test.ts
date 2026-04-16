import { afterEach, describe, expect, it, vi } from 'vitest';

type ChromeListener = (message: any, sender: any, sendResponse: (response: any) => void) => boolean | void;

class FakeElement {
    private attributes = new Map<string, string>();

    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }

    getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
    }

    matches() {
        return false;
    }

    querySelectorAll() {
        return [];
    }
}

class FakeArticleElement extends FakeElement {
    constructor(private readonly postHref: string) {
        super();
    }

    querySelector(selector: string) {
        if (selector === 'a[href*="/p/"]') {
            return {
                getAttribute: (name: string) => (name === 'href' ? this.postHref : null),
            };
        }

        if (selector === 'header a') {
            return { textContent: 'creator_handle' };
        }

        if (selector === 'h1, h2, span[dir="auto"]') {
            return { textContent: 'Caption text' };
        }

        return null;
    }
}

class FakeHomeFeedItem extends FakeElement {
    querySelector(selector: string) {
        if (selector === '#video-title-link, #video-title') {
            return {
                href: 'https://www.youtube.com/watch?v=home12345',
                textContent: 'Home title',
            };
        }

        if (selector === 'ytd-channel-name') {
            return { textContent: 'Home channel' };
        }

        return null;
    }

    closest(selector: string) {
        if (selector !== 'ytd-rich-section-renderer') {
            return null;
        }

        return {
            querySelector: (innerSelector: string) => (
                innerSelector === '#title' ? { textContent: 'Recommended' } : null
            ),
        };
    }
}

class FakeRecommendationElement extends FakeElement {
    querySelector(selector: string) {
        if (selector === 'a#thumbnail[href], a#video-title-link[href], a[href*="/watch"], a[href*="/shorts/"]') {
            return {
                href: 'https://www.youtube.com/watch?v=reco12345',
                getAttribute: (name: string) => (name === 'title' ? 'Recommended title' : null),
            };
        }

        if (selector === '#video-title') {
            return { textContent: 'Recommended title' };
        }

        if (selector === '.ytd-channel-name') {
            return { textContent: 'Recommended channel' };
        }

        return null;
    }
}

class FakeTweetElement extends FakeElement {
    querySelector(selector: string) {
        if (selector === 'a[href*="/status/"]') {
            return {
                getAttribute: (name: string) => (name === 'href' ? '/creator/status/55555' : null),
            };
        }

        if (selector === 'div[data-testid="User-Name"] a') {
            return {
                getAttribute: (name: string) => (name === 'href' ? '/creator' : null),
                textContent: 'Creator @creator',
            };
        }

        if (selector === 'div[data-testid="tweetText"]') {
            return { textContent: 'Tweet body' };
        }

        if (selector === 'time') {
            return {};
        }

        return null;
    }
}

function stubSharedGlobals() {
    vi.stubGlobal('Element', FakeElement);
    vi.stubGlobal('IntersectionObserver', class {
        constructor(public readonly callback: (entries: any[]) => void) {
            fakeIntersectionObserverCallbacks.push(callback);
        }

        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
    });
    vi.stubGlobal('MutationObserver', class {
        constructor(_callback: (mutations: any[]) => void) {}

        observe = vi.fn();
        disconnect = vi.fn();
        takeRecords = vi.fn(() => []);
    });
}

function stubChrome() {
    const listeners: ChromeListener[] = [];
    const sendMessage = vi.fn((message: any, callback?: (response: any) => void) => {
        callback?.({ success: true, data: { itemCount: 1 } });
        return undefined;
    });

    vi.stubGlobal('chrome', {
        runtime: {
            lastError: null,
            sendMessage,
            onMessage: {
                addListener: (listener: ChromeListener) => {
                    listeners.push(listener);
                },
            },
        },
    });

    return { listeners, sendMessage };
}

function invokeListener(listener: ChromeListener, message: any) {
    return new Promise<any>((resolve) => {
        const maybeAsync = listener(message, {}, (response) => {
            resolve(response);
        });

        if (maybeAsync !== true) {
            resolve(undefined);
        }
    });
}

let fakeIntersectionObserverCallbacks: Array<(entries: any[]) => void> = [];

afterEach(() => {
    fakeIntersectionObserverCallbacks = [];
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('content observer consent gates', () => {
    it('does not upload YouTube homepage data until capture starts', async () => {
        stubSharedGlobals();
        const { listeners, sendMessage } = stubChrome();
        const homeItem = new FakeHomeFeedItem();
        const immediateTimeout = vi.fn((callback: () => void) => {
            callback();
            return 1;
        });

        vi.stubGlobal('setTimeout', immediateTimeout);
        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            setTimeout: immediateTimeout,
        });
        vi.stubGlobal('location', {
            pathname: '/',
            search: '',
            origin: 'https://www.youtube.com',
        });
        vi.stubGlobal('document', {
            querySelector: vi.fn(() => null),
            querySelectorAll: vi.fn((selector: string) => (
                selector === 'ytd-rich-item-renderer' ? [homeItem] : []
            )),
        });

        await import('../src/content/youtube-observer.ts');

        expect(sendMessage).not.toHaveBeenCalled();

        const response = await invokeListener(listeners[0], { type: 'START_CAPTURE' });
        expect(response).toEqual({
            success: true,
            data: {
                itemCount: 1,
            },
        });

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'UPLOAD_PLATFORM_FEED',
            payload: expect.objectContaining({
                platform: 'youtube',
                sessionMetadata: expect.objectContaining({
                    type: 'HOMEPAGE_SNAPSHOT',
                }),
            }),
        }));
    });

    it('preserves YouTube start-stop uploads without any pre-consent upload', async () => {
        stubSharedGlobals();
        const { listeners, sendMessage } = stubChrome();
        const recommendation = new FakeRecommendationElement();
        const immediateTimeout = vi.fn((callback: () => void) => {
            callback();
            return 1;
        });
        const videoElement = {
            duration: 60,
            currentTime: 12,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        };

        vi.stubGlobal('setTimeout', immediateTimeout);
        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            setTimeout: immediateTimeout,
        });
        vi.stubGlobal('location', {
            pathname: '/watch',
            search: '?v=watch12345',
            origin: 'https://www.youtube.com',
        });
        vi.stubGlobal('document', {
            querySelector: vi.fn((selector: string) => {
                if (selector === 'video.html5-main-video') return videoElement;
                if (selector === 'h1.ytd-video-primary-info-renderer') return { textContent: 'Watch title' };
                if (selector === 'ytd-video-owner-renderer #channel-name') return { textContent: 'Watch channel' };
                if (selector === 'ytd-video-owner-renderer a[href^="/@"]') {
                    return { getAttribute: (name: string) => (name === 'href' ? '/@watch_channel' : null) };
                }
                if (selector === 'ytd-video-primary-info-renderer #count') return { textContent: '100 views' };
                if (selector === '#info-strings yt-formatted-string') return { textContent: 'Today' };
                return null;
            }),
            querySelectorAll: vi.fn((selector: string) => (
                selector === 'ytd-watch-next-secondary-results-renderer ytd-compact-video-renderer'
                    ? [recommendation]
                    : []
            )),
        });

        await import('../src/content/youtube-observer.ts');

        expect(sendMessage).not.toHaveBeenCalled();

        await invokeListener(listeners[0], { type: 'START_CAPTURE' });
        const stopResponse = await invokeListener(listeners[0], { type: 'STOP_CAPTURE' });

        expect(stopResponse).toEqual({
            success: true,
            data: {
                itemCount: 1,
            },
        });
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'UPLOAD_PLATFORM_FEED',
            payload: expect.objectContaining({
                platform: 'youtube',
                sessionMetadata: expect.objectContaining({
                    type: 'VIDEO_WATCH',
                    sourceVideoId: 'watch12345',
                }),
            }),
        }));
    });

    it('keeps Instagram idle before consent, then starts periodic uploads only after capture begins', async () => {
        stubSharedGlobals();
        const { listeners, sendMessage } = stubChrome();
        const article = new FakeArticleElement('/p/post12345/');
        const intervalCallbacks: Array<() => void> = [];
        const setIntervalMock = vi.fn((callback: () => void) => {
            intervalCallbacks.push(callback);
            return 101;
        });
        const clearIntervalMock = vi.fn();

        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            innerHeight: 900,
            innerWidth: 1440,
            setInterval: setIntervalMock,
            clearInterval: clearIntervalMock,
        });
        vi.stubGlobal('location', {
            pathname: '/',
            search: '',
            origin: 'https://www.instagram.com',
        });
        vi.stubGlobal('document', {
            body: new FakeElement(),
            documentElement: {
                clientHeight: 900,
                clientWidth: 1440,
            },
            querySelector: vi.fn(() => null),
            querySelectorAll: vi.fn((selector: string) => (
                selector === 'article' ? [article] : []
            )),
        });

        await import('../src/content/instagram-observer.ts');

        fakeIntersectionObserverCallbacks[0]([
            { isIntersecting: true, target: article },
            { isIntersecting: false, target: article },
        ]);

        expect(setIntervalMock).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();

        await invokeListener(listeners[0], { type: 'START_CAPTURE' });
        expect(setIntervalMock).toHaveBeenCalledTimes(1);

        intervalCallbacks[0]();
        await Promise.resolve();
        await Promise.resolve();

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'UPLOAD_PLATFORM_FEED',
                payload: expect.objectContaining({
                    platform: 'instagram',
                    sessionMetadata: expect.objectContaining({
                        type: 'INSTAGRAM_LIGHT_SNAPSHOT',
                    }),
                }),
            }),
            expect.any(Function)
        );

        const stopResponse = await invokeListener(listeners[0], { type: 'STOP_CAPTURE' });
        expect(stopResponse).toEqual({
            success: true,
            data: {
                itemCount: 1,
            },
        });
        expect(clearIntervalMock).toHaveBeenCalledWith(101);
    });

    it('keeps Twitter uploads behind Start Capture as well', async () => {
        stubSharedGlobals();
        const { listeners, sendMessage } = stubChrome();
        const tweet = new FakeTweetElement();
        const intervalCallbacks: Array<() => void> = [];
        const setIntervalMock = vi.fn((callback: () => void) => {
            intervalCallbacks.push(callback);
            return 202;
        });
        const clearIntervalMock = vi.fn();
        let now = 0;

        vi.spyOn(Date, 'now').mockImplementation(() => {
            now += 2000;
            return now;
        });

        vi.stubGlobal('window', {
            setInterval: setIntervalMock,
            clearInterval: clearIntervalMock,
        });
        vi.stubGlobal('location', {
            pathname: '/',
            search: '',
            origin: 'https://twitter.com',
        });
        vi.stubGlobal('document', {
            body: new FakeElement(),
            querySelector: vi.fn(() => null),
            querySelectorAll: vi.fn((selector: string) => (
                selector === 'article[data-testid="tweet"]' ? [tweet] : []
            )),
        });

        await import('../src/content/twitter-observer.ts');

        expect(setIntervalMock).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();

        await invokeListener(listeners[0], { type: 'START_CAPTURE' });
        fakeIntersectionObserverCallbacks[0]([
            { isIntersecting: true, target: tweet },
        ]);

        intervalCallbacks[0]();

        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'UPLOAD_PLATFORM_FEED',
                payload: expect.objectContaining({
                    platform: 'twitter',
                    sessionMetadata: expect.objectContaining({
                        type: 'TIMELINE_BATCH',
                    }),
                }),
            }),
            expect.any(Function)
        );

        const stopResponse = await invokeListener(listeners[0], { type: 'STOP_CAPTURE' });
        expect(stopResponse).toEqual({
            success: true,
            data: {
                itemCount: 1,
            },
        });
        expect(clearIntervalMock).toHaveBeenCalledWith(202);
    });
});
