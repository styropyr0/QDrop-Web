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

            const buildsRef = this.firebaseDb.ref(`qa_builds/${orgId}`);
            buildsRef.once('value', (snapshot) => {
                const data = snapshot.val();
                this.builds = data ? Object.entries(data)
                    .map(([id, build]) => ({ id, ...build }))
                    .sort((a, b) => {
                        const aTime = new Date(a.uploadedAt).getTime() || 0;
                        const bTime = new Date(b.uploadedAt).getTime() || 0;
                        return bTime - aTime;
                    }) : [];

                console.log('Builds loaded:', this.builds.length);
                this.renderBuilds(this.builds);
            });
        } catch (error) {
            console.error('Error loading builds:', error);
            this.buildsContainer.innerHTML = '<p class="text-ij-error text-sm">Error loading builds</p>';
        }
    }

    renderBuilds(builds) {
        const orgId = localStorage.getItem('qdrop_org_id');

        if (builds.length === 0) {
            this.buildsContainer.innerHTML = '<p class="text-ij-text-dim text-sm">No builds found</p>';
            this.updateDeleteButton();
            return;
        }

        this.buildsContainer.innerHTML = builds.map(build => `
            <div class="build-item p-3 flex items-start gap-3 hover:bg-opacity-70 transition cursor-pointer" data-url="/${orgId}/${build.id}">

                <div class="flex-shrink-0">
                    ${build.imageUrl
                ? `<img src="${build.imageUrl}" class="w-10 h-10 rounded-lg object-cover border border-white/10" />`
                : `<div class="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center text-xs text-ij-text-dim">N/A
                    </div>`
            }
                </div>
                    
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start gap-2">
                        <div class="min-w-0">
                            <div class="flex items-center gap-2 min-w-0">
                                <p class="text-sm font-semibold text-ij-text truncate flex-1">
                                    ${this.getBuildDisplayName(build)}
                                </p>
                    
                                <button class="copy-link-btn" data-link="${window.location.origin}/${orgId}/${build.id}" title="Copy build link">
                                    <svg viewBox="0 0 24 24" class="w-4 h-4 fill-current text-ij-text-dim">
                                        <path
                                            d="M11.1667 0.25C8.43733 0.25 6.25 2.50265 6.25 5.25H12.8333C15.5627 5.25 17.75 7.50265 17.75 10.25V18.75H17.8333C20.5627 18.75 22.75 16.4974 22.75 13.75V5.25C22.75 2.50265 20.5627 0.25 17.8333 0.25H11.1667Z" />
                                        <path
                                            d="M2 10.25C2 7.90279 3.86548 6 6.16667 6H12.8333C15.1345 6 17 7.90279 17 10.25V18.75C17 21.0972 15.1345 23 12.8333 23H6.16667C3.86548 23 2 21.0972 2 18.75V10.25Z" />
                                    </svg>
                                </button>
                            </div>
                    
                            <p class="text-xs text-ij-text-dim mt-1">
                                Environment: ${build.label || 'None'}
                            </p>
                        </div>
                    
                        <span class="text-xs text-ij-success flex-shrink-0">
                            ${this.formatDate(build.uploadedAt)}
                        </span>
                    </div>
                    
                    <p class="text-xs text-ij-text-dim mt-1">
                        Build ID: ${build.id || 'Unavailable'}
                    </p>
                    
                    <p class="text-xs text-ij-text-dim mt-1">
                        Uploaded by: ${build.user || 'Unknown'}
                    </p>
                    
                    <p class="text-xs text-ij-text-dim mt-1 flex items-center gap-2">
                        Platforms:
                        ${build.apkUrl ? `
                        <span title="Android">
                            <svg viewBox="0 0 24 24" class="w-4 h-4">
                                <path fill="currentColor"
                                    d="M18.4472,4.10555 C18.9412,4.35254 19.1414,4.95321 18.8944,5.44719 L17.7199,7.79631 C20.3074,9.6038 22,12.6042 22,16 L22,17 C22,18.1046 21.1046,19 20,19 L4,19 C2.89543,19 2,18.1046 2,17 L2,16 C2,12.6042 3.69259,9.60379 6.28014,7.79631 L5.10558,5.44719 C4.85859,4.95321 5.05881,4.35254 5.55279,4.10555 C6.04677,3.85856 6.64744,4.05878 6.89443,4.55276 L8.028,6.8199 C9.24553,6.29239 10.5886,6 12,6 C13.4114,6 14.7545,6.29239 15.972,6.8１９９１ L１７．１０５６，４．５５２７６ C１７．３５２６，４．０５８７８ １７．９５３２，３．８５８５６ １８．４４７２，４．１０５５５ Z" />
                            </svg>
                        </span>
                        ` : ''}
                        
                        ${build.ipaUrl ? `
                        <span title="iOS">
                            <svg viewBox="-1.5 0 20 20" class="w-4 h-4">
                                <path fill="currentColor"
                                    d="M57.5708873,7282.19296 C58.2999598,7281.34797 58.7914012,7280.17098 58.6569121,7279 C57.6062792,7279.04 56.3352055,7279.67099 55.5818643,7280.51498 C54.905374,7281.26397 54.3148354,7282.46095 54.4735932,7283.60894 C55.6455696,7283.69593 56.8418148,7283.03894 57.5708873,7282.19296 M60.1989864,7289.62485 C60.2283111,7292.65181 62.9696641,7293.65879 63,7293.67179 C62.9777537,7293.74279 62.562152,7295.10677 61.5560117,7296.51675 C60.6853718,7297.73474 59.7823735,7298.94772 58.3596204,7298.97372 C56.9621472,7298.99872 56.5121648,7298.17973 54.9134635,7298.17973 C53.3157735,7298.17973 52.8162425,7298.94772 51.4935978,7298.99872 C50.1203933,7299.04772 49.0738052,7297.68074 48.197098,7296.46676 C46.4032359,7293.98379 45.0330649,7289.44985 46.8734421,7286.3899 C47.7875635,7284.87092 49.4206455,7283.90793 51.1942837,7283.88393 C52.5422083,7283.85893 53.8153044,7284.75292 54.6394294,7284.75292 C55.4635543,7284.75292 57.0106846,7283.67793 58.6366882,7283.83593 C59.3172232,7283.86293 61.2283842,7284.09893 62.4549652,7285.8199 C62.355868,7285.8789 60.1747177,7287.09489 60.1989864,7289.62485"
                                    transform="translate(-46, -7279)" />
                            </svg>
                        </span>
                        ` : ''}
                    </p>
                </div>
                        
                <div class="self-center">
                    <input type="checkbox" class="checkbox-custom build-checkbox" data-build-id="${build.id}" />
                </div>
                        
            </div>`).join('');

        this.buildsContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.copy-link-btn');

            if (btn) {
                e.stopPropagation();

                const link = btn.dataset.link;

                navigator.clipboard.writeText(link).then(() => {
                    btn.classList.add("text-ij-success");
                    this.showSnackbar("Copied to clipboard");
                });

                return;
            }

            if (
                e.target.closest('.build-checkbox') ||
                e.target.closest('label') ||
                e.target.closest('.checkbox-custom')
            ) {
                return;
            }

            const buildItem = e.target.closest('.build-item');
            if (!buildItem) return;

            window.open(buildItem.dataset.url, '_blank');
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
