"""
VoiceDoc Backend Server - Enhanced Version
Supports PDF, DOCX, and TXT editing with smart text matching
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import fitz  # PyMuPDF
import google.generativeai as genai
import io
import base64
import json
import os
import re
from difflib import SequenceMatcher

# Serve static files from the parent directory (frontend)
app = Flask(__name__, static_folder="../", static_url_path="/")
CORS(app)

@app.route('/')
def serve_index():
    return send_file('../index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_file(f'../{path}')

# Configure Gemini - Using 1.5 Flash for stability, or 2.0 Flash for latest
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyDgxn7KP-Wuc3sSTqPu0sFoe-5W3jSbYUA")
genai.configure(api_key=GEMINI_API_KEY)
# Options: 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'
# Using Gemini 2.5 Flash: fastest stable model, great for real-time voice apps
model = genai.GenerativeModel('gemini-2.5-flash')


# Health check endpoint for deployment
@app.route('/health')
def health():
    return jsonify({"status": "healthy", "service": "voicedoc-api"})


def smart_find_text(document_text, user_description):
    """
    Use Gemini to find the EXACT text in the document that matches the user's description.
    This is the key innovation - we send the actual document content to Gemini.
    """
    
    prompt = f"""You are a document text finder. The user wants to edit a document and has described what they want to change.

IMPORTANT: You must find the EXACT text string from the document that matches what the user is describing.

USER'S DESCRIPTION: "{user_description}"

DOCUMENT TEXT (this is the FULL content of the document):
---
{document_text[:100000]}
---

Your task:
1. Read the user's description carefully
2. Find the EXACT text in the document that matches their description
3. The text you return MUST be an exact substring of the document

RESPOND IN THIS EXACT JSON FORMAT ONLY (no markdown, no explanation):
{{
    "found": true/false,
    "exact_text": "the exact text from the document",
    "context": "brief description of where this text appears",
    "confidence": 0.0 to 1.0
}}

IMPORTANT GUIDELINES:
- Return ONLY the specific text to be changed, not surrounding text
- For names: return ONLY the name itself (e.g., "Rahul Kumar"), not the whole line (not "Name: Rahul Kumar")
- For dates: return ONLY the date value, not labels
- For phone numbers: return ONLY the number
- Be PRECISE - the exact_text should be the minimal text that needs to change

Examples:
- If user says "introduction title" and document has "1. Introduction", return {{"found": true, "exact_text": "1. Introduction", "context": "section heading", "confidence": 0.95}}
- If user says "Rahul ka naam" and document has "Name: Rahul Kumar", return {{"found": true, "exact_text": "Rahul Kumar", "context": "name field", "confidence": 0.9}}
- If user says "change name from Rahul to Raj" and document has "Name: Rahul Kumar", return {{"found": true, "exact_text": "Rahul", "context": "name field", "confidence": 0.95}}
- If user says "phone number badlo" and document has "Phone: 9876543210", return {{"found": true, "exact_text": "9876543210", "context": "phone number", "confidence": 0.9}}

Remember: exact_text MUST be found verbatim in the document. Copy it exactly as it appears."""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            result = json.loads(json_match.group())
            
            # Verify the text actually exists in the document
            if result.get('found') and result.get('exact_text'):
                if result['exact_text'] in document_text:
                    return result
                else:
                    # Try fuzzy match
                    fuzzy_match = fuzzy_find_text(document_text, result['exact_text'])
                    if fuzzy_match:
                        result['exact_text'] = fuzzy_match
                        result['fuzzy_matched'] = True
                        return result
            return result
        return {'found': False, 'error': 'Could not parse response'}
    except Exception as e:
        print(f"Error in smart_find_text: {e}")
        return {'found': False, 'error': str(e)}


def smart_find_all_texts(document_text, user_description):
    """
    Use Gemini to find ALL matching texts in the document for batch operations.
    For example: "all titles", "all headings", "all author names"
    """
    
    prompt = f"""You are a document analyzer. The user wants to find EVERY SINGLE instance of a certain type of text in their document.

