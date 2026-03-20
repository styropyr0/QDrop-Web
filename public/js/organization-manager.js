// Organization Management Class
class OrganizationManager {
    appCategoryEntries = {};
    apps = {};
    filters = {};

    constructor() {
        this.orgId = localStorage.getItem('qdrop_org_id');
        this.appToDelete = null;
        this.editingAppKey = null;
        this.editingAppName = null;
        console.log('Stored org ID:', this.orgId);
        this.init();
    }

    init() {
        if (!this.orgId) {
            console.log('No org ID found, showing modal');
            this.showOrgModal();
        } else {
            console.log('Org ID found, showing main interface');
            this.showMainInterface();
        }

        document.addEventListener('viewChanged', (e) => {
            if (e.detail && e.detail.view === 'apps') {
                this.loadApps();
            }
        });
    }

    showOrgModal() {
        const modal = document.getElementById('orgModal');
        if (modal) {
            modal.classList.remove('hidden');
            const input = document.getElementById('orgIdInput');
            if (input) {
                setTimeout(() => input.focus(), 100);
            }
        }
    }

    hideOrgModal() {
        const modal = document.getElementById('orgModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }

    async saveOrg(orgId) {
        console.log('Validating org ID:', orgId);
        
        try {
            const snapshot = await this.validateOrgIdWithFirebase(orgId);
            if (!snapshot || !snapshot.exists()) {
                this.showOrgError('Organization ID not found. Please contact your administrator for a valid organization ID.');
                return;
            }
            
            console.log('Saving org ID:', orgId);
            this.orgId = orgId;
            localStorage.setItem('qdrop_org_id', orgId);
            localStorage.setItem('org_name', snapshot.val().name || '');
            this.hideOrgModal();
            this.showMainInterface();
        } catch (error) {
            console.error('Error validating org ID:', error);
            this.showOrgError('Error validating organization ID. Please try again.');
        }
    }

    async validateOrgIdWithFirebase(orgId) {
        try {
            // Check if organization exists in Firebase
            const orgRef = database.ref(`organizations/${orgId}`);
            const snapshot = await orgRef.once('value');

            return snapshot.exists() ? snapshot: null;
        } catch (error) {
            console.error('Firebase validation error:', error);
            return null;
        }
    }

    showMainInterface() {
        console.log('Showing main interface for org:', this.orgId);
        const orgSection = document.getElementById('orgSection');
        const uploadSection = document.getElementById('uploadSection');
        const orgField = document.getElementById('orgIdField');
        const label = document.getElementById('labelField');
        const name = document.getElementById('userField');
        const orgName = document.getElementById('orgName');

        if (orgSection) orgSection.classList.remove('hidden');
        if (uploadSection) uploadSection.classList.remove('hidden');
        if (orgField) orgField.value = this.orgId;
        if (label) label.value = localStorage.getItem('label') || '';
        if (orgName) orgName.textContent = localStorage.getItem('org_name') || '';
        if (name) name.value = localStorage.getItem('user') || '';

        this.validateOrgIdWithFirebase(this.orgId).then(snapshot => {
            if (snapshot && snapshot.exists()) {
                this.apps = snapshot.val().apps || {};
                this.filters = snapshot.val().filters || {};
                this.appCategoryEntries = this.filters;
                console.log('Apps:', this.apps);
                console.log('App filters:', this.filters);
                this.setupDropdown(this.apps);
                this.renderAppsList();
                this.setupAppManagementHandlers();
                this.setAppFormMode('create');
            }
        });
    }

    setupDropdown(data) {
        const button = document.getElementById('dropdownButton');
        const menu = document.getElementById('dropdownMenu');
        const selected = document.getElementById('selectedOption');
        const list = document.getElementById('dropdownList');
        const hiddenInput = document.getElementById('categoryInput');

        list.innerHTML = '';

        const appsEntries = data && typeof data === 'object' ? Object.entries(data) : [];
        if (appsEntries.length === 0) {
            list.innerHTML = `<li class="px-4 py-2 text-ij-text-dim">No apps found</li>`;
            selected.textContent = 'Select the application';
            hiddenInput.value = '';
            return;
        }

        appsEntries.forEach(([key, appName]) => {
            const li = document.createElement('li');
            li.textContent = appName;
            li.dataset.key = key;
            li.className = 'px-4 py-2 hover:bg-ij-bg-alt/60 cursor-pointer';
            li.addEventListener('click', () => {
                selected.textContent = appName;
                hiddenInput.value = appName;
                menu.classList.add('hidden');
            });
            list.appendChild(li);
        });

        button.addEventListener('click', () => {
            menu.classList.toggle('hidden');
        });

        window.addEventListener('click', (e) => {
            if (!button.contains(e.target)) menu.classList.add('hidden');
        });
    }

    setupAppManagementHandlers() {
        const createBtn = document.getElementById('createAppBtn');
        if (createBtn) {
            createBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                await this.createAppFromForm();
            });
        }

        const appsList = document.getElementById('appsList');
        if (appsList) {
            appsList.addEventListener('click', (e) => {
                const deleteBtn = e.target.closest('.delete-app-btn');
                if (deleteBtn) {
                    const appKey = deleteBtn.dataset.appKey;
                    const appName = deleteBtn.dataset.appName;
                    if (!appKey || !appName) return;
                    this.showDeleteAppConfirm(appKey, appName);
                    return;
                }

                const editBtn = e.target.closest('.edit-app-btn');
                if (editBtn) {
                    const appKey = editBtn.dataset.appKey;
                    const appName = editBtn.dataset.appName;
                    const iconUrl = editBtn.dataset.iconUrl;
                    if (!appKey || !appName) return;
                    this.setAppFormMode('edit', appKey, appName, iconUrl);
                }
            });
        }

        const deleteConfirmBtn = document.getElementById('deleteAppConfirmBtn');
        const deleteCancelBtn = document.getElementById('deleteAppCancelBtn');

        if (deleteConfirmBtn) {
            deleteConfirmBtn.addEventListener('click', () => this.deleteAppConfirmed());
        }
        if (deleteCancelBtn) {
            deleteCancelBtn.addEventListener('click', () => this.hideDeleteAppConfirm());
        }
    }

