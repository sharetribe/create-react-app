/**
 * Refactored from ../../react-dev-utils/getCSSModuleLocalIdent
 * Main difference: both index.css and index.module.css use CSS Modules
 *
 * Copyright (c) 2015-present, Facebook, Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

const loaderUtils = require('loader-utils');

// NOTE: This is otherwise identical to "../../react-dev-utils/getCSSModuleLocalIdent.js",
//       but since we support CSS Modules from any .css files (due to backwards compatibilty)
//       we had to changes the regexp in "fileNameOrFolder" constant.
const getCSSModuleLocalIdent = function sharetribeGetLocalIdent(
  context,
  localIdentName,
  localName,
  options
) {
  // Use the filename or folder name, based on some uses the index.js / index.module.(css|scss|sass) project style
  const fileNameOrFolder = context.resourcePath.match(
    /(index|index\.module)\.(css|scss|sass)$/
  )
    ? '[folder]'
    : '[name]';
  // Create a hash based on a the file location and class name. Will be unique across a project, and close to globally unique.
  const hash = loaderUtils.getHashDigest(
    context.resourcePath + localName,
    'md5',
    'base64',
    5
  );
  // Use loaderUtils to find the file or folder name
  const className = loaderUtils.interpolateName(
    context,
    fileNameOrFolder + '_' + localName + '__' + hash,
    options
  );
  // remove the .module that appears in every classname when based on the file.
  return className.replace('.module_', '_');
};

// CSS options: all CSS files will have CSS Modules turned "on".
const cssOptionsWithModules = cssOptions =>
  Object.assign({}, cssOptions, {
    modules: {
      getLocalIdent: getCSSModuleLocalIdent,
    },
  });

// PostCSS plugins:
// - postcss-import, postcss-apply are our additions
// - postcss-preset-env: we use nesting and custom-media-queries.
// - postcss-custom-properties: preserve is turned off due to load it adds to web inspector
//   in dev environment.
const postcssPlugins = [
  require('postcss-import'),
  require('postcss-apply'),
  require('postcss-flexbugs-fixes'),
  require('postcss-preset-env')({
    autoprefixer: {
      flexbox: 'no-2009',
    },
    features: {
      'nesting-rules': true, // stage 0
      'custom-media-queries': true, // stage 1
      // custom-properties config is moved outside due to a bug:
      // https://github.com/csstools/postcss-preset-env/issues/123
      // 'custom-properties': {
      //   preserve: false, // https://github.com/csstools/postcss-preset-env/issues/37
      // },
    },
    stage: 3,
  }),
  require('postcss-custom-properties')({
    preserve: false,
  }),
];

// Check that webpack.config has known structure.
const checkConfigStructure = config => {
  // First validate the structure of the config to ensure that we mutate
  // the config with the correct assumptions.
  const hasRules =
    config &&
    config.module &&
    config.module.rules &&
    config.module.rules.length === 3;
  const hasOneOf =
    hasRules &&
    config.module.rules[2].oneOf &&
    config.module.rules[2].oneOf.length === 8;
  const hasCssLoader =
    hasOneOf &&
    config.module.rules[2].oneOf[3].test &&
    config.module.rules[2].oneOf[3].test.test('file.css');

  const configStructureKnown = hasRules && hasOneOf && hasCssLoader;

  if (!configStructureKnown) {
    throw new Error(
      'create-react-app config structure changed, please check webpack.config.js and update to use the changed config'
    );
  }

  return configStructureKnown;
};

const applySharetribeConfigs = (config, isEnvProduction) => {
  checkConfigStructure(config);
  const productionBuildOutputMaybe = isEnvProduction
    ? {
        // universal build
        libraryTarget: 'umd',
        // Fix bug on universal build
        // https://github.com/webpack/webpack/issues/6784
        globalObject: `(typeof self !== 'undefined' ? self : this)`,
      }
    : {};
  return config.optimization
    ? Object.assign({}, config, {
        optimization: Object.assign({}, config.optimization, {
          splitChunks: {
            // Don't use chunks yet - we need to create a separate server config/build for that
            cacheGroups: {
              default: false,
            },
          },
          // Don't use chunks yet - we need to create a separate server config/build for that
          runtimeChunk: false,
        }),
        output: Object.assign({}, config.output, productionBuildOutputMaybe),
      })
    : config;
};

module.exports = {
  cssOptionsWithModules,
  postcssPlugins,
  applySharetribeConfigs,
};
