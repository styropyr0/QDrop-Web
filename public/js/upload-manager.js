// Upload Management Class
class UploadManager {
    constructor(orgManager) {
        this.orgManager = orgManager;
        this.setupForm();
        this.setupFileInput();
    }

    setupForm() {
        const form = document.getElementById('uploadForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }
    }

    setupFileInput() {
        const fileInput = document.getElementById('apkFile');
        const fileDisplay = document.getElementById('fileInputDisplay');

        if (!fileInput || !fileDisplay) return;

        fileDisplay.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleFileSelect(file);
            }
        });

        // Drag and drop functionality
        this.setupDragAndDrop(fileDisplay, fileInput);
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
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                fileInput.files = files;
                this.handleFileSelect(files[0]);
            }
        }, false);
    }

    preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    handleFileSelect(file) {
        const fileText = document.getElementById('fileInputText');
        const fileDisplay = document.getElementById('fileInputDisplay');
        if (!fileText || !fileDisplay) return;

        // Clear error state
        fileDisplay.classList.remove('error');

        // Validate file
        const validation = this.validateFile(file);
        if (!validation.valid) {
            this.showFieldError('fileInputDisplay', validation.error);
            return;
        }

        // Show selected file
        fileText.innerHTML = `
            <div class="flex items-center justify-center text-ij-success">
                <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                <span class="font-medium">${file.name}</span>
                <span class="text-ij-text-dim ml-2">(${(file.size / 1024 / 1024).toFixed(2)} MB)</span>
            </div>
        `;
    }

    validateFile(file) {
        if (!file.name.toLowerCase().endsWith('.apk')) {
            return { valid: false, error: 'Only .apk files are allowed' };
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
            if (document.getElementById("replace_prev_check").checked) {
                latestBuildKey = await this.getLatestBuildKey(formData.get('label')?.trim());
                replacePrevious = true;
            }

            this.setUploading(true);
            this.showProgress(true);

            // Upload to Supabase
            this.updateProgress(10, 'Uploading APK file...');
            const apkUrl = await this.uploadToR2(formData.get('apkFile'), formData.get('version')?.trim());

            // Save to Firebase
            this.updateProgress(80, 'Saving metadata...');
            const metadata = this.createMetadata(formData, apkUrl);

            let buildId = "";
            if (!replacePrevious) {
                buildId = await this.saveToFirebase(metadata);
            } else {
                buildId = await this.updateBuildInFirebase(latestBuildKey, metadata);
                buildId = latestBuildKey;
            }

            localStorage.setItem('label', metadata.label);
            localStorage.setItem('user', metadata.user);
            this.updateProgress(100, 'Upload complete!');
            this.showStatus(`Build ${formData.get('version')?.trim()} uploaded successfully! Build ID: ${buildId}`, 'success');

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

    createMetadata(formData, apkUrl) {
        return {
            organizationId: this.orgManager.orgId,
            version: formData.get('version')?.trim(),
            changelog: formData.get('changelog')?.trim(),
            apkUrl,
            uploadedAt: new Date().toISOString(),
            label: formData.get('label')?.trim(),
            user: formData.get('user')?.trim(),
            fileName: formData.get('apkFile').name,
            fileSize: formData.get('apkFile').size,
            isUpdate: document.getElementById("replace_prev_check").checked
        };
    }

    async getLatestBuildKey(label) {
        try {
            // reference to this org’s builds
            const buildsRef = database.ref(`qa_builds/${this.orgManager.orgId}`);

            // query builds with the given label
            const snapshot = await buildsRef
                .orderByChild("label")
                .equalTo(label)
                .once("value");

            if (!snapshot.exists()) return null;

            let latestKey = null;
            let latestTime = 0;

            snapshot.forEach(child => {
                const val = child.val();
                const uploadedAt = new Date(val.uploadedAt).getTime();
                if (uploadedAt > latestTime) {
                    latestTime = uploadedAt;
                    latestKey = child.key;
                }
            });

            return latestKey;
        } catch (err) {
            console.error("Error in getLatestBuildKey:", err);
            return null;
        }
    }

    async uploadToR2(file, version) {
        try {
            const fileName = `${this.orgManager.orgId}_${version}_${Date.now()}.apk`;

            this.updateProgress(5, 'Getting upload URL...');

            // Call your server's API to get presigned URL
            const response = await fetch('/api/upload-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: fileName,
                    fileType: file.type
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to get upload URL: ${response.statusText}`);
            }

            const { presignedUrl } = await response.json();

            this.updateProgress(10, 'Starting upload...');

            // Upload file using the presigned URL
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

            // Return public URL (remove query parameters from presigned URL)
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
        this.setStoredData();
        const fileText = document.getElementById('fileInputText');
        if (fileText) {
            fileText.innerHTML = '<span class="text-ij-blue font-medium">Click to browse</span> or drag and drop your APK file here';
        }
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
        if (orgField) orgField.value = this.orgId;
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
        const statusMessage = document.getElementById('statusMessage');
        const statusContent = document.getElementById('statusContent');

        if (!statusMessage || !statusContent) return;

        statusMessage.classList.remove('hidden');

        const colors = {
            success: 'bg-ij-success/10 border-ij-success text-ij-success',
            error: 'bg-ij-error/10 border-ij-error text-ij-error',
            warning: 'bg-ij-warning/10 border-ij-warning text-ij-warning',
            info: 'bg-ij-blue/10 border-ij-blue text-ij-blue'
        };

        statusContent.className = `p-4 rounded-xl border-l-4 ${colors[type] || colors.info}`;
        statusContent.textContent = message;
    }

    validateForm(formData) {
        const errors = [];
        const version = formData.get('version')?.trim();
        const label = formData.get('label')?.trim();
        const name = formData.get('user')?.trim();
        const changelog = formData.get('changelog')?.trim();
        const file = formData.get('apkFile');

        // Clear previous error states
        document.querySelectorAll('.jb-input').forEach(input => {
            input.classList.remove('error');
        });

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

        if (!file || file.size === 0) {
            this.showFieldError('fileInputDisplay');
            errors.push('APK file is required');
        }

        return errors.length === 0;
    }

    showFieldError(fieldId) {
        const field = document.getElementById(fieldId);
        if (!field) return;

        field.classList.add('error');

        // Auto-remove error state after 3 seconds
        setTimeout(() => {
            field.classList.remove('error');
        }, 3000);
    }
}
