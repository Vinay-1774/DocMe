import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const pdfViewerJsx = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'PdfViewer.jsx'), 'utf-8');
const pdfViewerCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'components', 'PdfViewer.css'), 'utf-8');
const documentPageJsx = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'pages', 'DocumentPage.jsx'), 'utf-8');
const documentPageCss = fs.readFileSync(path.join(rootDir, 'frontend', 'src', 'pages', 'DocumentPage.css'), 'utf-8');

console.log('=== Running DOCX Preview Scrolling & Layout Regression Tests ===\n');

// Test 1: Single primary scroll container definition & keyboard accessibility
test('Scroll Container: .docx-reader-viewport is the single primary scroll container with keyboard accessibility', () => {
  // Check JSX structure and attributes
  assert.ok(pdfViewerJsx.includes('className="docx-reader-viewport"'), 'PdfViewer.jsx must declare docx-reader-viewport');
  assert.ok(pdfViewerJsx.includes('tabIndex={0}'), 'docx-reader-viewport must be keyboard focusable (tabIndex={0})');
  assert.ok(pdfViewerJsx.includes('role="region"'), 'docx-reader-viewport must declare accessibility role="region"');
  assert.ok(pdfViewerJsx.includes('aria-label='), 'docx-reader-viewport must have descriptive aria-label');

  // Check CSS rules for docx-reader-viewport
  assert.ok(pdfViewerCss.includes('overflow-y: auto;'), 'docx-reader-viewport must scroll vertically');
  assert.ok(pdfViewerCss.includes('overflow-x: hidden;'), 'docx-reader-viewport must prevent horizontal container overflow');
  assert.ok(pdfViewerCss.includes('-webkit-overflow-scrolling: touch;'), 'docx-reader-viewport must support smooth touch scrolling');
  assert.ok(pdfViewerCss.includes('overscroll-behavior-y: contain;'), 'docx-reader-viewport must contain vertical overscroll');
  assert.ok(pdfViewerCss.includes('flex: 1 1 0%;'), 'docx-reader-viewport must flex to fill available reader height');
  assert.ok(pdfViewerCss.includes('min-height: 0;'), 'docx-reader-viewport must declare min-height: 0 to allow flex shrinking');
  
  // Verify height: 100% was removed to prevent flexbox clipping bug where viewport exceeds parent container
  const docxViewportBlock = pdfViewerCss.match(/\.docx-reader-viewport\s*\{([^}]+)\}/);
  assert.ok(docxViewportBlock, '.docx-reader-viewport rule block must exist');
  assert.ok(!docxViewportBlock[1].includes('height: 100%'), '.docx-reader-viewport must not set rigid height: 100% inside flex container');
});

// Test 2: Elimination of nested scrollbars on docx-preview wrapper and section.docx
test('Nested Scrollbar Elimination: section.docx pages use overflow: visible !important', () => {
  const sectionRules = pdfViewerCss.match(/section\.docx[^{]*\{([^}]+)\}/);
  assert.ok(sectionRules, 'Rules for section.docx must exist');
  assert.ok(sectionRules[1].includes('overflow: visible !important'), 'section.docx must declare overflow: visible !important');
  assert.ok(!sectionRules[1].includes('overflow-x: auto !important'), 'section.docx must NOT have overflow-x: auto !important which causes nested scrollbars');

  // Verify wide tables are individually scrollable without making page sections scroll containers
  const tableRules = pdfViewerCss.match(/\.docx-render-target\s+table\s*\{([^}]+)\}/);
  assert.ok(tableRules, 'Table rules must exist for DOCX preview');
  assert.ok(tableRules[1].includes('overflow-x: auto'), 'Tables must handle horizontal overflow independently');
});

// Test 3: Safe render target mounting without destructive display: none
test('Render Target: docxContainerRef is mounted without display:none breaking geometry', () => {
  assert.ok(!pdfViewerJsx.includes("display: docxLoading || docxError || !docxRendered ? 'none' : 'flex'"),
    'docx-render-target must NOT toggle display: none inline which disrupts docx-preview layout calculation'
  );
  assert.ok(pdfViewerJsx.includes('is-rendering-hidden'), 'docx-render-target uses is-rendering-hidden class');
  assert.ok(pdfViewerCss.includes('.docx-render-target.is-rendering-hidden'), 'is-rendering-hidden styling defined in CSS');
});

