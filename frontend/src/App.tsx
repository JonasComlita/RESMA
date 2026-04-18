import { Routes, Route } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { AuthProvider } from './context/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
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
    </AuthProvider>
  );
}

export default App;
