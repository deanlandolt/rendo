var async = require('async');
var rendo = require('../');

var api = rendo({ endpointRange: 'v1' });


async.map([
  '/body/stream/array',
  '/body/stream/object',
], api.request, function (err, results) {
  console.log('err:', err);

  results.forEach(function (result) {
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
  '/body/literal/null',
  '/body/literal/boolean',
  '/body/literal/number',
  '/body/literal/buffer',
  '/body/literal/string',
  '/body/literal/array',
  '/body/literal/object',
], api.request, function (err, results) {
  console.log('err:', err);

  results.forEach(function (result) {
    console.log(result);
  });

});
