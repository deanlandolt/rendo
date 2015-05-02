var Promise = require('bluebird');
var rendo = require('../');

var apiUrl = '';
var api = rendo(apiUrl);


Promise.all([
  '/v1/body/stream/array',
  '/v1/body/stream/object',
].map(function (path) {
  return api.request(path).then(function (result) {
    result.body
      .on('error', console.error.bind(console))
      .on('end', function () {
        console.log('ENDED!');
      })
      .on('data', function (data) {
        console.log(path, 'item:', data);
      })

  })

})).then(function () {
  console.log('FIN STREAM')
})
.catch(function (error) {
  console.log('DAMNIT STREAM', error)
});


Promise.all([
  '/v1/body/literal/null',
  '/v1/body/literal/boolean',
  '/v1/body/literal/number',
  '/v1/body/literal/buffer',
  '/v1/body/literal/string',
  '/v1/body/literal/array',
  '/v1/body/literal/object',
].map(function (path) {

  return api.request(path).then(function (result) {
    console.log(path, result);
  });

})).then(function () {
  console.log('FIN');
})
.catch(function (error) {
  console.log('DAMNIT', error)
});