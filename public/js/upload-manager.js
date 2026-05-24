class UploadManager {
    constructor(orgManager) {
        this.orgManager = orgManager;
        this.selectedApk = null;
        this.selectedIpa = null;
        this.setupForm();
        this.setupUnifiedFileInput();
    }

    setupForm() {
        const form = document.getElementById('uploadForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }
    }

    setupUnifiedFileInput() {
        const fileInput = document.getElementById('apkFile');
        const fileDisplay = document.getElementById('fileInputDisplay');

        if (!fileInput || !fileDisplay) return;

        // Allow both APK and IPA
        fileInput.setAttribute('accept', '.apk,.ipa');
        fileInput.removeAttribute('multiple');

        fileDisplay.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.handleFileAdd(file);
            fileInput.value = '';
        });

        this.setupDragAndDrop(fileDisplay, fileInput);
        this.renderFileSlots();
    }

    async extractIpaMetadata(file) {
        const zip = await JSZip.loadAsync(file);

        const plistPath = Object.keys(zip.files).find(name =>
            /^Payload\/[^/]+\.app\/Info\.plist$/.test(name)
        );

        if (!plistPath) throw new Error('Info.plist not found in IPA');

        const rawBytes = await zip.files[plistPath].async('uint8array');
        const magic = String.fromCharCode(...rawBytes.slice(0, 8));

        let getValue;

        if (magic === 'bplist00') {
            const data = this.parseBinaryPlist(rawBytes);
            getValue = (key) => data[key] || null;
        } else {
            const text = new TextDecoder().decode(rawBytes);
            getValue = (key) => {
                const match = text.match(new RegExp(`<key>${key}<\\/key>\\s*<string>([^<]*)<\\/string>`));
                return match ? match[1] : null;
            };
        }

        return {
            bundleId: getValue('CFBundleIdentifier'),
            appName: getValue('CFBundleDisplayName') || getValue('CFBundleName'),
            version: getValue('CFBundleShortVersionString'),
            buildNumber: getValue('CFBundleVersion'),
            minOsVersion: getValue('MinimumOSVersion'),
        };
    }

    parseBinaryPlist(data) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const len = data.length;

        const trailerStart = len - 32;
        const oSize = data[trailerStart + 6];
        const rSize = data[trailerStart + 7];
        const nObj = readUint64(data, trailerStart + 8);
        const root = readUint64(data, trailerStart + 16);
        const offTbl = readUint64(data, trailerStart + 24);

        const offsets = [];
        for (let i = 0; i < nObj; i++) {
            offsets.push(readUintN(data, offTbl + i * oSize, oSize));
        }

        const readObject = (index) => {
            const offset = offsets[index];
            const marker = data[offset];
            const type = (marker & 0xF0) >> 4;
            const info = marker & 0x0F;

            const getLength = (baseOffset) => {
                if (info !== 0xF) return { length: info, skip: 0 };
                const lenMarker = data[baseOffset];
                const lenSize = 1 << (lenMarker & 0x0F);
                const length = readUintN(data, baseOffset + 1, lenSize);
                return { length, skip: 1 + lenSize };
            };

            if (type === 0x5) {
                const { length, skip } = getLength(offset + 1);
                return readAsciiString(data, offset + 1 + skip, length);
            }
            if (type === 0x6) {
                const { length, skip } = getLength(offset + 1);
                return readUnicodeString(data, offset + 1 + skip, length);
            }
            if (type === 0xD) {
                const { length: count, skip } = getLength(offset + 1);
                const extraBytes = skip;
                const keyRefs = [];
                const valRefs = [];
                for (let i = 0; i < count; i++) {
                    keyRefs.push(readUintN(data, offset + 1 + extraBytes + i * rSize, rSize));
                }
                for (let i = 0; i < count; i++) {
                    valRefs.push(readUintN(data, offset + 1 + extraBytes + count * rSize + i * rSize, rSize));
                }
                const dict = {};
                for (let i = 0; i < count; i++) {
                    const k = readObject(keyRefs[i]);
                    const v = readObject(valRefs[i]);
                    dict[k] = v;
                }
                return dict;
            }
            if (type === 0xA) {
                const { length: count, skip } = getLength(offset + 1);
                const arr = [];
                for (let i = 0; i < count; i++) {
                    arr.push(readObject(readUintN(data, offset + 1 + skip + i * rSize, rSize)));
                }
                return arr;
            }
            if (type === 0x1) {
                return readUintN(data, offset + 1, 1 << info);
            }
            if (type === 0x2) {
                if (info === 2) return view.getFloat32(offset + 1);
                if (info === 3) return view.getFloat64(offset + 1);
            }
            if (type === 0x0 && info === 0x8) return false;
            if (type === 0x0 && info === 0x9) return true;
            return null;
        };

        function readAsciiString(data, offset, length) {
            let s = '';
            for (let i = 0; i < length; i++) s += String.fromCharCode(data[offset + i]);
            return s;
        }

        function readUnicodeString(data, offset, length) {
            let s = '';
            for (let i = 0; i < length; i++) {
                s += String.fromCharCode((data[offset + i * 2] << 8) | data[offset + i * 2 + 1]);
            }
            return s;
        }

        function readUintN(data, offset, size) {
            let val = 0;
            for (let i = 0; i < size; i++) val = (val * 256) + data[offset + i];
            return val;
        }

        function readUint64(data, offset) {
            let val = 0;
            for (let i = 4; i < 8; i++) val = (val * 256) + data[offset + i];
            return val;
        }

        function readIntObject(data, offset) {
            const marker = data[offset];
            const size = 1 << (marker & 0x0F);
            return readUintN(data, offset + 1, size);
        }

        return readObject(root);
    }

    setupDragAndDrop(fileDisplay, fileInput) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            fileDisplay.addEventListener(eventName, this.preventDefaults, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            fileDisplay.addEventListener(eventName, () => {
                fileDisplay.classList.add('border-ij-blue', 'bg-ij-blue/5');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            fileDisplay.addEventListener(eventName, () => {
                fileDisplay.classList.remove('border-ij-blue', 'bg-ij-blue/5');
            }, false);
        });

        fileDisplay.addEventListener('drop', (e) => {
            const files = Array.from(e.dataTransfer.files);
            files.forEach(file => this.handleFileAdd(file));
        }, false);
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    async handleFileAdd(file) {
        const validation = this.validateFile(file);
        if (!validation.valid) {
            this.flashDropzone('error');
            return;
        }

        const ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'apk') {
            this.selectedApk = file;
        } else if (ext === 'ipa') {
            this.selectedIpa = file;
            this.ipaMetadata = null;
            this.ipaExtracting = true;
            this.renderFileSlots();

            try {
                this.ipaMetadata = await this.extractIpaMetadata(file);

                const versionField = document.getElementById('version');
                if (versionField && !versionField.value && this.ipaMetadata.version) {
                    versionField.value = this.ipaMetadata.version;
                }
            } catch (err) {
                console.warn('Could not extract IPA metadata:', err);
                this.ipaMetadata = null;
            } finally {
                this.ipaExtracting = false;
                this.renderFileSlots();
            }
            return;
        }

        this.renderFileSlots();
    }

    removeFile(type) {
        if (type === 'apk') this.selectedApk = null;
        if (type === 'ipa') this.selectedIpa = null;
        this.renderFileSlots();
    }

    renderFileSlots() {
        const fileDisplay = document.getElementById('fileInputDisplay');
        if (!fileDisplay) return;

        const hasApk = !!this.selectedApk;
        const hasIpa = !!this.selectedIpa;
        const bothSelected = hasApk && hasIpa;

        fileDisplay.classList.remove('error');

        if (!hasApk && !hasIpa) {
            fileDisplay.innerHTML = `
                <div class="flex flex-col items-center pointer-events-none">
                    <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-ij-blue to-ij-purple flex items-center justify-center mb-3 group-hover:scale-110 transition-transform duration-300">
                        <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                    </div>
                    <div class="text-ij-text mb-2">
                        <span class="text-ij-blue font-medium">Click to browse</span> or drag and drop your APK or IPA files here
                    </div>
                    <div class="text-sm text-ij-text-dim">Maximum file size: 200MB each</div>
                </div>
            `;
            return;
        }

        let slotsHtml = `<div class="w-full space-y-2 px-1" onclick="event.stopPropagation()">`;

        if (hasApk) {
            slotsHtml += this.buildFileChip(this.selectedApk, 'apk', 'from-ij-blue to-ij-purple');
        }

        if (hasIpa) {
            slotsHtml += this.buildFileChip(this.selectedIpa, 'ipa', 'from-ij-purple to-ij-pink');
        }

        slotsHtml += `</div>`;

        if (!bothSelected) {
            const missingType = hasApk ? 'IPA' : 'APK';
            slotsHtml += `
                <div class="mt-3 text-xs text-ij-text-dim pointer-events-none">
                    <span class="text-ij-blue font-medium">+ Add ${missingType}</span> (optional) — click or drop here
                </div>
            `;
        }

        fileDisplay.innerHTML = slotsHtml;

        fileDisplay.querySelectorAll('[data-remove]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.removeFile(btn.dataset.remove);
            });
        });
    }

    buildFileChip(file, type, gradientClasses) {
        const sizeMb = (file.size / 1024 / 1024).toFixed(2);
        const label = type === 'apk' ? 'Android APK' : 'iOS IPA';

        const isExtracting = type === 'ipa' && this.ipaExtracting;
        const bundleInfo = type === 'ipa' && this.ipaMetadata?.bundleId
            ? `<div class="text-xs text-ij-text-dim mt-0.5 font-jetbrains">${this.ipaMetadata.bundleId}</div>`
            : '';

        const statusBadge = isExtracting
            ? `<div class="flex items-center gap-1 text-xs text-ij-text-dim mt-0.5">
               <svg class="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                   <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                   <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
               </svg>
               Reading metadata...
           </div>`
            : bundleInfo;

        const icon = type === 'apk'
            ? `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 0 0-.83.22l-1.88 3.24a11.463 11.463 0 0 0-8.94 0L5.65 5.67a.643.643 0 0 0-.87-.2c-.28.18-.37.54-.22.83L6.4 9.48A10.78 10.78 0 0 0 1 18h22a10.78 10.78 0 0 0-5.4-8.52zM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/></svg>`
            : `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>`;

        return `
        <div class="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br ${gradientClasses} flex items-center justify-center flex-shrink-0 text-white">
                ${icon}
            </div>
            <div class="flex-1 min-w-0 text-left">
                <div class="text-sm font-medium text-ij-text truncate">${file.name}</div>
                <div class="text-xs text-ij-text-dim mt-0.5">${label} · ${sizeMb} MB</div>
                ${statusBadge}
            </div>
            <button data-remove="${type}"
                class="w-7 h-7 flex items-center justify-center rounded-lg text-ij-text-dim hover:text-ij-error hover:bg-ij-error/10 transition-all duration-150 flex-shrink-0"
                title="Remove ${type.toUpperCase()}">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
            </button>
        </div>
    `;
    }

    flashDropzone(type) {
        const fileDisplay = document.getElementById('fileInputDisplay');
        if (!fileDisplay) return;
        if (type === 'error') {
            fileDisplay.classList.add('error');
            setTimeout(() => fileDisplay.classList.remove('error'), 3000);
        }
    }

    validateFile(file) {
        const allowedExtensions = ['.apk', '.ipa'];
        const lowerName = file.name.toLowerCase();
        const isAllowedExtension = allowedExtensions.some((ext) => lowerName.endsWith(ext));

        if (!isAllowedExtension) {
            return { valid: false, error: 'Only .apk or .ipa files are allowed' };
        }

        if (file.size > CONFIG.MAX_FILE_SIZE) {
            return { valid: false, error: 'File size must be less than 100MB' };
        }

        return { valid: true };
    }

    async handleSubmit(e) {
        e.preventDefault();

        const formData = new FormData(e.target);

        if (!this.validateForm(formData)) {
            return;
        }

        if (!this.orgManager.orgId) {
            this.showStatus('Organization ID is required', 'error');
            return;
        }

        // Validate organization ID before upload
        try {
            const isValidOrg = (await this.orgManager.validateOrgIdWithFirebase(this.orgManager.orgId)).exists();
            if (!isValidOrg) {
                this.showStatus('Invalid organization ID. Upload not allowed. Please contact your administrator.', 'error');
                return;
            }
        } catch (error) {
            this.showStatus('Error validating organization. Please try again.', 'error');
            return;
        }

        try {
            let replacePrevious = false;
            let latestBuildKey = null;
            let existingBuild = null;
            let clearType = "both";

            if (document.getElementById("replace_prev_check").checked) {
                latestBuildKey = await this.getLatestBuildKey(
                    formData.get('label')?.trim(),
                    formData.get('version')?.trim()
                );

                replacePrevious = true;

                if (latestBuildKey) {
                    existingBuild = await this.getBuildData(latestBuildKey);

                    const hasNewAndroid = !!this.selectedApk;
                    const hasNewIos = !!this.selectedIpa;

                    if (hasNewAndroid && hasNewIos) {
                        clearType = "both";
                    } else if (hasNewAndroid) {
                        clearType = existingBuild?.apkUrl ? "android" : "none";
                    } else if (hasNewIos) {
                        clearType = existingBuild?.ipaUrl ? "ios" : "none";
                    } else {
                        clearType = "none";
                    }
                }
            }

            this.setUploading(true);
            this.showProgress(true);

            if (!this.selectedApk && !this.selectedIpa) {
                throw new Error('A file is required for upload.');
            }

            this.updateProgress(5, 'Cleaning up previous builds...');

            if (replacePrevious && latestBuildKey && clearType !== "none") {
                let deleted = await this.deleteBuilds(latestBuildKey, clearType);

                if (!deleted) {
                    throw new Error('Failed to delete previous build. Upload aborted.');
                }
            }

            let apkUrl = '';
            let ipaUrl = '';

            if (this.selectedApk) {
                this.updateProgress(10, 'Uploading APK file...');
                apkUrl = await this.uploadToR2(
                    this.selectedApk,
                    formData.get('version')?.trim()
                );
            }

            if (this.selectedIpa) {
                this.updateProgress(15, 'Uploading IPA file...');
                ipaUrl = await this.uploadToR2(
                    this.selectedIpa,
                    formData.get('version')?.trim()
                );
            }

            // Save to Firebase
            this.updateProgress(80, 'Saving metadata...');
            const metadata = this.createMetadata(
                formData,
                apkUrl,
                ipaUrl,
                existingBuild
            );

            let buildId = "";
            if (!replacePrevious || latestBuildKey === null) {
                buildId = await this.saveToFirebase(metadata);
            } else {
                buildId = await this.updateBuildInFirebase(latestBuildKey, metadata);
                buildId = latestBuildKey;
            }

            let tags = [metadata.label, metadata.version];
            await this.addTag(this.orgManager.orgId, tags);

            localStorage.setItem('label', metadata.label);
            localStorage.setItem('user', metadata.user);
            this.updateProgress(100, 'Upload complete!');
            this.showStatus(`Build ${formData.get('version')?.trim()} uploaded successfully!\nBuild ID: ${buildId}`, 'success');
            this.setQRCode('qdrop://build?id=' + buildId);

            // Reset form
            this.resetForm(e.target);

            setTimeout(() => this.showProgress(false), 3000);

        } catch (error) {
            console.error('Upload error:', error);
            this.showStatus(error.message, 'error');
            this.showProgress(false);
        } finally {
            this.setUploading(false);
        }
    }

    createMetadata(formData, apkUrl, ipaUrl = '', existingBuild = null) {
        const hasNewApk = !!this.selectedApk;
        const hasNewIpa = !!this.selectedIpa;

        return {
            ...(existingBuild || {}),

            organizationId: this.orgManager.orgId,

            version: formData.get('version')?.trim(),
            changelog: formData.get('changelog')?.trim(),

            uploadedAt: new Date().toISOString(),

            label: formData.get('label')?.trim(),
            user: formData.get('user')?.trim(),

            category: formData.get('category')?.trim(),

            isUpdate: document.getElementById("replace_prev_check").checked,

            imageUrl:
                this.orgManager.appCategoryEntries[
                formData.get('category')?.trim()
                ] || '',

            apkUrl: hasNewApk
                ? apkUrl
                : (existingBuild?.apkUrl || ''),

            ipaUrl: hasNewIpa
                ? ipaUrl
                : (existingBuild?.ipaUrl || ''),

            fileName: hasNewApk
                ? this.selectedApk?.name || ''
                : (existingBuild?.fileName || ''),

            fileSize: hasNewApk
                ? this.selectedApk?.size || 0
                : (existingBuild?.fileSize || 0),

            ipaFileName: hasNewIpa
                ? this.selectedIpa?.name || ''
                : (existingBuild?.ipaFileName || ''),

            ipaFileSize: hasNewIpa
                ? this.selectedIpa?.size || 0
                : (existingBuild?.ipaFileSize || 0),

            bundleId: hasNewIpa
                ? this.ipaMetadata?.bundleId || ''
                : (existingBuild?.bundleId || ''),

            appName: hasNewIpa
                ? this.ipaMetadata?.appName || ''
                : (existingBuild?.appName || ''),

            minOsVersion: hasNewIpa
                ? this.ipaMetadata?.minOsVersion || ''
                : (existingBuild?.minOsVersion || ''),
        };
    }

    async getBuildData(buildId) {
        try {
            const snapshot = await database
                .ref(`qa_builds/${this.orgManager.orgId}/${buildId}`)
                .once("value");

            return snapshot.exists() ? snapshot.val() : null;
        } catch (err) {
            console.error("Error fetching build data:", err);
            return null;
        }
    }

    async deleteBuilds(buildId, clearType = "both") {
        try {
            const response = await fetch('/api/delete-builds', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    buildIds: [buildId],
                    organizationId: this.orgManager.orgId,
                    update: true,
                    clearType
                })
            });
            return true;
        } catch (error) {
            console.error('Error deleting build:', error);
            return false;
        }
    }

    async addTag(orgId, tags) {
        const tagsRef = database.ref(`organizations/${orgId}/tags`);

        const tagKey1 = tags[0].toLowerCase();
        const tagKey2 = "tttt_" + tags[1].replace(/\./g, '_');

        const newTags = {
            [tagKey1]: tags[0],
            [tagKey2]: tags[1],
        };

        await tagsRef.update(newTags);
    }

    setQRCode(value) {
        const qrContainer = document.getElementById("qrContainer");
        const qrCanvas = document.getElementById("qrCanvas");

        let qr;

        qrContainer.classList.remove("hidden");

        if (!qr) {
            qr = new QRious({
                element: qrCanvas,
                size: 180,
                level: 'M',
                value: value
            });
        } else {
            qr.value = value;
        }

        qrValue.textContent = value;
    }

    async getLatestBuildKey(label, version) {
        try {
            const buildsRef = database.ref(`qa_builds/${this.orgManager.orgId}`);

            const snapshot = await buildsRef
                .orderByChild("label")
                .equalTo(label)
                .once("value");

            if (!snapshot.exists()) return null;

            let latestKey = null;
            let latestTime = 0;

            snapshot.forEach(child => {
                const val = child.val();

                if (val.version === version) {
                    const uploadedAt = new Date(val.uploadedAt).getTime();
                    if (uploadedAt > latestTime) {
                        latestTime = uploadedAt;
                        latestKey = child.key;
                    }
                }
            });

            return latestKey;
        } catch (err) {
            console.error("Error in getLatestBuildKeyByLabelAndVersion:", err);
            return null;
        }
    }

    async uploadToR2(file, version) {
        try {
            const ext = file.name.split('.').pop().toLowerCase();
            const safeExt = ext === 'ipa' ? 'ipa' : 'apk';
            const fileName = `${this.orgManager.orgId}_${version}_${Date.now()}.${safeExt}`;

            this.updateProgress(5, 'Getting upload URL...');

            const response = await fetch('/api/upload-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: fileName,
                    fileType: ext === 'ipa' ? 'application/octet-stream' : file.type
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to get upload URL: ${response.statusText}`);
            }

            const { presignedUrl } = await response.json();

            this.updateProgress(10, 'Starting upload...');

            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("PUT", presignedUrl, true);
                xhr.setRequestHeader("Content-Type", file.type);

                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        const percent = Math.round((event.loaded / event.total) * 70) + 10;
                        this.updateProgress(percent, `Uploading... ${(event.loaded / 1024 / 1024).toFixed(1)}MB / ${(event.total / 1024 / 1024).toFixed(1)}MB`);
                    }
                };

                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        reject(new Error(`Upload failed: ${xhr.statusText}`));
                    }
                };

                xhr.onerror = () => reject(new Error("Upload failed due to network error"));
                xhr.send(file);
            });

            this.updateProgress(80, 'Upload complete, getting public URL...');

            const publicUrl = presignedUrl
                .split('?')[0]
                .replace(
                    'https://qdrop.ca3d30cf900eb4f78198b750bce85367.r2.cloudflarestorage.com',
                    'https://pub-03b74c9b026549ce8ff4ca1720eeb45a.r2.dev'
                );

            this.updateProgress(100, 'File uploaded successfully!');

            return publicUrl;

        } catch (error) {
            console.error('Upload error:', error);
            throw error;
        }
    }

    async saveToFirebase(metadata) {
        const buildsRef = database.ref(`qa_builds/${this.orgManager.orgId}`);
        const newBuildRef = buildsRef.push();

        await newBuildRef.set(metadata);
        return newBuildRef.key;
    }

    async updateBuildInFirebase(key, metadata) {
        try {
            const buildRef = database.ref(`qa_builds/${this.orgManager.orgId}/${key}`);
            await buildRef.update(metadata);
            return true;
        } catch (err) {
            console.error("Error updating build in Firebase:", err);
            return false;
        }
    }

    resetForm(form) {
        form.reset();
        this.selectedApk = null;
        this.selectedIpa = null;
        this.renderFileSlots();
        this.setStoredData();
    }

    setStoredData() {
        const orgSection = document.getElementById('orgSection');
        const uploadSection = document.getElementById('uploadSection');
        const orgField = document.getElementById('orgIdField');
        const label = document.getElementById('labelField');
        const name = document.getElementById('userField');
        const orgName = document.getElementById('orgName');

        if (orgSection) orgSection.classList.remove('hidden');
        if (uploadSection) uploadSection.classList.remove('hidden');
        if (orgField) orgField.value = localStorage.getItem('qdrop_org_id') || '';
        if (label) label.value = localStorage.getItem('label') || '';
        if (orgName) orgName.textContent = localStorage.getItem('org_name') || '';
        if (name) name.value = localStorage.getItem('user') || '';
    }

    setUploading(uploading) {
        const submitBtn = document.getElementById('submitBtn');
        const inputs = document.querySelectorAll('input, textarea, button');

        inputs.forEach(input => input.disabled = uploading);

        if (submitBtn) {
            submitBtn.innerHTML = uploading ? this.getUploadingButtonHTML() : this.getSubmitButtonHTML();
        }
    }

    getUploadingButtonHTML() {
        return `
            <span class="flex items-center justify-center">
                <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Uploading...
            </span>
        `;
    }

    getSubmitButtonHTML() {
        return `
            <span class="flex items-center justify-center">
                <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                </svg>
                Submit Build
            </span>
        `;
    }

    showProgress(show) {
        const container = document.getElementById('progressContainer');
        if (container) {
            if (show) {
                container.classList.remove('hidden');
            } else {
                container.classList.add('hidden');
                const progressBar = document.getElementById('progressBar');
                if (progressBar) progressBar.style.width = '0%';
            }
        }
    }

    updateProgress(percent, text) {
        const progressBar = document.getElementById('progressBar');
        const progressPercent = document.getElementById('progressPercent');
        const progressText = document.getElementById('progressText');

        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${percent}%`;
        if (progressText) progressText.textContent = text;
    }

    showStatus(message, type) {
        const statusAndQr = document.getElementById('statusAndQr');
        const statusMessage = document.getElementById('statusMessage');
        const statusContent = document.getElementById('statusContent');

        if (!statusAndQr || !statusMessage || !statusContent) return;

        statusAndQr.classList.remove('hidden');

        const colors = {
            success: 'bg-ij-success/10 border-ij-success text-ij-success',
            error: 'bg-ij-error/10 border-ij-error text-ij-error',
            warning: 'bg-ij-warning/10 border-ij-warning text-ij-warning',
            info: 'bg-ij-blue/10 border-ij-blue text-ij-blue'
        };

        statusAndQr.className = `mt-6 flex items-start gap-6 p-4 rounded-xl border-l-4 ${colors[type] || colors.info}`;

        statusMessage.className = "flex-1";
        statusContent.className = "font-jetbrains";
        statusContent.textContent = message;
        statusContent.style.whiteSpace = "pre-line";
    }

    validateForm(formData) {
        const errors = [];
        const version = formData.get('version')?.trim();
        const label = formData.get('label')?.trim();
        const name = formData.get('user')?.trim();
        const category = formData.get('category')?.trim();

        document.querySelectorAll('.jb-input').forEach(input => input.classList.remove('error'));
        document.getElementById('dropdownButton').classList.remove('error-dropdown');

        if (!version) {
            this.showFieldError('version');
            errors.push('Version is required');
        }

        if (!label) {
            this.showFieldError('label');
            errors.push('Label is required');
        }

        if (!name) {
            this.showFieldError('userField');
            errors.push('User is required');
        }

        if (!this.selectedApk && !this.selectedIpa) {
            this.flashDropzone('error');
            errors.push('Either an APK or IPA file is required');
        }

        if (!category) {
            this.showDropdownError('dropdownButton');
            errors.push('Application name is required');
        }

        return errors.length === 0;
    }

    showFieldError(fieldId) {
        const field = document.getElementById(fieldId);
        if (!field) return;

        field.classList.add('error');

        setTimeout(() => field.classList.remove('error'), 3000);
    }

    showDropdownError(buttonId) {
        const button = document.getElementById(buttonId);
        if (!button) return;

        const originalRingColor = getComputedStyle(button).getPropertyValue('--tw-ring-color');

        button.style.setProperty('--tw-ring-color', 'rgba(255, 90, 103, 0.5)');
        button.focus({ preventScroll: true });

        button.style.borderColor = 'var(--ij-error)';

        setTimeout(() => {
            button.style.setProperty('--tw-ring-color', originalRingColor);
            button.style.borderColor = '';
            button.blur();
        }, 3000);
    }
}