/**
 * pages/profile.js
 * Controller for the Researcher Profile and Workspace page.
 * Manages user details, private & public documents, and document metadata updates.
 */

import { api, ApiError } from '../shared/api.js';
import {
  requireAuth,
  getUser,
  setupUserMenuAndLogout,
  getInitials,
  getAvatarColor,
  renderAvatarHtml,
} from '../shared/auth.js';
import { escapeHtml } from '../shared/format.js';

async function initProfilePage() {
  if (!await requireAuth()) return;

  // Initialize Account Menu & Logout Confirmation
  setupUserMenuAndLogout();

  // Determine if viewing own profile or another contributor
  const urlParams = new URLSearchParams(window.location.search);
  const targetUserIdParam = urlParams.get('user_id');
  const currentUser = getUser();
  const isOtherUser = Boolean(
    targetUserIdParam && (!currentUser || String(currentUser.id) !== String(targetUserIdParam))
  );
  const targetUserId = isOtherUser
    ? parseInt(targetUserIdParam, 10)
    : (currentUser ? currentUser.id : null);

  // Elements
  const heroAvatar = document.getElementById('hero-avatar');
  const profileName = document.getElementById('profile-name');
  const profileEmail = document.getElementById('profile-email');
  const profileJoined = document.getElementById('profile-joined');
  const statDocCount = document.getElementById('stat-doc-count');

  const loadingEl = document.getElementById('docs-loading');
  const container = document.getElementById('user-docs-container');
  const emptyState = document.getElementById('docs-empty-state');
  const profileAlert = document.getElementById('profile-alert');

  // Edit Modal Elements
  const editModal = document.getElementById('edit-doc-modal');
  const closeEditModalBtn = document.getElementById('close-edit-modal-btn');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const editForm = document.getElementById('edit-doc-form');
  const editDocIdInput = document.getElementById('edit-doc-id');
  const editTitleInput = document.getElementById('edit-title');
  const editDescInput = document.getElementById('edit-description');
  const editVisSelect = document.getElementById('edit-visibility');
  const editModalAlert = document.getElementById('edit-modal-alert');
  const saveBtn = document.getElementById('save-edit-btn');
  const saveBtnText = document.getElementById('save-btn-text');
  const saveBtnSpinner = document.getElementById('save-btn-spinner');

  const closeEditModal = () => {
    editModal.style.display = 'none';
  };

  closeEditModalBtn?.addEventListener('click', closeEditModal);
  cancelEditBtn?.addEventListener('click', closeEditModal);
  editModal?.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
  });

  // Delete Modal Elements
  const deleteModal = document.getElementById('delete-doc-modal');
  const closeDeleteModalBtn = document.getElementById('close-delete-modal-btn');
  const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
  const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
  const deleteDocTitleDisplay = document.getElementById('delete-doc-title-display');
  const deleteModalAlert = document.getElementById('delete-modal-alert');
  const deleteBtnText = document.getElementById('delete-btn-text');
  const deleteBtnSpinner = document.getElementById('delete-btn-spinner');
  let pendingDeleteId = null;
  let pendingDeleteTitle = '';

  const openDeleteModal = (docId, docTitle) => {
    pendingDeleteId = docId;
    pendingDeleteTitle = docTitle;
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
    pendingDeleteId = null;
    pendingDeleteTitle = '';
  };

  closeDeleteModalBtn?.addEventListener('click', closeDeleteModal);
  cancelDeleteBtn?.addEventListener('click', closeDeleteModal);
  deleteModal?.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });

  confirmDeleteBtn?.addEventListener('click', async () => {
    if (!pendingDeleteId) return;

    confirmDeleteBtn.disabled = true;
    cancelDeleteBtn.disabled = true;
    if (deleteBtnText) deleteBtnText.textContent = 'Deleting...';
    if (deleteBtnSpinner) deleteBtnSpinner.style.display = 'inline-block';
    if (deleteModalAlert) deleteModalAlert.style.display = 'none';

    try {
      await api.deleteDocument(pendingDeleteId);
      const title = pendingDeleteTitle;
      closeDeleteModal();
      showSuccessAlert(`Document "${title}" deleted successfully.`);
      await loadUserDocuments();
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

  // Upload Modal Elements
  const uploadModal = document.getElementById('upload-modal');
  const openUploadBtn = document.getElementById('open-upload-btn');
  const emptyUploadAction = document.getElementById('empty-upload-action');
  const closeUploadModalBtn = document.getElementById('close-upload-modal-btn');
  const cancelUploadBtn = document.getElementById('cancel-upload-btn');
  const uploadForm = document.getElementById('upload-form');
  const uploadAlert = document.getElementById('upload-alert');
  const docTitleInput = document.getElementById('doc-title');
  const docFileInput = document.getElementById('doc-file');
  const submitUploadBtn = document.getElementById('submit-upload-btn');
  const uploadBtnText = document.getElementById('upload-btn-text');
  const uploadBtnSpinner = document.getElementById('upload-btn-spinner');

  const openUploadModal = (e) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (uploadForm) uploadForm.reset();
    if (uploadAlert) uploadAlert.style.display = 'none';
    if (uploadModal) uploadModal.style.display = 'flex';
  };

  const closeUploadModal = () => {
    if (uploadModal) uploadModal.style.display = 'none';
  };

  // Direct element listeners
  openUploadBtn?.addEventListener('click', openUploadModal);
  emptyUploadAction?.addEventListener('click', openUploadModal);
  closeUploadModalBtn?.addEventListener('click', closeUploadModal);
  cancelUploadBtn?.addEventListener('click', closeUploadModal);
  uploadModal?.addEventListener('click', (e) => {
    if (e.target === uploadModal) closeUploadModal();
  });

  // Event delegation to catch dynamic empty-state & upload triggers
  document.addEventListener('click', (e) => {
    const uploadTrigger = e.target.closest('.empty-upload-action, [data-action="upload-document"]');
    if (uploadTrigger) {
      e.preventDefault();
      e.stopPropagation();
      openUploadModal(e);
    }
  });

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (uploadModal && uploadModal.style.display === 'flex') closeUploadModal();
      if (editModal && editModal.style.display === 'flex') closeEditModal();
      if (deleteModal && deleteModal.style.display === 'flex') closeDeleteModal();
    }
  });

  // Auto-populate title from selected file if title input is empty
  docFileInput?.addEventListener('change', () => {
    if (docFileInput.files && docFileInput.files.length > 0 && !docTitleInput.value.trim()) {
      const fileName = docFileInput.files[0].name.replace(/\.[^/.]+$/, "");
      docTitleInput.value = fileName;
    }
  });

  // Handle Document Upload Submission
  uploadForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadAlert.style.display = 'none';

    const title = docTitleInput.value.trim();
    const description = document.getElementById('doc-desc').value.trim();
    const visibility = document.getElementById('doc-visibility').value;
    const file = docFileInput.files[0];

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

    submitUploadBtn.disabled = true;
    uploadBtnText.textContent = 'Uploading...';
    uploadBtnSpinner.style.display = 'inline-block';

    try {
      const docResult = await api.uploadDocument(formData);
      closeUploadModal();
      showSuccessAlert(`Document "${docResult.title}" uploaded successfully.`);
      await loadUserDocuments();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err?.message || 'Could not upload document. Please try again.');
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

  let activeProfileUser = null;

  // Load Profile & Documents
  try {
    await loadUserProfile();
    await loadUserDocuments();
  } catch (err) {
    console.warn('Profile initialization error:', err);
  }

  async function loadUserProfile() {
    try {
      if (isOtherUser) {
        activeProfileUser = await api.getUserProfile(targetUserId);
        if (profileName) profileName.textContent = activeProfileUser.username;
        if (profileEmail) profileEmail.textContent = activeProfileUser.email;
        document.title = `${activeProfileUser.username} — Research Platform`;

        const initials = getInitials(activeProfileUser.username);
        const avatarBg = getAvatarColor(activeProfileUser.username);
        if (heroAvatar) {
          heroAvatar.textContent = initials;
          heroAvatar.style.background = avatarBg;
        }

        if (activeProfileUser.created_at && profileJoined) {
          const joinYear = new Date(activeProfileUser.created_at).getFullYear();
          profileJoined.textContent = `Member since ${joinYear}`;
        }

        const sectionHeading = document.querySelector('.profile-docs-section .heading-2');
        const sectionSubhead = document.querySelector('.profile-docs-section .text-subhead');
        if (sectionHeading) sectionHeading.textContent = 'Public Documents';
        if (sectionSubhead) sectionSubhead.textContent = `Documents shared by ${activeProfileUser.username}.`;
      } else {
        const user = await api.getMe();
        activeProfileUser = user;
        if (profileName) profileName.textContent = user.username;
        if (profileEmail) profileEmail.textContent = user.email;

        const initials = getInitials(user.username);
        const avatarBg = getAvatarColor(user.username);
        if (heroAvatar) {
          heroAvatar.textContent = initials;
          heroAvatar.style.background = avatarBg;
        }

        if (user.created_at && profileJoined) {
          const joinYear = new Date(user.created_at).getFullYear();
          profileJoined.textContent = `Member since ${joinYear}`;
        }
      }
    } catch {
      if (profileName) profileName.textContent = 'User Not Found';
      if (profileEmail) profileEmail.textContent = 'This profile could not be loaded.';
      container.innerHTML = '<div class="alert alert-error">We couldn\'t load this profile. Please try again.</div>';
    }
  }

  async function loadUserDocuments() {
    loadingEl.style.display = 'flex';
    container.innerHTML = '';
    emptyState.style.display = 'none';

    try {
      const docs = isOtherUser
        ? await api.getContributorDocuments(targetUserId)
        : await api.getDocuments('mine');

      loadingEl.style.display = 'none';

      if (statDocCount) {
        statDocCount.textContent = isOtherUser
          ? `${docs.length} Public Document${docs.length === 1 ? '' : 's'}`
          : `${docs.length} Documents`;
      }

      if (!docs || docs.length === 0) {
        if (isOtherUser) {
          const emptyTitle = emptyState.querySelector('.empty-title');
          const emptyDesc = emptyState.querySelector('.empty-desc');
          const emptyBtn = emptyState.querySelector('#empty-upload-action');
          if (emptyTitle) emptyTitle.textContent = 'No documents yet';
          if (emptyDesc) emptyDesc.textContent = `${activeProfileUser?.username || 'This user'} has not shared any public documents yet.`;
          if (emptyBtn) emptyBtn.style.display = 'none';
        }
        emptyState.style.display = 'flex';
        return;
      }

      docs.forEach((doc) => {
        container.appendChild(createUserDocCard(doc, !isOtherUser));
      });
    } catch {
      loadingEl.style.display = 'none';
      container.innerHTML = '<div class="alert alert-error">We couldn\'t load your documents. Please try again.</div>';
    }
  }

  function createUserDocCard(doc, isOwner = true) {
    const card = document.createElement('article');
    card.className = 'doc-card';
    card.id = `user-doc-${doc.id}`;

    const dateStr = new Date(doc.created_at).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

    const isPdf = (doc.file_type || '').toLowerCase() === 'pdf';
    const formatBadgeClass = isPdf ? 'badge-pdf' : 'badge-docx';
    const isPublic = doc.visibility === 'public';
    const visBadgeClass = isPublic ? 'badge-public' : 'badge-private';
    const uploaderName = doc.uploader_name || profileName?.textContent || 'Researcher';

    card.innerHTML = `
      <div class="doc-card-header">
        <div>
          <h2 class="doc-title">${escapeHtml(doc.title)}</h2>
          <div class="doc-meta-row">
            <span class="badge ${formatBadgeClass}">${(doc.file_type || 'DOC').toUpperCase()}</span>
            <span class="badge ${visBadgeClass}">${escapeHtml(doc.visibility)}</span>
            <span>&bull;</span>
            <div class="doc-uploader-badge">
              ${renderAvatarHtml(uploaderName, 'user-avatar-xs')}
              <span>${escapeHtml(uploaderName)}</span>
            </div>
            <span>&bull;</span>
            <span>Uploaded on ${dateStr}</span>
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
        ${isOwner ? `
        <div class="actions-right">
          <button type="button" class="btn btn-outline btn-sm edit-doc-btn" data-doc='${JSON.stringify(doc)}'>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            <span>Edit Settings</span>
          </button>
          <button type="button" class="btn btn-outline-danger btn-sm delete-doc-btn" data-doc-id="${doc.id}" data-doc-title="${escapeHtml(doc.title)}" title="Delete document">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
            <span>Delete</span>
          </button>
        </div>` : ''}
      </div>
    `;

    // Download button click (Blob with Bearer token)
    const downloadBtn = card.querySelector('.download-doc-btn');
    downloadBtn?.addEventListener('click', async () => {
      try {
        downloadBtn.disabled = true;
        await api.downloadDocument(doc.id);
      } catch {
        alert('Could not download document. Please try again.');
      } finally {
        downloadBtn.disabled = false;
      }
    });

    // Edit button click
    const editBtn = card.querySelector('.edit-doc-btn');
    editBtn?.addEventListener('click', () => {
      openEditModal(doc);
    });

    // Delete button click
    const deleteBtn = card.querySelector('.delete-doc-btn');
    deleteBtn?.addEventListener('click', () => {
      openDeleteModal(doc.id, doc.title);
    });

    return card;
  }

  function openEditModal(doc) {
    editDocIdInput.value = doc.id;
    editTitleInput.value = doc.title;
    editDescInput.value = doc.description || '';
    editVisSelect.value = doc.visibility;
    editModalAlert.style.display = 'none';
    editModal.style.display = 'flex';
  }

  // Handle Edit Form Submission (Calls PATCH /documents/{id})
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    editModalAlert.style.display = 'none';

    const docId = editDocIdInput.value;
    const title = editTitleInput.value.trim();
    const description = editDescInput.value.trim();
    const visibility = editVisSelect.value;

    if (!title) {
      editModalAlert.textContent = 'Document title is required.';
      editModalAlert.style.display = 'block';
      return;
    }

    saveBtn.disabled = true;
    saveBtnText.style.display = 'none';
    saveBtnSpinner.style.display = 'inline-block';

    try {
      await api.updateDocument(docId, {
        title,
        description: description || null,
        visibility,
      });

      closeEditModal();
      showSuccessAlert('Document updated successfully.');
      await loadUserDocuments();
    } catch {
      editModalAlert.textContent = 'Could not update document. Please try again.';
      editModalAlert.style.display = 'block';
    } finally {
      saveBtn.disabled = false;
      saveBtnText.style.display = 'inline-block';
      saveBtnSpinner.style.display = 'none';
    }
  });

  function showSuccessAlert(msg) {
    profileAlert.className = 'alert alert-success';
    profileAlert.textContent = msg;
    profileAlert.style.display = 'flex';
    setTimeout(() => { profileAlert.style.display = 'none'; }, 5000);
  }

}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initProfilePage);
} else {
  initProfilePage();
}
