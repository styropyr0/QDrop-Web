const { S3Client } = require('@aws-sdk/client-s3');

function requireEnv(name, fallbacks = []) {
    const names = [name, ...fallbacks];
    for (const key of names) {
        const value = process.env[key];
        if (value) return value;
    }
    const hint = fallbacks.length ? ` (or ${fallbacks.join(', ')})` : '';
    throw new Error(`Missing required environment variable: ${name}${hint}`);
}

function optionalEnv(name, fallbacks = []) {
    const names = [name, ...fallbacks];
    for (const key of names) {
        const value = process.env[key];
        if (value) return value;
    }
    return undefined;
}

function createStorage() {
    const provider = String(process.env.STORAGE_PROVIDER || 'r2').toLowerCase();

    if (!['r2', 's3'].includes(provider)) {
        throw new Error(`Unsupported STORAGE_PROVIDER "${provider}". Use "r2" or "s3".`);
    }

    const accessKeyId = requireEnv('STORAGE_ACCESS_KEY_ID', [
        'R2_ACCESS_KEY_ID',
        'AWS_ACCESS_KEY_ID',
    ]);
    const secretAccessKey = requireEnv('STORAGE_SECRET_ACCESS_KEY', [
        'R2_SECRET_ACCESS_KEY',
        'AWS_SECRET_ACCESS_KEY',
    ]);
    const bucket = requireEnv('STORAGE_BUCKET_NAME', [
        'R2_BUCKET_NAME',
        'S3_BUCKET_NAME',
        'AWS_S3_BUCKET',
    ]);
    const publicBaseUrl = requireEnv('STORAGE_PUBLIC_BASE_URL', [
        'R2_PUBLIC_BASE_URL',
        'S3_PUBLIC_BASE_URL',
    ]).replace(/\/$/, '');

    let region;
    let endpoint;
    let forcePathStyle;

    if (provider === 'r2') {
        region = optionalEnv('STORAGE_REGION', ['R2_REGION']) || 'auto';
        endpoint = optionalEnv('STORAGE_ENDPOINT', ['R2_ENDPOINT']);

        if (!endpoint) {
            const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID', [
                'R2_ACCOUNT_ID',
                'STORAGE_ACCOUNT_ID',
            ]);
            endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
        }

        // R2 works best with path-style addressing
        forcePathStyle = String(process.env.STORAGE_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false';
    } else {
        region = requireEnv('STORAGE_REGION', ['AWS_REGION', 'AWS_DEFAULT_REGION']);
        endpoint = optionalEnv('STORAGE_ENDPOINT', ['S3_ENDPOINT']);
        forcePathStyle = String(process.env.STORAGE_FORCE_PATH_STYLE || 'false').toLowerCase() === 'true';
    }

    const clientConfig = {
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    };

    if (endpoint) {
        clientConfig.endpoint = endpoint;
    }

    if (forcePathStyle) {
        clientConfig.forcePathStyle = true;
    }

    const client = new S3Client(clientConfig);

    function buildPublicObjectUrl(fileName) {
        return `${publicBaseUrl}/${String(fileName).replace(/^\/+/, '')}`;
    }

    return {
        provider,
        client,
        bucket,
        publicBaseUrl,
        region,
        endpoint: endpoint || null,
        buildPublicObjectUrl,
    };
}

module.exports = { createStorage };
