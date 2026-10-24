import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Search,
  X,
  Compass,
  TrendingUp,
  Award,
  BookOpen,
  Sparkles,
  MessageSquare,
  ArrowRight,
  Cpu,
  Laptop,
  FlaskConical,
  Scale,
  CircleDollarSign,
  HeartPulse,
  FileText,
  AlertCircle,
  RefreshCw,
  SearchX,
} from 'lucide-react';
import AppLayout from '../layouts/AppLayout.jsx';
import DocumentCard from '../components/DocumentCard.jsx';
import { api } from '../services/api.js';
import { getInitials, formatRelativeTime } from '../utils/format.js';
import './ExplorePage.css';

// Research Topic Shortcuts (keyword navigation aids, not stored database categories)
const TOPIC_SHORTCUTS = [
  { label: 'Artificial Intelligence', icon: Cpu, keyword: 'Artificial Intelligence' },
  { label: 'Technology', icon: Laptop, keyword: 'Technology' },
  { label: 'Science', icon: FlaskConical, keyword: 'Science' },
  { label: 'Policy & Governance', icon: Scale, keyword: 'Policy & Governance' },
  { label: 'Economics', icon: CircleDollarSign, keyword: 'Economics' },
  { label: 'Medicine', icon: HeartPulse, keyword: 'Medicine' },
  { label: 'General Research', icon: FileText, keyword: 'General Research' },
];

