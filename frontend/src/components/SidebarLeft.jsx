import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Compass, FileText, Hash, Tag, HelpCircle } from 'lucide-react';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import './SidebarLeft.css';

export default function SidebarLeft({ activeTopic = 'All Topics', onSelectTopic }) {
  const { user, isAuthenticated } = useAuth();
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function fetchTopics() {
      if (!isAuthenticated) {
        if (isMounted) {
          setTopics([]);
          setLoading(false);
        }
        return;
      }
      try {
        setLoading(true);
        // Fetch only topics with accessible documents in feed
        const data = await api.getTopics(false);
        if (isMounted) {
          setTopics(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Failed to fetch sidebar topics:', err);
        if (isMounted) {
          setTopics([]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    fetchTopics();
    return () => {
      isMounted = false;
    };
  }, [user, isAuthenticated]);

  return (
    <aside className="sidebar-left" aria-label="Left Sidebar Navigation">
      {/* Primary Feeds */}
      <nav className="sidebar-nav-group" aria-label="Feeds">
        <NavLink
          to="/"
          end
          className={({ isActive }) => `sidebar-nav-link ${isActive && activeTopic === 'All Topics' ? 'active' : ''}`}
          onClick={() => onSelectTopic && onSelectTopic('All Topics')}
        >
          <Home className="sidebar-icon" size={18} />
          <span>Home Feed</span>
        </NavLink>
        <NavLink
          to="/explore"
          className={({ isActive }) => `sidebar-nav-link ${isActive ? 'active' : ''}`}
        >
          <Compass className="sidebar-icon" size={18} />
          <span>Explore</span>
        </NavLink>
        <NavLink
          to="/profile"
          className={({ isActive }) => `sidebar-nav-link ${isActive ? 'active' : ''}`}
        >
          <FileText className="sidebar-icon" size={18} />
          <span>My Documents</span>
        </NavLink>
      </nav>

      <div className="sidebar-divider" />

      {/* Research Topics */}
      <div className="sidebar-section-header">
        <span>Topics</span>
        <Hash size={13} />
      </div>

      <div className="sidebar-topics-list" role="list">
        {/* All Topics (always first) */}
        <button
          type="button"
          className={`sidebar-topic-item ${activeTopic === 'All Topics' ? 'active' : ''}`}
          onClick={() => onSelectTopic && onSelectTopic('All Topics')}
          aria-pressed={activeTopic === 'All Topics'}
        >
          <span>All Topics</span>
          <span className="topic-bullet" aria-hidden="true" />
        </button>

        {/* Loading skeleton */}
        {loading && topics.length === 0 && (
          <div className="sidebar-topics-loading">
            <div className="sidebar-topic-skeleton" />
            <div className="sidebar-topic-skeleton" style={{ width: '80%' }} />
            <div className="sidebar-topic-skeleton" style={{ width: '65%' }} />
          </div>
        )}

        {/* Real dynamic topics from database */}
        {topics.map((t) => {
          const isSelected = activeTopic.toLowerCase() === t.name.toLowerCase();
          const isUncategorized = t.name.toLowerCase() === 'uncategorized';

          return (
            <button
              key={t.name}
              type="button"
              className={`sidebar-topic-item ${isSelected ? 'active' : ''} ${isUncategorized ? 'uncategorized-item' : ''}`}
              onClick={() => onSelectTopic && onSelectTopic(t.name)}
              aria-pressed={isSelected}
              title={`${t.name} (${t.count} ${t.count === 1 ? 'document' : 'documents'})`}
            >
              <span className="topic-name-wrap">
                {isUncategorized && <HelpCircle size={12} className="uncategorized-icon" />}
                <span>{t.name}</span>
              </span>
              <span className="sidebar-topic-meta">
                {t.count !== undefined && t.count !== null && (
                  <span className="topic-count-badge">{t.count}</span>
                )}
                <span className="topic-bullet" aria-hidden="true" />
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
