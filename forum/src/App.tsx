import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Home from './pages/Home';
import Compare from './pages/Compare';
import Dashboard from './pages/Dashboard';
import CreatorDashboard from './pages/CreatorDashboard';
import Login from './pages/Login';

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
                </Routes>
            </main>
        </div>
    );
}

export default App;
