import { useQuery } from '@tanstack/react-query';

export default function Dashboard() {
    const { data: feedsData, isLoading } = useQuery({
        queryKey: ['myFeeds'],
        queryFn: async () => {
            const token = localStorage.getItem('token');
            if (!token) return null;

            const res = await fetch('/api/feeds', {
                headers: { Authorization: `Bearer ${token}` },
            });
            return res.json();
        },
    });

    const feeds = feedsData?.data?.snapshots || [];
    const isAuthenticated = !!localStorage.getItem('token');

    if (!isAuthenticated) {
        return (
            <section className="section">
                <div className="container" style={{ textAlign: 'center' }}>
                    <h1 style={{ marginBottom: 'var(--spacing-4)' }}>Your Dashboard</h1>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-6)' }}>
                        Please log in to view your captured feeds and analysis.
                    </p>
                    <a href="/login" className="btn btn-primary">
                        Log In
                    </a>
                </div>
            </section>
        );
    }

    return (
        <section className="section">
            <div className="container">
                <h1 style={{ marginBottom: 'var(--spacing-8)' }}>Your Dashboard</h1>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--spacing-4)', marginBottom: 'var(--spacing-8)' }}>
                    <div className="stat-card">
                        <div className="stat-value">{feeds.length}</div>
                        <div className="stat-label">Feed Snapshots</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">
                            {feeds.reduce((acc: number, f: any) => acc + (f._count?.feedItems || 0), 0)}
                        </div>
                        <div className="stat-label">Videos Captured</div>
                    </div>
                </div>

                <h2 style={{ marginBottom: 'var(--spacing-4)' }}>Your Feed Snapshots</h2>

                {isLoading ? (
                    <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
                ) : feeds.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-8)' }}>
                        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-4)' }}>
                            No feed snapshots yet. Install the browser extension and capture your first feed!
                        </p>
                        <button className="btn btn-primary">Get Extension</button>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
                        {feeds.map((feed: any) => (
                            <div key={feed.id} className="card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <h3 style={{ fontSize: 'var(--font-size-lg)' }}>
                                            {new Date(feed.capturedAt).toLocaleDateString('en-US', {
                                                weekday: 'long',
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric',
                                            })}
                                        </h3>
                                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                                            {feed._count?.feedItems || 0} videos • {feed.platform}
                                        </p>
                                    </div>
                                    <button className="btn btn-secondary">View Details</button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
