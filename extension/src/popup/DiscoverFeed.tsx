import React, { useEffect, useState } from 'react';

interface FeedItem {
    id: string;
    title: string | null;
    creator: string;
    platform: string;
    reachMetrics: string;
    url?: string;
}

const DiscoverFeed: React.FC = () => {
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [platform, setPlatform] = useState('All Platforms');
    const [region, setRegion] = useState('Global');

    const fetchFeed = async () => {
        setLoading(true);
        try {
            // Get API URL from storage or fallback
            const storage = await chrome.storage.local.get('apiUrl');
            const apiBaseUrl = storage.apiUrl || 'http://localhost:3001'; 
            
            const params = new URLSearchParams();
            if (platform !== 'All Platforms') params.append('platform', platform.toLowerCase());
            
            const response = await fetch(`${apiBaseUrl}/analysis/discover/popular?${params.toString()}`);
            const data = await response.json();
            if (data && data.feed) {
                setFeed(data.feed);
            }
        } catch (err) {
            console.error('Failed to fetch popular feed:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFeed();
    }, [platform]);

    return (
        <div className="discover-feed-container">
            <div className="filter-bar">
                <select 
                    className="filter-select"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value)}
                >
                    <option>All Platforms</option>
                    <option>YouTube</option>
                    <option>TikTok</option>
                    <option>Instagram</option>
                    <option>Twitter</option>
                    <option>Reddit</option>
                </select>
                <select 
                    className="filter-select"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                >
                    <option>Global</option>
                    <option>US</option>
                    <option>UK</option>
                    <option>India</option>
                </select>
            </div>

            <div className="discover-feed">
                {loading ? (
                    <div className="loading-container">
                        <div className="spinner"></div>
                        <p>Loading intelligence...</p>
                    </div>
                ) : feed.length > 0 ? (
                    feed.map((item) => (
                        <a 
                            key={item.id} 
                            href={item.url || '#'} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="feed-item"
                        >
                            <div className="feed-item-header">
                                <span className="platform-tag">{item.platform}</span>
                                <span className="reach-tag">{item.reachMetrics}</span>
                            </div>
                            <div className="feed-item-title">{item.title || 'Untitled'}</div>
                            <div className="feed-item-creator">
                                {item.platform === 'tiktok' ? `@${item.creator.replace(/^@/, '')}` : `by ${item.creator}`}
                            </div>
                        </a>
                    ))
                ) : (
                    <div className="loading-container">
                        <p>No content surfacing yet.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DiscoverFeed;
