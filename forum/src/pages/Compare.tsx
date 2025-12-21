import { useQuery } from '@tanstack/react-query';

interface InsightReason {
    type: string;
    description: string;
    confidence: number;
    details?: any;
}

export default function Compare() {
    const token = localStorage.getItem('token');

    const { data: similarData, isLoading: loadingSimilar } = useQuery({
        queryKey: ['similar'],
        queryFn: async () => {
            if (!token) return null;
            const res = await fetch('/api/analysis/similar', {
                headers: { Authorization: `Bearer ${token}` },
            });
            return res.json();
        },
        enabled: !!token,
    });

    const { data: profileData, isLoading: loadingProfile } = useQuery({
        queryKey: ['algorithmProfile'],
        queryFn: async () => {
            if (!token) return null;
            const res = await fetch('/api/analysis/profile', {
                headers: { Authorization: `Bearer ${token}` },
            });
            return res.json();
        },
        enabled: !!token,
    });

    const similarFeeds = similarData?.data?.similarFeeds || [];
    const profile = profileData?.data?.profile;

    if (!token) {
        return (
            <section className="section">
                <div className="container" style={{ textAlign: 'center' }}>
                    <h1 style={{ marginBottom: 'var(--spacing-4)' }}>Similar Users</h1>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-6)' }}>
                        Log in and capture your feed to find users with similar algorithms.
                    </p>
                    <a href="/login" className="btn btn-primary">Log In</a>
                </div>
            </section>
        );
    }

    return (
        <section className="section">
            <div className="container">
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-12)' }}>
                    <h1 style={{ marginBottom: 'var(--spacing-4)' }}>Your Algorithm Profile</h1>
                    <p style={{ color: 'var(--color-text-secondary)', maxWidth: '600px', margin: '0 auto' }}>
                        Understand what drives your recommendations and find users with similar feeds.
                    </p>
                </div>

                {/* Algorithm Profile */}
                {profile && (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                        gap: 'var(--spacing-6)',
                        marginBottom: 'var(--spacing-12)'
                    }}>
                        {/* Category Breakdown */}
                        <div className="card">
                            <h3 style={{ marginBottom: 'var(--spacing-4)' }}>Your Content Interests</h3>
                            {loadingProfile ? (
                                <p style={{ color: 'var(--color-text-muted)' }}>Analyzing...</p>
                            ) : profile.categoryBreakdown?.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
                                    {profile.categoryBreakdown.map((cat: any) => (
                                        <div key={cat.category}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                <span style={{ textTransform: 'capitalize' }}>{cat.category}</span>
                                                <span style={{ color: 'var(--color-text-muted)' }}>{cat.percentage}%</span>
                                            </div>
                                            <div style={{
                                                height: '8px',
                                                background: 'var(--color-bg-tertiary)',
                                                borderRadius: 'var(--radius-full)',
                                                overflow: 'hidden'
                                            }}>
                                                <div style={{
                                                    width: `${cat.percentage}%`,
                                                    height: '100%',
                                                    background: 'var(--gradient-primary)',
                                                    borderRadius: 'var(--radius-full)'
                                                }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p style={{ color: 'var(--color-text-muted)' }}>
                                    Capture more of your feed to build your profile.
                                </p>
                            )}
                        </div>

                        {/* Top Creators */}
                        <div className="card">
                            <h3 style={{ marginBottom: 'var(--spacing-4)' }}>Creators You See Most</h3>
                            {loadingProfile ? (
                                <p style={{ color: 'var(--color-text-muted)' }}>Analyzing...</p>
                            ) : profile.topCreators?.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
                                    {profile.topCreators.map((creator: any, i: number) => (
                                        <div key={creator.handle} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 'var(--spacing-3)',
                                            padding: 'var(--spacing-2) 0',
                                            borderBottom: i < profile.topCreators.length - 1 ? '1px solid var(--color-border)' : 'none'
                                        }}>
                                            <span style={{
                                                width: '24px',
                                                height: '24px',
                                                background: 'var(--gradient-primary)',
                                                borderRadius: 'var(--radius-full)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                fontSize: 'var(--font-size-xs)',
                                                fontWeight: '600'
                                            }}>
                                                {i + 1}
                                            </span>
                                            <span style={{ flex: 1 }}>@{creator.handle}</span>
                                            <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                                {creator.count} videos
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p style={{ color: 'var(--color-text-muted)' }}>
                                    Capture your feed to see your top creators.
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Similar Users */}
                <h2 style={{ marginBottom: 'var(--spacing-6)' }}>Users With Similar Feeds</h2>

                {loadingSimilar ? (
                    <p style={{ color: 'var(--color-text-muted)' }}>Finding similar users...</p>
                ) : similarFeeds.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-8)' }}>
                        <p style={{ color: 'var(--color-text-secondary)' }}>
                            No similar feeds found yet. Capture more of your feed to improve matching!
                        </p>
                    </div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                        gap: 'var(--spacing-6)'
                    }}>
                        {similarFeeds.map((feed: any) => (
                            <div key={feed.snapshotId} className="card">
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'flex-start',
                                    marginBottom: 'var(--spacing-4)'
                                }}>
                                    <div>
                                        <h3 style={{ fontSize: 'var(--font-size-lg)' }}>
                                            User {feed.userId.substring(0, 8)}...
                                        </h3>
                                        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                            {new Date(feed.capturedAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <div style={{
                                        background: 'var(--gradient-primary)',
                                        padding: 'var(--spacing-2) var(--spacing-3)',
                                        borderRadius: 'var(--radius-full)',
                                        fontSize: 'var(--font-size-sm)',
                                        fontWeight: '600'
                                    }}>
                                        {Math.round(feed.similarityScore * 100)}% match
                                    </div>
                                </div>

                                <div style={{ marginBottom: 'var(--spacing-4)' }}>
                                    <h4 style={{
                                        fontSize: 'var(--font-size-sm)',
                                        color: 'var(--color-text-secondary)',
                                        marginBottom: 'var(--spacing-2)'
                                    }}>
                                        Common Creators ({feed.commonCreators.length})
                                    </h4>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
                                        {feed.commonCreators.slice(0, 5).map((creator: string) => (
                                            <span key={creator} style={{
                                                background: 'var(--color-bg-tertiary)',
                                                padding: 'var(--spacing-1) var(--spacing-3)',
                                                borderRadius: 'var(--radius-full)',
                                                fontSize: 'var(--font-size-xs)'
                                            }}>
                                                @{creator}
                                            </span>
                                        ))}
                                        {feed.commonCreators.length > 5 && (
                                            <span style={{
                                                fontSize: 'var(--font-size-xs)',
                                                color: 'var(--color-text-muted)',
                                                alignSelf: 'center'
                                            }}>
                                                +{feed.commonCreators.length - 5} more
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <button className="btn btn-secondary" style={{ width: '100%' }}>
                                    Compare Feeds
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
