"use strict";

var _ = require('lodash'),
    fs = require('fs-extra'),
    logger = require('winston'),
    path = require('path'),
    squirrel = require('squirrel'),
    utils = require('./utils'),
    async = require('async'),
    rimraf = require("rimraf"),
    touch = require("touch"),

    SCRIPT_FILE = 'scripts/screenshot.js',

    DEF_ENGINE = 'slimerjs',
    DEF_COMMAND = 'slimerjs',
    DEF_FORMAT = 'png';


/* Configurations and options */

function outputFile(options, conf, base64) {
    var format = options.format || DEF_FORMAT;
    return conf.storage + path.sep + base64 + '.' + format;
}

function cliCommand(config) {
    var engine = config.engine || DEF_ENGINE,
        command = config.command || config.commands[engine][process.platform];
    return command || DEF_COMMAND;
}

function cleanupOptions(options, config) {
    var opts = _.omit(options, ['force', 'callback']);
    opts.url = utils.fixUrl(options.url);
    return _.defaults(opts, config.options);
}


/* Image processing */

function minimizeImage(src, dest, cb) {
    var iminModules = [
        'imagemin',
        'imagemin-gifsicle',
        'imagemin-jpegtran',
        'imagemin-optipng',
        'imagemin-svgo'
    ];

    squirrel(iminModules, function(err, Imagemin) {
        var safeCb = function (err) {
            if (err) {
                logger.error(err);
            }
            cb();
        };

        if (err) {
            safeCb(err);
        } else {
            var imin = new Imagemin()
                .src(src)
                .dest(dest)
                .use(Imagemin.jpegtran({progressive: true}))
                .use(Imagemin.optipng({optimizationLevel: 3}))
                .use(Imagemin.gifsicle({interlaced: true}))
                .use(Imagemin.svgo());

            imin.run(safeCb);
        }
    });
}


/* Screenshot capturing runner */

function runCapturingProcess(options, config, outputFile, base64, onFinish) {
    var scriptFile = utils.filePath(SCRIPT_FILE),
        command = cliCommand(config).split(/[ ]+/),
        cmd = _.union(command, [scriptFile, base64, outputFile]),
        opts = {
            timeout: config.timeout
        };

    logger.debug('Options for script: %s, base64: %s', JSON.stringify(options), base64);

    utils.execProcess(cmd, opts, function(error) {
        if (config.compress) {
            minimizeImage(outputFile, config.storage, function() {
                onFinish(error);
            });
        } else {
            onFinish(error);
        }
    });
}

function customScreenshot(opts, config, base64, onFinish){
  var format = opts.format || DEF_FORMAT,
    base = config.storage + path.sep,
    tDir = base + opts.tid,
    fTimestamp = tDir + path.sep + opts.updated,
    filename = opts.section + '_' + opts.updated,
    fullFile = tDir + path.sep + filename + '.' + format;

  var retrieveImageFromSite = function () {
    runCapturingProcess(opts, config, fullFile, base64, function (error) {
      logger.debug('Process finished work: %s', filename);
      return onFinish(fullFile, error);
    });
  };

  var cleanDir = function (done) {
    rimraf(tDir, function(e){ // rm -rf
      if (e) { return done(e); }
      fs.mkdir(tDir, function(e){ // mkdir
        if (e) { return done(e); }
        touch(fTimestamp, {}, done); // touch file for timestamp
      });
    });
  };

  async.waterfall([

    // check for file screenshot
    function(done){
      fs.exists(fullFile, function (exists) {
        if (exists) return done('get_cache');
        done(); // contine
      });
    },

    // check for timestamp file - if last image fetch is updated
    function(done){
      fs.exists(fTimestamp, function (exists) {
        if (exists) return done('new_section');
        done('expired');
      });
    },

  ], function(result){

    switch (result){

      case 'get_cache':
        logger.debug('Screenshot from file storage: %s', fullFile);
        return onFinish(fullFile, null);

      case 'new_section':
        logger.debug('Screenshot from Site [new section]: %s', fullFile);
        return retrieveImageFromSite();

      case 'expired':
        return cleanDir(function(err){
          if (err) {
            logger.warn('Error on clean dir: %s', tDir);
          }

          logger.debug('Screenshot from Site [clean up]: %s', fullFile);
          retrieveImageFromSite();
        });
    }
  });

}

/* External API */

function screenshot(options, config, onFinish) {
    var opts = cleanupOptions(options, config),
      filename = utils.encodeBase64(opts);

    logger.info('Capture site screenshot: %s', options.url);

    if (opts.tid && opts.section && opts.updated){ // custom filename
      return customScreenshot(opts, config, filename, onFinish);
    }

    var file = outputFile(opts, config, filename);

    var retrieveImageFromStorage = function () {
        logger.debug('Take screenshot from file storage: %s', filename);
        onFinish(file, null);
    };

    var retrieveImageFromSite = function () {
      runCapturingProcess(opts, config, file, filename, function (error) {
        logger.debug('Process finished work: %s', filename);
        return onFinish(file, error);
      });
    };

    if (options.force || !config.cache) {
        retrieveImageFromSite();
    } else {
        fs.exists(file, function (exists) {
            if (exists) {
                retrieveImageFromStorage();
            } else {
                retrieveImageFromSite();
            }
        });
    }
}


/* Exported functions */

module.exports = {
    screenshot: screenshot
};
