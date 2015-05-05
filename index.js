var concat = require('concat-stream');
var EventEmitter = require('events').EventEmitter;
var JSONStream = require('JSONStream');
var multiplex = require('multiplex');
var Promise = require('bluebird');
var reconnect = require('reconnect-engine');
var split2 = require('split2');
var through2 = require('through2');

//
// regex for sniffing content type for JSON/JSONStream-capable responses
//
var OBJ_MODE_RE = /^application\/json(;.*(parse)(=([^;]+)?)?)?/;

//
// returns an api client with an API that mirrors `endo`
//
module.exports = function (options) {
  options || (options = {});
  if (typeof options === 'string') {
    options = { url: options };
  }

  // TODO: socket path discovery?
  options.url || (options.url = '');
  options.socketPath = options.url + (options.socketPath || '/ws');
  var baseRange = options.endpointRange || '*';

  var client = new EventEmitter();
  var requestId = 0;
  var deferreds = {};
  

  var connection = reconnect(function (socket) {

    function onResponse (stream, meta) {

      var response = JSON.parse(meta);
      var deferred = deferreds[response.id];
      stream.on('error', deferred.reject);

      //
      // skip error response handling, these are handled when emitted on stream
      //
      if (response.error) {
        return;
      }

      var objMode = (response.headers['content-type'] || '').match(OBJ_MODE_RE);

      //
      // pipe through JSONStream if stream-parsable content-type
      //
      if (objMode && objMode[2]) {
        response.body = stream
          .pipe(JSONStream.parse([/./]))
          .on('error', deferred.reject);

        deferred.resolve(response);
      }

      //
      // non-streaming json, collect up body and run through JSON.parse
      //
      else if (objMode) {

        stream.pipe(concat(function (value) {
          try {
            response.body = JSON.parse(value);
            deferred.resolve(response);
          }
          catch (error) {
            deferred.reject(error);
          }
        }));
      }

      //
      // pass stream along directly
      //
      else {
        response.body = stream;
        deferred.resolve(response);
      }

    }

    var source = connection.source = multiplex({ error: true }, onResponse)
      .on('error', function (error) {
        client.disconnect();
      });

    source.pipe(socket).pipe(source);

    client.emit('connect', connection);
  });

  client.request = function (context) {
    if (typeof context === 'string') {
      context = { endpointPath: context };
    }

    //
    // add an id to associate with response steram
    //
    context.id = requestId++;

    //
    // add range prefix to url, intersected with any provided range
    //
    context.endpointRange = (context.endpointRange || '') + ' ' + baseRange;

    return new Promise(function (resolve, reject) {

      //
      // create a new substream for request
      //
      function sendRequest() {
        deferreds[context.id] = {
          resolve: resolve,
          reject: reject,
          request: connection.source.createStream(JSON.stringify(context))
        };
      }

      //
      // send immediately if possible, or defer until connected
      //
      if (connection.source) {
        sendRequest();
      }
      else {
        connection.once('connect', sendRequest);
      }

    });
  };

  client.disconnect = function () {
    for (var id in deferreds) {
      deferreds[id].reject(new Error('Client disconnected'));
    }
    deferreds = {};
    connection.disconnect();
  };

  connection.on('error', function (error) {
    client.disconnect();
    client.emit('error', error);
  });

  connection.on('disconnect', function () {
    client.emit('disconnect');
  });

  connection.on('reconnect', function () {
    client.emit('reconnect');
  });

  // TODO: disconnect/close

  connection.connect(options.socketPath);

  return client;
};
