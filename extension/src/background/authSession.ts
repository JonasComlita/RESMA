const EXPIRY_SKEW_MS = 30_000;

function decodeBase64Url(value: string): string | null {
    if (!value) {
        return null;
    }

    try {
        const normalized = value
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(value.length / 4) * 4, '=');
        return atob(normalized);
    } catch {
        return null;
    }
}

export function getJwtExpiryTime(token: string): number | null {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) {
        return null;
    }

    const decodedPayload = decodeBase64Url(payloadSegment);
    if (!decodedPayload) {
        return null;
    }

    try {
        const payload = JSON.parse(decodedPayload) as { exp?: unknown };
        if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
            return null;
        }

        return payload.exp * 1000;
    } catch {
        return null;
    }
}

export function isJwtExpired(token: string, now = Date.now()): boolean {
    const expiresAt = getJwtExpiryTime(token);
    if (expiresAt === null) {
        return false;
    }

    return expiresAt <= now + EXPIRY_SKEW_MS;
}
