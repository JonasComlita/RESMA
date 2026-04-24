import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { OppositeDiscoveryResult } from '../types/oppositeDiscovery';

const DEFAULT_LIMIT = 10;

export function useDashboardOppositeDiscovery(userPresent: boolean, platform: string) {
    const [result, setResult] = useState<OppositeDiscoveryResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    const loadOppositeDiscovery = (targetPlatform = platform, keepExisting = true) => {
        if (!userPresent) {
            return;
        }

        setIsLoading(true);
        setError(null);
        if (!keepExisting) {
            setResult(null);
        }

        const query = new URLSearchParams({
            platform: targetPlatform,
            limit: String(DEFAULT_LIMIT),
        });

        api.get<{ result: OppositeDiscoveryResult }>(`/analysis/opposite-discovery?${query.toString()}`)
            .then((data) => {
                setResult(data.result);
            })
            .catch((loadError: Error) => {
                setResult(null);
                setError(loadError.message || 'Unable to load opposite-spectrum discovery.');
            })
            .finally(() => setIsLoading(false));
    };

    useEffect(() => {
        if (userPresent) {
            loadOppositeDiscovery(platform, true);
        }
    }, [userPresent, platform]);

    return {
        oppositeDiscovery: result,
        oppositeDiscoveryError: error,
        isOppositeDiscoveryLoading: isLoading,
        loadOppositeDiscovery,
    };
}
