var concat = require('concat-stream');
var EventEmitter = require('events').EventEmitter;
var JSONStream = require('JSONStream');
var multiplex = require('multiplex');
var reconnect = require('reconnect-engine');
var through2 = require('through2');

//
// regex for sniffing content type for JSON/JSONStream-capable responses
//
// TODO: would be nicer to associate stream serializations with content types
var OBJ_MODE_RE = /^application\/json(;.*(parse)(=([^;]+)?)?)?/;

function noop() {}

//
// returns an api client with an API that mirrors `endo`
//
module.exports = function (options) {
  options || (options = {});
  if (typeof options === 'string') {
    options = { url: options };
  }

  options.url || (options.url = '');
  options.socketPath = options.url + (options.socketPath || '/ws');
  var baseRange = options.endpointRange || '*';

  var client = new EventEmitter();
  var requestId = 0;
  var requests = {};
  
  function onResponse(body, meta) {

    var response = JSON.parse(meta);
    var request = requests[response.id];

    //
    // skip error response handling, these are handled when emitted on stream
    //
    if (response.error) {
      return request.cb(response.error);
    }

    var headers = response.headers || {};
    var objMode = (headers['content-type'] || '').match(OBJ_MODE_RE);

    //
    // pipe through JSONStream if stream-parsable content-type
    //
    if (objMode && objMode[2]) {
      response.body = body
        .pipe(JSONStream.parse([/./]));

      return request.cb(response);
    }

    //
    // non-streaming json, collect up body and run through JSON.parse
    //
    if (objMode) {
      return body.pipe(concat(function (value) {
        try {
          response.body = JSON.parse(value);
          request.cb(null, response);
        }
        catch (error) {
          request.cb(error);
        }
      }));
    }

    //
    // pass stream along directly
    //
    response.body = body;
    request.cb(response);

  }

  function onConnect(socket) {
    var source = connection.source = multiplex(onResponse)
      .on('error', function (error) {
        client.disconnect();
      });

    source.pipe(socket).pipe(source);

    client.emit('connect', connection);
  }

  var connection = reconnect(onConnect);

  client.request = function (request, cb) {
    if (typeof request === 'string') {
      request = { endpointPath: request };
    }

    //
    // add an id to associate with response steram
    //
    request.id = requestId++;

    //
    // add range prefix to url, intersected with any provided range
    //
    request.endpointRange = (request.endpointRange || '') + ' ' + baseRange;

    //
    // create a new substream for request
    //
    function sendRequest() {
      requests[request.id] = {
        cb: function (err, res) {
          context.handled = true;
          context.cb = noop
          cb(err, res);
        },
        stream: connection.source.createStream(JSON.stringify(request))
      };
    }

    //
    // send immediately if possible, or defer until connected
    //
    if (connection.source) {
      sendRequest();
    }
    else {
      connection.once('connect', function () {
        process.nextTick(function () {
          sendRequest()
        });
      });
    }
  };

  client.disconnect = function () {
    for (var id in requests) {
      requests[id].cb(new Error('Client disconnected'));
    }
    requests = {};
    connection.disconnect();
  };

  connection.on('error', function (error) {
    client.emit('error', error);
  });

  connection.on('disconnect', function () {
    client.emit('disconnect');
  });

  connection.on('reconnect', function () {
    client.emit('reconnect');
  });

  connection.connect(options.socketPath);

  return client;
};
