import React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, ArrowRight, Sparkles, FileText, Lock, Globe, Trash2 } from 'lucide-react';
import { formatRelativeTime, getInitials } from '../utils/format.js';
import './DocumentCard.css';

export default function DocumentCard({ doc, onDelete }) {
  if (!doc) return null;

  const authorName = doc.uploader_name || `Researcher #${doc.user_id}`;
  const fileType = (doc.file_type || 'pdf').toLowerCase();
  const isPrivate = doc.visibility === 'private';

  // Real topic categorization from backend database (with Uncategorized fallback)
  const topicsList = Array.isArray(doc.topics) && doc.topics.length > 0
    ? doc.topics
    : ['Uncategorized'];

  return (
    <article className="document-card animate-fade-in">
      {/* Header */}
      <div className="card-header">
        <Link to={`/profile/${doc.user_id}`} className="card-author-info">
          <div className="card-avatar">
            {getInitials(authorName)}
          </div>
          <div className="card-author-meta">
            <span className="card-author-name">{authorName}</span>
            <span className="card-timestamp">{formatRelativeTime(doc.created_at)}</span>
          </div>
        </Link>

        <div className="card-badges-right">
          {isPrivate && (
            <span className="badge-format" title="Private document">
              <Lock size={10} style={{ marginRight: '3px' }} />
              Private
            </span>
          )}
          <span className={`badge-format ${fileType}`}>
            {fileType}
          </span>
          {onDelete && (
            <button
              type="button"
              className="btn-card-delete"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(doc);
              }}
              title="Delete Document"
              aria-label="Delete Document"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="card-body">
        <Link to={`/document/${doc.id}`} className="card-title-link">
          <h2 className="card-title">{doc.title}</h2>
        </Link>

        {doc.description && (
          <p className="card-description">{doc.description}</p>
        )}

        <div className="card-tags">
          {topicsList.map((tag) => (
            <span
              key={tag}
              className={`card-tag ${tag.toLowerCase() === 'uncategorized' ? 'uncategorized' : ''}`}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="card-footer">
        <div className="card-footer-left">
          <Link
            to={`/document/${doc.id}?tab=discussion`}
            className="card-footer-action"
            title="Join research discussion"
            aria-label={doc.comment_count !== undefined ? `${doc.comment_count} comments` : 'Discussion'}
          >
            <MessageSquare size={14} />
            <span>
              {doc.comment_count !== undefined
                ? `${doc.comment_count} ${doc.comment_count === 1 ? 'comment' : 'comments'}`
                : 'Discussion'}
            </span>
          </Link>
        </div>

        <div className="card-footer-right">
          <Link to={`/document/${doc.id}`} className="btn-ai-chat-pill">
            <Sparkles size={13} />
            <span>AI Chat</span>
          </Link>
          <Link to={`/document/${doc.id}`} className="btn-read-document">
            <span>Read document</span>
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </article>
  );
}
