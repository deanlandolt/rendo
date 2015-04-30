var EventEmitter = require('events').EventEmitter;
var multiplex = require('multiplex');
var reconnect = require('reconnect-engine');

module.exports = function (url, options) {
  var emitter = new EventEmitter();
  var source;

  var con = reconnect(options).on('connect', function(stream) {

    emitter.connected = true;
    source = multiplex(function (stream, id) {
      //
      // emit events for server-initated streams
      //
      emitter.emit('stream', stream, id);
    });
    source.pipe(stream).pipe(source);

  }).on('disconnect', function () {

    emitter.connected = false;
    source = null;

  }).connect(url);

  emitter.request = function (req) {
    if (!source) {
      throw new Error('Socket connected');
    }

    //
    // create a new substream for request
    //
    var id = ('' + Math.random()).slice(2);
    var stream = source.createStream(id);

    //
    // initiate request by writing req object as JSON to stream
    //
    source.write(JSON.stringify(req) + '\n');
    return stream;
  };

  emitter.disconnect = function () {
    con.disconnect();
  };

  return emitter;
};
