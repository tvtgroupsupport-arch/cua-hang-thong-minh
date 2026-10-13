/* Đóng gói src/native/bridge.js (cùng các plugin Capacitor) thành www/native-bridge.js bằng esbuild. Chạy trong `npm run sync` / CI. */
import path from 'node:path';
import { build } from 'esbuild';

await build({
  entryPoints: [path.resolve('src/native/bridge.js')],
  bundle: true, format: 'iife', platform: 'browser', target: ['es2019'], minify: true,
  outfile: path.resolve('www/native-bridge.js'), logLevel: 'info'
});
console.log('✓ www/native-bridge.js');
