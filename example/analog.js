'use strict';

var five = require('johnny-five');
var OdroidIO = require('./odroid-io');

var board = new five.Board({
  io: new OdroidIO()
});

board.on('ready', function() {
  console.log('Board Ready');
  var adc = new five.Pin({
	pin: 'A0',
	type: 'analog',
  });
  adc.read(function(err, val) {
	if (err) {
		console.log('Error reading ADC: ', err);
	} else {
		console.log('ADC Value: ' + val);
 	}
  });
});

