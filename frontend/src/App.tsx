import { Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Discover } from './pages/Discover';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <AuthProvider>
      <ErrorBoundary
        title="Something went wrong."
        description="An unexpected error occurred. Please refresh the page or try again later."
      >
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/discover"
            element={(
              <ErrorBoundary
                title="The Discover feed failed to load."
                description="Feed data is still safe. Retry or navigate to the dashboard."
              >
                <Discover />
              </ErrorBoundary>
            )}
          />
          <Route
            path="/dashboard"
            element={(
              <ErrorBoundary
                title="The observatory dashboard failed to load."
                description="Contributor data is still protected. Retry the dashboard to restore the observatory workspace."
              >
                <Dashboard />
              </ErrorBoundary>
            )}
          />
          <Route path="/login" element={<Login />} />
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}

export default App;

