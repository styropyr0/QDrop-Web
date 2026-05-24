class SidebarNavigation {
    constructor() {
        this.sidebar = document.getElementById('sidebar');
        this.navItems = document.querySelectorAll('.nav-item');
        this.views = document.querySelectorAll('.view');
        this.collapseToggle = document.getElementById('collapseToggle');
        this.mobileToggle = document.getElementById('mobileToggle');
        this.backdrop = document.getElementById('sidebarBackdrop');
        this.isCollapsed = false;
        this.isMobileOpen = false;

        this.init();
    }

    init() {
        this.loadCollapsedState();
        this.setupEventListeners();
        this.handleURLRouting();
    }

    handleURLRouting() {
        const pathname = window.location.pathname;
        let targetView = 'upload';

        if (pathname.includes('ipaBuilds')) {
            targetView = 'ipaBuilds';
        } else if (pathname.includes('apps')) {
            targetView = 'apps';
        } else if (pathname.includes('manage')) {
            targetView = 'manage';
        } else if (pathname.includes('about')) {
            targetView = 'about';
        }

        if (targetView !== 'upload') {
            this.switchView(targetView);
        }
    }

    isMobile() {
        return window.innerWidth <= 768;
    }

    setupEventListeners() {
        // Navigation items
        this.navItems.forEach(item => {
            item.addEventListener('click', () => {
                this.switchView(item.dataset.view);
                if (this.isMobile()) this.closeMobile();
            });
        });

        // Collapse toggle — desktop only
        if (this.collapseToggle) {
            this.collapseToggle.addEventListener('click', () => {
                if (!this.isMobile()) this.toggleCollapse();
            });
        }

        // Mobile toggle
        if (this.mobileToggle) {
            this.mobileToggle.addEventListener('click', () => this.toggleMobile());
        }

        // Backdrop tap to dismiss
        if (this.backdrop) {
            this.backdrop.addEventListener('click', () => this.closeMobile());
        }

        // Handle window resize
        window.addEventListener('resize', () => {
            if (!this.isMobile()) {
                this.closeMobile();
            }
        });
    }

    switchView(viewName) {
        this.navItems.forEach(item => {
            item.classList.toggle('active', item.dataset.view === viewName);
        });

        this.views.forEach(view => {
            view.classList.toggle('active', view.id === `${viewName}View`);
        });

        this.triggerViewEvent(viewName);
    }

    triggerViewEvent(viewName) {
        const event = new CustomEvent('viewChanged', { detail: { view: viewName } });
        document.dispatchEvent(event);
    }

    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        this.sidebar.classList.toggle('collapsed', this.isCollapsed);
        this.saveCollapsedState();
    }

    toggleMobile() {
        if (this.isMobileOpen) {
            this.closeMobile();
        } else {
            this.openMobile();
        }
    }

    openMobile() {
        this.isMobileOpen = true;
        this.sidebar.classList.add('mobile-open');
        if (this.backdrop) this.backdrop.classList.add('active');
    }

    closeMobile() {
        this.isMobileOpen = false;
        this.sidebar.classList.remove('mobile-open');
        if (this.backdrop) this.backdrop.classList.remove('active');
    }

    saveCollapsedState() {
        localStorage.setItem('sidebar-collapsed', JSON.stringify(this.isCollapsed));
    }

    loadCollapsedState() {
        if (this.isMobile()) return;
        const saved = localStorage.getItem('sidebar-collapsed');
        if (saved) {
            this.isCollapsed = JSON.parse(saved);
            if (this.isCollapsed) {
                this.sidebar.classList.add('collapsed');
            }
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.sidebarNav = new SidebarNavigation();
    });
} else {
    window.sidebarNav = new SidebarNavigation();
}