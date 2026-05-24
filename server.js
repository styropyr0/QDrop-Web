require('dotenv').config(); // Load environment variables
const express = require('express');
const cors = require('cors');
const path = require('path');
const CONFIG = require('./public/js/config');
const admin = require('firebase-admin');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: CONFIG.FIREBASE_CONFIG.databaseURL
});

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const servePublic = process.env.SERVE_PUBLIC_URL === 'true';

function publicAccessGuard(req, res, next) {
    if (!servePublic) {
        return res.status(403).send('Public access is disabled');
    }
    next();
}

if (process.env.FIREBASE_CONFIG) {
    try {
        const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
        admin.initializeApp({
            credential: admin.credential.cert(firebaseConfig),
            databaseURL: process.env.FIREBASE_DATABASE_URL || firebaseConfig.databaseURL
        });
    } catch (error) {
        console.error('Error initializing Firebase:', error);
    }
}

const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

// API for generating presigned upload URL
app.post('/api/upload-url', async (req, res) => {
    try {
        const { fileName, fileType } = req.body;

        if (!fileName || !fileType) {
            return res.status(400).json({ error: 'fileName and fileType are required' });
        }

        const startTime = Date.now();

        const command = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: fileName,
            ContentType: fileType,
        });

        const presignedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 3600, // 1 hour
        });

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        res.json({ presignedUrl, responseTime });
    } catch (error) {
        console.error('Error generating upload URL:', error);
        res.status(500).json({ error: 'Failed to generate upload URL' });
    }
});

// Downloads page
app.get('/downloads', async (req, res) => {
    try {
        const db = admin.database();
        const snapshot = await db.ref('app_update').once('value');
        if (!snapshot.exists()) {
            return res.status(404).send(renderStandalonePage('Downloads - QDrop', 'Downloads', '', `
                <div class="jb-card p-6 text-center">
                    <h2 class="text-2xl font-semibold text-white">No download metadata found</h2>
                    <p class="mt-2 text-ij-text-dim">The download information is not available in Firebase.</p>
                    <a href="/" class="mt-6 inline-flex items-center justify-center px-5 py-3 rounded-xl border border-white/15 text-white text-sm font-semibold hover:bg-white/5 transition">Go Home</a>
                </div>
            `));
        }

        const data = snapshot.val();
        const html = generateDownloadsPageHTML(data);
        res.send(html);
    } catch (error) {
        console.error('Error fetching downloads metadata:', error);
        res.status(500).send('Failed to fetch download metadata');
    }
});

// API for getting storage info
app.get('/api/storage-info', async (req, res) => {
    try {
        const { orgId } = req.query;
        const availableStorageMB = parseInt(process.env.TOTAL_STORAGE_LIMIT_MB) || 10000;

        if (!orgId) {
            return res.status(400).json({ error: 'orgId is required' });
        }

        console.log(`Getting storage info for org: ${orgId}`);

        const listCommand = new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
            Prefix: `${orgId}_`,
        });

        const result = await s3Client.send(listCommand);

        const totalObjects = result.KeyCount || 0;
        let totalSize = 0;

        if (result.Contents) {
            result.Contents.forEach(obj => {
                totalSize += obj.Size || 0;
            });
        }

        console.log(`Storage info: ${totalObjects} objects, ${totalSize} bytes`);

        res.json({
            organizationId: orgId,
            bucketName: process.env.R2_BUCKET_NAME,
            totalObjects,
            totalSize: totalSize / (1024 * 1024),
            availableStorage: availableStorageMB,
        });
    } catch (error) {
        console.error('Error getting storage info:', error);
        res.status(500).json({ error: 'Failed to get storage info' });
    }
});

function escapeXml(value) {
    return value.replace(/[<>&"']/g, char => {
        switch (char) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '"': return '&quot;';
            case "'": return '&apos;';
            default: return char;
        }
    });
}

