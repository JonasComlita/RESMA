import { Link, useLocation } from 'react-router-dom';

export default function Header() {
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    return (
        <header className="header">
            <div className="header-inner">
                <Link to="/" className="logo">
                    RESMA
                </Link>

                <nav className="nav">
                    <Link to="/" className={`nav-link ${isActive('/') ? 'active' : ''}`}>
                        Home
                    </Link>
                    <Link to="/dashboard" className={`nav-link ${isActive('/dashboard') ? 'active' : ''}`}>
                        My Feed
                    </Link>
                    <Link to="/youtube" className={`nav-link ${isActive('/youtube') ? 'active' : ''}`}>
                        YouTube
                    </Link>
                    <Link to="/instagram" className={`nav-link ${isActive('/instagram') ? 'active' : ''}`}>
                        Instagram
                    </Link>
                    <Link to="/twitter" className={`nav-link ${isActive('/twitter') ? 'active' : ''}`}> 
                        Twitter
                    </Link>
                    <Link to="/compare" className={`nav-link ${isActive('/compare') ? 'active' : ''}`}> 
                        Similar Users
                    </Link>
                    <Link to="/creators" className={`nav-link ${isActive('/creators') ? 'active' : ''}`}> 
                        For Creators
                    </Link>
                </nav>

                <Link to="/login" className="btn btn-primary">
                    Get Started
                </Link>
            </div>
        </header>
    );
}
