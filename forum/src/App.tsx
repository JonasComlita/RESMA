import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Home from './pages/Home';
import Compare from './pages/Compare';
import Dashboard from './pages/Dashboard';
import CreatorDashboard from './pages/CreatorDashboard';
import Login from './pages/Login';
import YouTubeDashboard from './pages/YouTubeDashboard';
import InsightsDashboard from './pages/InsightsDashboard';
import InstagramDashboard from './pages/InstagramDashboard';
import TwitterDashboard from './pages/TwitterDashboard';

function App() {
    return (
        <div className="app">
            <Header />
            <main className="main-content">
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/compare" element={<Compare />} />
                    <Route path="/creators" element={<CreatorDashboard />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/youtube" element={<YouTubeDashboard />} />
                    <Route path="/insights" element={<InsightsDashboard />} />
                    <Route path="/instagram" element={<InstagramDashboard />} />
                    <Route path="/twitter" element={<TwitterDashboard />} />
                </Routes>
            </main>
        </div>
    );
}

export default App;
