// Lets Node import the browser modules, which use absolute paths such as `/shared/tree.js`. A module
// that imports one must do so after this one has run, with `await import(...)`.
import { registerHooks } from 'node:module';

const shared = new URL('../../shared/', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('/shared/')) return next(shared + specifier.slice('/shared/'.length), context);
    return next(specifier, context);
  },
});