function createManifestPlist(metadata) {
    const title = metadata.name;
    const bundleId = metadata.bundleId;
    const version = metadata.version;
    const ipaUrl = metadata.ipaUrl;
    const iconUrl = metadata.iconUrl;

    let displayImageXml = '';
    if (iconUrl) {
        displayImageXml = `
                <key>display-image</key>
                <string>${escapeXml(iconUrl)}</string>`;
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>
                <dict>
                    <key>kind</key>
                    <string>software-package</string>
                    <key>url</key>
                    <string>${escapeXml(ipaUrl)}</string>
                </dict>${displayImageXml}
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>${escapeXml(bundleId)}</string>
                <key>bundle-version</key>
                <string>${escapeXml(version)}</string>
                <key>kind</key>
                <string>software</string>
                <key>title</key>
                <string>${escapeXml(title)}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>`;
}

function renderStandalonePage(pageTitle, pageHeading, pageSubheading, pageBodyHtml) {
    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${pageTitle}</title>
                <script src="https://cdn.tailwindcss.com"></script>
                <script>
                    tailwind.config = {
                        theme: {
                            extend: {
                                colors: {
                                    'ij-black': '#000000',
                                    'ij-text': '#ffffff',
                                    'ij-text-dim': '#9ca3af',
                                    'ij-blue': '#087cfa',
                                    'ij-purple': '#b345f1',
                                    'ij-pink': '#ff318c',
                                    'ij-orange': '#ff6b35',
                                    'ij-success': '#00d4aa',
                                    'ij-error': '#ff5a67',
                                    'ij-warning': '#ffb800'
                                },
                                fontFamily: {
                                    'jetbrains': ['JetBrains Mono', 'Monaco', 'Consolas', 'monospace'],
                                    'inter': ['Inter', 'system-ui', 'sans-serif']
                                }
                            }
                        }
                    }
                </script>
                <link rel="preconnect" href="https://fonts.googleapis.com">
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
                <link rel="stylesheet" href="/css/styles.css">
                <script src="https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js"></script>
                <style>
                    .page-shell { min-height: 100vh; }
                    .page-header { max-width: 920px; margin: 0 auto 1.5rem; }
                    .panel-header { border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 1rem; }
                </style>
            </head>
            <body class="ij-gradient-bg text-ij-text font-inter">
                <main class="page-shell flex ${pageHeading || pageSubheading ? 'items-start' : 'items-center'} justify-center px-4 py-8 sm:py-12">
                    <div class="w-full max-w-5xl space-y-4">
                        ${pageHeading || pageSubheading ? `
                        <header class="w-full">
                            <div class="jb-card p-4 border border-white/10">
                                <div class="flex items-start justify-between gap-4">

                                    <div class="min-w-0">
                                        <h1 class="text-lg font-semibold text-white">
                                            ${pageHeading}
                                        </h1>

                                        <p class="mt-1 text-xs text-ij-text-dim">
                                            ${pageSubheading}
                                        </p>
                                    </div>

                                    <div class="flex items-center gap-2 flex-shrink-0">
                                        <div class="w-12 h-12 rounded-[0.9rem] bg-gradient-to-br from-ij-blue via-ij-purple to-ij-pink flex items-center justify-center p-2 shadow-lg shadow-ij-purple/20">
                                            <svg class="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                                            </svg>
                                        </div>
                                    </div>

                                </div>
                            </div>
                        </header>
                        ` : ''}
                        ${pageBodyHtml}
                    </div>
                </main>
            </body>
            </html>`;
}

function generateBuildPageHTML(req, build, orgId, buildId, orgName) {
    const baseUrl = `https://${req.get('host')}`;
    const installUrlIOS = build.ipaUrl ? `itms-services://?action=download-manifest&url=${encodeURIComponent(`${baseUrl}/manifest/${orgId}/${buildId}`)}` : null;
    const installUrlAndroid = build.apkUrl || null;
    const appSchemeUrl = `qdrop://build?id=${buildId}`;
    const uploadedDate = build.uploadedAt ? new Date(build.uploadedAt) : new Date();
    const formatFileSize = (bytes) => {
        if (!bytes) return 'N/A';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    };
    const details = [
        { label: 'Build ID', value: buildId },
        { label: 'Version', value: build.version || 'Unknown' },
        {
            label: 'Uploaded',
            value: uploadedDate.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            })
        },
        { label: 'Uploader', value: build.user || 'Unknown' },
        { label: 'Min iOS', value: build.minOsVersion || 'N/A' },
        ...(build.fileSize ? [{ label: 'Android Size', value: formatFileSize(build.fileSize) }] : []),
        ...(build.ipaFileSize ? [{ label: 'iOS Size', value: formatFileSize(build.ipaFileSize) }] : [])
    ];

    const detailsHtml = details.map(item => `
            <div class="flex items-center justify-between border-b border-white/10 py-2 last:border-b-0">
                <span class="text-xs text-ij-text-dim">${item.label}</span>
                <span class="text-xs font-medium text-white">${item.value}</span>
            </div>
        `).join('');

    const platformActions = [];
    if (installUrlIOS) {
        platformActions.push(`
            <a href="${installUrlIOS}" class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-ij-blue text-white text-sm font-semibold hover:bg-blue-500 transition">Install on iOS</a>
        `);
    }
    if (installUrlAndroid) {
        platformActions.push(`
            <a href="${installUrlAndroid}" class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-ij-purple text-white text-sm font-semibold hover:bg-purple-500 transition">Download APK</a>
        `);
    }

    const downloadLinksHtml = [];
    if (installUrlIOS) {
        downloadLinksHtml.push(`
            <div class="p-3 bg-slate-950/50 rounded-lg border border-white/10">
                <p class="text-xs text-ij-text-dim mb-1">iOS Install URL</p>
                <div class="text-xs text-white break-all font-mono bg-black/30 p-2 rounded">${installUrlIOS}</div>
            </div>
        `);
    }
    if (installUrlAndroid) {
        downloadLinksHtml.push(`
            <div class="p-3 bg-slate-950/50 rounded-lg border border-white/10">
                <p class="text-xs text-ij-text-dim mb-1">APK Download URL</p>
                <div class="text-xs text-white break-all font-mono bg-black/30 p-2 rounded">${installUrlAndroid}</div>
            </div>
        `);
    }

    return renderStandalonePage(
        `${build.category} (${build.version}) - QDrop Build`,
        `${orgName}`,
        `Build Details`,
        `
        <div class="jb-card p-6">
            <div class="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
                <div class="flex-1 min-w-0 space-y-3">
                    <div class="flex items-start gap-4">
                        <div class="w-16 h-16 rounded-xl bg-ij-blue/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                            ${build.imageUrl ? `<img src="${build.imageUrl}" alt="App Icon" class="w-full h-full object-cover rounded-xl">` : '<div class="w-12 h-12 rounded-xl bg-gradient-to-br from-ij-blue to-ij-purple flex items-center justify-center"><svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div>'}
                        </div>
                        <div class="min-w-0">
                            <p class="text-xs uppercase tracking-widest text-ij-blue font-semibold">${build.label}</p>
                            <h2 class="mt-1 text-xl font-semibold text-white truncate">${build.category}</h2>
                            <p class="text-xs text-ij-text-dim">Ready for install or download.</p>
                        </div>
                    </div>

                    <div class="grid gap-3 sm:grid-cols-2">
                        ${platformActions.join('')}
                    </div>

                    ${build.notes ? `
                    <div>
                        <p class="text-xs text-ij-text-dim mb-2">Release Notes</p>
                        <p class="text-xs text-ij-text">${build.notes}</p>
                    </div>` : ''}

                    ${downloadLinksHtml.length > 0 ? `
                    <div class="space-y-2 pt-6">
                        <h3 class="text-sm font-semibold text-white">Download Links</h3>
                        ${downloadLinksHtml.join('')}
                    </div>` : ''}
                </div>

                <div class="w-full lg:w-72 space-y-4">
                    <div class="p-4 bg-slate-950/50 rounded-lg border border-white/10">
                        <h3 class="text-sm font-semibold text-white mb-3">Build Summary</h3>
                        ${detailsHtml}
                    </div>

                    <div class="p-4 bg-slate-950/50 rounded-lg border border-white/10">
                        <div class="flex items-center justify-between gap-3 mb-4">
                            <h3 class="text-sm font-semibold text-white">QR Code</h3>

                            ${installUrlIOS ? `
                            <div class="relative flex w-28 h-7 items-center rounded-full bg-white/5 border border-white/10 p-[2px] flex-shrink-0">
                                <div id="qrToggleIndicator"
                                     class="absolute left-[2px] top-[2px] h-[calc(100%-4px)] w-[calc(50%-2px)] rounded-full bg-ij-blue transition-all duration-300">
                                </div>
                                                        
                                <button id="androidToggle"
                                        class="relative z-10 flex-1 text-[10px] font-medium text-white leading-none">
                                    Android
                                </button>
                                                        
                                <button id="iosToggle"
                                        class="relative z-10 flex-1 text-[10px] font-medium text-white leading-none">
                                    iOS
                                </button>
                            </div>
                            ` : ''}
                        </div>
                            
                        <div class="flex flex-col items-center gap-3">
                            <div class="w-40 h-40 bg-white rounded-lg flex items-center justify-center p-3">
                                <canvas id="qrCanvas" class="w-full h-full"></canvas>
                            </div>
                            
                            <p id="qrDescription"
                               class="text-xs text-ij-text-dim text-center">
                                Scan to download Android build
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <script>
            const androidQrUrl = '${installUrlAndroid || appSchemeUrl}';
            const iosQrUrl = '${installUrlIOS || appSchemeUrl}';
                                    
            const qrCanvas = document.getElementById('qrCanvas');
            const qrDescription = document.getElementById('qrDescription');
                                    
            const qr = new QRious({
                element: qrCanvas,
                value: androidQrUrl,
                size: 280
            });
                                    
            const hasIOS = ${!!installUrlIOS};
                                    
            if (hasIOS) {
                const androidToggle = document.getElementById('androidToggle');
                const iosToggle = document.getElementById('iosToggle');
                const indicator = document.getElementById('qrToggleIndicator');
                                    
                function updateQR(platform) {
                    if (platform === 'android') {
                        qr.value = androidQrUrl;
                        qrDescription.textContent = 'Scan to download Android build';
                                    
                        indicator.style.transform = 'translateX(0)';
                    } else {
                        qr.value = iosQrUrl;
                        qrDescription.textContent = 'Scan to install iOS build';
        
                        indicator.style.transform = 'translateX(100%)';
                    }
                }
        
                androidToggle.addEventListener('click', () => {
                    updateQR('android');
                });
        
                iosToggle.addEventListener('click', () => {
                    updateQR('ios');
                });
            }
        </script>
    `
    );
}


