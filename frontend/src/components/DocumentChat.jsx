import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  Trash2,
  AlertCircle,
  FileText,
  CornerDownLeft,
  ArrowRight,
} from 'lucide-react';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import MarkdownView from './MarkdownView.jsx';
import './DocumentChat.css';

const SUGGESTED_QUESTIONS = [
  'Summarize the core findings of this research.',
  'What methodology and data sources were used?',
  'What are the primary conclusions and limitations?',
];

export default function DocumentChat({ documentId, docTitle = 'this document' }) {
  const { user, isAuthenticated } = useAuth();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll on new tokens or messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, generating]);

  // Auto-resize textarea dynamically based on content (bounded between 36px and 120px)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!input) {
      el.style.height = '36px';
    } else {
      el.style.height = 'auto';
      const scrollH = el.scrollHeight;
      const clampedHeight = Math.min(Math.max(scrollH, 36), 120);
      el.style.height = `${clampedHeight}px`;
    }
  }, [input]);

  const handleInputChange = (e) => {
    setInput(e.target.value);
  };

  const handleSend = async (questionToSend) => {
    const question = (questionToSend || input).trim();
    if (!question || generating) return;

    if (!isAuthenticated) {
      setError('Please log in to chat with documents and access AI analysis.');
      return;
    }

    // Reset input (height will reset automatically via useEffect)
    setInput('');
    setError(null);

    const userMsgId = Date.now();
    const assistantMsgId = userMsgId + 1;

    // Add user message and empty assistant message
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', text: question },
      { id: assistantMsgId, role: 'assistant', text: '', sources: [] },
    ]);

    setGenerating(true);

    try {
      await api.streamChat(documentId, question, {
        onToken: (token) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, text: m.text + token } : m
            )
          );
        },
        onSources: (sources) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, sources: sources } : m
            )
          );
        },
        onError: (errDetail) => {
          setError(errDetail);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId && !m.text
                ? { ...m, text: 'Unable to complete response generation.' }
                : m
            )
          );
          setGenerating(false);
        },
        onDone: () => {
          setGenerating(false);
        },
      });
    } catch (err) {
      setError(err.message || 'Error occurred while contacting AI assistant.');
      setGenerating(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-title-group">
          <div className="chat-ai-icon">
            <Sparkles size={18} strokeWidth={2.5} />
          </div>
          <div className="chat-header-text">
            <span className="chat-header-title">AI Research Assistant</span>
            <span className="chat-header-status">
              <span className="status-dot" />
              <span>AI Assistant • Ready</span>
            </span>
          </div>
        </div>

        {messages.length > 0 && (
          <button
            type="button"
            className="chat-header-clear"
            onClick={handleClearChat}
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Messages Scroll Area */}
      <div className="chat-messages-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-empty-hero">
            <div className="chat-hero-icon">
              <Sparkles size={24} />
            </div>
            <h3 className="chat-hero-title">Ask about this paper</h3>
            <p className="chat-hero-desc">
              Answers are based directly on this document with clear citations.
            </p>

            <div className="suggested-chips-container">
              {SUGGESTED_QUESTIONS.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="suggested-chip"
                  onClick={() => handleSend(q)}
                  disabled={generating}
                >
                  <span>{q}</span>
                  <ArrowRight size={13} style={{ color: 'var(--ai-indigo)' }} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`chat-msg-row ${msg.role}`}>
              <div className={`chat-msg-avatar ${msg.role === 'user' ? 'user-avatar' : 'ai-avatar'}`}>
                {msg.role === 'user' ? (user?.username?.[0]?.toUpperCase() || 'U') : <Sparkles size={14} />}
              </div>

              <div className="chat-bubble">
                {msg.role === 'user' ? (
                  msg.text
                ) : (
                  <>
                    {msg.text ? (
                      <MarkdownView content={msg.text} />
                    ) : (
                      generating && (
                        <div className="typing-indicator" aria-label="Generating response">
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                          <span className="typing-dot" />
                        </div>
                      )
                    )}

                    {/* Source Citations */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="sources-card">
                        <span className="sources-label">Sources & Citations:</span>
                        <div className="sources-list">
                          {msg.sources.map((src, sIdx) => {
                            const pageInfo = src.page_number ? `Page ${src.page_number}` : null;
                            const sectionInfo = src.chunk_index !== undefined ? `Section ${src.chunk_index + 1}` : null;
                            const label = [pageInfo, sectionInfo].filter(Boolean).join(', ') || `Doc #${src.document_id}`;
                            return (
                              <span key={sIdx} className="source-badge">
                                {label}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))
        )}

        {error && (
          <div style={{
            padding: '0.75rem 1rem',
            backgroundColor: 'var(--danger-red-subtle)',
            border: '1px solid rgba(185, 28, 28, 0.25)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--danger-red)',
            fontSize: '0.8125rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}>
            <AlertCircle size={15} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Input Form */}
      <div className="chat-input-section">
        <div className="chat-input-box">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder={
              isAuthenticated
                ? `Ask anything about "${docTitle}"...`
                : 'Please log in to ask questions about this document'
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={generating || !isAuthenticated}
            rows={1}
            aria-label="Message input"
          />

          <button
            type="button"
            className="chat-send-btn"
            onClick={() => handleSend()}
            disabled={!input.trim() || generating || !isAuthenticated}
            aria-label="Send question"
            title="Send question (Enter)"
          >
            <Send size={15} />
          </button>
        </div>

        <div className="chat-hint-text">
          Press <strong>Enter</strong> to send • <strong>Shift + Enter</strong> for a new line
        </div>
      </div>
    </div>
  );
}