USER'S REQUEST: "{user_description}"

DOCUMENT TEXT (READ THE ENTIRE DOCUMENT CAREFULLY - THIS IS THE FULL DOCUMENT):
---
{document_text[:100000]}
---

Your task:
1. CAREFULLY scan through the ENTIRE document
2. Find EVERY SINGLE text element that matches the user's description
3. DO NOT MISS ANY - check every page, every section
4. Return each matching text as an EXACT substring from the document

For "titles" or "headings", look for:
- Section numbers like "1.", "2.", "3.", "1.1", "2.1", etc. followed by text
- Lines that appear to be section headers (Introduction, Methods, Results, Conclusion, etc.)
- Any numbered or formatted headings

RESPOND IN THIS EXACT JSON FORMAT:
{{
    "found_count": <number of items found>,
    "items": [
        "exact text 1",
        "exact text 2",
        "exact text 3"
    ],
    "pattern_type": "title|heading|name|date|number|keyword|other",
    "confidence": 0.0 to 1.0
}}

BE THOROUGH - Find EVERY matching item in the document. Do not stop at just a few.
IMPORTANT: Each item MUST be an EXACT substring found in the document text above."""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            result = json.loads(json_match.group())
            
            # Verify each item exists in document
            if result.get('items'):
                verified_items = []
                for item in result['items']:
                    if item in document_text:
                        verified_items.append(item)
                    else:
                        # Try fuzzy
                        fuzzy = fuzzy_find_text(document_text, item)
                        if fuzzy:
                            verified_items.append(fuzzy)
                result['items'] = verified_items
                result['found_count'] = len(verified_items)
            return result
        return {'found_count': 0, 'items': []}
    except Exception as e:
        print(f"Error in smart_find_all_texts: {e}")
        return {'found_count': 0, 'items': [], 'error': str(e)}


def parse_edit_command(command, document_text=""):
    """
    Parse the user's voice command to understand what edit they want.
    Supports: replace, remove, add, highlight, underline, strikethrough, watermark, page_numbers
    Also supports BATCH operations (e.g., "highlight all titles")
    """
    
    prompt = f"""You are a document editing assistant. Parse the user's command to understand what they want to do.

USER'S COMMAND: "{command}"

DOCUMENT TEXT (for context - FULL DOCUMENT):
---
{document_text[:50000]}
---

SUPPORTED ACTIONS:
- replace: Change one text to another
- remove: Delete text completely  
- add: Add new text (specify position: top, bottom)
- highlight: Highlight text with yellow background
- underline: Add underline to text
- strikethrough: Add strikethrough to text
- watermark: Add a watermark across all pages
- page_numbers: Add page numbers to all pages
- remove_images: Remove all images from PDF
- remove_links: Remove all clickable links from PDF
- compress: Compress PDF to reduce file size
- rotate: Rotate pages (specify angle: 90, 180, 270)

BATCH OPERATIONS:
If the user says "all" (e.g., "highlight all titles", "remove all dates"), set batch=true.
For batch operations, target_description should describe the PATTERN to find.

IMPORTANT RULES:
1. Understand the user's intent - they may speak in Hindi, Hinglish, or English
2. If user says "all titles/headings/names/dates", set batch: true
3. For "target_description" - describe what text to find
4. For batch operations, describe the PATTERN (e.g., "section headings", "author names")

RESPOND IN THIS EXACT JSON FORMAT ONLY:
{{
    "action": "replace|remove|add|highlight|underline|strikethrough|watermark|page_numbers|remove_images|remove_links|compress|rotate",
    "batch": true/false,
    "target_description": "description of what text to find",
    "replacement": "new text",
    "new_text": "text to add",
    "position": "top|bottom|center",
    "page": "all|first|last|number",
    "confidence": 0.0 to 1.0,
    "explanation_hindi": "brief explanation in Hindi for user"
}}

