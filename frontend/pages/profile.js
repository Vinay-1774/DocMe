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

document.addEventListener('DOMContentLoaded', async () => {
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
  const navUsername = document.getElementById('nav-username');
  const navAvatar = document.getElementById('nav-avatar');

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

  document.getElementById('open-upload-btn')?.addEventListener('click', () => {
    window.location.href = 'feed.html';
  });
  document.getElementById('empty-upload-action')?.addEventListener('click', () => {
    window.location.href = 'feed.html';
  });

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

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});
