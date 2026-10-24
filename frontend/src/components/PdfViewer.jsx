import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  RotateCcw,
  FileText,
  AlertCircle,
  FileCheck,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { api, API_BASE_URL } from '../services/api.js';
import { getToken } from '../services/auth.js';
import './PdfViewer.css';

// Set worker source for PDF.js
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

export default function PdfViewer({ documentId, fileType = 'pdf', docTitle = 'Document' }) {
  const isPdf = (fileType || '').toLowerCase() === 'pdf';

  // PDF.js State
  const [pdfDoc, setPdfDoc] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [loading, setLoading] = useState(isPdf);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState(null);

  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);

  // 1. Fetch PDF Data Authenticated and Initialize PDF.js
  useEffect(() => {
    if (!isPdf || !documentId) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    let abortController = new AbortController();

    async function loadPdf() {
      try {
        setLoading(true);
        setError(null);

        const token = getToken();
        const url = `${API_BASE_URL}/documents/${documentId}/download?inline=true`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/pdf, application/octet-stream, */*',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
          signal: abortController.signal,
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error('Please log in to preview this document.');
          }
          if (response.status === 403) {
            throw new Error('You do not have permission to view this private document.');
          }
          if (response.status === 404) {
            throw new Error('Document file was not found on the storage server.');
          }
          throw new Error(`Failed to load document (Status: ${response.status}).`);
        }

        const arrayBuffer = await response.arrayBuffer();
        if (!isMounted) return;

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const doc = await loadingTask.promise;

        if (isMounted) {
          setPdfDoc(doc);
          setNumPages(doc.numPages);
          setCurrentPage(1);
        }
      } catch (err) {
        if (err.name !== 'AbortError' && isMounted) {
          setError(err.message || 'Error rendering document preview.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadPdf();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, [documentId, isPdf]);

  // 2. Render Current Page onto Canvas
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let isMounted = true;

    async function renderPage() {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }

      try {
        setRendering(true);
        const page = await pdfDoc.getPage(currentPage);
        if (!isMounted) return;

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('Page render error:', err);
        }
      } finally {
        if (isMounted) setRendering(false);
      }
    }

    renderPage();

    return () => {
      isMounted = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [pdfDoc, currentPage, scale]);

  // Page Controls
  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage((prev) => prev - 1);
  };

  const handleNextPage = () => {
    if (currentPage < numPages) setCurrentPage((prev) => prev + 1);
  };

  // Zoom Controls
  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.2, 2.5));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.6));
  };

  const handleResetZoom = () => {
    setScale(1.2);
  };

  // Download Action
  const handleDownload = () => {
    if (documentId) {
      api.downloadDocument(documentId);
    }
  };

  // Fallback for DOCX or non-PDF formats
  if (!isPdf) {
    return (
      <div className="pdf-viewer-container">
        <div className="docx-fallback-state">
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: 'var(--radius-lg)',
            backgroundColor: 'var(--ai-indigo-subtle)',
            color: 'var(--ai-indigo)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <FileText size={32} />
          </div>
          <h3 className="pdf-state-title">Word Document (.docx)</h3>
          <p className="pdf-state-desc">
            Inline canvas preview is tailored for PDF documents. You can download this Word document to inspect it locally, or use the AI Assistant to ask questions grounded in its extracted text chunks.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={handleDownload}
            style={{ marginTop: '0.5rem' }}
          >
            <Download size={15} />
            <span>Download {docTitle}.docx</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-viewer-container">
      {/* Top Toolbar */}
      <div className="pdf-toolbar">
        {/* Page Nav */}
        <div className="pdf-toolbar-group">
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={handlePrevPage}
            disabled={currentPage <= 1 || loading}
            aria-label="Previous Page"
            title="Previous Page"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="pdf-page-display">
            Page {numPages > 0 ? currentPage : 0} of {numPages}
          </span>
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={handleNextPage}
            disabled={currentPage >= numPages || loading}
            aria-label="Next Page"
            title="Next Page"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Zoom Controls & Download */}
        <div className="pdf-toolbar-group">
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={handleZoomOut}
            disabled={scale <= 0.6 || loading}
            aria-label="Zoom Out"
            title="Zoom Out"
          >
            <ZoomOut size={16} />
          </button>
          <span className="pdf-zoom-badge">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={handleZoomIn}
            disabled={scale >= 2.5 || loading}
            aria-label="Zoom In"
            title="Zoom In"
          >
            <ZoomIn size={16} />
          </button>
          <button
            type="button"
            className="pdf-tool-btn"
            onClick={handleResetZoom}
            disabled={loading}
            aria-label="Reset Zoom"
            title="Reset Zoom"
          >
            <RotateCcw size={14} />
          </button>

          <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-subtle)', margin: '0 0.25rem' }} />

          <button
            type="button"
            className="pdf-btn-download"
            onClick={handleDownload}
            aria-label="Download Document"
            title="Download Document"
          >
            <Download size={14} />
            <span>Download</span>
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="pdf-viewport">
        {loading ? (
          <div className="pdf-loading-state">
            <div className="pdf-spinner" />
            <p className="pdf-state-desc">Loading PDF document preview...</p>
          </div>
        ) : error ? (
          <div className="pdf-error-state">
            <AlertCircle size={36} color="var(--danger-red)" />
            <h3 className="pdf-state-title">Preview Unavailable</h3>
            <p className="pdf-state-desc">{error}</p>
            <button
              type="button"
              className="pdf-btn-download"
              onClick={handleDownload}
              style={{ marginTop: '0.5rem' }}
            >
              <Download size={14} />
              <span>Try Direct Download</span>
            </button>
          </div>
        ) : (
          <div className="pdf-canvas-wrapper animate-fade-in">
            <canvas ref={canvasRef} className="pdf-canvas" />
          </div>
        )}
      </div>
    </div>
  );
}
