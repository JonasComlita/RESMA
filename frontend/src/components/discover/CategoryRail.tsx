

interface CategoryProps {
    title: string;
    items: string[];
}

export function CategoryRail({ title, items }: CategoryProps) {
    return (
        <div className="mb-8">
            <h3 className="text-sm font-bold text-gray-900 mb-4 uppercase tracking-wider">{title}</h3>
            <div className="flex space-x-4 overflow-x-auto pb-4 scrollbar-hide">
                {items.length > 0 ? (
                    items.map((item, index) => (
                        <div 
                            key={index} 
                            className="flex-shrink-0 w-48 h-32 bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl p-4 flex flex-col justify-end hover:shadow-md transition-shadow cursor-pointer hover:-translate-y-1 transform duration-200"
                        >
                            <span className="font-semibold text-indigo-900">{item}</span>
                        </div>
                    ))
                ) : (
                    <div className="flex-shrink-0 w-full h-32 border border-dashed border-gray-200 rounded-xl flex items-center justify-center text-gray-500 text-sm">
                        No active categories
                    </div>
                )}
            </div>
        </div>
    );
}
