import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Spinner } from './ui.jsx';

export function ProtectedLayout() {
  const { user, status, logout } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Spinner label="Checking your session…" />;
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <>
      <header className="topbar">
        <div className="container topbar-inner">
          <NavLink to="/" className="brand">
            Interview Coach
          </NavLink>
          <nav aria-label="Main">
            <NavLink to="/" end>Dashboard</NavLink>
            <NavLink to="/resumes">Resumes</NavLink>
            <NavLink to="/interviews">History</NavLink>
            <NavLink to="/interviews/new" className="btn btn-small btn-primary">New interview</NavLink>
          </nav>
          <div className="row">
            <span className="muted small hide-sm">{user.name}</span>
            <button type="button" className="btn btn-small" onClick={() => logout()}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="container page">
        <Outlet />
      </main>
    </>
  );
}

export function PublicOnly({ children }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Spinner label="Checking your session…" />;
  if (status === 'authenticated') return <Navigate to={location.state?.from ?? '/'} replace />;
  return children;
}
