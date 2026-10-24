import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  FileText,
  Search,
  Plus,
  Home,
  Compass,
  User,
  LogOut,
  X,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { getInitials } from '../utils/format.js';
import './Navbar.css';

export default function Navbar({ onOpenPublish, searchQuery = '', onSearchChange, onSearchSubmit }) {
  const { user, isAuthenticated, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Close dropdown on outside click or Escape key
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (onSearchSubmit) {
      onSearchSubmit(searchQuery);
    } else if (searchQuery.trim()) {
      navigate(`/explore?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleClearSearch = () => {
    if (onSearchChange) onSearchChange('');
    if (onSearchSubmit) onSearchSubmit('');
  };

  return (
    <header className="navbar">
      <div className="navbar-container">
        {/* Brand */}
        <Link to="/" className="nav-brand" aria-label="DocMe Home">
          <div className="brand-icon-box">
            <FileText size={20} strokeWidth={2.5} />
          </div>
          <div className="brand-text-group">
            <span className="brand-name">DocMe</span>
            <span className="brand-tagline">Research & Knowledge Sharing</span>
          </div>
        </Link>

        {/* Global Search Bar */}
        <div className="nav-search-wrapper">
          <form className="nav-search-box" onSubmit={handleSearchSubmit}>
            <Search className="search-icon" size={16} />
            <input
              type="search"
              className="nav-search-input"
              placeholder="Search papers, documents, topics..."
              value={searchQuery}
              onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
              aria-label="Search documents"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={handleClearSearch}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </form>
        </div>

        {/* Navigation Links */}
        <nav className="nav-links" aria-label="Primary Navigation">
          <Link
            to="/"
            className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}
          >
            <Home size={16} />
            <span>Home</span>
          </Link>
          <Link
            to="/explore"
            className={`nav-item ${location.pathname === '/explore' ? 'active' : ''}`}
          >
            <Compass size={16} />
            <span>Explore</span>
          </Link>
          <Link
            to="/profile"
            className={`nav-item ${location.pathname === '/profile' ? 'active' : ''}`}
          >
            <FileText size={16} />
            <span>My Documents</span>
          </Link>
        </nav>

        {/* Actions & Profile */}
        <div className="nav-actions">
          <button
            type="button"
            className="btn-publish"
            onClick={onOpenPublish}
            aria-label="Publish Document"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span>Publish Document</span>
          </button>

          {isAuthenticated ? (
            <div className="user-menu-wrapper" ref={dropdownRef}>
              <button
                type="button"
                className="avatar-btn"
                onClick={() => setDropdownOpen((prev) => !prev)}
                aria-label="User Profile Menu"
                aria-expanded={dropdownOpen}
              >
                {getInitials(user?.username || 'Researcher')}
              </button>

              {dropdownOpen && (
                <div className="user-dropdown">
                  <div className="dropdown-header">
                    <div className="dropdown-user-name">{user?.username || 'Researcher'}</div>
                    <div className="dropdown-user-email">{user?.email || ''}</div>
                  </div>
                  <Link
                    to="/profile"
                    className="dropdown-item"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <User size={15} />
                    <span>My Profile</span>
                  </Link>
                  <Link
                    to="/profile"
                    className="dropdown-item"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <FileText size={15} />
                    <span>My Documents</span>
                  </Link>
                  <button
                    type="button"
                    className="dropdown-item danger"
                    onClick={async () => {
                      setDropdownOpen(false);
                      await logout();
                      navigate('/');
                    }}
                  >
                    <LogOut size={15} />
                    <span>Log Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Link to="/login" className="btn-login-outline">
                Log In
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