function generateBuildNotFoundHTML(orgId, buildId, orgName) {
    return renderStandalonePage(
        'Build Not Found - QDrop',
        '',
        '',
        `
        <div class="jb-card p-6">
            <div class="flex flex-col items-center justify-center py-12 text-center space-y-6">
                <div class="w-20 h-20 rounded-full bg-ij-error/10 flex items-center justify-center">
                    <svg class="w-10 h-10 text-ij-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                </div>

                <div class="space-y-2">
                    <h2 class="text-2xl font-semibold text-white">Build Not Found</h2>
                    <p class="text-ij-text-dim">The build you're looking for doesn't exist or has been removed.</p>
                </div>

                <div class="bg-slate-950/50 rounded-lg border border-white/10 p-4 w-full max-w-md">
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-ij-text-dim">Organization:</span>
                            <span class="text-white font-medium">${orgName}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-ij-text-dim">Build ID:</span>
                            <span class="text-white font-medium">${buildId}</span>
                        </div>
                    </div>
                </div>

                <div class="flex flex-col sm:flex-row gap-3">
                    <a href="/${orgId}" class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-ij-blue text-white text-sm font-semibold hover:bg-blue-500 transition">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                        View All Builds
                    </a>
                    <a href="/" class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-white/15 text-white text-sm font-semibold hover:bg-white/5 transition">
                        Go Home
                    </a>
                </div>
            </div>
        </div>
        `
    );
}