Examples:
- "saare titles highlight karo" → {{"action":"highlight","batch":true,"target_description":"all section titles and headings","confidence":0.9,"explanation_hindi":"सभी टाइटल हाईलाइट कर रहे हैं"}}
- "saari images hata do" → {{"action":"remove_images","page":"all","confidence":0.95,"explanation_hindi":"सभी इमेज हटा रहे हैं"}}
- "file size kam karo" → {{"action":"compress","confidence":0.9,"explanation_hindi":"फाइल कंप्रेस कर रहे हैं"}}
- "links aur urls hata do" → {{"action":"remove_links","confidence":0.9,"explanation_hindi":"सभी लिंक्स हटा रहे हैं"}}
- "watermark lagao DRAFT" → {{"action":"watermark","new_text":"DRAFT","page":"all","confidence":0.95,"explanation_hindi":"DRAFT वॉटरमार्क लगा रहे हैं"}}"""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            intent = json.loads(json_match.group())
            intent['success'] = True
            return intent
        return {'success': False, 'error': 'Could not parse response'}
    except Exception as e:
        print(f"Error parsing command: {e}")
        return {'success': False, 'error': str(e)}


def fuzzy_find_text(document_text, target, threshold=0.7):
    """
    Find text in document using fuzzy matching.
    Returns the best matching substring if found.
    """
    target_lower = target.lower().strip()
    doc_lower = document_text.lower()
    
    # First try exact match
    if target_lower in doc_lower:
        # Find the actual case version
        start = doc_lower.find(target_lower)
        return document_text[start:start + len(target)]
    
    # Try word-by-word matching for short targets
    words = target_lower.split()
    if len(words) <= 5:
        # Look for these words appearing together
        pattern = r'\b' + r'\s+'.join(re.escape(w) for w in words) + r'\b'
        match = re.search(pattern, doc_lower, re.IGNORECASE)
        if match:
            return document_text[match.start():match.end()]
    
    # Try sliding window matching for longer text
    window_size = len(target) + 20
    best_match = None
    best_ratio = 0
    
    for i in range(0, len(document_text) - len(target), 5):
        window = document_text[i:i + window_size]
        # Check each substring of appropriate length
        for j in range(len(window) - len(target) + 1):
            substring = window[j:j + len(target) + 10]
            ratio = SequenceMatcher(None, target_lower, substring.lower()).ratio()
            if ratio > best_ratio and ratio >= threshold:
                best_ratio = ratio
                best_match = substring.strip()
    
    return best_match


def extract_text_from_pdf(pdf_bytes):
    """Extract all text from PDF with page markers"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    full_text = ""
    page_texts = []
    
    for page_num, page in enumerate(doc):
        page_text = page.get_text()
        page_texts.append(page_text)
        full_text += f"\n--- Page {page_num + 1} ---\n{page_text}"
    
    doc.close()
    return full_text, page_texts


def find_and_replace_text_smart(pdf_bytes, target, replacement):
    """
    Smart find and replace that tries multiple strategies
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    found_count = 0
    
    # Strategy 1: Exact match
    for page in doc:
        instances = page.search_for(target)
        if instances:
            found_count += len(instances)
            for inst in instances:
                page.add_redact_annot(inst, text=replacement, fontsize=11)
            page.apply_redactions()
    
    # Strategy 2: Case-insensitive if no exact match
    if found_count == 0:
        for page in doc:
            text = page.get_text()
            pattern = re.compile(re.escape(target), re.IGNORECASE)
            for match in pattern.finditer(text):
                original = match.group()
                instances = page.search_for(original)
                if instances:
                    found_count += len(instances)
                    for inst in instances:
                        page.add_redact_annot(inst, text=replacement, fontsize=11)
                    page.apply_redactions()
    
    # Strategy 3: Word-by-word for multi-word targets
    if found_count == 0 and ' ' in target:
        words = target.split()
        for page in doc:
            text = page.get_text()
            # Find where all words appear close together
            for word in words:
                instances = page.search_for(word)
                if instances:
                    found_count += 1
                    for inst in instances:
                        page.add_redact_annot(inst, text="" if word != words[-1] else replacement, fontsize=11)
                    page.apply_redactions()
                    break
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    
    return output.getvalue(), found_count


def remove_text_smart(pdf_bytes, target):
    """Remove text with smart matching"""
    return find_and_replace_text_smart(pdf_bytes, target, "")


def highlight_text(pdf_bytes, target, color=(1, 1, 0)):
    """Highlight text with a colored background (default yellow)"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    found_count = 0
    
    for page in doc:
        instances = page.search_for(target)
        if instances:
            found_count += len(instances)
            for inst in instances:
                # Add highlight annotation
                highlight = page.add_highlight_annot(inst)
                highlight.set_colors(stroke=color)
                highlight.update()
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), found_count


