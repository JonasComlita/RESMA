import React, { useEffect, useState } from 'react';

interface FeedItem {
    id: string;
    title: string | null;
    creator: string;
    platform: string;
    reachMetrics: string;
    contentFamily?: string;
    rankingBasis?: string;
    url?: string;
}

interface CategoryData {
    label: string;
    count: number;
}

const DiscoverFeed: React.FC = () => {
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [categories, setCategories] = useState<CategoryData[]>([]);
    const [loading, setLoading] = useState(true);
    const [platform, setPlatform] = useState('All Platforms');
    const [region, setRegion] = useState('Global');
    const [category, setCategory] = useState('All Contexts');

    useEffect(() => {
        const fetchCategories = async () => {
            try {
                const storage = await chrome.storage.local.get('apiUrl');
                const apiBaseUrl = storage.apiUrl || 'http://localhost:3001'; 
                const response = await fetch(`${apiBaseUrl}/analysis/discover/categories`);
                const data = await response.json();
                if (data && data.categories) {
                    setCategories(data.categories);
                }
            } catch (err) {
                console.error('Failed to fetch categories:', err);
            }
        };
        fetchCategories();
    }, []);

    const fetchFeed = async () => {
        setLoading(true);
        try {
            // Get API URL from storage or fallback
            const storage = await chrome.storage.local.get('apiUrl');
            const apiBaseUrl = storage.apiUrl || 'http://localhost:3001'; 
            
            const params = new URLSearchParams();
            if (platform !== 'All Platforms') params.append('platform', platform.toLowerCase());
            if (category !== 'All Contexts') params.append('category', category.toLowerCase().replace(/ /g, '_'));
            
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
    }, [platform, category]);

    return (
        <div className="discover-feed-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div className="filter-bar" style={{ padding: '12px 16px 8px 16px', margin: 0, gap: '6px', overflowX: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>
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
                {categories.length > 0 && (
                    <select 
                        className="filter-select"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                    >
                        <option>All Contexts</option>
                        {categories.map((cat) => (
                            <option key={cat.label} value={cat.label}>{cat.label}</option>
                        ))}
                    </select>
                )}
            </div>

            <div className="discover-feed" style={{ padding: '0 16px 12px 16px', margin: 0 }}>
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
                                <span className="reach-tag">
                                    {platform === 'All Platforms' && item.rankingBasis === 'platform_percentile' && item.contentFamily
                                        ? `${item.reachMetrics} · ${item.contentFamily.replace(/_/g, ' ')}`
                                        : item.reachMetrics}
                                </span>
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