function generateNoBuildsFoundHTML(orgId, orgName) {
    return renderStandalonePage(
        'No Builds Found - QDrop',
        '',
        '',
        `
        <div class="jb-card p-6">
            <div class="flex flex-col items-center justify-center py-12 text-center space-y-6">
                <div class="w-20 h-20 rounded-full bg-ij-warning/10 flex items-center justify-center">
                    <svg class="w-10 h-10 text-ij-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                </div>

                <div class="space-y-2">
                    <h2 class="text-2xl font-semibold text-white">No Builds Found</h2>
                    <p class="text-ij-text-dim">This organization doesn't have any builds yet.</p>
                </div>

                <div class="bg-slate-950/50 rounded-lg border border-white/10 p-4 w-full max-w-md">
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-ij-text-dim">Organization:</span>
                            <span class="text-white font-medium">${orgName}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-ij-text-dim">Organization ID:</span>
                            <span class="text-white font-medium">${orgId}</span>
                        </div>
                    </div>
                </div>

                <div class="flex flex-col sm:flex-row gap-3">
                    <a href="/" class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-ij-blue text-white text-sm font-semibold hover:bg-blue-500 transition">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                        </svg>
                        Go Home
                    </a>
                    <a href="/${orgId}/upload" class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-white/15 text-white text-sm font-semibold hover:bg-white/5 transition">
                        Upload Build
                    </a>
                </div>
            </div>
        </div>
        `
    );
}

