/**
 * pages/document-chat.js
 * Controller for the Dedicated Document Research Chat workstation.
 * Loads document preview (PDF/DOCX) and conducts real-time SSE streaming Q&A.
 */

import { api, ApiError } from '../shared/api.js';
import { requireAuth, getUser, setupUserMenuAndLogout } from '../shared/auth.js';
import { renderSafeMarkdown, escapeHtml } from '../shared/format.js';

async function initDocumentChat() {
  if (!await requireAuth()) return;

  // Initialize Account Menu & Logout Confirmation Dialog
  setupUserMenuAndLogout();

  // 1. Parse Document ID from URL query parameters
  const params = new URLSearchParams(window.location.search);
  const documentId = params.get('id');

  if (!documentId) {
    alert('No document specified. Redirecting to feed.');
    window.location.href = 'feed.html';
    return;
  }

  // 3. Elements
  const docHeaderTitle = document.getElementById('doc-header-title');
  const docBadgeFormat = document.getElementById('doc-badge-format');
  const downloadDocBtn = document.getElementById('download-doc-btn');
  const viewerLoading = document.getElementById('viewer-loading');
  const viewerContainer = document.getElementById('viewer-container');
  const viewerError = document.getElementById('viewer-error');
  const viewerErrorMessage = document.getElementById('viewer-error-message');
  const pdfViewerFrame = document.getElementById('pdf-viewer-frame');
  const docxFallbackView = document.getElementById('docx-fallback-view');
  const fallbackDocTitle = document.getElementById('fallback-doc-title');
  const fallbackDownloadBtn = document.getElementById('fallback-download-btn');

  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const sendIcon = document.getElementById('send-icon');
  const sendSpinner = document.getElementById('send-spinner');

  let currentDoc = null;
  let pdfBlobUrl = null;

  // Clean up blob URL on unload to prevent memory leaks
  window.addEventListener('beforeunload', () => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
  });

  // Handle Document Download (Direct button action, prevent form bubbling)
  const handleDownload = async (btn) => {
    try {
      btn?.classList.add('is-loading');
      if (btn) btn.disabled = true;
      await api.downloadDocument(documentId);
    } catch (err) {
      alert(err.message || 'Download failed.');
    } finally {
      btn?.classList.remove('is-loading');
      if (btn) btn.disabled = false;
    }
  };

  downloadDocBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleDownload(downloadDocBtn);
  });

  fallbackDownloadBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleDownload(fallbackDownloadBtn);
  });

  // 4. Load Document Metadata & Setup Viewer
  try {
    currentDoc = await api.getDocument(documentId);
    await setupDocumentViewer(currentDoc);
  } catch (err) {
    viewerLoading.style.display = 'none';
    viewerError.style.display = 'flex';
    viewerErrorMessage.textContent = err?.message || "We couldn't load this document. Please try again.";
    docHeaderTitle.textContent = 'Document Inaccessible';
    return;
  }

  async function setupDocumentViewer(doc) {
    viewerLoading.style.display = 'none';
    viewerContainer.style.display = 'block';

    const isPdf = (doc.file_type || '').toLowerCase() === 'pdf';

    // Navbar metadata
    docHeaderTitle.textContent = doc.title;
    document.title = `${doc.title} — Research Platform Chat`;

    docBadgeFormat.textContent = (doc.file_type || 'DOC').toUpperCase();
    docBadgeFormat.className = `badge ${isPdf ? 'badge-pdf' : 'badge-docx'}`;

    if (isPdf) {
      try {
        const viewUrl = `${api.getDownloadUrl(doc.id)}?inline=true`;
        const resp = await api.fetchAuthenticated(viewUrl);

        if (!resp.ok) {
          let errDetail = 'Failed to load PDF document.';
          try {
            const errJson = await resp.json();
            if (errJson && errJson.detail) errDetail = errJson.detail;
          } catch {
            // ignore
          }
          throw new Error(errDetail);
        }

        const rawBlob = await resp.blob();
        if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        // Explicitly set type: application/pdf so browser PDF reader renders correctly
        const pdfBlob = new Blob([rawBlob], { type: 'application/pdf' });
        pdfBlobUrl = URL.createObjectURL(pdfBlob);

        pdfViewerFrame.src = `${pdfBlobUrl}#view=FitH&toolbar=1&navpanes=1`;
        pdfViewerFrame.style.display = 'block';
        docxFallbackView.style.display = 'none';
      } catch {
        viewerContainer.style.display = 'none';
        viewerError.style.display = 'flex';
        viewerErrorMessage.textContent = "We couldn't load this document. Please try again.";
      }
    } else {
      pdfViewerFrame.style.display = 'none';
      docxFallbackView.style.display = 'flex';
      fallbackDocTitle.textContent = doc.title;
    }
  }

  // 5. Chat Input Auto-Resize & Enter Submission
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  // Typing Indicator Management
  let typingIndicatorEl = null;
  let isSubmitting = false;

  function showTypingIndicator() {
    hideTypingIndicator();

    const indicator = document.createElement('div');
    indicator.className = 'chat-message message-assistant typing-indicator-message';
    indicator.id = 'chat-typing-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-live', 'polite');
    indicator.setAttribute('aria-label', 'Assistant is typing');

    indicator.innerHTML = `
      <div class="message-bubble typing-indicator-bubble">
        <div class="typing-dots" aria-hidden="true">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>
        <span class="sr-only">Assistant is typing...</span>
      </div>
    `;

    chatMessages.appendChild(indicator);
    typingIndicatorEl = indicator;
    scrollToBottom(true);
  }

  function hideTypingIndicator() {
    if (typingIndicatorEl) {
      typingIndicatorEl.remove();
      typingIndicatorEl = null;
    }
    const existing = document.getElementById('chat-typing-indicator');
    if (existing) {
      existing.remove();
    }
  }

  // 6. Handle Chat Submission with Real-time SSE Streaming
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const question = chatInput.value.trim();
    if (!question) return;

    isSubmitting = true;

    // Reset textarea
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Append User Message Bubble
    appendUserMessage(question);

    // Set sending state (disables send button & textarea)
    setChatLoading(true);

    // Show three-dot typing animation while waiting for response
    showTypingIndicator();

    // Prepare Assistant Message Bubble (appended when first token/content arrives)
    const { appendToken, setSources, finalize, showError } = createAssistantMessage();

    try {
      let fullAnswer = '';

      await api.streamChat(documentId, question, {
        onToken: (token) => {
          // Remove typing indicator as soon as the assistant starts displaying its response
          hideTypingIndicator();
          fullAnswer += token;
          appendToken(token);
        },
        onSources: (sources) => {
          setSources(sources);
        },
        onError: (errDetail) => {
          hideTypingIndicator();
          finalize(fullAnswer);
          showError(errDetail || "We couldn't generate an answer right now. Please try again.");
        },
        onDone: () => {
          hideTypingIndicator();
          if (!fullAnswer || !fullAnswer.trim()) {
            showError("No response was generated for this question. Please try rephrasing.");
          } else {
            finalize(fullAnswer);
          }
        },
      });

    } catch (err) {
      hideTypingIndicator();
      showError(err?.message || "We couldn't generate an answer right now. Please try again.");
    } finally {
      // Guaranteed cleanup: prevent duplicate or permanently stuck indicator
      hideTypingIndicator();
      setChatLoading(false);
      isSubmitting = false;
      chatInput.focus();
    }
  });

  let isUserScrolledUp = false;

  chatMessages.addEventListener('scroll', () => {
    const threshold = 60;
    const distanceToBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
    isUserScrolledUp = distanceToBottom > threshold;
  });

  function scrollToBottom(force = false) {
    if (force || !isUserScrolledUp) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  }

  function appendUserMessage(text) {
    isUserScrolledUp = false;
    const msg = document.createElement('div');
    msg.className = 'chat-message message-user';
    msg.innerHTML = `
      <div class="message-bubble">
        <p>${escapeHtml(text)}</p>
      </div>
    `;
    chatMessages.appendChild(msg);
    scrollToBottom(true);
  }

  function createAssistantMessage() {
    const msg = document.createElement('div');
    msg.className = 'chat-message message-assistant';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const textEl = document.createElement('div');
    textEl.className = 'assistant-text';
    textEl.textContent = '';

    const cursorEl = document.createElement('span');
    cursorEl.className = 'spinner spinner-dark';
    cursorEl.style.display = 'inline-block';
    cursorEl.style.width = '0.875rem';
    cursorEl.style.height = '0.875rem';
    cursorEl.style.marginLeft = '0.5rem';

    bubble.appendChild(textEl);
    bubble.appendChild(cursorEl);
    msg.appendChild(bubble);

    let isAppended = false;
    let pendingSources = null;

    function ensureAppended() {
      if (!isAppended) {
        chatMessages.appendChild(msg);
        isAppended = true;
        scrollToBottom(true);
      }
    }

    let sourcesWrapper = null;

    function renderSourcesBlock(sources) {
      if (!sources || sources.length === 0 || sourcesWrapper) return;
      sourcesWrapper = document.createElement('div');
      sourcesWrapper.className = 'sources-container';

      sourcesWrapper.innerHTML = `
        <button type="button" class="sources-toggle-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          </svg>
          <span>Sources</span>
        </button>
        <div class="sources-list" style="display: none;">
          ${sources.map((s) => `
            <div class="source-item">
              <span class="source-badge">${s.page_number ? `Page ${s.page_number}` : 'Excerpt'}</span>
              ${s.document_title ? `<div style="margin-top: 0.15rem; color: var(--text-muted);">${escapeHtml(s.document_title)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `;

      const toggle = sourcesWrapper.querySelector('.sources-toggle-btn');
      const list = sourcesWrapper.querySelector('.sources-list');
      toggle.addEventListener('click', () => {
        const isShown = list.style.display === 'flex';
        list.style.display = isShown ? 'none' : 'flex';
      });

      bubble.appendChild(sourcesWrapper);
      scrollToBottom(false);
    }

    return {
      messageEl: msg,
      textEl,
      appendToken: (token) => {
        ensureAppended();
        textEl.textContent += token;
        scrollToBottom(false);
      },
      setSources: (sources) => {
        if (!sources || sources.length === 0) return;
        pendingSources = sources;
        if (isAppended) {
          renderSourcesBlock(sources);
        }
      },
      finalize: (completedText) => {
        cursorEl.remove();
        if (completedText && completedText.trim()) {
          ensureAppended();
          textEl.innerHTML = renderSafeMarkdown(completedText);
          if (pendingSources) {
            renderSourcesBlock(pendingSources);
          }
        }
        scrollToBottom(false);
      },
      showError: (errMsg) => {
        ensureAppended();
        cursorEl.remove();
        textEl.textContent = errMsg;
        scrollToBottom(false);
      },
    };
  }

  function setChatLoading(isLoading) {
    sendBtn.disabled = isLoading;
    chatInput.disabled = isLoading;
    sendIcon.style.display = isLoading ? 'none' : 'block';
    sendSpinner.style.display = isLoading ? 'inline-block' : 'none';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDocumentChat);
} else {
  initDocumentChat();
}
