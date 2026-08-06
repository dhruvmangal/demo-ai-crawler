const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const { generateIcons } = require('./icon-gen');

const watch = process.argv.includes('--watch');
const outdir = path.join(__dirname, 'dist');

fs.mkdirSync(outdir, { recursive: true });

for (const file of ['manifest.json', 'sidepanel.html', 'theme.css']) {
  fs.copyFileSync(path.join(__dirname, 'public', file), path.join(outdir, file));
}

generateIcons(
  path.join(outdir, 'icons', 'icon128.png'),
  path.join(outdir, 'icons', 'icon48.png'),
  path.join(outdir, 'icons', 'icon16.png'),
  fs,
  path
);

const buildOptions = {
  entryPoints: {
    background: path.join(__dirname, 'src', 'background.ts'),
    sidepanel: path.join(__dirname, 'src', 'sidepanel.ts')
  },
  outdir,
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  minify: !watch,
  sourcemap: watch,
  logLevel: 'info'
};

async function run() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('esbuild watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    console.log(`Extension built to ${outdir}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
