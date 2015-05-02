var concat = require('concat-stream');
var EventEmitter = require('events').EventEmitter;
var JSONStream = require('JSONStream');
var multiplex = require('multiplex');
var Promise = require('bluebird');
var reconnect = require('reconnect-engine');
var through2 = require('through2');

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

    source = multiplex(function (eventStream, id) {
      //
      // emit "channel" events for all server-initated streams
      //
      client.emit('channel', id, eventStream);
    });

    source.pipe(stream).pipe(source);

    client.connected = true;
    client.emit('connect');
  });

  var requesttId = 0;

  client.request = function (context) {
    if (typeof context === 'string') {
      context = { url: context };
    }

    var handled;
    return new Promise(function (resolve, reject) {

      //
      // if not connected defer until connect
      //
      if (!client.connected) {
        return client.once('connect', function () {
          client.request(context).then(resolve, reject);
        });
      }

      function onhead(result) {
        var headers = result.headers || {};
        var objMode = (headers['content-type'] || '').match(OBJ_MODE_RE);

        //
        // pipe through JSONStream if stream-parasable content-type
        //
        if (objMode && objMode[2]) {

          result.body = stream
            .pipe(JSONStream.parse([/./]))
            .on('error', onerror);

          onresponse(result);
        }

        //
        // non-streaming json, collect up body and run through JSON.parse
        //
        else if (objMode) {

          stream.pipe(concat(function (value) {
            try {
              result.body = JSON.parse(value);
              onresponse(result);
            }
            catch (error) {
              onerror(error);
            }
          }));
        }

        //
        // pass stream along directly
        //
        else {
          result.body = stream;
          onresponse(result);
        }
      }

      function onerror(error) {
        if (!handled) {
          handled = true;
          reject(error);
        }
      }

      function onresponse(response) {
        if (!handled) {
          handled = true;
          resolve(response);
        }
      }

      //
      // create a new substream for request w/ a unique id
      //
      var stream = source.createStream(requesttId++);

      stream
        .on('error', onerror)
        .pipe(reqHeaded())
        .on('error', onerror)
        .on('head', onhead);

      //
      // initiate request by writing context object as JSON to stream
      //
      stream.write(JSON.stringify(context) + '\n');

    });
  };

  connection.on('error', function (error) {
    client.emit('error', error);
  });

  connection.on('disconnect', function () {
    source = null;
    client.connected = false;
    client.emit('disconnect');
  });

  // TODO: disconnect/close

  connection.connect(url);

  return client;
};


function reqHeaded() {
  return through2(function (chunk, enc, cb) {

    if (this._headReceived) {
      return cb(null, chunk);
    }

    var string = chunk.toString('utf8');
    var index = string.indexOf('\n');

    if (index < 0) {
      this._headBuffer += string;
      return cb();
    }

    var head = (this._headBuffer || '') + string.substring(0, index);
    try {
      this._headParsed = JSON.parse(head);
      this._headReceived = true;
    }
    catch (error) {
      cb(new Error('Bad head: ' + head));
    }

    this.pause();
    this.emit('head', this._headParsed);

    var rest = string.substring(index + 1);
    cb(null, Buffer(rest, 'utf8'));

  });
}
