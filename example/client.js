var concat = require('concat-stream')
var Promise = require('bluebird');
Promise.longStackTraces();
var rendo = require('../');
var through2 = require('through2');

var client = rendo({ endpointRange: 'v1' }).connect()


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
.done();


Promise.all([
  '/body/stream/array',
  '/body/stream/object',
].map(client.request, client))
.then(function (results) {

  return Promise.all(results.map(function (result) {
    var dfd = Promise.pending();

    result.pipe(through2()).pipe(concat(function (value) {
      try {
        dfd.resolve(JSON.parse(value));
      }
      catch (error) {
        dfd.reject(error);
      }
    }));

    result.on('error', dfd.reject)

    return dfd.promise
  }));
})
.done();


Promise.resolve(client.request('/not/found/xxx')).
then(function (result) {
  console.log('not expected', result);
})
.catch(function (error) {
  console.log('Expected: ', error);
})
.done();