function generateDownloadsPageHTML(data) {
    const downloadUrl = data.downloadUrl || data.downloadURL || '';
    const versionName = data.versionName || data.version_name || 'Unknown';
    var updateMessage = data.updateMessage || data.update_message || '';
    updateMessage = updateMessage ? updateMessage.replace(/\\n/g, '<br>') : '';

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>QDrop Downloads</title>

                <script src="https://cdn.tailwindcss.com"></script>

                <script>
                    tailwind.config = {
                        theme: {
                            extend: {
                                colors: {
                                    'ij-black': '#000000',
                                    'ij-text': '#ffffff',
                                    'ij-text-dim': '#9ca3af',
                                    'ij-blue': '#087cfa',
                                    'ij-purple': '#b345f1',
                                    'ij-pink': '#ff318c',
                                    'ij-success': '#00d4aa'
                                }
                            }
                        }
                    }
                </script>

                <link rel="stylesheet" href="/css/styles.css">
            </head>

            <body class="ij-gradient-bg text-ij-text min-h-screen flex flex-col items-center justify-center px-4">

                <div class="flex flex-col items-center text-center mb-10">
                    <div class="w-16 h-16 rounded-[25px] bg-gradient-to-br from-ij-blue via-ij-purple to-ij-pink flex items-center justify-center mb-4">
                        <svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                        </svg>
                    </div>

                    <h1 class="text-3xl sm:text-4xl font-bold">
                        <span class="bg-gradient-to-r from-ij-blue via-ij-purple to-ij-pink bg-clip-text text-transparent">QDrop</span>
                        <span class="text-white">
                            Downloads
                        </span>
                    </h1>

                    <p class="text-sm text-ij-text-dim mt-2">
                        Get the latest build instantly
                    </p>
                </div>

                <div class="w-full max-w-xl space-y-6">

                    <div class="bg-white/5 border border-white/10 rounded-xl p-5">
                        <div class="flex justify-between items-center">
                            <div>
                                <p class="text-xs uppercase tracking-widest text-ij-blue font-semibold">
                                    Latest Release
                                </p>
                                <h2 class="text-xl font-semibold mt-1">${versionName}</h2>
                            </div>
                            <div class="text-xs bg-ij-blue/10 text-ij-blue px-3 py-1 rounded-full">
                                APK
                            </div>
                        </div>
                    </div>

                    <div class="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
                        <div>
                            <p class="text-xs text-ij-text-dim">Download URL</p>
                            <a href="${downloadUrl}" target="_blank"
                               class="block mt-1 text-sm break-all font-mono bg-black/30 p-3 rounded-lg">
                               ${downloadUrl || 'Unavailable'}
                            </a>
                        </div>

                        ${updateMessage ? `
                        <div class="text-center">
                            <p class="text-lg font-semibold text-white mb-2">What's New</p>
                            <p class="text-sm text-ij-text-dim leading-relaxed">
                                ${updateMessage}
                            </p>
                        </div>
                        ` : ''}
                    </div>
                        
                    <a href="${downloadUrl}" 
                       class="w-full block text-center py-3 rounded-xl bg-ij-purple font-semibold hover:bg-purple-600 transition
                       ${downloadUrl ? '' : 'opacity-50 pointer-events-none'}">
                       Download APK
                    </a>
                        
                </div>
                        
            </body>
            </html>`;
}

function generateBuildsListHTML(req, builds, orgId, orgName) {
    const buildsArray = Object.keys(builds).map(id => ({ id, ...builds[id] })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const buildCount = buildsArray.length;
    const baseUrl = `https://${req.get('host')}`;
    const pageTitle = `Available Builds`;

    const buildCards = buildsArray.reverse().map(build => {
        const buildTimestamp = build.timestamp ? new Date(build.timestamp) : new Date();
        const uploadTime = build.uploadedAt
            ? new Date(build.uploadedAt).toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
            }).replace(',', ' at')
            : build.timestamp ? buildTimestamp.toLocaleString('en-IN', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
            }).replace(',', ' at') : 'Unknown';
        const uploadedBy = build.user || build.uploadedBy || build.uploader || 'Unknown';
        const ipaFileSize = build.ipaFileSize || build.size || build.fileSize || 0;
        const minOsVersion = build.minOsVersion || build.minIosVersion || build.minIos || 'N/A';
        const labelText = build.label || 'Development';
        const displayName = build.appName || build.category || 'Unknown App';
        const buildUrl = `/${orgId}/${build.id}`;
        const installUrl = build.ipaUrl ? `itms-services://?action=download-manifest&url=${encodeURIComponent(`${baseUrl}/manifest/${orgId}/${build.id}`)}` : '';
        const apkUrl = build.apkUrl || '';
        const copyUrl = installUrl || apkUrl || buildUrl;

        return `
            <div class="border border-white/10 rounded-xl p-4 bg-[rgba(15,20,35,0.5)]">
                <div onclick="location.href='/${orgId}/${build.id}'" class="cursor-pointer flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div class="flex gap-3 flex-1 min-w-0">
                        <div class="w-12 h-12 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                            ${build.imageUrl ? `<img src="${build.imageUrl}" alt="app icon" class="w-full h-full object-cover rounded-lg"/>` : '<div class="w-10 h-10 rounded-lg bg-ij-blue flex items-center justify-center"><svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div>'}
                        </div>
                        <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                                <h3 class="text-sm font-semibold text-white truncate">${displayName}</h3>
                                <span class="text-xs font-semibold uppercase tracking-widest bg-white/10 text-ij-text-dim px-2 py-0.5 rounded-full">${labelText}</span>
                            </div>
                            <p class="text-xs text-ij-text-dim mt-1">Version: ${build.version || '0.0.0'}</p>
                            <div class="mt-2 text-xs text-ij-text-dim space-y-0.5">
                                <div>Build ID: ${build.id}</div>
                                <div>Uploaded by: ${uploadedBy}</div>
                                <div>Uploaded: ${uploadTime}</div>
                                <div>Min iOS: ${minOsVersion}</div>
                                <div>Size: ${ipaFileSize ? `${(ipaFileSize / (1024 * 1024)).toFixed(1)} MB` : 'N/A'}</div>
                            </div>
                        </div>
                    </div>
                    <div onclick="event.stopPropagation()" class="flex flex-col items-start gap-2 sm:items-end">
                        <div class="flex flex-wrap gap-2">
                            ${installUrl ? `<a href="${installUrl}" class="text-xs font-semibold text-white bg-ij-blue px-3 py-1.5 rounded-lg hover:bg-blue-600 transition">Install</a>` : ''}
                            ${apkUrl ? `<a href="${apkUrl}" class="text-xs font-semibold text-white bg-ij-purple px-3 py-1.5 rounded-lg hover:bg-purple-600 transition">Download APK</a>` : ''}
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button onclick="copyDirectUrl('${copyUrl}')" class="text-xs font-semibold text-ij-text-dim bg-white/10 px-3 py-1.5 rounded-lg hover:bg-white/20 transition">Copy Direct URL</button>
                            <button onclick="openQr('${copyUrl}')" class="text-xs font-semibold text-ij-text-dim bg-white/10 px-3 py-1.5 rounded-lg hover:bg-white/20 transition">QR</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    const bodyHtml = `
        <div class="jb-card p-6 space-y-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between panel-header">
                <div>
                    <p class="text-xs uppercase tracking-widest text-ij-blue font-semibold">Available iOS Builds</p>
                    <h2 class="mt-2 text-xl font-semibold text-white">${buildCount} build${buildCount === 1 ? '' : 's'}</h2>
                </div>
                <div class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white">${buildCount} build${buildCount === 1 ? '' : 's'}</div>
            </div>
            <div class="space-y-3">
                ${buildCards || '<p class="text-ij-text-dim text-sm">No builds found for this organization.</p>'}
            </div>
        </div>
        <div id="qrModal" class="fixed inset-0 z-50 hidden bg-black/50 backdrop-blur-sm flex items-center justify-center px-4 py-8">
            <div class="max-w-sm w-full rounded-xl bg-[#020617] border border-white/10 p-5">
                <div class="flex items-center justify-between gap-3 mb-4">
                    <div>
                        <h3 class="text-sm font-semibold text-white">QR Code</h3>
                        <p class="text-xs text-ij-text-dim">Scan to open the build link.</p>
                    </div>
                    <button onclick="closeQr()" class="text-xs font-semibold text-white/80 hover:text-white">Close</button>
                </div>
                <div class="flex flex-col items-center gap-3">
                    <canvas id="qrCanvas" class="w-48 h-48 rounded-lg bg-white p-3"></canvas>
                    <div id="qrLink" class="text-xs text-ij-text-dim break-all text-center"></div>
                </div>
            </div>
        </div>
        <script>
            function copyDirectUrl(url) {
                navigator.clipboard.writeText(url).then(() => {
                    alert('Copied');
                }).catch(() => {
                    alert('Copy failed');
                });
            }
            function openQr(url) {
                document.getElementById('qrModal').classList.remove('hidden');
                document.getElementById('qrLink').textContent = url;
                new QRious({ element: document.getElementById('qrCanvas'), value: url, size: 280 });
            }
            function closeQr() {
                document.getElementById('qrModal').classList.add('hidden');
            }
        </script>
    `;

    return renderStandalonePage(
        pageTitle,
        `${orgName}`,
        `List of app builds ready for iOS and Android distribution.`,
        bodyHtml
    );
}

// API for serving manifest.plist for iOS OTA installation
app.use(express.static('public'));
app.get('/manifest/:orgId/:buildId', async (req, res) => {
    const { orgId, buildId } = req.params;

    const db = admin.database();

    if (!orgId || !buildId) {
        return res.status(400).send('Missing orgId or buildId parameter');
    }

    try {
        const snapshot = await db.ref(`qa_builds/${orgId}/${buildId}`).once('value');

        if (!snapshot.exists()) {
            return res.status(404).send('Build not found');
        }

        const build = snapshot.val();

        if (!build.ipaUrl) {
            return res.status(400).send('This build has no IPA file');
        }

        if (!build.bundleId) {
            return res.status(400).send('Bundle ID not found. Re-upload the IPA to extract metadata.');
        }

        const metadata = {
            name: build.appName || build.label,
            bundleId: build.bundleId,
            version: build.version,
            ipaUrl: build.ipaUrl,
            iconUrl: build.imageUrl || null
        };

        const plistXml = createManifestPlist(metadata);
        const manifestUrl = `${req.protocol}://${req.get('host')}/manifest/${orgId}/${buildId}`;
        const installUrl = `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestUrl)}`;
        console.log('iOS OTA install URL:', installUrl);

        res.set('Content-Type', 'application/xml');
        res.send(plistXml);

    } catch (error) {
        console.error('Error generating manifest:', error);
        return res.status(500).send('Failed to generate manifest');
    }
});

