import React from 'react';
import { ArrowRight, Shield, Eye, Database } from 'lucide-react';
import { Navbar } from '../components/Navbar';

export function LandingPage() {
    return (
        <div className="min-h-screen bg-white">
            <Navbar />

            {/* Hero Section */}
            <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center">
                <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-gray-900 mb-8">
                    See what the <br />
                    <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                        algorithm sees.
                    </span>
                </h1>
                <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-12 leading-relaxed">
                    Reverse engineer your social media feeds. Understand why you see what you see,
                    and take back control of your digital diet.
                </p>
                <div className="flex flex-col sm:flex-row justify-center items-center space-y-4 sm:space-y-0 sm:space-x-4">
                    <a href="#" className="w-full sm:w-auto px-8 py-4 bg-black text-white rounded-full font-bold text-lg hover:bg-gray-800 transition-all flex items-center justify-center">
                        Install Extension
                        <ArrowRight className="ml-2 w-5 h-5" />
                    </a>
                    <a href="#demo" className="w-full sm:w-auto px-8 py-4 bg-gray-100 text-gray-900 rounded-full font-bold text-lg hover:bg-gray-200 transition-all">
                        View Live Demo
                    </a>
                </div>
            </section>



            {/* How it Works Section */}
            <section id="how-it-works" className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <h2 className="text-3xl font-bold text-center mb-16">How it works</h2>
                <div className="grid md:grid-cols-3 gap-8 relative">
                    <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-0.5 bg-gray-200 -z-10"></div>

                    <StepCard
                        number="1"
                        title="Install Extension"
                        description="Add our open-source extension to your browser. It runs locally and securely."
                    />
                    <StepCard
                        number="2"
                        title="Browse Normally"
                        description="Use social media as you always do. The extension quietly collects public feed data."
                    />
                    <StepCard
                        number="3"
                        title="Get Insights"
                        description="Visit your dashboard to see visualized data about your algorithm bubble."
                    />
                </div>
            </section>

            {/* Features Grid */}
            <section id="features" className="py-20 bg-gray-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid md:grid-cols-3 gap-12">
                        <FeatureCard
                            icon={<Eye className="w-8 h-8 text-blue-600" />}
                            title="Transparency"
                            description="Visualize your personal algorithm preferences. See which categories and creators are dominating your feed."
                        />
                        <FeatureCard
                            icon={<Database className="w-8 h-8 text-indigo-600" />}
                            title="Data Ownership"
                            description="Your data stays yours. Export your feed history and analyze it with our open-source tools."
                        />
                        <FeatureCard
                            icon={<Shield className="w-8 h-8 text-emerald-600" />}
                            title="Privacy First"
                            description="We only analyze what you publicly view. No password sharing or account access required."
                        />
                    </div>
                </div>
            </section>
        </div>
    );
}

function StepCard({ number, title, description }: { number: string, title: string, description: string }) {
    return (
        <div className="flex flex-col items-center text-center bg-white p-6">
            <div className="w-12 h-12 rounded-full bg-black text-white flex items-center justify-center font-bold text-xl mb-6 shadow-lg transform transition-transform hover:scale-110">
                {number}
            </div>
            <h3 className="text-xl font-bold mb-3">{title}</h3>
            <p className="text-gray-600 max-w-xs">{description}</p>
        </div>
    );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
    return (
        <div className="bg-white p-8 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
            <div className="mb-6 bg-gray-50 w-16 h-16 rounded-xl flex items-center justify-center">
                {icon}
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-3">{title}</h3>
            <p className="text-gray-600 leading-relaxed">
                {description}
            </p>
        </div>
    );
}