export default function ExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get('q') || '';

  // Search input state
  const [searchInput, setSearchInput] = useState(queryParam);
  const [activeSort, setActiveSort] = useState('relevance'); // 'relevance' | 'latest' | 'discussed'

  // Discovery mode data states
  const [popularDocs, setPopularDocs] = useState([]);
  const [loadingPopular, setLoadingPopular] = useState(true);
  const [popularError, setPopularError] = useState(null);

  const [contributors, setContributors] = useState([]);
  const [loadingContributors, setLoadingContributors] = useState(true);
  const [contributorsError, setContributorsError] = useState(null);

  const [latestDocs, setLatestDocs] = useState([]);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [latestError, setLatestError] = useState(null);

  // Search mode data states
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Synchronize local input state whenever URL query changes (e.g., from Navbar or browser back)
  useEffect(() => {
    setSearchInput(queryParam);
  }, [queryParam]);

  // Load discovery data (Popular, Contributors, Latest) when not searching
  const loadDiscoveryData = useCallback(async () => {
    // 1. Fetch Popular Public Documents
    setLoadingPopular(true);
    setPopularError(null);
    try {
      const data = await api.getPopularDocuments();
      setPopularDocs(Array.isArray(data) ? data.slice(0, 6) : []);
    } catch (err) {
      setPopularError(err.message || 'Unable to load popular documents');
    } finally {
      setLoadingPopular(false);
    }

    // 2. Fetch Top Contributors
    setLoadingContributors(true);
    setContributorsError(null);
    try {
      const data = await api.getUserRanking();
      setContributors(Array.isArray(data) ? data.slice(0, 8) : []);
    } catch (err) {
      setContributorsError(err.message || 'Unable to load contributors');
    } finally {
      setLoadingContributors(false);
    }

    // 3. Fetch Latest Research Feed
    setLoadingLatest(true);
    setLatestError(null);
    try {
      const data = await api.getFeed();
      setLatestDocs(Array.isArray(data) ? data.slice(0, 8) : []);
    } catch (err) {
      setLatestError(err.message || 'Unable to load latest research');
    } finally {
      setLoadingLatest(false);
    }
  }, []);

  // Execute search when queryParam is present
  const executeSearch = useCallback(async (query) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    try {
      const data = await api.searchDocuments(trimmed, 30);
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err) {
      setSearchError(err.message || 'Search failed. Please try again.');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Effect triggering search or discovery fetch based on URL query
  useEffect(() => {
    if (queryParam.trim()) {
      executeSearch(queryParam);
    } else {
      loadDiscoveryData();
    }
  }, [queryParam, executeSearch, loadDiscoveryData]);

  // Handle search form submit
  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    const trimmed = searchInput.trim();
    if (trimmed) {
      setSearchParams({ q: trimmed });
    } else {
      setSearchParams({});
    }
  };

  // Clear search and restore discovery mode
  const handleClearSearch = () => {
    setSearchInput('');
    setSearchParams({});
    setSearchResults([]);
    setSearchError(null);
  };

  // Click on a research topic shortcut
  const handleTopicClick = (topicKeyword) => {
    if (queryParam.toLowerCase() === topicKeyword.toLowerCase()) {
      // Toggle off if already active
      handleClearSearch();
    } else {
      setSearchInput(topicKeyword);
      setSearchParams({ q: topicKeyword });
    }
  };

  // Sorted search results based on activeSort
  const sortedSearchResults = useMemo(() => {
    if (!searchResults || searchResults.length === 0) return [];
    const list = [...searchResults];

    if (activeSort === 'latest') {
      return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    if (activeSort === 'discussed') {
      return list.sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0));
    }
    // Default: 'relevance' (as ranked by backend semantic & text search)
    return list;
  }, [searchResults, activeSort]);

  const isSearchMode = Boolean(queryParam.trim());

  return (
    <AppLayout
      searchQuery={searchInput}
      onSearchChange={setSearchInput}
      onSearchSubmit={(val) => {
        const trimmed = (val ?? searchInput).trim();
        if (trimmed) setSearchParams({ q: trimmed });
        else setSearchParams({});
      }}
      activeTopic={queryParam || 'Explore'}
      onSelectTopic={(topic) => {
        if (topic === 'All Topics') {
          handleClearSearch();
        } else {
          handleTopicClick(topic);
        }
      }}
    >
      <div className="explore-page-container">
        {/* Explore Hero Header */}
        <section className="explore-hero-card" aria-label="Explore Header">
          <div className="explore-hero-titles">
            <h1 className="explore-hero-title">Explore Research</h1>
            <p className="explore-hero-subtitle">
              Discover ideas, research papers, and knowledge shared by the community.
            </p>
          </div>

          {/* Search Input Box */}
          <form className="explore-search-form" onSubmit={handleSearchSubmit}>
            <Search className="explore-search-icon" size={18} />
            <input
              type="search"
              className="explore-search-input"
              placeholder="Search by keywords, research topics, or author names..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search research documents"
            />
            <div className="explore-search-actions">
              {searchInput && (
                <button
                  type="button"
                  className="explore-clear-btn"
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                >
                  <X size={16} />
                </button>
              )}
              <button type="submit" className="explore-submit-btn">
                <span>Search</span>
              </button>
            </div>
          </form>

          {/* Research Topic Shortcuts */}
          <div className="explore-topics-section" aria-label="Research Topics">
            <div className="topics-section-header">
              <span className="topics-header-title">Research Topics</span>
              <span className="topics-hint-badge">Keyword shortcuts</span>
            </div>
            <div className="topics-chips-scroll" role="list">
              {TOPIC_SHORTCUTS.map((topic) => {
                const IconComponent = topic.icon;
                const isSelected = queryParam.toLowerCase() === topic.keyword.toLowerCase();
                return (
                  <button
                    key={topic.label}
                    type="button"
                    className={`topic-shortcut-chip ${isSelected ? 'active' : ''}`}
                    onClick={() => handleTopicClick(topic.keyword)}
                    aria-pressed={isSelected}
                  >
                    <IconComponent size={14} />
                    <span>{topic.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* --- CONDITIONAL VIEW: SEARCH RESULTS VS DISCOVERY SECTIONS --- */}
        {isSearchMode ? (
          /* ACTIVE SEARCH RESULTS */
          <section className="explore-section" aria-label="Search Results">
            <div className="search-results-bar">
              <div className="search-results-info">
                <h2 className="search-results-title">
                  Results for &ldquo;{queryParam}&rdquo;
                </h2>
                <span className="search-results-count">
                  {isSearching
                    ? 'Searching research index...'
                    : `Showing ${sortedSearchResults.length} ${
                        sortedSearchResults.length === 1 ? 'matching paper' : 'matching papers'
                      }`}
                </span>
              </div>

              {/* Sorting and Clear Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div className="search-sort-group">
                  <label htmlFor="search-sort-select" className="search-sort-label">
                    Sort by:
                  </label>
                  <select
                    id="search-sort-select"
                    className="search-sort-select"
                    value={activeSort}
                    onChange={(e) => setActiveSort(e.target.value)}
                  >
                    <option value="relevance">Relevant Search Results</option>
                    <option value="latest">Latest</option>
                    <option value="discussed">Most Discussed</option>
                  </select>
                </div>

                <button
                  type="button"
                  className="btn-reset-search"
                  onClick={handleClearSearch}
                  aria-label="Clear search"
                >
                  <X size={14} />
                  <span>Clear Search</span>
                </button>
              </div>
            </div>

            {/* Loading State */}
            {isSearching && (
              <div className="explore-documents-stream">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="explore-skeleton-card">
                    <div className="explore-skeleton-line" style={{ height: '14px', width: '35%' }} />
                    <div className="explore-skeleton-line" style={{ height: '20px', width: '75%' }} />
                    <div className="explore-skeleton-line" style={{ height: '14px', width: '90%' }} />
                  </div>
                ))}
              </div>
            )}

            {/* Error State */}
            {!isSearching && searchError && (
              <div className="explore-error-state">
                <div className="error-state-icon">
                  <AlertCircle size={24} />
                </div>
                <h3 className="empty-state-title">Search Error</h3>
                <p className="empty-state-desc">{searchError}</p>
                <button
                  type="button"
                  className="btn-retry"
                  onClick={() => executeSearch(queryParam)}
                >
                  <RefreshCw size={14} />
                  <span>Retry Search</span>
                </button>
              </div>
            )}

            {/* Empty State */}
            {!isSearching && !searchError && sortedSearchResults.length === 0 && (
              <div className="explore-empty-state">
                <div className="empty-state-icon">
                  <SearchX size={26} />
                </div>
                <h3 className="empty-state-title">No matching research found</h3>
                <p className="empty-state-desc">
                  We couldn&apos;t find any papers matching &ldquo;{queryParam}&rdquo;. Try using different
                  keywords or explore one of our topic shortcuts.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="btn-reset-search"
                    onClick={handleClearSearch}
                  >
                    <span>Back to Discovery</span>
                  </button>
                </div>
              </div>
            )}

            {/* Results Stream */}
            {!isSearching && !searchError && sortedSearchResults.length > 0 && (
              <div className="explore-documents-stream">
                {sortedSearchResults.map((doc) => (
                  <DocumentCard key={doc.id} doc={doc} />
                ))}
              </div>
            )}
          </section>
        ) : (
          /* DISCOVERY SECTIONS */
          <>
            {/* 1. Popular Documents */}
            <section className="explore-section" aria-label="Popular Documents">
              <div className="explore-section-header">
                <h2 className="explore-section-title">
                  <TrendingUp size={18} style={{ color: 'var(--primary-emerald)' }} />
                  <span>Popular Documents</span>
                </h2>
                <Link to="/feed" className="topics-hint-badge" style={{ textDecoration: 'none' }}>
                  View All Feed →
                </Link>
              </div>

              {loadingPopular ? (
                <div className="popular-cards-grid">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="explore-skeleton-card" style={{ height: '110px' }} />
                  ))}
                </div>
              ) : popularError ? (
                <div className="explore-error-state" style={{ padding: '1.5rem' }}>
                  <p className="empty-state-desc">{popularError}</p>
                </div>
              ) : popularDocs.length === 0 ? (
                <div className="explore-empty-state" style={{ padding: '1.5rem' }}>
                  <p className="empty-state-desc">No popular documents available yet.</p>
                </div>
              ) : (
                <div className="popular-cards-grid">
                  {popularDocs.map((doc) => (
                    <Link
                      key={doc.id}
                      to={`/document/${doc.id}`}
                      className="popular-feature-card"
                    >
                      <h3 className="popular-card-title">{doc.title}</h3>
                      <div className="popular-card-footer">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <MessageSquare size={13} />
                          <span>{doc.comment_count ?? 0} {doc.comment_count === 1 ? 'comment' : 'comments'}</span>
                        </span>
                        <span>{formatRelativeTime(doc.created_at)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* 2. Top Contributors */}
            <section className="explore-section" aria-label="Top Contributors">
              <div className="explore-section-header">
                <h2 className="explore-section-title">
                  <Award size={18} style={{ color: 'var(--accent-amber)' }} />
                  <span>Top Contributors</span>
                </h2>
                <span className="topics-hint-badge">By shared documents</span>
              </div>

              {loadingContributors ? (
                <div className="contributors-grid">
                  {[1, 2, 3, 4].map((n) => (
                    <div key={n} className="explore-skeleton-card" style={{ height: '70px' }} />
                  ))}
                </div>
              ) : contributorsError ? (
                <div className="explore-error-state" style={{ padding: '1.5rem' }}>
                  <p className="empty-state-desc">{contributorsError}</p>
                </div>
              ) : contributors.length === 0 ? (
                <div className="explore-empty-state" style={{ padding: '1.5rem' }}>
                  <p className="empty-state-desc">No contributors found.</p>
                </div>
              ) : (
                <div className="contributors-grid">
                  {contributors.map((contributor) => (
                    <Link
                      key={contributor.user_id}
                      to={`/profile/${contributor.user_id}`}
                      className="contributor-profile-card"
                    >
                      <div className="contributor-card-avatar">
                        {getInitials(contributor.username)}
                      </div>
                      <div className="contributor-card-info">
                        <span className="contributor-card-username">{contributor.username}</span>
                        <span className="contributor-card-count">
                          {contributor.document_count} {contributor.document_count === 1 ? 'document' : 'documents'}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* 3. Latest Research */}
            <section className="explore-section" aria-label="Latest Research">
              <div className="explore-section-header">
                <h2 className="explore-section-title">
                  <BookOpen size={18} style={{ color: 'var(--accent-indigo)' }} />
                  <span>Latest Research</span>
                </h2>
              </div>

              {loadingLatest ? (
                <div className="explore-documents-stream">
                  {[1, 2, 3].map((n) => (
                    <div key={n} className="explore-skeleton-card">
                      <div className="explore-skeleton-line" style={{ height: '14px', width: '30%' }} />
                      <div className="explore-skeleton-line" style={{ height: '22px', width: '70%' }} />
                      <div className="explore-skeleton-line" style={{ height: '14px', width: '90%' }} />
                    </div>
                  ))}
                </div>
              ) : latestError ? (
                <div className="explore-error-state">
                  <div className="error-state-icon">
                    <AlertCircle size={24} />
                  </div>
                  <h3 className="empty-state-title">Unable to load feed</h3>
                  <p className="empty-state-desc">{latestError}</p>
                  <button type="button" className="btn-retry" onClick={loadDiscoveryData}>
                    <RefreshCw size={14} />
                    <span>Retry</span>
                  </button>
                </div>
              ) : latestDocs.length === 0 ? (
                <div className="explore-empty-state">
                  <div className="empty-state-icon">
                    <BookOpen size={24} />
                  </div>
                  <h3 className="empty-state-title">No documents published yet</h3>
                  <p className="empty-state-desc">
                    Be the first to share a research paper or knowledge document with the community.
                  </p>
                </div>
              ) : (
                <div className="explore-documents-stream">
                  {latestDocs.map((doc) => (
                    <DocumentCard key={doc.id} doc={doc} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppLayout>
  );
}
