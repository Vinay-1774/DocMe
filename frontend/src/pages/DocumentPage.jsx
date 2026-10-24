import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Download,
  FileText,
  Sparkles,
  MessageSquare,
  AlertCircle,
  Lock,
} from 'lucide-react';
import PdfViewer from '../components/PdfViewer.jsx';
import DocumentChat from '../components/DocumentChat.jsx';
import DocumentDiscussion from '../components/DocumentDiscussion.jsx';
import ProtectedRoute from '../components/ProtectedRoute.jsx';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { formatRelativeTime } from '../utils/format.js';
import './DocumentPage.css';

export default function DocumentPage() {
  return (
    <ProtectedRoute>
      <DocumentPageContent />
    </ProtectedRoute>
  );
}

function DocumentPageContent() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth();

  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState(null);

  // Active tabs
  const initialTab = searchParams.get('tab') === 'discussion' ? 'discussion' : 'chat';
  const initialMobileTab = searchParams.get('tab') === 'discussion' ? 'discussion' : 'reader';
  const [activeRightTab, setActiveRightTab] = useState(initialTab); // 'chat' | 'discussion'
  const [mobileTab, setMobileTab] = useState(initialMobileTab); // 'reader' | 'chat' | 'discussion'
  const [commentCount, setCommentCount] = useState(null);

  const fetchDoc = React.useCallback(async () => {
    try {
      setLoading(true);
      setErrorState(null);
      const data = await api.getDocument(id);
      setDoc(data);
    } catch (err) {
      const status = err.status || 0;
      if (status === 401) {
        setErrorState({
          status: 401,
          title: 'Sign In Required',
          message: 'Please log in to view this private document.',
        });
      } else if (status === 403) {
        setErrorState({
          status: 403,
          title: 'Access Restricted',
          message: "You don't have permission to view this private document.",
        });
      } else if (status === 404) {
        setErrorState({
          status: 404,
          title: 'Document Not Found',
          message: 'This document could not be found or has been removed.',
        });
      } else {
        setErrorState({
          status,
          title: 'Unable to Load Document',
          message: err.message || "Couldn't load document details. Please check your connection and try again.",
        });
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  // Synchronize when URL tab parameter changes
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'discussion') {
      setActiveRightTab('discussion');
      setMobileTab('discussion');
    } else if (tab === 'chat') {
      setActiveRightTab('chat');
      setMobileTab('chat');
    }
  }, [searchParams]);

  const authorName = doc?.uploader_name || `Researcher #${doc?.user_id}`;
  const isPrivate = doc?.visibility === 'private';
  const fileType = (doc?.file_type || 'pdf').toLowerCase();

  return (
    <div className="document-workspace-page">
      {/* Top Workspace Header */}
      <header className="workspace-header-bar">
        <div className="workspace-nav-left">
          <Link to="/" className="workspace-back-btn">
            <ArrowLeft size={16} />
            <span>Feed</span>
          </Link>

          {doc && (
            <div className="workspace-doc-meta">
              <h1 className="workspace-doc-title" title={doc.title}>
                {doc.title}
              </h1>
              <div className="workspace-author-line">
                <span>By</span>
                <Link to={`/profile/${doc.user_id}`} className="workspace-author-link">
                  {authorName}
                </Link>
                <span>•</span>
                <span>{formatRelativeTime(doc.created_at)}</span>
                {isPrivate && (
                  <>
                    <span>•</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--highlight-amber)' }}>
                      <Lock size={11} />
                      <span>Private</span>
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {doc && (
          <div className="workspace-actions-right">
            <button
              type="button"
              className="workspace-back-btn"
              onClick={() => {
                setActiveRightTab('discussion');
                setMobileTab('discussion');
              }}
              aria-label="Jump to Peer Discussion"
              title="Peer Discussion"
            >
              <MessageSquare size={14} style={{ color: 'var(--primary-emerald)' }} />
              <span>Discussion {commentCount !== null ? `(${commentCount})` : ''}</span>
            </button>

            <button
              type="button"
              className="pdf-btn-download"
              onClick={() => api.downloadDocument(doc.id)}
              aria-label="Download Document"
            >
              <Download size={14} />
              <span>Download</span>
            </button>
          </div>
        )}
      </header>

      {/* Mobile Tab Switcher */}
      <div className="mobile-view-tabs" role="tablist">
        <button
          type="button"
          className={`mobile-view-tab-btn ${mobileTab === 'reader' ? 'active' : ''}`}
          onClick={() => setMobileTab('reader')}
          role="tab"
          aria-selected={mobileTab === 'reader'}
          aria-label="View Document Reader"
        >
          <FileText size={15} />
          <span>Reader</span>
        </button>
        <button
          type="button"
          className={`mobile-view-tab-btn ${mobileTab === 'chat' ? 'active' : ''}`}
          onClick={() => {
            setMobileTab('chat');
            setActiveRightTab('chat');
          }}
          role="tab"
          aria-selected={mobileTab === 'chat'}
          aria-label="View AI Assistant"
        >
          <Sparkles size={15} style={{ color: 'var(--ai-indigo)' }} />
          <span>AI Assistant</span>
        </button>
        <button
          type="button"
          className={`mobile-view-tab-btn ${mobileTab === 'discussion' ? 'active' : ''}`}
          onClick={() => {
            setMobileTab('discussion');
            setActiveRightTab('discussion');
          }}
          role="tab"
          aria-selected={mobileTab === 'discussion'}
          aria-label="View Peer Discussion"
        >
          <MessageSquare size={15} style={{ color: 'var(--primary-emerald)' }} />
          <span>Discussion {commentCount !== null ? `(${commentCount})` : ''}</span>
        </button>
      </div>

      {/* Main Workspace Body */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '3rem' }}>
          <div className="pdf-spinner" />
        </div>
      ) : errorState ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '2rem' }}>
          <div className="feed-error-state" style={{ maxWidth: '480px' }}>
            <AlertCircle size={32} color="var(--danger-red)" />
            <h2 className="empty-state-title">{errorState.title}</h2>
            <p className="empty-state-desc">{errorState.message}</p>
            {errorState.status === 401 && !isAuthenticated && (
              <Link to={`/login?from=${encodeURIComponent(`/document/${id}`)}`} className="btn-primary" style={{ marginTop: '0.5rem' }}>
                Sign In to Access
              </Link>
            )}
            {(errorState.status === 0 || errorState.status >= 500) && (
              <button
                type="button"
                onClick={fetchDoc}
                className="btn-primary"
                style={{ marginTop: '0.5rem' }}
              >
                Try Again
              </button>
            )}
            <Link to="/" className="btn-secondary" style={{ marginTop: '0.25rem' }}>
              Return to Feed
            </Link>
          </div>
        </div>
      ) : doc ? (
        <div className={`workspace-grid show-${mobileTab}`}>
          {/* Reader Column */}
          <div className="workspace-reader-col">
            <PdfViewer
              documentId={doc.id}
              fileType={fileType}
              docTitle={doc.title}
            />
          </div>

          {/* Right Column: AI Assistant or Peer Discussion */}
          <div className="workspace-chat-col">
            {/* Desktop Right Column Tabs */}
            <div className="workspace-right-tabs-bar" role="tablist">
              <button
                type="button"
                className={`workspace-right-tab-btn ${activeRightTab === 'chat' ? 'active' : ''}`}
                onClick={() => {
                  setActiveRightTab('chat');
                  setMobileTab('chat');
                }}
                role="tab"
                aria-selected={activeRightTab === 'chat'}
              >
                <Sparkles size={14} style={{ color: 'var(--ai-indigo)' }} />
                <span>AI Assistant</span>
              </button>
              <button
                type="button"
                className={`workspace-right-tab-btn ${activeRightTab === 'discussion' ? 'active' : ''}`}
                onClick={() => {
                  setActiveRightTab('discussion');
                  setMobileTab('discussion');
                }}
                role="tab"
                aria-selected={activeRightTab === 'discussion'}
              >
                <MessageSquare size={14} style={{ color: 'var(--primary-emerald)' }} />
                <span>Peer Discussion</span>
                {commentCount !== null && (
                  <span className="workspace-tab-badge">{commentCount}</span>
                )}
              </button>
            </div>

            {/* Active Content Panel */}
            {activeRightTab === 'chat' && mobileTab !== 'discussion' ? (
              <DocumentChat
                documentId={doc.id}
                docTitle={doc.title}
              />
            ) : (
              <DocumentDiscussion
                documentId={doc.id}
                docAuthorId={doc.user_id}
                onCommentCountChange={(count) => setCommentCount(count)}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
