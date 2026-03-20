class SidebarNavigation {
    constructor() {
        this.sidebar = document.getElementById('sidebar');
        this.navItems = document.querySelectorAll('.nav-item');
        this.views = document.querySelectorAll('.view');
        this.collapseToggle = document.getElementById('collapseToggle');
        this.mobileToggle = document.getElementById('mobileToggle');
        this.isCollapsed = false;
        this.isMobileOpen = false;

        this.init();
    }

    init() {
        this.loadCollapsedState();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Navigation items
        this.navItems.forEach(item => {
            item.addEventListener('click', () => this.switchView(item.dataset.view));
        });

        // Collapse toggle
        if (this.collapseToggle) {
            this.collapseToggle.addEventListener('click', () => this.toggleCollapse());
        }

        // Mobile toggle
        if (this.mobileToggle) {
            this.mobileToggle.addEventListener('click', () => this.toggleMobile());
        }

        // Close sidebar on view change on mobile
        if (window.innerWidth <= 768) {
            this.navItems.forEach(item => {
                item.addEventListener('click', () => this.closeMobile());
            });
        }

        // Handle window resize
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                this.closeMobile();
            }
        });
    }

    switchView(viewName) {
        console.log(`[v0] Switching to view: ${viewName}`);

        // Update nav items
        this.navItems.forEach(item => {
            if (item.dataset.view === viewName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Update views
        this.views.forEach(view => {
            if (view.id === `${viewName}View`) {
                view.classList.add('active');
            } else {
                view.classList.remove('active');
            }
        });

        // Close mobile sidebar
        if (window.innerWidth <= 768) {
            this.closeMobile();
        }

        // Trigger any view-specific initialization
        this.triggerViewEvent(viewName);
    }

    triggerViewEvent(viewName) {
        const event = new CustomEvent('viewChanged', { detail: { view: viewName } });
        document.dispatchEvent(event);
    }

    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        if (this.isCollapsed) {
            this.sidebar.classList.add('collapsed');
        } else {
            this.sidebar.classList.remove('collapsed');
        }
        this.saveCollapsedState();
    }

    toggleMobile() {
        this.isMobileOpen = !this.isMobileOpen;
        if (this.isMobileOpen) {
            this.sidebar.classList.add('active');
        } else {
            this.sidebar.classList.remove('active');
        }
    }

    closeMobile() {
        this.isMobileOpen = false;
        if (this.sidebar) {
            this.sidebar.classList.remove('active');
        }
    }

    saveCollapsedState() {
        localStorage.setItem('sidebar-collapsed', JSON.stringify(this.isCollapsed));
    }

    loadCollapsedState() {
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved) {
            this.isCollapsed = JSON.parse(saved);
            if (this.isCollapsed) {
                this.sidebar.classList.add('collapsed');
            }
        }
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.sidebarNav = new SidebarNavigation();
    });
} else {
    window.sidebarNav = new SidebarNavigation();
}
