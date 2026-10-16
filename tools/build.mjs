/**
 * 构建：把 src/engine.js + src/game.js 内联进 src/template.html，
 * 产出单个可直接双击运行、完全离线的 HTML 文件。
 *
 *   node tools/build.mjs
 *
 * 说明：
 *   - 两段模块分别包在 IIFE 里，避免共用全局作用域时变量重名。
 *   - 每段源码同时写入一个 window.__LT_*_SRC__ 字符串常量（内容与真正执行的
 *     代码逐字符相同），供 tools/verify.mjs 做「产物 == 源码」的一致性校验。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(root, '同类项三消.html');
// GitHub Pages 入口：用 ASCII 文件名，线上地址干净（中文名在 URL 里会被编码成长串）
const outIndex = join(root, 'index.html');

const template = readFileSync(join(root, 'src/template.html'), 'utf8');
const engine = readFileSync(join(root, 'src/engine.js'), 'utf8');
const game = readFileSync(join(root, 'src/game.js'), 'utf8');

/** 去掉只给 Node 用的 ESM 导出语句，其余代码原样保留 */
const stripExports = (src) =>
  src.replace(/^export\s+default\s+[\s\S]*?;\s*$/m, '').replace(/^export\s+/gm, '');

const engineInline = stripExports(engine);
const gameInline = stripExports(game);

/** 把源码嵌进 JSON 字符串，避免任何转义问题 */
const asStringLiteral = (src) => JSON.stringify(src);

const scriptBlock = (name, src, label) =>
  '<script>\n' +
  '/* ===== ' + name + '：' + label + ' ===== */\n' +
  'window.__LT_SRC__ = window.__LT_SRC__ || {};\n' +
  'window.__LT_SRC__[' + JSON.stringify(name) + '] = ' + asStringLiteral(src) + ';\n' +
  '(function () {\n' +
  src +
  '\n})();\n' +
  '</script>';

// 注意：必须用「函数形式」的 replace。
// 如果用字符串形式，源代码里的 `$$`、`$&` 会被当成替换模板转义（会把 const $$ 变成 const $）。
const html = template
  .replace('<!-- ENGINE_SCRIPT -->', () =>
    scriptBlock('engine.js', engineInline, '数学与发牌逻辑，每副牌都经过可解性验证')
  )
  .replace('<!-- GAME_SCRIPT -->', () => scriptBlock('game.js', gameInline, '界面与交互'));

const banner =
  '<!--\n' +
  '  同类项·三消 —— 初中数学「合并同类项」课堂小游戏\n' +
  '  单文件版：双击即可在 Windows / macOS 上用浏览器打开，无需联网、无需安装。\n' +
  '  源码：src/engine.js（数学与发牌）+ src/game.js（界面），由 tools/build.mjs 合并生成。\n' +
  '  改动源码后请重新运行：node tools/build.mjs\n' +
  '-->\n';

const finalHtml = html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + banner.trim());
writeFileSync(out, finalHtml, 'utf8');
writeFileSync(outIndex, finalHtml, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('已生成 ' + out);
console.log('已生成 ' + outIndex + '（线上入口，内容完全一致）');
console.log('  体积 ' + kb + ' KB（样式与脚本全部内联，无外部依赖）');
console.log(
  '  残留检查: export ' +
    (html.match(/^\s*export\s/gm) || []).length +
    ' 处, import ' +
    (html.match(/^\s*import\s/gm) || []).length +
    ' 处'
);