def batch_highlight_text(pdf_bytes, targets, color=(1, 1, 0)):
    """Highlight multiple text items in one pass"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    found_count = 0
    
    for page in doc:
        for target in targets:
            instances = page.search_for(target)
            if instances:
                found_count += len(instances)
                for inst in instances:
                    highlight = page.add_highlight_annot(inst)
                    highlight.set_colors(stroke=color)
                    highlight.update()
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), found_count


def batch_underline_text(pdf_bytes, targets):
    """Underline multiple text items in one pass"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    found_count = 0
    
    for page in doc:
        for target in targets:
            instances = page.search_for(target)
            if instances:
                found_count += len(instances)
                for inst in instances:
                    underline = page.add_underline_annot(inst)
                    underline.update()
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), found_count


def batch_strikethrough_text(pdf_bytes, targets):
    """Strikethrough multiple text items in one pass"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    found_count = 0
    
    for page in doc:
        for target in targets:
            instances = page.search_for(target)
            if instances:
                found_count += len(instances)
                for inst in instances:
                    strike = page.add_strikeout_annot(inst)
                    strike.update()
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), found_count


def batch_remove_text(pdf_bytes, targets):
    """Remove multiple text items in one pass"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    found_count = 0
    
    for page in doc:
        for target in targets:
            instances = page.search_for(target)
            if instances:
                found_count += len(instances)
                for inst in instances:
                    page.add_redact_annot(inst, text="")
                page.apply_redactions()
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), found_count


def underline_text(pdf_bytes, target):
    """Add underline to text"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    found_count = 0
    
    for page in doc:
        instances = page.search_for(target)
        if instances:
            found_count += len(instances)
            for inst in instances:
                underline = page.add_underline_annot(inst)
                underline.update()
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), found_count


def strikethrough_text(pdf_bytes, target):
    """Add strikethrough to text"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    found_count = 0
    
    for page in doc:
        instances = page.search_for(target)
        if instances:
            found_count += len(instances)
            for inst in instances:
                strike = page.add_strikeout_annot(inst)
                strike.update()
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), found_count


def add_text_to_page(pdf_bytes, text, position="top", page_num="all"):
    """Add text to pages at specified position"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    
    # Determine which pages to modify
    if page_num == "all":
        pages_to_modify = range(len(doc))
    elif page_num == "first":
        pages_to_modify = [0]
    elif page_num == "last":
        pages_to_modify = [len(doc) - 1]
    else:
        try:
            pages_to_modify = [int(page_num) - 1]
        except:
            pages_to_modify = [0]
    
    for page_idx in pages_to_modify:
        if page_idx < 0 or page_idx >= len(doc):
            continue
        page = doc[page_idx]
        rect = page.rect
        
        # Calculate position
        if position == "top":
            point = fitz.Point(rect.width / 2, 30)
        elif position == "bottom":
            point = fitz.Point(rect.width / 2, rect.height - 30)
        else:  # center
            point = fitz.Point(rect.width / 2, rect.height / 2)
        
        # Add text
        page.insert_text(
            point,
            text,
            fontsize=14,
            fontname="helv",
            color=(0, 0, 0),
            rotate=0
        )
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), len(pages_to_modify)


def add_watermark(pdf_bytes, text, opacity=0.3):
    """Add a diagonal watermark across all pages"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    
    for page in doc:
        rect = page.rect
        # Add watermark text diagonally
        page.insert_text(
            fitz.Point(rect.width / 4, rect.height / 2),
            text,
            fontsize=60,
            fontname="helv",
            color=(0.7, 0.7, 0.7),  # Light gray
            rotate=45
        )
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), len(doc)


