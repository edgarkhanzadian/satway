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
      comment:
        'apps/api and apps/web are deployed separately and must not import each other. apps/e2e has its own, narrower rule below.',
      from: { path: '^apps/([^/]+)/', pathNot: '^apps/e2e/' },
      to: { path: '^apps/([^/]+)/', pathNot: '^apps/$1/' },
    },
    {
      name: 'e2e-uses-only-the-worker-entry',
      severity: 'error',
      comment:
        'apps/e2e runs the real Worker code in-process through its entry apps/api/src/index.ts (the @satway/api package entry) and nothing else in apps/api. It tests the built web app through a browser, so it never imports apps/web.',
      from: { path: '^apps/e2e/' },
      to: { path: '^apps/(?!e2e/)', pathNot: '^apps/api/src/index[.]ts$' },
    },
    {
      name: 'e2e-uses-package-entries-only',
      severity: 'error',
      comment:
        'apps/e2e may use @satway/core and @satway/chains through their package entries only, and no other workspace package.',
      from: { path: '^apps/e2e/' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/core/src/index[.]ts$',
          '^packages/chains/src/index[.]ts$',
          '^packages/chains/src/send/solana/index[.]ts$',
        ],
      },
    },
    {
      name: 'nothing-imports-e2e',
      severity: 'error',
      comment: 'apps/e2e is a test harness. Nothing outside it may import it.',
      from: { pathNot: '^apps/e2e/' },
      to: { path: '^apps/e2e/' },
    },
    {
      name: 'core-only-through-its-entry',
      severity: 'error',
      comment: 'Outside packages/core, import @satway/core through its package entry only.',
      from: { path: '^(?:apps|scripts|packages/(?!core/))' },
      to: { path: '^packages/core/', pathNot: '^packages/core/src/index[.]ts$' },
    },
    {
      name: 'core-shared-imports-nothing-in-core',
      severity: 'error',
      comment:
        'packages/core/src/shared (http, schema, errors, config) is the bottom layer: it imports no other core directory.',
      from: { path: '^packages/core/src/shared/' },
      to: { path: '^packages/core/src/', pathNot: '^packages/core/src/shared/' },
    },
    {
      name: 'core-bitcoin-imports-only-shared',
      severity: 'error',
      comment:
        'packages/core/src/bitcoin knows Bitcoin only: it may import shared, never sBTC, 1Click or a flow directory.',
      from: { path: '^packages/core/src/bitcoin/' },
      to: {
        path: '^packages/core/src/',
        pathNot: ['^packages/core/src/bitcoin/', '^packages/core/src/shared/'],
      },
    },
    {
      name: 'core-sbtc-imports-only-shared-and-bitcoin',
      severity: 'error',
      comment:
        'packages/core/src/sbtc may import shared and bitcoin. It never imports oneclick or a flow directory.',
      from: { path: '^packages/core/src/sbtc/' },
      to: {
        path: '^packages/core/src/',
        pathNot: [
          '^packages/core/src/sbtc/',
          '^packages/core/src/shared/',
          '^packages/core/src/bitcoin/',
        ],
      },
    },
    {
      name: 'core-oneclick-imports-only-shared',
      severity: 'error',
      comment:
        'packages/core/src/oneclick may import shared only. It never imports sbtc, bitcoin or a flow directory.',
      from: { path: '^packages/core/src/oneclick/' },
      to: {
        path: '^packages/core/src/',
        pathNot: ['^packages/core/src/oneclick/', '^packages/core/src/shared/'],
      },
    },
    {
      name: 'core-flows-import-only-base-layers',
      severity: 'error',
      comment:
        'Every packages/core/src directory other than shared, bitcoin, sbtc and oneclick is a flow (deposit today, withdrawal later). A flow may import the base layers and its own files. Flows never import each other.',
      from: { path: '^packages/core/src/(?!(?:shared|bitcoin|sbtc|oneclick)/)([^/]+)/' },
      to: {
        path: '^packages/core/src/',
        pathNot: ['^packages/core/src/$1/', '^packages/core/src/(?:shared|bitcoin|sbtc|oneclick)/'],
      },
    },
    {
      name: 'core-flows-only-from-the-entry',
      severity: 'error',
      comment:
        'Only the package entry packages/core/src/index.ts imports a flow directory from outside it. Base layers are covered by their own rules; this one covers root files and tests.',
      from: {
        path: '^packages/core/(?:src/[^/]+$|test/)',
        pathNot: '^packages/core/src/index[.]ts$',
      },
      to: { path: '^packages/core/src/(?!(?:shared|bitcoin|sbtc|oneclick)/)[^/]+/' },
    },
    {
      name: 'core-directories-through-their-index',
      severity: 'error',
      comment:
        'A packages/core/src directory is imported from outside it only through its index.ts. Files inside a directory import their siblings directly.',
      from: { path: '^packages/core/(src/(?:[^/]+/|[^/]+$)|test/)' },
      to: {
        path: '^packages/core/src/[^/]+/',
        pathNot: ['^packages/core/$1', '^packages/core/src/[^/]+/index[.]ts$'],
      },
    },
    {
      name: 'chains-is-ui-free',
      severity: 'error',
      comment:
        'packages/chains is usable outside a browser UI (a CLI or agent): no React, no Stacks wallet UI, no WalletConnect, no apps, scripts or Panda output, and among workspace packages only the @satway/core entry.',
      from: { path: '^packages/chains/' },
      to: {
        path: [
          'node_modules/react/',
          'node_modules/react-dom/',
          'node_modules/@types/react/',
          'node_modules/@types/react-dom/',
          'node_modules/@stacks/connect/',
          'node_modules/@walletconnect/',
          'node_modules/@reown/',
          'node_modules/@fontsource',
          '^react(?:-dom)?(?:/|$)',
          '^@stacks/connect(?:/|$)',
          '^@(?:walletconnect|reown)/',
          '(^|/)satway-styles(/|$)',
          '^(?:apps|scripts)/',
          '^packages/(?!chains/|core/src/index[.]ts$)',
        ],
      },
    },
    {
      name: 'chains-only-through-its-entries',
      severity: 'error',
      comment:
        'Outside packages/chains, import @satway/chains through its entries only: the package entry, or @satway/chains/solana for the lazily loaded Solana send code.',
      from: { pathNot: '^packages/chains/' },
      to: {
        path: '^packages/chains/',
        pathNot: [
          '^packages/chains/src/index[.]ts$',
          '^packages/chains/src/send/solana/index[.]ts$',
        ],
      },
    },
    {
      name: 'chains-metadata-does-not-import-send',
      severity: 'error',
      comment:
        'packages/chains/src/metadata (chain families, chain ids, native assets, address checks) is reusable by any flow. It must not import the send directory.',
      from: { path: '^packages/chains/src/metadata/' },
      to: { path: '^packages/chains/src/', pathNot: '^packages/chains/src/metadata/' },
    },
    {
      name: 'chains-solana-send-stays-lazy',
      severity: 'error',
      comment:
        'The Solana send code (packages/chains/src/send/solana) is loaded lazily by the web app through @satway/chains/solana. The rest of the package may only import its types, or the main entry would pull it into the first chunk.',
      from: { path: '^packages/chains/src/', pathNot: '^packages/chains/src/send/solana/' },
      to: { path: '^packages/chains/src/send/solana/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'chains-directories-through-their-index',
      severity: 'error',
      comment:
        'A packages/chains/src directory is imported from outside it only through its index.ts. Files inside a directory import their siblings directly.',
      from: { path: '^packages/chains/src/([^/]+/|[^/]+$)' },
      to: {
        path: '^packages/chains/src/[^/]+/',
        pathNot: ['^packages/chains/src/$1', '^packages/chains/src/[^/]+/index[.]ts$'],
      },
    },
    {
      name: 'chains-solana-through-its-index',
      severity: 'error',
      comment:
        'Inside packages/chains, code outside send/solana reaches it only through send/solana/index.ts (and only for types, see chains-solana-send-stays-lazy).',
      from: { path: '^packages/chains/src/', pathNot: '^packages/chains/src/send/solana/' },
      to: {
        path: '^packages/chains/src/send/solana/',
        pathNot: '^packages/chains/src/send/solana/index[.]ts$',
      },
    },
    {
      name: 'scripts-use-package-entries-only',
      severity: 'error',
      comment:
        'scripts/ may use @satway/core and @satway/chains through their package entries only, and no other workspace package.',
      from: { path: '^scripts/' },
      to: {
        path: '^packages/',
        pathNot: [
          '^packages/core/src/index[.]ts$',
          '^packages/chains/src/index[.]ts$',
          '^packages/chains/src/send/solana/index[.]ts$',
        ],
      },
    },
    {
      name: 'web-nothing-imports-app',
      severity: 'error',
      comment:
        'apps/web/src/app composes the page (main.tsx, app.tsx). It may import everything in the web app; nothing imports it.',
      from: { path: '^apps/web/', pathNot: '^apps/web/src/app/' },
      to: { path: '^apps/web/src/app/' },
    },
    {
      name: 'web-features-do-not-import-each-other',
      severity: 'error',
      comment:
        'A directory under apps/web/src/features never imports another one (any feature, present or future). Features are composed in app/, which passes values and callbacks down.',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: { path: '^apps/web/src/features/', pathNot: '^apps/web/src/features/$1/' },
    },
    {
      name: 'web-ui-is-presentational',
      severity: 'error',
      comment:
        'apps/web/src/ui holds presentational components: it never imports features, app, or the network-reading Solana send code.',
      from: { path: '^apps/web/src/ui/' },
      to: {
        path: ['^apps/web/src/(?:features|app)/', '^packages/chains/src/send/solana/'],
      },
    },
    {
      name: 'web-ui-only-types-from-shared',
      severity: 'error',
      comment:
        'apps/web/src/ui may import types from shared, never its code (the backend client, storage, progress checks).',
      from: { path: '^apps/web/src/ui/' },
      to: { path: '^apps/web/src/shared/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'web-shared-is-the-base',
      severity: 'error',
      comment: 'apps/web/src/shared never imports features, ui or app.',
      from: { path: '^apps/web/src/shared/' },
      to: { path: '^apps/web/src/(?:features|ui|app)/' },
    },
    {
      name: 'web-directories-through-their-index',
      severity: 'error',
      comment:
        'Inside apps/web/src, ui, shared and each feature directory are imported from outside only through their index.ts. Files inside a directory import their siblings directly.',
      from: { path: '^apps/web/src/([^/]+/)' },
      to: {
        path: '^apps/web/src/(?:ui|shared|features/[^/]+)/',
        pathNot: ['^apps/web/src/$1', '^apps/web/src/(?:ui|shared|features/[^/]+)/index[.]ts$'],
      },
    },
    {
      name: 'api-http-and-notifier-are-independent',
      severity: 'error',
      comment:
        'apps/api/src/http (routes, proxy, POST /deposits) and apps/api/src/notifier (scheduled run) never import each other. Both use store/; index.ts wires them.',
      from: { path: '^apps/api/src/(http|notifier)/' },
      to: { path: '^apps/api/src/(?:http|notifier)/', pathNot: '^apps/api/src/$1/' },
    },
    {
      name: 'api-store-is-the-base',
      severity: 'error',
      comment:
        'apps/api/src/store (the KV watch store) imports neither http, notifier nor the entry.',
      from: { path: '^apps/api/src/store/' },
      to: { path: '^apps/api/src/', pathNot: '^apps/api/src/store/' },
    },
    {
      name: 'api-nothing-imports-the-entry',
      severity: 'error',
      comment:
        'apps/api/src/index.ts is the Worker entry. Code under apps/api/src never imports it.',
      from: { path: '^apps/api/src/' },
      to: { path: '^apps/api/src/index[.]ts$' },
    },
    {
      name: 'api-directories-through-their-index',
      severity: 'error',
      comment:
        'An apps/api/src directory is imported from outside it only through its index.ts. Files inside a directory import their siblings directly.',
      from: { path: '^apps/api/(src/(?:[^/]+/|[^/]+$)|test/)' },
      to: {
        path: '^apps/api/src/[^/]+/',
        pathNot: ['^apps/api/$1', '^apps/api/src/[^/]+/index[.]ts$'],
      },
    },
    {
      name: 'styled-system-only-in-web',
      severity: 'error',
      comment:
        'The generated Panda styled-system (apps/web/satway-styles) is for apps/web only. Nothing else may import it.',
      from: { pathNot: '^apps/web/' },
      to: { path: '(^|/)satway-styles(/|$)' },
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
        'App code uses the generated satway-styles modules. The preset itself is loaded by panda.config.ts only.',
      from: { path: '^apps/', pathNot: '^apps/web/panda[.]config[.]ts$' },
      to: { path: '^packages/panda-preset/' },
    },
    {
      name: 'no-raw-css-in-web',
      severity: 'error',
      comment:
        'apps/web is styled through Panda. The only stylesheets it imports are src/app/app.css (the Panda entry) and Fontsource font files.',
      from: { path: '^apps/web/src/' },
      to: {
        path: '[.]css$',
        pathNot: ['^apps/web/src/app/app[.]css$', 'node_modules/@fontsource(-variable)?/'],
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
      path: ['node_modules', '[.]pnpm-store', '^apps/web/satway-styles/'],
    },
    exclude: {
      path: [
        '^apps/web/dist/',
        '^apps/web/dist-preview/',
        '^apps/web/preview/',
        '^apps/api/[.]wrangler/',
        '^apps/e2e/[.]web-build/',
        '^apps/e2e/test-results/',
        '^apps/e2e/playwright-report/',
        '^apps/e2e/blob-report/',
        '^apps/e2e/[.]playwright/',
        '^[.]proofs/',
        '^[.]claude/',
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