    async createAppFromForm() {
        const appNameField = document.getElementById('newAppName');
        const iconUrlField = document.getElementById('newAppIcon');

        const appName = appNameField?.value?.trim();
        const iconUrl = iconUrlField?.value?.trim();

        if (!appName || !iconUrl) {
            this.showAppsMessage('App name and icon URL are required.', 'error');
            return;
        }

        if (!this.orgId) {
            this.showAppsMessage('Organization not set.', 'error');
            return;
        }

        if (this.editingAppKey) {
            const oldAppName = this.editingAppName;
            const appKey = this.editingAppKey;
            try {
                // If name changed, update filters key and app name
                if (oldAppName && oldAppName !== appName) {
                    // remove old filter entry
                    await database.ref(`organizations/${this.orgId}/filters/${oldAppName}`).remove();
                }

                await database.ref(`organizations/${this.orgId}/apps/${appKey}`).set(appName);
                await database.ref(`organizations/${this.orgId}/filters/${appName}`).set(iconUrl);

                this.apps[appKey] = appName;
                if (oldAppName && oldAppName !== appName) {
                    delete this.filters[oldAppName];
                }
                this.filters[appName] = iconUrl;
                this.appCategoryEntries = this.filters;

                this.setAppFormMode('create');
                this.setupDropdown(this.apps);
                this.renderAppsList();
                this.showAppsMessage(`App '${appName}' updated successfully.`, 'success');
            } catch (error) {
                console.error('Error updating app:', error);
                this.showAppsMessage('Failed to update app. Please try again.', 'error');
            }
            return;
        }

        const appKey = this.createAppKey(appName);
        try {
            await database.ref(`organizations/${this.orgId}/apps/${appKey}`).set(appName);
            await database.ref(`organizations/${this.orgId}/filters/${appName}`).set(iconUrl);

            this.apps[appKey] = appName;
            this.filters[appName] = iconUrl;
            this.appCategoryEntries = this.filters;

            this.setupDropdown(this.apps);
            this.renderAppsList();
            this.showAppsMessage(`App '${appName}' created successfully.`, 'success');

            this.setAppFormMode('create');
        } catch (error) {
            console.error('Error creating app:', error);
            this.showAppsMessage('Failed to create app. Please try again.', 'error');
        }
    }

    createAppKey(appName) {
        const normalized = appName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
        return normalized || `app_${Date.now()}`;
    }

    setAppFormMode(mode, appKey = null, appName = '', iconUrl = '') {
        const appNameField = document.getElementById('newAppName');
        const iconUrlField = document.getElementById('newAppIcon');
        const createBtn = document.getElementById('createAppBtn');

        if (!createBtn || !appNameField || !iconUrlField) return;

        if (mode === 'edit') {
            this.editingAppKey = appKey;
            this.editingAppName = appName;
            appNameField.value = appName;
            iconUrlField.value = iconUrl;
            createBtn.textContent = 'Save App';
            createBtn.classList.add('bg-ij-purple');
            createBtn.classList.remove('bg-ij-blue');
        } else {
            this.editingAppKey = null;
            this.editingAppName = null;
            appNameField.value = '';
            iconUrlField.value = '';
            createBtn.textContent = 'Add App';
            createBtn.classList.add('bg-ij-blue');
            createBtn.classList.remove('bg-ij-purple');
        }
    }

    showDeleteAppConfirm(appKey, appName) {
        this.appToDelete = { appKey, appName };
        const modal = document.getElementById('deleteAppConfirmModal');
        const nameSpan = document.getElementById('deleteAppName');
        if (nameSpan) nameSpan.textContent = appName;
        if (modal) modal.classList.add('active');
    }

    hideDeleteAppConfirm() {
        const modal = document.getElementById('deleteAppConfirmModal');
        if (modal) modal.classList.remove('active');
        this.appToDelete = null;
    }

