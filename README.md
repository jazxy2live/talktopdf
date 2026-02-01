# 🎤 VoiceDoc - बोलकर बदलो

**Voice-powered PDF editor** - Edit your documents by just speaking in Hindi or English!

## ✨ Features

- 🗣️ **Voice Commands** - Say "Rahul ko Raj mein badlo" and it's done!
- 📄 **PDF Editing** - Replace, highlight, underline, strikethrough text
- 🇮🇳 **Bilingual** - Works in Hindi and English
- ↩️ **Undo/Redo** - Made a mistake? Just undo!
- 💾 **Auto-save** - Never lose your work
- 📱 **Mobile Friendly** - Works on phones too

## 🚀 Quick Start

### Local Development

1. **Start the backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

2. **Start the frontend:**
```bash
# In another terminal, from root folder
python3 -m http.server 8080
```

3. **Open** http://localhost:8080

### Environment Variables

Set `GEMINI_API_KEY` for production:
```bash
export GEMINI_API_KEY=your_key_here
```

## 🌐 Deployment (Render)

1. Push to GitHub
2. Go to [render.com](https://render.com)
3. Create New > Blueprint
4. Connect your GitHub repo
5. Set `GEMINI_API_KEY` in environment variables
6. Deploy!

## 📁 Project Structure

```
voicedoc/
├── index.html          # Main HTML
├── styles.css          # Styling
├── app.js              # Frontend logic
├── config.js           # Configuration
├── gemini-service.js   # Gemini API helper
├── render.yaml         # Render deployment config
└── backend/
    ├── server.py       # Flask API server
    └── requirements.txt
```

## 🔧 Tech Stack

- **Frontend**: HTML, CSS, JavaScript, PDF.js
- **Backend**: Python, Flask, PyMuPDF
- **AI**: Google Gemini 2.5 Flash

## 📜 License

MIT - Use freely!

---

Made with ❤️ in India
