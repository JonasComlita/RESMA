import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Navbar } from '../components/Navbar';
import { KeyRound, Lock, ShieldCheck } from 'lucide-react';

type AuthMode = 'login' | 'register' | 'recover';

export function Login() {
    const [mode, setMode] = useState<AuthMode>('login');
    const [anonymousId, setAnonymousId] = useState('');
    const [recoveryCode, setRecoveryCode] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [credentialPacket, setCredentialPacket] = useState<{ anonymousId: string; recoveryCode: string; title: string; detail: string } | null>(null);
    const { login, register, recover } = useAuth();
    const navigate = useNavigate();

    const resetMode = (nextMode: AuthMode) => {
        setMode(nextMode);
        setError('');
        setCredentialPacket(null);
        setPassword('');
        setConfirmPassword('');
        if (nextMode !== 'login') {
            setAnonymousId('');
        }
        if (nextMode !== 'recover') {
            setRecoveryCode('');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if ((mode === 'register' || mode === 'recover') && password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        try {
            if (mode === 'login') {
                await login(anonymousId, password);
                navigate('/dashboard');
                return;
            }

            if (mode === 'register') {
                const credentials = await register(password);
                setCredentialPacket({
                    ...credentials,
                    title: 'Save Your Contributor Credentials',
                    detail: 'Your pseudonymous contributor ID and recovery code are the only way to regain access without switching to a named account.',
                });
                return;
            }

            const credentials = await recover(recoveryCode, password);
            setCredentialPacket({
                ...credentials,
                title: 'Recovery Complete',
                detail: 'Your password has been reset and your recovery code has been rotated. Save the new code before continuing.',
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to complete request');
        }
    };

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar />
            <div className="flex items-center justify-center pt-32 px-4">
                <div className="bg-white p-8 rounded-2xl shadow-sm max-w-md w-full">
                    <div className="flex justify-center mb-6">
                        <div className="p-3 bg-blue-100 rounded-full">
                            <Lock className="w-6 h-6 text-blue-600" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">Pseudonymous Contributor Access</h2>
                    <p className="text-center text-sm text-gray-600 mb-6">
                        Join the recommendation observatory without using a named identity. Save your contributor ID and recovery code.
                    </p>

                    <div className="grid grid-cols-3 gap-2 mb-6 rounded-xl bg-gray-100 p-1">
                        {[
                            { id: 'login', label: 'Log In' },
                            { id: 'register', label: 'Create' },
                            { id: 'recover', label: 'Recover' },
                        ].map((entry) => {
                            const isActive = mode === entry.id;
                            return (
                                <button
                                    key={entry.id}
                                    type="button"
                                    onClick={() => resetMode(entry.id as AuthMode)}
                                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition-all ${isActive ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                                >
                                    {entry.label}
                                </button>
                            );
                        })}
                    </div>

                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm text-center">
                            {error}
                        </div>
                    )}

                    {credentialPacket && (
                        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                            <div className="flex items-start gap-3">
                                <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5" />
                                <div>
                                    <h3 className="text-sm font-semibold text-emerald-900">{credentialPacket.title}</h3>
                                    <p className="mt-1 text-xs text-emerald-800">{credentialPacket.detail}</p>
                                </div>
                            </div>
                            <div className="mt-4 space-y-3">
                                <div className="rounded-lg bg-white px-3 py-2">
                                    <p className="text-[11px] uppercase tracking-wide text-gray-500">Contributor ID</p>
                                    <code className="mt-1 block text-sm font-semibold text-gray-900 break-all">{credentialPacket.anonymousId}</code>
                                </div>
                                <div className="rounded-lg bg-white px-3 py-2">
                                    <p className="text-[11px] uppercase tracking-wide text-gray-500">Recovery Code</p>
                                    <code className="mt-1 block text-sm font-semibold text-gray-900 break-all">{credentialPacket.recoveryCode}</code>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => navigate('/dashboard')}
                                className="mt-4 w-full rounded-lg bg-black py-3 text-sm font-bold text-white transition-all hover:bg-gray-800"
                            >
                                I&apos;ve saved these. Continue to dashboard.
                            </button>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {mode === 'login' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Contributor ID</label>
                                <input
                                    type="text"
                                    value={anonymousId}
                                    onChange={(e) => setAnonymousId(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                    placeholder="Enter your pseudonymous ID"
                                    required
                                />
                            </div>
                        )}

                        {mode === 'recover' && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Recovery Code</label>
                                <div className="relative">
                                    <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        value={recoveryCode}
                                        onChange={(e) => setRecoveryCode(e.target.value)}
                                        className="w-full rounded-lg border border-gray-200 py-2 pl-10 pr-4 focus:border-transparent focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                        placeholder="ABCD-EFGH-IJKL-MNOP"
                                        required
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {mode === 'recover' ? 'New Password' : 'Password'}
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                placeholder={mode === 'register' ? 'Create a password' : mode === 'recover' ? 'Choose a new password' : 'Enter your password'}
                                required
                            />
                        </div>

                        {(mode === 'register' || mode === 'recover') && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                    placeholder="Repeat your password"
                                    required
                                />
                            </div>
                        )}

                        <div className="rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600">
                            {mode === 'login' && 'Use your contributor ID and password to access your observatory dashboard and aggregate insight tools.'}
                            {mode === 'register' && 'Creating an account generates a pseudonymous contributor ID and recovery code. No name or email is required.'}
                            {mode === 'recover' && 'Recovery rotates your recovery code automatically. Save the new code immediately after reset.'}
                        </div>

                        <button
                            type="submit"
                            className="w-full py-3 bg-black text-white rounded-lg font-bold hover:bg-gray-800 transition-all"
                        >
                            {mode === 'login' && 'Log In'}
                            {mode === 'register' && 'Create Pseudonymous Account'}
                            {mode === 'recover' && 'Recover Account'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
