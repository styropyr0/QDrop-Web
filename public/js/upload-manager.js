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
            const isValidOrg = await this.orgManager.validateOrgIdWithFirebase(this.orgManager.orgId);
            if (!isValidOrg) {
                this.showStatus('Invalid organization ID. Upload not allowed. Please contact your administrator.', 'error');
                return;
            }
        } catch (error) {
            this.showStatus('Error validating organization. Please try again.', 'error');
            return;
        }

        try {
            this.setUploading(true);
            this.showProgress(true);

            // Upload to Supabase
            this.updateProgress(10, 'Uploading APK file...');
            const apkUrl = await this.uploadToSupabase(formData.get('apkFile'), formData.get('version')?.trim());

            // Save to Firebase
            this.updateProgress(80, 'Saving metadata...');
            const metadata = this.createMetadata(formData, apkUrl);
            const buildId = await this.saveToFirebase(metadata);

            localStorage.setItem('label', metadata.label);
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
            fileName: formData.get('apkFile').name,
            fileSize: formData.get('apkFile').size
        };
    }

    async uploadToSupabase(file, version) {
        const fileName = `${this.orgManager.orgId}_${version}_${Date.now()}.apk`;
        const filePath = `builds/${this.orgManager.orgId}/${fileName}`;

        const { data, error } = await supabase.storage
            .from(CONFIG.STORAGE_BUCKET)
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: false,
                onUploadProgress: (progress) => {
                    const percent = Math.round((progress.loaded / progress.total) * 70) + 10;
                    this.updateProgress(percent, `Uploading... ${(progress.loaded / 1024 / 1024).toFixed(1)}MB / ${(progress.total / 1024 / 1024).toFixed(1)}MB`);
                }
            });

        if (error) {
            throw new Error(`Upload failed: ${error.message}`);
        }

        this.updateProgress(75, 'Getting public URL...');

        const { data: urlData } = supabase.storage
            .from(CONFIG.STORAGE_BUCKET)
            .getPublicUrl(filePath);

        if (!urlData?.publicUrl) {
            throw new Error('Failed to get public URL');
        }

        return urlData.publicUrl;
    }

    async saveToFirebase(metadata) {
        const buildsRef = database.ref(`qa_builds/${this.orgManager.orgId}`);
        const newBuildRef = buildsRef.push();
        
        await newBuildRef.set(metadata);
        return newBuildRef.key;
    }

    resetForm(form) {
        form.reset();
        const fileText = document.getElementById('fileInputText');
        if (fileText) {
            fileText.innerHTML = '<span class="text-ij-blue font-medium">Click to browse</span> or drag and drop your APK file here';
        }
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

        if (!changelog) {
            this.showFieldError('changelog');
            errors.push('Changelog is required');
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
