import { Video, Clock, TrendingUp } from 'lucide-react';

interface FeedItem {
    id: string;
    title: string;
    creator: string;
    platform: 'youtube' | 'tiktok' | 'twitter' | 'instagram';
    timestamp: string;
    reachMetrics: string;
    thumbnailUrl?: string;
}

const mockFeed: FeedItem[] = [
    {
        id: '1',
        title: 'The Future of AI Agents in Engineering',
        creator: 'TechExplorer',
        platform: 'youtube',
        timestamp: '2 hours ago',
        reachMetrics: 'High momentum in Developer cohort'
    },
    {
        id: '2',
        title: 'New React Compiler deep dive',
        creator: 'FrontendDaily',
        platform: 'youtube',
        timestamp: '5 hours ago',
        reachMetrics: 'Surfacing broadly across US regions'
    },
    {
        id: '3',
        title: 'Building a startup in 2026',
        creator: 'FounderVlog',
        platform: 'tiktok',
        timestamp: '1 day ago',
        reachMetrics: 'High engagement bridge content'
    }
];

export function OrganicFeed() {
    return (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100">
            <div className="p-6 border-b border-gray-100">
                <div className="flex items-center space-x-2">
                    <TrendingUp className="w-5 h-5 text-emerald-600" />
                    <h2 className="text-xl font-bold text-gray-900">What's Surfacing Now</h2>
                </div>
                <p className="text-sm text-gray-500 mt-1">Measured observatory data across your selected regions.</p>
            </div>
            
            <div className="divide-y divide-gray-50">
                {mockFeed.length > 0 ? (
                    mockFeed.map(item => (
                        <div key={item.id} className="p-6 hover:bg-gray-50 transition-colors cursor-pointer group">
                            <div className="flex space-x-4">
                                <div className="w-32 h-20 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-gray-200 transition-colors">
                                    <Video className="w-8 h-8 text-gray-400" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{item.platform}</span>
                                        <div className="flex items-center text-xs text-gray-400">
                                            <Clock className="w-3 h-3 mr-1" />
                                            {item.timestamp}
                                        </div>
                                    </div>
                                    <h3 className="font-bold text-gray-900 group-hover:text-blue-600 transition-colors">{item.title}</h3>
                                    <p className="text-sm text-gray-600 mb-2">by {item.creator}</p>
                                    <div className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700">
                                        {item.reachMetrics}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="p-12 text-center">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
                            <Video className="w-6 h-6 text-gray-400" />
                        </div>
                        <h3 className="text-sm font-medium text-gray-900">No content surfacing</h3>
                        <p className="mt-1 text-sm text-gray-500">Check back later or adjust your region filters.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
