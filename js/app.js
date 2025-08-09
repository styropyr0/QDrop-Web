// Main Application Initialization
class QDropApp {
    constructor() {
        this.orgManager = null;
        this.uploadManager = null;
        this.init();
    }

    init() {
        document.addEventListener('DOMContentLoaded', () => {
            console.log('QDrop Dashboard initializing...');
            
            // Initialize managers
            this.orgManager = new OrganizationManager();
            this.uploadManager = new UploadManager(this.orgManager);
            
            // Setup event listeners
            this.setupEventListeners();
            
            console.log('QDrop dashboard initialized successfully!');
        });
    }

    setupEventListeners() {
        // Organization modal handlers
        this.setupOrganizationModalHandlers();
        
        // Organization editing handlers
        this.setupOrganizationEditHandlers();
        
        // Keyboard shortcuts
        this.setupKeyboardShortcuts();
    }

    setupOrganizationModalHandlers() {
        const orgSaveBtn = document.getElementById('orgSaveBtn');
        const orgCancelBtn = document.getElementById('orgCancelBtn');
        const orgIdInput = document.getElementById('orgIdInput');

        if (orgSaveBtn) {
            orgSaveBtn.addEventListener('click', async () => {
                const orgId = orgIdInput?.value?.trim();
                if (orgId) {
                    await this.orgManager.saveOrg(orgId);
                } else {
                    this.orgManager.showOrgError('Please enter an organization ID');
                }
            });
        }

        if (orgCancelBtn) {
            orgCancelBtn.addEventListener('click', () => {
                if (this.orgManager.orgId) {
                    this.orgManager.hideOrgModal();
                }
            });
        }

        if (orgIdInput) {
            orgIdInput.addEventListener('keypress', async (e) => {
                if (e.key === 'Enter') {
                    const orgId = e.target.value.trim();
                    if (orgId) {
                        await this.orgManager.saveOrg(orgId);
                    }
                }
            });
        }
    }

    setupOrganizationEditHandlers() {
        const editOrgBtn = document.getElementById('editOrgBtn');
        const changeOrgBtn = document.getElementById('changeOrgBtn');
        const orgIdField = document.getElementById('orgIdField');

        if (editOrgBtn) {
            editOrgBtn.addEventListener('click', () => {
                this.orgManager.editOrg();
            });
        }

        if (changeOrgBtn) {
            changeOrgBtn.addEventListener('click', () => {
                this.orgManager.editOrg();
            });
        }

        if (orgIdField) {
            orgIdField.addEventListener('blur', async (e) => {
                await this.orgManager.updateOrg(e.target.value.trim());
            });

            orgIdField.addEventListener('keypress', async (e) => {
                if (e.key === 'Enter') {
                    await this.orgManager.updateOrg(e.target.value.trim());
                }
            });
        }
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl/Cmd + U to focus on upload
            if ((e.ctrlKey || e.metaKey) && e.key === 'u') {
                e.preventDefault();
                const fileInput = document.getElementById('apkFile');
                if (fileInput) fileInput.click();
            }
            
            // Escape to close modal
            if (e.key === 'Escape') {
                const modal = document.getElementById('orgModal');
                if (modal && !modal.classList.contains('hidden')) {
                    this.orgManager.hideOrgModal();
                }
            }
        });
    }
}

// Initialize the application
new QDropApp();
