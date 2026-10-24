import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Compass, Plus, FileText, User } from 'lucide-react';
import Navbar from '../components/Navbar.jsx';
import SidebarLeft from '../components/SidebarLeft.jsx';
import SidebarRight from '../components/SidebarRight.jsx';
import PublishModal from '../components/PublishModal.jsx';
import { useAuth } from '../hooks/useAuth.js';
import './AppLayout.css';

export default function AppLayout({
  children,
  activeTopic = 'All Topics',
  onSelectTopic,
  searchQuery = '',
  onSearchChange,
  onSearchSubmit,
  onPublishSuccess,
  isPublishOpen: controlledPublishOpen,
  onOpenPublish: controlledOpenPublish,
  onClosePublish: controlledClosePublish,
}) {
  const [internalPublishOpen, setInternalPublishOpen] = useState(false);
  const isPublishOpen = controlledPublishOpen !== undefined ? controlledPublishOpen : internalPublishOpen;
  const handleOpenPublish = controlledOpenPublish || (() => setInternalPublishOpen(true));
  const handleClosePublish = controlledClosePublish || (() => setInternalPublishOpen(false));
  const { isAuthenticated } = useAuth();

  return (
    <div className="app-layout">
      {/* Top Navbar */}
      <Navbar
        onOpenPublish={handleOpenPublish}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        onSearchSubmit={onSearchSubmit}
      />

      {/* Main 3-Column Grid */}
      <div className="app-main-container">
        <SidebarLeft
          activeTopic={activeTopic}
          onSelectTopic={onSelectTopic}
        />

        <main className="app-center-feed">
          {children}
        </main>

        <SidebarRight />
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `mobile-nav-btn ${isActive ? 'active' : ''}`}
        >
          <Home size={20} />
          <span>Home</span>
        </NavLink>
        <NavLink
          to="/explore"
          className={({ isActive }) => `mobile-nav-btn ${isActive ? 'active' : ''}`}
        >
          <Compass size={20} />
          <span>Explore</span>
        </NavLink>
        <button
          type="button"
          className="mobile-nav-btn publish-pill"
          onClick={handleOpenPublish}
          aria-label="Publish"
        >
          <div className="mobile-publish-icon">
            <Plus size={20} strokeWidth={2.5} />
          </div>
        </button>
        <NavLink
          to="/profile"
          className={({ isActive }) => `mobile-nav-btn ${isActive ? 'active' : ''}`}
        >
          {isAuthenticated ? <User size={20} /> : <FileText size={20} />}
          <span>{isAuthenticated ? 'Profile' : 'Docs'}</span>
        </NavLink>
      </nav>

      {/* Reusable Publish Modal */}
      <PublishModal
        isOpen={isPublishOpen}
        onClose={handleClosePublish}
        onSuccess={(doc) => {
          if (onPublishSuccess) onPublishSuccess(doc);
        }}
      />
    </div>
  );
}
