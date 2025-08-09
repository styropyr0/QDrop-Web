// Organization Management Class
class OrganizationManager {
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
            const isValid = await this.validateOrgIdWithFirebase(orgId);
            
            if (!isValid) {
                this.showOrgError('Organization ID not found. Please contact your administrator for a valid organization ID.');
                return;
            }
            
            console.log('Saving org ID:', orgId);
            this.orgId = orgId;
            localStorage.setItem('qdrop_org_id', orgId);
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
            
            return snapshot.exists();
        } catch (error) {
            console.error('Firebase validation error:', error);
            return false;
        }
    }

    showMainInterface() {
        console.log('Showing main interface for org:', this.orgId);
        const orgSection = document.getElementById('orgSection');
        const uploadSection = document.getElementById('uploadSection');
        const orgField = document.getElementById('orgIdField');
        const label = document.getElementById('labelField');

        if (orgSection) orgSection.classList.remove('hidden');
        if (uploadSection) uploadSection.classList.remove('hidden');
        if (orgField) orgField.value = this.orgId;
        if (label) label.value = localStorage.getItem('label') || '';
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
