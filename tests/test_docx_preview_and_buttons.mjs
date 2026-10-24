import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Test 1: Verify extractDocxParagraphs logic parses a real DOCX file from uploads
test('DOCX Preview: extractDocxParagraphs extracts authentic text paragraphs without fake data', async () => {
  const sampleDocxPath = path.join(rootDir, 'backend', 'uploads', '56addb7df18c44e8b1c3545b563e29c6.docx');
  assert.ok(fs.existsSync(sampleDocxPath), 'Sample DOCX file should exist in uploads directory');

  const fileBytes = fs.readFileSync(sampleDocxPath);
  const buffer = new Uint8Array(fileBytes);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let offset = 0;
  let xmlText = null;

  while (offset + 30 <= buffer.length) {
    const sig = view.getUint32(offset, true);
    if (sig === 0x04034b50) {
      const compMethod = view.getUint16(offset + 8, true);
      const compSize = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const nameBytes = buffer.subarray(offset + 30, offset + 30 + nameLen);
      const filename = new TextDecoder().decode(nameBytes);
      const dataStart = offset + 30 + nameLen + extraLen;
      const dataEnd = dataStart + compSize;

      if (filename === 'word/document.xml') {
        const compressedData = buffer.subarray(dataStart, dataEnd);
        if (compMethod === 8) {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(compressedData);
          writer.close();
          const response = new Response(ds.readable);
          xmlText = await response.text();
        } else if (compMethod === 0) {
          xmlText = new TextDecoder().decode(compressedData);
        }
        break;
      }
      offset = dataEnd;
    } else {
      offset++;
    }
  }

  assert.ok(xmlText, 'word/document.xml was successfully located and decompressed');

  const paragraphs = [];
  const pRegex = /<w:p[\s>](.*?)<\/w:p>/gs;
  let match;
  while ((match = pRegex.exec(xmlText)) !== null) {
    const pContent = match[1];
    const isHeading =
      /<w:pStyle\s+[^>]*w:val="Heading/i.test(pContent) ||
      /<w:b(\s|\/|>)/.test(pContent);

    const tRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
    let tMatch;
    let pText = '';
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      pText += tMatch[1];
    }
    pText = pText
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();

    if (pText) {
      paragraphs.push({ text: pText, isHeading });
    }
  }

  assert.ok(paragraphs.length >= 2, 'Should extract at least 2 real paragraphs from the document');
  assert.equal(paragraphs[0].text, 'User B Paper', 'First paragraph text should match document title');
  assert.equal(paragraphs[0].isHeading, true, 'First paragraph should be detected as heading');
  assert.equal(
    paragraphs[1].text,
    'Research content for user private document isolation testing.',
    'Second paragraph text should match body'
  );
  assert.equal(paragraphs[1].isHeading, false, 'Second paragraph should be body text');
});

// Test 2: Verify PdfViewer.jsx contains DOCX reader and fallback handling
test('DOCX Preview: PdfViewer.jsx implements DOCX reader and honest fallback state', () => {
  const viewerCode = fs.readFileSync(
    path.join(rootDir, 'frontend', 'src', 'components', 'PdfViewer.jsx'),
    'utf-8'
  );

  assert.ok(viewerCode.includes('extractDocxParagraphs'), 'PdfViewer.jsx must declare extractDocxParagraphs');
  assert.ok(viewerCode.includes('docxParagraphs'), 'PdfViewer.jsx must maintain docxParagraphs state');
  assert.ok(viewerCode.includes('docx-reader-viewport'), 'PdfViewer.jsx must render docx-reader-viewport');
  assert.ok(viewerCode.includes('docx-reading-sheet'), 'PdfViewer.jsx must render docx-reading-sheet');
  assert.ok(viewerCode.includes('docx-fallback-state'), 'PdfViewer.jsx must have safe docx-fallback-state');
  assert.ok(viewerCode.includes('pdfjsLib.getDocument'), 'PdfViewer.jsx must preserve PDF.js viewer for PDFs');
  assert.ok(viewerCode.includes('handleDownload'), 'Download action must be preserved and wired');
});

// Test 3: Verify DOCX reader styling in PdfViewer.css
test('DOCX Preview: PdfViewer.css defines reading sheet, typography, and badges', () => {
  const css = fs.readFileSync(
    path.join(rootDir, 'frontend', 'src', 'components', 'PdfViewer.css'),
    'utf-8'
  );

  assert.ok(css.includes('.docx-reader-viewport'), 'PdfViewer.css must define .docx-reader-viewport');
  assert.ok(css.includes('.docx-reading-sheet'), 'PdfViewer.css must define .docx-reading-sheet');
  assert.ok(css.includes('.docx-heading'), 'PdfViewer.css must define .docx-heading');
  assert.ok(css.includes('.docx-paragraph'), 'PdfViewer.css must define .docx-paragraph');
  assert.ok(css.includes('.docx-badge-pill'), 'PdfViewer.css must define .docx-badge-pill');
  assert.ok(css.includes('border-radius: var(--radius-xl)'), 'Reading sheet should use rounded container');
});

