var concat = require('concat-stream');
var EventEmitter = require('events').EventEmitter;
var JSONStream = require('JSONStream');
var multiplex = require('multiplex');
var Promise = require("bluebird");
var reconnect = require('reconnect-engine');
var split2 = require('split2');

//
// regex for sniffing content type for JSON/JSONStream-capable responses
//
var OBJ_MODE_RE = /^application\/json(;.*(parse)(=([^;]+)?)?)?/;

//
// returns an api client with an API that mirrors `endo`
//
module.exports = function (url, options) {
  // TODO: discover ws prefix?
  url = (url || '') + '/ws';
  var client = new EventEmitter();
  var source;

  var connection = reconnect(function (stream) {

    source = multiplex(function (stream, id) {
      //
      // emit channel events for server-initated streams
      //
      client.emit('channel', id, stream);
    });

    source.pipe(stream).pipe(source);

    client.connected = true;
    client.emit('connect');
  });

  client.request = function (context) {
    if (typeof context === 'string') {
      context = { url: context };
    }

    var headersReceived;
    return new Promise(function (resolve, reject) {

      //
      // if not connected defer until connect
      //
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
        .pipe(split2(/(\r?\n)/))
        .on('data', function (data) {
          if (headersReceived) {
            return;
          }

          headersReceived = true;
          stream.removeListener('error', reject);

          var context;
          try {
            context = JSON.parse(data) || {};
          }
          catch (error) {
            return reject(error);
          }

          var headers = context.headers || {};
          var objMode = (headers['content-type'] || '').match(OBJ_MODE_RE);

          //
          // pipe through JSONStream if `stream-parsable` param set
          //
          if (objMode && objMode[2]) {
            context.body = stream.pipe(JSONStream.parse(objMode[4]));
            resolve(context);
          }

          //
          // non-streaming json, collect up body and run through JSON.parse
          //
          else if (objMode) {
            var collect = concat(function (data) {
              try {
                context.body = JSON.parse(data);
                resolve(context);
              }
              catch (error) {
                reject(error);
              }
            });

            stream.once('error', reject).pipe(collect);
          }

          //
          // pass stream along directly
          //
          else {
            context.body = stream;
            resolve(context);
          }
        });

      //
      // initiate request by writing context object as JSON to stream
      //
      stream.write(JSON.stringify(context) + '\n');

    });
  };

  connection.on('error', function (error) {
    console.log('CONN ERR', error);
  })

  connection.on('disconnect', function () {
    source = null;
    client.connected = false;
    client.emit('disconnect');
  });

  // TODO: disconnect/close

  connection.connect(url);

  return client;
};
