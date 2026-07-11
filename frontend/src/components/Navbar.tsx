import { Link, NavLink, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const onLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <header className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="brand">
          <span className="brand-mark">🧭</span>
          <span className="brand-name">TrackBack</span>
        </Link>

        <nav className="nav-links">
          <NavLink to="/" end>
            Browse
          </NavLink>
          <NavLink to="/report">Report item</NavLink>
          {user ? (
            <>
              <NavLink to="/my-items">My items</NavLink>
              <span className="nav-user">@{user.username}</span>
              <button className="btn btn-ghost" onClick={onLogout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <NavLink to="/register" className="btn btn-primary nav-cta">
                Sign up
              </NavLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
