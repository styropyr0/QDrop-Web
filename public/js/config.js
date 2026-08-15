// Client configuration (non-secret)
const CONFIG = {
    APP_VERSION: '1.0.6',

    MAX_FILE_SIZE: 200 * 1024 * 1024,
    ALLOWED_FILE_TYPES: ['.apk'],
};

if (typeof document !== 'undefined') {
    const badge = document.getElementById('appVersionBadge');
    if (badge) badge.textContent = CONFIG.APP_VERSION;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = CONFIG;
}
