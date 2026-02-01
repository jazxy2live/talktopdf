// VoiceDoc Configuration
const CONFIG = {
    // Gemini API (keeping for fallback, but main processing is on backend now)
    GEMINI_API_KEY: 'AIzaSyDgxn7KP-Wuc3sSTqPu0sFoe-5W3jSbYUA',
    GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',

    // Backend API URL - auto-detect production vs local
    // Change this to your Render URL after deployment!
    BACKEND_URL: window.location.hostname === 'localhost'
        ? 'http://localhost:5000'
        : 'https://voicedoc-api.onrender.com'  // Update with your actual Render URL
};
