// =====================================
// QDrop - Configuration Template
// =====================================
// This template is designed for open-source integration.
// Replace all placeholder values with your own credentials.
// NEVER commit real API keys for production apps to public repos.
// =====================================

// Application Configuration
const CONFIG = {
    // ------------------------
    // Firebase Configuration
    // ------------------------
    FIREBASE_CONFIG: {
        apiKey: "YOUR_FIREBASE_API_KEY",
        authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
        databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.REGION.firebasedatabase.app",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_PROJECT_ID.appspot.com",
        messagingSenderId: "YOUR_SENDER_ID",
        appId: "YOUR_APP_ID",
        measurementId: "YOUR_MEASUREMENT_ID"
    },

    // ------------------------
    // File Upload Settings
    // ------------------------
    STORAGE_BUCKET: 'YOUR_CLOUDFLARE_R2_BUCKET_NAME',
    MAX_FILE_SIZE: 100 * 1024 * 1024, // 100 MB
    ALLOWED_FILE_TYPES: ['.apk'],

    // ------------------------
    // GitHub Configuration (Optional)
    // ------------------------
    GITHUB: {
        USERNAME: 'YOUR_GITHUB_USERNAME',
        REPOSITORY: 'YOUR_GITHUB_REPOSITORY'
    }
};

// =====================================
// Service Initialization
// =====================================

let database;

// Initialize Firebase
if (typeof window !== "undefined" && typeof firebase !== "undefined") {
    firebase.initializeApp(CONFIG.FIREBASE_CONFIG);
    database = firebase.database();
}

// =====================================
// Export config (for modular usage)
// =====================================
if (typeof module !== "undefined" && module.exports) {
    module.exports = CONFIG;
}
