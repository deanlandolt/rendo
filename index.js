var concat = require('concat-stream');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var jsonstream2 = require('jsonstream2');
var multiplex = require('multiplex');
var Promise = require('bluebird');
Promise.longStackTraces(); // TODO: remove
var Readable = require('readable-stream/readable');
var reconnect = require('reconnect-engine');
var split2 = require('split2');
var through2 = require('through2');
var xtend = require('xtend');

//
// regex for sniffing content type for JSON/JSONStream-capable responses
//
// TODO: would be nicer to associate stream serializations with content types
var OBJ_MODE_RE = /^application\/json;.*(parse|stream)/;

var requestId = 0;

//
// returns an api client with an API that mirrors `endo`
//
function Rendo(options) {
  if (!(this instanceof Rendo)) {
    return new Rendo(options);
  }

  options || (options = {});

  this.url = typeof options === 'string' ? options : options.url || '';
  this.socketPath = this.url + (options.socketPath || '');

  this.endpointRange = options.endpointRange || '*';
}

inherits(Rendo, EventEmitter);

Rendo.prototype.connect = function (connection) {
  var client = this;

  connection || (connection = {});
  client.disconnect();

  var socket = client.socket = reconnect();

  socket.on('connect', function (stream) {
    var source = client.source = multiplex({ error: true });

    source.pipe(stream).pipe(source);

    source.on('error', function (error) {
      client.disconnect();
    });

    //
    // emit connection config on first successful connect
    //
    if (!client.connection) {
      client.connection = connection;
      client.emit('connection', connection);
    }

    client.emit('connect');
  });

  function onconnect(stream) {

  }

  socket.on('disconnect', function () {
    client.source = null;
    client.emit('disconnect');
    socket.reconnect = client.reconnect;
  });

  socket.on('reconnect', function () {
    client.emit('reconnect');
  });

  socket.on('error', function (error) {
    client.disconnect(error);
  });

  socket.connect(client.socketPath);

  return client;
};

Rendo.prototype.reconnect = true;

Rendo.prototype.request = function (context) {
  var client = this;
  var connection = this.connection;
  return new Promise(function (resolve, reject) {
    try {

      //
      // defer request until connected
      //
      if (!client.source) {
        return client.once('connect', function () {
          client.request(context).then(resolve, reject);
        })
      }

      //
      // request arg can be a string path
      //
      if (typeof context === 'string') {
        context = { endpointPath: context };
      }

      //
      // add range prefix to url, intersected with any provided range
      //
      context.endpointRange = (context.endpointRange || '') + ' ' + client.endpointRange;

      //
      // add in default headers
      //
      context.headers = xtend(connection.headers, context.headers);

      var id = ++requestId;
      var dup = client.source.createStream(id);

      dup.on('error', cleanup);

      function cleanup(error) {
        dup.destroy(error);
        error && reject(error)
      }

      function onmeta() {

        var chunk = this.read(1);
        if (chunk === null) {
          return this.once('readable', onmeta);
        }

        var meta;
        try {
          meta = JSON.parse(chunk.toString());
        }
        catch (error) {
          return cleanup(error);
        }

        var headers = meta.headers || {};
        var match = (headers['content-type'] || '').match(OBJ_MODE_RE);
        objMode = match ? match[1] : null;

        //
        // JSON value response, collect up body and run through JSON.parse
        //
        if (objMode === 'parse') {
          return dup.pipe(concat({ encoding: 'string' }, function (value) {
            try {
              resolve(JSON.parse(value));
            }
            catch (error) {
              cleanup(error);
            }
          }));
        };

        //
        // pipe through jsonstream2 if stream-parsable content-type
        //
        if (objMode === 'stream') {
          resolve(dup.pipe(through2.obj()).pipe(jsonstream2.parse([/./]))
            .on('error', cleanup)
            .pipe(through2.obj()));
        }

        //
        // pass response body stream along as complete response
        //
        else {
          response.body = dup.pipe(through2());
          resolve(response);
        }

      }

      dup.once('readable', onmeta);

      //
      // write context metadata to request stream
      //
      dup.write(JSON.stringify(context));

    }
    catch (error) {
      this.emit('error', error);
    }
  });
};

Rendo.prototype.disconnect = function (error) {
  this.reconnect = false
  this.socket && this.socket.disconnect();
  this.socket = null;
  this.connection && this.emit('connection', null);
  this.connection = null;

  return this;
};

module.exports = Rendo;
