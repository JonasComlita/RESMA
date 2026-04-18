import React from 'react';

interface ErrorBoundaryProps {
    children: React.ReactNode;
    title?: string;
    description?: string;
    resetKey?: string | number | null;
}

interface ErrorBoundaryState {
    hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = {
        hasError: false,
    };

    static getDerivedStateFromError(): ErrorBoundaryState {
        return {
            hasError: true,
        };
    }

    componentDidUpdate(prevProps: ErrorBoundaryProps) {
        if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
            this.setState({ hasError: false });
        }
    }

    private handleRetry = () => {
        this.setState({ hasError: false });
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        return (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-700">
                    Observatory Error Boundary
                </p>
                <h2 className="mt-2 text-xl font-bold text-red-900">
                    {this.props.title || 'This panel hit an unexpected rendering error.'}
                </h2>
                <p className="mt-2 text-sm text-red-800">
                    {this.props.description || 'The rest of the dashboard is still available. Retry this panel to continue exploring contributor and aggregate observatory data.'}
                </p>
                <button
                    type="button"
                    onClick={this.handleRetry}
                    className="mt-4 rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-100"
                >
                    Retry Panel
                </button>
            </div>
        );
    }
}