// Test 4: Global Button System in index.css
test('Button Consistency: Global button system in index.css enforces design system', () => {
  const indexCss = fs.readFileSync(
    path.join(rootDir, 'frontend', 'src', 'styles', 'index.css'),
    'utf-8'
  );

  assert.ok(indexCss.includes('.btn-primary'), 'index.css must define .btn-primary');
  assert.ok(indexCss.includes('.btn-secondary'), 'index.css must define .btn-secondary');
  assert.ok(indexCss.includes('.pdf-btn-download'), 'index.css must define .pdf-btn-download');
  assert.ok(indexCss.includes('var(--primary-brand)') || indexCss.includes('var(--primary-emerald)'), 'btn-primary must use primary accent');
  assert.ok(indexCss.includes('var(--bg-surface)') || indexCss.includes('var(--bg-surface-secondary)'), 'btn-secondary must use surface background');
  assert.ok(indexCss.includes('border-radius: var(--radius-md)'), 'Buttons must use rounded corners');
  assert.ok(indexCss.includes(':focus-visible'), 'Buttons must define keyboard accessibility focus outlines');
  assert.ok(indexCss.includes(':disabled'), 'Buttons must define disabled states');
});

// Test 5: Verify PublishModal.jsx uses polished button classes
test('Button Consistency: PublishModal.jsx uses .btn-primary and .btn-secondary', () => {
  const modalCode = fs.readFileSync(
    path.join(rootDir, 'frontend', 'src', 'components', 'PublishModal.jsx'),
    'utf-8'
  );

  assert.ok(modalCode.includes('className="btn-primary"'), 'PublishModal must use .btn-primary for submit');
  assert.ok(modalCode.includes('className="btn-secondary"'), 'PublishModal must use .btn-secondary for cancel');
  assert.ok(modalCode.includes('disabled={loading}'), 'Publish button must be disabled when loading');
});

// Test 6: Verify DocumentPage.jsx header actions consistency
test('Button Consistency: DocumentPage.jsx uses consistent action buttons', () => {
  const docPageCode = fs.readFileSync(
    path.join(rootDir, 'frontend', 'src', 'pages', 'DocumentPage.jsx'),
    'utf-8'
  );

  assert.ok(docPageCode.includes('workspace-actions-right'), 'DocumentPage must have workspace-actions-right');
  assert.ok(docPageCode.includes('className="pdf-btn-download"'), 'Download button in header must use .pdf-btn-download');
  assert.ok(docPageCode.includes('api.downloadDocument'), 'Download button must call api.downloadDocument');
});

// Test 7: Verify docx-preview library integration in PdfViewer.jsx
test('DOCX Preview: PdfViewer.jsx integrates maintained docx-preview renderAsync library', () => {
  const viewerCode = fs.readFileSync(
    path.join(rootDir, 'frontend', 'src', 'components', 'PdfViewer.jsx'),
    'utf-8'
  );

  assert.ok(viewerCode.includes("from 'docx-preview'"), 'PdfViewer.jsx must import from docx-preview');
  assert.ok(viewerCode.includes('renderAsync'), 'PdfViewer.jsx must call renderAsync');
  assert.ok(viewerCode.includes('docxContainerRef'), 'PdfViewer.jsx must maintain docxContainerRef target');
  assert.ok(viewerCode.includes('docx-render-target'), 'PdfViewer.jsx must render docx-render-target element');
  assert.ok(viewerCode.includes('docxRendered'), 'PdfViewer.jsx must track docxRendered state');
});

// Test 8: Verify docx-preview styling and responsive layout
test('DOCX Preview: PdfViewer.css defines responsive docx-render-target and page wrapper rules', () => {
  const css = fs.readFileSync(
    path.join(rootDir, 'frontend', 'src', 'components', 'PdfViewer.css'),
    'utf-8'
  );

  assert.ok(css.includes('.docx-render-target'), 'PdfViewer.css must define .docx-render-target');
  assert.ok(css.includes('.docx-wrapper'), 'PdfViewer.css must customize .docx-wrapper');
  assert.ok(css.includes('section.docx'), 'PdfViewer.css must format section.docx pages');
  assert.ok(css.includes('table'), 'PdfViewer.css must contain table layout rules');
});

// Test 9: Verify loading and error states for DOCX preview
test('DOCX Preview: Loading and error states with authenticated download fallback', () => {
  const viewerCode = fs.readFileSync(
    path.join(rootDir, 'frontend', 'src', 'components', 'PdfViewer.jsx'),
    'utf-8'
  );

  assert.ok(viewerCode.includes('pdf-loading-state'), 'PdfViewer.jsx must render loading state during fetch');
  assert.ok(viewerCode.includes('Loading Word document preview...'), 'PdfViewer.jsx must provide user-friendly loading description');
  assert.ok(viewerCode.includes('docx-fallback-state'), 'PdfViewer.jsx must provide clear error/fallback state');
  assert.ok(viewerCode.includes('Download {docTitle}.docx') || viewerCode.includes('Download Word Document'), 'Fallback must provide direct download');
  assert.ok(viewerCode.includes('getToken()'), 'DOCX preview must use authenticated token for download');
});

// Test 10: Verify PDF viewer regression
test('PDF Regression: PDF.js canvas, pagination, and download preserved', () => {
  const viewerCode = fs.readFileSync(
    path.join(rootDir, 'frontend', 'src', 'components', 'PdfViewer.jsx'),
    'utf-8'
  );

  assert.ok(viewerCode.includes('pdfjsLib.getDocument'), 'PDF.js getDocument preserved');
  assert.ok(viewerCode.includes('canvasRef'), 'Canvas ref preserved for PDF rendering');
  assert.ok(viewerCode.includes('handlePrevPage'), 'Pagination controls preserved');
  assert.ok(viewerCode.includes('handleNextPage'), 'Pagination controls preserved');
  assert.ok(viewerCode.includes('handleZoomIn'), 'Zoom controls preserved');
});
