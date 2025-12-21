import React, { useEffect, useState } from 'react';

interface CaptureStatus {
    isCapturing: boolean;
    videoCount: number;
}

const Popup: React.FC = () => {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isOnTikTok, setIsOnTikTok] = useState(false);
    const [captureStatus, setCaptureStatus] = useState<CaptureStatus>({
        isCapturing: false,
        videoCount: 0,
    });
    const [message, setMessage] = useState('');

    useEffect(() => {
        // Check auth status
        chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, (response) => {
            setIsAuthenticated(response?.isAuthenticated || false);
        });

        // Check if we're on TikTok
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const url = tabs[0]?.url || '';
            setIsOnTikTok(url.includes('tiktok.com'));

            if (url.includes('tiktok.com') && tabs[0]?.id) {
                chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' }, (response) => {
                    if (response) {
                        setCaptureStatus(response);
                    }
                });
            }
        });
    }, []);

    const toggleCapture = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab.id) return;

        const messageType = captureStatus.isCapturing ? 'STOP_CAPTURE' : 'START_CAPTURE';

        chrome.tabs.sendMessage(tab.id, { type: messageType }, (response) => {
            if (response?.success) {
                setCaptureStatus((prev) => ({
                    ...prev,
                    isCapturing: !prev.isCapturing,
                }));

                if (messageType === 'STOP_CAPTURE' && response.data) {
                    // Upload session
                    chrome.runtime.sendMessage({
                        type: 'UPLOAD_SESSION',
                        data: response.data,
                    });
                    setMessage(`Captured ${response.data.videos.length} videos!`);
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
                {!isAuthenticated ? (
                    <div className="auth-prompt">
                        <p>Please log in at the RESMA forum to use this extension.</p>
                        <a
                            href="http://localhost:5173/login"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-primary"
                        >
                            Open Forum
                        </a>
                    </div>
                ) : !isOnTikTok ? (
                    <div className="tiktok-prompt">
                        <p>Navigate to TikTok to start capturing your feed.</p>
                        <a
                            href="https://www.tiktok.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-secondary"
                        >
                            Open TikTok
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
                                'Start Capture'
                            )}
                        </button>

                        {captureStatus.isCapturing && (
                            <p className="capture-status">
                                Captured: <strong>{captureStatus.videoCount}</strong> videos
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
