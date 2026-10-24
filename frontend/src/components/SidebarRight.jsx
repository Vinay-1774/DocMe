import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Award, Sparkles, MessageSquare, ExternalLink } from 'lucide-react';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { getInitials } from '../utils/format.js';
import './SidebarRight.css';

export default function SidebarRight() {
  const { isAuthenticated } = useAuth();
  const [popularDocs, setPopularDocs] = useState([]);
  const [loadingPopular, setLoadingPopular] = useState(true);
  const [popularError, setPopularError] = useState(null);

  const [rankings, setRankings] = useState([]);
  const [loadingRankings, setLoadingRankings] = useState(true);
  const [rankingError, setRankingError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchPopular() {
      if (!isAuthenticated) {
        if (isMounted) setLoadingPopular(false);
        return;
      }
      try {
        setLoadingPopular(true);
        const data = await api.getPopularDocuments();
        if (isMounted) {
          setPopularDocs(Array.isArray(data) ? data.slice(0, 5) : []);
        }
      } catch (err) {
        if (isMounted) setPopularError(err.message || 'Could not load popular documents');
      } finally {
        if (isMounted) setLoadingPopular(false);
      }
    }

    async function fetchRankings() {
      if (!isAuthenticated) {
        if (isMounted) setLoadingRankings(false);
        return;
      }
      try {
        setLoadingRankings(true);
        const data = await api.getUserRanking();
        if (isMounted) {
          setRankings(Array.isArray(data) ? data.slice(0, 5) : []);
        }
      } catch (err) {
        if (isMounted) setRankingError(err.message || 'Could not load rankings');
      } finally {
        if (isMounted) setLoadingRankings(false);
      }
    }

    fetchPopular();
    fetchRankings();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <aside className="sidebar-right" aria-label="Discovery & Contributors">
      {/* Popular Documents */}
      <div className="discovery-widget">
        <div className="widget-header">
          <div className="widget-title-group">
            <TrendingUp size={16} className="widget-icon-emerald" />
            <span>Popular Documents</span>
          </div>
        </div>

        {loadingPopular ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div className="widget-skeleton" />
            <div className="widget-skeleton" />
            <div className="widget-skeleton" />
          </div>
        ) : popularError ? (
          <div className="widget-empty-text">Unavailable at the moment</div>
        ) : popularDocs.length === 0 ? (
          <div className="widget-empty-text">No popular documents yet</div>
        ) : (
          popularDocs.map((doc) => (
            <Link
              key={doc.id}
              to={`/document/${doc.id}`}
              className="popular-doc-item"
            >
              <span className="popular-doc-title">{doc.title}</span>
              <div className="popular-doc-meta">
                <span className="comment-badge">
                  <MessageSquare size={12} />
                  <span>{doc.comment_count ?? 0}</span>
                </span>
                <span>•</span>
                <span>Open →</span>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Contributor Leaderboard */}
      <div className="discovery-widget">
        <div className="widget-header">
          <div className="widget-title-group">
            <Award size={16} className="widget-icon-amber" />
            <span>Top Contributors</span>
          </div>
        </div>

        {loadingRankings ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div className="widget-skeleton" />
            <div className="widget-skeleton" />
          </div>
        ) : rankingError ? (
          <div className="widget-empty-text">Leaderboard unavailable</div>
        ) : rankings.length === 0 ? (
          <div className="widget-empty-text">No contributors yet</div>
        ) : (
          rankings.map((user, idx) => (
            <Link
              key={user.user_id}
              to={`/profile/${user.user_id}`}
              className="ranking-item"
            >
              <div className="ranking-user-info">
                <span className={`ranking-rank-num ${idx < 3 ? 'top' : ''}`}>
                  {idx + 1}
                </span>
                <div className="ranking-avatar">
                  {getInitials(user.username)}
                </div>
                <span className="ranking-username">{user.username}</span>
              </div>
              <span className="ranking-doc-count">
                {user.document_count} {user.document_count === 1 ? 'doc' : 'docs'}
              </span>
            </Link>
          ))
        )}
      </div>

      {/* AI Assistant Callout */}
      <div className="ai-assistant-widget">
        <div className="widget-header">
          <div className="widget-title-group">
            <Sparkles size={16} className="widget-icon-indigo" />
            <span>AI Research Assistant</span>
          </div>
        </div>
        <p>
          Ask questions against any paper in our library. Powered by LangGraph RAG with inline citations and document chunk retrieval.
        </p>
      </div>
    </aside>
  );
}
