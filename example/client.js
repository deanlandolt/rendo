var async = require('async');
var rendo = require('../');

var api = rendo();


async.map([
  '/v1/body/stream/array',
  '/v1/body/stream/object',
], api.request, function (err, results) {
  console.log(err);

  results.map(function (result) {
    result.body
      .on('error', console.error.bind(console))
      .on('end', function () {
        console.log('ENDED!');
      })
      .on('data', function (data) {
        console.log(path, 'item:', data);
      })
  });

});


async.map([
  '/v1/body/literal/null',
  '/v1/body/literal/boolean',
  '/v1/body/literal/number',
  '/v1/body/literal/buffer',
  '/v1/body/literal/string',
  '/v1/body/literal/array',
  '/v1/body/literal/object',
], api.request, function (err, results) {
  console.log(err);

  results.map(function (result) {
    console.log(result);
  });

});
