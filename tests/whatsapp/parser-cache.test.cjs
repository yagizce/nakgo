'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseListings}=require('../../server/whatsapp/review-parser.cjs');
test('Repeated multi-listing candidates remain separate and carry independent review decisions',()=>{
 const line='İstanbul yükleme Ankara kapalı tır 20 ton palet bugün +90 532 123 45 67';
 const rows=parseListings(Array(25).fill(line).join('\n'));
 assert.equal(rows.length,25);assert.equal(new Set(rows.map(r=>r.fingerprint)).size,1);
 assert.ok(rows.every(r=>r.fields.contactPhone==='+905321234567'));
 rows[0].fields.from.city='mutated';rows[0].issues.push('mutated');
 assert.equal(rows[1].fields.from.city,'İstanbul');assert.ok(!rows[1].issues.includes('mutated'));
});
test('Parser caches never reuse phone/company data across messages or hide overflow',()=>{
 const line='İstanbul yükleme Ankara kapalı tır 20 ton palet bugün';
 assert.equal(parseListings(line+' +90 532 123 45 67')[0].fields.contactPhone,'+905321234567');
 assert.equal(parseListings(line)[0].fields.contactPhone,null);
 const rows=parseListings(Array(31).fill(line).join('\n'));
 assert.equal(rows.length,30);assert.ok(rows.every(r=>r.issues.includes('message_overflow_review')));
});
