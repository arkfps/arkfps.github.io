'use strict';

// Node modules.
const fs = require('fs'),
      http2 = require('http2'),
      path = require('path');

// Gulp plugins.
const accessibility = require('gulp-accessibility'),
      atImport = require('postcss-import'),
      autoprefixer = require('autoprefixer'),
      browserSync = require('browser-sync'),
      cssDeclSort = require('css-declaration-sorter'),
      del = require('del'),
      doiuse = require('doiuse'),
      embedSvgImages = require('gulp-embed-svg'),
      execa = require('gulp-execa'),
      ghPages = require('gh-pages'),
      gulp = require('gulp'),
      htmlhint = require('gulp-htmlhint'),
      htmlmin = require('gulp-htmlmin'),
      jsonlint = require('gulp-jsonlint'),
      minimist = require('minimist'),
      postcss = require('gulp-postcss'),
      postcssClean = require('postcss-clean'),
      postcssReporter = require('postcss-reporter'),
      prettyData = require('gulp-pretty-data'),
      revAll = require('gulp-rev-all'),
      size = require('gulp-size'),
      stylelint = require('gulp-stylelint'),
      svgo = require('gulp-svgo'),
      uglify = require('gulp-uglify'),
      uncss = require('uncss'),
      w3cjs = require('gulp-w3cjs');

// Command line options.
const knownOptions = { string: 'env', default: { env: 'development' } };
const options = minimist(process.argv.slice(2), knownOptions);

// Directories.
const srcDir = path.join(__dirname, 'app');
const outDir = path.join(__dirname, 'dist', options.env);
const jekyllBuildDir = path.join(outDir, 'jekyll-build');
const buildDir = path.join(outDir, 'build');
const certsDir = path.join(__dirname, 'test-certs');
const serveDir = path.join(outDir, 'serve');

// Resource patterns.
const cssFiles = ['css/app*.css'];
const jsFiles = ['js/*.js'];
const plantUmlFiles = ['img/figures/*.puml'];
const jsonFiles = ['**/*.json'];
const xmlFiles = ['**/*.xml'];
const svgFiles = ['**/*.svg'];
const htmlFiles = ['**/*.html'];
const otherFiles = [
  '*',
  '!*.{json,xml,svg,html}',
  'img/**/*.{png,jpg}'
];
const filesToWatch = ['app/**/*', '_config.yml', 'gulpfile.js'];

const isWindows = process.platform === 'win32';
let webServer = null;

// Jekyll build.
function jekyllBuild() {
  return execa.exec(
    `bundle exec jekyll build --destination ${jekyllBuildDir} --trace`,
    { env: { JEKYLL_ENV: options.env } });
}
exports['jekyll-build'] = jekyllBuild;

// Jekyll serve.
exports['jekyll-serve'] = execa.task(
  `bundle exec jekyll serve --destination ${jekyllBuildDir}
    --ssl-key ${path.join(path.relative(srcDir, certsDir), 'srv-auth.key')}
    --ssl-cert ${path.join(path.relative(srcDir, certsDir), 'srv-auth.crt')}
    --port 3000 --open-url --trace`,
  { env: { JEKYLL_ENV: options.env } }
);

// Process XML and JSON.
function xmlAndJson() {
  return gulp.src(jsonFiles.concat(xmlFiles),
                  { cwd: jekyllBuildDir, cwdbase: true, dot: true })
    .pipe(prettyData({ type: 'minify' }))
    .pipe(gulp.dest(buildDir))
    .pipe(size({ title: 'xml&json' }));
}

// Process CSS.
function css() {
  return gulp.src(cssFiles, { cwd: jekyllBuildDir, cwdbase: true, dot: true })
    .pipe(postcss([
      atImport,
      autoprefixer,
      uncss.postcssPlugin({
        html: [path.join(jekyllBuildDir, '**', '*.html')],
        htmlroot: jekyllBuildDir
      }),
      postcssClean({ level: 2 }),
      cssDeclSort,
      postcssReporter({ clearReportedMessages: true, throwError: true })
    ]))
    .pipe(gulp.dest(buildDir))
    .pipe(size({ title: 'css' }));
}