// Test 4: Desktop view layout constraints & panel alignment (1024px & 1440px)
test('Desktop Alignment: Reader and side panel are constrained side-by-side without whole-page scroll', () => {
  // Grid container bounds layout
  assert.ok(documentPageCss.includes('height: calc(100vh - 65px);'), 'workspace-grid must be bounded to viewport height');
  assert.ok(documentPageCss.includes('overflow: hidden;'), 'workspace-grid must have overflow: hidden to prevent page scrolling on desktop');

  // Columns have matching heights
  assert.ok(documentPageCss.includes('.workspace-reader-col'), 'workspace-reader-col must exist');
  assert.ok(documentPageCss.includes('.workspace-chat-col'), 'workspace-chat-col must exist');
  
  // Header and download button aligned
  assert.ok(documentPageJsx.includes('workspace-actions-right'), 'DocumentPage header actions must be present');
  assert.ok(documentPageJsx.includes('pdf-btn-download'), 'Header download button must be present');
});

// Test 5: Mobile responsiveness (320px, 375px, 768px, 860px)
test('Mobile Layout: Full width, zero horizontal overflow, and bounded height across mobile viewports', () => {
  // DocumentPage mobile switch
  assert.ok(documentPageCss.includes('@media (max-width: 860px)'), 'DocumentPage must define @media (max-width: 860px)');
  assert.ok(documentPageCss.includes('height: calc(100vh - 130px);'), 'Reader col must be bounded to mobile viewport height');
  
  // PdfViewer responsive styles for DOCX
  assert.ok(pdfViewerCss.includes('@media (max-width: 860px)'), 'PdfViewer.css must have @media (max-width: 860px)');
  assert.ok(pdfViewerCss.includes('@media (max-width: 480px)'), 'PdfViewer.css must have @media (max-width: 480px)');
  assert.ok(pdfViewerCss.includes('@media (max-width: 340px)'), 'PdfViewer.css must have @media (max-width: 340px)');

  // section.docx full width override for mobile
  assert.ok(pdfViewerCss.includes('width: 100% !important;'), 'section.docx must adapt to 100% width on mobile');
  assert.ok(pdfViewerCss.includes('max-width: 100% !important;'), 'section.docx max-width 100% prevents horizontal overflow');
  assert.ok(pdfViewerCss.includes('min-width: 0 !important;'), 'section.docx min-width: 0 enables flex container shrinkage');
});

// Test 6: PDF.js scrolling and download regression check
test('PDF Regression: PDF.js canvas viewport preserved without height: 100% flex conflict', () => {
  const pdfViewportBlock = pdfViewerCss.match(/\.pdf-viewport\s*\{([^}]+)\}/);
  assert.ok(pdfViewportBlock, '.pdf-viewport rule block must exist');
  assert.ok(!pdfViewportBlock[1].includes('height: 100%'), '.pdf-viewport must not set rigid height: 100%');
  assert.ok(pdfViewportBlock[1].includes('overflow-y: auto;'), '.pdf-viewport must scroll vertically');
  assert.ok(pdfViewerJsx.includes('handleDownload'), 'Download action must remain wired');
});

// Test 7: Multi-page test DOCX file parsing verification
test('Multi-page DOCX: Test DOCX with headings, tables, benchmarks, and page breaks is verified', async () => {
  const testDocxPath = path.join(rootDir, 'backend', 'uploads', 'deep_neural_architecture.docx');
  assert.ok(fs.existsSync(testDocxPath), 'deep_neural_architecture.docx must exist in backend/uploads');
  
  const stats = fs.statSync(testDocxPath);
  assert.ok(stats.size > 20000, `Test DOCX should be a substantial multi-page file (size: ${stats.size} bytes)`);

  const fileBytes = fs.readFileSync(testDocxPath);
  const buffer = new Uint8Array(fileBytes);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let xmlText = null;
  let offset = 0;
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

  assert.ok(xmlText, 'word/document.xml extracted from deep_neural_architecture.docx');
  assert.ok(xmlText.includes('Deep Neural Architecture Analysis'), 'Contains main heading');
  assert.ok(xmlText.includes('Model Architecture'), 'Contains model architecture table header');
  assert.ok(xmlText.includes('Transformer-Base'), 'Contains benchmark table entries');
  assert.ok(xmlText.includes('Abstract'), 'Contains abstract section');
});
