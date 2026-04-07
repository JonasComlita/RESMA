import React, { useEffect, useState } from 'react';

interface CaptureStatus {
    isCapturing: boolean;
    itemCount: number;
}

const Popup: React.FC = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [platform, setPlatform] = useState<'tiktok' | 'twitter' | 'youtube' | 'instagram' | null>(null);
    const [captureStatus, setCaptureStatus] = useState<CaptureStatus>({
        isCapturing: false,
        itemCount: 0,
    });
    const [message, setMessage] = useState('');

    useEffect(() => {
        // Check auth status
        chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, (response) => {
            setIsAuthenticated(response?.isAuthenticated || false);
        });

        // Detect platform (TikTok, Twitter, YouTube, Instagram)
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
                                    observerVersion: 'tiktok-observer-v2',
                                    ingestVersion: 'cross-platform-v1',
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
                    if (platform === 'tiktok') msg = `Captured ${capturedCount} videos!`;
                    else if (platform === 'twitter') msg = `Captured ${capturedCount} tweets!`;
                    else if (platform === 'youtube') msg = `Captured ${capturedCount} YouTube items!`;
                    else if (platform === 'instagram') msg = `Captured ${capturedCount} Instagram items!`;
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
                <p>Algorithm Transparency</p>
            </header>

            <main className="popup-content">
                <div className="privacy-message">
                    <strong>Privacy First:</strong> Feed capture is always optional and opt-in. No data is collected unless you explicitly start a session. You control what is shared, and all data is anonymized.
                </div>
                {!isAuthenticated ? (
                    <div className="auth-prompt">
                        <p>Please log in at the RESMA Dashboard to use this extension.</p>
                        <a
                            href="http://localhost:5173/login"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary"
                        >
                            Open Dashboard
                        </a>
                    </div>
                ) : !platform ? (
                    <div className="platform-prompt">
                        <p>Navigate to TikTok, Twitter, YouTube, or Instagram to start capturing your feed.</p>
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
                                Captured: <strong>{captureStatus.itemCount}</strong> {
                                    platform === 'tiktok' ? 'videos' :
                                        platform === 'twitter' ? 'tweets' :
                                            platform === 'youtube' ? 'YouTube videos' :
                                                platform === 'instagram' ? 'Instagram posts' : ''
                                }
                            </p>
                        )}

                        {message && <p className="message">{message}</p>}
                    </div>
                )}
            </main>

            <footer className="popup-footer">
                <a href="http://localhost:5173" target="_blank" rel="noopener noreferrer">
                    View Dashboard
                </a>
            </footer>
        </div>
    );
};

export default Popup;
