/**
 * VoiceDoc - Voice-Powered Document Editor
 * Main Application Logic
 */

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Backend URL
const BACKEND_URL = 'http://localhost:5001';

class VoiceDocApp {
    constructor() {
        // State
        this.currentFile = null;
        this.currentFileData = null; // Store file bytes for backend
        this.originalPdfBytes = null; // PROTECTED: Original PDF bytes for backend
        this.pdfDoc = null;
        this.pdfBytes = null;
        this.currentPage = 1;
        this.totalPages = 1;
        this.isRecording = false;
        this.recognition = null;
        this.transcript = '';
        this.currentLang = 'hi'; // Default Hindi
        this.documentText = ''; // Extracted text from PDF
        this.lastIntent = null; // Last parsed intent
        this.useBackend = true; // Use Python backend for real editing

        // Undo/Redo History
        this.editHistory = []; // Stack of previous PDF states
        this.redoStack = []; // Stack for redo
        this.maxHistorySize = 10; // Keep max 10 undo states

        // Auto-save
        this.autoSaveKey = 'voicedoc_autosave';
        this.hasUnsavedChanges = false;

        // Initialize Gemini Service (fallback if backend is down)
        this.geminiService = new GeminiService(CONFIG.GEMINI_API_KEY);

        // Translations
        this.translations = {
            hi: {
                logoSubtitle: 'बोलो, हो जाएगा',
                uploadTitle: 'अपना डॉक्यूमेंट यहाँ डालें',
                uploadSubtitle: 'PDF, Word, या कोई भी फाइल',
                uploadBtn: 'फाइल चुनें',
                uploadHint: 'या ड्रैग करके यहाँ छोड़ें',
                recentTitle: 'हाल की फाइलें',
                docReady: 'तैयार है',
                voiceBtn: 'बोलें',
                voicePlaceholder: '🎤 बटन दबाकर बोलें...',
                voiceListening: '🎤 बोलिए, सुन रहे हैं...',
                processingTitle: 'समझ रहे हैं...',
                processingSubtitle: 'आपकी बात समझकर बदलाव कर रहे हैं',
                stepUnderstand: 'आपकी बात समझना',
                stepFind: 'जगह खोजना',
                stepEdit: 'बदलाव करना',
                stepDone: 'हो गया!',
                helpTitle: 'कैसे इस्तेमाल करें?',
                helpStep1Title: '📄 Step 1: फाइल अपलोड करें',
                helpStep1Desc: 'अपनी PDF या Word फाइल चुनें',
                helpStep2Title: '🎤 Step 2: बोलें',
                helpStep2Desc: 'माइक बटन दबाएं और हिंदी में बताएं क्या बदलना है',
                helpStep3Title: '📥 Step 3: डाउनलोड करें',
                helpStep3Desc: 'बदलाव के बाद नई फाइल डाउनलोड करें',
                helpExamplesTitle: '🗣️ ऐसे बोल सकते हैं:',
                toastDownloaded: '📥 डाउनलोड हो गया!',
                toastEdited: '✅ बदलाव हो गया!',
                toastMicPermission: 'माइक्रोफोन की अनुमति दें',
                toastNoSpeech: 'कुछ सुनाई नहीं दिया, फिर से बोलें',
                toastNoDoc: 'कोई डॉक्यूमेंट नहीं है',
                toastWordSoon: 'Word फाइल का सपोर्ट जल्द आएगा!',
                toastUnsupported: 'यह फाइल टाइप सपोर्ट नहीं है',
                toastPdfError: 'PDF लोड नहीं हो पाई',
                toastImageError: 'इमेज लोड नहीं हो पाई',
                toastEditError: 'बदलाव करने में दिक्कत हुई',
                toastNotUnderstood: 'समझ नहीं आया क्या बदलना है। कृपया साफ बोलें।'
            },
            en: {
                logoSubtitle: 'Speak, it will be done',
                uploadTitle: 'Drop your document here',
                uploadSubtitle: 'PDF, Word, or any file',
                uploadBtn: 'Choose File',
                uploadHint: 'or drag and drop here',
                recentTitle: 'Recent Files',
                docReady: 'Ready',
                voiceBtn: 'Speak',
                voicePlaceholder: '🎤 Press button to speak...',
                voiceListening: '🎤 Listening...',
                processingTitle: 'Understanding...',
                processingSubtitle: 'Making changes based on your command',
                stepUnderstand: 'Understanding your command',
                stepFind: 'Finding location',
                stepEdit: 'Making changes',
                stepDone: 'Done!',
                helpTitle: 'How to use?',
                helpStep1Title: '📄 Step 1: Upload file',
                helpStep1Desc: 'Choose your PDF or Word file',
                helpStep2Title: '🎤 Step 2: Speak',
                helpStep2Desc: 'Press mic and say what to change',
                helpStep3Title: '📥 Step 3: Download',
                helpStep3Desc: 'Download the edited file',
                helpExamplesTitle: '🗣️ You can say:',
                toastDownloaded: '📥 Downloaded!',
                toastEdited: '✅ Changes applied!',
                toastMicPermission: 'Please allow microphone access',
                toastNoSpeech: 'No speech detected, try again',
                toastNoDoc: 'No document loaded',
                toastWordSoon: 'Word file support coming soon!',
                toastUnsupported: 'This file type is not supported',
                toastPdfError: 'Failed to load PDF',
                toastImageError: 'Failed to load image',
                toastEditError: 'Failed to apply changes',
                toastNotUnderstood: 'Could not understand. Please speak clearly.'
            }
        };

        // DOM Elements
        this.screens = {
            upload: document.getElementById('upload-screen'),
            doc: document.getElementById('doc-screen'),
            processing: document.getElementById('processing-screen')
        };

        this.elements = {
            dropZone: document.getElementById('drop-zone'),
            fileInput: document.getElementById('file-input'),
            uploadBtn: document.getElementById('upload-btn'),
            backBtn: document.getElementById('back-btn'),
            downloadBtn: document.getElementById('download-btn'),
            undoBtn: document.getElementById('undo-btn'),
            redoBtn: document.getElementById('redo-btn'),
            docName: document.getElementById('doc-name'),
            docStatus: document.getElementById('doc-status'),
            pdfCanvas: document.getElementById('pdf-canvas'),
            pdfContainer: document.getElementById('pdf-container'),
            prevPage: document.getElementById('prev-page'),
            nextPage: document.getElementById('next-page'),
            currentPageSpan: document.getElementById('current-page'),
            totalPagesSpan: document.getElementById('total-pages'),
            voiceBtn: document.getElementById('voice-btn'),
            transcriptBox: document.getElementById('transcript-box'),
            transcriptText: document.getElementById('transcript-text'),
            transcriptPlaceholder: document.getElementById('transcript-placeholder'),
            transcriptClear: document.getElementById('transcript-clear'),
            helpBtn: document.getElementById('help-btn'),
            helpModal: document.getElementById('help-modal'),
            modalClose: document.getElementById('modal-close'),
            toastContainer: document.getElementById('toast-container'),
            recentFiles: document.getElementById('recent-files'),
            fileList: document.getElementById('file-list'),
            langToggle: document.getElementById('lang-toggle')
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupSpeechRecognition();
        this.setupKeyboardShortcuts();
        this.loadRecentFiles();
        this.applyLanguage();
        this.tryRecoverAutoSave();
    }

    setupEventListeners() {
        // Upload interactions - prevent duplicate triggers
        this.elements.uploadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.elements.fileInput.click();
        });

