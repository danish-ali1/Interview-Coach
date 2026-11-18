import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { chunkResume } from '../../src/services/chunker.js';
import { detectKind, extractResumeText } from '../../src/services/resume.parser.js';
import { SAMPLE_RESUME } from '../helpers.js';

const fixture = (name) => ({
  buffer: fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url)),
  mimetype: 'application/pdf',
  originalname: name,
});

// Real PDFs produced by different tools (Chromium/Skia like Google Docs and "Save as PDF",
// LibreOffice like Word exports, and two ReportLab layouts).
const VALID_PDFS = ['reportlab.pdf', 'reportlab-plain.pdf', 'chromium.pdf', 'libreoffice.pdf'];

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return err.code;
  }
  return null;
};

describe('detectKind', () => {
  it('trusts magic bytes over the declared type', () => {
    assert.equal(detectKind(Buffer.from('%PDF-1.7 ...'), { mimetype: 'text/plain', originalname: 'x.txt' }), 'pdf');
    assert.equal(detectKind(Buffer.from('plain words'), { mimetype: 'application/pdf', originalname: 'x.pdf' }), null);
  });

  it('accepts text files and rejects binary data', () => {
    assert.equal(detectKind(Buffer.from('hello'), { mimetype: 'text/plain', originalname: 'cv.txt' }), 'text');
    assert.equal(detectKind(Buffer.from('hello'), { mimetype: 'application/octet-stream', originalname: 'cv.md' }), 'text');
    assert.equal(detectKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), { mimetype: 'text/plain', originalname: 'cv.txt' }), null);
  });
});

describe('extractResumeText: text files', () => {
  it('extracts text from a .txt resume', async () => {
    const text = await extractResumeText({ buffer: Buffer.from(SAMPLE_RESUME), mimetype: 'text/plain', originalname: 'cv.txt' });
    assert.match(text, /EXPERIENCE/);
    assert.match(text, /Interview Coach/);
  });

  it('rejects files with too little text with a helpful code', async () => {
    assert.equal(
      await codeOf(extractResumeText({ buffer: Buffer.from('too short'), mimetype: 'text/plain', originalname: 'cv.txt' })),
      'RESUME_TOO_SHORT',
    );
  });

  it('rejects unsupported files', async () => {
    assert.equal(
      await codeOf(extractResumeText({ buffer: Buffer.from([1, 2, 0, 3]), mimetype: 'application/zip', originalname: 'x.zip' })),
      'UNSUPPORTED_FILE_TYPE',
    );
  });
});

describe('extractResumeText: real PDFs', () => {
  for (const name of VALID_PDFS) {
    it(`reads ${name} and keeps headings on their own lines so sections can be detected`, async () => {
      const text = await extractResumeText(fixture(name));
      assert.match(text, /Node\.js/);
      assert.match(text, /^EXPERIENCE$/m);
      const sections = new Set(chunkResume(text).map((c) => c.section));
      assert.ok(sections.has('experience'), `sections found: ${[...sections]}`);
      assert.ok(sections.has('projects'), `sections found: ${[...sections]}`);
    });
  }

  it('REGRESSION: every ordered pair of different PDFs parses correctly in one process', async () => {
    // The `pdf-parse` package kept global state between calls: after parsing one PDF, certain other
    // valid PDFs failed with "bad XRef entry" / "Illegal character". Which pairs broke depended on the
    // files, and parsing any single file alone always worked, so only a long-running process (a real
    // server) exposed it. Checking every ordered pair keeps this test able to fail.
    // `reportlab-lines.pdf` is one of the files that triggered the original failure.
    const all = [...VALID_PDFS, 'reportlab-lines.pdf'];
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(String(reason?.message ?? reason));
    process.on('unhandledRejection', onUnhandled);
    try {
      for (const first of all) {
        for (const second of all) {
          if (first === second) continue;
          for (const name of [first, second]) {
            const text = await extractResumeText(fixture(name));
            assert.ok(text.length >= 200, `${name} returned too little text after parsing ${first}`);
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100)); // let any stray async work surface
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    assert.deepEqual(unhandled, []);
  });

  it('parses concurrent uploads correctly', async () => {
    const results = await Promise.all(VALID_PDFS.map((name) => extractResumeText(fixture(name))));
    assert.ok(results.every((t) => /Node\.js/.test(t)));
  });

  it('tells the user when a PDF is password protected', async () => {
    assert.equal(await codeOf(extractResumeText(fixture('encrypted.pdf'))), 'RESUME_PASSWORD_PROTECTED');
  });

  it('reports a damaged PDF as unreadable, and later uploads still work', async () => {
    assert.equal(await codeOf(extractResumeText(fixture('truncated.pdf'))), 'RESUME_UNREADABLE');
    assert.equal(
      await codeOf(
        extractResumeText({ buffer: Buffer.from('%PDF-1.4 this is not really a pdf'), mimetype: 'application/pdf', originalname: 'x.pdf' }),
      ),
      'RESUME_UNREADABLE',
    );
    // A failed parse must not poison the next request.
    assert.match(await extractResumeText(fixture('chromium.pdf')), /Node\.js/);
  });

  it('does not modify or detach the uploaded buffer', async () => {
    const file = fixture('chromium.pdf');
    const before = file.buffer.length;
    await extractResumeText(file);
    assert.equal(file.buffer.length, before);
    assert.equal(file.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  });
});
