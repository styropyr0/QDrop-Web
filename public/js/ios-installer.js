class IOSInstaller {
    constructor() {
        this.buildList = document.getElementById('iosBuildList');
        this.buildCount = document.getElementById('iosBuildCount');
        this.init();
    }

    init() {
        setTimeout(() => {
            const ipaBuildsView = document.getElementById('ipaBuildsView');
            if (ipaBuildsView && ipaBuildsView.classList.contains('active')) {
                this.loadBuilds();
            }
        }, 100);

        document.addEventListener('viewChanged', (e) => {
            if (e.detail?.view === 'ipaBuilds') {
                this.loadBuilds();
            }
        });
    }

    async loadBuilds() {
        const orgId = localStorage.getItem('qdrop_org_id');
        if (!orgId) {
            this.showMessage('No organization selected.');
            return;
        }

        try {
            const snapshot = await database.ref(`qa_builds/${orgId}`).once('value');
            const builds = snapshot.val() || {};

            const entries = Object.entries(builds)
                .filter(([key, build]) => build.ipaUrl)
                .reverse();

            if (!entries.length) {
                this.showMessage('No iOS builds available. Upload an IPA build to generate iOS install links.');
                this.buildCount.textContent = '0 builds';
                return;
            }

            this.buildCount.textContent = `${entries.length} build${entries.length === 1 ? '' : 's'}`;
            this.buildList.innerHTML = entries.map(([id, build]) => {
                const displayName = build.category || 'Unknown App';
                const version = build.version || 'N/A';
                const manifestUrl = `${window.location.protocol}//${window.location.host}/manifest/${encodeURIComponent(orgId)}/${encodeURIComponent(id)}`;
                const itmsUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
                const uploadedBy = build.user || 'Unknown';
                const uploadedAt = build.uploadedAt
                    ? new Date(build.uploadedAt).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true
                    }).replace(',', ' at')
                    : 'Unknown';
                const minOsVersion = build.minOsVersion || 'N/A';
                const ipaFileSize = build.ipaFileSize || 0;
                const imageUrl = build.imageUrl;
                const label = build.label || 'Unspecified';

                return `
                <div class="border border-white/10 rounded-xl p-3 bg-[rgba(10,15,25,0.4)]">
                                
                    <div class="flex flex-wrap justify-between gap-3 items-start">
                                
                        <!-- LEFT -->
                        <div class="flex gap-3">
                            <img src="${imageUrl}" alt="app icon" 
                                 class="w-10 h-10 rounded-lg object-cover border border-white/10"/>
                                
                            <div>
                                <div class="font-semibold text-ij-text flex items-center gap-2">
                                    ${displayName}
                                    <span class="text-[0.7rem] px-2 py-[2px] rounded-md bg-white/10 text-ij-text-dim">
                                        ${label}
                                    </span>
                                </div>
                                
                                <div class="text-sm text-ij-text-dim">Version: ${version}</div>
                                
                                <div class="text-[0.8rem] text-ij-text-dim mt-1 space-y-[2px]">
                                    <div>Build ID: ${id}</div>
                                    <div>Uploaded by: ${uploadedBy}</div>
                                    <div>Uploaded: ${uploadedAt}</div>
                                    <div>Min iOS: ${minOsVersion}</div>
                                    <div>Size: ${(ipaFileSize / (1024 * 1024)).toFixed(1)} MB</div>
                                </div>
                            </div>
                        </div>
                                
                        <!-- RIGHT ACTIONS -->
                        <div class="flex gap-2">
                            <a href="${itmsUrl}" 
                               class="text-xs font-semibold text-white bg-ij-blue px-3 py-1 rounded-lg hover:bg-ij-blue/90" 
                               target="_blank" rel="noreferrer">
                               Install
                            </a>
                                
                            <button 
                                onclick="navigator.clipboard.writeText('${itmsUrl}'); this.innerText='Copied!'; setTimeout(() => this.innerText='Copy Direct URL', 1500);"
                                class="text-xs font-semibold text-ij-text-dim bg-white/10 px-3 py-1 rounded-lg hover:bg-white/20">
                                Copy Direct URL
                            </button>
                                
                            <button 
                                onclick="showQR('${itmsUrl}')"
                                class="text-xs font-semibold text-ij-text-dim bg-white/10 px-3 py-1 rounded-lg hover:bg-white/20">
                                QR
                            </button>
                        </div>
                    </div>
                                
                </div>
                `;
            }).join('');
        } catch (error) {
            console.error('Error loading iOS builds:', error);
            this.showMessage('Error loading iOS builds. Check console for details.');
        }
    }

    showMessage(message) {
        this.buildList.innerHTML = `<p class="text-ij-text-dim">${message}</p>`;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.iosInstaller = new IOSInstaller();
    });
} else {
    window.iosInstaller = new IOSInstaller();
}
