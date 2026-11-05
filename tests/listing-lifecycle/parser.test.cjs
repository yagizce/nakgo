'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseListings}=require('../../server/whatsapp/review-parser.cjs');
const base='İstanbul yükleme Ankara Tır tenteli 20 ton palet bugün; ';
test('body contact: mobile, landline, no forwarding fallback and ambiguous numbers',()=>{
 for(const [text,expected] of [
  [base+'0532 123 45 67','+905321234567'],
  [base+'+90 (212) 123-45-67','+902121234567'],
  [base+'00905321234567','+905321234567'],
  [base+'Telefon yok',null],
  [base+'05321234567 / 05329999999',null],
  [base+'+447700900123',null],
  [base+'5555555555',null],
  [base+'905321234567','+905321234567']
 ]){const d=parseListings(text)[0];assert.equal(d.fields.contactPhone,expected,text);if(!expected)assert.ok(d.issues.includes('contact_review'));}
});
test('company/name optional; special conditions and ambiguous time stay private',()=>{
 const d=parseListings(base+'05321234567')[0];assert.equal(d.fields.company,null);assert.equal(d.issues.length,0);
 for(const text of [base+'05321234567 yarın',base+'05321234567 araç 2011 model olmalı'])assert.ok(parseListings(text)[0].issues.length>0);
});
test('truck calendar must be explicit and valid; no invented day',()=>{
 const make=date=>parseListings('İstanbul yükleme Ankara boş araç Tır tenteli 20 ton '+date+'; 05321234567')[0];
 assert.equal(make('06.11.2026').fields.availableOn,'2026-11-06');
 assert.equal(make('31.02.2026').fields.availableOn,null);
 assert.ok(make('bugün').issues.includes('truck_calendar_review'));
});
