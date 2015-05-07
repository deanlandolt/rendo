var concat = require('concat-stream');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var JSONStream = require('JSONStream');
var multiplex = require('multiplex');
var Promise = require('bluebird');
Promise.longStackTraces(); // TODO: remove
var reconnect = require('reconnect-engine');
var split2 = require('split2');
var through2 = require('through2');

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
  this.socketPath = this.url + (options.socketPath || '/ws');

  this.endpointRange = options.endpointRange || '*';
}

inherits(Rendo, EventEmitter);

Rendo.prototype.connect = function (options) {
  var client = this;

  options || (options = {});
  client.disconnect();

  client.connection = options;
  var socket = client.socket = reconnect();

  //
  // emit connection options on first successful connect
  //
  socket.once('connect', function () {
    client.emit('connection', options);
  });

  socket.on('connect', function (stream) {
    var source = client.source = multiplex({ error: true });

    source.pipe(stream).pipe(source);

    source.on('error', function (error) {
      client.disconnect();
    });

    client.emit('connected');
  });

  socket.on('disconnect', function () {
    client.source = null;
    client.emit('disconnected');
  });

  socket.on('reconnect', function () {
    client.emit('reconnecting');
  });

  socket.on('error', function (error) {
    client.disconnect(error);
  });

  socket.connect(client.socketPath);

  return client;
};

Rendo.prototype.request = function (context) {

  var client = this;
  return new Promise(function (resolve, reject) {

    //
    // defer request until connected
    //
    if (!client.source) {
      return client.once('connected', function () {
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

    var id = context.id = ++requestId;
    var dup = client.source.createStream(JSON.stringify(context));

    function onResponseError(error) {
      cleanup(error);
    }

    dup.on('error', onResponseError);

    function cleanup(error) {
      dup.end();
      error && reject(error)
    }

    function onMetadata(chunk) {
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
      // pipe through JSONStream if stream-parsable content-type
      //
      if (objMode === 'parse') {
        return dup.pipe(through2()).pipe(concat({ encoding: 'string' }, function (value) {
          try {
            resolve(JSON.parse(value));
          }
          catch (error) {
            reject(error);
          }
        }));
      }

      //
      // disconnect error handler for stream -- up to the client
      //
      dup.removeListener('error', onResponseError);
      dup.pause();
      var body = dup.pipe(through2());

      //
      // JSON value response, collect up body and run through JSON.parse
      //
      if (objMode === 'stream') {
        resolve(body.pipe(JSONStream.parse([/./])));
      }

      //
      // pass response body stream along as complete response
      //
      else {
        response.body = body;
        resolve(response);
      }

    }

    dup.once('data', onMetadata);

    //
    // write context metadata to request stream
    //
    dup.write(JSON.stringify(context));

  });
};

Rendo.prototype.disconnect = function (error) {
  this.socket && this.socket.disconnect();
  this.socket = null;
  this.connection && this.emit('connection', null);
  this.connection = null;

  return this;
};

module.exports = Rendo;
