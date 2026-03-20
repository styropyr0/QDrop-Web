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

// Middleware
app.use(cors());
app.use(express.json());

// Serve your existing frontend static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Firebase Admin initialization
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

// S3 Client configuration for Cloudflare R2
const s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

// API endpoint for generating presigned upload URLs
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

// API endpoint for getting storage information
app.get('/api/storage-info', async (req, res) => {
    try {
        const { orgId } = req.query;
        const availableStorageMB = parseInt(process.env.TOTAL_STORAGE_LIMIT_MB) || 10000; 

        if (!orgId) {
            return res.status(400).json({ error: 'orgId is required' });
        }

        console.log(`Getting storage info for org: ${orgId}`);

        // List objects with org prefix
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

// API endpoint for deleting builds
app.post('/api/delete-builds', async (req, res) => {
    try {
        const { buildIds, organizationId, update } = req.body;

        if (!buildIds || !Array.isArray(buildIds) || !organizationId) {
            return res.status(400).json({ error: 'buildIds array and organizationId are required' });
        }

        console.log(`Deleting ${buildIds.length} builds for org: ${organizationId}`);

        const db = admin.database();
        const results = [];
        let deletedCount = 0;
        let failedCount = 0;

        // Get Firebase reference for builds
        const buildsRef = db.ref(`qa_builds/${organizationId}`);

        for (const buildId of buildIds) {
            try {
                // Get build metadata from Firebase
                const buildSnapshot = await buildsRef.child(buildId).once('value');
                const buildData = buildSnapshot.val();

                if (!buildData) {
                    console.warn(`Build ${buildId} not found in Firebase`);
                    results.push({ buildId, status: 'not_found' });
                    failedCount++;
                    continue;
                }

                const apkUrl = buildData.apkUrl;

                if (!apkUrl) {
                    console.warn(`No apkUrl for build ${buildId}`);
                    results.push({ buildId, status: 'no_apk_url' });
                    failedCount++;
                    continue;
                }

                const url = new URL(apkUrl);
                const fileName = url.pathname.replace(/^\/+/, '');

                if (!fileName) {
                    console.warn(`No fileName for build ${buildId}`);
                    results.push({ buildId, status: 'no_filename' });
                    failedCount++;
                    continue;
                }

                console.log(`Deleting build ${buildId} with file ${fileName}`);

                // Delete from R2
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: fileName,
                });

                await s3Client.send(deleteCommand);
                console.log(`Deleted file from R2: ${fileName}`);

                // Delete from Firebase
                if (!update) {
                    await buildsRef.child(buildId).remove();
                    console.log(`Deleted build from Firebase: ${buildId}`);
                }

                results.push({ buildId, status: 'deleted' });
                deletedCount++;
            } catch (error) {
                console.error(`Error deleting build ${buildId}:`, error);
                results.push({ buildId, status: 'error', error: error.message });
                failedCount++;
            }
        }

        console.log(`Deletion complete: ${deletedCount} deleted, ${failedCount} failed`);

        res.json({
            success: true,
            deletedCount,
            failedCount,
            details: results,
        });
    } catch (error) {
        console.error('Error deleting builds:', error);
        res.status(500).json({ error: 'Failed to delete builds', details: error.message });
    }
});

// Your existing catch-all route for SPA support
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
