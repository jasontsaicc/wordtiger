import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { renderMarkdown } from '../src/content/markdown.ts';

// 共用既有安全 renderer；隱私政策只使用段落、標題與清單。
const policy = renderMarkdown(await readFile('docs/privacy.md', 'utf8'))
  .replace(/<div class="h">(.*?)<\/div>/g, '<h2>$1</h2>')
  .replace(/^<h2>(.*?)<\/h2>/, '<h1>$1</h1>');
await writeFile('public/privacy.html', `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>隱私政策｜攔詞虎 WordTiger</title>
<style>body{max-width:760px;margin:40px auto;padding:0 24px;font:16px/1.85 system-ui,sans-serif;color:#293340;background:#fffdf8}h2{line-height:1.4;margin-top:2rem}a{color:#9a3412}li{margin:.4rem 0}p{overflow-wrap:anywhere}</style>
</head><body><main>${policy}</main><footer><a href="help.html">操作說明</a> · <a href="https://github.com/jasontsaicc/wordtiger/issues">問題回報</a></footer></body></html>`);
await rm('dist/site', { recursive: true, force: true });
await mkdir('dist/site', { recursive: true });
await cp('site', 'dist/site', { recursive: true });
await cp('docs/images', 'dist/site/images', { recursive: true });
await cp('public/icons/128.png', 'dist/site/icon.png');
await cp('public/privacy.html', 'dist/site/privacy.html');
await cp('public/help.html', 'dist/site/help.html');
console.log('介紹站：dist/site/；擴充功能隱私頁：public/privacy.html');
