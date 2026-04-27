import React, { useEffect, useState } from 'react';
import { CURRENT_INGEST_VERSION, CURRENT_OBSERVER_VERSIONS } from '@resma/shared';

interface CaptureStatus {
    isCapturing: boolean;
    itemCount: number;
}

const Popup: React.FC = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [authMessage, setAuthMessage] = useState('');
    const [platform, setPlatform] = useState<'tiktok' | 'twitter' | 'youtube' | 'instagram' | 'reddit' | null>(null);
    const [captureStatus, setCaptureStatus] = useState<CaptureStatus>({
        isCapturing: false,
        itemCount: 0,
    });
    const [message, setMessage] = useState('');

    useEffect(() => {
        // Check auth status
        chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, (response) => {
            setIsAuthenticated(response?.isAuthenticated || false);
            setAuthMessage(response?.isAuthenticated ? '' : (response?.message || ''));
        });

        // Detect platform (TikTok, Twitter, YouTube, Instagram, Reddit)
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const url = tabs[0]?.url || '';
            if (url.includes('tiktok.com')) {
                setPlatform('tiktok');
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
                        if (!response) return;
                        setCaptureStatus({
                            isCapturing: Boolean(response.isCapturing),
                            itemCount: Number(response.itemCount ?? response.videoCount ?? 0),
                        });
                    });
                }
            } else if (url.includes('twitter.com')) {
                setPlatform('twitter');
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
                        if (!response) return;
                        setCaptureStatus({
                            isCapturing: Boolean(response.isCapturing),
                            itemCount: Number(response.itemCount ?? response.videoCount ?? 0),
                        });
                    });
                }
            } else if (url.includes('youtube.com')) {
                setPlatform('youtube');
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
                        if (!response) return;
                        setCaptureStatus({
                            isCapturing: Boolean(response.isCapturing),
                            itemCount: Number(response.itemCount ?? response.videoCount ?? 0),
                        });
                    });
                }
            } else if (url.includes('instagram.com')) {
                setPlatform('instagram');
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
                        if (!response) return;
                        setCaptureStatus({
                            isCapturing: Boolean(response.isCapturing),
                            itemCount: Number(response.itemCount ?? response.videoCount ?? 0),
                        });
                    });
                }
            } else if (url.includes('www.reddit.com')) {
                setPlatform('reddit');
                if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
                        if (!response) return;
                        setCaptureStatus({
                            isCapturing: Boolean(response.isCapturing),
                            itemCount: Number(response.itemCount ?? response.videoCount ?? 0),
                        });
                    });
                }
            } else {
                setPlatform(null);
            }
        });
    }, []);

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
                    if (platform === 'tiktok') msg = `Contributed ${capturedCount} videos to the observatory.`;
                    else if (platform === 'twitter') msg = `Contributed ${capturedCount} tweets to the observatory.`;
                    else if (platform === 'youtube') msg = `Contributed ${capturedCount} YouTube items to the observatory.`;
                    else if (platform === 'instagram') msg = `Contributed ${capturedCount} Instagram items to the observatory.`;
                    else if (platform === 'reddit') msg = `Contributed ${capturedCount} Reddit posts to the observatory.`;
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
            </header>

            <main className="popup-content">
                <div className="privacy-message">
                    <strong>Privacy First:</strong> RESMA only uploads feed data when you press Start Capture. Participation stays optional, you can stop at any time, and uploads stay pseudonymous while powering aggregate recommendation insights.
                </div>
                {!isAuthenticated ? (
                    <div className="auth-prompt">
                        {authMessage && <p>{authMessage}</p>}
                        <p>Create or sign in to a contributor account in the RESMA Dashboard to use this extension.</p>
                        <a
                            href="http://localhost:5173/login"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary"
                        >
                            Open Contributor Login
                        </a>
                    </div>
                ) : !platform ? (
                    <div className="platform-prompt">
                        <p>Navigate to TikTok, Twitter, YouTube, Instagram, or Reddit to contribute recommendation data to the observatory.</p>
                        <a
                            href="https://www.tiktok.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                        >
                            Open TikTok
                        </a>
                        <a
                            href="https://twitter.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                        >
                            Open Twitter
                        </a>
                        <a
                            href="https://www.youtube.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                        >
                            Open YouTube
                        </a>
                        <a
                            href="https://www.instagram.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                        >
                            Open Instagram
                        </a>
                        <a
                            href="https://www.reddit.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                        >
                            Open Reddit
                        </a>
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
                                `Start Capture (${platform.charAt(0).toUpperCase() + platform.slice(1)})`
                            )}
                        </button>

                        {captureStatus.isCapturing && (
                            <p className="capture-status">
                                Contributed: <strong>{captureStatus.itemCount}</strong> {
                                    platform === 'tiktok' ? 'videos' :
                                        platform === 'twitter' ? 'tweets' :
                                            platform === 'youtube' ? 'YouTube videos' :
                                                platform === 'instagram' ? 'Instagram posts' :
                                                    platform === 'reddit' ? 'Reddit posts' : ''
                                }
                            </p>
                        )}

                        {message && <p className="message">{message}</p>}
                    </div>
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
