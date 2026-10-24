import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Compass, FileText, Hash, Layers } from 'lucide-react';
import './SidebarLeft.css';

const DEFAULT_TOPICS = [
  'All Topics',
  'Research',
  'Artificial Intelligence',
  'Technology',
  'Science',
  'Policy & Governance',
  'Economics',
  'Medicine',
];

export default function SidebarLeft({ activeTopic = 'All Topics', onSelectTopic }) {
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
        {DEFAULT_TOPICS.map((topic) => {
          const isSelected = activeTopic === topic;
          return (
            <button
              key={topic}
              type="button"
              className={`sidebar-topic-item ${isSelected ? 'active' : ''}`}
              onClick={() => onSelectTopic && onSelectTopic(topic)}
              aria-pressed={isSelected}
            >
              <span>{topic}</span>
              <span className="topic-bullet" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </aside>
  );
}
