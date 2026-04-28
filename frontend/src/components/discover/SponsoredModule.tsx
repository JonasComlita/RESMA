import React from 'react';
import { ExternalLink, Info } from 'lucide-react';

interface SponsoredModuleProps {
    type: 'insight' | 'campaign' | 'brands';
    title: string;
    description: string;
    ctaText?: string;
}

export function SponsoredModule({ type, title, description, ctaText }: SponsoredModuleProps) {
    // Determine specific visual cues based on module type, but keep them distinct from organic content
    const styleMap = {
        insight: 'bg-amber-50/50 border-amber-200',
        campaign: 'bg-blue-50/50 border-blue-200',
        brands: 'bg-purple-50/50 border-purple-200'
    };

    const containerStyle = styleMap[type] || 'bg-gray-50/50 border-gray-200';

    return (
        <div className={`rounded-xl border ${containerStyle} p-5 relative overflow-hidden mb-4 shadow-sm hover:shadow-md transition-shadow`}>
            {/* Visual distinction marker */}
            <div className="absolute top-0 right-0 p-2">
                <span className="inline-flex items-center text-[10px] uppercase font-bold tracking-widest text-gray-400 bg-white/60 backdrop-blur-sm px-2 py-1 rounded">
                    Sponsored
                </span>
            </div>
            
            <div className="mt-2">
                <h4 className="font-bold text-gray-900 pr-16">{title}</h4>
                <p className="text-sm text-gray-600 mt-2 leading-relaxed">
                    {description}
                </p>
                
                {ctaText && (
                    <button className="mt-4 inline-flex items-center text-sm font-semibold text-gray-900 hover:text-blue-600 transition-colors group">
                        {ctaText}
                        <ExternalLink className="w-4 h-4 ml-1 opacity-50 group-hover:opacity-100" />
                    </button>
                )}
            </div>
            
            <div className="mt-4 pt-3 border-t border-black/5 flex items-start text-xs text-gray-400">
                <Info className="w-3 h-3 mr-1 flex-shrink-0 mt-0.5" />
                <span>Excluded from observatory metrics</span>
            </div>
        </div>
    );
}
