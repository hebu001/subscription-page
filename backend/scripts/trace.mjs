import { traceNodeModules } from 'nf3';

await traceNodeModules(['./dist/main.js'], { outDir: 'dist' });
