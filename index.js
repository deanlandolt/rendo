var concat = require('concat-stream');
var EventEmitter = require('events').EventEmitter;
var JSONStream = require('JSONStream');
var multiplex = require('multiplex');
var Promise = require("bluebird");
var reconnect = require('reconnect-engine');
var split = require('split');

var JSON_MODE_RE = /^application\/json(;.*(parse)(=([^;]+)?)?)?/;

module.exports = function (url, options) {
  // TODO: discover ws prefix?
  url = (url || '') + '/ws';
  var client = new EventEmitter();
  var source;

  var connection = reconnect(function (stream) {
    source = multiplex(function (stream, id) {
      //
      // emit events for server-initated streams
      //
      client.emit('stream', stream, id);
    });

    source.pipe(stream).pipe(source);
    client.connected = true;
    client.emit('connect');
  });

  client.request = function (context) {
    var headersReceived;

    if (typeof context === 'string') {
      context = { url: context };
    }

    return new Promise(function (resolve, reject) {
      if (!client.connected) {
        return client.once('connect', function () {
          client.request(context).then(resolve, reject);
        });
      }

      //
      // create a new substream for request w/ a unique id
      //
      var stream = source.createStream(Date.now() + ':' + Math.random());

      stream
        .on('error', reject)
        .pipe(split(/(\r?\n)/))
        .on('data', function (data) {
          if (!headersReceived) {
            headersReceived = true;
            stream.removeListener('error', reject);

            try {
              var context = JSON.parse(data);
              var headers = context.headers || {};
              var mode = (headers['content-type'] || '').match(JSON_MODE_RE);

              //
              // pipe through JSONStream if `stream-parsable` param set
              //
              if (mode && mode[2]) {
                context.body = stream.pipe(JSONStream.parse(mode[4]));
              }

              //
              // non-streaming json, collect up body and run through JSON.parse
              //
              else if (mode) {
                context.body = new Promise(function (resolve, reject) {
                  var process = concat(function (data) {
                    try {
                      resolve(JSON.parse(data));
                    }
                    catch (error) {
                      reject(error);
                    }
                  })
                  stream.on('error', reject).pipe(process);
                });
              }

              //
              // pass stream along directly
              //
              else {
                context.body = stream;
              }

              resolve(context);
            }
            catch (error) {
              reject(error);
            }
          }
        });

      //
      // initiate request by writing context object as JSON to stream
      //
      stream.write(JSON.stringify(context) + '\n');

    });
  };

  client.close = function () {
    connection.disconnect();
    client.request = function () {
      throw new Error('Client closed');
    };
    client.emit('close');
    connection.removeListener('disconnect', onDisconnect)
  };

  function onDisconnect() {
    source = null;
    client.connected = false;
    client.emit('disconnect');
  }

  connection.on('disconnect', onDisconnect);
  connection.once('fail', client.close);

  connection.connect(url);

  return client;
};
