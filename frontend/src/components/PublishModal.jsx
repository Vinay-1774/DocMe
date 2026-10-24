import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud,
  X,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Globe,
  Lock,
  ArrowRight,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../services/api.js';
import './PublishModal.css';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB matching backend MAX_UPLOAD_SIZE_MB
const ALLOWED_EXTENSIONS = ['pdf', 'docx'];

export default function PublishModal({ isOpen, onClose, onSuccess }) {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // Form Fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [file, setFile] = useState(null);

  // UI & Validation States
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [successDoc, setSuccessDoc] = useState(null);

  const fileInputRef = useRef(null);

  // Reset form when modal opens or closes
  const resetForm = useCallback(() => {
    setTitle('');
    setDescription('');
    setVisibility('public');
    setFile(null);
    setError(null);
    setFieldErrors({});
    setIsDragging(false);
    setLoading(false);
    setSuccessDoc(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, resetForm]);

  // Keyboard accessibility (Escape key to dismiss when not uploading)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !loading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  // File validation helper
  const validateAndProcessFile = (candidateFile) => {
    if (!candidateFile) return false;

    const ext = candidateFile.name.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`Unsupported file format ".${ext || 'unknown'}". Only PDF (.pdf) and Word (.docx) files are supported.`);
      setFile(null);
      return false;
    }

    if (candidateFile.size > MAX_UPLOAD_BYTES) {
      const mbSize = (candidateFile.size / (1024 * 1024)).toFixed(1);
      setError(`File size exceeds maximum allowed 20MB limit (selected file is ${mbSize}MB).`);
      setFile(null);
      return false;
    }

    setError(null);
    setFieldErrors((prev) => ({ ...prev, file: null }));
    setFile(candidateFile);

    // Auto-populate document title if title is currently empty
    if (!title.trim()) {
      const cleanName = candidateFile.name
        .replace(/\.[^/.]+$/, '')
        .replace(/[-_]/g, ' ')
        .trim();
      if (cleanName) {
        setTitle(cleanName);
      }
    }
    return true;
  };

  // Drag and drop handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!loading) setIsDragging(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!loading) setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (loading) return;

    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      validateAndProcessFile(dropped);
    }
  };

  const handleFileInputChange = (e) => {
    const selected = e.target.files?.[0];
    if (selected) {
      validateAndProcessFile(selected);
    }
  };

  const handleRemoveFile = (e) => {
    e.stopPropagation();
    if (loading) return;
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // Prevent duplicate submission

    // Auth guard
    if (!isAuthenticated) {
      onClose();
      navigate('/login');
      return;
    }

    // Client-side field validations
    const errors = {};
    if (!title.trim()) {
      errors.title = 'Document title is required.';
    }
    if (!file) {
      errors.file = 'Please select a document file (.pdf or .docx).';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError('Please resolve the required fields before publishing.');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setFieldErrors({});

      const formData = new FormData();
      formData.append('title', title.trim());
      if (description.trim()) {
        formData.append('description', description.trim());
      }
      formData.append('visibility', visibility);
      formData.append('file', file);

      // Call centralized API client
      const createdDoc = await api.uploadDocument(formData);

      if (!createdDoc || !createdDoc.id) {
        throw new Error('Upload completed but server did not return a valid document record.');
      }

      // Transition to success view and notify parent listener
      setSuccessDoc(createdDoc);
      if (onSuccess) {
        onSuccess(createdDoc);
      }
    } catch (err) {
      console.error('Document upload error:', err);
      setError(err.message || 'Failed to upload document. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fileExtension = file ? file.name.split('.').pop()?.toLowerCase() : '';
  const formattedFileSize = file
    ? file.size > 1024 * 1024
      ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.round(file.size / 1024)} KB`
    : '';

  return (
    <div
      className="modal-backdrop"
      onClick={() => !loading && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-modal-title"
    >
      <div
        className="modal-dialog animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge">
              <UploadCloud size={18} strokeWidth={2.5} />
            </div>
            <h2 id="publish-modal-title" className="modal-title">
              {successDoc ? 'Publication Successful' : 'Publish Research Document'}
            </h2>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={loading}
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* --- STATE 1: UNAUTHENTICATED PROMPT --- */}
        {!isAuthenticated ? (
          <div className="modal-body-scrollable">
            <div className="modal-alert info">
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <strong>Sign In Required:</strong> You must be signed in to upload and share research papers on DocMe.
              </div>
            </div>
            <div className="modal-footer" style={{ padding: '0.75rem 0 0 0', borderTop: 'none' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onClose();
                  navigate('/login');
                }}
              >
                Log In to Continue
              </button>
            </div>
          </div>
        ) : successDoc ? (
          /* --- STATE 2: PUBLISHING SUCCESS SCREEN --- */
          <div className="publish-success-view">
            <div className="success-icon-badge">
              <CheckCircle2 size={32} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <h3 className="success-title">Document Published Successfully!</h3>
              <p className="success-subtitle">
                Your research document has been uploaded, indexed, and is now ready for discussion and AI Q&A.
              </p>
            </div>

            {/* Document Details Card */}
            <div className="success-doc-card">
              <div className="success-doc-header">
                <span className="file-format-badge">
                  {(successDoc.file_type || 'pdf').toUpperCase()}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {successDoc.visibility === 'public' ? 'Public' : 'Private'}
                </span>
              </div>
              <h4 className="success-doc-title">{successDoc.title}</h4>
              {successDoc.description && (
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', margin: 0 }}>
                  {successDoc.description}
                </p>
              )}
              <div className="success-ai-status">
                <Sparkles size={13} />
                <span>AI indexing complete • Vector embeddings active</span>
              </div>
            </div>

            {/* Success Actions */}
            <div className="success-actions-row">
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
              >
                Done
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onClose();
                  navigate(`/document/${successDoc.id}`);
                }}
              >
                <span>Open Document & Chat</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ) : (
          /* --- STATE 3: DOCUMENT PUBLISH FORM --- */
          <form className="modal-body-scrollable" onSubmit={handleSubmit} noValidate>
            {/* Error Banner */}
            {error && (
              <div className="modal-alert error" role="alert">
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>{error}</span>
              </div>
            )}

            {/* In-Flight Upload Status Banner */}
            {loading && (
              <div className="upload-progress-banner" aria-live="polite">
                <Loader2 size={18} className="upload-spinner" />
                <span>Uploading document and generating AI vector embeddings...</span>
              </div>
            )}

            {/* Drag & Drop File Selector */}
            <div className="form-group">
              <div className="form-label-row">
                <label className="form-label">
                  Document File <span style={{ color: 'var(--primary-emerald)' }}>*</span>
                </label>
                <span className="form-char-count">PDF or DOCX (Max 20MB)</span>
              </div>

              {!file ? (
                <div
                  className={`file-dropzone ${isDragging ? 'dragging' : ''}`}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => !loading && fileInputRef.current?.click()}
                  tabIndex={0}
                  role="button"
                  aria-label="Upload document file. Click or drag and drop a PDF or DOCX file."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  <div className="dropzone-icon-circle">
                    <UploadCloud size={24} />
                  </div>
                  <div className="dropzone-text">
                    Drag and drop your research paper here
                  </div>
                  <div className="dropzone-subtext">
                    Supported formats: PDF (.pdf) and Word (.docx) up to 20MB
                  </div>
                  <button
                    type="button"
                    className="btn-browse-inline"
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                    disabled={loading}
                  >
                    Browse Files
                  </button>
                </div>
              ) : (
                <div className="selected-file-card">
                  <div className="file-info-left">
                    <span className={`file-format-badge ${fileExtension}`}>
                      {fileExtension.toUpperCase()}
                    </span>
                    <div className="file-name-meta">
                      <span className="file-display-name" title={file.name}>
                        {file.name}
                      </span>
                      <span className="file-display-size">
                        {formattedFileSize} • Ready to upload
                      </span>
                    </div>
                  </div>
                  <div className="file-actions-right">
                    <button
                      type="button"
                      className="btn-file-action"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                      title="Replace file"
                      aria-label="Replace file"
                    >
                      <RefreshCw size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn-file-action danger"
                      onClick={handleRemoveFile}
                      disabled={loading}
                      title="Remove file"
                      aria-label="Remove file"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              )}

              {fieldErrors.file && (
                <span className="form-field-error">{fieldErrors.file}</span>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
                disabled={loading}
              />
            </div>

            {/* Document Title */}
            <div className="form-group">
              <div className="form-label-row">
                <label htmlFor="doc-title-input" className="form-label">
                  Document Title <span style={{ color: 'var(--primary-emerald)' }}>*</span>
                </label>
                <span className="form-char-count">{title.length}/200</span>
              </div>
              <input
                id="doc-title-input"
                type="text"
                className={`form-input ${fieldErrors.title ? 'invalid' : ''}`}
                placeholder="e.g., Deep Learning in Precision Oncology"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (fieldErrors.title) {
                    setFieldErrors((prev) => ({ ...prev, title: null }));
                  }
                }}
                maxLength={200}
                disabled={loading}
                required
              />
              {fieldErrors.title && (
                <span className="form-field-error">{fieldErrors.title}</span>
              )}
            </div>

            {/* Document Description / Abstract */}
            <div className="form-group">
              <div className="form-label-row">
                <label htmlFor="doc-desc-input" className="form-label">
                  Abstract / Description <span style={{ color: 'var(--text-muted)' }}>(Optional)</span>
                </label>
                <span className="form-char-count">{description.length}/1000</span>
              </div>
              <textarea
                id="doc-desc-input"
                className="form-textarea"
                rows={3}
                placeholder="Brief summary of findings, research questions, or methodology..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                disabled={loading}
              />
              <span className="form-hint">
                A concise abstract helps researchers discover your paper in Explore and feed search.
              </span>
            </div>

            {/* Visibility Selector */}
            <div className="form-group">
              <label className="form-label">Document Visibility</label>
              <div className="visibility-options-grid" role="radiogroup">
                <div
                  className={`visibility-card-option ${visibility === 'public' ? 'active' : ''}`}
                  onClick={() => !loading && setVisibility('public')}
                  role="radio"
                  aria-checked={visibility === 'public'}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setVisibility('public');
                    }
                  }}
                >
                  <Globe size={18} className="visibility-option-icon" />
                  <div className="visibility-option-texts">
                    <span className="visibility-option-title">Public</span>
                    <span className="visibility-option-desc">
                      Visible in community feed and searchable by researchers.
                    </span>
                  </div>
                </div>

                <div
                  className={`visibility-card-option ${visibility === 'private' ? 'active' : ''}`}
                  onClick={() => !loading && setVisibility('private')}
                  role="radio"
                  aria-checked={visibility === 'private'}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setVisibility('private');
                    }
                  }}
                >
                  <Lock size={18} className="visibility-option-icon" />
                  <div className="visibility-option-texts">
                    <span className="visibility-option-title">Private</span>
                    <span className="visibility-option-desc">
                      Only visible to you and accessible in your profile.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer Controls */}
            <div className="modal-footer" style={{ padding: '0.75rem 0 0 0', borderTop: 'none' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="upload-spinner" />
                    <span>Publishing...</span>
                  </>
                ) : (
                  <span>Publish Document</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
