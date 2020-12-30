var gulp             = require("gulp");
var path             = require('path');
var runSequence      = require("run-sequence");
var paths            = require("../paths");
var rollup           = require("rollup").rollup;
var alias            = require("@rollup/plugin-alias");
var resolve          = require("@rollup/plugin-node-resolve").default;
var rollupMultiEntry = require("@rollup/plugin-multi-entry");
var rollupBabel      = require("@rollup/plugin-babel").default;
var camelCase        = require("camelcase");
var pkg              = require('../../package.json');

var jsName           = paths.packageName + '.js';
var root             = path.join(__dirname, '../..')

gulp.task("rollup", function(done) {
    rollup({
        input:   paths.source,
        external: Object.keys(pkg.jspm.dependencies),
        plugins: [
            rollupMultiEntry(),
            rollupBabel({ babelHelpers: 'bundled' }),
            alias({
                entries: [
                    { find: '@', replacement: path.resolve(root, 'src') },
                    { find: 'validate', replacement: path.resolve(root, 'src') },
                ]
            }),            
            resolve()            
        ]
    })
    .then(function(bundle) {
        var moduleTypes = ["amd", "cjs", "es", "iife", "system", "umd"];
        moduleTypes.forEach(function(moduleType){
            bundle.write({
                file:       paths.output + moduleType + '/' + jsName,
                format:     moduleType,
                name: camelCase(paths.packageName)
            });
        }); 
        console.log('Build complete');
    })
    .catch(function(err) {
        console.log('rollup error');
        console.log(err);
    })
    .then(done, done);
});

gulp.task('build', function(callback) {
  return runSequence(
    'clean',
    'rollup',
    callback
  );
});