function getTagKeysForBuild(buildData) {
    const tagKeys = new Set();

    if (buildData?.label) {
        tagKeys.add(String(buildData.label).toLowerCase());
    }

    if (buildData?.version) {
        const normalizedVersion = String(buildData.version).replace(/\./g, '_');
        tagKeys.add(`tttt_${normalizedVersion}`);
    }

    return tagKeys;
}

async function cleanupOrphanedTags(db, organizationId) {
    const buildsSnapshot = await db.ref(`qa_builds/${organizationId}`).once('value');
    const tagsSnapshot = await db.ref(`organizations/${organizationId}/tags`).once('value');

    const activeTagKeys = new Set();

    buildsSnapshot.forEach(buildSnapshot => {
        const buildData = buildSnapshot.val() || {};
        const tagKeys = getTagKeysForBuild(buildData);

        tagKeys.forEach(tagKey => activeTagKeys.add(tagKey));
    });

    const existingTags = tagsSnapshot.val() || {};
    const removals = {};

    Object.keys(existingTags).forEach(tagKey => {
        if (!activeTagKeys.has(tagKey)) {
            removals[tagKey] = null;
        }
    });

    if (Object.keys(removals).length > 0) {
        await db.ref(`organizations/${organizationId}/tags`).update(removals);
    }

    return Object.keys(removals);
}

