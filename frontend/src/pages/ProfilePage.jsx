import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  User,
  FileText,
  ArrowLeft,
  Calendar,
  Mail,
  CheckCircle2,
  Lock,
  Globe,
  Plus,
  Trash2,
  AlertCircle,
  Search,
  BookOpen,
  Info,
} from 'lucide-react';
import AppLayout from '../layouts/AppLayout.jsx';
import DocumentCard from '../components/DocumentCard.jsx';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { getInitials, formatDate } from '../utils/format.js';
import './ProfilePage.css';

export default function ProfilePage() {
  const { id } = useParams();
  const { user: currentUser, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Determine whether this is the authenticated user's own profile
  const targetUserId = id ? parseInt(id, 10) : currentUser?.id;
  const isOwnProfile = Boolean(currentUser && currentUser.id === targetUserId);

  // Profile data & documents state
  const [profile, setProfile] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Tab & Filter states
  const [activeTab, setActiveTab] = useState('documents'); // 'documents' | 'about'
  const [visibilityFilter, setVisibilityFilter] = useState('all'); // 'all' | 'public' | 'private'
  const [localSearch, setLocalSearch] = useState('');

  // Modals state
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [deleteTargetDoc, setDeleteTargetDoc] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Close deletion modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && deleteTargetDoc && !deleting) {
        setDeleteTargetDoc(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteTargetDoc, deleting]);

  // Fetch profile and user documents
  const loadProfile = useCallback(async () => {
    if (!targetUserId) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch user profile metadata
      let userData = null;
      if (isOwnProfile && currentUser) {
        userData = currentUser;
      } else {
        userData = await api.getUserProfile(targetUserId);
      }

      // Fetch documents for profile:
      // If viewing own profile ("My Documents"), use dedicated api.getDocuments('mine')
      // Otherwise fetch public documents for the contributor
      let docs = [];
      if (isOwnProfile) {
        docs = await api.getDocuments('mine');
      } else {
        docs = await api.getContributorDocuments(targetUserId);
      }

      setProfile(userData);
      setDocuments(Array.isArray(docs) ? docs : []);
    } catch (err) {
      console.error('Failed to load profile:', err);
      if (err.status === 404) {
        setError('Contributor profile was not found.');
      } else {
        setError(err.message || 'Unable to load profile data.');
      }
    } finally {
      setLoading(false);
    }
  }, [targetUserId, isOwnProfile, currentUser]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Handle document deletion confirmation
  const handleConfirmDelete = async () => {
    if (!deleteTargetDoc || deleting) return;

    try {
      setDeleting(true);
      setDeleteError(null);
      await api.deleteDocument(deleteTargetDoc.id);

      // Remove from list
      setDocuments((prev) => prev.filter((d) => d.id !== deleteTargetDoc.id));
      setDeleteTargetDoc(null);
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete document. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  // Filter documents by search and visibility
  const filteredDocs = useMemo(() => {
    return documents.filter((doc) => {
      // Visibility filter
      if (visibilityFilter === 'public' && doc.visibility !== 'public') return false;
      if (visibilityFilter === 'private' && doc.visibility !== 'private') return false;

      // Local keyword filter
      if (localSearch.trim()) {
        const query = localSearch.toLowerCase();
        const text = `${doc.title} ${doc.description || ''}`.toLowerCase();
        return text.includes(query);
      }
      return true;
    });
  }, [documents, visibilityFilter, localSearch]);

  const publicCount = documents.filter((d) => d.visibility === 'public').length;
  const privateCount = documents.filter((d) => d.visibility === 'private').length;
  const displayName = profile?.username || (isOwnProfile ? currentUser?.username : `Researcher #${targetUserId}`);

  return (
    <AppLayout
      isPublishOpen={isPublishModalOpen}
      onOpenPublish={() => setIsPublishModalOpen(true)}
      onClosePublish={() => setIsPublishModalOpen(false)}
      onPublishSuccess={(newDoc) => {
        setDocuments((prev) => [newDoc, ...prev]);
      }}
    >
      <div className="profile-page-container">
        {/* Breadcrumb Navigation */}
        <Link to="/" className="profile-back-link">
          <ArrowLeft size={16} />
          <span>Back to Feed</span>
        </Link>

        {loading ? (
          // Skeletons
          <div className="profile-hero-card" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
              <div className="skeleton-line" style={{ width: '84px', height: '84px', borderRadius: '50%' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                <div className="skeleton-line" style={{ width: '180px', height: '24px' }} />
                <div className="skeleton-line" style={{ width: '120px', height: '14px' }} />
              </div>
            </div>
          </div>
        ) : error ? (
          // Error State
          <div className="feed-error-state">
            <AlertCircle size={32} color="var(--danger-red)" />
            <h2 className="empty-state-title">Profile Unavailable</h2>
            <p className="empty-state-desc">{error}</p>
            <Link to="/" className="btn-secondary" style={{ marginTop: '0.5rem' }}>
              Return to Feed
            </Link>
          </div>
        ) : !targetUserId ? (
          // Unauthenticated state when accessing /profile without a user
          <div className="feed-empty-state">
            <User size={36} color="var(--primary-emerald)" />
            <h2 className="empty-state-title">Please Sign In</h2>
            <p className="empty-state-desc">Sign in to view your research profile, personal documents, and account overview.</p>
            <Link to="/login" className="btn-primary" style={{ marginTop: '0.5rem' }}>
              Sign In to DocMe
            </Link>
          </div>
        ) : (
          <>
            {/* Creator Profile Hero Card */}
            <div className="profile-hero-card animate-fade-in">
              <div className="profile-banner" />

              <div className="profile-hero-body">
                {/* Avatar and Action Buttons */}
                <div className="profile-avatar-row">
                  <div className="profile-avatar-wrapper">
                    <div className="profile-avatar-large">
                      {getInitials(displayName)}
                    </div>
                  </div>

                  <div className="profile-hero-actions">
                    {isOwnProfile ? (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => setIsPublishModalOpen(true)}
                        aria-label="Upload Research Document"
                      >
                        <Plus size={16} strokeWidth={2.5} />
                        <span>Upload Document</span>
                      </button>
                    ) : (
                      <div className="badge-account-type">
                        <span>Contributor Profile</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Identity Information */}
                <div className="profile-identity-info">
                  <div className="profile-name-row">
                    <h1 className="profile-display-name">{displayName}</h1>
                    {profile?.is_verified === true && (
                      <span className="badge-verified" title="Verified Researcher Account">
                        <CheckCircle2 size={13} />
                        <span>Verified</span>
                      </span>
                    )}
                    {isOwnProfile && (
                      <span className="badge-account-type">
                        <span>Your Account</span>
                      </span>
                    )}
                  </div>

                  {/* Metadata Row */}
                  <div className="profile-meta-row">
                    <div className="profile-meta-item">
                      <Calendar size={14} />
                      <span>Joined {profile?.created_at ? formatDate(profile.created_at) : 'recently'}</span>
                    </div>

                    {isOwnProfile && profile?.email && (
                      <div className="profile-meta-item">
                        <Mail size={14} />
                        <span>{profile.email}</span>
                      </div>
                    )}

                    <div className="profile-meta-item">
                      <BookOpen size={14} />
                      <span>{documents.length} {documents.length === 1 ? 'publication' : 'publications'}</span>
                    </div>
                  </div>
                </div>

                {/* Contribution Statistics Grid */}
                <div className="profile-stats-grid">
                  <div className="stat-box">
                    <span className="stat-number">{documents.length}</span>
                    <span className="stat-label">
                      {isOwnProfile ? 'Total Documents' : 'Shared Publications'}
                    </span>
                  </div>

                  {isOwnProfile ? (
                    <>
                      <div className="stat-box">
                        <span className="stat-number">{publicCount}</span>
                        <span className="stat-label">Public Preprints</span>
                      </div>

                      <div className="stat-box">
                        <span className="stat-number">{privateCount}</span>
                        <span className="stat-label">Private Papers</span>
                      </div>
                    </>
                  ) : (
                    <div className="stat-box">
                      <span className="stat-number">{publicCount}</span>
                      <span className="stat-label">Public Preprints</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Profile Navigation Tabs */}
            <div className="profile-tabs-bar">
              <div className="profile-nav-tabs" role="tablist">
                <button
                  type="button"
                  className={`profile-tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
                  onClick={() => setActiveTab('documents')}
                  role="tab"
                  aria-selected={activeTab === 'documents'}
                >
                  <FileText size={16} />
                  <span>Research Documents</span>
                  <span className="tab-count-pill">{documents.length}</span>
                </button>

                <button
                  type="button"
                  className={`profile-tab-btn ${activeTab === 'about' ? 'active' : ''}`}
                  onClick={() => setActiveTab('about')}
                  role="tab"
                  aria-selected={activeTab === 'about'}
                >
                  <Info size={16} />
                  <span>About</span>
                </button>
              </div>

              {/* Filters for Documents Tab */}
              {activeTab === 'documents' && documents.length > 0 && (
                <div className="profile-docs-toolbar">
                  {isOwnProfile && (
                    <div className="visibility-filter-group" role="group" aria-label="Filter documents by visibility">
                      <button
                        type="button"
                        className={`filter-pill ${visibilityFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setVisibilityFilter('all')}
                      >
                        All ({documents.length})
                      </button>
                      <button
                        type="button"
                        className={`filter-pill ${visibilityFilter === 'public' ? 'active' : ''}`}
                        onClick={() => setVisibilityFilter('public')}
                      >
                        Public ({publicCount})
                      </button>
                      <button
                        type="button"
                        className={`filter-pill ${visibilityFilter === 'private' ? 'active' : ''}`}
                        onClick={() => setVisibilityFilter('private')}
                      >
                        Private ({privateCount})
                      </button>
                    </div>
                  )}

                  <div className="profile-search-box">
                    <Search className="profile-search-icon" size={14} />
                    <input
                      type="search"
                      className="profile-search-input"
                      placeholder="Filter papers..."
                      value={localSearch}
                      onChange={(e) => setLocalSearch(e.target.value)}
                      aria-label="Filter documents"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Tab 1: Documents List */}
            {activeTab === 'documents' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {filteredDocs.length === 0 ? (
                  <div className="feed-empty-state">
                    <BookOpen size={32} color="var(--primary-emerald)" />
                    <h3 className="empty-state-title">
                      {localSearch ? 'No Matching Papers Found' : 'No Documents Found'}
                    </h3>
                    <p className="empty-state-desc">
                      {localSearch
                        ? `No documents matched "${localSearch}". Try clearing your filter.`
                        : isOwnProfile
                        ? "You haven't uploaded any research documents yet. Share your findings or preprints with the scientific community."
                        : 'This researcher has not published any public documents yet.'}
                    </p>
                    {isOwnProfile && !localSearch && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => setIsPublishModalOpen(true)}
                        style={{ marginTop: '0.5rem' }}
                      >
                        <Plus size={16} />
                        <span>Upload Your First Document</span>
                      </button>
                    )}
                  </div>
                ) : (
                  filteredDocs.map((doc) => (
                    <DocumentCard
                      key={doc.id}
                      doc={doc}
                      onDelete={isOwnProfile ? (d) => setDeleteTargetDoc(d) : undefined}
                    />
                  ))
                )}
              </div>
            )}

            {/* Tab 2: About Overview */}
            {activeTab === 'about' && (
              <div className="profile-about-card animate-fade-in">
                <h3 className="about-section-title">
                  <User size={18} style={{ color: 'var(--primary-emerald)' }} />
                  <span>Researcher Details</span>
                </h3>

                <div className="about-info-list">
                  <div className="about-info-item">
                    <span className="about-info-label">Full Username</span>
                    <span className="about-info-value">{displayName}</span>
                  </div>

                  {isOwnProfile && profile?.email && (
                    <div className="about-info-item">
                      <span className="about-info-label">Email Address</span>
                      <span className="about-info-value">{profile.email}</span>
                    </div>
                  )}

                  <div className="about-info-item">
                    <span className="about-info-label">Member Since</span>
                    <span className="about-info-value">{profile?.created_at ? formatDate(profile.created_at) : 'N/A'}</span>
                  </div>

                  <div className="about-info-item">
                    <span className="about-info-label">Verification Status</span>
                    <span className="about-info-value" style={{ color: profile?.is_verified === true ? 'var(--primary-emerald)' : 'var(--text-secondary)' }}>
                      {profile?.is_verified === true ? 'Verified Researcher Account' : 'Standard Account'}
                    </span>
                  </div>

                  <div className="about-info-item">
                    <span className="about-info-label">Platform Role</span>
                    <span className="about-info-value">Research Author & Peer Contributor</span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Delete Confirmation Modal */}
        {deleteTargetDoc && (
          <div className="modal-backdrop" onClick={() => !deleting && setDeleteTargetDoc(null)} role="dialog" aria-modal="true">
            <div className="modal-dialog animate-fade-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }}>
              <div className="modal-header">
                <h3 className="modal-title" style={{ color: 'var(--danger-red)' }}>Delete Document</h3>
              </div>

              <div className="modal-form" style={{ gap: '1rem' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                  Are you sure you want to delete <strong>"{deleteTargetDoc.title}"</strong>?
                </p>

                <div className="delete-dialog-alert">
                  <strong>Warning:</strong> This action cannot be undone. The document and its conversation history will be permanently deleted.
                </div>

                {deleteError && (
                  <div className="modal-alert error">
                    <AlertCircle size={15} style={{ display: 'inline', marginRight: '6px' }} />
                    {deleteError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setDeleteTargetDoc(null)}
                    disabled={deleting}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={handleConfirmDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting...' : 'Delete Permanently'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
