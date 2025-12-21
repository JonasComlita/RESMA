import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
    const [mode, setMode] = useState<'login' | 'register'>('register');
    const [password, setPassword] = useState('');
    const [anonymousId, setAnonymousId] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [registeredId, setRegisteredId] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
            const body = mode === 'register'
                ? { password }
                : { anonymousId, password };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Something went wrong');
            }

            localStorage.setItem('token', data.data.token);

            if (mode === 'register') {
                setRegisteredId(data.data.user.anonymousId);
            } else {
                navigate('/dashboard');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (registeredId) {
        return (
            <section className="section">
                <div className="container" style={{ maxWidth: '400px' }}>
                    <div className="card" style={{ textAlign: 'center', padding: 'var(--spacing-8)' }}>
                        <div style={{
                            width: '64px',
                            height: '64px',
                            background: 'var(--gradient-secondary)',
                            borderRadius: 'var(--radius-full)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            margin: '0 auto var(--spacing-6)',
                            fontSize: '24px'
                        }}>
                            ✓
                        </div>
                        <h2 style={{ marginBottom: 'var(--spacing-4)' }}>Account Created!</h2>
                        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-4)' }}>
                            Save your anonymous ID to log in later:
                        </p>
                        <div style={{
                            background: 'var(--color-bg-tertiary)',
                            padding: 'var(--spacing-4)',
                            borderRadius: 'var(--radius-md)',
                            fontFamily: 'monospace',
                            wordBreak: 'break-all',
                            marginBottom: 'var(--spacing-6)'
                        }}>
                            {registeredId}
                        </div>
                        <button
                            className="btn btn-primary"
                            style={{ width: '100%' }}
                            onClick={() => navigate('/dashboard')}
                        >
                            Go to Dashboard
                        </button>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="section">
            <div className="container" style={{ maxWidth: '400px' }}>
                <div className="card" style={{ padding: 'var(--spacing-8)' }}>
                    <h1 style={{ textAlign: 'center', marginBottom: 'var(--spacing-2)' }}>
                        {mode === 'register' ? 'Create Account' : 'Welcome Back'}
                    </h1>
                    <p style={{
                        textAlign: 'center',
                        color: 'var(--color-text-secondary)',
                        marginBottom: 'var(--spacing-6)'
                    }}>
                        {mode === 'register'
                            ? 'Join the algorithm transparency movement'
                            : 'Log in to your anonymous account'
                        }
                    </p>

                    {/* Toggle */}
                    <div style={{
                        display: 'flex',
                        background: 'var(--color-bg-tertiary)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--spacing-1)',
                        marginBottom: 'var(--spacing-6)'
                    }}>
                        <button
                            onClick={() => setMode('register')}
                            style={{
                                flex: 1,
                                padding: 'var(--spacing-2)',
                                border: 'none',
                                borderRadius: 'var(--radius-sm)',
                                background: mode === 'register' ? 'var(--color-bg-card)' : 'transparent',
                                color: mode === 'register' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                                fontWeight: 500,
                                cursor: 'pointer'
                            }}
                        >
                            Register
                        </button>
                        <button
                            onClick={() => setMode('login')}
                            style={{
                                flex: 1,
                                padding: 'var(--spacing-2)',
                                border: 'none',
                                borderRadius: 'var(--radius-sm)',
                                background: mode === 'login' ? 'var(--color-bg-card)' : 'transparent',
                                color: mode === 'login' ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                                fontWeight: 500,
                                cursor: 'pointer'
                            }}
                        >
                            Login
                        </button>
                    </div>

                    {error && (
                        <div style={{
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid var(--color-error)',
                            borderRadius: 'var(--radius-md)',
                            padding: 'var(--spacing-3)',
                            marginBottom: 'var(--spacing-4)',
                            color: 'var(--color-error)',
                            fontSize: 'var(--font-size-sm)'
                        }}>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit}>
                        {mode === 'login' && (
                            <div className="form-group">
                                <label className="form-label">Anonymous ID</label>
                                <input
                                    type="text"
                                    className="form-input"
                                    value={anonymousId}
                                    onChange={(e) => setAnonymousId(e.target.value)}
                                    placeholder="Enter your anonymous ID"
                                    required
                                />
                            </div>
                        )}

                        <div className="form-group">
                            <label className="form-label">Password</label>
                            <input
                                type="password"
                                className="form-input"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={mode === 'register' ? 'Create a password (8+ characters)' : 'Enter password'}
                                minLength={8}
                                required
                            />
                        </div>

                        <button
                            type="submit"
                            className="btn btn-primary btn-lg"
                            style={{ width: '100%' }}
                            disabled={loading}
                        >
                            {loading ? 'Loading...' : mode === 'register' ? 'Create Account' : 'Log In'}
                        </button>
                    </form>

                    {mode === 'register' && (
                        <p style={{
                            marginTop: 'var(--spacing-6)',
                            fontSize: 'var(--font-size-sm)',
                            color: 'var(--color-text-muted)',
                            textAlign: 'center'
                        }}>
                            We use anonymous accounts. You'll receive a unique ID after registration.
                        </p>
                    )}
                </div>
            </div>
        </section>
    );
}