def add_page_numbers(pdf_bytes, position="bottom"):
    """Add page numbers to all pages"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    total_pages = len(doc)
    
    for page_num, page in enumerate(doc):
        rect = page.rect
        
        if position == "bottom":
            point = fitz.Point(rect.width / 2, rect.height - 20)
        else:  # top
            point = fitz.Point(rect.width / 2, 20)
        
        # Add page number
        page.insert_text(
            point,
            f"Page {page_num + 1} of {total_pages}",
            fontsize=10,
            fontname="helv",
            color=(0.3, 0.3, 0.3)
        )
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), total_pages


def remove_images(pdf_bytes, page_num="all"):
    """Remove all images from PDF pages"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    removed_count = 0
    
    # Determine which pages to process
    if page_num == "all":
        pages_to_modify = range(len(doc))
    elif page_num == "first":
        pages_to_modify = [0]
    elif page_num == "last":
        pages_to_modify = [len(doc) - 1]
    else:
        try:
            pages_to_modify = [int(page_num) - 1]
        except:
            pages_to_modify = range(len(doc))
    
    for page_idx in pages_to_modify:
        if page_idx < 0 or page_idx >= len(doc):
            continue
        page = doc[page_idx]
        
        # Get list of images on the page
        image_list = page.get_images()
        removed_count += len(image_list)
        
        # Remove each image by covering it with a white rectangle
        for img in image_list:
            xref = img[0]
            # Get the image's rectangle
            for img_rect in page.get_image_rects(xref):
                # Cover with white rectangle (redact)
                page.add_redact_annot(img_rect, fill=(1, 1, 1))
        
        page.apply_redactions()
    
    output = io.BytesIO()
    doc.save(output, garbage=4, deflate=True)
    doc.close()
    return output.getvalue(), removed_count


def remove_links(pdf_bytes):
    """Remove all links/URLs from PDF"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    removed_count = 0
    
    for page in doc:
        links = page.get_links()
        removed_count += len(links)
        for link in links:
            page.delete_link(link)
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), removed_count


def compress_pdf(pdf_bytes):
    """Compress PDF to reduce file size"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    
    output = io.BytesIO()
    doc.save(output, garbage=4, deflate=True, clean=True)
    doc.close()
    
    return output.getvalue(), len(doc)


def rotate_pages(pdf_bytes, rotation=90, page_num="all"):
    """Rotate PDF pages"""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    
    if page_num == "all":
        pages_to_modify = range(len(doc))
    elif page_num == "first":
        pages_to_modify = [0]
    elif page_num == "last":
        pages_to_modify = [len(doc) - 1]
    else:
        try:
            pages_to_modify = [int(page_num) - 1]
        except:
            pages_to_modify = range(len(doc))
    
    for page_idx in pages_to_modify:
        if page_idx < 0 or page_idx >= len(doc):
            continue
        page = doc[page_idx]
        page.set_rotation(page.rotation + rotation)
    
    output = io.BytesIO()
    doc.save(output)
    doc.close()
    return output.getvalue(), len(pages_to_modify)


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok', 'message': 'VoiceDoc Backend Running - Enhanced Edition'})


