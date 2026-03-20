/**
 * Storage Analytics Manager
 * Handles fetching and displaying storage usage from R2
 */
class StorageAnalyticsManager {
    constructor() {
        this.storageSize = document.getElementById('storageSize');
        this.storageBarFill = document.getElementById('storageBarFill');
        this.totalFiles = document.getElementById('totalFiles');
        this.percentageUsed = document.getElementById('percentageUsed');

        // Listen for view changes
        document.addEventListener('viewChanged', (e) => {
            if (e.detail.view === 'manage') {
                console.log('Manage view activated, loading storage info...');
                this.loadStorageInfo();
            }
        });

        document.addEventListener('storageUpdated', () => {
            console.log('Storage update triggered');
            this.loadStorageInfo();
        });
    }

    async loadStorageInfo() {
        try {
            const orgId = localStorage.getItem('qdrop_org_id');
            if (!orgId) {
                console.error('No organization ID found');
                return;
            }

            console.log('Loading storage info for org:', orgId);
            const response = await fetch(`/api/storage-info?orgId=${encodeURIComponent(orgId)}`);

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            console.log('Storage data received:', data);

            this.displayStorageInfo(data);
        } catch (error) {
            console.error('Error loading storage info:', error);
            this.storageSize.textContent = 'Error loading';
            this.totalFiles.textContent = '0';
            this.percentageUsed.textContent = '0%';
        }
    }

    displayStorageInfo(data) {
        const totalSizeInMB = data.totalSize || 0;
        const totalCount = data.totalObjects || 0;

        // Format size
        const sizeInGB = (totalSizeInMB / 1024).toFixed(2);
        this.storageSize.textContent = `${sizeInGB} GB / ${ (data.availableStorage / 1000).toFixed(2) } GB`;

        // Update progress bar
        const percentage = Math.min((totalSizeInMB / data.availableStorage) * 100, 100);
        this.storageBarFill.style.width = `${percentage}%`;

        // Update counts
        this.totalFiles.textContent = totalCount.toLocaleString();
        this.percentageUsed.textContent = `${percentage.toFixed(1)}%`;
    }

    formatBytes(bytes) {
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.storageAnalytics = new StorageAnalyticsManager();
    });
} else {
    window.storageAnalytics = new StorageAnalyticsManager();
}
