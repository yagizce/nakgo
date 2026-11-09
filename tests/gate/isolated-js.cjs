'use strict';
// Browser scripts get test fixtures, never the Node test runner's authority.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const runtime = process.env.NAKGO_UNIT_RUNTIME;
if (!runtime || !path.isAbsolute(runtime)) throw Error('Missing trusted unit runtime path');
const dependencies = path.join(runtime, 'node_modules');
require(path.join(dependencies, 'ses'));
const {parse} = require(path.join(dependencies, 'acorn'));
// The fixture checks Turkish number formatting. The runner's locale is public.
lockdown({localeTaming: 'unsafe'});

function bindings(pattern) {
  if (pattern.type === 'Identifier') return [pattern.name];
  if (pattern.type === 'AssignmentPattern') return bindings(pattern.left);
  if (pattern.type === 'RestElement') return bindings(pattern.argument);
  if (pattern.type === 'ArrayPattern') return pattern.elements.filter(Boolean).flatMap(bindings);
  return pattern.properties.flatMap(p => bindings(p.type === 'Property' ? p.value : p));
}

function scriptBindings(source) {
  return parse(source, {ecmaVersion: 'latest'}).body.flatMap(node => {
    if (node.type === 'VariableDeclaration') {
      return node.declarations.flatMap(d => bindings(d.id).map(name => [name, node.kind !== 'const']));
    }
    return ['FunctionDeclaration', 'ClassDeclaration'].includes(node.type) ? [[node.id.name, true]] : [];
  });
}

function compartment(fixtures) {
  class Clock extends Date {}
  Object.defineProperty(Clock, 'now', {value: () => Date.now(), writable: true});
  const realm = new Compartment({globals: {Date: Clock, Math}, __options__: true});
  const global = realm.globalThis;
  const initial = new Set(Reflect.ownKeys(global));
  for (const key of Object.keys(fixtures)) {
    Object.defineProperty(global, key, {configurable: true, enumerable: true,
      get: () => fixtures[key], set: value => { fixtures[key] = value; }});
  }
  return {
    start(source) {
      // Classic scripts share lexical state. Expose only their own top-level
      // bindings to subsequent test expressions inside this compartment.
      const names = new Map(scriptBindings(source));
      const slots = [...names].map(([name, writable]) =>
        `[${JSON.stringify(name)}]:{get:()=>${name}${writable ? `,set:__value=>{${name}=__value;}` : ''},configurable:true}`);
      const declarations = realm.evaluate(`(function(){\n${source}\n;return {${slots.join(',')}};\n})`).call(global);
      Object.defineProperties(global, declarations);
      for (const key of Object.getOwnPropertyNames(global)) {
        if (initial.has(key) || Object.hasOwn(fixtures, key)) continue;
        Object.defineProperty(fixtures, key, {get: () => global[key], set: value => { global[key] = value; }});
      }
    },
    evaluate(source) { return realm.evaluate(source); }
  };
}

const processFixture = Object.freeze({env: Object.freeze({})});

