import { useEffect, useState } from 'react';
import { Sparkles, Hash } from 'lucide-react';
import { api } from '../../services/api';

interface CategoryData {
    label: string;
    count: number;
}

interface CategoryProps {
    title: string;
    selected: string | null;
    onSelect: (category: string | null) => void;
}

const GRADIENT_PALETTES = [
    'from-indigo-500/10 to-blue-500/10 border-indigo-200 hover:border-indigo-400',
    'from-emerald-500/10 to-teal-500/10 border-emerald-200 hover:border-emerald-400',
    'from-amber-500/10 to-orange-500/10 border-amber-200 hover:border-amber-400',
    'from-rose-500/10 to-pink-500/10 border-rose-200 hover:border-rose-400',
    'from-violet-500/10 to-purple-500/10 border-violet-200 hover:border-violet-400',
    'from-cyan-500/10 to-sky-500/10 border-cyan-200 hover:border-cyan-400',
    'from-lime-500/10 to-green-500/10 border-lime-200 hover:border-lime-400',
    'from-fuchsia-500/10 to-pink-500/10 border-fuchsia-200 hover:border-fuchsia-400',
];

const ACTIVE_PALETTES = [
    'from-indigo-500 to-blue-600 border-indigo-600 text-white shadow-lg shadow-indigo-200',
    'from-emerald-500 to-teal-600 border-emerald-600 text-white shadow-lg shadow-emerald-200',
    'from-amber-500 to-orange-600 border-amber-600 text-white shadow-lg shadow-amber-200',
    'from-rose-500 to-pink-600 border-rose-600 text-white shadow-lg shadow-rose-200',
    'from-violet-500 to-purple-600 border-violet-600 text-white shadow-lg shadow-violet-200',
    'from-cyan-500 to-sky-600 border-cyan-600 text-white shadow-lg shadow-sky-200',
    'from-lime-500 to-green-600 border-lime-600 text-white shadow-lg shadow-lime-200',
    'from-fuchsia-500 to-pink-600 border-fuchsia-600 text-white shadow-lg shadow-fuchsia-200',
];

export function CategoryRail({ title, selected, onSelect }: CategoryProps) {
    const [categories, setCategories] = useState<CategoryData[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchCategories() {
            try {
                const response = await api.get<{ categories: CategoryData[] }>('/analysis/discover/categories');
                if (response && response.categories) {
                    setCategories(response.categories);
                }
            } catch (err) {
                console.error('Failed to load categories:', err);
            } finally {
                setLoading(false);
            }
        }
        void fetchCategories();
        const interval = setInterval(fetchCategories, 120000);
        return () => clearInterval(interval);
    }, []);

    const handleClick = (label: string) => {
        onSelect(selected === label ? null : label);
    };

    return (
        <div className="mb-2">
            <div className="flex items-center space-x-2 mb-4">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">{title}</h3>
                {selected && (
                    <button
                        onClick={() => onSelect(null)}
                        className="ml-2 text-xs text-gray-400 hover:text-gray-600 transition-colors underline"
                    >
                        Clear filter
                    </button>
                )}
            </div>
            <div className="flex space-x-3 overflow-x-auto pb-3 scrollbar-hide">
                {loading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="flex-shrink-0 w-44 h-24 bg-gray-100 rounded-xl animate-pulse" />
                    ))
                ) : categories.length > 0 ? (
                    categories.map((cat, index) => {
                        const isActive = selected === cat.label;
                        const palette = isActive
                            ? ACTIVE_PALETTES[index % ACTIVE_PALETTES.length]
                            : GRADIENT_PALETTES[index % GRADIENT_PALETTES.length];

                        return (
                            <button
                                key={cat.label}
                                onClick={() => handleClick(cat.label)}
                                className={`flex-shrink-0 w-44 h-24 bg-gradient-to-br ${palette} border rounded-xl p-4 flex flex-col justify-between transition-all duration-200 cursor-pointer ${
                                    isActive ? 'scale-[1.03]' : 'hover:shadow-md hover:-translate-y-1'
                                }`}
                            >
                                <Hash className={`w-4 h-4 ${isActive ? 'text-white/80' : 'text-gray-400'}`} />
                                <div className="text-left">
                                    <span className={`text-sm font-semibold leading-tight ${isActive ? 'text-white' : 'text-gray-900'}`}>
                                        {cat.label}
                                    </span>
                                    <p className={`text-xs mt-0.5 ${isActive ? 'text-white/70' : 'text-gray-400'}`}>
                                        {cat.count} items
                                    </p>
                                </div>
                            </button>
                        );
                    })
                ) : (
                    <div className="flex-shrink-0 w-full h-24 border border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-500 text-sm">
                        No active categories
                    </div>
                )}
            </div>
        </div>
    );
}
