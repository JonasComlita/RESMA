import { Link } from 'react-router-dom';
import { BarChart2 } from 'lucide-react';

export function Navbar() {
    return (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between items-center h-16">
                    <div className="flex items-center">
                        <Link to="/" className="flex items-center space-x-2">
                            <BarChart2 className="w-8 h-8 text-blue-600" />
                            <span className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                                RESMA
                            </span>
                        </Link>
                    </div>
                    <div className="hidden md:flex items-center space-x-8">
                        <a href="#how-it-works" className="text-gray-600 hover:text-gray-900 transition-colors">How it works</a>
                        <a href="#features" className="text-gray-600 hover:text-gray-900 transition-colors">Features</a>
                        <Link to="/login" className="text-gray-600 hover:text-gray-900 transition-colors font-medium">Log in</Link>
                        <a
                            href="#"
                            className="bg-black text-white px-5 py-2.5 rounded-full font-medium hover:bg-gray-800 transition-all transform hover:scale-105"
                        >
                            Add to Browser
                        </a>
                    </div>
                </div>
            </div>
        </nav>
    );
}
