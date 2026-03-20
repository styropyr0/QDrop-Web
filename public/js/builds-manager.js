/**
 * Builds Manager
 * Handles listing builds, selecting, and deleting builds
 */
class BuildsManager {
    constructor() {
        this.buildsContainer = document.getElementById('buildsContainer');
        this.searchInput = document.getElementById('buildsSearch');
        this.deleteSelectedBtn = document.getElementById('deleteSelectedBtn');
        this.deleteConfirmModal = document.getElementById('deleteConfirmModal');
        this.deleteConfirmBtn = document.getElementById('deleteConfirmBtn');
        this.deleteCancelBtn = document.getElementById('deleteCancelBtn');
        this.deleteCount = document.getElementById('deleteCount');

        this.builds = [];
        this.selectedBuildIds = new Set();
        this.firebaseDb = null;

        this.initFirebase();
        this.initEventListeners();
    }

    initFirebase() {
        // Firebase is already initialized in app.js, just get reference
        this.firebaseDb = firebase.database();
    }

    initEventListeners() {
        // Search
        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => {
                this.filterBuilds(e.target.value);
            });
        }

        // Delete button
        if (this.deleteSelectedBtn) {
            this.deleteSelectedBtn.addEventListener('click', () => this.showDeleteConfirm());
        }
        if (this.deleteConfirmBtn) {
            this.deleteConfirmBtn.addEventListener('click', () => this.deleteSelected());
        }
        if (this.deleteCancelBtn) {
            this.deleteCancelBtn.addEventListener('click', () => this.hideDeleteConfirm());
        }

        // Listen for view changes
        document.addEventListener('viewChanged', (e) => {
            if (e.detail.view === 'manage') {
                console.log('Manage view activated, loading builds...');
                this.loadBuilds();
            }
        });
    }

    async loadBuilds() {
        try {
            const orgId = localStorage.getItem('qdrop_org_id');
            if (!orgId) {
                console.error('No organization ID found');
                this.buildsContainer.innerHTML = '<p class="text-ij-text-dim text-sm">No organization selected</p>';
                return;
            }

            console.log('Loading builds for org:', orgId);

            // Query builds from Firebase
            const buildsRef = this.firebaseDb.ref(`qa_builds/${orgId}`);
            buildsRef.once('value', (snapshot) => {
                const data = snapshot.val();
                this.builds = data ? Object.entries(data).map(([id, build]) => ({
                    id,
                    ...build
                })).reverse() : [];

                console.log('Builds loaded:', this.builds.length);
                this.renderBuilds(this.builds);
            });
        } catch (error) {
            console.error('Error loading builds:', error);
            this.buildsContainer.innerHTML = '<p class="text-ij-error text-sm">Error loading builds</p>';
        }
    }

    renderBuilds(builds) {
        if (builds.length === 0) {
            this.buildsContainer.innerHTML = '<p class="text-ij-text-dim text-sm">No builds found</p>';
            this.updateDeleteButton();
            return;
        }

        this.buildsContainer.innerHTML = builds.map(build => `
            <div class="build-item p-3 flex items-center gap-3 hover:bg-opacity-70 transition cursor-pointer">
                <input type="checkbox" class="checkbox-custom build-checkbox" data-build-id="${build.id}" />
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start gap-2">
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 min-w-0">
                                <p class="text-sm font-semibold text-ij-text truncate flex-1">${this.getBuildDisplayName(build)}</p>
                                <button class="copy-link-btn" data-link="${build.apkUrl}">
                                    <svg viewBox="0 0 24 24" class="w-4 h-4 fill-current text-ij-text-dim" xmlns="http://www.w3.org/2000/svg">
                                        <g>
                                            <path fill-rule="evenodd" clip-rule="evenodd" d="M11.1667 0.25C8.43733 0.25 6.25 2.50265 6.25 5.25H12.8333C15.5627 5.25 17.75 7.50265 17.75 10.25V18.75H17.8333C20.5627 18.75 22.75 16.4974 22.75 13.75V5.25C22.75 2.50265 20.5627 0.25 17.8333 0.25H11.1667Z"/>\
                                            <path d="M2 10.25C2 7.90279 3.86548 6 6.16667 6H12.8333C15.1345 6 17 7.90279 17 10.25V18.75C17 21.0972 15.1345 23 12.8333 23H6.16667C3.86548 23 2 21.0972 2 18.75V10.25Z"/>
                                        </g>
                                    </svg>
                                </button>
                            </div>
                            <p class="text-xs text-ij-text-dim truncate mt-1">Environment: ${build.label || 'None'}</p>
                        </div>
                        <span class="text-xs text-ij-success flex-shrink-0">${this.formatDate(build.uploadedAt)}</span>
                    </div>
                    <p class="text-xs text-ij-text-dim truncate mt-1">Build ID: ${build.id || 'Unavailable'}</p>
                    <p class="text-xs text-ij-text-dim mt-1">Uploaded by: ${build.user || 'Unknown'}</p>
                </div>
            </div>
        `).join('');

        this.buildsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.copy-link-btn');
            if (!btn) return;

            e.stopPropagation();

            const link = btn.dataset.link;

            navigator.clipboard.writeText(link).then(() => {
                btn.classList.add("text-ij-success");
                this.showSnackbar("Copied to clipboard");
            });
        });

        // Add event listeners to checkboxes
        document.querySelectorAll('.build-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => this.handleCheckboxChange(e));
        });

        // Add click to select
        this.buildsContainer.querySelectorAll('.jb-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.build-checkbox')) {
                    const checkbox = card.querySelector('.build-checkbox');
                    checkbox.checked = !checkbox.checked;
                    this.handleCheckboxChange({ target: checkbox });
                }
            });
        });
    }

    showSnackbar(message = "Copied to clipboard") {
        const snackbar = document.getElementById("snackbar");

        snackbar.textContent = message;

        snackbar.classList.remove("opacity-0", "translate-y-2");
        snackbar.classList.add("opacity-100", "translate-y-0");

        setTimeout(() => {
            snackbar.classList.remove("opacity-100", "translate-y-0");
            snackbar.classList.add("opacity-0", "translate-y-2");
        }, 2000);
    }

    getBuildDisplayName(build) {
        if (!build.apkUrl) return build.version || 'Unknown';

        try {
            const fileName = build.category;

            if (build.version) {
                return `${fileName} (${build.version})`;
            }

            return fileName;
        } catch {
            return build.version || 'Unknown';
        }
    }

    handleCheckboxChange(e) {
        const buildId = e.target.dataset.buildId;
        if (e.target.checked) {
            this.selectedBuildIds.add(buildId);
        } else {
            this.selectedBuildIds.delete(buildId);
        }
        this.updateDeleteButton();
    }

    updateDeleteButton() {
        if (this.selectedBuildIds.size > 0) {
            this.deleteSelectedBtn.classList.remove('hidden');
        } else {
            this.deleteSelectedBtn.classList.add('hidden');
        }
    }

    filterBuilds(searchTerm) {
        const filtered = this.builds.filter(build => {
            const version = (build.version || '').toLowerCase();
            const label = (build.label || '').toLowerCase();
            const user = (build.user || '').toLowerCase();
            const name = (build.category || '').toLowerCase();
            const term = searchTerm.toLowerCase();

            return version.includes(term) || label.includes(term) || user.includes(term) || name.includes(term);
        });

        this.renderBuilds(filtered);
    }

    showDeleteConfirm() {
        this.deleteCount.textContent = this.selectedBuildIds.size;
        this.deleteConfirmModal.classList.add('active');
    }

    hideDeleteConfirm() {
        this.deleteConfirmModal.classList.remove('active');
    }

    async deleteSelected() {
        if (this.selectedBuildIds.size === 0) return;

        try {
            const orgId = localStorage.getItem('qdrop_org_id');
            const buildIds = Array.from(this.selectedBuildIds);

            console.log('Deleting builds:', buildIds);
            this.deleteSelectedBtn.disabled = true;
            this.deleteSelectedBtn.textContent = 'Deleting...';

            document.getElementById('deleteSpinnerOverlay').classList.remove('hidden');

            const response = await fetch('/api/delete-builds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ buildIds, organizationId: orgId, update: false })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const result = await response.json();
            console.log('Delete result:', result);

            this.selectedBuildIds.clear();
            this.hideDeleteConfirm();
            this.loadBuilds();
            document.dispatchEvent(new CustomEvent('storageUpdated'));
            this.deleteSelectedBtn.disabled = false;
            this.deleteSelectedBtn.textContent = 'Delete';
        } catch (error) {
            console.error('Error deleting builds:', error);
            alert('Error deleting builds: ' + error.message);
            this.deleteSelectedBtn.disabled = false;
            this.deleteSelectedBtn.textContent = 'Delete';
        } finally {
            document.getElementById('deleteSpinnerOverlay').classList.add('hidden');
        }
    }

    formatDate(timestamp) {
        if (!timestamp) return '-';
        const date = new Date(timestamp);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Wait a bit for Firebase to initialize
        setTimeout(() => {
            window.buildsManager = new BuildsManager();
        }, 500);
    });
} else {
    // Wait a bit for Firebase to initialize
    setTimeout(() => {
        window.buildsManager = new BuildsManager();
    }, 500);
}
