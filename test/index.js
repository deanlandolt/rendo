var Promise = require('bluebird');
Promise.longStackTraces();

var assert = require('assert');
var rendo = require('../');
var through2 = require('through2');

var client = rendo({ endpointRange: 'v1' }).connect();


Promise.all([
  '/body/literal/null',
  '/body/literal/boolean',
  '/body/literal/number',
  '/body/literal/string',
  '/body/literal/array',
  '/body/literal/object',
].map(client.request, client))
.then(function (results) {
  results.forEach(function (result, i) {
    console.log(i + ':', result);
  });
})
// .timeout(1000)
.done();


Promise.all([
  '/body/stream/array',
  '/body/stream/object',
].map(client.request, client))
.then(function (results) {

  return Promise.all(results.map(function (stream) {
    var dfd = Promise.pending();
    var count = 0;
    var items = [];

    stream.on('data', function (data) {
      count += 1;
      items.push(data);
    })
    .on('error', dfd.reject)
    .on('end', function () {
      try {
        console.log('value:', items);
        assert.equal(count, 4);
        assert(Array.isArray(items));
        assert.equal(items.length, 4);
        dfd.resolve(items);
      }
      catch (e) {
        dfd.reject(e);
      }
    });

    return dfd.promise
  }));
})
// .timeout(1000)
.done();


Promise.resolve(client.request('/not/found/xxx')).
then(function (result) {
  console.log('not expected:', result);
})
.catch(function (error) {
  console.log('expected:', error);
})
// .timeout(5000)
.done();