@app.route('/api/extract-text', methods=['POST'])
def extract_text():
    """Extract text from uploaded PDF"""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    pdf_bytes = file.read()
    
    try:
        full_text, page_texts = extract_text_from_pdf(pdf_bytes)
        return jsonify({
            'success': True,
            'text': full_text,
            'pages': page_texts,
            'length': len(full_text)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/edit-pdf', methods=['POST'])
def edit_pdf():
    """
    Main endpoint: Edit PDF based on voice command
    Uses smart text finding to match semantic descriptions to actual text
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided', 'explanation_hindi': 'फाइल नहीं मिली'}), 400
    
    file = request.files['file']
    command = request.form.get('command', '')
    
    if not command:
        return jsonify({'error': 'No command provided', 'explanation_hindi': 'कमांड नहीं मिला'}), 400
    
    try:
        pdf_bytes = file.read()
        
        if not pdf_bytes or len(pdf_bytes) == 0:
            return jsonify({
                'success': False,
                'error': 'Empty file received',
                'explanation_hindi': 'खाली फाइल मिली'
            }), 400
        
        print(f"\n{'='*50}")
        print(f"📝 Command: {command}")
        print(f"📄 PDF Size: {len(pdf_bytes)} bytes")
        
        # Step 1: Extract text from PDF
        full_text, page_texts = extract_text_from_pdf(pdf_bytes)
        print(f"📖 Extracted {len(full_text)} characters")
        
        # Step 2: Parse the user's command
        intent = parse_edit_command(command, full_text)
        print(f"🎯 Intent: {intent}")
        
        if not intent.get('success'):
            return jsonify({
                'success': False,
                'error': intent.get('error', 'Failed to understand command'),
                'explanation_hindi': 'आपकी बात समझ नहीं आई'
            })
        
        action = intent.get('action', 'replace')
        new_text = intent.get('new_text', '')
        position = intent.get('position', 'top')
        page = intent.get('page', 'all')
        
        print(f"✏️ Action: {action}")
        
        # Handle actions that don't need text search
        if action == 'watermark':
            watermark_text = new_text or 'DRAFT'
            edited_pdf, found_count = add_watermark(pdf_bytes, watermark_text)
            return jsonify({
                'success': True,
                'pdf_base64': base64.b64encode(edited_pdf).decode('utf-8'),
                'found_count': found_count,
                'action': action,
                'target': watermark_text,
                'explanation_hindi': intent.get('explanation_hindi', f'"{watermark_text}" वॉटरमार्क लगा दिया'),
                'confidence': intent.get('confidence', 0.9)
            })
        
        if action == 'remove_images':
            edited_pdf, found_count = remove_images(pdf_bytes, page)
            return jsonify({
                'success': True,
                'pdf_base64': base64.b64encode(edited_pdf).decode('utf-8'),
                'found_count': found_count,
                'action': action,
                'explanation_hindi': intent.get('explanation_hindi', f'{found_count} इमेजेस हटा दीं'),
                'confidence': intent.get('confidence', 0.9)
            })
        
        if action == 'remove_links':
            edited_pdf, found_count = remove_links(pdf_bytes)
            return jsonify({
                'success': True,
                'pdf_base64': base64.b64encode(edited_pdf).decode('utf-8'),
                'found_count': found_count,
                'action': action,
                'explanation_hindi': intent.get('explanation_hindi', f'{found_count} लिंक्स हटा दिए'),
                'confidence': intent.get('confidence', 0.9)
            })
        
        if action == 'compress':
            edited_pdf, _ = compress_pdf(pdf_bytes)
            return jsonify({
                'success': True,
                'pdf_base64': base64.b64encode(edited_pdf).decode('utf-8'),
                'found_count': 1,
                'action': action,
                'explanation_hindi': intent.get('explanation_hindi', 'फाइल कंप्रेस कर दी'),
                'confidence': intent.get('confidence', 0.9)
            })
        
        if action == 'rotate':
            # Extract angle from prompt or use default
            try:
                angle = int(new_text) if new_text and new_text.isdigit() else 90
            except:
                angle = 90
            edited_pdf, found_count = rotate_pages(pdf_bytes, angle, page)
            return jsonify({
                'success': True,
                'pdf_base64': base64.b64encode(edited_pdf).decode('utf-8'),
                'found_count': found_count,
                'action': action,
                'explanation_hindi': intent.get('explanation_hindi', f'पेजेस घुमा दिए'),
                'confidence': intent.get('confidence', 0.9)
            })
        
        if action == 'page_numbers':
            edited_pdf, found_count = add_page_numbers(pdf_bytes, position)
            return jsonify({
                'success': True,
                'pdf_base64': base64.b64encode(edited_pdf).decode('utf-8'),
                'found_count': found_count,
                'action': action,
                'explanation_hindi': intent.get('explanation_hindi', 'पेज नंबर लगा दिए'),
                'confidence': intent.get('confidence', 0.9)
            })
        
        if action == 'add':
            add_text = new_text or intent.get('replacement', '')
            if not add_text:
                return jsonify({
                    'success': False,
                    'error': 'No text to add',
                    'explanation_hindi': 'क्या लिखना है वो बताएं'
                })
            edited_pdf, found_count = add_text_to_page(pdf_bytes, add_text, position, page)
            return jsonify({
                'success': True,
                'pdf_base64': base64.b64encode(edited_pdf).decode('utf-8'),
                'found_count': found_count,
                'action': action,
                'target': add_text,
                'explanation_hindi': intent.get('explanation_hindi', f'"{add_text}" जोड़ दिया'),
                'confidence': intent.get('confidence', 0.9)
            })
        
        # Check if this is a BATCH operation
        is_batch = intent.get('batch', False)
        target_desc = intent.get('target_description', '')
        
        if is_batch and action in ['highlight', 'underline', 'strikethrough', 'remove']:
            print(f"🔄 BATCH Operation: Finding all '{target_desc}'")
            
            # Use batch finder
            batch_result = smart_find_all_texts(full_text, target_desc)
            print(f"📋 Found {batch_result.get('found_count', 0)} items: {batch_result.get('items', [])}")
            
            if not batch_result.get('items'):
                return jsonify({
                    'success': False,
                    'error': 'Could not find matching items',
                    'explanation_hindi': f'"{target_desc}" डॉक्यूमेंट में नहीं मिला',
                    'searched_for': target_desc
                })
            
            targets = batch_result['items']
            
            # Apply batch operation
            if action == 'highlight':
                edited_pdf, found_count = batch_highlight_text(pdf_bytes, targets)
            elif action == 'underline':
                edited_pdf, found_count = batch_underline_text(pdf_bytes, targets)
            elif action == 'strikethrough':
                edited_pdf, found_count = batch_strikethrough_text(pdf_bytes, targets)
            elif action == 'remove':
                edited_pdf, found_count = batch_remove_text(pdf_bytes, targets)
            
            print(f"✅ Batch processed {found_count} items")
            
            return jsonify({
                'success': True,
                'pdf_base64': base64.b64encode(edited_pdf).decode('utf-8'),
                'found_count': found_count,
                'action': action,
                'batch': True,
                'items_found': len(targets),
                'target': ', '.join(targets[:5]) + ('...' if len(targets) > 5 else ''),
                'explanation_hindi': intent.get('explanation_hindi', f'{len(targets)} items को {action} किया'),
                'confidence': intent.get('confidence', 0.9)
            })
        
        # For single-item actions that need text search
        if not target_desc and action in ['replace', 'remove', 'highlight', 'underline', 'strikethrough']:
            return jsonify({
                'success': False,
                'error': 'No target text specified',
                'explanation_hindi': 'कौन सा टेक्स्ट बदलना है वो बताएं'
            })
        
        text_result = smart_find_text(full_text, target_desc)
        print(f"🔍 Text search result: {text_result}")
        
        if not text_result.get('found') or not text_result.get('exact_text'):
            # Try direct search
            direct_match = fuzzy_find_text(full_text, target_desc)
            if direct_match:
                text_result = {'found': True, 'exact_text': direct_match, 'fuzzy_matched': True}
            else:
                return jsonify({
                    'success': False,
                    'error': 'Could not find the text you mentioned',
                    'explanation_hindi': f'"{target_desc}" डॉक्यूमेंट में नहीं मिला',
                    'searched_for': target_desc
                })
        
        target = text_result['exact_text']
        replacement = intent.get('replacement', '')
        
        print(f"🎯 Target: '{target}'")
        print(f"📝 Replacement: '{replacement}'")
        
        # Apply the edit based on action
        if action == 'remove':
            edited_pdf, found_count = remove_text_smart(pdf_bytes, target)
        elif action == 'highlight':
            edited_pdf, found_count = highlight_text(pdf_bytes, target)
        elif action == 'underline':
            edited_pdf, found_count = underline_text(pdf_bytes, target)
        elif action == 'strikethrough':
            edited_pdf, found_count = strikethrough_text(pdf_bytes, target)
        elif action == 'replace':
            if not replacement:
                return jsonify({
                    'success': False,
                    'error': 'No replacement text provided',
                    'explanation_hindi': 'क्या लिखना है वो बताएं'
                })
            edited_pdf, found_count = find_and_replace_text_smart(pdf_bytes, target, replacement)
        else:
            # Default to replace
            edited_pdf, found_count = find_and_replace_text_smart(pdf_bytes, target, replacement or target)
        
        print(f"✅ Found and modified {found_count} instance(s)")
        
        # Convert to base64
        pdf_base64 = base64.b64encode(edited_pdf).decode('utf-8')
        
        return jsonify({
            'success': True,
            'pdf_base64': pdf_base64,
            'found_count': found_count,
            'action': action,
            'target': target,
            'replacement': replacement,
            'explanation_hindi': intent.get('explanation_hindi', 'बदलाव हो गया'),
            'confidence': intent.get('confidence', 0.8),
            'fuzzy_matched': text_result.get('fuzzy_matched', False)
        })
        
    except Exception as e:
        import traceback
        print(f"❌ Error: {e}")
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e),
            'explanation_hindi': 'कुछ गड़बड़ हुई'
        }), 500


@app.route('/api/edit-text', methods=['POST'])
def edit_text_file():
    """
    Edit a plain text file - this is trivial and always works!
    """
    data = request.json
    content = data.get('content', '')
    command = data.get('command', '')
    
    if not content or not command:
        return jsonify({'error': 'Missing content or command'}), 400
    
    try:
        # Parse command
        intent = parse_edit_command(command, content)
        
        if not intent.get('success'):
            return jsonify({'success': False, 'error': 'Could not understand command'})
        
        # Find exact text
        target_desc = intent.get('target_description', '')
        text_result = smart_find_text(content, target_desc)
        
        if not text_result.get('found'):
            return jsonify({'success': False, 'error': f'Text not found: {target_desc}'})
        
        target = text_result['exact_text']
        replacement = intent.get('replacement', '')
        action = intent.get('action', 'replace')
        
        # Apply edit - simple string replacement!
        if action == 'remove':
            new_content = content.replace(target, '')
        else:
            new_content = content.replace(target, replacement)
        
        return jsonify({
            'success': True,
            'content': new_content,
            'target': target,
            'replacement': replacement,
            'action': action
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/analyze-document', methods=['POST'])
def analyze_document():
    """
    Analyze a document and return its structure - useful for debugging
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    pdf_bytes = file.read()
    
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        
        analysis = {
            'page_count': len(doc),
            'pages': []
        }
        
        for page_num, page in enumerate(doc):
            text = page.get_text()
            words = page.get_text("words")  # List of (x0, y0, x1, y1, word, block_no, line_no, word_no)
            
            # Get text blocks
            blocks = page.get_text("dict")["blocks"]
            text_blocks = []
            for block in blocks:
                if "lines" in block:
                    for line in block["lines"]:
                        line_text = " ".join([span["text"] for span in line["spans"]])
                        if line_text.strip():
                            text_blocks.append({
                                'text': line_text,
                                'bbox': line["bbox"]
                            })
            
            analysis['pages'].append({
                'page_num': page_num + 1,
                'text': text[:1000],
                'word_count': len(words),
                'text_blocks': text_blocks[:20]  # First 20 blocks
            })
        
        doc.close()
        return jsonify(analysis)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print("=" * 50)
    print("🚀 VoiceDoc Backend Server - Enhanced Edition")
    print("📍 Running on http://localhost:5001")
    print("🧠 Smart text matching enabled")
    print("=" * 50)
    app.run(host='0.0.0.0', port=5001, debug=True)