function esm(source, imports = {}) {
  const exports = [], stripped = [];
  for (const node of parse(source, {ecmaVersion: 'latest', sourceType: 'module'}).body) {
    if (!node.type.startsWith('Export') && node.type !== 'ImportDeclaration') continue;
    if (node.type === 'ImportDeclaration' && Object.hasOwn(imports, node.source.value) &&
        node.specifiers.length === 1 && node.specifiers[0].type === 'ImportDefaultSpecifier') {
      stripped.push([node.start, node.end, `const ${node.specifiers[0].local.name} = __imports[${JSON.stringify(node.source.value)}];`]);
      continue;
    }
    const declaration = node.declaration;
    if (node.type === 'ExportNamedDeclaration' && declaration?.type === 'VariableDeclaration') {
      exports.push(...declaration.declarations.flatMap(d => bindings(d.id)));
    } else if (['ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(node.type) &&
        declaration?.type === 'FunctionDeclaration' && declaration.id) {
      const name = declaration.id.name;
      exports.push(`${node.type === 'ExportDefaultDeclaration' ? 'default' : name}:${name}`);
    } else {
      throw Error('Unexpected fixture module shape');
    }
    stripped.push([node.start, declaration.start, '']);
  }
  for (const [start, end, replacement] of stripped.reverse()) source = source.slice(0, start) + replacement + source.slice(end);
  const realm = compartment({process: processFixture, __imports: Object.freeze(imports)});
  return realm.evaluate(`(()=>{${source}\n;return {${exports.join(',')}};})()`);
}

// Isolated Node endpoint tests get only the host operations exercised by the
// fixture, scoped to the synthetic body and the public catalog input.
function whatsapp(root) {
  const directory = path.join(root, 'server', 'whatsapp');
  const catalog = path.join(root, 'src', 'js', 'config.js');
  const cache = new Map();
  const bytes = buffer => {
    const result = Uint8Array.from(buffer);
    Object.defineProperty(result, 'toString', {value: encoding => Buffer.from(result).toString(encoding)});
    return result;
  };
  const safeBuffer = Object.freeze({
    from: (...args) => bytes(Buffer.from(...args)),
    alloc: size => bytes(Buffer.alloc(size)),
    concat: (chunks, size) => bytes(Buffer.concat(chunks, size))
  });
  const digest = hash => Object.freeze({
    update(input) { hash.update(input); return this; },
    digest(encoding) {
      const output = hash.digest(encoding);
      return typeof output === 'string' ? output : bytes(output);
    }
  });
  const builtins = Object.freeze({
    'node:crypto': Object.freeze({
      createHash: name => digest(crypto.createHash(name)),
      createHmac: (name, key) => digest(crypto.createHmac(name, key)),
      timingSafeEqual: crypto.timingSafeEqual
    }),
    'node:path': Object.freeze({join: path.join}),
    'node:fs': Object.freeze({readFileSync(file, encoding) {
      if (file !== catalog || encoding !== 'utf8') throw Error('Unauthorized fixture file');
      return fs.readFileSync(catalog, 'utf8');
    }})
  });
  function load(name) {
    if (!/^[a-z][a-z0-9-]*\.cjs$/.test(name)) throw Error('Unauthorized fixture module');
    if (cache.has(name)) return cache.get(name).exports;
    const module = {exports: {}};
    cache.set(name, module);
    const requireFixture = specifier => {
      if (Object.hasOwn(builtins, specifier)) return builtins[specifier];
      if (typeof specifier !== 'string' || !specifier.startsWith('./')) throw Error('Unauthorized fixture import');
      return load(specifier.slice(2));
    };
    const realm = compartment({module, require: requireFixture, __dirname: directory,
      process: processFixture, Buffer: safeBuffer, URL: harden(URL), Response: harden(Response)});
    realm.evaluate(`(()=>{${fs.readFileSync(path.join(directory, name), 'utf8')}\n})()`);
    return module.exports;
  }
  return {load, endpoint: () => esm(fs.readFileSync(path.join(root, 'api', 'whatsapp', 'webhook.mjs'), 'utf8'), {
    get '../../server/whatsapp/webhook.cjs'() { return load('webhook.cjs'); },
    get '../../server/whatsapp/store.cjs'() { return load('store.cjs'); }
  })};
}

const contexts = new WeakMap();
const vm = {
  createContext(fixtures) { return fixtures; },
  runInContext(source, fixtures) {
    if (contexts.has(fixtures)) return contexts.get(fixtures).evaluate(source);
    const realm = compartment(fixtures);
    contexts.set(fixtures, realm);
    return realm.start(source);
  },
  runInNewContext(source, fixtures) { return compartment(fixtures).start(source); }
};

module.exports = {compartment, vm, authConfig: esm, whatsapp};
