"use strict";

var _ = require('lodash'),
    utils = require('./utils');


/* Filters */

function merge(req, res, next) {
    var query = req.query || {},
        body = req.body || {};

    req.data = _.defaults(query, body);
    return next();
}

function usage(req, res, next) {
    if (!req.data.url) {
      return res.status(400).send({ "error": "url parameter expected" });
      // remove usage page
      //return res.sendFile(utils.filePath('../public/usage.html'));
    }
    return next();
}


/* Exported functions */

module.exports = {
    merge: merge,
    usage: usage
};
