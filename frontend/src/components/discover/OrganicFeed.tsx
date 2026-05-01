import { Video, Clock, TrendingUp, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../services/api';

interface FeedItem {
    id: string;
    title: string | null;
    creator: string;
    platform: 'youtube' | 'tiktok' | 'twitter' | 'instagram' | 'reddit';
    timestamp: string;
    reachMetrics: string;
    appearances: number;
    normalizedScore: number;
    rankingBasis: 'platform_percentile' | 'appearances';
    contentFamily: string;
    thumbnailUrl?: string;
    url?: string;
}

interface OrganicFeedProps {
    platform?: string;
    category?: string | null;
}

export function OrganicFeed({ platform = 'All Platforms', category = null }: OrganicFeedProps) {
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchPopular() {
            try {
                const params = new URLSearchParams();
                if (platform && platform !== 'All Platforms') params.set('platform', platform);
                if (category) params.set('category', category);
                const query = params.toString() ? `?${params.toString()}` : '';
                const response = await api.get<{ feed: FeedItem[] }>(`/analysis/discover/popular${query}`);
                if (response && response.feed) {
                    setFeed(response.feed);
                }
            } catch (err) {
                console.error('Failed to load popular feed:', err);
            } finally {
                setLoading(false);
            }
        }
        
        void fetchPopular();
        const interval = setInterval(fetchPopular, 60000); // refresh every minute
        return () => clearInterval(interval);
    }, [platform, category]);

    const formatTimestamp = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <div>
                    <div className="flex items-center space-x-2">
                        <TrendingUp className="w-5 h-5 text-emerald-600" />
                        <h2 className="text-xl font-bold text-gray-900">What's Surfacing Now</h2>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                        {platform === 'All Platforms'
                            ? 'Platform-normalized surfacing from recent observatory captures.'
                            : 'Measured observatory data across your selected regions.'}
                    </p>
                </div>
                {loading && <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />}
            </div>
            
            <div className="divide-y divide-gray-50 max-h-[800px] overflow-y-auto">
                {feed.length > 0 ? (
                    feed.map(item => (
                        <a key={item.id} href={item.url || '#'} target="_blank" rel="noopener noreferrer" className="block p-6 hover:bg-gray-50 transition-colors cursor-pointer group">
                            <div className="flex space-x-4">

                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{item.platform}</span>
                                        <div className="flex items-center text-xs text-gray-400">
                                            <Clock className="w-3 h-3 mr-1" />
                                            {formatTimestamp(item.timestamp)}
                                        </div>
                                    </div>
                                    {item.platform === 'tiktok' ? (
                                        <>
                                            <h3 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">@{item.creator.replace(/^@/, '')}</h3>
                                            {item.title && <p className="text-sm text-gray-600 mb-2 line-clamp-2 mt-1">{item.title}</p>}
                                        </>
                                    ) : (
                                        <>
                                            <h3 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">{item.title || 'Untitled Video'}</h3>
                                            <p className="text-sm text-gray-600 mb-2">by {item.creator}</p>
                                        </>
                                    )}
                                    <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                                        {platform === 'All Platforms' && item.rankingBasis === 'platform_percentile'
                                            ? `${item.reachMetrics} · ${item.contentFamily.replace(/_/g, ' ')}`
                                            : item.reachMetrics}
                                    </div>
                                </div>
                            </div>
                        </a>
                    ))
                ) : !loading ? (
                    <div className="p-12 text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
                            <Video className="w-6 h-6 text-gray-400" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-900">No content surfacing</h3>
                        <p className="mt-1 text-sm text-gray-500">Run the headless orchestrator to capture live data.</p>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