    async deleteAppConfirmed() {
        if (!this.appToDelete || !this.orgId) return;

        const { appKey, appName } = this.appToDelete;

        try {
            await database.ref(`organizations/${this.orgId}/apps/${appKey}`).remove();
            await database.ref(`organizations/${this.orgId}/filters/${appName}`).remove();

            delete this.apps[appKey];
            delete this.filters[appName];
            this.appCategoryEntries = this.filters;

            this.setupDropdown(this.apps);
            this.renderAppsList();
            this.showAppsMessage(`App '${appName}' deleted successfully.`, 'success');
        } catch (error) {
            console.error('Error deleting app:', error);
            this.showAppsMessage('Failed to delete app. Please try again.', 'error');
        } finally {
            this.hideDeleteAppConfirm();
        }
    }

    renderAppsList() {
        const appsList = document.getElementById('appsList');
        const appsCount = document.getElementById('appsCount');
        if (!appsList || !appsCount) return;

        const entries = Object.entries(this.apps || {});
        if (entries.length === 0) {
            appsList.innerHTML = '<p class="text-ij-text-dim">No apps yet. Use the form above to add your first app.</p>';
            appsCount.textContent = '0 apps';
            return;
        }

        appsList.innerHTML = entries.map(([key, appName]) => {
            const icon = this.filters[appName] || '';
            return `
                <div class="border border-white/10 rounded-xl p-3 bg-[rgba(10,15,25,0.5)] flex items-center gap-3">
                    <div class="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center overflow-hidden relative">
                        ${icon ? `<img src="${icon}" alt="${appName}" class="w-full h-full object-cover" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">` : ''}
                        <div class="fallback-icon w-full h-full rounded-lg flex items-center justify-center" style="display:${icon ? 'none' : 'flex'};">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-4 h-4 text-white">
                                <circle cx="12" cy="12" r="10" fill="#ef4444"/>
                                <line x1="8" y1="8" x2="16" y2="16" stroke="white" stroke-width="2" stroke-linecap="round"/>
                                <line x1="16" y1="8" x2="8" y2="16" stroke="white" stroke-width="2" stroke-linecap="round"/>
                            </svg>
                        </div>
                    </div>
                    <div class="flex-1">
                        <div class="flex items-center justify-between gap-4">
                            <div class="font-medium text-ij-text">${appName}</div>
                        </div>
                        <div class="text-xs text-ij-text-dim">Icon: ${icon || 'not set'}</div>
                    </div>
                    <div class="flex gap-2">
                        <button class="edit-app-btn text-sm px-3 py-1 rounded-lg bg-ij-blue/20 text-ij-blue hover:bg-ij-blue/30" data-app-key="${key}" data-app-name="${appName}" data-icon-url="${icon}">Edit</button>
                        <button class="delete-app-btn text-sm px-3 py-1 rounded-lg bg-ij-error/20 text-ij-error hover:bg-ij-error/30" data-app-key="${key}" data-app-name="${appName}" aria-label="Delete ${appName}">Delete</button>
                    </div>
                </div>`;
        }).join('');

        appsCount.textContent = `${entries.length} app${entries.length === 1 ? '' : 's'}`;
    }

    showAppsMessage(message, type = 'info') {
        const messageEl = document.getElementById('appsMessage');
        if (!messageEl) return;
        messageEl.textContent = message;
        messageEl.classList.remove('hidden', 'text-ij-success', 'text-ij-error', 'text-ij-warning', 'text-ij-blue');

        if (type === 'success') {
            messageEl.classList.add('text-ij-success');
        } else if (type === 'error') {
            messageEl.classList.add('text-ij-error');
        } else {
            messageEl.classList.add('text-ij-blue');
        }

        messageEl.classList.remove('hidden');
    }

    async loadApps() {
        if (!this.orgId) return;
        try {
            const snapshot = await database.ref(`organizations/${this.orgId}`).once('value');
            const orgData = snapshot.val() || {};
            this.apps = orgData.apps || {};
            this.filters = orgData.filters || {};
            this.appCategoryEntries = this.filters;
            this.setupDropdown(this.apps);
            this.renderAppsList();
        } catch (error) {
            console.error('Error loading apps:', error);
        }
    }

    editOrg() {
        const field = document.getElementById('orgIdField');
        if (field) {
            field.readOnly = false;
            field.focus();
            field.select();
        }
    }

    async updateOrg(newOrgId) {
        if (newOrgId && newOrgId !== this.orgId) {
            await this.saveOrg(newOrgId);
        }
        const field = document.getElementById('orgIdField');
        if (field) {
            field.readOnly = true;
        }
    }

    showOrgError(message) {
        const orgIdInput = document.getElementById('orgIdInput');
        const errorDiv = document.getElementById('orgErrorMessage');
        
        if (orgIdInput) {
            orgIdInput.classList.add('error');
            setTimeout(() => orgIdInput.classList.remove('error'), 3000);
        }
        
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
            
            setTimeout(() => {
                errorDiv.classList.add('hidden');
            }, 5000);
        }
    }
}
