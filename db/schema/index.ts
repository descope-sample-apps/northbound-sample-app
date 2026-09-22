// Application schema only.
//
// `./legacy` is intentionally NOT re-exported here. See the import rule at the
// top of that file: the simulated legacy credential store is reachable by
// exactly one route handler, over HTTP, and nothing else.
export * from './customers';
export * from './catalog';
export * from './commerce';
export * from './account';
export * from './oauth';
