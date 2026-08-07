/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  // Integration tests boot a real mongod (via mongodb-memory-server), including
  // a single-node replica set for transactions. On slow CI runners that startup
  // can exceed Jest's 5s default (applied to hooks too), so give tests and
  // beforeAll/afterAll hooks a generous ceiling.
  testTimeout: 60000,
  // Source uses NodeNext-style relative imports ending in .js (required by
  // tsconfig's "module": "NodeNext") even though the files on disk are .ts.
  // Jest's resolver doesn't know about that TS-specific convention, so strip
  // the .js before resolution and let ts-jest's transform find the .ts file.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Jest runs on CommonJS regardless of the app's NodeNext module setting.
        // Root tsconfig.json only includes src/**/*.ts and has no explicit
        // "types" array, but ts-jest's inline tsconfig override replaces
        // (rather than merges) that field's inference for test files, so
        // Jest/Node ambient types must be listed explicitly here or `describe`/
        // `it`/`expect` are unresolved for files under tests/.
        tsconfig: {
          module: 'CommonJS',
          moduleResolution: 'Node',
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