// Process JavaScript.
function js() {
  return gulp.src(jsFiles, { cwd: jekyllBuildDir, cwdbase: true, dot: true })
    .pipe(uglify())
    .pipe(gulp.dest(buildDir))
    .pipe(size({ title: 'js' }));
}

// Process SVG.
function svg() {
  return gulp.src(svgFiles, { cwd: jekyllBuildDir, cwdbase: true, dot: true })
    .pipe(svgo({
      multipass: true,
      plugins: [
        { removeViewBox: false },
        { cleanupListOfValues: true },
        { sortAttrs: true },
        { removeDimensions: true },
        {
          removeAttributesBySelector: {
            selector: 'svg',
            attributes: ['style', 'preserveAspectRatio']
          }
        },
        { removeStyleElement: true },
        { removeScriptElement: true },
        { reusePaths: true }
      ]
    }))
    .pipe(gulp.dest(buildDir))
    .pipe(size({ title: 'svg' }));
}

// Process HTML.
function html() {
  return gulp.src(htmlFiles, { cwd: jekyllBuildDir, cwdbase: true, dot: true })
    .pipe(embedSvgImages({ root: buildDir, decodeEntities: true }))
    .pipe(htmlmin({
      collapseBooleanAttributes: true,
      collapseInlineTagWhitespace: true,
      collapseWhitespace: true,
      conservativeCollapse: true,
      decodeEntities: true,
      includeAutoGeneratedTags: false,
      minifyCSS: true,
      // eslint-disable-next-line camelcase
      minifyJS: { output: { quote_style: 3 } },
      preventAttributesEscaping: true,
      processScripts: ['application/ld+json'],
      removeAttributeQuotes: true,
      removeComments: true,
      removeEmptyAttributes: true,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      sortAttributes: true,
      sortClassName: true,
      useShortDoctype: true
    }))
    .pipe(gulp.dest(buildDir))
    .pipe(size({ title: 'html' }));
}


// Generate UML diagrams.
function uml() {
  return gulp.src(plantUmlFiles, { cwd: srcDir, cwdbase: true, dot: true })
    .pipe(execa.stream(file => {
      const format = 'svg';
      const plantuml = isWindows ? 'plantumlc' : 'plantuml';
      file.extname = `.${format}`;
      return {
        input: file.contents,
        command:
          `${plantuml} -t${format} -nometadata -pipe -failfast -nbthreads auto`
      };
    }))
    .pipe(gulp.dest(jekyllBuildDir))
    .pipe(size({ title: 'uml' }));
}

// Copy miscellaneous files.
function copy() {
  return gulp.src(otherFiles,
                  { cwd: jekyllBuildDir, cwdbase: true, dot: true })
    .pipe(gulp.dest(buildDir))
    .pipe(size({ title: 'copy' }));
}

// Revise assets (cache busting).
function revision() {
  return gulp.src('**/*', { cwd: buildDir, cwdbase: true, dot: true })
    .pipe(revAll.revision({
      dontGlobal: [
        /^\/\./gu,  // dot-files
        /^\/favicon/gu,  // favicons
        /^\/apple-touch-icon/gu,  // iOS favicons
        /\/img\/pages/gu,  // images for social sharing and rich snippets
        /\/icn\/feed/gu,  // web feed icons
        /^\/CNAME$/gu  // GitHub Pages custom domain support
      ],
      dontRenameFile: [
        /\.(?:html|txt)$/gu,
        '/sitemap.xml',
        '/news/feed-test.xml',
        '/browserconfig.xml'
      ],
      dontUpdateReference: [
        /\.(?:html|txt)$/gu,
        '/sitemap.xml',
        '/news/feed-test.xml'
      ]
    }))
    .pipe(gulp.dest(serveDir))
    .pipe(size({ title: 'revision' }));
}

// Build.
function clean() {
  return del([outDir]);
}
exports.clean = clean;

const build = gulp.series(jekyllBuild,
                          uml,
                          gulp.parallel(xmlAndJson, css, js, svg, copy),
                          html,
                          revision);
exports.build = build;

const rebuild = gulp.series(clean, build);
exports.rebuild = rebuild;

