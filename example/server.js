var ecstatic = require('ecstatic');
var endo = require('endo');
var Engine = require('engine.io-stream');
var http = require('http');

var api = endo(require('endo/test/fixtures/api'));
api.includeErrorStack = true;

var assets = ecstatic({ root: __dirname });
var ROOT = '<!DOCTYPE html><script src="/example/client.bundle.js"></script>';

var server = http.createServer(function (req, res) {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(ROOT);
  }

  if (req.url.indexOf('/example/') === 0) {
    req.url = req.url.substring(8);
    return assets(req, res);
  }

  return api.handle(req, res);

}).listen(8001);

var engine = Engine(function(connection) {
  var stream = api.createStream();

  connection.pipe(stream).pipe(connection);

  stream.on('error', function (error) {
    connection.destroy(error);
  });
});

engine.attach(server, '/ws');
