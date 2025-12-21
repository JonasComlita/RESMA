import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

export default function Home() {
    const { data: stats } = useQuery({
        queryKey: ['stats'],
        queryFn: async () => {
            const res = await fetch('/api/analysis/stats');
            const data = await res.json();
            return data.data.stats;
        },
    });

    return (
        <>
            {/* Hero Section */}
            <section className="hero">
                <div className="container">
                    <div className="hero-content fade-in">
                        <h1 className="hero-title">
                            Understand <span>Your Algorithm</span>
                        </h1>
                        <p className="hero-description">
                            Discover why TikTok shows you certain content. Find users with similar feeds.
                            Creators: see who's discovering your content.
                        </p>
                        <div className="hero-actions">
                            <Link to="/login" className="btn btn-primary btn-lg">
                                Get the Extension
                            </Link>
                            <Link to="/creators" className="btn btn-secondary btn-lg">
                                For Creators
                            </Link>
                        </div>
                    </div>

                    {/* Stats */}
                    <div className="stats-grid">
                        <div className="stat-card">
                            <div className="stat-value">{stats?.totalUsers || '0'}</div>
                            <div className="stat-label">Users</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{stats?.totalSnapshots || '0'}</div>
                            <div className="stat-label">Feeds Analyzed</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{stats?.totalFeedItems || '0'}</div>
                            <div className="stat-label">Videos Captured</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-value">{stats?.totalCreators || '0'}</div>
                            <div className="stat-label">Verified Creators</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Features */}
            <section className="section">
                <div className="container">
                    <h2 style={{ textAlign: 'center', marginBottom: 'var(--spacing-12)', fontSize: 'var(--font-size-3xl)' }}>
                        How It Works
                    </h2>
                    <div className="features-grid">
                        <div className="card feature-card">
                            <div className="feature-icon">📱</div>
                            <h3 className="card-title">Capture Your Feed</h3>
                            <p className="card-description">
                                Install our browser extension and capture your TikTok feed with one click.
                                All data is anonymized.
                            </p>
                        </div>
                        <div className="card feature-card">
                            <div className="feature-icon">🔍</div>
                            <h3 className="card-title">Understand Why</h3>
                            <p className="card-description">
                                See exactly why each video appears in your feed. Discover your content
                                preferences and creator affinities.
                            </p>
                        </div>
                        <div className="card feature-card">
                            <div className="feature-icon">👥</div>
                            <h3 className="card-title">Find Similar Users</h3>
                            <p className="card-description">
                                Connect with others who see similar content. Compare feeds and discover
                                what drives your shared recommendations.
                            </p>
                        </div>
                        <div className="card feature-card">
                            <div className="feature-icon">🎬</div>
                            <h3 className="card-title">Creator Insights</h3>
                            <p className="card-description">
                                Creators: claim your handle to see who's discovering your content,
                                audience interests, and reach analytics.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* CTA */}
            <section className="section" style={{ background: 'var(--color-bg-secondary)' }}>
                <div className="container" style={{ textAlign: 'center' }}>
                    <h2 style={{ fontSize: 'var(--font-size-3xl)', marginBottom: 'var(--spacing-4)' }}>
                        Ready to See Behind Your Feed?
                    </h2>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-8)', maxWidth: '600px', margin: '0 auto var(--spacing-8)' }}>
                        Join users working to bring transparency to social media algorithms.
                    </p>
                    <Link to="/login" className="btn btn-primary btn-lg">
                        Get Started — It's Free
                    </Link>
                </div>
            </section>
        </>
    );
}
