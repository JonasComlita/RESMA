const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface AvailableOptions {
    headers?: Record<string, string>;
    body?: any;
}

async function request<T>(endpoint: string, method: RequestMethod = 'GET', options: AvailableOptions = {}): Promise<T> {
    const token = localStorage.getItem('token');

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
    };

    const response = await fetch(`${API_URL}${endpoint}`, config);

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Request failed with status ${response.status}`);
    }

    const result = await response.json();
    return result.data || result;
}

export const api = {
    get: <T>(endpoint: string) => request<T>(endpoint, 'GET'),
    post: <T>(endpoint: string, body: any) => request<T>(endpoint, 'POST', { body }),
    put: <T>(endpoint: string, body: any) => request<T>(endpoint, 'PUT', { body }),
    delete: <T>(endpoint: string) => request<T>(endpoint, 'DELETE'),
};
