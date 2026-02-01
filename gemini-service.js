/**
 * Gemini AI Service for VoiceDoc
 * Handles intent parsing from Hindi/Hinglish voice commands
 */

class GeminiService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        // Using Gemini 2.5 Flash: fastest stable model available
        this.apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    }

    /**
     * Parse a voice command to extract intent
     * @param {string} command - The spoken command in Hindi/Hinglish
     * @param {string} documentContext - Optional context about the document
     * @returns {Promise<Object>} Parsed intent with action, target, replacement
     */
    async parseIntent(command, documentContext = '') {
        const prompt = `You are a document editing assistant. The user speaks Hindi or Hinglish (Hindi mixed with English).

Your job is to understand what edit they want to make to their document.

USER'S VOICE COMMAND: "${command}"

${documentContext ? `DOCUMENT CONTEXT (text found in document): "${documentContext}"` : ''}

IMPORTANT RULES:
1. Understand the user's intent, not just the literal words
2. The user may be informal or incomplete in their request
3. Extract what needs to be changed (target) and what to change it to (replacement)
4. If it's a delete/remove action, set action to "remove"
5. If it's adding something new, set action to "add"
6. If it's fixing/correcting something, set action to "fix"
7. Otherwise, set action to "replace"

RESPOND IN THIS EXACT JSON FORMAT ONLY (no markdown, no explanation):
{
    "action": "replace|remove|add|fix",
    "target": "the text or thing to find/change (in the document's language)",
    "replacement": "the new text (null if removing)",
    "field_type": "name|date|phone|address|amount|text|other",
    "confidence": 0.0 to 1.0,
    "explanation_hindi": "brief explanation in Hindi for user"
}

Examples:
- "नाम राहुल से राज कर दो" → {"action":"replace","target":"राहुल","replacement":"राज","field_type":"name","confidence":0.95,"explanation_hindi":"राहुल को राज में बदल रहे हैं"}
- "Change date to 15 January" → {"action":"replace","target":"date","replacement":"15 January","field_type":"date","confidence":0.85,"explanation_hindi":"तारीख 15 जनवरी कर रहे हैं"}
- "mobile number hata do" → {"action":"remove","target":"mobile number","replacement":null,"field_type":"phone","confidence":0.9,"explanation_hindi":"मोबाइल नंबर हटा रहे हैं"}`;

        try {
            const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 500
                    }
                })
            });

            if (!response.ok) {
                const error = await response.text();
                console.error('Gemini API error:', error);
                throw new Error('API request failed');
            }

            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            // Parse the JSON response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const intent = JSON.parse(jsonMatch[0]);
                return {
                    success: true,
                    ...intent
                };
            } else {
                throw new Error('Could not parse response');
            }
        } catch (error) {
            console.error('Gemini parsing error:', error);
            return {
                success: false,
                action: 'unknown',
                target: null,
                replacement: null,
                confidence: 0,
                explanation_hindi: 'समझ नहीं आया, कृपया फिर से बोलें'
            };
        }
    }

    /**
     * Extract text from PDF for context
     * @param {Object} pdfDoc - PDF.js document
     * @returns {Promise<string>} Extracted text
     */
    async extractTextFromPdf(pdfDoc) {
        let fullText = '';

        try {
            for (let i = 1; i <= Math.min(pdfDoc.numPages, 3); i++) { // First 3 pages
                const page = await pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(' ');
                fullText += pageText + '\n';
            }
        } catch (error) {
            console.error('Error extracting text:', error);
        }

        return fullText.trim();
    }

    /**
     * Find text position in PDF
     * @param {Object} pdfDoc - PDF.js document  
     * @param {string} searchText - Text to find
     * @returns {Promise<Object|null>} Position info or null
     */
    async findTextInPdf(pdfDoc, searchText) {
        if (!searchText) return null;

        const searchLower = searchText.toLowerCase();

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();

            for (let i = 0; i < textContent.items.length; i++) {
                const item = textContent.items[i];
                if (item.str.toLowerCase().includes(searchLower)) {
                    return {
                        pageNum,
                        itemIndex: i,
                        text: item.str,
                        transform: item.transform,
                        width: item.width,
                        height: item.height
                    };
                }
            }
        }

        return null;
    }
}

// Export for use in app
window.GeminiService = GeminiService;
