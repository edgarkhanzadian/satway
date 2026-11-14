import { RuleTester } from 'eslint';
import { describe, it } from 'node:test';
import tseslint from 'typescript-eslint';

import { noCommentsRule } from './no-comments.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const comment = { messageId: 'comment' };

ruleTester.run('no-comments', noCommentsRule, {
  valid: [
    'const a = 1;',
    '#!/usr/bin/env node\nconst a = 1;',
    '// eslint-disable-next-line no-console -- reason\nconsole.log(1);',
    'console.log(1); // eslint-disable-line no-console',
    '/* eslint-disable no-console */\nconsole.log(1);\n/* eslint-enable no-console */',
    '// @ts-expect-error -- reason\nconst a: string = 1;',
    '/// <reference types="vite/client" />\nconst a = 1;',
    'const s = "// not a comment";',
    'const el = <div>{"text"}</div>;',
  ],
  invalid: [
    { code: '// note\nconst a = 1;', errors: [comment] },
    { code: 'const a = 1; // note', errors: [comment] },
    { code: '/* note */ const a = 1;', errors: [comment] },
    { code: '/**\n * Docs.\n */\nexport function f() {}', errors: [comment] },
    { code: 'const el = <div>{/* note */}</div>;', errors: [comment] },
    { code: '// @ts-ignore\nconst a: string = 1;', errors: [comment] },
    { code: '// @ts-nocheck\nconst a = 1;', errors: [comment] },
    { code: '/* global window */\nconst a = 1;', errors: [comment] },
    { code: '/* eslint no-console: "off" */\nconst a = 1;', errors: [comment] },
    { code: '// eslint-disabled\nconst a = 1;', errors: [comment] },
    { code: '/// just three slashes\nconst a = 1;', errors: [comment] },
    { code: '// one\n// two\nconst a = 1;', errors: [comment, comment] },
  ],
});
