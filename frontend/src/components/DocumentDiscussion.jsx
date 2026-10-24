import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquare,
  Send,
  Loader2,
  RefreshCw,
  AlertCircle,
  LogIn,
  User,
} from 'lucide-react';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { formatRelativeTime, getInitials } from '../utils/format.js';
import './DocumentDiscussion.css';

export default function DocumentDiscussion({
  documentId,
  docAuthorId,
  onCommentCountChange,
}) {
  const { user, isAuthenticated } = useAuth();

  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Composer state (persisted across failed submission attempts)
  const [commentText, setCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Load comments from backend
  const loadComments = useCallback(async () => {
    if (!documentId) return;

    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await api.getComments(documentId);
      const commentList = Array.isArray(data) ? data : [];
      setComments(commentList);
      if (onCommentCountChange) {
        onCommentCountChange(commentList.length);
      }
    } catch (err) {
      if (err.status === 403) {
        setError('You are not authorized to view comments for this private document.');
      } else if (err.status === 401) {
        setError('Your session has expired. Please log in again.');
      } else {
        setError(err.message || 'Unable to load comments at this time.');
      }
    } finally {
      setLoading(false);
    }
  }, [documentId, isAuthenticated, onCommentCountChange]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // Submit comment handler
  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isSubmitting) return; // Prevent duplicate submissions

    if (!isAuthenticated) {
      setSubmitError('You must be signed in to post comments.');
      return;
    }

    const trimmed = commentText.trim();
    if (!trimmed) {
      setSubmitError('Comment cannot be empty.');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);

      // Call real backend POST /documents/{id}/comments
      const newComment = await api.createComment(documentId, trimmed);

      // Update state without full page reload
      setComments((prev) => {
        const next = [...prev, newComment];
        if (onCommentCountChange) onCommentCountChange(next.length);
        return next;
      });

      // Reset composer text only upon verified server confirmation
      setCommentText('');
    } catch (err) {
      console.error('Failed to post comment:', err);
      // Preserves commentText so the user does not lose their draft
      setSubmitError(err.message || 'Failed to post comment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keyboard shortcut: Ctrl+Enter or Cmd+Enter to submit
  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="document-discussion-panel" aria-label="Peer Research Discussion">
      {/* Header Bar */}
      <div className="discussion-header-bar">
        <div className="discussion-header-left">
          <div className="discussion-icon-badge">
            <MessageSquare size={16} />
          </div>
          <h2 className="discussion-title">
            <span>Peer Discussion</span>
            {isAuthenticated && !loading && !error && (
              <span className="discussion-count-badge">
                {comments.length}
              </span>
            )}
          </h2>
        </div>

        {isAuthenticated && (
          <button
            type="button"
            className="btn-refresh-discussion"
            onClick={loadComments}
            disabled={loading || isSubmitting}
            title="Refresh comments"
            aria-label="Refresh comments"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* Main Body */}
      <div className="discussion-body-scroll">
        {/* Comment Composer */}
        {isAuthenticated ? (
          <form className="discussion-composer-section" onSubmit={handleSubmit}>
            <div className="composer-header-row">
              <div className="composer-user-info">
                <div className="composer-avatar-sm">
                  {getInitials(user?.username || 'You')}
                </div>
                <span>{user?.username || 'Researcher'}</span>
              </div>
              <span className="composer-shortcut-hint">Ctrl + Enter to send</span>
            </div>

            <textarea
              className="discussion-textarea"
              placeholder="Ask a question, share peer-review feedback, or discuss methodologies..."
              value={commentText}
              onChange={(e) => {
                setCommentText(e.target.value);
                if (submitError) setSubmitError(null);
              }}
              onKeyDown={handleKeyDown}
              disabled={isSubmitting}
              rows={3}
              aria-label="Write a peer comment"
            />

            {submitError && (
              <div className="modal-alert error" style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem' }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>{submitError}</span>
              </div>
            )}

            <div className="composer-footer-row">
              <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                {commentText.length > 0 ? `${commentText.length} characters` : ''}
              </span>

              <button
                type="submit"
                className="btn-submit-comment"
                disabled={isSubmitting || !commentText.trim()}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Posting...</span>
                  </>
                ) : (
                  <>
                    <Send size={13} />
                    <span>Post Comment</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          /* Signed-Out Prompt */
          <div className="discussion-auth-prompt">
            <h3 className="auth-prompt-title">Join the Scientific Discussion</h3>
            <p className="auth-prompt-desc">
              Sign in with your DocMe account to read community commentary, ask methodology questions, and participate in peer discussions.
            </p>
            <Link to="/login" className="btn-auth-signin">
              <LogIn size={13} style={{ display: 'inline', marginRight: '4px' }} />
              Log In to Participate
            </Link>
          </div>
        )}

        {/* Loading Skeletons */}
        {loading && (
          <div className="comments-stream-list">
            {[1, 2, 3].map((n) => (
              <div key={n} className="comment-skeleton">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <div className="comment-skeleton-line" style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
                  <div className="comment-skeleton-line" style={{ width: '35%', height: '14px' }} />
                </div>
                <div className="comment-skeleton-line" style={{ width: '90%', height: '14px', marginTop: '4px' }} />
                <div className="comment-skeleton-line" style={{ width: '70%', height: '14px' }} />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="discussion-error-state">
            <div className="discussion-error-icon">
              <AlertCircle size={22} />
            </div>
            <h3 className="discussion-empty-title">Discussion Unavailable</h3>
            <p className="discussion-empty-desc">{error}</p>
            {isAuthenticated && (
              <button
                type="button"
                className="btn-retry-discussion"
                onClick={loadComments}
              >
                <RefreshCw size={12} />
                <span>Retry</span>
              </button>
            )}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && isAuthenticated && comments.length === 0 && (
          <div className="discussion-empty-state">
            <div className="discussion-empty-icon">
              <MessageSquare size={22} />
            </div>
            <h3 className="discussion-empty-title">No comments yet</h3>
            <p className="discussion-empty-desc">
              Be the first to start a conversation, point out interesting findings, or leave feedback for the author.
            </p>
          </div>
        )}

        {/* Comments Stream */}
        {!loading && !error && comments.length > 0 && (
          <div className="comments-stream-list" role="feed" aria-label="Peer comments">
            {comments.map((comment) => {
              const author = comment.author_name || `Researcher #${comment.user_id}`;
              const isDocAuthor = docAuthorId && comment.user_id === docAuthorId;

              return (
                <article key={comment.id} className="comment-card">
                  <header className="comment-card-header">
                    <Link
                      to={`/profile/${comment.user_id}`}
                      className="comment-author-info"
                      title={`View ${author}'s profile`}
                    >
                      <div className="comment-avatar">
                        {getInitials(author)}
                      </div>
                      <div className="comment-meta-col">
                        <div className="comment-author-name-row">
                          <span className="comment-author-name">{author}</span>
                          {isDocAuthor && (
                            <span className="comment-author-badge">Author</span>
                          )}
                        </div>
                        <time
                          className="comment-timestamp"
                          dateTime={comment.created_at}
                          title={new Date(comment.created_at).toLocaleString()}
                        >
                          {formatRelativeTime(comment.created_at)}
                        </time>
                      </div>
                    </Link>
                  </header>

                  <div className="comment-content">
                    {comment.content}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
