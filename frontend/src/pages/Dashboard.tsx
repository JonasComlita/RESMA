import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Navbar } from '../components/Navbar';
import { BarChart2, Users, Database, Video } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface GlobalStats {
    totalUsers: number;
    totalSnapshots: number;
    totalFeedItems: number;
    totalCreators: number;
    recentSnapshots: number;
}

export function Dashboard() {
    const { user, isLoading, logout } = useAuth();
    const navigate = useNavigate();
    const [stats, setStats] = useState<GlobalStats | null>(null);

    useEffect(() => {
        if (!isLoading && !user) {
            navigate('/login');
        }
    }, [user, isLoading, navigate]);

    useEffect(() => {
        if (user) {
            api.get<{ stats: GlobalStats }>('/analysis/stats')
                .then(data => setStats(data.stats))
                .catch(console.error);
        }
    }, [user]);

    if (isLoading || !user) {
        return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />
            <div className="pt-24 pb-12 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
                        <p className="text-gray-600">Welcome back, {user.anonymousId}</p>
                    </div>
                    <button
                        onClick={logout}
                        className="text-sm text-gray-500 hover:text-gray-900 underline"
                    >
                        Log out
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
                    <StatCard title="Total Users" value={stats?.totalUsers} icon={<Users className="w-6 h-6 text-white" />} color="bg-blue-500" />
                    <StatCard title="Feed Snapshots" value={stats?.totalSnapshots} icon={<Database className="w-6 h-6 text-white" />} color="bg-green-500" />
                    <StatCard title="Videos Analyzed" value={stats?.totalFeedItems} icon={<Video className="w-6 h-6 text-white" />} color="bg-purple-500" />
                    <StatCard title="Creators Tracked" value={stats?.totalCreators} icon={<BarChart2 className="w-6 h-6 text-white" />} color="bg-orange-500" />
                </div>

                {/* Charts Section */}
                <div className="bg-white p-6 rounded-2xl shadow-sm mb-8">
                    <h2 className="text-xl font-bold text-gray-900 mb-6">Data Overview</h2>
                    <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={[
                                { name: 'Users', value: stats?.totalUsers || 0 },
                                { name: 'Snapshots', value: stats?.totalSnapshots || 0 },
                                { name: 'Videos (x100)', value: (stats?.totalFeedItems || 0) / 100 },
                                { name: 'Creators', value: stats?.totalCreators || 0 },
                            ]}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis />
                                <Tooltip />
                                <Bar dataKey="value" fill="#8884d8" />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ title, value, icon, color }: { title: string, value?: number, icon: React.ReactNode, color: string }) {
    return (
        <div className="bg-white overflow-hidden rounded-xl shadow-sm">
            <div className="p-5">
                <div className="flex items-center">
                    <div className={`flex-shrink-0 rounded-md p-3 ${color}`}>
                        {icon}
                    </div>
                    <div className="ml-5 w-0 flex-1">
                        <dl>
                            <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
                            <dd>
                                <div className="text-2xl font-bold text-gray-900">{value !== undefined ? value.toLocaleString() : '-'}</div>
                            </dd>
                        </dl>
                    </div>
                </div>
            </div>
        </div>
    );
}
