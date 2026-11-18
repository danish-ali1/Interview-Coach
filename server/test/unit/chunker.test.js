import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chunkResume, detectSection, redactContactInfo } from '../../src/services/chunker.js';
import { SAMPLE_RESUME } from '../helpers.js';

describe('detectSection', () => {
  it('recognises common resume headings', () => {
    assert.equal(detectSection('PROJECTS'), 'projects');
    assert.equal(detectSection('Technical Skills:'), 'skills');
    assert.equal(detectSection('Work Experience'), 'experience');
    assert.equal(detectSection('## Education'), 'education');
    assert.equal(detectSection('Professional Summary'), 'summary');
    assert.equal(detectSection('Certifications'), 'certifications');
  });

  it('does not treat ordinary lines as headings', () => {
    assert.equal(detectSection('I built projects with React'), null);
    assert.equal(detectSection('- Built REST APIs with Node.js'), null);
    assert.equal(detectSection(''), null);
    assert.equal(detectSection('Experience building large distributed systems for many years now'), null);
  });
});

describe('redactContactInfo', () => {
  it('removes emails and phone numbers', () => {
    const out = redactContactInfo('mail jane.doe@example.com or call +1 (415) 555-2671 / +91 98765 43210');
    assert.ok(!out.includes('@'));
    assert.ok(out.includes('[email]'));
    assert.equal((out.match(/\[phone\]/g) ?? []).length, 2);
  });
});

describe('chunkResume', () => {
  const chunks = chunkResume(SAMPLE_RESUME);

  it('keeps each resume section as its own labelled chunk', () => {
    const sections = new Set(chunks.map((c) => c.section));
    for (const expected of ['header', 'summary', 'experience', 'projects', 'skills', 'education']) {
      assert.ok(sections.has(expected), `missing section ${expected}`);
    }
  });

  it('keeps both projects together under the projects section', () => {
    const projects = chunks.filter((c) => c.section === 'projects').map((c) => c.text).join('\n');
    assert.match(projects, /Interview Coach/);
    assert.match(projects, /Expense Tracker/);
  });

  it('strips contact details before anything is embedded', () => {
    const all = chunks.map((c) => c.text).join('\n');
    assert.ok(!all.includes('@example.com'));
    assert.ok(!all.includes('555-2671'));
  });

  it('numbers chunks sequentially and never creates empty ones', () => {
    chunks.forEach((c, i) => {
      assert.equal(c.index, i);
      assert.ok(c.text.trim().length > 0);
    });
  });

  it('splits oversized sections into chunks that respect the size limit', () => {
    const bullets = Array.from({ length: 60 }, (_, i) => `- Implemented feature number ${i} with Node.js and tests`).join('\n');
    const result = chunkResume(`EXPERIENCE\n${bullets}`, { maxChars: 400 });
    assert.ok(result.length > 3);
    for (const c of result) {
      assert.equal(c.section, 'experience');
      assert.ok(c.text.length <= 400 + 80, `chunk too long: ${c.text.length}`); // tail folding may add one short fragment
    }
  });

  it('hard-splits a single very long line instead of producing one giant chunk', () => {
    const result = chunkResume(`PROJECTS\n${'x'.repeat(2500)}`, { maxChars: 900 });
    assert.ok(result.length >= 3);
    assert.ok(result.every((c) => c.text.length <= 1100));
  });

  it('caps the number of chunks', () => {
    const body = Array.from({ length: 200 }, (_, i) => `- Line ${i} ${'word '.repeat(30)}`).join('\n');
    assert.equal(chunkResume(`EXPERIENCE\n${body}`, { maxChars: 300, maxChunks: 10 }).length, 10);
  });

  it('returns nothing for empty text', () => {
    assert.deepEqual(chunkResume('   \n  '), []);
  });
});
