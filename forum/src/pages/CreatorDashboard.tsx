import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';

export default function CreatorDashboard() {
    const [handle, setHandle] = useState('');
    const token = localStorage.getItem('token');

    const { data: creatorData, isLoading: loadingProfile, refetch } = useQuery({
        queryKey: ['creatorProfile'],
        queryFn: async () => {
            if (!token) return null;
            const res = await fetch('/api/creators/me', {
                headers: { Authorization: `Bearer ${token}` },
            });
            return res.json();
        },
        enabled: !!token,
    });

    const { data: audienceData, isLoading: loadingAudience } = useQuery({
        queryKey: ['creatorAudience'],
        queryFn: async () => {
            if (!token) return null;
            const res = await fetch('/api/creators/me/audience', {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.status === 403) return { error: 'premium_required' };
            return res.json();
        },
        enabled: !!token && !!creatorData?.data?.creator,
    });

    const claimMutation = useMutation({
        mutationFn: async (tiktokHandle: string) => {
            const res = await fetch('/api/creators/claim', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ tiktokHandle }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            return data;
        },
        onSuccess: () => refetch(),
    });

    const creator = creatorData?.data?.creator;
    const audience = audienceData?.data?.audience;

    if (!token) {
        return (
            <section className="section">
                <div className="container" style={{ textAlign: 'center' }}>
                    <h1 style={{ marginBottom: 'var(--spacing-4)' }}>For Creators</h1>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-6)' }}>
                        See who's discovering your content and understand your audience.
                    </p>
                    <a href="/login" className="btn btn-primary">
                        Log In to Continue
                    </a>
                </div>
            </section>
        );
    }

    if (loadingProfile) {
        return (
            <section className="section">
                <div className="container" style={{ textAlign: 'center' }}>
                    <p>Loading...</p>
                </div>
            </section>
        );
    }

    // Not a creator yet - show claim form
    if (!creator) {
        return (
            <section className="section">
                <div className="container" style={{ maxWidth: '500px' }}>
                    <div style={{ textAlign: 'center', marginBottom: 'var(--spacing-8)' }}>
                        <h1 style={{ marginBottom: 'var(--spacing-4)' }}>Creator Dashboard</h1>
                        <p style={{ color: 'var(--color-text-secondary)' }}>
                            Claim your TikTok handle to see audience insights.
                        </p>
                    </div>

                    <div className="card" style={{ padding: 'var(--spacing-8)' }}>
                        <div style={{
                            background: 'var(--gradient-primary)',
                            padding: 'var(--spacing-4)',
                            borderRadius: 'var(--radius-lg)',
                            marginBottom: 'var(--spacing-6)',
                            textAlign: 'center'
                        }}>
                            <span style={{ fontSize: 'var(--font-size-sm)' }}>✨ Premium Feature</span>
                        </div>

                        <form onSubmit={(e) => {
                            e.preventDefault();
                            claimMutation.mutate(handle);
                        }}>
                            <div className="form-group">
                                <label className="form-label">Your TikTok Handle</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={handle}
                                    onChange={(e) => setHandle(e.target.value)}
                                    placeholder="@yourusername"
                                    required
                                />
                            </div>

                            {claimMutation.error && (
                                <div style={{
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    border: '1px solid var(--color-error)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: 'var(--spacing-3)',
                                    marginBottom: 'var(--spacing-4)',
                                    color: 'var(--color-error)',
                                    fontSize: 'var(--font-size-sm)'
                                }}>
                                    {(claimMutation.error as Error).message}
                                </div>
                            )}

                            <button
                                type="submit"
                                className="btn btn-primary btn-lg"
                                style={{ width: '100%' }}
                                disabled={claimMutation.isPending}
                            >
                                {claimMutation.isPending ? 'Claiming...' : 'Claim Handle'}
                            </button>
                        </form>

                        <p style={{
                            marginTop: 'var(--spacing-6)',
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--color-text-muted)',
                            textAlign: 'center'
                        }}>
                            You'll need to verify ownership via TikTok login.
                        </p>
                    </div>
                </div>
            </section>
        );
    }

    // Premium required
    if (audienceData?.error === 'premium_required') {
        return (
            <section className="section">
                <div className="container" style={{ maxWidth: '600px', textAlign: 'center' }}>
                    <h1 style={{ marginBottom: 'var(--spacing-4)' }}>Creator Dashboard</h1>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-6)' }}>
                        @{creator.tiktokHandle}
                    </p>

                    <div className="card" style={{ padding: 'var(--spacing-8)' }}>
                        <div style={{ fontSize: '48px', marginBottom: 'var(--spacing-4)' }}>👑</div>
                        <h2 style={{ marginBottom: 'var(--spacing-4)' }}>Premium Required</h2>
                        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-6)' }}>
                            Upgrade to Premium to access audience insights, reach analytics, and more.
                        </p>
                        <button className="btn btn-primary btn-lg">Upgrade to Premium</button>
                    </div>
                </div>
            </section>
        );
    }

    // Full creator dashboard
    return (
        <section className="section">
            <div className="container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-8)' }}>
                    <div>
                        <h1>Creator Dashboard</h1>
                        <p style={{ color: 'var(--color-text-secondary)' }}>
                            @{creator.tiktokHandle}
                            {creator.verified && (
                                <span style={{
                                    marginLeft: 'var(--spacing-2)',
                                    background: 'var(--gradient-secondary)',
                                    padding: '2px 8px',
                                    borderRadius: 'var(--radius-full)',
                                    fontSize: 'var(--font-size-xs)'
                                }}>
                                    ✓ Verified
                                </span>
                            )}
                        </p>
                    </div>
                </div>

                {/* Stats Grid */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 'var(--spacing-4)',
                    marginBottom: 'var(--spacing-8)'
                }}>
                    <div className="stat-card">
                        <div className="stat-value">{audience?.uniqueViewers || 0}</div>
                        <div className="stat-label">RESMA Users Reached</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">{audience?.totalImpressions || 0}</div>
                        <div className="stat-label">Total Impressions</div>
                    </div>
                </div>

                {/* Audience Insights */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                    gap: 'var(--spacing-6)'
                }}>
                    {/* Other Creators They Watch */}
                    <div className="card">
                        <h3 style={{ marginBottom: 'var(--spacing-4)' }}>Other Creators Your Audience Watches</h3>
                        {loadingAudience ? (
                            <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
                        ) : audience?.otherCreatorsTheyWatch?.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
                                {audience.otherCreatorsTheyWatch.slice(0, 10).map((c: any) => (
                                    <div key={c.handle} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: 'var(--spacing-2) 0',
                                        borderBottom: '1px solid var(--color-border)'
                                    }}>
                                        <span>@{c.handle}</span>
                                        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                                            {c.count} appearances
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p style={{ color: 'var(--color-text-muted)' }}>No data yet</p>
                        )}
                    </div>

                    {/* Content Interests */}
                    <div className="card">
                        <h3 style={{ marginBottom: 'var(--spacing-4)' }}>Your Audience's Interests</h3>
                        {loadingAudience ? (
                            <p style={{ color: 'var(--color-text-muted)' }}>Loading...</p>
                        ) : audience?.contentInterests?.length > 0 ? (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--spacing-2)' }}>
                                {audience.contentInterests.map((interest: any) => (
                                    <span key={interest.category} style={{
                                        background: 'var(--color-bg-tertiary)',
                                        padding: 'var(--spacing-2) var(--spacing-4)',
                                        borderRadius: 'var(--radius-full)',
                                        fontSize: 'var(--font-size-sm)'
                                    }}>
                                        {interest.category}
                                        <span style={{ marginLeft: 'var(--spacing-2)', color: 'var(--color-accent)' }}>
                                            {interest.count}
                                        </span>
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p style={{ color: 'var(--color-text-muted)' }}>No data yet</p>
                        )}
                    </div>
                </div>

                {/* Privacy Note */}
                <div style={{
                    marginTop: 'var(--spacing-8)',
                    padding: 'var(--spacing-4)',
                    background: 'var(--color-bg-secondary)',
                    borderRadius: 'var(--radius-lg)',
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--color-text-muted)'
                }}>
                    <strong>Privacy Note:</strong> This data is aggregated from RESMA users who have opted in to share insights with creators.
                    Individual user data is never shared.
                </div>
            </div>
        </section>
    );
}
