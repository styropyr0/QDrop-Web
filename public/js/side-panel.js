/**
 * Side Panel Manager
 * Handles opening/closing the side panel and tab switching
 */
class SidePanelManager {
    constructor() {
        this.panel = document.getElementById('sidePanel');
        this.toggle = document.getElementById('sidePanelToggle');
        this.closeBtn = document.getElementById('sidePanelClose');
        this.tabs = document.querySelectorAll('.side-panel-tab');
        this.tabContents = document.querySelectorAll('.tab-content');
        this.activeTab = 'upload';

        this.initEventListeners();
    }

    initEventListeners() {
        // Toggle button
        this.toggle.addEventListener('click', () => this.open());
        this.closeBtn.addEventListener('click', () => this.close());

        // Tab switching
        this.tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                const tabName = e.currentTarget.dataset.tab;
                this.switchTab(tabName);
            });
        });

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.panel.contains(e.target) && !this.toggle.contains(e.target)) {
                if (this.panel.classList.contains('active')) {
                    // Don't close if clicking on content elements
                    if (!e.target.closest('.jb-input') && !e.target.closest('button')) {
                        // Allow closing only if clicking on background
                    }
                }
            }
        });

        // Close on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.panel.classList.contains('active')) {
                this.close();
            }
        });
    }

    open() {
        this.panel.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    close() {
        this.panel.classList.remove('active');
        document.body.style.overflow = 'auto';
    }

    switchTab(tabName) {
        // Update active tab button
        this.tabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update active tab content
        this.tabContents.forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}Tab`);
            content.classList.toggle('hidden', content.id !== `${tabName}Tab`);
        });

        this.activeTab = tabName;

        // Trigger load for manage tab
        if (tabName === 'manage') {
            if (window.storageAnalytics) {
                window.storageAnalytics.loadStorageInfo();
            }
            if (window.buildsManager) {
                window.buildsManager.loadBuilds();
            }
        }
    }

    getActiveTab() {
        return this.activeTab;
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.sidePanel = new SidePanelManager();
    });
} else {
    window.sidePanel = new SidePanelManager();
}
