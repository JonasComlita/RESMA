import { describe, expect, it, vi, afterEach } from 'vitest';

type ChromeListener = (message: any, sender: any, sendResponse: (response: any) => void) => boolean | void;

function stubObserverGlobals() {
    const listeners: ChromeListener[] = [];

    vi.stubGlobal('chrome', {
        runtime: {
            onMessage: {
                addListener: (listener: ChromeListener) => {
                    listeners.push(listener);
                },
            },
            sendMessage: vi.fn(),
            lastError: null,
        },
    });
    vi.stubGlobal('document', {
        hidden: false,
        addEventListener: vi.fn(),
        querySelector: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
        body: {},
        documentElement: {
            clientHeight: 900,
            clientWidth: 1440,
        },
    });
    vi.stubGlobal('window', {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        innerHeight: 900,
        innerWidth: 1440,
        setInterval: vi.fn(),
        clearInterval: vi.fn(),
    });
    vi.stubGlobal('MutationObserver', class {
        constructor(_callback: (mutations: any[]) => void) {}

        observe = vi.fn();
        disconnect = vi.fn();
        takeRecords = vi.fn(() => []);
    });
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('parseEngagementCount', () => {
    it.each([
        ['1.2M', 1_200_000],
        ['1,2M', 1_200_000],
        ['12,345', 12_345],
        ['4.5K', 4_500],
        ['1B', 1_000_000_000],
        ['1万', 10_000],
        ['invalid', 0],
        ['', 0],
        ['0', 0],
    ])('parses %s as %i', async (rawText, expected) => {
        stubObserverGlobals();
        const { parseEngagementCount } = await import('../src/content/tiktok-observer.ts');

        expect(parseEngagementCount(rawText)).toBe(expected);
    });
});