// Serve local site.
function serve(cb) {
  fs.readFile(path.join(serveDir, '404.html'), (error, pageNotFound) => {
    if (error) return cb(error);
    const serverPort = 3000;
    webServer = browserSync.create();
    webServer.init({
      server: {
        baseDir: serveDir,
        serveStaticOptions: {
          dotfiles: 'allow',  // e.g., ".net.html"
          extensions: ['html', 'xml'],  // serve pages without trailing slash
          fallthrough: true,  // enable 404 error
          redirect: false  // serve home page without trailing slash
        }
      },
      port: serverPort,
      middleware: [
        (req, res, next) => {  // redirect home page to canonical link
          if (req.url !== '/index.html') return next();
          const movedPermanently = 302;
          res.writeHead(movedPermanently, { 'Location': '/' });
          return res.end();
        }
      ],
      https: {
        key: path.join(certsDir, 'srv-auth.key'),
        cert: path.join(certsDir, 'srv-auth.crt')
      },
      httpModule: http2,
      cwd: serveDir,
      callbacks: {
        ready: (ignored, bs) =>
          bs.addMiddleware('*', (req, res) => {  // handle 404 error
            res.write(pageNotFound);
            res.end();
          })
      },
      online: false,
      browser: [
        'firefox',
        isWindows ? 'chrome' : 'google chrome',
        isWindows ? '%LOCALAPPDATA%\\Programs\\Opera\\launcher.exe' : 'opera',
        isWindows ? `microsoft-edge:https://localhost:${serverPort}` : 'safari'
      ],
      reloadOnRestart: true
    });
    return cb();
  });
}

function reloadServer(cb) {
  webServer.reload();
  cb();
}

function watch() {
  return gulp.watch(filesToWatch,
                    { cwd: __dirname },
                    gulp.series(build, reloadServer));
}

exports.serve = gulp.series(build, serve, watch);
exports['serve-clean'] = gulp.series(rebuild, serve);

// Check source code.
function jekyllHyde() {
  return execa.exec('bundle exec jekyll hyde',
                    { env: { JEKYLL_ENV: options.env } });
}
exports['jekyll-hyde'] = jekyllHyde;

function jsonLint() {
  return gulp.src(jsonFiles, { cwd: jekyllBuildDir, cwdbase: true, dot: true })
    .pipe(jsonlint())
    .pipe(jsonlint.reporter())
    .pipe(jsonlint.failAfterError());
}
exports.jsonlint = jsonLint;

function styleLint() {
  return gulp.src(cssFiles, { cwd: jekyllBuildDir, cwdbase: true, dot: true })
    .pipe(stylelint({ reporters: [ { formatter: 'string', console: true } ] }))
    .pipe(postcss([
      doiuse({ browsers: ['defaults'] }),
      postcssReporter({ throwError: true })
    ]));
}
exports.stylelint = styleLint;

function htmlHint() {
  return gulp.src(htmlFiles, { cwd: jekyllBuildDir, cwdbase: true, dot: true })
    .pipe(htmlhint({ htmlhintrc: path.join(__dirname, '.htmlhintrc') }))
    .pipe(htmlhint.reporter())
    .pipe(htmlhint.failAfterError({ suppress: true }));
}
exports.htmlhint = htmlHint;

function w3c() {
  return gulp.src(htmlFiles, { cwd: serveDir, cwdbase: true, dot: true })
    .pipe(w3cjs())
    .pipe(w3cjs.reporter());
}
exports.w3c = w3c;

function a11y() {
  return gulp.src(htmlFiles, { cwd: serveDir, cwdbase: true, dot: true })
    .pipe(accessibility({
      accessibilityLevel: 'WCAG2AAA',
      reportLevels: { notice: false, warning: false, error: true },
      force: true
    }));
}
exports.a11y = a11y;

exports.lint =
  gulp.series(build, jekyllHyde, jsonLint, styleLint, htmlHint, w3c, a11y);

// Deploy.
function publish(cb) {
  if (options.env !== 'production')
    return cb(new Error('Only "production" build can be published.'));

  return ghPages.publish(
    serveDir,
    {
      branch: 'master',
      dotfiles: true,
      remoteUrl: 'https://github.com/psfrolov/psfrolov.github.io.git',
      message: `Website update ${new Date(Date.now()).toLocaleString()}.`
    },
    cb);
}
exports.deploy = gulp.series(clean, build, publish);

// Default task.
exports.default = serve;
