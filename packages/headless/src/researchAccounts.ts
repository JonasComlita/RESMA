import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import type {
    CaptureModeContext,
    GovernedResearchAccount,
    GovernedResearchAccountConfig,
    GovernedResearchAccountOwner,
    GovernedResearchAccountReference,
    SupportedHeadlessPlatform,
} from './types.js';

const GOVERNED_RESEARCH_CONFIG_VERSION = 1 as const;
const SUPPORTED_RESEARCH_ACCOUNT_PLATFORMS = new Set<SupportedHeadlessPlatform>(['youtube']);
const SUPPORTED_CAPTURE_MODE = 'passive-observation-only' as const;
const SUPPORTED_CREDENTIAL_SOURCE_KIND = 'persistent-user-data-dir' as const;

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function asString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${fieldName} must be a string.`);
    }

    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`${fieldName} must not be empty.`);
    }
    return normalized;
}

function asOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function asStringArray(value: unknown, fieldName: string): string[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error(`${fieldName} must be an array of strings when provided.`);
    }

    return value.map((entry, index) => asString(entry, `${fieldName}[${index}]`));
}

function parseOwner(value: unknown): GovernedResearchAccountOwner | undefined {
    if (value === undefined) {
        return undefined;
    }

    const record = asRecord(value);
    if (!record) {
        throw new Error('accounts[].owner must be an object when provided.');
    }

    const owner: GovernedResearchAccountOwner = {};
    const operatorId = asOptionalString(record.operatorId);
    const displayName = asOptionalString(record.displayName);
    const teamName = asOptionalString(record.teamName);

    if (operatorId) owner.operatorId = operatorId;
    if (displayName) owner.displayName = displayName;
    if (teamName) owner.teamName = teamName;

    return Object.keys(owner).length > 0 ? owner : undefined;
}

function parseAccount(record: Record<string, unknown>, index: number): GovernedResearchAccount {
    const fieldPrefix = `accounts[${index}]`;
    const platform = asString(record.platform, `${fieldPrefix}.platform`).toLowerCase();
    if (!SUPPORTED_RESEARCH_ACCOUNT_PLATFORMS.has(platform as SupportedHeadlessPlatform)) {
        throw new Error(`${fieldPrefix}.platform "${platform}" is not allowlisted for governed research-account mode.`);
    }

    const allowedCaptureMode = asString(record.allowedCaptureMode, `${fieldPrefix}.allowedCaptureMode`);
    if (allowedCaptureMode !== SUPPORTED_CAPTURE_MODE) {
        throw new Error(`${fieldPrefix}.allowedCaptureMode must be "${SUPPORTED_CAPTURE_MODE}".`);
    }

    const status = asString(record.status, `${fieldPrefix}.status`).toLowerCase();
    if (!['active', 'paused', 'retired'].includes(status)) {
        throw new Error(`${fieldPrefix}.status must be one of: active, paused, retired.`);
    }

    const runScope = asString(record.runScope, `${fieldPrefix}.runScope`).toLowerCase();
    if (!['local-manual-only', 'orchestrated'].includes(runScope)) {
        throw new Error(`${fieldPrefix}.runScope must be one of: local-manual-only, orchestrated.`);
    }

    const credentialSource = asRecord(record.credentialSource);
    if (!credentialSource) {
        throw new Error(`${fieldPrefix}.credentialSource must be an object.`);
    }

    const credentialKind = asString(credentialSource.kind, `${fieldPrefix}.credentialSource.kind`);
    if (credentialKind !== SUPPORTED_CREDENTIAL_SOURCE_KIND) {
        throw new Error(`${fieldPrefix}.credentialSource.kind must be "${SUPPORTED_CREDENTIAL_SOURCE_KIND}".`);
    }

    return {
        id: asString(record.id, `${fieldPrefix}.id`),
        label: asString(record.label, `${fieldPrefix}.label`),
        platform: platform as SupportedHeadlessPlatform,
        researchPurpose: asString(record.researchPurpose, `${fieldPrefix}.researchPurpose`),
        notes: asStringArray(record.notes, `${fieldPrefix}.notes`),
        allowedCaptureMode: SUPPORTED_CAPTURE_MODE,
        credentialSource: {
            kind: SUPPORTED_CREDENTIAL_SOURCE_KIND,
            reference: asString(credentialSource.reference, `${fieldPrefix}.credentialSource.reference`),
            path: path.resolve(asString(credentialSource.path, `${fieldPrefix}.credentialSource.path`)),
        },
        status: status as GovernedResearchAccount['status'],
        owner: parseOwner(record.owner),
        runScope: runScope as GovernedResearchAccount['runScope'],
    };
}

export function parseGovernedResearchAccountConfig(input: unknown): GovernedResearchAccountConfig {
    const record = asRecord(input);
    if (!record) {
        throw new Error('Governed research-account config must be a JSON object.');
    }

    const version = Number(record.version);
    if (version !== GOVERNED_RESEARCH_CONFIG_VERSION) {
        throw new Error(`Governed research-account config version must be ${GOVERNED_RESEARCH_CONFIG_VERSION}.`);
    }

    if (!Array.isArray(record.accounts) || record.accounts.length === 0) {
        throw new Error('Governed research-account config must include at least one account.');
    }

    const accounts = record.accounts.map((entry, index) => {
        const accountRecord = asRecord(entry);
        if (!accountRecord) {
            throw new Error(`accounts[${index}] must be an object.`);
        }
        return parseAccount(accountRecord, index);
    });

    const seenIds = new Set<string>();
    for (const account of accounts) {
        if (seenIds.has(account.id)) {
            throw new Error(`Governed research-account config contains duplicate account id "${account.id}".`);
        }
        seenIds.add(account.id);
    }

    return {
        version: GOVERNED_RESEARCH_CONFIG_VERSION,
        accounts,
    };
}

export async function loadGovernedResearchAccountConfig(configPath: string): Promise<GovernedResearchAccountConfig> {
    const resolvedPath = path.resolve(configPath);
    const raw = await readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return parseGovernedResearchAccountConfig(parsed);
}

export function createDefaultCaptureModeContext(): CaptureModeContext {
    return {
        mode: 'synthetic-logged-out',
        captureIdentity: 'signed-out-synthetic',
    };
}

export function toGovernedResearchAccountReference(account: GovernedResearchAccount): GovernedResearchAccountReference {
    return {
        id: account.id,
        label: account.label,
        platform: account.platform,
        researchPurpose: account.researchPurpose,
        notes: [...account.notes],
        allowedCaptureMode: account.allowedCaptureMode,
        status: account.status,
        runScope: account.runScope,
        owner: account.owner ? { ...account.owner } : undefined,
        credentialSourceReference: account.credentialSource.reference,
    };
}

export function createGovernedResearchCaptureModeContext(account: GovernedResearchAccount): CaptureModeContext {
    return {
        mode: 'research-account',
        captureIdentity: 'signed-in-research-account',
        researchAccount: toGovernedResearchAccountReference(account),
    };
}

export function mergeCaptureModeMetadata(
    baseMetadata: Record<string, unknown>,
    captureMode: CaptureModeContext,
): Record<string, unknown> {
    if (captureMode.mode === 'research-account' && captureMode.researchAccount) {
        return {
            ...baseMetadata,
            researchMode: 'research-account',
            captureIdentity: captureMode.captureIdentity,
            researchAccountId: captureMode.researchAccount.id,
            researchAccountLabel: captureMode.researchAccount.label,
            researchAccountPlatform: captureMode.researchAccount.platform,
            researchAccountPurpose: captureMode.researchAccount.researchPurpose,
            researchAccountCredentialSourceReference: captureMode.researchAccount.credentialSourceReference,
            researchAccountStatus: captureMode.researchAccount.status,
            researchAccountRunScope: captureMode.researchAccount.runScope,
            researchAccountOwnerOperatorId: captureMode.researchAccount.owner?.operatorId,
            researchAccountOwnerDisplayName: captureMode.researchAccount.owner?.displayName,
            researchAccountOwnerTeamName: captureMode.researchAccount.owner?.teamName,
        };
    }

    return {
        ...baseMetadata,
        researchMode: 'synthetic-logged-out',
        captureIdentity: captureMode.captureIdentity,
    };
}

export interface ResolveGovernedResearchAccountOptions {
    accountId?: string;
    config: GovernedResearchAccountConfig;
    requestedPlatforms: SupportedHeadlessPlatform[];
}

export function resolveGovernedResearchAccount(
    options: ResolveGovernedResearchAccountOptions,
): GovernedResearchAccount {
    const accountId = asString(options.accountId, 'research account id');
    const account = options.config.accounts.find((entry) => entry.id === accountId);
    if (!account) {
        throw new Error(`Governed research account "${accountId}" was not found in the supplied config.`);
    }

    const requestedPlatforms = new Set(options.requestedPlatforms);
    if (requestedPlatforms.size > 1 || !requestedPlatforms.has(account.platform)) {
        throw new Error(`Governed research account "${account.id}" only supports ${account.platform} capture requests.`);
    }

    if (account.status !== 'active') {
        throw new Error(`Governed research account "${account.id}" is ${account.status} and cannot be used for capture.`);
    }

    if (account.runScope !== 'orchestrated') {
        throw new Error(`Governed research account "${account.id}" is restricted to local/manual use and cannot be used in orchestrated runs.`);
    }

    if (account.allowedCaptureMode !== SUPPORTED_CAPTURE_MODE) {
        throw new Error(`Governed research account "${account.id}" is not approved for supported passive capture mode.`);
    }

    return account;
}

export async function assertGovernedResearchCredentialSourceExists(account: GovernedResearchAccount): Promise<void> {
    await stat(account.credentialSource.path).catch(() => {
        throw new Error(
            `Governed research account "${account.id}" references a missing credential source path: ${account.credentialSource.path}`,
        );
    });
}
