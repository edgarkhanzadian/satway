const testFile = '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-import-apps-in-packages',
      severity: 'error',
      comment: 'Packages should not import apps. Apps should import packages.',
      from: { path: '^packages' },
      to: { path: '^apps' },
    },
    {
      name: 'core-is-ui-free',
      severity: 'error',
      comment:
        'packages/core is pure logic: no React, no DOM-only or wallet UI modules, no other workspace packages.',
      from: { path: '^packages/core/' },
      to: {
        path: [
          'node_modules/react/',
          'node_modules/react-dom/',
          'node_modules/@types/react/',
          'node_modules/@types/react-dom/',
          'node_modules/@stacks/connect/',
          'node_modules/@fontsource',
          '^react(?:-dom)?(?:/|$)',
          '^(?:apps|scripts)/',
          '^packages/(?!core/)',
        ],
      },
    },
    {
      name: 'no-imports-between-apps',
      severity: 'error',
      comment: 'apps/api and apps/web are deployed separately and must not import each other.',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'core-only-through-its-entry',
      severity: 'error',
      comment: 'Outside packages/core, import @stxonector/core through its package entry only.',
      from: { path: '^(?:apps|scripts)/' },
      to: { path: '^packages/core/', pathNot: '^packages/core/src/index[.]ts$' },
    },
    {
      name: 'styled-system-only-in-web',
      severity: 'error',
      comment:
        'The generated Panda styled-system (apps/web/stxonector-styles) is for apps/web only. Nothing else may import it.',
      from: { pathNot: '^apps/web/' },
      to: { path: '(^|/)stxonector-styles(/|$)' },
    },
    {
      name: 'panda-preset-is-standalone',
      severity: 'error',
      comment:
        'packages/panda-preset holds design values only: it may import its own files and Panda, nothing from apps or other workspace packages.',
      from: { path: '^packages/panda-preset/' },
      to: { pathNot: ['^packages/panda-preset/', 'node_modules/@pandacss/'] },
    },
    {
      name: 'panda-preset-only-through-panda-config',
      severity: 'error',
      comment:
        'App code uses the generated stxonector-styles modules. The preset itself is loaded by panda.config.ts only.',
      from: { path: '^apps/', pathNot: '^apps/web/panda[.]config[.]ts$' },
      to: { path: '^packages/panda-preset/' },
    },
    {
      name: 'no-raw-css-in-web',
      severity: 'error',
      comment:
        'apps/web is styled through Panda. The only stylesheets it imports are src/app.css (the Panda entry) and Fontsource font files.',
      from: { path: '^apps/web/src/' },
      to: {
        path: '[.]css$',
        pathNot: ['^apps/web/src/app[.]css$', 'node_modules/@fontsource(-variable)?/'],
      },
    },
    {
      name: 'nothing-imports-scripts',
      severity: 'error',
      comment: 'scripts/ are entry points. Code outside scripts/ must not import them.',
      from: { pathNot: '^scripts/' },
      to: { path: '^scripts/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'This dependency is part of a circular relationship. You might want to revise ' +
        'your solution (i.e. use dependency inversion, make sure the modules have a single responsibility) ',
      from: {},
      to: {
        circular: true,
        dependencyTypesNot: ['type-only'],
        viaOnly: { dependencyTypesNot: ['type-only'] },
      },
    },
    {
      name: 'no-orphans',
      comment:
        "This is an orphan module - it's likely not used (anymore?). Either use it or " +
        "remove it. If it's logical this module is an orphan (i.e. it's a config file), " +
        'add an exception for it in your dependency-cruiser configuration. By default ' +
        'this rule does not scrutinize dot-files (e.g. .eslintrc.js), TypeScript declaration ' +
        'files (.d.ts), tsconfig.json and some of the babel and webpack configs.',
      severity: 'error',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$',
          '[.]d[.]ts$',
          '(^|/)tsconfig[.]json$',
          '(^|/)(?:babel|webpack|postcss)[.]config[.](?:js|cjs|mjs|ts|cts|mts|json)$',
        ],
      },
      to: {},
    },
    {
      name: 'no-deprecated-core',
      comment:
        'A module depends on a node core module that has been deprecated. Find an alternative - these are ' +
        "bound to exist - node doesn't deprecate lightly.",
      severity: 'warn',
      from: {},
      to: {
        dependencyTypes: ['core'],
        path: [
          '^v8/tools/codemap$',
          '^v8/tools/consarray$',
          '^v8/tools/csvparser$',
          '^v8/tools/logreader$',
          '^v8/tools/profile_view$',
          '^v8/tools/profile$',
          '^v8/tools/SourceMap$',
          '^v8/tools/splaytree$',
          '^v8/tools/tickprocessor-driver$',
          '^v8/tools/tickprocessor$',
          '^node-inspect/lib/_inspect$',
          '^node-inspect/lib/internal/inspect_client$',
          '^node-inspect/lib/internal/inspect_repl$',
          '^async_hooks$',
          '^punycode$',
          '^domain$',
          '^constants$',
          '^sys$',
          '^_linklist$',
          '^_stream_wrap$',
        ],
      },
    },
    {
      name: 'not-to-deprecated',
      comment:
        'This module uses a (version of an) npm module that has been deprecated. Either upgrade to a later ' +
        'version of that module, or find an alternative. Deprecated modules are a security risk.',
      severity: 'warn',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      comment:
        "This module depends on an npm package that isn't in the 'dependencies' section of your package.json. " +
        "That's problematic as the package either (1) won't be available on live (2 - worse) will be " +
        'available on live with an non-guaranteed version. Fix it by adding the package to the dependencies ' +
        'in your package.json.',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-unresolvable',
      comment:
        "This module depends on a module that cannot be found ('resolved to disk'). If it's an npm " +
        'module: add it to your package.json. In all other cases you likely already know what to do.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-duplicate-dep-types',
      comment:
        "Likely this module depends on an external ('npm') package that occurs more than once " +
        'in your package.json i.e. bot as a devDependencies and in dependencies. This will cause ' +
        'maintenance problems later on.',
      severity: 'warn',
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'not-to-spec',
      comment:
        'This module depends on a spec (test) file. The sole responsibility of a spec file is to test code. ' +
        "If there's something in a spec that's of use to other modules, it doesn't have that single " +
        'responsibility anymore. Factor it out into (e.g.) a separate utility/ helper or a mock.',
      severity: 'error',
      from: {},
      to: { path: testFile },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        "This module depends on an npm package from the 'devDependencies' section of your " +
        'package.json. It looks like something that ships to production, though. To prevent problems ' +
        "with npm packages that aren't there on production declare it (only!) in the 'dependencies'" +
        'section of your package.json. If this module is development only - add it to the ' +
        'from.pathNot re of the not-to-dev-dep rule in the dependency-cruiser configuration',
      from: { path: '^(?:packages|apps)/[^/]+/src/', pathNot: [testFile] },
      to: {
        dependencyTypes: ['npm-dev'],
        dependencyTypesNot: ['type-only'],
        pathNot: ['node_modules/@types/'],
      },
    },
    {
      name: 'optional-deps-used',
      severity: 'info',
      comment:
        'This module depends on an npm package that is declared as an optional dependency ' +
        "in your package.json. As this makes sense in limited situations only, it's flagged here. " +
        "If you're using an optional dependency here by design - add an exception to your" +
        'dependency-cruiser configuration.',
      from: {},
      to: { dependencyTypes: ['npm-optional'] },
    },
    {
      name: 'peer-deps-used',
      comment:
        'This module depends on an npm package that is declared as a peer dependency ' +
        'in your package.json. This makes sense if your package is e.g. a plugin, but in ' +
        'other cases - maybe not so much. If the use of a peer dependency is intentional ' +
        'add an exception to your dependency-cruiser configuration.',
      severity: 'warn',
      from: {},
      to: { dependencyTypes: ['npm-peer'] },
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules', '[.]pnpm-store', '^apps/web/stxonector-styles/'],
    },
    exclude: {
      path: [
        '^apps/web/dist/',
        '^apps/web/dist-preview/',
        '^apps/web/preview/',
        '^apps/api/[.]wrangler/',
        '^[.]proofs/',
        '(^|/)[.]env',
        '^packages/eslint-config/',
        '^packages/prettier-config/',
        '^packages/tsconfig-config/',
        '^[.]prettierrc[.]js$',
        '^[.]dependency-cruiser[.]cjs$',
        '^eslint[.]config[.]js$',
      ],
    },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
      archi: {
        collapsePattern:
          '^(?:packages|src|lib(s?)|app(s?)|bin|test(s?)|spec(s?))/[^/]+|node_modules/(?:@[^/]+/[^/]+|[^/]+)',
      },
      text: { highlightFocused: true },
    },
  },
};