// API for deleting builds
app.post('/api/delete-builds', async (req, res) => {
    try {
        const { buildIds, organizationId, update, clearType } = req.body;

        if (!buildIds || !Array.isArray(buildIds) || !organizationId) {
            return res.status(400).json({
                error: 'buildIds array and organizationId are required'
            });
        }

        const normalizedClearType = (clearType || 'both').toLowerCase();

        if (!['android', 'ios', 'both'].includes(normalizedClearType)) {
            return res.status(400).json({
                error: 'clearType must be android, ios, or both'
            });
        }

        console.log(
            `Deleting ${buildIds.length} builds for org: ${organizationId} | clearType=${normalizedClearType}`
        );

        const db = admin.database();
        const results = [];
        let deletedCount = 0;
        let failedCount = 0;

        const buildsRef = db.ref(`qa_builds/${organizationId}`);

        for (const buildId of buildIds) {
            try {
                const buildSnapshot = await buildsRef.child(buildId).once('value');
                const buildData = buildSnapshot.val();

                if (!buildData) {
                    console.warn(`Build ${buildId} not found in Firebase`);
                    results.push({ buildId, status: 'not_found' });
                    failedCount++;
                    continue;
                }

                const apkUrl = buildData.apkUrl || '';
                const ipaUrl = buildData.ipaUrl || '';

                let fileNameAndroid = null;
                let fileNameiOS = null;

                try {
                    if (apkUrl) {
                        fileNameAndroid = new URL(apkUrl)
                            .pathname
                            .replace(/^\/+/, '');
                    }
                } catch (err) {
                    console.warn(`Invalid apkUrl for build ${buildId}`);
                }

                try {
                    if (ipaUrl) {
                        fileNameiOS = new URL(ipaUrl)
                            .pathname
                            .replace(/^\/+/, '');
                    }
                } catch (err) {
                    console.warn(`Invalid ipaUrl for build ${buildId}`);
                }

                console.log(
                    `Deleting build ${buildId} | android=${!!fileNameAndroid} | ios=${!!fileNameiOS}`
                );

                if ((normalizedClearType === 'android' || normalizedClearType === 'both') && fileNameAndroid) {
                    const deleteCommandAndroid = new DeleteObjectCommand({
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: fileNameAndroid,
                    });

                    await s3Client.send(deleteCommandAndroid);

                    console.log(`Deleted Android file from R2: ${fileNameAndroid}`);
                }

                if ((normalizedClearType === 'ios' || normalizedClearType === 'both') && fileNameiOS) {
                    const deleteCommandiOS = new DeleteObjectCommand({
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: fileNameiOS,
                    });

                    await s3Client.send(deleteCommandiOS);

                    console.log(`Deleted iOS file from R2: ${fileNameiOS}`);
                }

                if (!update) {
                    await buildsRef.child(buildId).remove();

                    console.log(`Deleted build from Firebase: ${buildId}`);
                } else {
                    const updatePayload = {};

                    if (
                        normalizedClearType === 'android' ||
                        normalizedClearType === 'both'
                    ) {
                        updatePayload.apkUrl = '';
                        updatePayload.fileName = '';
                        updatePayload.fileSize = 0;
                    }

                    if (
                        normalizedClearType === 'ios' ||
                        normalizedClearType === 'both'
                    ) {
                        updatePayload.ipaUrl = '';
                        updatePayload.ipaFileName = '';
                        updatePayload.ipaFileSize = 0;
                        updatePayload.bundleId = '';
                        updatePayload.appName = '';
                        updatePayload.minOsVersion = '';
                    }

                    if (Object.keys(updatePayload).length > 0) {
                        await buildsRef.child(buildId).update(updatePayload);

                        console.log(
                            `Cleared Firebase fields for build ${buildId}:`,
                            updatePayload
                        );
                    }
                }

                results.push({
                    buildId,
                    status: 'deleted',
                    clearType: normalizedClearType
                });

                deletedCount++;
            } catch (error) {
                console.error(`Error deleting build ${buildId}:`, error);

                results.push({
                    buildId,
                    status: 'error',
                    error: error.message
                });

                failedCount++;
            }
        }

        console.log(
            `Deletion complete: ${deletedCount} deleted, ${failedCount} failed`
        );

        if (!update) {
            const removedTagKeys = await cleanupOrphanedTags(db, organizationId);

            console.log(
                `Removed ${removedTagKeys.length} orphaned tags for org: ${organizationId}`
            );
        }

        res.json({
            success: true,
            deletedCount,
            failedCount,
            details: results,
        });

    } catch (error) {
        console.error('Error deleting builds:', error);

        res.status(500).json({
            error: 'Failed to delete builds',
            details: error.message
        });
    }
});

// Routes for build pages
app.get('/:orgId/:buildId', publicAccessGuard, async (req, res) => {
    const { orgId, buildId } = req.params;

    if (!orgId || !buildId || orgId.includes('.') || buildId.includes('.')) {
        return res.status(400).send('Invalid request');
    }

    const db = admin.database();

    if (!orgId || !buildId) {
        return res.status(400).send('Missing orgId or buildId parameter');
    }

    try {
        // Fetch organization name
        const orgSnapshot = await db.ref(`organizations/${orgId}/name`).once('value');
        const orgName = orgSnapshot.exists() ? orgSnapshot.val() : orgId;

        const snapshot = await db.ref(`qa_builds/${orgId}/${buildId}`).once('value');

        if (!snapshot.exists()) {
            const html = generateBuildNotFoundHTML(orgId, buildId, orgName);
            return res.status(404).send(html);
        }

        const build = snapshot.val();
        const html = generateBuildPageHTML(req, build, orgId, buildId, orgName);
        res.send(html);
    } catch (error) {
        console.error('Error fetching build:', error);
        res.status(500).send('Failed to fetch build');
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
