import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  TrendingUp,
  RefreshCw,
  BookOpen,
  Plus,
  AlertCircle,
  X,
  Filter,
} from 'lucide-react';
import AppLayout from '../layouts/AppLayout.jsx';
import DocumentCard from '../components/DocumentCard.jsx';
import ProtectedRoute from '../components/ProtectedRoute.jsx';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { getInitials } from '../utils/format.js';
import './FeedPage.css';

export default function FeedPage() {
  return (
    <ProtectedRoute>
      <FeedPageContent />
    </ProtectedRoute>
  );
}

function FeedPageContent() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Search & Filter State
  const initialQuery = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [activeTopic, setActiveTopic] = useState('All Topics');
  const [activeSort, setActiveSort] = useState('latest'); // 'latest' | 'popular'
  const [isPublishOpen, setIsPublishOpen] = useState(false);

  // Documents & Loading State
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sync searchQuery with URL query parameter
  useEffect(() => {
    const q = searchParams.get('q') || '';
    setSearchQuery(q);
  }, [searchParams]);

  // Main data fetcher
  const loadFeed = useCallback(async (query = searchQuery, topic = activeTopic, sort = activeSort) => {
    try {
      setLoading(true);
      setError(null);

      let results = [];
      const topicFilter = topic && topic !== 'All Topics' ? topic : null;

      // If search query is present, use the real semantic search endpoint
      if (query.trim()) {
        results = await api.searchDocuments(query.trim(), 25, topicFilter);
      } else if (sort === 'popular') {
        // Fetch popular documents with optional topic filter
        const popular = await api.getPopularDocuments(topicFilter);
        results = popular || [];
      } else {
        // Fetch standard public feed with optional topic filter
        const feed = topicFilter ? await api.getFeed(topicFilter) : await api.getFeed();
        results = feed || [];
      }

      setDocuments(Array.isArray(results) ? results : []);
    } catch (err) {
      console.error('Failed to load document feed:', err);
      setError(err.message || 'Unable to connect to research feed. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, activeTopic, activeSort]);

  // Initial load and dependency trigger
  useEffect(() => {
    loadFeed(searchQuery, activeTopic, activeSort);
  }, [loadFeed, searchQuery, activeTopic, activeSort]);

  // Search submit handler
  const handleSearchSubmit = (q) => {
    const trimmed = q.trim();
    if (trimmed) {
      setSearchParams({ q: trimmed });
    } else {
      setSearchParams({});
    }
    loadFeed(trimmed, activeTopic, activeSort);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchParams({});
    loadFeed('', activeTopic, activeSort);
  };

  const handleSelectTopic = (topic) => {
    setActiveTopic(topic);
    loadFeed(searchQuery, topic, activeSort);
  };

  // Documents returned are directly from the backend API (with real database topic filtering)
  const filteredDocuments = documents;

  return (
    <AppLayout
      activeTopic={activeTopic}
      onSelectTopic={handleSelectTopic}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onSearchSubmit={handleSearchSubmit}
      isPublishOpen={isPublishOpen}
      onOpenPublish={() => setIsPublishOpen(true)}
      onClosePublish={() => setIsPublishOpen(false)}
      onPublishSuccess={(newDoc) => {
        // Prepend new document directly to feed
        setDocuments((prev) => [newDoc, ...prev]);
      }}
    >
      {/* Feed Header */}
      <div className="feed-page-header">
        <div className="feed-header-top">
          <div>
            <h1 className="feed-title">Trending Documents</h1>
            <p className="feed-subtitle">
              Peer-reviewed papers, research preprints, and open scientific discussions.
            </p>
          </div>

          <div className="feed-actions">
            <button
              type="button"
              className="btn-refresh"
              onClick={() => loadFeed(searchQuery, activeTopic, activeSort)}
              title="Refresh feed"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Quick Document Composer Trigger */}
        <div
          className="feed-composer-box"
          onClick={() => setIsPublishOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsPublishOpen(true);
            }
          }}
          aria-label="Publish a new research paper or document"
        >
          <div className="composer-avatar">
            {getInitials(user?.username || 'You')}
          </div>
          <div className="composer-placeholder-input">
            Share a research paper, article or findings with the community...
          </div>
          <div className="btn-composer-cta">
            <Plus size={14} style={{ display: 'inline', marginRight: '4px' }} />
            Publish
          </div>
        </div>

        {/* Feed Controls & Sorting */}
        <div className="feed-controls-bar">
          <div className="feed-tabs" role="tablist">
            <button
              type="button"
              className={`feed-tab ${activeSort === 'latest' ? 'active' : ''}`}
              onClick={() => setActiveSort('latest')}
              role="tab"
              aria-selected={activeSort === 'latest'}
            >
              Latest
            </button>
            <button
              type="button"
              className={`feed-tab ${activeSort === 'popular' ? 'active' : ''}`}
              onClick={() => setActiveSort('popular')}
              role="tab"
              aria-selected={activeSort === 'popular'}
            >
              Most Discussed
            </button>
          </div>

          {/* Active Filter Indicators */}
          {(searchQuery || activeTopic !== 'All Topics') && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {searchQuery && (
                <div className="active-filter-badge">
                  <span>Search: "{searchQuery}"</span>
                  <button
                    type="button"
                    className="btn-clear-filter"
                    onClick={handleClearSearch}
                    aria-label="Clear search filter"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              {activeTopic !== 'All Topics' && (
                <div className="active-filter-badge">
                  <span>Topic: {activeTopic}</span>
                  <button
                    type="button"
                    className="btn-clear-filter"
                    onClick={() => handleSelectTopic('All Topics')}
                    aria-label="Clear topic filter"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Documents Stream */}
      <div className="feed-documents-stream">
        {loading ? (
          // Skeletons
          <>
            <div className="card-skeleton">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div className="skeleton-line" style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
                  <div className="skeleton-line" style={{ width: '120px', height: '14px' }} />
                  <div className="skeleton-line" style={{ width: '70px', height: '10px' }} />
                </div>
              </div>
              <div className="skeleton-line" style={{ width: '80%', height: '22px', marginTop: '0.5rem' }} />
              <div className="skeleton-line" style={{ width: '100%', height: '14px' }} />
              <div className="skeleton-line" style={{ width: '90%', height: '14px' }} />
            </div>
            <div className="card-skeleton">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div className="skeleton-line" style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1 }}>
                  <div className="skeleton-line" style={{ width: '140px', height: '14px' }} />
                  <div className="skeleton-line" style={{ width: '80px', height: '10px' }} />
                </div>
              </div>
              <div className="skeleton-line" style={{ width: '75%', height: '22px', marginTop: '0.5rem' }} />
              <div className="skeleton-line" style={{ width: '100%', height: '14px' }} />
            </div>
          </>
        ) : error ? (
          // Error State
          <div className="feed-error-state">
            <div className="empty-state-icon" style={{ backgroundColor: 'var(--danger-red-subtle)', color: 'var(--danger-red)' }}>
              <AlertCircle size={28} />
            </div>
            <h2 className="empty-state-title">Unable to Load Feed</h2>
            <p className="empty-state-desc">{error}</p>
            <button
              type="button"
              className="btn-refresh"
              onClick={() => loadFeed(searchQuery, activeTopic, activeSort)}
              style={{ marginTop: '0.5rem' }}
            >
              <RefreshCw size={14} />
              <span>Retry</span>
            </button>
          </div>
        ) : filteredDocuments.length === 0 ? (
          // Empty State
          <div className="feed-empty-state">
            <div className="empty-state-icon">
              <BookOpen size={28} />
            </div>
            <h2 className="empty-state-title">
              {searchQuery ? 'No Matching Research Papers' : 'No Documents Available Yet'}
            </h2>
            <p className="empty-state-desc">
              {searchQuery
                ? `No documents found matching "${searchQuery}". Try searching for another topic or clear the filter.`
                : 'The library is ready for its first contributions. Publish a paper or preprint to start the discussion.'}
            </p>
            {searchQuery ? (
              <button
                type="button"
                className="btn-refresh"
                onClick={handleClearSearch}
              >
                Clear Search Filter
              </button>
            ) : (
              <button
                type="button"
                className="btn-publish"
                onClick={() => {
                  const publishBtn = document.querySelector('.btn-publish');
                  if (publishBtn) publishBtn.click();
                }}
              >
                <Plus size={16} />
                <span>Publish the First Document</span>
              </button>
            )}
          </div>
        ) : (
          // List of Real Documents
          filteredDocuments.map((doc) => (
            <DocumentCard key={doc.id} doc={doc} />
          ))
        )}
      </div>
    </AppLayout>
  );
}
