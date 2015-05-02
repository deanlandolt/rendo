var config = require('endo/test/fixtures/config');
var ecstatic = require('ecstatic');
var endo = require('endo');
var Engine = require('engine.io-stream');
var http = require('http');
var rendo = require('../');

var api = endo(config.api);
api.includeErrorStack = true;

var assets = ecstatic({ root: __dirname + '/../' });
var server = http.createServer(function (req, res) {
  if (/^\/(example|build)\//.test(req.url)) {
    return assets(req, res);
  }

  api.handleRequest(req, res);

}).listen(8001);

var engine = Engine(function(connection) {
  connection.pipe(api.createStream()).pipe(connection);
});

engine.attach(server, '/ws');
