import React, { useEffect, useState } from 'react';
import { CURRENT_INGEST_VERSION, CURRENT_OBSERVER_VERSIONS } from '@resma/shared';
import DiscoverFeed from './DiscoverFeed';

interface CaptureStatus {
    isCapturing: boolean;
    itemCount: number;
}

const Popup: React.FC = () => {
    const [view, setView] = useState<'capture' | 'discover'>('capture');
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [authMessage, setAuthMessage] = useState('');
    const [platform, setPlatform] = useState<'tiktok' | 'twitter' | 'youtube' | 'instagram' | 'reddit' | null>(null);
    const [captureStatus, setCaptureStatus] = useState<CaptureStatus>({
        isCapturing: false,
        itemCount: 0,
    });
    const [message, setMessage] = useState('');

    useEffect(() => {
        // Load theme from storage
        chrome.storage.local.get('theme', (result) => {
            if (result.theme) {
                setTheme(result.theme);
                document.body.setAttribute('data-theme', result.theme);
            } else {
                document.body.setAttribute('data-theme', 'dark');
            }
        });

        // Check auth status
        chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, (response) => {
            setIsAuthenticated(response?.isAuthenticated || false);
            setAuthMessage(response?.isAuthenticated ? '' : (response?.message || ''));
        });

        // Detect platform
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const url = tabs[0]?.url || '';
            let detectedPlatform: 'tiktok' | 'twitter' | 'youtube' | 'instagram' | 'reddit' | null = null;
            
            if (url.includes('tiktok.com')) detectedPlatform = 'tiktok';
            else if (url.includes('twitter.com') || url.includes('x.com')) detectedPlatform = 'twitter';
            else if (url.includes('youtube.com')) detectedPlatform = 'youtube';
            else if (url.includes('instagram.com')) detectedPlatform = 'instagram';
            else if (url.includes('reddit.com')) detectedPlatform = 'reddit';

            if (detectedPlatform) {
                setPlatform(detectedPlatform);
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
                        if (!response) return;
                        setCaptureStatus({
                            isCapturing: Boolean(response.isCapturing),
                            itemCount: Number(response.itemCount ?? response.videoCount ?? 0),
                        });
                    });
                }
            }
        });
    }, []);

    const toggleTheme = () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        document.body.setAttribute('data-theme', newTheme);
        chrome.storage.local.set({ theme: newTheme });
    };

    const toggleCapture = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab.id || !platform) return;

        const messageType = captureStatus.isCapturing ? 'STOP_CAPTURE' : 'START_CAPTURE';

        chrome.tabs.sendMessage(tab.id, { type: messageType }, (response) => {
            if (response?.success) {
                setCaptureStatus((prev) => ({
                    ...prev,
                    isCapturing: !prev.isCapturing,
                    itemCount: typeof response?.data?.itemCount === 'number'
                        ? response.data.itemCount
                        : prev.itemCount,
                }));

                if (messageType === 'STOP_CAPTURE' && response.data) {
                    if (platform === 'tiktok' && Array.isArray(response.data.videos)) {
                        const feed = response.data.videos.map((video: any, index: number) => ({
                            videoId: video.videoId,
                            creatorHandle: video.creatorHandle,
                            creatorId: video.creatorId,
                            caption: video.caption,
                            musicTitle: video.musicTitle,
                            positionInFeed: index,
                            watchDuration: video.analytics?.watchedSeconds ?? 0,
                            interacted: Boolean(video.analytics?.interaction?.liked || video.analytics?.interaction?.shared || video.analytics?.interaction?.commented),
                            engagementMetrics: {
                                ...video.engagement,
                                analytics: video.analytics,
                                isSponsored: Boolean(video.isSponsored),
                                recommendations: Array.isArray(video.recommendations) ? video.recommendations : [],
                            },
                            recommendations: Array.isArray(video.recommendations) ? video.recommendations : [],
                            contentCategories: ['for-you'],
                            contentTags: video.isSponsored ? ['sponsored'] : [],
                        }));

                        chrome.runtime.sendMessage({
                            type: 'UPLOAD_PLATFORM_FEED',
                            payload: {
                                platform: 'tiktok',
                                feed,
                                sessionMetadata: {
                                    type: 'MANUAL_CAPTURE_SESSION',
                                    captureSurface: 'for-you-feed',
                                    clientSessionId: response.data.sessionId ?? null,
                                    observerVersion: CURRENT_OBSERVER_VERSIONS.tiktok,
                                    ingestVersion: CURRENT_INGEST_VERSION,
                                    scrollEvents: response.data.scrollEvents ?? 0,
                                    capturedAt: new Date().toISOString(),
                                },
                            },
                        });
                    }

                    const capturedCount = Number(
                        response.data.itemCount
                        ?? response.data.videos?.length
                        ?? response.data.posts?.length
                        ?? 0
                    );
                    let msg = '';
                    if (platform === 'tiktok') msg = `Contributed ${capturedCount} videos.`;
                    else if (platform === 'twitter') msg = `Contributed ${capturedCount} tweets.`;
                    else if (platform === 'youtube') msg = `Contributed ${capturedCount} YouTube items.`;
                    else if (platform === 'instagram') msg = `Contributed ${capturedCount} Instagram items.`;
                    else if (platform === 'reddit') msg = `Contributed ${capturedCount} Reddit posts.`;
                    setMessage(msg);
                    setTimeout(() => setMessage(''), 3000);
                }
            }
        });
    };

    return (
        <div className="popup">
            <header className="popup-header">
                <h1>RESMA</h1>
                <p>Pseudonymous Observatory</p>
                <button className="theme-toggle" onClick={toggleTheme} title="Toggle Theme">
                    {theme === 'dark' ? '☀️' : '🌙'}
                </button>
            </header>

            <div className="tabs">
                <div 
                    className={`tab ${view === 'capture' ? 'active' : ''}`}
                    onClick={() => setView('capture')}
                >
                    Capture
                </div>
                <div 
                    className={`tab ${view === 'discover' ? 'active' : ''}`}
                    onClick={() => setView('discover')}
                >
                    Discover
                </div>
            </div>

            <main className="popup-content">
                {view === 'discover' ? (
                    <DiscoverFeed />
                ) : (
                    <>
                        <div className="privacy-message">
                            <strong>Privacy First:</strong> Feed data is only uploaded when you press Start Capture. Uploads stay pseudonymous.
                        </div>

                        {!isAuthenticated ? (
                            <div className="auth-prompt">
                                {authMessage && <p className="message">{authMessage}</p>}
                                <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '13px' }}>
                                    Sign in to your contributor account in the RESMA Dashboard.
                                </p>
                                <a
                                    href="http://localhost:5173/login"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-primary"
                                    style={{ width: '100%' }}
                                >
                                    Open Dashboard Login
                                </a>
                            </div>
                        ) : !platform ? (
                            <div className="platform-prompt">
                                <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '13px', textAlign: 'center' }}>
                                    Navigate to a supported platform to contribute recommendation data.
                                </p>
                                <a href="https://www.tiktok.com" target="_blank" rel="noopener noreferrer" className="btn btn-secondary">Open TikTok</a>
                                <a href="https://www.youtube.com" target="_blank" rel="noopener noreferrer" className="btn btn-secondary">Open YouTube</a>
                                <a href="https://www.instagram.com" target="_blank" rel="noopener noreferrer" className="btn btn-secondary">Open Instagram</a>
                                <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" className="btn btn-secondary">Open Twitter/X</a>
                            </div>
                        ) : (
                            <div className="capture-controls">
                                <button
                                    onClick={toggleCapture}
                                    className={`btn btn-capture ${captureStatus.isCapturing ? 'capturing' : ''}`}
                                >
                                    {captureStatus.isCapturing ? (
                                        <>
                                            <span className="pulse"></span>
                                            Stop Capture
                                        </>
                                    ) : (
                                        `Start ${platform.charAt(0).toUpperCase() + platform.slice(1)} Capture`
                                    )}
                                </button>

                                {captureStatus.isCapturing && (
                                    <p className="capture-status">
                                        Contributed: <strong>{captureStatus.itemCount}</strong> items
                                    </p>
                                )}

                                {message && <p className="message">{message}</p>}
                            </div>
                        )}
                    </>
                )}
            </main>

            <footer className="popup-footer">
                <a href="http://localhost:5173" target="_blank" rel="noopener noreferrer">
                    Open Observatory Dashboard
                </a>
            </footer>
        </div>
    );
};

export default Popup;
