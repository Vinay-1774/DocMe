/**
 * pages/feed.js
 * Controller for the Research Platform Social Feed.
 * Loads public research documents, manages document discussions,
 * provides debounced keyword and semantic pgvector search,
 * and facilitates document uploading with persistent embeddings.
 */

import { api, ApiError } from '../shared/api.js';
import { requireAuth, getUser, setupUserMenuAndLogout, renderAvatarHtml } from '../shared/auth.js';

async function initFeedPage() {
  // Ensure user is authenticated
  if (!await requireAuth()) return;

  // Initialize Account Menu & Logout Confirmation Dialog
  setupUserMenuAndLogout();

  // Modal Upload Controls
  const uploadModal = document.getElementById('upload-modal');
  const openUploadBtn = document.getElementById('open-upload-btn');
  const emptyUploadBtn = document.getElementById('empty-upload-btn');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const cancelUploadBtn = document.getElementById('cancel-upload-btn');
  const uploadForm = document.getElementById('upload-form');
  const uploadAlert = document.getElementById('upload-alert');
  const submitUploadBtn = document.getElementById('submit-upload-btn');
  const uploadBtnText = document.getElementById('upload-btn-text');
  const uploadBtnSpinner = document.getElementById('upload-btn-spinner');

  const openModal = () => {
    uploadForm.reset();
    uploadAlert.style.display = 'none';
    uploadModal.style.display = 'flex';
  };

  const closeModal = () => {
    uploadModal.style.display = 'none';
  };

  openUploadBtn?.addEventListener('click', openModal);
  emptyUploadBtn?.addEventListener('click', openModal);
  closeModalBtn?.addEventListener('click', closeModal);
  cancelUploadBtn?.addEventListener('click', closeModal);

  uploadModal?.addEventListener('click', (e) => {
    if (e.target === uploadModal) closeModal();
  });

  // Delete Modal Controls
  const deleteModal = document.getElementById('delete-doc-modal');
  const closeDeleteModalBtn = document.getElementById('close-delete-modal-btn');
  const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
  const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
  const deleteDocTitleDisplay = document.getElementById('delete-doc-title-display');
  const deleteModalAlert = document.getElementById('delete-modal-alert');
  const deleteBtnText = document.getElementById('delete-btn-text');
  const deleteBtnSpinner = document.getElementById('delete-btn-spinner');
  let pendingDeleteDocId = null;
  let pendingDeleteDocTitle = '';

  const openDeleteModal = (docId, docTitle) => {
    pendingDeleteDocId = docId;
    pendingDeleteDocTitle = docTitle;
    if (deleteDocTitleDisplay) deleteDocTitleDisplay.textContent = `"${docTitle}"`;
    if (deleteModalAlert) deleteModalAlert.style.display = 'none';
    if (confirmDeleteBtn) confirmDeleteBtn.disabled = false;
    if (cancelDeleteBtn) cancelDeleteBtn.disabled = false;
    if (deleteBtnText) deleteBtnText.textContent = 'Delete Document';
    if (deleteBtnSpinner) deleteBtnSpinner.style.display = 'none';
    if (deleteModal) deleteModal.style.display = 'flex';
  };

  const closeDeleteModal = () => {
    if (deleteModal) deleteModal.style.display = 'none';
    pendingDeleteDocId = null;
    pendingDeleteDocTitle = '';
  };

  closeDeleteModalBtn?.addEventListener('click', closeDeleteModal);
  cancelDeleteBtn?.addEventListener('click', closeDeleteModal);
  deleteModal?.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });

  confirmDeleteBtn?.addEventListener('click', async () => {
    if (!pendingDeleteDocId) return;

    confirmDeleteBtn.disabled = true;
    cancelDeleteBtn.disabled = true;
    if (deleteBtnText) deleteBtnText.textContent = 'Deleting...';
    if (deleteBtnSpinner) deleteBtnSpinner.style.display = 'inline-block';
    if (deleteModalAlert) deleteModalAlert.style.display = 'none';

    try {
      await api.deleteDocument(pendingDeleteDocId);
      const title = pendingDeleteDocTitle;
      closeDeleteModal();
      showFeedAlert(`Document "${title}" deleted successfully.`, 'success');
      loadFeed();
    } catch (err) {
      if (deleteModalAlert) {
        deleteModalAlert.textContent = err?.message || 'Could not delete document. Please try again.';
        deleteModalAlert.style.display = 'block';
      }
    } finally {
      if (confirmDeleteBtn) confirmDeleteBtn.disabled = false;
      if (cancelDeleteBtn) cancelDeleteBtn.disabled = false;
      if (deleteBtnText) deleteBtnText.textContent = 'Delete Document';
      if (deleteBtnSpinner) deleteBtnSpinner.style.display = 'none';
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (uploadModal && uploadModal.style.display === 'flex') closeModal();
      if (deleteModal && deleteModal.style.display === 'flex') closeDeleteModal();
    }
  });

  // Handle Document Upload (Upload once and persist embeddings)
  uploadForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    uploadAlert.style.display = 'none';

    const title = document.getElementById('doc-title').value.trim();
    const description = document.getElementById('doc-desc').value.trim();
    const visibility = document.getElementById('doc-visibility').value;
    const fileInput = document.getElementById('doc-file');
    const file = fileInput.files[0];

    if (!title) {
      showUploadError('Please provide a document title.');
      return;
    }

    if (!file) {
      showUploadError('Please select a PDF (.pdf) or Word (.docx) document.');
      return;
    }

    const formData = new FormData();
    formData.append('title', title);
    if (description) formData.append('description', description);
    formData.append('visibility', visibility);
    formData.append('file', file);

    // Set uploading state
    submitUploadBtn.disabled = true;
    uploadBtnText.textContent = 'Uploading...';
    uploadBtnSpinner.style.display = 'inline-block';

    try {
      const docResult = await api.uploadDocument(formData);
      closeModal();
      showFeedAlert(
        `Document "${docResult.title}" uploaded successfully.`,
        'success'
      );
      if (activeSearchQuery) {
        clearSearchState();
      } else {
        loadFeed();
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Could not upload document. Please try again.';
      showUploadError(msg);
    } finally {
      submitUploadBtn.disabled = false;
      uploadBtnText.textContent = 'Upload';
      uploadBtnSpinner.style.display = 'none';
    }
  });

  function showUploadError(msg) {
    uploadAlert.textContent = msg;
    uploadAlert.style.display = 'block';
  }

  function showFeedAlert(msg, type = 'info') {
    const alert = document.getElementById('feed-alert');
    if (!alert) return;
    alert.className = `alert alert-${type}`;
    alert.textContent = msg;
    alert.style.display = 'flex';
    setTimeout(() => { alert.style.display = 'none'; }, 6000);
  }

  // Refresh Feed
  document.getElementById('refresh-feed-btn')?.addEventListener('click', () => {
    if (activeSearchQuery) {
      performSearch(activeSearchQuery);
    } else {
      loadFeed();
    }
  });

  // Search Controls & State
  const searchInput = document.getElementById('feed-search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const searchStatusBar = document.getElementById('search-status-bar');
  const searchFeedbackText = document.getElementById('search-feedback-text');
  const resetSearchBtn = document.getElementById('reset-search-btn');

  let searchDebounceTimer = null;
  let activeSearchQuery = '';
  let currentSearchId = 0;
  let searchAbortController = null;

  const clearSearchState = () => {
    if (searchAbortController) {
      searchAbortController.abort();
      searchAbortController = null;
    }
    currentSearchId++;
    if (searchInput) searchInput.value = '';
    if (searchClearBtn) searchClearBtn.style.display = 'none';
    if (searchStatusBar) searchStatusBar.style.display = 'none';
    activeSearchQuery = '';
    loadFeed();
  };

  searchClearBtn?.addEventListener('click', clearSearchState);
  resetSearchBtn?.addEventListener('click', clearSearchState);

  searchInput?.addEventListener('input', (e) => {
    const rawVal = e.target.value;
    const query = rawVal.trim();

    if (searchClearBtn) {
      searchClearBtn.style.display = rawVal.length > 0 ? 'flex' : 'none';
    }

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }

    if (!query) {
      if (activeSearchQuery) {
        clearSearchState();
      }
      return;
    }

    // Debounce user input (350ms): avoids sending every keystroke to backend
    searchDebounceTimer = setTimeout(() => {
      performSearch(query);
    }, 350);
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      const query = searchInput.value.trim();
      if (query) {
        performSearch(query);
      } else {
        clearSearchState();
      }
    }
  });

  // Semantic & Keyword Search Execution with Stale Request Prevention
  async function performSearch(query) {
    const searchId = ++currentSearchId;
    activeSearchQuery = query;

    if (searchAbortController) {
      searchAbortController.abort();
    }
    searchAbortController = new AbortController();

    const loadingEl = document.getElementById('feed-loading');
    const container = document.getElementById('feed-documents-container');
    const emptyState = document.getElementById('feed-empty-state');

    loadingEl.style.display = 'flex';
    const loadingText = loadingEl.querySelector('span');
    if (loadingText) loadingText.textContent = `Searching for "${query}"...`;
    container.innerHTML = '';
    emptyState.style.display = 'none';

    try {
      const documents = await api.searchDocuments(query, 20, { signal: searchAbortController.signal });

      // If a newer search was initiated while this request was inflight, discard this result
      if (searchId !== currentSearchId) {
        return;
      }

      loadingEl.style.display = 'none';
      if (loadingText) loadingText.textContent = 'Loading documents...';

      if (searchStatusBar && searchFeedbackText) {
        searchStatusBar.style.display = 'flex';
        searchFeedbackText.textContent = `Found ${documents.length} matching document${documents.length === 1 ? '' : 's'} for "${query}"`;
      }

      if (!documents || documents.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="display: flex;">
            <div class="empty-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </div>
            <h2 class="empty-title">No matching documents found</h2>
            <p class="empty-desc">No documents found matching "${escapeHtml(query)}". Try searching different keywords.</p>
            <button type="button" class="btn btn-secondary btn-sm" id="empty-clear-search-btn">Reset Search</button>
          </div>
        `;
        document.getElementById('empty-clear-search-btn')?.addEventListener('click', clearSearchState);
        return;
      }

      documents.forEach((doc) => {
        container.appendChild(createDocumentCard(doc));
      });
    } catch (err) {
      if (err.name === 'AbortError' || searchId !== currentSearchId) {
        return;
      }
      loadingEl.style.display = 'none';
      container.innerHTML = `
        <div class="alert alert-error">
          Search failed. Please try again.
        </div>
      `;
    }
  }

  // Initial Data Fetch
  loadFeed();
  loadTrendingAndRankings();

  // Load Feed Function
  async function loadFeed() {
    const loadingEl = document.getElementById('feed-loading');
    const container = document.getElementById('feed-documents-container');
    const emptyState = document.getElementById('feed-empty-state');

    loadingEl.style.display = 'flex';
    const loadingText = loadingEl.querySelector('span');
    if (loadingText) loadingText.textContent = 'Loading documents...';
    container.innerHTML = '';
    emptyState.style.display = 'none';

    try {
      const documents = await api.getFeed();

      loadingEl.style.display = 'none';

      if (!documents || documents.length === 0) {
        emptyState.style.display = 'flex';
        return;
      }

      documents.forEach((doc) => {
        container.appendChild(createDocumentCard(doc));
      });
    } catch (err) {
      loadingEl.style.display = 'none';
      const msg = err instanceof ApiError ? err.message : 'Could not load documents. Please try again.';
      container.innerHTML = `
        <div class="alert alert-error">
          ${escapeHtml(msg)}
        </div>
      `;
    }
  }

  // Card Generator
  function createDocumentCard(doc) {
    const card = document.createElement('article');
    card.className = 'doc-card';
    card.id = `doc-card-${doc.id}`;

    const formattedDate = new Date(doc.created_at).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    const currentUser = getUser();
    const isOwner = currentUser && (String(currentUser.id) === String(doc.user_id));
    const isPdf = (doc.file_type || '').toLowerCase() === 'pdf';
    const formatBadgeClass = isPdf ? 'badge-pdf' : 'badge-docx';
    const formatLabel = (doc.file_type || 'DOC').toUpperCase();
    const uploaderName = doc.uploader_name || 'Researcher';
    const isPublic = (doc.visibility || 'public') === 'public';

    card.innerHTML = `
      <div class="doc-card-header">
        <div>
          <h2 class="doc-title">${escapeHtml(doc.title)}</h2>
          <div class="doc-meta-row">
            <span class="badge ${formatBadgeClass}">${formatLabel}</span>
            <span class="badge ${isPublic ? 'badge-public' : 'badge-private'}">${isPublic ? 'Public' : 'Private'}</span>
            <span>&bull;</span>
            <a href="profile.html?user_id=${doc.user_id}" class="doc-uploader-link" title="View contributor profile">
              <div class="doc-uploader-badge">
                ${renderAvatarHtml(uploaderName, 'user-avatar-xs')}
                <span>${escapeHtml(uploaderName)}</span>
              </div>
            </a>
            <span>&bull;</span>
            <span>Published on ${formattedDate}</span>
          </div>
        </div>
      </div>

      ${doc.description ? `<p class="doc-description">${escapeHtml(doc.description)}</p>` : ''}

      <div class="doc-card-actions">
        <div class="actions-left">
          <a href="document-chat.html?id=${doc.id}" class="btn btn-primary btn-sm">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span>Chat</span>
          </a>
          <button type="button" class="btn btn-secondary btn-sm download-doc-btn" data-doc-id="${doc.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            <span>Download</span>
          </button>
        </div>
        <div class="actions-right">
          ${isOwner ? `
          <button type="button" class="btn btn-outline-danger btn-sm delete-doc-btn" data-doc-id="${doc.id}" data-doc-title="${escapeHtml(doc.title)}" title="Delete document">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
            <span>Delete</span>
          </button>` : ''}
          <button type="button" class="btn btn-ghost btn-sm toggle-comments-btn" data-doc-id="${doc.id}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
            </svg>
            <span>Comments</span>
          </button>
        </div>
      </div>

      <!-- Comments Container (Collapsed Initially) -->
      <div id="comments-panel-${doc.id}" class="comments-panel" style="display: none;">
        <div id="comments-list-${doc.id}" class="comments-list">
          <div class="text-small" style="color: var(--text-muted);">Loading comments...</div>
        </div>
        <form class="comment-form" data-doc-id="${doc.id}">
          <input type="text" class="form-input comment-input" placeholder="Write a comment..." required>
          <button type="submit" class="btn btn-secondary btn-sm">Post</button>
        </form>
      </div>
    `;

    // Download Button Listener (Blob with Bearer token)
    const downloadBtn = card.querySelector('.download-doc-btn');
    downloadBtn?.addEventListener('click', async () => {
      try {
        downloadBtn.disabled = true;
        await api.downloadDocument(doc.id);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Could not download document. Please try again.';
        showFeedAlert(msg, 'error');
      } finally {
        downloadBtn.disabled = false;
      }
    });

    // Delete Button Listener
    const deleteBtn = card.querySelector('.delete-doc-btn');
    deleteBtn?.addEventListener('click', () => {
      openDeleteModal(doc.id, doc.title);
    });

    // Comments Toggle Button Listener
    const toggleBtn = card.querySelector('.toggle-comments-btn');
    const panel = card.querySelector(`#comments-panel-${doc.id}`);
    const commentsList = card.querySelector(`#comments-list-${doc.id}`);
    const commentForm = card.querySelector('.comment-form');

    let loadedComments = false;

    toggleBtn.addEventListener('click', async () => {
      const isVisible = panel.style.display === 'block';
      panel.style.display = isVisible ? 'none' : 'block';

      if (!isVisible && !loadedComments) {
        loadedComments = true;
        await refreshComments(doc.id, commentsList);
      }
    });

    commentForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = commentForm.querySelector('.comment-input');
      const content = input.value.trim();
      if (!content) return;

      input.disabled = true;
      try {
        await api.createComment(doc.id, content);
        input.value = '';
        await refreshComments(doc.id, commentsList);
      } catch (err) {
        alert(err.message || 'Could not post comment.');
      } finally {
        input.disabled = false;
        input.focus();
      }
    });

    return card;
  }

  // Refresh Comments for a specific card (Removes # symbol, shows initials avatar)
  async function refreshComments(docId, listContainer) {
    try {
      const comments = await api.getComments(docId);
      if (!comments || comments.length === 0) {
        listContainer.innerHTML = '<div class="text-small" style="color: var(--text-muted);">No comments yet. Start the conversation!</div>';
        return;
      }

      listContainer.innerHTML = '';
      comments.forEach((c) => {
        const item = document.createElement('div');
        item.className = 'comment-bubble';
        const date = new Date(c.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const authorName = c.author_name || 'Researcher';
        item.innerHTML = `
          <div class="comment-header">
            <div style="display: flex; align-items: center; gap: 0.45rem;">
              ${renderAvatarHtml(authorName, 'user-avatar-xs')}
              <span class="comment-author">${escapeHtml(authorName)}</span>
            </div>
            <span>${date}</span>
          </div>
          <div class="comment-content">${escapeHtml(c.content)}</div>
        `;
        listContainer.appendChild(item);
      });
    } catch (err) {
      listContainer.innerHTML = `<div class="text-small" style="color: var(--danger);">Failed to load comments: ${escapeHtml(err.message)}</div>`;
    }
  }

  // Load Trending & Rankings in Sidebar (Removes # symbol from leaderboard)
  async function loadTrendingAndRankings() {
    const popularContainer = document.getElementById('popular-docs-list');
    const rankingsContainer = document.getElementById('user-rankings-list');

    try {
      const [popularDocs, rankings] = await Promise.all([
        api.getPopularDocuments(),
        api.getUserRanking(),
      ]);

      if (popularContainer) {
        popularContainer.innerHTML = '';
        if (!popularDocs || popularDocs.length === 0) {
          popularContainer.innerHTML = '<div class="sidebar-skeleton">No popular documents yet.</div>';
        } else {
          popularDocs.slice(0, 5).forEach((item) => {
            const el = document.createElement('a');
            el.href = `document-chat.html?id=${item.id}`;
            el.className = 'sidebar-item';
            el.innerHTML = `
              <span class="sidebar-item-title">${escapeHtml(item.title)}</span>
              <span class="badge badge-public">${item.comment_count} comments</span>
            `;
            popularContainer.appendChild(el);
          });
        }
      }

      if (rankingsContainer) {
        rankingsContainer.innerHTML = '';
        if (!rankings || rankings.length === 0) {
          rankingsContainer.innerHTML = '<div class="sidebar-skeleton">No contributors yet.</div>';
        } else {
          rankings.slice(0, 5).forEach((r) => {
            const el = document.createElement('a');
            el.href = `profile.html?user_id=${r.user_id}`;
            el.className = 'sidebar-item contributor-sidebar-item';
            el.setAttribute('title', `View profile of ${escapeHtml(r.username)}`);
            el.innerHTML = `
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                ${renderAvatarHtml(r.username, 'user-avatar-xs')}
                <span class="sidebar-item-title">${escapeHtml(r.username)}</span>
              </div>
              <span class="badge badge-private">${r.document_count} document${r.document_count === 1 ? '' : 's'}</span>
            `;
            rankingsContainer.appendChild(el);
          });
        }
      }
    } catch (err) {
      console.warn('Failed to load sidebar metrics:', err);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFeedPage);
} else {
  initFeedPage();
}
