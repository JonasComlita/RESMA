import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

interface User {
    id?: string;
    anonymousId: string;
    createdAt: string;
    contributeToCreatorInsights?: boolean;
}

interface CredentialPacket {
    anonymousId: string;
    recoveryCode: string;
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    login: (anonymousId: string, password: string) => Promise<void>;
    register: (password: string) => Promise<CredentialPacket>;
    recover: (recoveryCode: string, newPassword: string) => Promise<CredentialPacket>;
    deleteAccount: (confirmAnonymousId: string) => Promise<void>;
    logout: () => void;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const checkAuth = async () => {
            const token = localStorage.getItem('token');
            if (token) {
                try {
                    const userData = await api.get<{ user: User }>('/auth/me');
                    setUser(userData.user);
                } catch (error) {
                    console.error("Auth check failed", error);
                    localStorage.removeItem('token');
                }
            }
            setIsLoading(false);
        };
        checkAuth();
    }, []);

    const login = async (anonymousId: string, password: string) => {
        const response = await api.post<{ token: string; user: User }>('/auth/login', { anonymousId, password });
        localStorage.setItem('token', response.token);
        setUser(response.user);
    };

    const register = async (password: string) => {
        const response = await api.post<{ token: string; user: User; recoveryCode: string }>('/auth/register', { password });
        localStorage.setItem('token', response.token);
        setUser(response.user);
        return {
            anonymousId: response.user.anonymousId,
            recoveryCode: response.recoveryCode,
        };
    };

    const recover = async (recoveryCode: string, newPassword: string) => {
        const response = await api.post<{ token: string; user: User; recoveryCode: string }>('/auth/recover', {
            recoveryCode,
            newPassword,
        });
        localStorage.setItem('token', response.token);
        setUser(response.user);
        return {
            anonymousId: response.user.anonymousId,
            recoveryCode: response.recoveryCode,
        };
    };

    const deleteAccount = async (confirmAnonymousId: string) => {
        await api.post('/auth/delete-account', { confirmAnonymousId });
        localStorage.removeItem('token');
        setUser(null);
    };

    const logout = () => {
        localStorage.removeItem('token');
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, isLoading, login, register, recover, deleteAccount, logout, isAuthenticated: !!user }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
