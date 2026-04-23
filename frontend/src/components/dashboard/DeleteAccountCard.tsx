import { useState } from 'react';
import { Loader2 } from 'lucide-react';

interface DeleteAccountCardProps {
    anonymousId: string;
    onDeleteAccount: (confirmAnonymousId: string) => Promise<void>;
    onDeleted: () => void;
}

export function DeleteAccountCard({
    anonymousId,
    onDeleteAccount,
    onDeleted,
}: DeleteAccountCardProps) {
    const [deleteConfirmation, setDeleteConfirmation] = useState('');
    const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);

    const handleDeleteAccount = async () => {
        if (deleteConfirmation.trim() !== anonymousId) {
            setDeleteAccountError('Type your exact contributor ID before deleting all observatory data.');
            return;
        }

        setDeleteAccountError(null);
        setIsDeletingAccount(true);

        try {
            await onDeleteAccount(deleteConfirmation.trim());
            onDeleted();
        } catch (error) {
            setDeleteAccountError(
                error instanceof Error
                    ? error.message
                    : 'Unable to delete your contributor account right now.'
            );
        } finally {
            setIsDeletingAccount(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-700">Delete My Data</p>
            <h2 className="mt-2 text-lg font-bold text-gray-900">Hard-delete this contributor account</h2>
            <p className="mt-2 text-sm text-gray-600">
                Type your contributor ID exactly to confirm permanent deletion of your pseudonymous account, snapshots, feed items, and ingest history.
            </p>
            <input
                type="text"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={anonymousId}
                className="mt-4 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />
            {deleteAccountError && (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {deleteAccountError}
                </div>
            )}
            <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={isDeletingAccount}
                className="mt-4 inline-flex items-center justify-center rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isDeletingAccount ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete Contributor Account'}
            </button>
        </div>
    );
}
