import { useState } from 'react';
import { Navbar } from '../components/Navbar';
import { OrganicFeed } from '../components/discover/OrganicFeed';
import { CategoryRail } from '../components/discover/CategoryRail';
import { SponsoredModule } from '../components/discover/SponsoredModule';
import { Globe, Monitor } from 'lucide-react';

export function Discover() {
    const [region, setRegion] = useState('Global');
    const [platform, setPlatform] = useState('All Platforms');
    const [category, setCategory] = useState<string | null>(null);

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />
            
            <div className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 space-y-4 md:space-y-0">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Observatory Discovery</h1>
                        <p className="text-gray-600 mt-1">Independent recommendation intelligence across platforms.</p>
                    </div>
                    
                    {/* Selectors */}
                    <div className="flex space-x-3">
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Globe className="h-4 w-4 text-gray-400" />
                            </div>
                            <select
                                value={region}
                                onChange={(e) => setRegion(e.target.value)}
                                className="pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none shadow-sm cursor-pointer hover:bg-gray-50 transition-colors appearance-none"
                            >
                                <option value="Global">Global</option>
                                <option value="US">United States</option>
                                <option value="UK">United Kingdom</option>
                                <option value="India">India</option>
                            </select>
                        </div>
                        
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Monitor className="h-4 w-4 text-gray-400" />
                            </div>
                            <select
                                value={platform}
                                onChange={(e) => setPlatform(e.target.value)}
                                className="pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none shadow-sm cursor-pointer hover:bg-gray-50 transition-colors appearance-none"
                            >
                                <option value="All Platforms">All Platforms</option>
                                <option value="youtube">YouTube</option>
                                <option value="tiktok">TikTok</option>
                                <option value="reddit">Reddit</option>
                                <option value="instagram">Instagram</option>
                                <option value="twitter">Twitter</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    
                    {/* Main Content: Organic Truth Surface */}
                    <div className="lg:col-span-8 space-y-8">
                        <CategoryRail 
                            title="Trending Contexts" 
                            selected={category}
                            onSelect={setCategory}
                        />
                        
                        <OrganicFeed platform={platform} category={category} />
                    </div>
                    
                    {/* Right Rail: Adjacent Commercial Layer */}
                    <div className="lg:col-span-4">
                        <div className="sticky top-24">
                            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Adjacent Intelligence</h3>
                            
                            <SponsoredModule 
                                type="insight"
                                title="Creator Economy 2026 Forecast"
                                description="Deep dive into cross-platform bridging behavior powered by aggregate observatory patterns."
                                ctaText="Read the Briefing"
                            />
                            
                            <SponsoredModule 
                                type="campaign"
                                title="Brand Affinity: Tech Sector"
                                description="Cohorts overlapping with React and AI Agent videos are currently under-served."
                                ctaText="View Opportunities"
                            />
                            
                            <div className="mt-8 p-5 bg-white border border-gray-200 rounded-xl shadow-sm text-center">
                                <h4 className="text-sm font-bold text-gray-900 mb-2">Want to sponsor a module?</h4>
                                <p className="text-xs text-gray-500 mb-4">
                                    Reach researchers, creators, and analysts directly. Sponsored modules are excluded from our ranking algorithms.
                                </p>
                                <button className="w-full py-2 px-4 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                                    Contact Partnerships
                                </button>
                            </div>
                        </div>
                    </div>
                    
                </div>
            </div>
        </div>
    );
}
