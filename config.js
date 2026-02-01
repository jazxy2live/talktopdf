// VoiceDoc Configuration
const CONFIG = {
    // Gemini API (keeping for fallback, but main processing is on backend now)
    GEMINI_API_KEY: 'AIzaSyDgxn7KP-Wuc3sSTqPu0sFoe-5W3jSbYUA',
    GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',

    // Backend API URL
    // In production, use the current origin (e.g. https://voicedoc-xyz.run.app)
    // In local dev, use localhost:5000
    BACKEND_URL: (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:5000'
        : window.location.origin
};