        this.elements.dropZone.addEventListener('click', (e) => {
            // Only trigger if clicking directly on drop zone, not on button
            if (e.target === this.elements.dropZone || e.target.closest('.upload-area') && !e.target.closest('.primary-btn')) {
                this.elements.fileInput.click();
            }
        });

        this.elements.fileInput.addEventListener('change', (e) => {
            this.handleFileSelect(e);
            // Reset the input so same file can be selected again if needed
            this.elements.fileInput.value = '';
        });

        // Drag and drop
        this.elements.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.elements.dropZone.classList.add('dragover');
        });
        this.elements.dropZone.addEventListener('dragleave', () => {
            this.elements.dropZone.classList.remove('dragover');
        });
        this.elements.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.elements.dropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) this.loadFile(files[0]);
        });

        // Navigation
        this.elements.backBtn.addEventListener('click', () => this.showScreen('upload'));
        this.elements.downloadBtn.addEventListener('click', () => this.downloadDocument());

        // Undo/Redo
        this.elements.undoBtn.addEventListener('click', () => this.undo());
        this.elements.redoBtn.addEventListener('click', () => this.redo());

        // Page navigation
        this.elements.prevPage.addEventListener('click', () => this.changePage(-1));
        this.elements.nextPage.addEventListener('click', () => this.changePage(1));
        // Voice
        this.elements.voiceBtn.addEventListener('click', () => this.toggleRecording());

        // Clear transcript button
        this.elements.transcriptClear.addEventListener('click', () => this.clearTranscript());

        // Help modal
        this.elements.helpBtn.addEventListener('click', () => this.elements.helpModal.classList.add('active'));
        this.elements.modalClose.addEventListener('click', () => this.elements.helpModal.classList.remove('active'));
        this.elements.helpModal.addEventListener('click', (e) => {
            if (e.target === this.elements.helpModal) this.elements.helpModal.classList.remove('active');
        });

        // Language toggle
        this.elements.langToggle.addEventListener('click', () => this.toggleLanguage());
    }

    toggleLanguage() {
        this.currentLang = this.currentLang === 'hi' ? 'en' : 'hi';
        this.applyLanguage();

        // Update speech recognition language
        if (this.recognition) {
            this.recognition.lang = this.currentLang === 'hi' ? 'hi-IN' : 'en-US';
        }
    }

    applyLanguage() {
        const t = this.translations[this.currentLang];

        // Update toggle button active state
        const langOptions = this.elements.langToggle.querySelectorAll('.lang-option');
        langOptions.forEach(opt => {
            opt.classList.toggle('active', opt.dataset.lang === this.currentLang);
        });

        // Update all translatable text
        document.querySelector('.logo-subtitle').textContent = t.logoSubtitle;
        document.querySelector('.upload-title').textContent = t.uploadTitle;
        document.querySelector('.upload-subtitle').textContent = t.uploadSubtitle;
        document.querySelector('#upload-btn span').textContent = t.uploadBtn;
        document.querySelector('.upload-hint').textContent = t.uploadHint;
        document.querySelector('.section-title').textContent = t.recentTitle;
        document.querySelector('#doc-status').textContent = t.docReady;
        document.querySelector('.voice-btn-label').textContent = t.voiceBtn;
        document.querySelector('#transcript-placeholder').textContent = t.voicePlaceholder;
        document.querySelector('#processing-title').textContent = t.processingTitle;
        document.querySelector('#processing-subtitle').textContent = t.processingSubtitle;

        // Processing steps
        document.querySelector('[data-step="understand"] span').textContent = t.stepUnderstand;
        document.querySelector('[data-step="find"] span').textContent = t.stepFind;
        document.querySelector('[data-step="edit"] span').textContent = t.stepEdit;
        document.querySelector('[data-step="done"] span').textContent = t.stepDone;

        // Help modal
        document.querySelector('.modal-title').textContent = t.helpTitle;
        const helpSections = document.querySelectorAll('.help-section');
        if (helpSections[0]) {
            helpSections[0].querySelector('h3').textContent = t.helpStep1Title;
            helpSections[0].querySelector('p').textContent = t.helpStep1Desc;
        }
        if (helpSections[1]) {
            helpSections[1].querySelector('h3').textContent = t.helpStep2Title;
            helpSections[1].querySelector('p').textContent = t.helpStep2Desc;
        }
        if (helpSections[2]) {
            helpSections[2].querySelector('h3').textContent = t.helpStep3Title;
            helpSections[2].querySelector('p').textContent = t.helpStep3Desc;
        }
        document.querySelector('.help-examples h3').textContent = t.helpExamplesTitle;
    }

    setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            console.warn('Speech Recognition not supported');
            this.elements.voiceBtn.title = 'आपके ब्राउज़र में स्पीच रिकग्निशन नहीं है';
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.lang = 'hi-IN'; // Hindi
        this.recognition.continuous = true;
        this.recognition.interimResults = true;

        this.recognition.onstart = () => {
            this.isRecording = true;
            this.elements.voiceBtn.classList.add('recording');
            this.elements.transcriptPlaceholder.textContent = '🎤 बोलिए, सुन रहे हैं...';
        };

        this.recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            const displayText = finalTranscript || interimTranscript;
            if (displayText) {
                this.transcript = displayText;
                this.elements.transcriptText.textContent = displayText;
                this.elements.transcriptBox.classList.add('has-text');
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            this.stopRecording();

            if (event.error === 'not-allowed') {
                this.showToast('माइक्रोफोन की अनुमति दें', 'error');
            } else if (event.error === 'no-speech') {
                this.showToast('कुछ सुनाई नहीं दिया, फिर से बोलें', 'warning');
            }
        };

        this.recognition.onend = () => {
            if (this.isRecording) {
                // If we still want to record, restart
                // But if we stopped intentionally, process the command
                this.stopRecording();
                if (this.transcript.trim()) {
                    this.processVoiceCommand(this.transcript);
                }
            }
        };
    }

    toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
            if (this.transcript.trim()) {
                this.processVoiceCommand(this.transcript);
            }
        } else {
            this.startRecording();
        }
    }

    startRecording() {
        if (!this.recognition) {
            this.showToast('आपके ब्राउज़र में स्पीच रिकग्निशन नहीं है', 'error');
            return;
        }

        this.transcript = '';
        this.elements.transcriptText.textContent = '';
        this.elements.transcriptBox.classList.remove('has-text');

        try {
            this.recognition.start();
        } catch (e) {
            console.error('Failed to start recognition:', e);
        }
    }

    stopRecording() {
        this.isRecording = false;
        this.elements.voiceBtn.classList.remove('recording');
        this.elements.transcriptPlaceholder.textContent = '🎤 बटन दबाकर बोलें...';

        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {
                // Ignore
            }
        }
    }

    // Clear the transcript and reset voice input
    clearTranscript() {
        // Stop recording if active
        if (this.isRecording) {
            this.stopRecording();
        }

        // Clear the transcript
        this.transcript = '';
        this.elements.transcriptText.textContent = '';
        this.elements.transcriptBox.classList.remove('has-text');

        // Reset placeholder
        const placeholder = this.currentLang === 'hi' ? '🎤 बटन दबाकर बोलें...' : '🎤 Press button to speak...';
        this.elements.transcriptPlaceholder.textContent = placeholder;

        const msg = this.currentLang === 'hi' ? '🗑️ साफ हो गया' : '🗑️ Cleared';
        this.showToast(msg, 'info');
    }

    async processVoiceCommand(command) {
        console.log('Processing command:', command);

        // Show processing screen
        this.showScreen('processing');

        // Step 1: Understanding
        this.setProcessingStep('understand');
        await this.sleep(300);

        console.log('DEBUG: useBackend=', this.useBackend, 'originalPdfBytes=', this.originalPdfBytes?.length, 'bytes');

        // Use originalPdfBytes which is a protected copy
        if (this.useBackend && this.originalPdfBytes && this.originalPdfBytes.length > 0) {
            // Use Python backend for REAL PDF editing
            try {
                // Save current state for undo BEFORE making changes
                this.saveToHistory();

                const formData = new FormData();

                // Create a proper Blob from the protected copy
                const pdfBlob = new Blob([this.originalPdfBytes], { type: 'application/pdf' });
                formData.append('file', pdfBlob, this.currentFile?.name || 'document.pdf');
                formData.append('command', command);

                console.log('Sending PDF to backend, size:', this.originalPdfBytes.length, 'blob size:', pdfBlob.size);

                // Step 2: Finding
                this.setProcessingStep('find');

                const response = await fetch(`${BACKEND_URL}/api/edit-pdf`, {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                console.log('Backend result:', result);

                if (!result.success) {
                    this.showScreen('doc');
                    // Show more detailed error message
                    let errorMsg = result.explanation_hindi || 'बदलाव नहीं हो पाया';
                    if (result.searched_for) {
                        errorMsg = this.currentLang === 'hi'
                            ? `"${result.searched_for}" नहीं मिला डॉक्यूमेंट में`
                            : `"${result.searched_for}" not found in document`;
                    }
                    this.showToast(errorMsg, 'error');
                    return;
                }

                // Step 3: Editing
                this.setProcessingStep('edit');
                await this.sleep(300);

                // Decode the edited PDF
                console.log('📄 Backend returned pdf_base64 length:', result.pdf_base64?.length);
                const pdfBytes = Uint8Array.from(atob(result.pdf_base64), c => c.charCodeAt(0));
                console.log('📄 Decoded pdfBytes length:', pdfBytes.length);

                // IMPORTANT: Store copies BEFORE loadPdfFromBytes can consume them
                // Create independent copies so PDF.js can't affect our stored versions
                this.pdfBytes = new Uint8Array(pdfBytes);
                this.currentFileData = new Uint8Array(pdfBytes);
                this.originalPdfBytes = new Uint8Array(pdfBytes);

                console.log('📄 Stored in this.pdfBytes:', this.pdfBytes?.length, 'bytes');

                // Reload the display with edited PDF (pass a copy for display)
                await this.loadPdfFromBytes(pdfBytes);
                console.log('PDF display updated with edited version. this.pdfBytes:', this.pdfBytes?.length);

                // Step 4: Done
                this.setProcessingStep('done');
                await this.sleep(300);

                // Return to document view
                this.showScreen('doc');
                
                // Auto-save the NEW edited version
                this.autoSave();

                const msg = this.currentLang === 'hi' ?
                    (result.explanation_hindi || `✅ "${result.target}" को "${result.replacement}" में बदल दिया!`) :
                    `✅ Changed "${result.target}" to "${result.replacement}"!`;

                if (result.found_count > 0) {
                    this.showToast(msg, 'success');
                } else {
                    this.showToast(this.currentLang === 'hi' ?
                        `"${result.target}" नहीं मिला` :
                        `"${result.target}" not found`, 'warning');
                }
                return;

            } catch (error) {
                console.error('Backend error:', error);
                // Show detailed error
                alert('Backend Error: ' + error.message + '\n\nCheck console for details.');
                this.showToast(this.currentLang === 'hi' ?
                    'सर्वर से कनेक्ट नहीं हो पाया' :
                    'Could not connect to server', 'error');
                this.showScreen('doc');
                return;
            }
        }

        // Fallback: Use frontend Gemini service (overlay mode)
        const intent = await this.geminiService.parseIntent(command, this.documentText);
        this.lastIntent = intent;

        console.log('Parsed intent:', intent);

        if (!intent.success) {
            this.showScreen('doc');
            this.showToast(intent.explanation_hindi || 'समझ नहीं आया, फिर से बोलें', 'error');
            return;
        }

        // Step 2: Finding location
        this.setProcessingStep('find');
        await this.sleep(500);

        // Try to find the target text in PDF
        let foundLocation = null;
        if (intent.target && this.pdfDoc) {
            foundLocation = await this.geminiService.findTextInPdf(this.pdfDoc, intent.target);
            if (foundLocation) {
                console.log('Found text at:', foundLocation);
            } else {
                console.log('Text not found, will add/modify anyway');
            }
        }

        // Step 3: Making the edit
        this.setProcessingStep('edit');
        await this.sleep(500);

        const success = await this.applyEdit(intent, foundLocation);

        // Step 4: Done
        this.setProcessingStep('done');
        await this.sleep(500);

        // Return to document view
        this.showScreen('doc');

        if (success) {
            const msg = this.currentLang === 'hi' ?
                (intent.explanation_hindi || '✅ बदलाव हो गया!') :
                '✅ Changes applied!';
            this.showToast(msg, 'success');
        }
    }

    setProcessingStep(stepName) {
        const steps = document.querySelectorAll('.step');
        steps.forEach(step => {
            const thisStep = step.dataset.step;
            if (thisStep === stepName) {
                step.classList.add('active');
                step.classList.remove('done');
            } else if (this.getStepOrder(thisStep) < this.getStepOrder(stepName)) {
                step.classList.remove('active');
                step.classList.add('done');
            } else {
                step.classList.remove('active', 'done');
            }
        });
    }

    getStepOrder(stepName) {
        const order = { understand: 0, find: 1, edit: 2, done: 3 };
        return order[stepName] ?? -1;
    }

    async animateProcessingSteps(intent) {
        const steps = document.querySelectorAll('.step');
        const stepOrder = ['understand', 'find', 'edit', 'done'];

        for (let i = 0; i < stepOrder.length; i++) {
            const step = document.querySelector(`[data-step="${stepOrder[i]}"]`);
            if (step) {
                // Remove active from previous
                if (i > 0) {
                    const prevStep = document.querySelector(`[data-step="${stepOrder[i - 1]}"]`);
                    prevStep?.classList.remove('active');
                    prevStep?.classList.add('done');
                }

                step.classList.add('active');
                await this.sleep(800);
            }
        }

        // Mark last step as done
        const lastStep = document.querySelector(`[data-step="${stepOrder[stepOrder.length - 1]}"]`);
        lastStep?.classList.remove('active');
        lastStep?.classList.add('done');

        await this.sleep(500);

        // Reset steps
        steps.forEach(s => {
            s.classList.remove('active', 'done');
        });
    }

    async applyEdit(intent, foundLocation = null) {
        /**
         * Apply the parsed intent to the PDF.
         * Since pdf-lib cannot directly edit existing text, we use an overlay approach:
         * 1. Cover the old text with a white rectangle
         * 2. Write the new text on top
         */

        if (!this.pdfBytes) {
            console.log('Cannot apply edit - no PDF loaded');
            return false;
        }

        // For remove action, we just cover the text
        if (intent.action === 'remove' && !intent.target) {
            this.showToast('क्या हटाना है वो समझ नहीं आया', 'error');
            return false;
        }

        // For replace action, we need both target and replacement
        if (intent.action === 'replace' && (!intent.target || !intent.replacement)) {
            console.log('Cannot apply edit - missing target or replacement');
            this.showToast('क्या बदलना है और क्या करना है - दोनों बताएं', 'error');
            return false;
        }

        try {
            const { PDFDocument, rgb, StandardFonts } = PDFLib;
            const pdfDoc = await PDFDocument.load(this.pdfBytes);
            const pages = pdfDoc.getPages();

            // Get the page to edit (default to first, or use found location)
            const pageIndex = foundLocation ? foundLocation.pageNum - 1 : 0;
            const page = pages[pageIndex] || pages[0];
            const { width, height } = page.getSize();

            // Embed a font that supports both English and basic characters
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

            if (foundLocation) {
                // We found the exact location - overlay at that position
                const x = foundLocation.transform[4];
                const y = foundLocation.transform[5];

                // Cover old text with white rectangle
                page.drawRectangle({
                    x: x - 2,
                    y: y - 2,
                    width: foundLocation.width + 10,
                    height: 16,
                    color: rgb(1, 1, 1), // White
                });

                // Draw new text (replacement)
                if (intent.replacement) {
                    page.drawText(intent.replacement, {
                        x: x,
                        y: y,
                        size: 12,
                        font: font,
                        color: rgb(0, 0, 0), // Black
                    });
                }

                console.log(`Applied edit at (${x}, ${y}): "${intent.target}" → "${intent.replacement || '[removed]'}"`);
            } else {
                // Text not found - add a note at the top describing the intended change
                const noteY = height - 30;
                const noteText = `Edit: "${intent.target}" → "${intent.replacement || '[remove]'}"`;

                // White background for the note
                page.drawRectangle({
                    x: 10,
                    y: noteY - 5,
                    width: Math.min(font.widthOfTextAtSize(noteText, 10) + 20, width - 20),
                    height: 18,
                    color: rgb(1, 1, 0.8), // Light yellow
                });

                page.drawText(noteText, {
                    x: 15,
                    y: noteY,
                    size: 10,
                    font: font,
                    color: rgb(0.2, 0.2, 0.2),
                });

                console.log(`Text "${intent.target}" not found. Added note at top of page.`);
            }

            // Save the modified PDF
            this.pdfBytes = await pdfDoc.save();

            // Reload the display
            await this.loadPdfFromBytes(this.pdfBytes);

            return true;
        } catch (error) {
            console.error('Error applying edit:', error);
            const msg = this.currentLang === 'hi' ? 'बदलाव करने में दिक्कत हुई' : 'Failed to apply changes';
            this.showToast(msg, 'error');
            return false;
        }
    }

    // File handling
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (file) this.loadFile(file);
    }

    async loadFile(file) {
        this.currentFile = file;
        this.elements.docName.textContent = file.name;

        const fileType = file.type;
        const fileName = file.name.toLowerCase();

        if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
            await this.loadPdf(file);
        } else if (fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
            this.showToast('Word फाइल का सपोर्ट जल्द आएगा!', 'warning');
            return;
        } else if (file.type.startsWith('image/')) {
            await this.loadImage(file);
        } else {
            this.showToast('यह फाइल टाइप सपोर्ट नहीं है', 'error');
            return;
        }

        this.saveToRecent(file.name);
        this.showScreen('doc');
    }

    async loadPdf(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);

            // IMPORTANT: Create independent copies so PDF.js can't affect stored versions
            this.pdfBytes = new Uint8Array(bytes);
            this.currentFileData = new Uint8Array(bytes);
            this.originalPdfBytes = new Uint8Array(bytes);

            console.log('PDF loaded! pdfBytes size:', this.pdfBytes.length, 'bytes');
            await this.loadPdfFromBytes(bytes);
        } catch (error) {
            console.error('Error loading PDF:', error);
            this.showToast('PDF लोड नहीं हो पाई', 'error');
        }
    }

    async loadPdfFromBytes(bytes) {
        console.log('🔍 loadPdfFromBytes called. bytes:', bytes?.length, 'this.pdfBytes before:', this.pdfBytes?.length);
        try {
            // IMPORTANT: Pass a COPY to PDF.js because it transfers/consumes the ArrayBuffer
            // This prevents PDF.js from emptying our original bytes
            const bytesCopy = new Uint8Array(bytes);
            this.pdfDoc = await pdfjsLib.getDocument({ data: bytesCopy }).promise;
            this.totalPages = this.pdfDoc.numPages;
            this.currentPage = 1;

            this.elements.totalPagesSpan.textContent = this.totalPages;
            await this.renderPage(this.currentPage);
            this.updatePageControls();

            // Extract text for Gemini context
            this.documentText = await this.geminiService.extractTextFromPdf(this.pdfDoc);
            console.log('🔍 loadPdfFromBytes done. this.pdfBytes after:', this.pdfBytes?.length);
        } catch (error) {
            console.error('Error loading PDF from bytes:', error);
            throw error;
        }
    }

    async loadImage(file) {
        // Convert image to PDF for consistent handling
        try {
            const { PDFDocument } = PDFLib;
            const pdfDoc = await PDFDocument.create();

            const imageBytes = await file.arrayBuffer();
            let image;

            if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
                image = await pdfDoc.embedJpg(imageBytes);
            } else if (file.type === 'image/png') {
                image = await pdfDoc.embedPng(imageBytes);
            } else {
                throw new Error('Unsupported image type');
            }

            const page = pdfDoc.addPage([image.width, image.height]);
            page.drawImage(image, {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height,
            });

            this.pdfBytes = await pdfDoc.save();
            await this.loadPdfFromBytes(this.pdfBytes);
        } catch (error) {
            console.error('Error loading image:', error);
            this.showToast('इमेज लोड नहीं हो पाई', 'error');
        }
    }

    async renderPage(pageNum) {
        try {
            console.log('=== RENDER PAGE START ===');
            console.log('Page number:', pageNum);
            console.log('pdfDoc exists:', !!this.pdfDoc);

            if (!this.pdfDoc) {
                console.error('No PDF document loaded!');
                return;
            }

            const page = await this.pdfDoc.getPage(pageNum);
            console.log('Got page object:', !!page);

            const canvas = this.elements.pdfCanvas;
            if (!canvas) {
                console.error('Canvas element not found!');
                return;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                console.error('Could not get 2D context!');
                return;
            }

            // Get the PDF page's natural dimensions at scale 1
            const viewport = page.getViewport({ scale: 1 });
            console.log('PDF natural size:', viewport.width, 'x', viewport.height);

            // Calculate display size based on window
            const maxWidth = window.innerWidth - 100;
            const maxHeight = window.innerHeight - 350;

            const scaleX = maxWidth / viewport.width;
            const scaleY = maxHeight / viewport.height;
            const scale = Math.min(scaleX, scaleY, 2); // Cap at 2x

            console.log('Calculated scale:', scale);

            // For retina displays
            const pixelRatio = window.devicePixelRatio || 1;
            const renderScale = scale * pixelRatio;

            // Get the scaled viewport
            const scaledViewport = page.getViewport({ scale: renderScale });

            // Calculate display dimensions
            const displayWidth = Math.floor(scaledViewport.width / pixelRatio);
            const displayHeight = Math.floor(scaledViewport.height / pixelRatio);

            console.log('Display size will be:', displayWidth, 'x', displayHeight);

            // Set canvas attributes (internal resolution)
            canvas.width = scaledViewport.width;
            canvas.height = scaledViewport.height;

            // Set CSS size (display size)
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';

            // Clear canvas first
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            console.log('Canvas setup complete, starting render...');

            // Render the PDF page
            const renderContext = {
                canvasContext: ctx,
                viewport: scaledViewport
            };

            await page.render(renderContext).promise;

            console.log('=== RENDER COMPLETE ===');

            this.elements.currentPageSpan.textContent = pageNum;
        } catch (error) {
            console.error('Error rendering page:', error);
            console.error('Error stack:', error.stack);
        }
    }

    changePage(delta) {
        const newPage = this.currentPage + delta;
        if (newPage >= 1 && newPage <= this.totalPages) {
            this.currentPage = newPage;
            this.renderPage(this.currentPage);
            this.updatePageControls();
        }
    }

    updatePageControls() {
        this.elements.prevPage.disabled = this.currentPage <= 1;
        this.elements.nextPage.disabled = this.currentPage >= this.totalPages;
    }

    downloadDocument() {
        console.log('Download clicked. pdfBytes:', this.pdfBytes?.length, 'bytes');

        if (!this.pdfBytes || this.pdfBytes.length === 0) {
            const msg = this.currentLang === 'hi' ? 'कोई डॉक्यूमेंट नहीं है' : 'No document loaded';
            this.showToast(msg, 'error');
            return;
        }

        try {
            const blob = new Blob([this.pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // Add "_edited" to filename
            const originalName = this.currentFile?.name || 'document.pdf';
            const baseName = originalName.replace(/\.[^/.]+$/, '');
            a.download = `${baseName}_edited.pdf`;

            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Clear auto-save after successful download
            this.clearAutoSave();

            const msg = this.currentLang === 'hi' ? '📥 डाउनलोड हो गया!' : '📥 Downloaded!';
            this.showToast(msg, 'success');

            console.log('Download complete:', `${baseName}_edited.pdf`, blob.size, 'bytes');
        } catch (error) {
            console.error('Download error:', error);
            const msg = this.currentLang === 'hi' ? 'डाउनलोड में समस्या' : 'Download failed';
            this.showToast(msg, 'error');
        }
    }

    // Screen management
    showScreen(screenName) {
        Object.values(this.screens).forEach(screen => screen.classList.remove('active'));
        this.screens[screenName]?.classList.add('active');
    }

    // Recent files
    saveToRecent(fileName) {
        let recent = JSON.parse(localStorage.getItem('voicedoc_recent') || '[]');
        recent = recent.filter(f => f.name !== fileName);
        recent.unshift({ name: fileName, date: new Date().toISOString() });
        recent = recent.slice(0, 5); // Keep only 5 recent
        localStorage.setItem('voicedoc_recent', JSON.stringify(recent));
        this.loadRecentFiles();
    }

    loadRecentFiles() {
        const recent = JSON.parse(localStorage.getItem('voicedoc_recent') || '[]');

        if (recent.length === 0) {
            this.elements.recentFiles.classList.remove('has-files');
            return;
        }

        this.elements.recentFiles.classList.add('has-files');
        this.elements.fileList.innerHTML = recent.map(file => {
            const date = new Date(file.date);
            const dateStr = date.toLocaleDateString('hi-IN');
            return `
                <div class="file-item" data-filename="${file.name}" style="cursor: pointer;">
                    <div class="file-icon">📄</div>
                    <div class="file-details">
                        <div class="file-name">${file.name}</div>
                        <div class="file-date">${dateStr}</div>
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers to file items
        this.elements.fileList.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', () => {
                const fileName = item.dataset.filename;
                // Show instruction to re-upload since we don't store actual file data
                const msg = this.currentLang === 'hi'
                    ? `"${fileName}" को फिर से अपलोड करें`
                    : `Please re-upload "${fileName}"`;
                this.showToast(msg, 'info');
                // Trigger file picker
                this.elements.fileInput.click();
            });
        });
    }

    // Toast notifications
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        toast.innerHTML = `
            <span class="toast-icon">${icons[type]}</span>
            <span class="toast-message">${message}</span>
        `;

        this.elements.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('hide');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Utilities
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ========================================
    // UNDO / REDO FUNCTIONALITY
    // ========================================

    // Save current state to history before making changes
    saveToHistory() {
        if (!this.pdfBytes || this.pdfBytes.length === 0) return;

        // Clone the current PDF bytes
        const stateCopy = new Uint8Array(this.pdfBytes);

        // Add to history
        this.editHistory.push(stateCopy);

        // Limit history size
        if (this.editHistory.length > this.maxHistorySize) {
            this.editHistory.shift(); // Remove oldest
        }

        // Clear redo stack when new edit is made
        this.redoStack = [];

        // Mark as having unsaved changes
        this.hasUnsavedChanges = true;
        this.autoSave();
        this.updateUndoRedoButtons();

        console.log('📚 History saved. Undo stack:', this.editHistory.length);
    }

    // Update undo/redo button states
    updateUndoRedoButtons() {
        if (this.elements.undoBtn) {
            this.elements.undoBtn.disabled = this.editHistory.length === 0;
        }
        if (this.elements.redoBtn) {
            this.elements.redoBtn.disabled = this.redoStack.length === 0;
        }
    }

    // Undo last change
    async undo() {
        console.log('⚡ UNDO clicked! History length:', this.editHistory.length);

        if (this.editHistory.length === 0) {
            const msg = this.currentLang === 'hi' ? 'और पीछे नहीं जा सकते' : 'Nothing to undo';
            this.showToast(msg, 'info');
            return;
        }

        // Save current state to redo stack
        if (this.pdfBytes && this.pdfBytes.length > 0) {
            this.redoStack.push(new Uint8Array(this.pdfBytes));
        }

        // Pop last state from history
        const previousState = this.editHistory.pop();

        // Apply the previous state
        this.pdfBytes = previousState;
        this.originalPdfBytes = new Uint8Array(previousState);

        // Reload the PDF
        await this.loadPdfFromBytes(previousState);

        const msg = this.currentLang === 'hi' ? '↩️ पिछला बदलाव वापस' : '↩️ Undo successful';
        this.showToast(msg, 'success');
        this.updateUndoRedoButtons();

        console.log('↩️ Undo. History:', this.editHistory.length, 'Redo:', this.redoStack.length);
    }

    // Redo undone change
    async redo() {
        if (this.redoStack.length === 0) {
            const msg = this.currentLang === 'hi' ? 'आगे कुछ नहीं है' : 'Nothing to redo';
            this.showToast(msg, 'info');
            return;
        }

        // Save current state to history
        if (this.pdfBytes && this.pdfBytes.length > 0) {
            this.editHistory.push(new Uint8Array(this.pdfBytes));
        }

        // Pop from redo stack
        const redoState = this.redoStack.pop();

        // Apply the redo state
        this.pdfBytes = redoState;
        this.originalPdfBytes = new Uint8Array(redoState);

        // Reload the PDF
        await this.loadPdfFromBytes(redoState);

        const msg = this.currentLang === 'hi' ? '↪️ फिर से किया' : '↪️ Redo successful';
        this.showToast(msg, 'success');
        this.updateUndoRedoButtons();

        console.log('↪️ Redo. History:', this.editHistory.length, 'Redo:', this.redoStack.length);
    }

    // ========================================
    // AUTO-SAVE FUNCTIONALITY
    // ========================================

    autoSave() {
        if (!this.pdfBytes || this.pdfBytes.length === 0) return;

        try {
            // Convert to base64 for storage
            const base64 = btoa(String.fromCharCode(...this.pdfBytes));
            const saveData = {
                fileName: this.currentFile?.name || 'document.pdf',
                pdfBase64: base64,
                savedAt: new Date().toISOString()
            };

            localStorage.setItem(this.autoSaveKey, JSON.stringify(saveData));
            console.log('💾 Auto-saved at', new Date().toLocaleTimeString());
        } catch (error) {
            // localStorage might be full
            console.warn('Auto-save failed:', error.message);
        }
    }

    // Try to recover auto-saved document on startup
    async tryRecoverAutoSave() {
        try {
            const savedData = localStorage.getItem(this.autoSaveKey);
            if (!savedData) return false;

            const { fileName, pdfBase64, savedAt } = JSON.parse(savedData);
            const savedDate = new Date(savedAt);
            const hoursSinceSave = (Date.now() - savedDate.getTime()) / (1000 * 60 * 60);

            // Only recover if saved within last 24 hours
            if (hoursSinceSave > 24) {
                localStorage.removeItem(this.autoSaveKey);
                return false;
            }

            console.log('📂 Recoverable document found:', fileName, 'from', savedAt);

            // Show recovery prompt
            const timeAgo = this.getTimeAgo(savedDate);
            const confirmMsg = this.currentLang === 'hi'
                ? `💾 "${fileName}" (${timeAgo}) को रिकवर करें?`
                : `💾 Recover "${fileName}" (${timeAgo})?`;

            if (confirm(confirmMsg)) {
                // Decode and restore the PDF
                const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));

                // Store copies
                this.pdfBytes = new Uint8Array(pdfBytes);
                this.currentFileData = new Uint8Array(pdfBytes);
                this.originalPdfBytes = new Uint8Array(pdfBytes);

                // Set file info
                this.currentFile = { name: fileName };
                this.elements.docName.textContent = fileName;

                // Load and display
                await this.loadPdfFromBytes(pdfBytes);

                // Switch to document view
                this.showScreen('doc');

                const msg = this.currentLang === 'hi' ? '✅ रिकवर हो गया!' : '✅ Recovered!';
                this.showToast(msg, 'success');

                console.log('✅ Document recovered:', fileName, pdfBytes.length, 'bytes');
                return true;
            } else {
                // User declined - clear the auto-save
                this.clearAutoSave();
                return false;
            }
        } catch (error) {
            console.warn('Recovery failed:', error);
            this.clearAutoSave();
            return false;
        }
    }

    // Helper to get human-readable time ago
    getTimeAgo(date) {
        const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
        if (minutes < 1) return this.currentLang === 'hi' ? 'अभी' : 'just now';
        if (minutes < 60) return this.currentLang === 'hi' ? `${minutes} मिनट पहले` : `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return this.currentLang === 'hi' ? `${hours} घंटे पहले` : `${hours}h ago`;
        return this.currentLang === 'hi' ? 'कल' : 'yesterday';
    }

    // Clear auto-save after successful download
    clearAutoSave() {
        localStorage.removeItem(this.autoSaveKey);
        this.hasUnsavedChanges = false;
    }

    // Setup keyboard shortcuts for undo/redo
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Z or Cmd+Z = Undo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
            }
            // Ctrl+Shift+Z or Cmd+Shift+Z = Redo
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
                e.preventDefault();
                this.redo();
            }
            // Ctrl+Y = Redo (Windows style)
            if ((e.ctrlKey) && e.key === 'y') {
                e.preventDefault();
                this.redo();
            }
        });
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.voiceDocApp = new VoiceDocApp();
});
