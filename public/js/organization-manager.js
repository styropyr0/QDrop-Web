// Organization Management Class
class OrganizationManager {
    appCategoryEntries = {};

    constructor() {
        this.orgId = localStorage.getItem('qdrop_org_id');
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
                this.appCategoryEntries = snapshot.val().filters || {};
                console.log('App categories:', this.appCategoryEntries);
                this.setupDropdown(snapshot.val().apps || []);
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

        const appEntries = Object.entries(data || {});
        if (appEntries.length === 0) {
            list.innerHTML = `<li class="px-4 py-2 text-ij-text-dim">No apps found</li>`;
        } else {
            appEntries.forEach(([key, value]) => {
                const li = document.createElement('li');
                li.textContent = value;
                li.dataset.key = key;
                li.className = 'px-4 py-2 hover:bg-ij-bg-alt/60 cursor-pointer';
                li.addEventListener('click', () => {
                    selected.textContent = value;
                    hiddenInput.value = value; 
                    menu.classList.add('hidden');
                });
                list.appendChild(li);
            });
        }

        button.addEventListener('click', () => {
            menu.classList.toggle('hidden');
        });

        window.addEventListener('click', (e) => {
            if (!button.contains(e.target)) menu.classList.add('hidden');
        });
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
